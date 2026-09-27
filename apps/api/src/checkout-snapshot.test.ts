import { describe, expect, it } from 'vitest'
import { UCP_STABLE_VERSION, type UcpCheckout } from '@arro/contracts'
import { ucpCheckoutSnapshotHash } from './ucp-checkout-store.ts'

const checkout: UcpCheckout = {
  ucp: { version: UCP_STABLE_VERSION, status: 'success' },
  id: 'checkout_1', status: 'incomplete', currency: 'USD',
  line_items: [{ id: 'line_1', item: { id: 'variant_1' }, quantity: 1 }],
  totals: [{ type: 'total', amount: 39999 }], links: [],
  continue_url: 'https://merchant.example/checkout?key=first',
  expires_at: '2026-09-06T00:00:00Z'
}

describe('reviewed checkout snapshot', () => {
  it('survives rotating merchant continuation credentials and rolling expiry', () => {
    expect(ucpCheckoutSnapshotHash({
      ...checkout,
      continue_url: 'https://merchant.example/checkout?key=rotated',
      expires_at: '2026-09-06T00:01:00Z'
    })).toBe(ucpCheckoutSnapshotHash(checkout))
    expect(checkout.continue_url).toContain('key=first')
  })

  it.each([
    { id: 'checkout_2' },
    { currency: 'EUR' },
    { status: 'canceled' as const },
    { totals: [{ type: 'total', amount: 40000 }] },
    { line_items: [{ id: 'line_1', item: { id: 'variant_1' }, quantity: 2 }] },
    { buyer: { email: 'shopper@example.test' } },
    { fulfillment: { methods: [{ type: 'shipping', destinations: [{ address_country: 'US' }] }] } },
    { payment: { instruments: [{ id: 'instrument_2', handler_id: 'card', type: 'card' }] } },
    { links: [{ type: 'terms', url: 'https://merchant.example/changed-terms' }] }
  ])('invalidates on a real checkout change: %j', (change) => {
    expect(ucpCheckoutSnapshotHash({ ...checkout, ...change })).not.toBe(ucpCheckoutSnapshotHash(checkout))
  })
})
