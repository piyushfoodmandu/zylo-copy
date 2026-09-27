import { createHash, createSign, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  UCP_STABLE_VERSION,
  type UcpCheckout,
  type UcpPaymentInstrument,
  type UcpProfile
} from '@arro/contracts'
import {
  jcsCanonicalize,
  parseAp2TrustedIssuersJson,
  verifyAp2Mandate,
  verifyAp2OpenMandateAuthorization
} from './ap2-mandate.ts'
import { draftPurchaseMandate } from './purchase-mandate.ts'
import type { UcpCheckoutStore } from './ucp-checkout-store.ts'

const base64UrlJson = (value: unknown) =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

const signInput = (
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'],
  input: string
) => {
  const signer = createSign('sha256')
  signer.update(input)
  signer.end()
  return signer.sign(privateKey).toString('base64url')
}

const signCompactJws = ({
  privateKey,
  header,
  payload
}: {
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']
  header: Record<string, unknown>
  payload: Record<string, unknown>
}) => {
  const protectedHeader = base64UrlJson(header)
  const body = base64UrlJson(payload)
  const signingInput = `${protectedHeader}.${body}`
  return `${signingInput}.${signInput(privateKey, signingInput)}`
}

const signDetachedJws = ({
  privateKey,
  header,
  payload
}: {
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']
  header: Record<string, unknown>
  payload: Record<string, unknown>
}) => {
  const protectedHeader = base64UrlJson(header)
  const body = Buffer.from(jcsCanonicalize(payload), 'utf8').toString('base64url')
  return `${protectedHeader}..${signInput(privateKey, `${protectedHeader}.${body}`)}`
}

const delegatedMandateFor = ({
  privateKey,
  previousMandate,
  payload,
  nowSeconds,
  audience = 'https://merchant.example',
  nonce = 'chk_ap2_1'
}: {
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']
  previousMandate: string
  payload: Record<string, unknown>
  nowSeconds: number
  audience?: string
  nonce?: string
}) => signCompactJws({
  privateKey,
  header: { alg: 'ES256', typ: 'kb+sd-jwt' },
  payload: {
    aud: audience,
    nonce,
    iat: nowSeconds,
    sd_hash: createHash('sha256').update(previousMandate.endsWith('~') ? previousMandate : `${previousMandate}~`, 'utf8').digest('base64url'),
    delegate_payload: [payload]
  }
})

describe('AP2 v0.2 and UCP mandate verification', () => {
  it('verifies human-present closed Checkout and Payment Mandates, merchant signatures, scope, and replay', async () => {
    const issuerKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const merchantKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const issuerJwk = issuerKeys.publicKey.export({ format: 'jwk' }) as Record<string, unknown>
    issuerJwk.kid = 'issuer-key-1'
    const merchantJwk = merchantKeys.publicKey.export({ format: 'jwk' }) as Record<string, unknown>
    merchantJwk.kid = 'merchant-key-1'
    const checkoutWithoutAp2 = {
      ucp: { version: UCP_STABLE_VERSION, status: 'success' as const },
      id: 'chk_ap2_1',
      status: 'ready_for_complete' as const,
      currency: 'USD',
      line_items: [{
        id: 'li_1',
        item: { id: 'sku_1', title: 'Test item' },
        quantity: 1,
        totals: [{ type: 'total', amount: 3299, currency: 'USD' }]
      }],
      totals: [{ type: 'total', amount: 3299, currency: 'USD' }],
      links: []
    }
    const merchantAuthorization = signDetachedJws({
      privateKey: merchantKeys.privateKey,
      header: { alg: 'ES256', kid: 'merchant-key-1' },
      payload: checkoutWithoutAp2
    })
    const checkout: UcpCheckout = {
      ...checkoutWithoutAp2,
      ap2: { merchant_authorization: merchantAuthorization }
    } as UcpCheckout
    const checkoutJwt = signCompactJws({
      privateKey: merchantKeys.privateKey,
      header: { alg: 'ES256', kid: 'merchant-key-1', typ: 'JWT' },
      payload: checkout as unknown as Record<string, unknown>
    })
    const checkoutHash = createHash('sha256').update(checkoutJwt, 'utf8').digest('base64url')
    const nowSeconds = Math.floor(Date.now() / 1000)
    const checkoutMandate = `${signCompactJws({
      privateKey: issuerKeys.privateKey,
      header: { alg: 'ES256', kid: 'issuer-key-1' },
      payload: {
        iss: 'https://issuer.example',
        aud: 'arro-ap2-runtime',
        iat: nowSeconds,
        exp: nowSeconds + 300,
        delegate_payload: [{
          vct: 'mandate.checkout.1',
          jti: 'checkout-mandate-1',
          iat: nowSeconds,
          exp: nowSeconds + 300,
          checkout_jwt: checkoutJwt,
          checkout_hash: checkoutHash
        }]
      }
    })}~`
    const paymentInstrument: UcpPaymentInstrument = {
      id: 'instr_1',
      handler_id: 'merchant-handler-1',
      type: 'card',
      credential: { type: 'PAYMENT_GATEWAY', token: 'opaque-provider-token' }
    }
    const paymentMandate = `${signCompactJws({
      privateKey: issuerKeys.privateKey,
      header: { alg: 'ES256', kid: 'issuer-key-1' },
      payload: {
        iss: 'https://issuer.example',
        aud: 'arro-ap2-runtime',
        iat: nowSeconds,
        exp: nowSeconds + 300,
        delegate_payload: [{
          vct: 'mandate.payment.1',
          jti: 'payment-mandate-1',
          iat: nowSeconds,
          exp: nowSeconds + 300,
          transaction_id: checkoutHash,
          payee: { name: 'Merchant', website: 'https://merchant.example' },
          payment_amount: { currency: 'USD', amount: 3299 },
          payment_instrument: { id: 'instr_1', type: 'card' }
        }]
      }
    })}~`
    const store = {
      claimAp2Mandate: vi.fn().mockResolvedValueOnce('claimed').mockResolvedValueOnce('replay')
    } as unknown as UcpCheckoutStore
    const businessProfile: UcpProfile = {
      ucp: {
        version: UCP_STABLE_VERSION,
        services: {},
        capabilities: {}
      },
      keys: [merchantJwk]
    }
    const trustedIssuers = parseAp2TrustedIssuersJson(JSON.stringify({
      issuers: [{
        issuer: 'https://issuer.example',
        audience: 'arro-ap2-runtime',
        keys: [issuerJwk]
      }]
    }))
    const input = {
      checkoutMandate,
      paymentMandate,
      paymentInstrument,
      checkout,
      businessProfile,
      merchantOrigin: 'https://merchant.example',
      transactionId: 'txn_ap2_1',
      checkoutId: checkout.id,
      checkoutSnapshotHash: `sha256:${'1'.repeat(64)}`,
      trustedIssuers,
      store
    }

    await expect(verifyAp2Mandate(input)).resolves.toMatchObject({
      checkoutMandateId: 'checkout-mandate-1',
      paymentMandateId: 'payment-mandate-1',
      authorityMode: 'human_present',
      checkoutHash
    })
    await expect(verifyAp2Mandate(input)).rejects.toMatchObject({ code: 'ap2_mandate_replay' })
  })

  it('verifies open-to-closed autonomous mandate chains and rejects out-of-scope terms', async () => {
    const issuerKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const agentKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const merchantKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const issuerJwk = issuerKeys.publicKey.export({ format: 'jwk' }) as Record<string, unknown>
    issuerJwk.kid = 'issuer-key-1'
    const agentJwk = agentKeys.publicKey.export({ format: 'jwk' }) as Record<string, unknown>
    const merchantJwk = merchantKeys.publicKey.export({ format: 'jwk' }) as Record<string, unknown>
    merchantJwk.kid = 'merchant-key-1'
    const checkoutBase = {
      ucp: { version: UCP_STABLE_VERSION, status: 'success' as const },
      id: 'chk_ap2_1',
      status: 'ready_for_complete' as const,
      currency: 'USD',
      line_items: [{
        id: 'li_1',
        item: { id: 'sku_1', title: 'Test item' },
        quantity: 1,
        totals: [{ type: 'total', amount: 3299, currency: 'USD' }]
      }],
      totals: [{ type: 'total', amount: 3299, currency: 'USD' }],
      links: []
    }
    const merchantAuthorization = signDetachedJws({
      privateKey: merchantKeys.privateKey,
      header: { alg: 'ES256', kid: 'merchant-key-1' },
      payload: checkoutBase
    })
    const checkout = { ...checkoutBase, ap2: { merchant_authorization: merchantAuthorization } } as UcpCheckout
    const checkoutJwt = signCompactJws({
      privateKey: merchantKeys.privateKey,
      header: { alg: 'ES256', kid: 'merchant-key-1' },
      payload: checkout as unknown as Record<string, unknown>
    })
    const checkoutHash = createHash('sha256').update(checkoutJwt, 'utf8').digest('base64url')
    const nowSeconds = Math.floor(Date.now() / 1000)
    const openCheckoutRoot = `${signCompactJws({
      privateKey: issuerKeys.privateKey,
      header: { alg: 'ES256', kid: 'issuer-key-1' },
      payload: {
        iss: 'https://issuer.example',
        iat: nowSeconds,
        exp: nowSeconds + 600,
        delegate_payload: [{
          vct: 'mandate.checkout.open.1',
          jti: 'open-checkout-1',
          iat: nowSeconds,
          exp: nowSeconds + 600,
          cnf: { jwk: agentJwk },
          constraints: [
            { type: 'checkout.allowed_merchants', allowed: [{ name: 'Merchant', website: 'https://merchant.example' }] },
            { type: 'checkout.line_items', items: [{ id: 'req_1', acceptable_items: [{ id: 'sku_1', title: 'Test item' }], quantity: 1 }] }
          ]
        }]
      }
    })}~`
    const closedCheckout = {
      vct: 'mandate.checkout.1',
      jti: 'closed-checkout-1',
      iat: nowSeconds,
      exp: nowSeconds + 300,
      checkout_jwt: checkoutJwt,
      checkout_hash: checkoutHash
    }
    const checkoutMandate = `${openCheckoutRoot.slice(0, -1)}~~${delegatedMandateFor({
      privateKey: agentKeys.privateKey,
      previousMandate: openCheckoutRoot,
      payload: closedCheckout,
      nowSeconds
    })}~`
    const openCheckoutReference = createHash('sha256').update(openCheckoutRoot, 'utf8').digest('base64url')
    const openPaymentRoot = `${signCompactJws({
      privateKey: issuerKeys.privateKey,
      header: { alg: 'ES256', kid: 'issuer-key-1' },
      payload: {
        iss: 'https://issuer.example',
        iat: nowSeconds,
        exp: nowSeconds + 600,
        delegate_payload: [{
          vct: 'mandate.payment.open.1',
          jti: 'open-payment-1',
          iat: nowSeconds,
          exp: nowSeconds + 600,
          cnf: { jwk: agentJwk },
          constraints: [
            { type: 'payment.reference', conditional_transaction_id: openCheckoutReference },
            { type: 'payment.allowed_payees', allowed: [{ name: 'Merchant', website: 'https://merchant.example' }] },
            { type: 'payment.amount_range', currency: 'USD', min: 1, max: 5000 },
            { type: 'payment.agent_recurrence', frequency: 'ON_DEMAND', max_occurrences: 2 },
            { type: 'payment.budget', currency: 'USD', max: 50 }
          ]
        }]
      }
    })}~`
    const paymentInstrument: UcpPaymentInstrument = {
      id: 'instr_1',
      handler_id: 'merchant-handler-1',
      type: 'card',
      credential: { type: 'PAYMENT_GATEWAY', token: 'opaque-provider-token' }
    }
    const closedPayment = {
      vct: 'mandate.payment.1',
      jti: 'closed-payment-1',
      iat: nowSeconds,
      exp: nowSeconds + 300,
      transaction_id: checkoutHash,
      payee: { name: 'Merchant', website: 'https://merchant.example' },
      payment_amount: { currency: 'USD', amount: 3299 },
      payment_instrument: { id: 'instr_1', type: 'card' }
    }
    const paymentMandate = `${openPaymentRoot.slice(0, -1)}~~${delegatedMandateFor({
      privateKey: agentKeys.privateKey,
      previousMandate: openPaymentRoot,
      payload: closedPayment,
      nowSeconds
    })}~`
    const trustedIssuers = parseAp2TrustedIssuersJson(JSON.stringify({ issuers: [{ issuer: 'https://issuer.example', keys: [issuerJwk] }] }))
    const canonicalMandate = draftPurchaseMandate({
      principal: {
        keyId: 'owner-key',
        ownerPrincipal: 'owner',
        ownerPrincipalHash: `sha256:${'9'.repeat(64)}`,
        integrationId: 'integration-test'
      },
      intentDescription: 'Buy the exact AP2 test item',
      merchantOrigin: 'https://merchant.example',
      productId: 'sku_1',
      intendedQuantity: 1,
      currency: 'USD',
      maximumPerTransactionMinor: '5000',
      maximumTotalSpendMinor: '5000',
      useLimit: 2,
      expiresAt: new Date((nowSeconds + 300) * 1000).toISOString(),
      authorizationProvider: 'ap2_trusted_surface'
    })
    expect(verifyAp2OpenMandateAuthorization({
      checkoutMandate: openCheckoutRoot,
      paymentMandate: openPaymentRoot,
      mandate: canonicalMandate,
      trustedIssuers
    })).toMatchObject({ issuer: 'https://issuer.example' })
    const store = { claimAp2Mandate: vi.fn().mockResolvedValue('claimed') } as unknown as UcpCheckoutStore
    const input = {
      checkoutMandate,
      paymentMandate,
      paymentInstrument,
      checkout,
      businessProfile: {
        ucp: { version: UCP_STABLE_VERSION, services: {}, capabilities: {} },
        keys: [merchantJwk]
      } as UcpProfile,
      merchantOrigin: 'https://merchant.example',
      transactionId: 'txn_ap2_autonomous',
      checkoutId: checkout.id,
      checkoutSnapshotHash: `sha256:${'2'.repeat(64)}`,
      trustedIssuers,
      store,
      mandateContext: {
        totalAmountMinor: '0',
        totalUses: 0,
        expectedOpenCheckoutReference: openCheckoutReference,
        expectedOpenPaymentReference: createHash('sha256').update(openPaymentRoot, 'utf8').digest('base64url')
      }
    }
    await expect(verifyAp2Mandate(input)).resolves.toMatchObject({
      authorityMode: 'human_not_present',
      checkoutMandateId: 'closed-checkout-1',
      paymentMandateId: 'closed-payment-1'
    })
    const overBudgetPayment = `${openPaymentRoot.slice(0, -1)}~~${delegatedMandateFor({
      privateKey: agentKeys.privateKey,
      previousMandate: openPaymentRoot,
      payload: { ...closedPayment, jti: 'closed-payment-2', payment_amount: { currency: 'USD', amount: 5001 } },
      nowSeconds
    })}~`
    await expect(verifyAp2Mandate({ ...input, paymentMandate: overBudgetPayment })).rejects.toMatchObject({ code: 'ap2_mandate_scope_invalid' })
  })
})
