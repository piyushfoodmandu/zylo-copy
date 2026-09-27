import { TypeCompiler } from '@sinclair/typebox/compiler'
import { describe, expect, it } from 'vitest'
import {
  GooglePayPaymentActionResultSchema,
  PurchasePaymentActionCreateRequestSchema,
  PurchasePaymentActionResponseSchema,
  PurchaseReviewUpdateRequestSchema
} from './purchase.ts'

const actionRequestValidator = TypeCompiler.Compile(PurchasePaymentActionCreateRequestSchema)
const actionResponseValidator = TypeCompiler.Compile(PurchasePaymentActionResponseSchema)
const googlePayResultValidator = TypeCompiler.Compile(GooglePayPaymentActionResultSchema)

describe('checkout address input', () => {
  const validator = TypeCompiler.Compile(PurchaseReviewUpdateRequestSchema)
  const request = (method: unknown) => ({
    checkoutSnapshotHash: `sha256:${'a'.repeat(64)}`,
    fulfillment: { methods: [method] }
  })
  it('accepts the first address without requiring a merchant method ID', () => {
    expect(validator.Check(request({ type: 'shipping', destinations: [{ address_country: 'US' }] }))).toBe(true)
    expect(validator.Check(request({ id: 'shipping_1', destinations: [{ address_country: 'US' }] }))).toBe(true)
  })
  it('does not accept invented rates, line bindings or pickup destinations', () => {
    expect(validator.Check(request({ type: 'pickup', destinations: [{ address_country: 'US' }] }))).toBe(false)
    expect(validator.Check(request({ type: 'shipping', destinations: [], amount: 0 }))).toBe(false)
    expect(validator.Check(request({ type: 'shipping', destinations: [{ address_country: 'US' }], line_item_ids: ['other'] }))).toBe(false)
  })
})

const googlePayPaymentData = {
  apiVersion: 2,
  apiVersionMinor: 0,
  paymentMethodData: {
    type: 'CARD',
    tokenizationData: {
      type: 'PAYMENT_GATEWAY',
      token: '{"opaque":"checkout-scoped"}'
    }
  }
}

describe('purchase payment-action contracts', () => {
  it('accepts first-party native client capabilities without agent-host identity or attestation fields', () => {
    expect(actionRequestValidator.Check({
      clientCapabilities: {
        platform: 'android',
        surfaces: ['host_native'],
        providerKinds: ['google_pay'],
        handlerNames: ['com.google.pay']
      }
    })).toBe(true)

    expect(actionRequestValidator.Check({
      clientCapabilities: {
        platform: 'android',
        surfaces: ['host_native'],
        providerKinds: ['google_pay'],
        hostId: 'spoofed-agent-host'
      }
    })).toBe(false)
  })

  it('requires an explicit presentation while allowing native actions to omit actionUrl', () => {
    const response = {
      actionId: 'arro_pa_action_1',
      purchaseId: 'ucptx_purchase_1',
      status: 'pending_user_approval',
      actionType: 'google_pay',
      provider: 'com.google.pay',
      handlerId: 'merchant_google_pay_1',
      handlerName: 'com.google.pay',
      presentation: 'host_native',
      merchantOrigin: 'https://merchant.example',
      checkoutId: 'checkout_1',
      checkoutSnapshotHash: `sha256:${'a'.repeat(64)}`,
      expiresAt: '2099-01-01T00:00:00.000Z',
      actionToken: 'arro_pa1_signed-action',
      message: 'Approve in Arro.'
    }

    expect(actionResponseValidator.Check(response)).toBe(true)
    const { presentation: _presentation, ...withoutPresentation } = response
    expect(actionResponseValidator.Check(withoutPresentation)).toBe(false)
  })

  it('uses one Google Pay result type with an explicit native or web source', () => {
    expect(googlePayResultValidator.Check({
      type: 'google_pay_payment_data',
      source: 'native',
      paymentData: googlePayPaymentData
    })).toBe(true)
    expect(googlePayResultValidator.Check({
      type: 'google_pay_payment_data',
      paymentData: googlePayPaymentData
    })).toBe(false)
    expect(googlePayResultValidator.Check({
      type: 'arro_google_pay_web_payment_data',
      source: 'web',
      paymentData: googlePayPaymentData
    })).toBe(false)
  })
})
