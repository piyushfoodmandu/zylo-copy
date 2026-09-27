import { createHash, createPublicKey, createVerify } from 'node:crypto'
import type { Ap2TrustedIssuer } from './ap2-mandate.ts'
import type { UcpCheckoutStore } from './ucp-checkout-store.ts'

export type Ap2ReceiptKind = 'checkout' | 'payment'

export type VerifiedAp2Receipt = {
  kind: Ap2ReceiptKind
  status: 'Success' | 'Error'
  issuer: string
  issuedAt: string
  reference: string
  orderId?: string
  paymentId?: string
  pspConfirmationId?: string
  networkConfirmationId?: string
  error?: string
  errorDescription?: string
}

export class Ap2ReceiptError extends Error {
  readonly code:
    | 'ap2_receipt_invalid'
    | 'ap2_receipt_untrusted'
    | 'ap2_receipt_reference_mismatch'
    | 'ap2_receipt_conflict'

  constructor(code: Ap2ReceiptError['code'], message: string) {
    super(message)
    this.name = 'Ap2ReceiptError'
    this.code = code
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const stringValue = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined
const integerValue = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined

const decode = (value: string) => {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
  } catch {
    throw new Ap2ReceiptError('ap2_receipt_invalid', 'AP2 receipt must be compact JWT with JSON header and payload.')
  }
}

const parseJwt = (jwt: string) => {
  const parts = jwt.trim().split('.')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new Ap2ReceiptError('ap2_receipt_invalid', 'AP2 receipt must be a three-part compact JWT.')
  }
  return {
    header: asRecord(decode(parts[0])),
    claims: asRecord(decode(parts[1])),
    signingInput: `${parts[0]}.${parts[1]}`,
    signature: Buffer.from(parts[2], 'base64url')
  }
}

const verifySignature = ({
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
  const hash = alg === 'ES256' ? 'sha256' : alg === 'ES384' ? 'sha384' : alg === 'ES512' ? 'sha512' : undefined
  if (!hash) throw new Ap2ReceiptError('ap2_receipt_invalid', 'AP2 receipt must use ES256, ES384, or ES512.')
  const verifier = createVerify(hash)
  verifier.update(signingInput)
  verifier.end()
  return verifier.verify({
    key: createPublicKey({ key: jwk, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363'
  }, signature)
}

const assertNoCredentialMaterial = (claims: Record<string, unknown>) => {
  const serializedKeys = JSON.stringify(claims).toLowerCase()
  for (const forbidden of ['card_number', 'pan', 'cvv', 'cvc', 'cryptogram', 'payment_token', 'private_key']) {
    if (serializedKeys.includes(`"${forbidden}"`)) {
      throw new Ap2ReceiptError('ap2_receipt_invalid', 'AP2 receipts cannot contain payment credential material.')
    }
  }
}

const parseReceiptClaims = ({
  kind,
  claims,
  now
}: {
  kind: Ap2ReceiptKind
  claims: Record<string, unknown>
  now: Date
}): VerifiedAp2Receipt => {
  assertNoCredentialMaterial(claims)
  const status = stringValue(claims.status)
  const issuer = stringValue(claims.iss)
  const iat = integerValue(claims.iat)
  const reference = stringValue(claims.reference)
  if ((status !== 'Success' && status !== 'Error') || !issuer || iat === undefined || !reference) {
    throw new Ap2ReceiptError('ap2_receipt_invalid', 'AP2 receipt requires status, iss, iat, and reference.')
  }
  const nowSeconds = Math.floor(now.getTime() / 1000)
  if (iat > nowSeconds + 60 || iat < nowSeconds - 24 * 60 * 60) {
    throw new Ap2ReceiptError('ap2_receipt_invalid', 'AP2 receipt iat is outside the accepted verification window.')
  }
  const error = stringValue(claims.error)
  const errorDescription = stringValue(claims.error_description)
  if (status === 'Error' && (!error || !errorDescription)) {
    throw new Ap2ReceiptError('ap2_receipt_invalid', 'Error AP2 receipts require error and error_description.')
  }
  if (kind === 'checkout') {
    const orderId = stringValue(claims.order_id)
    if (status === 'Success' && !orderId) {
      throw new Ap2ReceiptError('ap2_receipt_invalid', 'Successful Checkout Receipt requires order_id.')
    }
    return {
      kind,
      status,
      issuer,
      issuedAt: new Date(iat * 1000).toISOString(),
      reference,
      ...(orderId ? { orderId } : {}),
      ...(error ? { error } : {}),
      ...(errorDescription ? { errorDescription } : {})
    }
  }
  const paymentId = stringValue(claims.payment_id)
  const pspConfirmationId = stringValue(claims.psp_confirmation_id)
  const networkConfirmationId = stringValue(claims.network_confirmation_id)
  if (!paymentId) throw new Ap2ReceiptError('ap2_receipt_invalid', 'Payment Receipt requires payment_id.')
  if (status === 'Success' && (!pspConfirmationId || !networkConfirmationId)) {
    throw new Ap2ReceiptError('ap2_receipt_invalid', 'Successful Payment Receipt requires PSP and network confirmation IDs.')
  }
  return {
    kind,
    status,
    issuer,
    issuedAt: new Date(iat * 1000).toISOString(),
    reference,
    paymentId,
    ...(pspConfirmationId ? { pspConfirmationId } : {}),
    ...(networkConfirmationId ? { networkConfirmationId } : {}),
    ...(error ? { error } : {}),
    ...(errorDescription ? { errorDescription } : {})
  }
}

export const verifyAndRecordAp2Receipt = async ({
  transactionId,
  kind,
  receiptJwt,
  trustedIssuers,
  store,
  now = new Date()
}: {
  transactionId: string
  kind: Ap2ReceiptKind
  receiptJwt: string
  trustedIssuers: Ap2TrustedIssuer[]
  store: UcpCheckoutStore
  now?: Date
}) => {
  const parsed = parseJwt(receiptJwt)
  const alg = stringValue(parsed.header.alg)
  const kid = stringValue(parsed.header.kid)
  const issuerName = stringValue(parsed.claims.iss)
  if (!alg || !kid || !issuerName) {
    throw new Ap2ReceiptError('ap2_receipt_invalid', 'AP2 receipt JWT requires alg, kid, and iss.')
  }
  const issuer = trustedIssuers.find((candidate) => candidate.issuer === issuerName)
  const key = issuer?.keys.find((candidate) => stringValue(candidate.kid) === kid)
  if (!issuer || !key) {
    throw new Ap2ReceiptError('ap2_receipt_untrusted', 'AP2 receipt issuer or signing key is not trusted.')
  }
  if (!verifySignature({ alg, jwk: key, signingInput: parsed.signingInput, signature: parsed.signature })) {
    throw new Ap2ReceiptError('ap2_receipt_untrusted', 'AP2 receipt signature verification failed.')
  }
  const receipt = parseReceiptClaims({ kind, claims: parsed.claims, now })
  const authority = await store.readAp2AuthorityForReceipt({
    transactionId,
    kind,
    reference: receipt.reference
  })
  if (!authority) {
    throw new Ap2ReceiptError('ap2_receipt_reference_mismatch', 'AP2 receipt reference does not match this transaction closed mandate.')
  }
  const result = await store.recordAp2ProtocolReceipt({
    receiptId: `ap2r_${createHash('sha256').update(receiptJwt, 'utf8').digest('base64url').slice(0, 40)}`,
    authorityId: authority.authorityId,
    kind,
    status: receipt.status,
    issuer: receipt.issuer,
    reference: receipt.reference,
    ...(receipt.orderId ? { orderId: receipt.orderId } : {}),
    ...(receipt.paymentId ? { paymentId: receipt.paymentId } : {}),
    ...(receipt.pspConfirmationId ? { pspConfirmationId: receipt.pspConfirmationId } : {}),
    ...(receipt.networkConfirmationId ? { networkConfirmationId: receipt.networkConfirmationId } : {}),
    receiptJwt,
    issuedAt: receipt.issuedAt
  })
  if (result === 'conflict') {
    throw new Ap2ReceiptError('ap2_receipt_conflict', 'A different AP2 receipt already exists for this mandate reference.')
  }
  return { receipt, persistence: result }
}
