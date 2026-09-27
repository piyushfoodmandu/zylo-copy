import {
  createPublicKey,
  createVerify
} from 'node:crypto'
import type { CommercePrincipal } from './commerce-principal.ts'
import type { PurchaseMandate, PurchaseMandateAuthorizationAction } from './purchase-mandate.ts'
import type { PurchaseStepUpAction, PurchaseStepUpDecision } from './purchase-step-up.ts'

export type TrustedHostMandateAuthorizationConfig = {
  hostId: string
  integrationId: string
  issuer: string
  audience: string
  jwks: Record<string, unknown>[]
}

export class TrustedHostMandateAuthorizationError extends Error {
  readonly code:
    | 'trusted_host_mandate_not_configured'
    | 'trusted_host_mandate_signature_invalid'
    | 'trusted_host_mandate_claim_invalid'

  constructor(code: TrustedHostMandateAuthorizationError['code'], message: string) {
    super(message)
    this.name = 'TrustedHostMandateAuthorizationError'
    this.code = code
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const numberValue = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const decodeBase64UrlJson = (value: string) => {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
  } catch {
    throw new TrustedHostMandateAuthorizationError(
      'trusted_host_mandate_signature_invalid',
      'Trusted-host mandate authorization must be compact JWS with JSON header and payload.'
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
    throw new TrustedHostMandateAuthorizationError(
      'trusted_host_mandate_signature_invalid',
      'Trusted-host mandate authorization must use ES256 or RS256.'
    )
  }
  const verifier = createVerify('sha256')
  verifier.update(signingInput)
  verifier.end()
  const key = createPublicKey({ key: jwk, format: 'jwk' })
  if (verifier.verify(key, signature)) return true
  if (alg !== 'ES256') return false
  const rawVerifier = createVerify('sha256')
  rawVerifier.update(signingInput)
  rawVerifier.end()
  return rawVerifier.verify(key, rawEcdsaToDer(signature))
}

const parseCompactJws = (jws: string) => {
  const parts = jws.trim().split('.')
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new TrustedHostMandateAuthorizationError(
      'trusted_host_mandate_signature_invalid',
      'Trusted-host mandate authorization must be a compact JWS.'
    )
  }
  const [protectedHeader, payload, signature] = parts as [string, string, string]
  return {
    header: asRecord(decodeBase64UrlJson(protectedHeader)),
    claims: asRecord(decodeBase64UrlJson(payload)),
    signingInput: `${protectedHeader}.${payload}`,
    signature: Buffer.from(signature, 'base64url')
  }
}

const assertFreshClaims = (claims: Record<string, unknown>, now = new Date()) => {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const issuedAt = numberValue(claims.iat)
  const expiresAt = numberValue(claims.exp)
  const notBefore = numberValue(claims.nbf)
  if (!issuedAt || !expiresAt || !stringValue(claims.jti)) {
    throw new TrustedHostMandateAuthorizationError(
      'trusted_host_mandate_claim_invalid',
      'Trusted-host mandate authorization must include iat, exp, and jti.'
    )
  }
  if (issuedAt > nowSeconds + 60 || expiresAt <= nowSeconds || expiresAt - issuedAt > 900) {
    throw new TrustedHostMandateAuthorizationError(
      'trusted_host_mandate_claim_invalid',
      'Trusted-host mandate authorization is expired or outside the allowed clock window.'
    )
  }
  if (notBefore !== undefined && notBefore > nowSeconds + 60) {
    throw new TrustedHostMandateAuthorizationError(
      'trusted_host_mandate_claim_invalid',
      'Trusted-host mandate authorization is not valid yet.'
    )
  }
  if (claims.user_presence !== true) {
    throw new TrustedHostMandateAuthorizationError(
      'trusted_host_mandate_claim_invalid',
      'Trusted-host mandate authorization must prove user presence.'
    )
  }
}

const assertClaimEquals = (
  claims: Record<string, unknown>,
  key: string,
  expected: string | number | undefined
) => {
  if (expected === undefined) return
  const actual = claims[key]
  if (String(actual) !== String(expected)) {
    throw new TrustedHostMandateAuthorizationError(
      'trusted_host_mandate_claim_invalid',
      `Trusted-host mandate authorization ${key} claim does not match.`
    )
  }
}

export type TrustedHostMandateAuthorizationVerifier = {
  verify(input: {
    attestation: string
    principal: CommercePrincipal
    mandate: PurchaseMandate
    action: Pick<PurchaseMandateAuthorizationAction, 'actionId' | 'authorizationHash' | 'mode'>
  }): void
  verifyStepUp?(input: {
    attestation: string
    principal: CommercePrincipal
    action: PurchaseStepUpAction
    decision: Exclude<PurchaseStepUpDecision, 'reject'>
  }): string
}

export const createTrustedHostMandateAuthorizationVerifier = ({
  configs
}: {
  configs: TrustedHostMandateAuthorizationConfig[]
}): TrustedHostMandateAuthorizationVerifier => {
  const verifyForPrincipal = (attestation: string, principal: CommercePrincipal) => {
    const parsed = parseCompactJws(attestation)
    const alg = stringValue(parsed.header.alg)
    const kid = stringValue(parsed.header.kid)
    if (!alg || !kid) {
      throw new TrustedHostMandateAuthorizationError(
        'trusted_host_mandate_signature_invalid',
        'Trusted-host mandate authorization must include alg and kid.'
      )
    }
    const config = configs.find((candidate) =>
      candidate.integrationId === principal.integrationId &&
      candidate.issuer === stringValue(parsed.claims.iss) &&
      candidate.audience === stringValue(parsed.claims.aud) &&
      candidate.hostId === stringValue(parsed.claims.host_id)
    )
    if (!config) {
      throw new TrustedHostMandateAuthorizationError(
        'trusted_host_mandate_not_configured',
        'Trusted-host mandate authorization issuer, audience, host, or integration is not configured.'
      )
    }
    const key = config.jwks.find((candidate) => stringValue(candidate.kid) === kid)
    if (!key) {
      throw new TrustedHostMandateAuthorizationError(
        'trusted_host_mandate_not_configured',
        'Trusted-host mandate authorization key id is not configured.'
      )
    }
    if (!verifyJwsSignature({
      alg,
      jwk: key,
      signingInput: parsed.signingInput,
      signature: parsed.signature
    })) {
      throw new TrustedHostMandateAuthorizationError(
        'trusted_host_mandate_signature_invalid',
        'Trusted-host mandate authorization signature could not be verified.'
      )
    }
    assertFreshClaims(parsed.claims)
    return parsed.claims
  }

  return {
    verify({ attestation, principal, mandate, action }) {
      if (action.mode !== 'trusted_host_signature') {
        throw new TrustedHostMandateAuthorizationError(
          'trusted_host_mandate_claim_invalid',
          'Trusted-host mandate authorization can only redeem trusted_host_signature actions.'
        )
      }
      const claims = verifyForPrincipal(attestation, principal)
      assertClaimEquals(claims, 'owner_id', mandate.ownerId)
      assertClaimEquals(claims, 'integration_id', principal.integrationId)
      assertClaimEquals(claims, 'mandate_id', mandate.mandateId)
      assertClaimEquals(claims, 'mandate_version', mandate.version)
      assertClaimEquals(claims, 'authorization_hash', action.authorizationHash)
      assertClaimEquals(claims, 'approval_action_id', action.actionId)
      assertClaimEquals(claims, 'valid_from', mandate.validFrom)
      assertClaimEquals(claims, 'expires_at', mandate.expiresAt)
    },

    verifyStepUp({ attestation, principal, action, decision }) {
      const claims = verifyForPrincipal(attestation, principal)
      assertClaimEquals(claims, 'owner_id', `${principal.keyId}:${principal.ownerPrincipalHash}`)
      assertClaimEquals(claims, 'integration_id', principal.integrationId)
      assertClaimEquals(claims, 'step_up_action_id', action.actionId)
      assertClaimEquals(claims, 'purchase_id', action.purchaseId)
      assertClaimEquals(claims, 'job_id', action.jobId)
      assertClaimEquals(claims, 'mandate_id', action.mandateId)
      assertClaimEquals(claims, 'mandate_version', action.mandateVersion)
      assertClaimEquals(claims, 'merchant_origin', action.merchantOrigin)
      assertClaimEquals(claims, 'checkout_id', action.checkoutId)
      assertClaimEquals(claims, 'checkout_snapshot_hash', action.checkoutSnapshotHash)
      assertClaimEquals(claims, 'amount_minor', action.amountMinor)
      assertClaimEquals(claims, 'currency', action.currency)
      assertClaimEquals(claims, 'reason_code', action.reasonCode)
      assertClaimEquals(claims, 'decision', decision)
      return stringValue(claims.jti)!
    }
  }
}
