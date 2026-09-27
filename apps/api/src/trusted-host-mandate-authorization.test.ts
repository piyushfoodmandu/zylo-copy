import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createTrustedHostMandateAuthorizationVerifier } from './trusted-host-mandate-authorization.ts'
import type { CommercePrincipal } from './commerce-principal.ts'
import type { PurchaseStepUpAction } from './purchase-step-up.ts'

const keyPair = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const publicJwk = keyPair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>
publicJwk.kid = 'host-key-1'

const principal: CommercePrincipal = {
  keyId: 'owner-key',
  ownerPrincipal: 'owner',
  ownerPrincipalHash: 'sha256:owner',
  integrationId: 'agent:owner-key:host-integration',
  agentSessionId: 'zas_host_session'
}

const action: PurchaseStepUpAction = {
  actionId: 'psu_1',
  purchaseId: 'purchase_1',
  jobId: 'job_1',
  mandateId: 'mandate_1',
  mandateVersion: 2,
  merchantOrigin: 'https://merchant.example',
  checkoutId: 'checkout_1',
  checkoutSnapshotHash: `sha256:${'1'.repeat(64)}`,
  amountMinor: '5299',
  currency: 'USD',
  items: [{ itemId: 'sku_1', quantity: 1 }],
  reasonCode: 'amount_exceeds_confirmation_threshold',
  requestedAction: 'approve_current_checkout',
  status: 'pending',
  expiresAt: '2099-07-13T00:00:00.000Z',
  display: {
    title: 'Purchase needs your approval',
    merchantOrigin: 'https://merchant.example',
    amountMinor: '5299',
    currency: 'USD',
    items: [{ itemId: 'sku_1', quantity: 1 }],
    reasonCode: 'amount_exceeds_confirmation_threshold',
    decisions: ['approve', 'reject'],
    expiresAt: '2099-07-13T00:00:00.000Z'
  }
}

const compactJws = (overrides: Record<string, unknown> = {}) => {
  const now = Math.floor(Date.now() / 1000)
  const claims = {
    iss: 'https://host.example',
    aud: 'https://arro.example',
    host_id: 'trusted-host-1',
    iat: now,
    exp: now + 300,
    jti: 'step-up-jti-1',
    user_presence: true,
    owner_id: `${principal.keyId}:${principal.ownerPrincipalHash}`,
    integration_id: principal.integrationId,
    step_up_action_id: action.actionId,
    purchase_id: action.purchaseId,
    job_id: action.jobId,
    mandate_id: action.mandateId,
    mandate_version: action.mandateVersion,
    merchant_origin: action.merchantOrigin,
    checkout_id: action.checkoutId,
    checkout_snapshot_hash: action.checkoutSnapshotHash,
    amount_minor: action.amountMinor,
    currency: action.currency,
    reason_code: action.reasonCode,
    decision: 'approve',
    ...overrides
  }
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'host-key-1' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: keyPair.privateKey,
    dsaEncoding: 'ieee-p1363'
  }).toString('base64url')
  return `${header}.${payload}.${signature}`
}

describe('trusted-host user-presence authorization', () => {
  it('binds a step-up approval to the complete owner, job, mandate and checkout snapshot', () => {
    const verifier = createTrustedHostMandateAuthorizationVerifier({
      configs: [{
        hostId: 'trusted-host-1',
        integrationId: principal.integrationId,
        issuer: 'https://host.example',
        audience: 'https://arro.example',
        jwks: [publicJwk]
      }]
    })
    expect(verifier.verifyStepUp?.({
      attestation: compactJws(),
      principal,
      action,
      decision: 'approve'
    })).toBe('step-up-jti-1')
    expect(() => verifier.verifyStepUp?.({
      attestation: compactJws({ checkout_snapshot_hash: `sha256:${'2'.repeat(64)}` }),
      principal,
      action,
      decision: 'approve'
    })).toThrow('checkout_snapshot_hash')
  })
})
