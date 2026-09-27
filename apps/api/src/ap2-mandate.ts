import {
  createHash,
  createPublicKey,
  createVerify
} from 'node:crypto'
import type {
  UcpCheckout,
  UcpPaymentInstrument,
  UcpProfile
} from '@arro/contracts'
import { resolveUcpProfileSigningKeys } from '@arro/contracts'
import type { UcpCheckoutStore } from './ucp-checkout-store.ts'
import type { PurchaseMandate } from './purchase-mandate.ts'

export type Ap2MandateIssueCode =
  | 'ap2_mandate_config_missing'
  | 'ap2_mandate_signature_invalid'
  | 'ap2_mandate_key_binding_invalid'
  | 'ap2_mandate_merchant_authorization_invalid'
  | 'ap2_mandate_scope_invalid'
  | 'ap2_mandate_expired'
  | 'ap2_mandate_replay'

export class Ap2MandateError extends Error {
  readonly code: Ap2MandateIssueCode
  readonly details?: unknown

  constructor(code: Ap2MandateIssueCode, message: string, details?: unknown) {
    super(message)
    this.name = 'Ap2MandateError'
    this.code = code
    this.details = details
  }
}

export type Ap2TrustedIssuer = {
  issuer: string
  audience?: string | string[]
  keys: Array<Record<string, unknown>>
}

export type Ap2MandateVerificationInput = {
  checkoutMandate: string
  paymentMandate: string
  paymentInstrument: UcpPaymentInstrument
  checkout: UcpCheckout
  businessProfile: UcpProfile
  merchantOrigin: string
  transactionId: string
  checkoutId: string
  checkoutSnapshotHash: string
  trustedIssuers: Ap2TrustedIssuer[]
  store: UcpCheckoutStore
  expectedAudience?: string
  expectedNonce?: string
  mandateContext?: {
    totalAmountMinor: string
    totalUses: number
    lastUsedAt?: string
    expectedOpenCheckoutReference?: string
    expectedOpenPaymentReference?: string
  }
  authorityContext?: {
    ownerKeyId?: string
    ownerPrincipalHash?: string
    integrationId: string
    agentSessionId?: string
    canonicalMandateId?: string
    canonicalMandateVersion?: number
  }
  now?: Date
}

type ParsedJws = {
  header: Record<string, unknown>
  claims: Record<string, unknown>
  protectedHeader: string
  payload: string
  signature: Buffer
  signingInput: string
  compact: string
}

type ParsedSdJwt = {
  reconstructed: Record<string, unknown>
  issuer: Ap2TrustedIssuer
  issuerJws: ParsedJws
  canonical: string
  disclosures: string[]
}

type ParsedAp2Chain = {
  root: ParsedSdJwt
  terminal: ParsedSdJwt
  payloads: Record<string, unknown>[]
  delegated: boolean
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const integerValue = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .flatMap((key) => {
        const entry = (value as Record<string, unknown>)[key]
        return entry === undefined ? [] : [[key, canonicalValue(entry)]]
      })
  )
}

export const jcsCanonicalize = (value: unknown) => JSON.stringify(canonicalValue(value))

const digestName = (alg: string) => {
  if (alg === 'ES256' || alg === 'RS256' || alg === 'sha-256') return 'sha256'
  if (alg === 'ES384' || alg === 'sha-384') return 'sha384'
  if (alg === 'ES512' || alg === 'sha-512') return 'sha512'
  throw new Ap2MandateError('ap2_mandate_signature_invalid', `Unsupported AP2 algorithm: ${alg}.`)
}

const hashBase64Url = (value: string | Buffer, alg = 'sha-256') =>
  createHash(digestName(alg)).update(value).digest('base64url')

const hashReference = (value: string) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`

const decodeBase64UrlJson = (value: string) => {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
  } catch {
    throw new Ap2MandateError('ap2_mandate_signature_invalid', 'AP2 artifact contains invalid base64url JSON.')
  }
}

const parseCompactJws = (value: string, detachedPayload?: string): ParsedJws => {
  const parts = value.split('.')
  if (parts.length !== 3 || !parts[0] || !parts[2]) {
    throw new Ap2MandateError('ap2_mandate_signature_invalid', 'AP2 artifact must contain three compact JWS segments.')
  }
  const payload = parts[1] || detachedPayload
  if (!payload) {
    throw new Ap2MandateError('ap2_mandate_signature_invalid', 'AP2 JWS payload is missing.')
  }
  return {
    header: asRecord(decodeBase64UrlJson(parts[0])),
    claims: asRecord(decodeBase64UrlJson(payload)),
    protectedHeader: parts[0],
    payload,
    signature: Buffer.from(parts[2], 'base64url'),
    signingInput: `${parts[0]}.${payload}`,
    compact: value
  }
}

const rawEcdsaToDer = (signature: Buffer) => {
  const size = signature.length / 2
  if (![32, 48, 66].includes(size)) return signature
  const integer = (bytes: Buffer) => {
    let value = bytes
    while (value.length > 1 && value[0] === 0) value = value.subarray(1)
    if ((value[0]! & 0x80) !== 0) value = Buffer.concat([Buffer.from([0]), value])
    return Buffer.concat([Buffer.from([0x02, value.length]), value])
  }
  const r = integer(signature.subarray(0, size))
  const s = integer(signature.subarray(size))
  const body = Buffer.concat([r, s])
  return body.length < 128
    ? Buffer.concat([Buffer.from([0x30, body.length]), body])
    : Buffer.concat([Buffer.from([0x30, 0x81, body.length]), body])
}

const verifySignature = ({
  alg,
  key,
  signingInput,
  signature
}: {
  alg: string
  key: Record<string, unknown>
  signingInput: string
  signature: Buffer
}) => {
  if (!['ES256', 'ES384', 'ES512', 'RS256'].includes(alg)) {
    throw new Ap2MandateError('ap2_mandate_signature_invalid', `AP2 JWS algorithm ${alg} is not allowed.`)
  }
  const publicKey = createPublicKey({ key, format: 'jwk' })
  const verify = (candidate: Buffer) => {
    const verifier = createVerify(digestName(alg))
    verifier.update(signingInput, 'utf8')
    verifier.end()
    return verifier.verify(publicKey, candidate)
  }
  return verify(signature) || (alg.startsWith('ES') && verify(rawEcdsaToDer(signature)))
}

const findKey = (keys: Array<Record<string, unknown>>, kid: string | undefined) =>
  kid ? keys.find((key) => stringValue(key.kid) === kid) : undefined

const businessProfileSigningKeys = (businessProfile: UcpProfile) => {
  try {
    return resolveUcpProfileSigningKeys(businessProfile)
  } catch {
    return []
  }
}

const audienceValues = (value: unknown) =>
  typeof value === 'string' ? [value] : Array.isArray(value) ? value.flatMap((entry) => typeof entry === 'string' ? [entry] : []) : []

const audienceAllowed = (expected: string | string[] | undefined, actual: unknown) => {
  if (!expected) return true
  const expectedValues = Array.isArray(expected) ? expected : [expected]
  const actualValues = audienceValues(actual)
  return actualValues.some((entry) => expectedValues.includes(entry))
}

export const parseAp2TrustedIssuersJson = (value: string | undefined): Ap2TrustedIssuer[] => {
  const raw = value?.trim()
  if (!raw) return []
  const parsed = JSON.parse(raw) as unknown
  const entries = Array.isArray(parsed)
    ? parsed
    : Array.isArray(asRecord(parsed).issuers)
      ? asRecord(parsed).issuers as unknown[]
      : []
  return entries.flatMap((entry) => {
    const record = asRecord(entry)
    const issuer = stringValue(record.issuer)
    const keys = Array.isArray(record.keys)
      ? record.keys.map(asRecord).filter((key) => Object.keys(key).length > 0)
      : []
    if (!issuer || keys.length === 0) return []
    const audience = typeof record.audience === 'string' || Array.isArray(record.audience)
      ? record.audience as string | string[]
      : undefined
    return [{ issuer, ...(audience ? { audience } : {}), keys }]
  })
}

const verifyTemporalClaims = (claims: Record<string, unknown>, now: Date) => {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const iat = integerValue(claims.iat)
  const exp = integerValue(claims.exp)
  if (!iat || !exp || iat > nowSeconds + 60 || exp <= nowSeconds || exp <= iat) {
    throw new Ap2MandateError('ap2_mandate_expired', 'AP2 mandate is expired or outside the accepted validity window.')
  }
}

const verifyIssuerJws = (
  issuerJws: ParsedJws,
  trustedIssuers: Ap2TrustedIssuer[],
  now: Date
) => {
  const issuerId = stringValue(issuerJws.claims.iss)
  const kid = stringValue(issuerJws.header.kid)
  const alg = stringValue(issuerJws.header.alg)
  const trusted = trustedIssuers.find((candidate) => candidate.issuer === issuerId)
  const key = findKey(trusted?.keys ?? [], kid)
  if (!trusted || !key || !alg || !verifySignature({
    alg,
    key,
    signingInput: issuerJws.signingInput,
    signature: issuerJws.signature
  })) {
    throw new Ap2MandateError('ap2_mandate_signature_invalid', 'AP2 issuer signature could not be verified against trusted configuration.')
  }
  verifyTemporalClaims(issuerJws.claims, now)
  if (issuerJws.claims.aud !== undefined && !audienceAllowed(trusted.audience, issuerJws.claims.aud)) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 issuer audience is not trusted for this runtime.')
  }
  return trusted
}

type Disclosure = {
  digest: string
  key?: string
  value: unknown
}

const resolveDisclosures = (
  payload: Record<string, unknown>,
  encodedDisclosures: string[]
) => {
  const hashAlg = stringValue(payload._sd_alg) ?? 'sha-256'
  if (hashAlg !== 'sha-256') {
    throw new Ap2MandateError('ap2_mandate_signature_invalid', 'AP2 v0.2 SD-JWT disclosures must use sha-256.')
  }
  const disclosures = new Map<string, Disclosure>()
  for (const encoded of encodedDisclosures) {
    const decoded = decodeBase64UrlJson(encoded)
    if (!Array.isArray(decoded) || (decoded.length !== 2 && decoded.length !== 3)) {
      throw new Ap2MandateError('ap2_mandate_signature_invalid', 'AP2 SD-JWT disclosure has an invalid shape.')
    }
    const key = decoded.length === 3 && typeof decoded[1] === 'string' ? decoded[1] : undefined
    disclosures.set(hashBase64Url(encoded, hashAlg), {
      digest: hashBase64Url(encoded, hashAlg),
      ...(key ? { key } : {}),
      value: decoded.length === 3 ? decoded[2] : decoded[1]
    })
  }
  const used = new Set<string>()
  const apply = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map((entry) => {
        const placeholder = asRecord(entry)
        const digest = stringValue(placeholder['...'])
        if (!digest) return apply(entry)
        const disclosure = disclosures.get(digest)
        if (!disclosure || disclosure.key) {
          throw new Ap2MandateError('ap2_mandate_signature_invalid', 'AP2 SD-JWT array disclosure is missing or invalid.')
        }
        used.add(digest)
        return apply(disclosure.value)
      })
    }
    if (!value || typeof value !== 'object') return value
    const record = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(record)) {
      if (key === '_sd' || key === '_sd_alg') continue
      output[key] = apply(entry)
    }
    const digests = Array.isArray(record._sd) ? record._sd.flatMap((entry) => typeof entry === 'string' ? [entry] : []) : []
    for (const digest of digests) {
      const disclosure = disclosures.get(digest)
      if (!disclosure?.key) continue
      if (Object.hasOwn(output, disclosure.key)) {
        throw new Ap2MandateError('ap2_mandate_signature_invalid', 'AP2 SD-JWT disclosure attempts to overwrite an existing claim.')
      }
      used.add(digest)
      output[disclosure.key] = apply(disclosure.value)
    }
    return output
  }
  const reconstructed = asRecord(apply(payload))
  if ([...disclosures.keys()].some((digest) => !used.has(digest))) {
    throw new Ap2MandateError('ap2_mandate_signature_invalid', 'AP2 SD-JWT contains an unbound disclosure.')
  }
  return reconstructed
}

const cnfKeyFrom = (payload: Record<string, unknown>) => {
  const direct = asRecord(asRecord(payload.cnf).jwk)
  if (Object.keys(direct).length > 0) return direct
  const queue: unknown[] = [payload]
  while (queue.length > 0) {
    const value = queue.shift()
    if (Array.isArray(value)) {
      queue.push(...value)
      continue
    }
    const record = asRecord(value)
    const key = asRecord(asRecord(record.cnf).jwk)
    if (Object.keys(key).length > 0) return key
    queue.push(...Object.values(record))
  }
  return undefined
}

const parseSdJwtParts = (token: string) => {
  const parts = token.split('~')
  const issuerToken = parts.shift()
  if (!issuerToken) throw new Ap2MandateError('ap2_mandate_signature_invalid', 'AP2 SD-JWT is empty.')
  const disclosures = parts.filter(Boolean)
  if (disclosures.some((part) => part.split('.').length === 3)) {
    throw new Ap2MandateError(
      'ap2_mandate_key_binding_invalid',
      'AP2 v0.2 delegation uses a kb+sd-jwt chain hop, not a trailing key-binding JWT.'
    )
  }
  return {
    issuerToken,
    disclosures,
    canonical: `${[issuerToken, ...disclosures].join('~')}~`
  }
}

const parseRootSdJwt = (
  token: string,
  trustedIssuers: Ap2TrustedIssuer[],
  now: Date
): ParsedSdJwt => {
  const { issuerToken, disclosures, canonical } = parseSdJwtParts(token)
  const issuerJws = parseCompactJws(issuerToken)
  const issuer = verifyIssuerJws(issuerJws, trustedIssuers, now)
  return {
    reconstructed: resolveDisclosures(issuerJws.claims, disclosures),
    issuer,
    issuerJws,
    canonical,
    disclosures
  }
}

const effectivePayloads = (payload: Record<string, unknown>) => {
  const delegatePayload = payload.delegate_payload
  if (!Array.isArray(delegatePayload)) return [payload]
  const records = delegatePayload.map(asRecord).filter((entry) => Object.keys(entry).length > 0)
  return records.length > 0 ? records : [payload]
}

const parseDelegatedSdJwt = ({
  token,
  previous,
  expectedAudience,
  expectedNonce,
  now
}: {
  token: string
  previous: ParsedSdJwt
  expectedAudience: string
  expectedNonce: string
  now: Date
}): ParsedSdJwt => {
  const { issuerToken, disclosures, canonical } = parseSdJwtParts(token)
  const issuerJws = parseCompactJws(issuerToken)
  const typ = stringValue(issuerJws.header.typ)
  if (typ !== 'kb+sd-jwt' && typ !== 'kb-sd-jwt') {
    throw new Ap2MandateError(
      'ap2_mandate_key_binding_invalid',
      'The terminal AP2 delegation hop must use the kb+sd-jwt type.'
    )
  }
  const previousKey = cnfKeyFrom(previous.reconstructed)
  const alg = stringValue(issuerJws.header.alg)
  if (!previousKey || !alg || !verifySignature({
    alg,
    key: previousKey,
    signingInput: issuerJws.signingInput,
    signature: issuerJws.signature
  })) {
    throw new Ap2MandateError(
      'ap2_mandate_key_binding_invalid',
      'The terminal AP2 delegation hop was not signed by the open mandate cnf key.'
    )
  }
  const claims = resolveDisclosures(issuerJws.claims, disclosures)
  const hasSdHash = claims.sd_hash !== undefined
  const hasIssuerHash = claims.issuer_jwt_hash !== undefined
  if (hasSdHash === hasIssuerHash) {
    throw new Ap2MandateError(
      'ap2_mandate_key_binding_invalid',
      'An AP2 delegation hop must contain exactly one of sd_hash or issuer_jwt_hash.'
    )
  }
  const expectedBinding = hasSdHash
    ? hashBase64Url(previous.canonical, stringValue(previous.issuerJws.claims._sd_alg) ?? 'sha-256')
    : hashBase64Url(previous.issuerJws.compact, stringValue(previous.issuerJws.claims._sd_alg) ?? 'sha-256')
  const actualBinding = stringValue(hasSdHash ? claims.sd_hash : claims.issuer_jwt_hash)
  if (actualBinding !== expectedBinding) {
    throw new Ap2MandateError('ap2_mandate_key_binding_invalid', 'AP2 delegation binding does not match the preceding mandate hop.')
  }
  const iat = integerValue(claims.iat)
  if (!iat || Math.abs(Math.floor(now.getTime() / 1000) - iat) > 300) {
    throw new Ap2MandateError('ap2_mandate_key_binding_invalid', 'AP2 delegation requires a fresh iat claim.')
  }
  if (!audienceValues(claims.aud).includes(expectedAudience) || stringValue(claims.nonce) !== expectedNonce) {
    throw new Ap2MandateError('ap2_mandate_key_binding_invalid', 'AP2 delegation audience or verifier nonce does not match this Checkout session.')
  }
  if (cnfKeyFrom(claims)) {
    throw new Ap2MandateError('ap2_mandate_key_binding_invalid', 'A terminal AP2 kb+sd-jwt hop must not delegate another cnf key.')
  }
  return {
    reconstructed: claims,
    issuer: previous.issuer,
    issuerJws,
    canonical,
    disclosures
  }
}

const parseAp2Chain = ({
  token,
  trustedIssuers,
  expectedAudience,
  expectedNonce,
  now
}: {
  token: string
  trustedIssuers: Ap2TrustedIssuer[]
  expectedAudience: string
  expectedNonce: string
  now: Date
}): ParsedAp2Chain => {
  const segments = token.split('~~')
  if (segments.length > 2 || segments.some((segment) => !segment)) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 v0.2 typed mandate chains require one root or exactly one open and one closed hop.')
  }
  const root = parseRootSdJwt(segments[0]!, trustedIssuers, now)
  const rootPayloads = effectivePayloads(root.reconstructed)
  if (segments.length === 1) {
    return { root, terminal: root, payloads: rootPayloads, delegated: false }
  }
  const terminal = parseDelegatedSdJwt({
    token: segments[1]!,
    previous: root,
    expectedAudience,
    expectedNonce,
    now
  })
  return {
    root,
    terminal,
    payloads: [...rootPayloads, ...effectivePayloads(terminal.reconstructed)],
    delegated: true
  }
}

const collectMandates = (payload: Record<string, unknown>) => {
  const mandates: Record<string, Record<string, unknown>> = {}
  const queue: unknown[] = [payload]
  const seen = new Set<object>()
  while (queue.length > 0) {
    const value = queue.shift()
    if (Array.isArray(value)) {
      queue.push(...value)
      continue
    }
    if (!value || typeof value !== 'object' || seen.has(value)) continue
    seen.add(value)
    const record = value as Record<string, unknown>
    const vct = stringValue(record.vct)
    if (vct?.startsWith('mandate.')) mandates[vct] = record
    queue.push(...Object.values(record))
  }
  return mandates
}

const mandatesFromChain = (chain: ParsedAp2Chain) => {
  const mandates: Record<string, Record<string, unknown>> = {}
  for (const payload of chain.payloads) Object.assign(mandates, collectMandates(payload))
  return mandates
}

const recordArray = (value: unknown) => Array.isArray(value) ? value.map(asRecord) : []

const originFromMaybeUrl = (value: unknown) => {
  const url = stringValue(value)
  if (!url) return undefined
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}

const merchantMatches = (
  candidate: Record<string, unknown>,
  merchantOrigin: string
) => {
  const candidateOrigin = originFromMaybeUrl(candidate.website) ?? originFromMaybeUrl(candidate.url)
  return candidateOrigin === merchantOrigin || stringValue(candidate.id) === merchantOrigin
}

const verifyOpenCheckoutConstraints = ({
  openMandate,
  checkout,
  merchantOrigin
}: {
  openMandate: Record<string, unknown>
  checkout: UcpCheckout
  merchantOrigin: string
}) => {
  const constraints = recordArray(openMandate.constraints)
  if (!constraints.some((constraint) => stringValue(constraint.type) === 'checkout.line_items')) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Open Checkout Mandate requires a checkout.line_items constraint.')
  }
  for (const constraint of constraints) {
    const type = stringValue(constraint.type)
    if (type === 'checkout.allowed_merchants') {
      const allowed = recordArray(constraint.allowed)
      if (!allowed.some((candidate) => merchantMatches(candidate, merchantOrigin))) {
        throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Current merchant is outside the Open Checkout Mandate allowlist.')
      }
      continue
    }
    if (type === 'checkout.line_items') {
      const requirements = recordArray(constraint.items)
      if (requirements.length === 0) {
        throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Open Checkout Mandate line-item constraints cannot be empty.')
      }
      const checkoutItems = checkout.line_items.map((lineItem) => ({
        id: lineItem.item.id,
        quantity: lineItem.quantity
      }))
      const used = new Set<number>()
      for (const requirement of requirements) {
        const acceptableIds = new Set(recordArray(requirement.acceptable_items).flatMap((item) => stringValue(item.id) ? [stringValue(item.id)!] : []))
        const requiredQuantity = integerValue(requirement.quantity)
        const matchIndex = checkoutItems.findIndex((item, index) => !used.has(index) && acceptableIds.has(item.id) && item.quantity === requiredQuantity)
        if (matchIndex < 0) {
          throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Current Checkout items do not satisfy the Open Checkout Mandate line-item constraints.')
        }
        used.add(matchIndex)
      }
      continue
    }
    throw new Ap2MandateError('ap2_mandate_scope_invalid', `Unsupported Open Checkout Mandate constraint: ${type ?? 'missing_type'}.`)
  }
}

const recordsEqual = (left: unknown, right: unknown) =>
  jcsCanonicalize(left) === jcsCanonicalize(right)

const verifyOpenPaymentConstraints = ({
  openMandate,
  closedMandate,
  openCheckoutReference,
  merchantOrigin,
  mandateContext,
  now
}: {
  openMandate: Record<string, unknown>
  closedMandate: Record<string, unknown>
  openCheckoutReference: string
  merchantOrigin: string
  mandateContext?: Ap2MandateVerificationInput['mandateContext']
  now: Date
}) => {
  for (const field of ['payee', 'payment_amount', 'payment_instrument', 'pisp', 'execution_date'] as const) {
    if (openMandate[field] !== undefined && !recordsEqual(openMandate[field], closedMandate[field])) {
      throw new Ap2MandateError('ap2_mandate_scope_invalid', `Closed Payment Mandate changed the pre-authorized ${field} value.`)
    }
  }
  const constraints = recordArray(openMandate.constraints)
  if (!constraints.some((constraint) => stringValue(constraint.type) === 'payment.reference')) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Open Payment Mandate requires a payment.reference constraint.')
  }
  const amount = asRecord(closedMandate.payment_amount)
  const amountMinor = integerValue(amount.amount)
  const currency = stringValue(amount.currency)
  for (const constraint of constraints) {
    const type = stringValue(constraint.type)
    if (type === 'payment.reference') {
      if (stringValue(constraint.conditional_transaction_id) !== openCheckoutReference) {
        throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Open Payment Mandate is not bound to the Open Checkout Mandate.')
      }
      continue
    }
    if (type === 'payment.allowed_payees') {
      if (!recordArray(constraint.allowed).some((candidate) => merchantMatches(candidate, merchantOrigin))) {
        throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Current payee is outside the Open Payment Mandate allowlist.')
      }
      continue
    }
    if (type === 'payment.allowed_payment_instruments') {
      const current = asRecord(closedMandate.payment_instrument)
      if (!recordArray(constraint.allowed).some((candidate) => stringValue(candidate.id) === stringValue(current.id))) {
        throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Selected payment instrument is outside the Open Payment Mandate allowlist.')
      }
      continue
    }
    if (type === 'payment.allowed_pisps') {
      const current = asRecord(closedMandate.pisp)
      if (!recordArray(constraint.allowed).some((candidate) => recordsEqual(candidate, current))) {
        throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Selected PISP is outside the Open Payment Mandate allowlist.')
      }
      continue
    }
    if (type === 'payment.amount_range') {
      if (currency !== stringValue(constraint.currency) || amountMinor === undefined) {
        throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Payment amount currency does not satisfy the Open Payment Mandate.')
      }
      const minimum = integerValue(constraint.min)
      const maximum = integerValue(constraint.max)
      if ((minimum !== undefined && amountMinor < minimum) || maximum === undefined || amountMinor > maximum) {
        throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Payment amount is outside the Open Payment Mandate range.')
      }
      continue
    }
    if (type === 'payment.budget') {
      const maxMajor = typeof constraint.max === 'number' && Number.isFinite(constraint.max) ? constraint.max : undefined
      if (!mandateContext || amountMinor === undefined || currency !== stringValue(constraint.currency) || maxMajor === undefined) {
        throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Payment budget evaluation requires matching currency and durable usage context.')
      }
      const budgetMinorNumber = Math.round(maxMajor * 100)
      if (!Number.isSafeInteger(budgetMinorNumber)) {
        throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Open Payment Mandate budget exceeds exact minor-unit evaluation range.')
      }
      const budgetMinor = BigInt(budgetMinorNumber)
      if (BigInt(mandateContext.totalAmountMinor) + BigInt(amountMinor) > budgetMinor) {
        throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Payment would exceed the Open Payment Mandate budget.')
      }
      continue
    }
    if (type === 'payment.agent_recurrence') {
      const maxOccurrences = integerValue(constraint.max_occurrences)
      if (!mandateContext || (maxOccurrences !== undefined && mandateContext.totalUses >= maxOccurrences)) {
        throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Payment recurrence limit is exhausted or cannot be evaluated durably.')
      }
      if (!constraints.some((candidate) => stringValue(candidate.type) === 'payment.amount_range') ||
          !constraints.some((candidate) => stringValue(candidate.type) === 'payment.budget')) {
        throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Recurring Open Payment Mandates require amount_range and budget constraints.')
      }
      continue
    }
    if (type === 'payment.execution_date') {
      const execution = stringValue(closedMandate.execution_date) ?? now.toISOString()
      const notBefore = stringValue(constraint.not_before)
      const notAfter = stringValue(constraint.not_after)
      if ((notBefore && execution < notBefore) || (notAfter && execution > notAfter)) {
        throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Payment execution date is outside the Open Payment Mandate window.')
      }
      continue
    }
    throw new Ap2MandateError('ap2_mandate_scope_invalid', `Unsupported Open Payment Mandate constraint: ${type ?? 'missing_type'}.`)
  }
}

const verifyMerchantCheckoutJwt = ({
  checkoutJwt,
  businessProfile
}: {
  checkoutJwt: string
  businessProfile: UcpProfile
}) => {
  const parsed = parseCompactJws(checkoutJwt)
  const alg = stringValue(parsed.header.alg)
  const kid = stringValue(parsed.header.kid)
  const key = findKey(businessProfileSigningKeys(businessProfile), kid)
  if (!alg?.startsWith('ES') || !key || !verifySignature({ alg, key, signingInput: parsed.signingInput, signature: parsed.signature })) {
    throw new Ap2MandateError('ap2_mandate_merchant_authorization_invalid', 'AP2 Checkout JWT was not signed by the current merchant key.')
  }
  return parsed.claims
}

const checkoutWithoutAp2 = (checkout: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(checkout).filter(([key]) => key !== 'ap2'))

const verifyDetachedMerchantAuthorization = ({
  checkout,
  businessProfile
}: {
  checkout: Record<string, unknown>
  businessProfile: UcpProfile
}) => {
  const merchantAuthorization = stringValue(asRecord(checkout.ap2).merchant_authorization)
  if (!merchantAuthorization) {
    throw new Ap2MandateError('ap2_mandate_merchant_authorization_invalid', 'AP2 Checkout is missing ap2.merchant_authorization.')
  }
  const [protectedHeader, emptyPayload, signatureValue] = merchantAuthorization.split('.')
  if (!protectedHeader || emptyPayload !== '' || !signatureValue) {
    throw new Ap2MandateError('ap2_mandate_merchant_authorization_invalid', 'AP2 merchant authorization must be a detached JWS.')
  }
  const header = asRecord(decodeBase64UrlJson(protectedHeader))
  const alg = stringValue(header.alg)
  const kid = stringValue(header.kid)
  const key = findKey(businessProfileSigningKeys(businessProfile), kid)
  if (!alg || !['ES256', 'ES384', 'ES512'].includes(alg) || !key) {
    throw new Ap2MandateError('ap2_mandate_merchant_authorization_invalid', 'AP2 merchant authorization header is not allowed by the merchant profile.')
  }
  const payload = Buffer.from(jcsCanonicalize(checkoutWithoutAp2(checkout)), 'utf8').toString('base64url')
  if (!verifySignature({
    alg,
    key,
    signingInput: `${protectedHeader}.${payload}`,
    signature: Buffer.from(signatureValue, 'base64url')
  })) {
    throw new Ap2MandateError('ap2_mandate_merchant_authorization_invalid', 'AP2 detached merchant authorization does not verify over the embedded Checkout.')
  }
}

const paymentAmount = (checkout: UcpCheckout) =>
  checkout.totals.find((entry) => entry.type === 'total')?.amount

const verifyPaymentMandateScope = ({
  mandate,
  checkoutHash,
  checkout,
  merchantOrigin,
  paymentInstrument
}: {
  mandate: Record<string, unknown>
  checkoutHash: string
  checkout: UcpCheckout
  merchantOrigin: string
  paymentInstrument: UcpPaymentInstrument
}) => {
  if (stringValue(mandate.transaction_id) !== checkoutHash) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 Payment Mandate is not bound to the merchant Checkout JWT.')
  }
  const amount = asRecord(mandate.payment_amount)
  if (stringValue(amount.currency) !== checkout.currency || integerValue(amount.amount) !== paymentAmount(checkout)) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 Payment Mandate amount or currency does not match current merchant terms.')
  }
  const payee = asRecord(mandate.payee)
  const payeeWebsite = stringValue(payee.website) ?? stringValue(payee.url)
  if (!payeeWebsite || originFromMaybeUrl(payeeWebsite) !== merchantOrigin) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 Payment Mandate payee does not match the current merchant.')
  }
  const instrument = asRecord(mandate.payment_instrument)
  if (
    (stringValue(instrument.id) && stringValue(instrument.id) !== paymentInstrument.id) ||
    (stringValue(instrument.type) && stringValue(instrument.type) !== paymentInstrument.type)
  ) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 Payment Mandate instrument does not match the selected UCP instrument.')
  }
}

export const verifyAp2Mandate = async ({
  checkoutMandate,
  paymentMandate,
  paymentInstrument,
  checkout,
  businessProfile,
  merchantOrigin,
  transactionId,
  checkoutId,
  checkoutSnapshotHash,
  trustedIssuers,
  store,
  expectedAudience = merchantOrigin,
  expectedNonce = checkoutId,
  mandateContext,
  authorityContext,
  now = new Date()
}: Ap2MandateVerificationInput) => {
  if (trustedIssuers.length === 0) {
    throw new Ap2MandateError('ap2_mandate_config_missing', 'AP2 trusted issuer configuration is required.')
  }
  const checkoutChain = parseAp2Chain({
    token: checkoutMandate,
    trustedIssuers,
    expectedAudience,
    expectedNonce,
    now
  })
  const paymentChain = parseAp2Chain({
    token: paymentMandate,
    trustedIssuers,
    expectedAudience,
    expectedNonce,
    now
  })
  const checkoutMandates = mandatesFromChain(checkoutChain)
  const paymentMandates = mandatesFromChain(paymentChain)
  const checkoutClaims = checkoutMandates['mandate.checkout.1']
  const paymentClaims = paymentMandates['mandate.payment.1']
  if (!checkoutClaims || !paymentClaims) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 completion requires closed mandate.checkout.1 and mandate.payment.1 artifacts.')
  }
  const openCheckoutClaims = checkoutMandates['mandate.checkout.open.1']
  const openPaymentClaims = paymentMandates['mandate.payment.open.1']
  if (checkoutChain.delegated !== paymentChain.delegated) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Checkout and Payment Mandates must use the same human-present or delegated authority mode.')
  }
  if (checkoutChain.delegated && (!openCheckoutClaims || !openPaymentClaims)) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Autonomous AP2 completion requires open and closed Checkout and Payment Mandate chains.')
  }
  if (!checkoutChain.delegated && (openCheckoutClaims || openPaymentClaims)) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Open AP2 mandates cannot authorize completion without a terminal closed delegation hop.')
  }
  verifyTemporalClaims(checkoutClaims, now)
  verifyTemporalClaims(paymentClaims, now)
  const checkoutJwt = stringValue(checkoutClaims.checkout_jwt)
  if (!checkoutJwt) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 Checkout Mandate is missing checkout_jwt.')
  }
  const checkoutHash = hashBase64Url(checkoutJwt, stringValue(checkoutClaims._sd_alg) ?? 'sha-256')
  if (stringValue(checkoutClaims.checkout_hash) !== checkoutHash) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 Checkout Mandate checkout_hash does not match checkout_jwt.')
  }
  const embeddedCheckout = verifyMerchantCheckoutJwt({ checkoutJwt, businessProfile })
  if (jcsCanonicalize(embeddedCheckout) !== jcsCanonicalize(checkout)) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 embedded Checkout terms do not match current merchant state.')
  }
  if (stringValue(embeddedCheckout.id) !== checkoutId || stringValue(embeddedCheckout.id) !== checkout.id) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 embedded Checkout ID does not match the active session.')
  }
  verifyDetachedMerchantAuthorization({ checkout: embeddedCheckout, businessProfile })
  if (openCheckoutClaims && openPaymentClaims) {
    verifyTemporalClaims(openCheckoutClaims, now)
    verifyTemporalClaims(openPaymentClaims, now)
    const openCheckoutReference = hashBase64Url(checkoutChain.root.canonical)
    const openPaymentReference = hashBase64Url(paymentChain.root.canonical)
    if (
      mandateContext?.expectedOpenCheckoutReference !== openCheckoutReference ||
      mandateContext.expectedOpenPaymentReference !== openPaymentReference
    ) {
      throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Closed AP2 mandates do not descend from the exact standing authority bound to this Purchase Mandate.')
    }
    verifyOpenCheckoutConstraints({
      openMandate: openCheckoutClaims,
      checkout,
      merchantOrigin
    })
    verifyOpenPaymentConstraints({
      openMandate: openPaymentClaims,
      closedMandate: paymentClaims,
      openCheckoutReference,
      merchantOrigin,
      mandateContext,
      now
    })
  }
  verifyPaymentMandateScope({
    mandate: paymentClaims,
    checkoutHash,
    checkout,
    merchantOrigin,
    paymentInstrument
  })
  const checkoutJti = stringValue(checkoutClaims.jti) ?? stringValue(checkoutChain.terminal.issuerJws.claims.jti)
  const paymentJti = stringValue(paymentClaims.jti) ?? stringValue(paymentChain.terminal.issuerJws.claims.jti)
  if (!checkoutJti || !paymentJti) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 closed mandates require durable jti identifiers.')
  }
  const expiry = Math.min(integerValue(checkoutClaims.exp)!, integerValue(paymentClaims.exp)!)
  const combinedHash = hashReference(`${checkoutMandate}\n${paymentMandate}`)
  const claim = await store.claimAp2Mandate({
    mandateHash: combinedHash,
    mandateId: `${checkoutJti}:${paymentJti}`,
    transactionId,
    checkoutId,
    expiresAt: new Date(expiry * 1000).toISOString()
  })
  if (claim === 'replay') {
    throw new Ap2MandateError('ap2_mandate_replay', 'AP2 closed mandate authority has already been consumed.')
  }
  const authorityMode = checkoutChain.delegated ? 'human_not_present' as const : 'human_present' as const
  const checkoutReceiptReference = hashBase64Url(checkoutChain.terminal.issuerJws.compact)
  const paymentReceiptReference = hashBase64Url(paymentChain.terminal.issuerJws.compact)
  const currentAmount = paymentAmount(checkout)
  if (authorityContext && currentAmount !== undefined) {
    const agentKey = cnfKeyFrom(checkoutChain.root.reconstructed)
    await store.recordAp2Authority({
      authorityId: `ap2a_${hashBase64Url(`${checkoutJti}:${paymentJti}`).slice(0, 40)}`,
      transactionId,
      ...(authorityContext.ownerKeyId ? { ownerKeyId: authorityContext.ownerKeyId } : {}),
      ...(authorityContext.ownerPrincipalHash ? { ownerPrincipalHash: authorityContext.ownerPrincipalHash } : {}),
      integrationId: authorityContext.integrationId,
      ...(authorityContext.agentSessionId ? { agentSessionId: authorityContext.agentSessionId } : {}),
      ...(authorityContext.canonicalMandateId ? { canonicalMandateId: authorityContext.canonicalMandateId } : {}),
      ...(authorityContext.canonicalMandateVersion !== undefined ? { canonicalMandateVersion: authorityContext.canonicalMandateVersion } : {}),
      merchantOrigin,
      checkoutId,
      checkoutSnapshotHash,
      amountMinor: currentAmount,
      currency: checkout.currency,
      authorityMode,
      checkoutMandateId: checkoutJti,
      paymentMandateId: paymentJti,
      checkoutReceiptReference,
      paymentReceiptReference,
      ...(agentKey ? { agentKeyThumbprint: hashReference(jcsCanonicalize(agentKey)) } : {}),
      expiresAt: new Date(expiry * 1000).toISOString()
    })
  }
  return {
    checkoutMandateId: checkoutJti,
    paymentMandateId: paymentJti,
    authorityMode,
    checkoutHash,
    checkoutReceiptReference,
    paymentReceiptReference,
    replayRecovered: claim === 'recovered',
    checkoutSnapshotHash,
    merchantOrigin
  }
}

export type Ap2OpenMandateAuthorizationResult = {
  issuer: string
  checkoutMandateReference: string
  paymentMandateReference: string
  agentKey: Record<string, unknown>
}

const exactConstraint = (
  constraints: Record<string, unknown>[],
  type: string
) => constraints.filter((constraint) => stringValue(constraint.type) === type)

export const verifyAp2OpenMandateAuthorization = ({
  checkoutMandate,
  paymentMandate,
  mandate,
  trustedIssuers,
  now = new Date()
}: {
  checkoutMandate: string
  paymentMandate: string
  mandate: PurchaseMandate
  trustedIssuers: Ap2TrustedIssuer[]
  now?: Date
}): Ap2OpenMandateAuthorizationResult => {
  if (trustedIssuers.length === 0) {
    throw new Ap2MandateError('ap2_mandate_config_missing', 'AP2 trusted issuer configuration is required.')
  }
  if (checkoutMandate.includes('~~') || paymentMandate.includes('~~')) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Standing authorization requires open root mandates, not already-closed delegation chains.')
  }
  const checkoutRoot = parseRootSdJwt(checkoutMandate, trustedIssuers, now)
  const paymentRoot = parseRootSdJwt(paymentMandate, trustedIssuers, now)
  const openCheckout = collectMandates(checkoutRoot.reconstructed)['mandate.checkout.open.1']
  const openPayment = collectMandates(paymentRoot.reconstructed)['mandate.payment.open.1']
  if (!openCheckout || !openPayment) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'Standing AP2 authorization requires open Checkout and Payment Mandates.')
  }
  verifyTemporalClaims(openCheckout, now)
  verifyTemporalClaims(openPayment, now)
  const openValidFrom = Math.max(integerValue(openCheckout.iat)!, integerValue(openPayment.iat)!) * 1000
  const openExpiresAt = Math.min(integerValue(openCheckout.exp)!, integerValue(openPayment.exp)!) * 1000
  if (new Date(mandate.validFrom).getTime() < openValidFrom - 60_000 ||
      new Date(mandate.expiresAt).getTime() > openExpiresAt) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 open mandate validity does not cover the canonical Arro Purchase Mandate window.')
  }
  const checkoutAgentKey = cnfKeyFrom(openCheckout)
  const paymentAgentKey = cnfKeyFrom(openPayment)
  if (!checkoutAgentKey || !paymentAgentKey || !recordsEqual(checkoutAgentKey, paymentAgentKey)) {
    throw new Ap2MandateError('ap2_mandate_key_binding_invalid', 'AP2 open Checkout and Payment Mandates must bind the same agent key.')
  }

  const checkoutConstraints = recordArray(openCheckout.constraints)
  const allowedMerchantConstraints = exactConstraint(checkoutConstraints, 'checkout.allowed_merchants')
  const canonicalMerchant = mandate.merchantPolicy.allowedMerchantOrigins ?? []
  if (canonicalMerchant.length !== 1 || allowedMerchantConstraints.length !== 1 ||
      !recordArray(allowedMerchantConstraints[0]!.allowed).some((candidate) => merchantMatches(candidate, canonicalMerchant[0]!))) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 open Checkout merchant scope does not authorize the canonical Purchase Mandate merchant.')
  }
  const lineItemConstraints = exactConstraint(checkoutConstraints, 'checkout.line_items')
  const authorizedItems = new Set([
    ...(mandate.intent.productIds ?? []),
    ...(mandate.intent.allowedVariants ?? [])
  ])
  if (authorizedItems.size === 0 || lineItemConstraints.length !== 1) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 standing authorization requires an exact product or variant constraint.')
  }
  const requirements = recordArray(lineItemConstraints[0]!.items)
  const intendedQuantity = mandate.intent.intendedQuantity ?? 1
  if (requirements.length !== 1 || integerValue(requirements[0]!.quantity) !== intendedQuantity ||
      !recordArray(requirements[0]!.acceptable_items).some((item) => {
        const id = stringValue(item.id)
        return id ? authorizedItems.has(id) : false
      })) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 open Checkout item or quantity scope does not match the canonical Purchase Mandate.')
  }

  const paymentConstraints = recordArray(openPayment.constraints)
  const referenceConstraints = exactConstraint(paymentConstraints, 'payment.reference')
  const checkoutReference = hashBase64Url(checkoutRoot.canonical)
  if (referenceConstraints.length !== 1 || stringValue(referenceConstraints[0]!.conditional_transaction_id) !== checkoutReference) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 open Payment Mandate is not bound to the open Checkout Mandate.')
  }
  const amountRanges = exactConstraint(paymentConstraints, 'payment.amount_range')
  if (amountRanges.length !== 1 ||
      stringValue(amountRanges[0]!.currency) !== mandate.financialPolicy.currency ||
      String(integerValue(amountRanges[0]!.max)) !== mandate.financialPolicy.maximumPerTransactionMinor) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 payment amount range does not match the canonical per-transaction limit.')
  }
  const budgets = exactConstraint(paymentConstraints, 'payment.budget')
  const budgetMajor = budgets.length === 1 && typeof budgets[0]!.max === 'number' ? budgets[0]!.max : undefined
  if (budgetMajor === undefined || stringValue(budgets[0]!.currency) !== mandate.financialPolicy.currency ||
      BigInt(Math.round(budgetMajor * 100)) !== BigInt(mandate.financialPolicy.maximumTotalSpendMinor)) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 payment budget does not match the canonical cumulative spend limit.')
  }
  const recurrences = exactConstraint(paymentConstraints, 'payment.agent_recurrence')
  if (recurrences.length !== 1 || integerValue(recurrences[0]!.max_occurrences) !== mandate.financialPolicy.useLimit) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 payment recurrence does not match the canonical use limit.')
  }
  const allowedPayees = exactConstraint(paymentConstraints, 'payment.allowed_payees')
  const presetPayee = asRecord(openPayment.payee)
  const payeeAuthorized = merchantMatches(presetPayee, canonicalMerchant[0]!) ||
    allowedPayees.some((constraint) => recordArray(constraint.allowed).some((candidate) => merchantMatches(candidate, canonicalMerchant[0]!)))
  if (!payeeAuthorized) {
    throw new Ap2MandateError('ap2_mandate_scope_invalid', 'AP2 open Payment Mandate does not authorize the canonical merchant as payee.')
  }
  return {
    issuer: checkoutRoot.issuer.issuer,
    checkoutMandateReference: checkoutReference,
    paymentMandateReference: hashBase64Url(paymentRoot.canonical),
    agentKey: checkoutAgentKey
  }
}
