import { describe, expect, it } from 'vitest'
import { UCP_STABLE_VERSION, type UcpCheckout } from '@arro/contracts'
import type { UcpPaymentActionRecord } from './ucp-checkout-store.ts'
import {
  paymentActionPayloadForRoute,
  paymentActionResponseFromRecord
} from './payment-actions.ts'

const checkout = (overrides: Partial<UcpCheckout> = {}): UcpCheckout => ({
  ucp: {
    version: UCP_STABLE_VERSION,
    status: 'success'
  },
  id: 'checkout_google_pay_1',
  status: 'ready_for_complete',
  currency: 'EUR',
  line_items: [],
  totals: [{ type: 'total', amount: 1999, currency: 'EUR' }],
  links: [],
  ...overrides
})

const googlePayHandlerConfig = {
  api_version: 2,
  api_version_minor: 0,
  environment: 'TEST',
  merchant_info: {
    merchant_id: '12345678901234567890',
    merchant_name: 'Example Merchant',
    merchant_origin: 'merchant.example'
  },
  allowed_payment_methods: [{
    type: 'CARD',
    parameters: {
      allowed_auth_methods: ['PAN_ONLY'],
      allowed_card_networks: ['VISA']
    },
    tokenization_specification: {
      type: 'PAYMENT_GATEWAY',
      parameters: {
        gateway: 'example',
        gatewayMerchantId: 'exampleGatewayMerchantId'
      }
    }
  }]
}

const paymentActionRecord = (
  presentation: 'host_native' | 'external_action'
): UcpPaymentActionRecord => ({
  actionId: 'arro_pa_action_1',
  transactionId: 'ucptx_purchase_1',
  integrationId: 'first-party:arro-shopper',
  merchantOrigin: 'https://merchant.example',
  checkoutId: 'checkout_google_pay_1',
  checkoutSnapshotHash: `sha256:${'a'.repeat(64)}`,
  handlerId: 'merchant_google_pay_1',
  handlerName: 'com.google.pay',
  provider: 'com.google.pay',
  route: 'google_pay',
  presentation,
  actionType: 'google_pay',
  status: 'pending_user_approval',
  currency: 'EUR',
  amount: 1999,
  tokenNonceHash: `sha256:${'b'.repeat(64)}`,
  actionPayload: {
    kind: 'google_pay',
    presentation
  },
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z'
})

describe('payment actions', () => {
  it('returns an explicit native presentation and signed token without a browser URL', () => {
    const response = paymentActionResponseFromRecord({
      action: paymentActionRecord('host_native'),
      token: 'arro_pa1_signed_native_action',
      publicBaseUrl: 'https://arro.example'
    })

    expect(response).toMatchObject({
      presentation: 'host_native',
      actionToken: 'arro_pa1_signed_native_action'
    })
    expect(response.actionUrl).toBeUndefined()

    const external = paymentActionResponseFromRecord({
      action: paymentActionRecord('external_action'),
      token: 'arro_pa1_signed_external_action',
      publicBaseUrl: 'https://arro.example'
    })
    expect(external.actionUrl).toBe(
      'https://arro.example/v1/payment-actions/arro_pa1_signed_external_action'
    )
  })

  it('adds only an explicit merchant country and otherwise keeps it optional', () => {
    const payload = paymentActionPayloadForRoute({
      actionType: 'google_pay',
      checkout: checkout({
        context: { merchant_country: 'nl' },
        fulfillment: { country: 'FR' }
      }),
      handlerId: 'merchant_google_pay_1',
      handlerName: 'com.google.pay',
      handlerConfig: googlePayHandlerConfig,
      provider: 'com.google.pay',
      presentation: 'host_native',
      merchantOrigin: 'https://merchant.example'
    })

    expect(payload).toMatchObject({
      kind: 'google_pay',
      presentation: 'host_native',
      countryCode: 'NL',
      paymentRequest: {
        transactionInfo: {
          totalPriceStatus: 'FINAL',
          totalPrice: '19.99',
          currencyCode: 'EUR',
          countryCode: 'NL'
        }
      }
    })

    const nativeWithoutCountry = paymentActionPayloadForRoute({
      actionType: 'google_pay',
      checkout: checkout({ fulfillment: { country: 'FR' } }),
      handlerId: 'merchant_google_pay_1',
      handlerName: 'com.google.pay',
      handlerConfig: googlePayHandlerConfig,
      provider: 'com.google.pay',
      presentation: 'host_native',
      merchantOrigin: 'https://merchant.example'
    })
    expect(nativeWithoutCountry).not.toHaveProperty('countryCode')
    expect(nativeWithoutCountry).not.toHaveProperty('paymentRequest.transactionInfo.countryCode')

    const external = paymentActionPayloadForRoute({
      actionType: 'google_pay',
      checkout: checkout({ fulfillment: { country: 'FR' } }),
      handlerId: 'merchant_google_pay_1',
      handlerName: 'com.google.pay',
      handlerConfig: googlePayHandlerConfig,
      provider: 'com.google.pay',
      presentation: 'external_action',
      merchantOrigin: 'https://merchant.example'
    })
    expect(external).not.toHaveProperty('countryCode')
    expect(external).toMatchObject({
      paymentRequest: {
        transactionInfo: {
          totalPriceStatus: 'FINAL',
          totalPrice: '19.99',
          currencyCode: 'EUR'
        }
      }
    })
  })
})
