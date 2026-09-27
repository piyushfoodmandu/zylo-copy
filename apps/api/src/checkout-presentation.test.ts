import { expect, it } from 'vitest'
import { UCP_STABLE_VERSION } from '@arro/contracts'
import { checkoutPresentation } from './checkout-presentation.ts'

it('does not mistake another merchant checkout path or Stripe/card support for Shopify', () => {
  expect(checkoutPresentation({ continue_url: 'https://independent.example/checkout', ucp: { payment_handlers: { 'com.stripe.payments': [{}] } } })).toEqual({ type: 'browser' })
  expect(checkoutPresentation({ ucp: { payment_handlers: { 'dev.shopify.card': [] } } })).toEqual({ type: 'browser' })
})

it('selects the Shopify SDK adapter from declared Shopify-owned handlers', () => {
  expect(checkoutPresentation({ ucp: { payment_handlers: { 'dev.shopify.card': [{ id: 'shopify.card' }] } } })).toEqual({ type: 'native_checkout', provider: 'shopify' })
})

it('prefers the standard UCP embedded binding over a provider SDK', () => {
  expect(checkoutPresentation({
    id: 'checkout_1', continue_url: 'https://merchant.example/checkout',
    ucp: { version: UCP_STABLE_VERSION, payment_handlers: { 'dev.shopify.card': [{}] }, services: {
      'dev.ucp.shopping': [{ version: UCP_STABLE_VERSION, transport: 'embedded', config: { delegate: [] } }]
    } }
  })).toEqual({ type: 'ucp_embedded', version: UCP_STABLE_VERSION, checkoutId: 'checkout_1' })
})
