import { createHash } from 'node:crypto'
import type {
  PortablePaymentCapability,
  PurchasePaymentActionResult,
  UcpCheckout,
  UcpPaymentHandlerDeclaration,
  UcpPaymentInstrument
} from '@arro/contracts'
import { jcsCanonicalize } from './ap2-mandate.ts'
import { stableJsonStringify } from './stable-json.ts'

export const x402HandlerName = 'dev.arro.payment.x402'
export const mppHandlerName = 'dev.arro.payment.mpp'
export const x402ProtocolVersion = '2'
export const mppProtocolVersion = 'draft-ietf-httpauth-payment-00'
export const arroCheckoutBindingExtension = 'dev.arro.checkout'

type PortableProtocol = 'x402' | 'mpp'

export type PortablePaymentChallenge = {
  protocol: PortableProtocol
  version: string
  challengeUrl: string
  expiresAt: string
  challenge: Record<string, unknown>
  capability: PortablePaymentCapability
}

export type PortablePaymentChallengeClient = {
  acquire(input: {
    protocol: PortableProtocol
    declaration: UcpPaymentHandlerDeclaration
    checkout: UcpCheckout
    checkoutSnapshotHash: string
    merchantOrigin: string
    capability: PortablePaymentCapability
    idempotencyKey: string
  }): Promise<PortablePaymentChallenge>
}

export class PortablePaymentError extends Error {
  readonly code:
    | 'portable_payment_contract_invalid'
    | 'portable_payment_challenge_invalid'
    | 'portable_payment_capability_mismatch'
    | 'portable_payment_credential_invalid'

  constructor(code: PortablePaymentError['code'], message: string) {
    super(message)
    this.name = 'PortablePaymentError'
    this.code = code
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const stringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []

const totalFor = (checkout: UcpCheckout) =>
  checkout.totals.find((entry) => entry.type === 'total')?.amount

const stableEqual = (left: unknown, right: unknown) =>
  stableJsonStringify(left) === stableJsonStringify(right)

const decodeBase64Json = (value: string, label: string): Record<string, unknown> => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new PortablePaymentError(
      'portable_payment_challenge_invalid',
      `${label} must be unpadded base64url JSON.`
    )
  }
  try {
    return asRecord(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
  } catch {
    throw new PortablePaymentError(
      'portable_payment_challenge_invalid',
      `${label} must be unpadded base64url JSON.`
    )
  }
}

const decodeCanonicalBase64Json = (value: string, label: string): Record<string, unknown> => {
  const decoded = decodeBase64Json(value, label)
  const canonical = Buffer.from(jcsCanonicalize(decoded), 'utf8').toString('base64url')
  if (canonical !== value) {
    throw new PortablePaymentError(
      'portable_payment_challenge_invalid',
      `${label} must use JCS before unpadded base64url encoding.`
    )
  }
  return decoded
}

const challengeUrlFrom = (declaration: UcpPaymentHandlerDeclaration, merchantOrigin: string) => {
  const config = asRecord(declaration.config)
  const endpoints = asRecord(config.endpoints)
  const raw = stringValue(config.challenge_url) ?? stringValue(endpoints.challenge)
  if (!raw) {
    throw new PortablePaymentError(
      'portable_payment_contract_invalid',
      'Portable payment handler must advertise an exact challenge_url endpoint.'
    )
  }
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.origin !== new URL(merchantOrigin).origin) {
    throw new PortablePaymentError(
      'portable_payment_contract_invalid',
      'Portable payment challenge_url must be HTTPS and owned by the current merchant origin.'
    )
  }
  return url.href
}

const checkoutBinding = ({
  checkout,
  checkoutSnapshotHash,
  merchantOrigin
}: {
  checkout: UcpCheckout
  checkoutSnapshotHash: string
  merchantOrigin: string
}) => ({
  merchant_origin: new URL(merchantOrigin).origin,
  checkout_id: checkout.id,
  checkout_snapshot_hash: checkoutSnapshotHash,
  amount: totalFor(checkout),
  currency: checkout.currency
})

const assertBinding = (
  actual: unknown,
  expected: ReturnType<typeof checkoutBinding>,
  label: string
) => {
  if (!stableEqual(actual, expected)) {
    throw new PortablePaymentError(
      'portable_payment_challenge_invalid',
      `${label} is not bound to the exact current merchant Checkout, amount, currency, and snapshot.`
    )
  }
}

const x402BindingFrom = (paymentRequired: Record<string, unknown>) => {
  const extension = asRecord(asRecord(paymentRequired.extensions)[arroCheckoutBindingExtension])
  return extension.info
}

const x402RequirementMatchesCapability = (
  requirement: Record<string, unknown>,
  capability: PortablePaymentCapability
) => {
  const scheme = stringValue(requirement.scheme)
  const network = stringValue(requirement.network)
  const amount = stringValue(requirement.amount)
  const asset = stringValue(requirement.asset)
  const payTo = stringValue(requirement.payTo)
  const maxTimeoutSeconds = Number(requirement.maxTimeoutSeconds)
  return Boolean(
    scheme && network && amount && /^[0-9]+$/.test(amount) && BigInt(amount) > 0n && asset && payTo &&
    Number.isSafeInteger(maxTimeoutSeconds) && maxTimeoutSeconds > 0 && maxTimeoutSeconds <= 86_400 &&
    (!capability.methods?.length || capability.methods.includes(scheme)) &&
    (!capability.networks?.length || capability.networks.includes(network)) &&
    (!capability.assets?.length || capability.assets.includes(asset))
  )
}

const assertX402Challenge = ({
  paymentRequired,
  expectedBinding,
  capability,
  challengeUrl
}: {
  paymentRequired: Record<string, unknown>
  expectedBinding: ReturnType<typeof checkoutBinding>
  capability: PortablePaymentCapability
  challengeUrl: string
}) => {
  if (paymentRequired.x402Version !== 2) {
    throw new PortablePaymentError('portable_payment_challenge_invalid', 'x402 challenge must use protocol version 2.')
  }
  const resourceUrl = stringValue(asRecord(paymentRequired.resource).url)
  if (!resourceUrl || new URL(resourceUrl).origin !== new URL(challengeUrl).origin) {
    throw new PortablePaymentError('portable_payment_challenge_invalid', 'x402 resource must remain on the merchant origin.')
  }
  const accepts = Array.isArray(paymentRequired.accepts)
    ? paymentRequired.accepts.map(asRecord)
    : []
  const supported = accepts.some((requirement) => x402RequirementMatchesCapability(requirement, capability))
  if (!supported) {
    throw new PortablePaymentError(
      'portable_payment_capability_mismatch',
      'The x402 challenge does not intersect the agent-declared schemes, networks, and assets.'
    )
  }
  const bindingExtension = asRecord(asRecord(paymentRequired.extensions)[arroCheckoutBindingExtension])
  if (Object.keys(asRecord(bindingExtension.schema)).length === 0) {
    throw new PortablePaymentError('portable_payment_challenge_invalid', 'x402 Checkout extension must include its JSON Schema.')
  }
  assertBinding(x402BindingFrom(paymentRequired), expectedBinding, 'x402 Checkout extension')
}

const parseMppChallenge = (header: string) => {
  const payment = header.trim().replace(/^Payment\s+/i, '')
  const values: Record<string, string> = {}
  const matcher = /([a-z][a-z0-9_-]*)="((?:[^"\\]|\\.)*)"/gi
  for (const match of payment.matchAll(matcher)) {
    const key = match[1]!.toLowerCase()
    if (values[key] !== undefined) {
      throw new PortablePaymentError('portable_payment_challenge_invalid', `MPP challenge repeats ${key}.`)
    }
    values[key] = match[2]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  for (const required of ['id', 'realm', 'method', 'intent', 'request']) {
    if (!values[required]) {
      throw new PortablePaymentError(
        'portable_payment_challenge_invalid',
        `MPP challenge is missing required ${required}.`
      )
    }
  }
  return values as Record<'id' | 'realm' | 'method' | 'intent' | 'request', string> & Record<string, string>
}

const assertMppChallenge = ({
  challenge,
  expectedBinding,
  capability,
  challengeUrl
}: {
  challenge: ReturnType<typeof parseMppChallenge>
  expectedBinding: ReturnType<typeof checkoutBinding>
  capability: PortablePaymentCapability
  challengeUrl: string
}) => {
  if (challenge.realm !== new URL(challengeUrl).host) {
    throw new PortablePaymentError('portable_payment_challenge_invalid', 'MPP challenge realm must equal the merchant challenge host.')
  }
  if (!/^[a-z]+$/.test(challenge.method) || !/^[A-Za-z0-9-]+$/.test(challenge.intent)) {
    throw new PortablePaymentError('portable_payment_challenge_invalid', 'MPP method or intent identifier is invalid.')
  }
  if (capability.methods?.length && !capability.methods.includes(challenge.method)) {
    throw new PortablePaymentError('portable_payment_capability_mismatch', 'MPP payment method is not executable by this agent.')
  }
  if (capability.intents?.length && !capability.intents.includes(challenge.intent)) {
    throw new PortablePaymentError('portable_payment_capability_mismatch', 'MPP payment intent is not executable by this agent.')
  }
  const request = decodeCanonicalBase64Json(challenge.request, 'MPP challenge request')
  assertBinding(request.arro_checkout, expectedBinding, 'MPP Checkout request')
}

export const createHttpPortablePaymentChallengeClient = ({
  fetch: fetcher = fetch,
  timeoutMs = 15_000
}: {
  fetch?: typeof fetch
  timeoutMs?: number
} = {}): PortablePaymentChallengeClient => ({
  async acquire(input) {
    const challengeUrl = challengeUrlFrom(input.declaration, input.merchantOrigin)
    const expectedBinding = checkoutBinding(input)
    const response = await fetcher(challengeUrl, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Idempotency-Key': input.idempotencyKey,
        ...(input.protocol === 'mpp' && input.capability.methods?.length
          ? {
              'Accept-Payment': input.capability.methods.flatMap((method) =>
                input.capability.intents?.length
                  ? input.capability.intents.map((intent) => `${method}/${intent}`)
                  : [`${method}/*`]
              ).join(', ')
            }
          : {})
      },
      body: JSON.stringify({
        protocol: input.protocol,
        binding: expectedBinding
      })
    })
    if (response.status !== 402) {
      throw new PortablePaymentError(
        'portable_payment_challenge_invalid',
        `Merchant portable payment endpoint must return HTTP 402, received ${response.status}.`
      )
    }
    if (!response.headers.get('cache-control')?.toLowerCase().includes('no-store')) {
      throw new PortablePaymentError('portable_payment_challenge_invalid', 'Merchant payment challenge must be non-cacheable.')
    }

    if (input.protocol === 'x402') {
      const header = response.headers.get('payment-required')
      if (!header) {
        throw new PortablePaymentError('portable_payment_challenge_invalid', 'x402 response is missing PAYMENT-REQUIRED.')
      }
      const paymentRequired = decodeBase64Json(header, 'PAYMENT-REQUIRED')
      assertX402Challenge({ paymentRequired, expectedBinding, capability: input.capability, challengeUrl })
      const accepts = (paymentRequired.accepts as unknown[]).map(asRecord)
      const timeoutSeconds = Math.min(...accepts.map((entry) => Number(entry.maxTimeoutSeconds)).filter(Number.isFinite))
      const ttlSeconds = Number.isFinite(timeoutSeconds) ? Math.max(1, timeoutSeconds) : 60
      return {
        protocol: 'x402',
        version: x402ProtocolVersion,
        challengeUrl,
        expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        challenge: paymentRequired,
        capability: input.capability
      }
    }

    const header = response.headers.get('www-authenticate')
    if (!header || !/^Payment\s/i.test(header)) {
      throw new PortablePaymentError('portable_payment_challenge_invalid', 'MPP response is missing WWW-Authenticate: Payment.')
    }
    const challenge = parseMppChallenge(header)
    assertMppChallenge({ challenge, expectedBinding, capability: input.capability, challengeUrl })
    const expiresAt = challenge.expires ?? new Date(Date.now() + 60_000).toISOString()
    if (!Number.isFinite(new Date(expiresAt).getTime()) || new Date(expiresAt).getTime() <= Date.now()) {
      throw new PortablePaymentError('portable_payment_challenge_invalid', 'MPP challenge expiry is invalid or already elapsed.')
    }
    return {
      protocol: 'mpp',
      version: mppProtocolVersion,
      challengeUrl,
      expiresAt,
      challenge,
      capability: input.capability
    }
  }
})

const requiredChallenge = (actionPayload: unknown, protocol: PortableProtocol) => {
  const action = asRecord(actionPayload)
  if (action.kind !== 'portable_payment_action' || action.protocol !== protocol) {
    throw new PortablePaymentError('portable_payment_credential_invalid', 'Payment result does not match the signed portable payment action.')
  }
  const challenge = asRecord(action.challenge)
  const capability = asRecord(action.capability) as PortablePaymentCapability
  if (Object.keys(challenge).length === 0) {
    throw new PortablePaymentError('portable_payment_credential_invalid', 'Signed payment action is missing its merchant challenge.')
  }
  const expectedVersion = protocol === 'x402' ? x402ProtocolVersion : mppProtocolVersion
  if (action.version !== expectedVersion || capability.protocol !== protocol || capability.version !== expectedVersion) {
    throw new PortablePaymentError('portable_payment_credential_invalid', 'Signed payment action lost its exact protocol capability binding.')
  }
  return {
    action,
    challenge,
    capability,
    expiresAt: stringValue(action.expiresAt)
  }
}

const instrumentId = (protocol: PortableProtocol, result: unknown) =>
  `pi_${protocol}_${createHash('sha256').update(stableJsonStringify(result), 'utf8').digest('hex').slice(0, 24)}`

export const exchangePortablePaymentResult = ({
  result,
  actionPayload,
  handlerId,
  checkout,
  checkoutSnapshotHash,
  merchantOrigin
}: {
  result: Extract<PurchasePaymentActionResult, { type: 'x402_payment_payload' | 'mpp_payment_credential' }>
  actionPayload: unknown
  handlerId: string
  checkout: UcpCheckout
  checkoutSnapshotHash: string
  merchantOrigin: string
}): { instrument: UcpPaymentInstrument; fingerprint: string } => {
  const protocol = result.type === 'x402_payment_payload' ? 'x402' : 'mpp'
  const { challenge, capability, expiresAt } = requiredChallenge(actionPayload, protocol)
  const expectedBinding = checkoutBinding({ checkout, checkoutSnapshotHash, merchantOrigin })
  const expiryTime = expiresAt ? new Date(expiresAt).getTime() : Number.NaN
  if (!Number.isFinite(expiryTime) || expiryTime <= Date.now()) {
    throw new PortablePaymentError('portable_payment_credential_invalid', 'Portable payment challenge has expired.')
  }

  if (protocol === 'x402') {
    const payload = result.type === 'x402_payment_payload' ? result.paymentPayload : undefined
    if (!payload || payload.x402Version !== 2) {
      throw new PortablePaymentError('portable_payment_credential_invalid', 'x402 payment payload must use protocol version 2.')
    }
    const accepts = Array.isArray(challenge.accepts) ? challenge.accepts : []
    if (!accepts.some((requirement) => stableEqual(requirement, payload.accepted))) {
      throw new PortablePaymentError('portable_payment_credential_invalid', 'x402 accepted requirements must exactly match one merchant challenge option.')
    }
    if (!x402RequirementMatchesCapability(asRecord(payload.accepted), capability)) {
      throw new PortablePaymentError('portable_payment_credential_invalid', 'x402 payment payload does not match the capability bound into the signed action.')
    }
    if (Object.keys(asRecord(payload.payload)).length === 0) {
      throw new PortablePaymentError('portable_payment_credential_invalid', 'x402 payment payload is missing its scheme-native credential.')
    }
    if (payload.resource && !stableEqual(payload.resource, challenge.resource)) {
      throw new PortablePaymentError('portable_payment_credential_invalid', 'x402 resource changed after the merchant challenge.')
    }
    const challengeExtensions = asRecord(challenge.extensions)
    const payloadExtensions = asRecord(payload.extensions)
    for (const [name, extension] of Object.entries(challengeExtensions)) {
      if (!stableEqual(payloadExtensions[name], extension)) {
        throw new PortablePaymentError('portable_payment_credential_invalid', `x402 extension ${name} changed or was removed.`)
      }
    }
    assertBinding(x402BindingFrom(challenge), expectedBinding, 'x402 Checkout extension')
  } else {
    if (result.type !== 'mpp_payment_credential') {
      throw new PortablePaymentError('portable_payment_credential_invalid', 'MPP result envelope is invalid.')
    }
    const encoded = result.authorization.replace(/^Payment\s+/, '')
    const credential = decodeBase64Json(encoded, 'MPP Payment credential')
    if (!stableEqual(credential.challenge, challenge)) {
      throw new PortablePaymentError('portable_payment_credential_invalid', 'MPP credential must echo the exact merchant challenge.')
    }
    if (Object.keys(asRecord(credential.payload)).length === 0) {
      throw new PortablePaymentError('portable_payment_credential_invalid', 'MPP credential is missing its method-specific payment proof.')
    }
    const request = decodeCanonicalBase64Json(String(challenge.request), 'MPP challenge request')
    assertBinding(request.arro_checkout, expectedBinding, 'MPP Checkout request')
  }

  const credential = protocol === 'x402'
    ? {
        type: 'X402_PAYMENT_PAYLOAD_V2',
        payment_payload: (result as Extract<typeof result, { type: 'x402_payment_payload' }>).paymentPayload,
        payment_required: challenge,
        reusable: false,
        scope: expectedBinding,
        expires_at: expiresAt
      }
    : {
        type: 'MPP_PAYMENT_CREDENTIAL_DRAFT',
        authorization: (result as Extract<typeof result, { type: 'mpp_payment_credential' }>).authorization,
        challenge,
        reusable: false,
        scope: expectedBinding,
        expires_at: expiresAt
      }
  const instrument: UcpPaymentInstrument = {
    id: instrumentId(protocol, result),
    handler_id: handlerId,
    type: protocol,
    selected: true,
    credential
  }
  return {
    instrument,
    fingerprint: `sha256:${createHash('sha256').update(stableJsonStringify({
      protocol,
      handlerId,
      checkoutSnapshotHash,
      result
    }), 'utf8').digest('hex')}`
  }
}
