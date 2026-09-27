import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { Ap2ReceiptError, verifyAndRecordAp2Receipt } from './ap2-receipt.ts'
import type { Ap2TrustedIssuer } from './ap2-mandate.ts'
import type { UcpCheckoutStore } from './ucp-checkout-store.ts'

const keys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const publicJwk = keys.publicKey.export({ format: 'jwk' }) as Record<string, unknown>
publicJwk.kid = 'receipt-key-1'

const trustedIssuers: Ap2TrustedIssuer[] = [{
  issuer: 'https://receipt-issuer.example',
  keys: [publicJwk]
}]

const jwt = (claims: Record<string, unknown>) => {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'receipt-key-1', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
    key: keys.privateKey,
    dsaEncoding: 'ieee-p1363'
  }).toString('base64url')
  return `${header}.${payload}.${signature}`
}

const now = new Date('2026-07-13T06:00:00.000Z')
const iat = Math.floor(now.getTime() / 1000)

describe('AP2 protocol receipts', () => {
  it('verifies and idempotently persists exact checkout and payment receipt references', async () => {
    const record = vi.fn().mockResolvedValueOnce('recorded').mockResolvedValueOnce('recovered')
    const store = {
      readAp2AuthorityForReceipt: vi.fn(async () => ({ authorityId: 'ap2a_1' })),
      recordAp2ProtocolReceipt: record
    } as unknown as UcpCheckoutStore
    const checkoutReceipt = jwt({
      status: 'Success',
      iss: 'https://receipt-issuer.example',
      iat,
      reference: 'checkout-reference',
      order_id: 'order-1'
    })
    const paymentReceipt = jwt({
      status: 'Success',
      iss: 'https://receipt-issuer.example',
      iat,
      reference: 'payment-reference',
      payment_id: 'payment-1',
      psp_confirmation_id: 'psp-1',
      network_confirmation_id: 'network-1'
    })

    const checkout = await verifyAndRecordAp2Receipt({
      transactionId: 'txn-1',
      kind: 'checkout',
      receiptJwt: checkoutReceipt,
      trustedIssuers,
      store,
      now
    })
    const payment = await verifyAndRecordAp2Receipt({
      transactionId: 'txn-1',
      kind: 'payment',
      receiptJwt: paymentReceipt,
      trustedIssuers,
      store,
      now
    })

    expect(checkout).toMatchObject({ persistence: 'recorded', receipt: { orderId: 'order-1' } })
    expect(payment).toMatchObject({ persistence: 'recovered', receipt: { paymentId: 'payment-1' } })
    expect(store.readAp2AuthorityForReceipt).toHaveBeenNthCalledWith(1, {
      transactionId: 'txn-1',
      kind: 'checkout',
      reference: 'checkout-reference'
    })
  })

  it('rejects unbound, conflicting, malformed, and credential-bearing receipts', async () => {
    const unboundStore = {
      readAp2AuthorityForReceipt: vi.fn(async () => undefined),
      recordAp2ProtocolReceipt: vi.fn()
    } as unknown as UcpCheckoutStore
    const receipt = jwt({
      status: 'Success',
      iss: 'https://receipt-issuer.example',
      iat,
      reference: 'other-transaction-reference',
      order_id: 'order-1'
    })
    await expect(verifyAndRecordAp2Receipt({
      transactionId: 'txn-1',
      kind: 'checkout',
      receiptJwt: receipt,
      trustedIssuers,
      store: unboundStore,
      now
    })).rejects.toMatchObject({ code: 'ap2_receipt_reference_mismatch' })

    const conflictingStore = {
      readAp2AuthorityForReceipt: vi.fn(async () => ({ authorityId: 'ap2a_1' })),
      recordAp2ProtocolReceipt: vi.fn(async () => 'conflict')
    } as unknown as UcpCheckoutStore
    await expect(verifyAndRecordAp2Receipt({
      transactionId: 'txn-1',
      kind: 'checkout',
      receiptJwt: receipt,
      trustedIssuers,
      store: conflictingStore,
      now
    })).rejects.toBeInstanceOf(Ap2ReceiptError)

    const credentialReceipt = jwt({
      status: 'Success',
      iss: 'https://receipt-issuer.example',
      iat,
      reference: 'checkout-reference',
      order_id: 'order-1',
      cvv: '123'
    })
    await expect(verifyAndRecordAp2Receipt({
      transactionId: 'txn-1',
      kind: 'checkout',
      receiptJwt: credentialReceipt,
      trustedIssuers,
      store: conflictingStore,
      now
    })).rejects.toMatchObject({ code: 'ap2_receipt_invalid' })
  })
})
