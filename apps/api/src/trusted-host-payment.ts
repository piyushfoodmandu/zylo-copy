import {
  createHash,
  createPublicKey,
  createVerify
} from 'node:crypto'
import {
  UcpPaymentInstrumentSchema,
  validationErrorSummary,
  type UcpCheckout,
  type UcpPaymentInstrument
} from '@arro/contracts'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { stableJsonStringify } from './stable-json.ts'

const instrumentValidator = TypeCompiler.Compile(UcpPaymentInstrumentSchema)

export type TrustedHostPaymentConfig = {
  hostId: string
  integrationId: string
  issuer: string
  audience: string
  redemptionEndpoint: string
  authorizationEndpoint?: string
  jwks: Record<string, unknown>[]
  headers?: Record<string, string>
  allowedScopes?: string[]
  handlerNames?: string[]
  componentProtocols?: string[]
  allowedComponentOrigins?: string[]
  allowedReturnOrigins?: string[]
  canReceiveAsyncPurchaseUpdates?: boolean
  thirdPartyPaymentEmbeddingAllowed?: boolean
  autonomousExecutionAllowed?: boolean
}

export type TrustedHostPaymentExpectedBinding = {
  provider: string
  expectedHandlerId: string
  merchantOrigin: string
  transactionId: string
  actionId: string
  checkoutSnapshotHash: string
  capabilityId?: string
  paymentActionNonceHash: string
  checkout: UcpCheckout
}

export type TrustedHostPaymentRedemptionOutput = {
  provider: string
  handlerName: string
  handlerId: string
  instrument: UcpPaymentInstrument
  ap2CheckoutMandate?: string
  attestationHash: string
}

export class TrustedHostPaymentError extends Error {
  readonly code:
    | 'trusted_host_not_configured'
    | 'trusted_host_attestation_invalid'
    | 'trusted_host_attestation_replayed_or_mismatched'
    | 'trusted_host_reference_redeem_failed'
    | 'trusted_host_instrument_invalid'
  readonly details?: unknown

  constructor(code: TrustedHostPaymentError['code'], message: string, details?: unknown) {
    super(message)
    this.name = 'TrustedHostPaymentError'
    this.code = code
    this.details = details
  }
}

export type TrustedHostPaymentVerifier = {
  verifyAndRedeem(input: {
    attestation: string
    expected: TrustedHostPaymentExpectedBinding
  }): Promise<TrustedHostPaymentRedemptionOutput>
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const stringValue = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined

const stringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((entry) => stringValue(entry) ? [stringValue(entry)!] : [])
    : []

const numberValue = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined

const stableHash = (value: unknown) =>
  `sha256:${createHash('sha256').update(stableJsonStringify(value), 'utf8').digest('hex')}`

const decodeBase64UrlJson = (value: string) => {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
  } catch {
    throw new TrustedHostPaymentError(
      'trusted_host_attestation_invalid',
      'Trusted host payment attestation is not valid base64url JSON.'
    )
  }
}

const rawEcdsaToDer = (signature: Buffer) => {
  if (signature.length !== 64) return signature
  const integer = (bytes: Buffer) => {
    let value = bytes
    while (value.length > 1 && value[0] === 0) value = value.subarray(1)
    if ((value[0]! & 0x80) !== 0) value = Buffer.concat([Buffer.from([0]), value])
    return Buffer.concat([Buffer.from([0x02, value.length]), value])
  }
  const r = integer(signature.subarray(0, 32))
  const s = integer(signature.subarray(32))
  const body = Buffer.concat([r, s])
  return Buffer.concat([Buffer.from([0x30, body.length]), body])
}

const verifyJwsSignature = ({
  alg,
  jwk,
  signingInput,
  signature
}: {
  alg: string
  jwk: Record<string, unknown>
  signingInput: string
  signature: Buffer
}) => {
  if (alg !== 'ES256' && alg !== 'RS256') {
    throw new TrustedHostPaymentError(
      'trusted_host_attestation_invalid',
      'Trusted host payment attestation must use ES256 or RS256.'
    )
  }
  const verifier = createVerify('sha256')
  verifier.update(signingInput)
  verifier.end()
  const key = createPublicKey({ key: jwk, format: 'jwk' })
  if (verifier.verify(key, signature)) return true
  if (alg === 'ES256') {
    const rawVerifier = createVerify('sha256')
    rawVerifier.update(signingInput)
    rawVerifier.end()
    return rawVerifier.verify(key, rawEcdsaToDer(signature))
  }
  return false
}

const parseCompactJws = (attestation: string) => {
  const parts = attestation.trim().split('.')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new TrustedHostPaymentError(
      'trusted_host_attestation_invalid',
      'Trusted host payment attestation must be a compact JWS.'
    )
  }
  const [protectedHeader, payload, signature] = parts as [string, string, string]
  const header = asRecord(decodeBase64UrlJson(protectedHeader))
  const claims = asRecord(decodeBase64UrlJson(payload))
  return {
    header,
    claims,
    signingInput: `${protectedHeader}.${payload}`,
    signature: Buffer.from(signature, 'base64url')
  }
}

const matchingConfig = (
  configs: TrustedHostPaymentConfig[],
  claims: Record<string, unknown>
) => {
  const issuer = stringValue(claims.iss)
  const audience = stringValue(claims.aud)
  const hostId = stringValue(claims.host_id) ?? stringValue(claims.hostId)
  const integrationId = stringValue(claims.integration_id) ?? stringValue(claims.integrationId)
  return configs.find((config) =>
    config.issuer === issuer &&
    config.audience === audience &&
    config.hostId === hostId &&
    config.integrationId === integrationId
  )
}

const assertClaimEquals = (
  claims: Record<string, unknown>,
  key: string,
  expected: string | undefined,
  label = key
) => {
  if (!expected) return
  const actual = stringValue(claims[key])
  if (actual !== expected) {
    throw new TrustedHostPaymentError(
      'trusted_host_attestation_replayed_or_mismatched',
      `Trusted host attestation ${label} does not match the active checkout binding.`,
      { expected, actual }
    )
  }
}

const assertFreshClaims = (claims: Record<string, unknown>, now = new Date()) => {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const issuedAt = numberValue(claims.iat)
  const expiresAt = numberValue(claims.exp)
  const notBefore = numberValue(claims.nbf)
  if (!issuedAt || !expiresAt || !stringValue(claims.jti)) {
    throw new TrustedHostPaymentError(
      'trusted_host_attestation_invalid',
      'Trusted host attestation must include iat, exp, and jti claims.'
    )
  }
  if (issuedAt > nowSeconds + 60 || expiresAt <= nowSeconds || expiresAt - issuedAt > 900) {
    throw new TrustedHostPaymentError(
      'trusted_host_attestation_invalid',
      'Trusted host attestation is expired or outside the allowed clock window.'
    )
  }
  if (notBefore !== undefined && notBefore > nowSeconds + 60) {
    throw new TrustedHostPaymentError(
      'trusted_host_attestation_invalid',
      'Trusted host attestation is not valid yet.'
    )
  }
}

const validateBinding = (
  claims: Record<string, unknown>,
  expected: TrustedHostPaymentExpectedBinding
) => {
  assertFreshClaims(claims)
  assertClaimEquals(claims, 'action_id', expected.actionId, 'action_id')
  assertClaimEquals(claims, 'transaction_id', expected.transactionId, 'transaction_id')
  assertClaimEquals(claims, 'checkout_id', expected.checkout.id, 'checkout_id')
  assertClaimEquals(claims, 'checkout_snapshot_hash', expected.checkoutSnapshotHash, 'checkout_snapshot_hash')
  assertClaimEquals(claims, 'merchant_origin', expected.merchantOrigin, 'merchant_origin')
  assertClaimEquals(claims, 'handler_id', expected.expectedHandlerId, 'handler_id')
  assertClaimEquals(claims, 'handler_name', expected.provider, 'handler_name')
  assertClaimEquals(claims, 'capability_id', expected.capabilityId, 'capability_id')
  assertClaimEquals(claims, 'payment_action_nonce_hash', expected.paymentActionNonceHash, 'payment_action_nonce_hash')
  if (!stringValue(claims.credential_reference)) {
    throw new TrustedHostPaymentError(
      'trusted_host_attestation_invalid',
      'Trusted host attestation must contain an opaque credential_reference.'
    )
  }
}

const parseEntries = (value: unknown) => {
  if (!value) return []
  if (Array.isArray(value)) return value.map(asRecord)
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([hostId, entry]) => ({
    hostId,
    ...asRecord(entry)
  } as Record<string, unknown>))
  return []
}

export const parseTrustedHostPaymentConfigs = ({
  capabilitiesJson,
  keysJson
}: {
  capabilitiesJson?: string | undefined
  keysJson?: string | undefined
}): TrustedHostPaymentConfig[] => {
  if (!capabilitiesJson || !keysJson) return []
  const capabilities = parseEntries(JSON.parse(capabilitiesJson) as unknown)
  const keyEntries = parseEntries(JSON.parse(keysJson) as unknown)
  return capabilities.map((entry, index) => {
    const hostId = stringValue(entry.hostId) ?? stringValue(entry.host_id)
    const integrationId = stringValue(entry.integrationId) ?? stringValue(entry.integration_id)
    const issuer = stringValue(entry.issuer)
    const audience = stringValue(entry.audience)
    const redemptionEndpoint = stringValue(entry.redemptionEndpoint) ?? stringValue(entry.redemption_endpoint)
    const authorizationEndpoint = stringValue(entry.authorizationEndpoint) ?? stringValue(entry.authorization_endpoint)
    const keyEntry = keyEntries.find((candidate) =>
      (stringValue(candidate.hostId) ?? stringValue(candidate.host_id)) === hostId ||
      stringValue(candidate.issuer) === issuer
    )
    const jwks = Array.isArray(keyEntry?.keys)
      ? keyEntry.keys.map(asRecord)
      : Array.isArray(keyEntry?.jwks)
        ? keyEntry.jwks.map(asRecord)
        : []
    if (!hostId || !integrationId || !issuer || !audience || !redemptionEndpoint || jwks.length === 0) {
      throw new Error(`HOST_PAYMENT_CAPABILITIES_JSON[${index}] and HOST_PAYMENT_ATTESTATION_KEYS_JSON must declare hostId, integrationId, issuer, audience, redemptionEndpoint, and public JWKs.`)
    }
    const endpoint = new URL(redemptionEndpoint)
    if (endpoint.protocol !== 'https:') {
      throw new Error(`HOST_PAYMENT_CAPABILITIES_JSON[${index}].redemptionEndpoint must be HTTPS.`)
    }
    const authorizationUrl = authorizationEndpoint ? new URL(authorizationEndpoint) : undefined
    if (authorizationUrl && authorizationUrl.protocol !== 'https:') {
      throw new Error(`HOST_PAYMENT_CAPABILITIES_JSON[${index}].authorizationEndpoint must be HTTPS.`)
    }
    return {
      hostId,
      integrationId,
      issuer,
      audience,
      redemptionEndpoint: endpoint.href,
      ...(authorizationUrl ? { authorizationEndpoint: authorizationUrl.href } : {}),
      jwks,
      allowedScopes: stringArray(entry.allowedScopes ?? entry.allowed_scopes),
      handlerNames: stringArray(entry.handlerNames ?? entry.handler_names),
      componentProtocols: stringArray(entry.componentProtocols ?? entry.component_protocols),
      allowedComponentOrigins: stringArray(entry.allowedComponentOrigins ?? entry.allowed_component_origins),
      allowedReturnOrigins: stringArray(entry.allowedReturnOrigins ?? entry.allowed_return_origins),
      canReceiveAsyncPurchaseUpdates: entry.canReceiveAsyncPurchaseUpdates === true || entry.can_receive_async_purchase_updates === true,
      thirdPartyPaymentEmbeddingAllowed: entry.thirdPartyPaymentEmbeddingAllowed === true || entry.third_party_payment_embedding_allowed === true,
      autonomousExecutionAllowed: entry.autonomousExecutionAllowed === true || entry.autonomous_execution_allowed === true,
      ...(asRecord(entry.headers) ? { headers: asRecord(entry.headers) as Record<string, string> } : {})
    } satisfies TrustedHostPaymentConfig
  })
}

export const createTrustedHostPaymentVerifier = ({
  configs,
  fetch: fetcher = fetch
}: {
  configs: TrustedHostPaymentConfig[]
  fetch?: typeof fetch
}): TrustedHostPaymentVerifier => ({
  async verifyAndRedeem({ attestation, expected }) {
    const parsed = parseCompactJws(attestation)
    const alg = stringValue(parsed.header.alg)
    const kid = stringValue(parsed.header.kid)
    if (!alg || !kid) {
      throw new TrustedHostPaymentError(
        'trusted_host_attestation_invalid',
        'Trusted host attestation must include alg and kid.'
      )
    }
    const config = matchingConfig(configs, parsed.claims)
    if (!config) {
      throw new TrustedHostPaymentError(
        'trusted_host_not_configured',
        'Trusted host attestation issuer, audience, host, or integration is not configured.'
      )
    }
    const key = config.jwks.find((candidate) => stringValue(candidate.kid) === kid)
    if (!key) {
      throw new TrustedHostPaymentError(
        'trusted_host_not_configured',
        'Trusted host attestation key id is not configured.'
      )
    }
    if (!verifyJwsSignature({
      alg,
      jwk: key,
      signingInput: parsed.signingInput,
      signature: parsed.signature
    })) {
      throw new TrustedHostPaymentError(
        'trusted_host_attestation_invalid',
        'Trusted host payment attestation signature could not be verified.'
      )
    }

    validateBinding(parsed.claims, expected)
    const credentialReference = stringValue(parsed.claims.credential_reference)!
    const response = await fetcher(config.redemptionEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(config.headers ?? {})
      },
      redirect: 'manual',
      body: JSON.stringify({
        attestation,
        credential_reference: credentialReference,
        action_id: expected.actionId,
        transaction_id: expected.transactionId,
        checkout_id: expected.checkout.id,
        checkout_snapshot_hash: expected.checkoutSnapshotHash,
        payment_action_nonce_hash: expected.paymentActionNonceHash,
        merchant_origin: expected.merchantOrigin,
        handler_name: expected.provider,
        handler_id: expected.expectedHandlerId
      })
    })
    if (!response.ok) {
      throw new TrustedHostPaymentError(
        'trusted_host_reference_redeem_failed',
        'Trusted host credential reference could not be redeemed.',
        { httpStatus: response.status }
      )
    }
    const body = await response.json() as unknown
    const responseBody = asRecord(body)
    const instrument = responseBody.instrument ?? body
    const ap2CheckoutMandate = stringValue(asRecord(responseBody.ap2).checkout_mandate)
    if (!instrumentValidator.Check(instrument)) {
      throw new TrustedHostPaymentError(
        'trusted_host_instrument_invalid',
        'Trusted host redemption did not return a valid UCP payment instrument.',
        validationErrorSummary(instrumentValidator, instrument)
      )
    }
    return {
      provider: expected.provider,
      handlerName: expected.provider,
      handlerId: expected.expectedHandlerId,
      instrument: instrument as UcpPaymentInstrument,
      ...(ap2CheckoutMandate ? { ap2CheckoutMandate } : {}),
      attestationHash: stableHash({
        kid,
        jti: stringValue(parsed.claims.jti),
        actionId: expected.actionId,
        credentialReference
      })
    }
  }
})
