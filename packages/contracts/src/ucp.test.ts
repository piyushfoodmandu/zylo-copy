import { Value } from '@sinclair/typebox/value'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { describe, expect, it } from 'vitest'
import {
  UCP_STABLE_VERSION,
  UcpCartCreateRequestSchema,
  UcpCartOperationResponseSchema,
  UcpCartSchema,
  UcpCheckoutCreateRequestSchema,
  UcpCheckoutOperationResponseSchema,
  UcpCheckoutSchema,
  UcpBusinessProfileSchema,
  UcpErrorResponseSchema,
  UcpLineItemCreateRequestSchema,
  UcpLineItemSchema,
  UcpOrderLineItemSchema,
  UcpOrderWebhookEventSchema,
  UcpPaymentInstrumentSchema,
  UcpPlatformProfileSchema,
  UcpProfileSchema,
  ArroUcpTransactionSchema,
  type UcpProfile
} from './ucp.ts'

const businessProfileValidator = TypeCompiler.Compile(UcpBusinessProfileSchema)
const platformProfileValidator = TypeCompiler.Compile(UcpPlatformProfileSchema)

describe('UCP protocol contracts', () => {
  it('models the stable UCP profile and payment-handler declaration directly', () => {
    const profile: UcpProfile = {
      ucp: {
        version: UCP_STABLE_VERSION,
        services: {
          'dev.ucp.shopping': [
            {
              version: UCP_STABLE_VERSION,
              transport: 'rest',
              endpoint: 'https://merchant.example/ucp',
              schema: 'https://ucp.dev/2026-08-25/services/shopping/rest.openapi.json'
            }
          ]
        },
        capabilities: {
          'dev.ucp.shopping.checkout': [
            {
              version: UCP_STABLE_VERSION,
              schema: 'https://ucp.dev/2026-08-25/schemas/shopping/checkout.json'
            }
          ],
          'dev.ucp.common.payment.ap2_mandate': [
            {
              version: UCP_STABLE_VERSION,
              spec: 'https://ucp.dev/2026-08-25/specification/payment/extensions/ap2-mandates',
              schema: 'https://ucp.dev/2026-08-25/schemas/common/payment_ap2_mandate.json',
              extends: 'dev.ucp.shopping.checkout',
              config: {
                vp_formats_supported: {
                  'dc+sd-jwt': {}
                }
              }
            }
          ]
        },
        payment_handlers: {
          'com.google.pay': [
            {
              id: 'gpay_merchant_1',
              version: '2026-01-23',
              available_instruments: [{ type: 'card', constraints: { brands: ['visa'] } }],
              config: { environment: 'TEST' }
            }
          ]
        }
      }
    }

    expect(Value.Check(UcpProfileSchema, profile)).toBe(true)
  })

  it('models UCP cart as the mutable pre-checkout basket and checkout conversion by cart_id', () => {
    const cartRequest = {
      line_items: [
        {
          item: { id: 'sku_65w_charger' },
          quantity: 1
        }
      ],
      buyer: { email: 'shopper@example.com' }
    }
    const cart = {
      ucp: {
        version: UCP_STABLE_VERSION,
        status: 'success',
        capabilities: {
          'dev.ucp.shopping.cart': [{ version: UCP_STABLE_VERSION }]
        }
      },
      id: 'cart_1',
      status: 'active',
      currency: 'USD',
      line_items: [
        {
          id: 'cart_li_1',
          item: { id: 'sku_65w_charger', title: '65W USB-C Charger', price: 2999 },
          quantity: 1,
          totals: [{ type: 'total', amount: 2999 }]
        }
      ],
      totals: [
        { type: 'subtotal_estimate', amount: 2999, currency: 'USD' },
        { type: 'total_estimate', amount: 3299, currency: 'USD' }
      ],
      continue_url: 'https://merchant.example/cart/cart_1',
      links: [{ type: 'cart', url: 'https://merchant.example/cart/cart_1' }]
    }
    const checkoutFromCart = {
      cart_id: 'cart_1',
      buyer: { email: 'shopper@example.com' }
    }

    expect(Value.Check(UcpCartCreateRequestSchema, cartRequest)).toBe(true)
    expect(Value.Check(UcpCartSchema, cart)).toBe(true)
    expect(Value.Check(UcpCartOperationResponseSchema, cart)).toBe(true)
    expect(Value.Check(UcpCheckoutCreateRequestSchema, checkoutFromCart)).toBe(true)
  })

  it('keeps merchant checkout status and payment instrument payloads protocol-native', () => {
    const checkout = {
      ucp: {
        version: UCP_STABLE_VERSION,
        status: 'success',
        payment_handlers: {},
        capabilities: {
          'dev.ucp.shopping.checkout': [{ version: UCP_STABLE_VERSION }]
        }
      },
      id: 'chk_1',
      status: 'ready_for_complete',
      currency: 'USD',
      continue_url: 'https://merchant.example/checkout/chk_1',
      expires_at: '2026-07-11T00:05:00.000Z',
      buyer: {
        email: 'shopper@example.com'
      },
      line_items: [
        {
          id: 'li_1',
          item: { id: 'sku_1', title: 'USB-C charger', price: 2999 },
          quantity: 1,
          totals: [{ type: 'total', amount: 2999, currency: 'USD' }]
        }
      ],
      fulfillment: {
        methods: [{ id: 'standard', type: 'shipping' }]
      },
      payment: {
        instruments: [
          {
            id: 'pi_1',
            handler_id: 'gpay_merchant_1',
            type: 'card',
            selected: true,
            display: { brand: 'visa', last_digits: '4242' }
          }
        ]
      },
      totals: [{ type: 'total', amount: 3299, currency: 'USD' }],
      messages: [
        {
          type: 'info',
          content: 'Checkout is ready for complete.'
        }
      ],
      links: [{ type: 'checkout', url: 'https://merchant.example/checkout/chk_1' }]
    }

    expect(Value.Check(UcpCheckoutSchema, checkout)).toBe(true)
  })

  it('accepts minimal anonymous and digital UCP checkout responses without optional buyer, fulfillment, messages, or expiry fields', () => {
    const checkout = {
      ucp: {
        version: UCP_STABLE_VERSION,
        status: 'success',
        payment_handlers: {}
      },
      id: 'chk_digital_1',
      status: 'ready_for_complete',
      currency: 'USD',
      line_items: [
        {
          id: 'li_digital_1',
          item: { id: 'digital_sku_1', title: 'Digital download', price: 999 },
          quantity: 1,
          totals: [{ type: 'total', amount: 999 }]
        }
      ],
      totals: [{ type: 'total', amount: 999, currency: 'USD' }],
      links: [{ type: 'checkout', url: 'https://merchant.example/checkout/chk_digital_1' }]
    }

    expect(Value.Check(UcpCheckoutSchema, checkout)).toBe(true)
    expect(Value.Check(UcpCheckoutOperationResponseSchema, checkout)).toBe(true)
  })

  it('rejects checkout responses that omit the required top-level currency field', () => {
    const checkout = {
      ucp: { version: UCP_STABLE_VERSION, status: 'success' },
      id: 'chk_missing_currency',
      status: 'ready_for_complete',
      line_items: [],
      totals: [],
      links: []
    }

    expect(Value.Check(UcpCheckoutSchema, checkout)).toBe(false)
    expect(Value.Check(UcpCheckoutOperationResponseSchema, checkout)).toBe(false)
  })

  it('accepts UCP structured error responses without checkout IDs as checkout operation responses', () => {
    const errorResponse = {
      ucp: {
        version: UCP_STABLE_VERSION,
        status: 'error'
      },
      messages: [
        {
          type: 'error',
          code: 'all_out_of_stock',
          content: 'Every requested item is currently out of stock.',
          severity: 'unrecoverable'
        }
      ],
      continue_url: 'https://merchant.example/products/alternatives'
    }

    expect(Value.Check(UcpErrorResponseSchema, errorResponse)).toBe(true)
    expect(Value.Check(UcpCheckoutOperationResponseSchema, errorResponse)).toBe(true)
  })

  it('limits Arro transaction state to correlation rather than a second checkout machine', () => {
    expect(
      Value.Check(ArroUcpTransactionSchema, {
        transactionId: 'txn_1',
        integrationId: 'integration_1',
        merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
        merchantOrigin: 'https://merchant.example',
        ucpVersion: UCP_STABLE_VERSION,
        checkoutId: 'chk_1',
        selectedPaymentHandlerId: 'gpay_merchant_1',
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440000',
        lastCheckoutStatus: 'completed',
        orderId: 'order_1',
        orderPermalinkUrl: 'https://merchant.example/orders/order_1',
        createdAt: '2026-07-11T00:00:00.000Z',
        updatedAt: '2026-07-11T00:01:00.000Z'
      })
    ).toBe(true)
  })

  it('accepts full current-state Order webhook bodies for durable order continuity', () => {
    expect(
      Value.Check(UcpOrderWebhookEventSchema, {
        ucp: { version: UCP_STABLE_VERSION, status: 'success' },
        id: 'order_1',
        checkout_id: 'chk_1',
        permalink_url: 'https://merchant.example/orders/order_1',
        currency: 'USD',
        line_items: [
          {
            id: 'li_1',
            item: { id: 'sku_1', title: 'USB-C charger', price: 2999 },
            quantity: { original: 1, total: 1, fulfilled: 0 },
            totals: [{ type: 'total', amount: 2999, currency: 'USD' }],
            status: 'processing'
          }
        ],
        fulfillment: {
          events: []
        },
        totals: [{ type: 'total', amount: 3299, currency: 'USD' }]
      })
    ).toBe(true)
  })

  it('accepts extension-owned Actions on Checkout', () => {
    const checkout = {
      ucp: {
        version: UCP_STABLE_VERSION,
        status: 'success',
        capabilities: {
          'dev.ucp.shopping.checkout': [{ version: UCP_STABLE_VERSION }],
          'dev.ucp.common.payment.authentication': [{
            version: UCP_STABLE_VERSION,
            schema: 'https://ucp.dev/2026-08-25/schemas/common/payment_authentication.json',
            extends: 'dev.ucp.shopping.checkout'
          }]
        },
        payment_handlers: {}
      },
      id: 'chk_actions_1',
      status: 'requires_escalation',
      currency: 'USD',
      line_items: [],
      totals: [{ type: 'total', amount: 1000, currency: 'USD' }],
      links: [],
      payment: {
        instruments: [{
          id: 'pi_1',
          handler_id: 'merchant_tokenizer_1',
          type: 'card',
          selected: true,
          credential: { type: 'opaque_token', token: 'redacted' }
        }]
      },
      actions: {
        'dev.ucp.common.payment.three_ds_challenge': [{
          id: '3ds_1',
          config: {
            payment_instrument_id: 'pi_1',
            url: 'https://acs.example/challenge/3ds_1'
          }
        }]
      }
    }

    expect(Value.Check(UcpCheckoutSchema, checkout)).toBe(true)
  })

  it('requires services and payment handlers but not capabilities in business profiles', () => {
    const profile: UcpProfile = {
      ucp: {
        version: UCP_STABLE_VERSION,
        services: {},
        payment_handlers: {}
      },
      keys: [{ kid: 'merchant_1', kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }]
    }

    expect(Value.Check(UcpProfileSchema, profile)).toBe(true)
    expect(Value.Check(UcpBusinessProfileSchema, profile)).toBe(true)
    expect(businessProfileValidator.Check(profile)).toBe(true)
    expect(Value.Check(UcpBusinessProfileSchema, {
      ucp: { version: UCP_STABLE_VERSION, services: {} }
    })).toBe(false)

    expect(Value.Check(UcpBusinessProfileSchema, {
      ucp: {
        version: UCP_STABLE_VERSION,
        services: {},
        payment_handlers: {},
        capabilities: {
          'dev.ucp.shopping.checkout': [{ version: UCP_STABLE_VERSION }]
        }
      }
    })).toBe(false)
  })

  it('requires platform declaration spec/schema fields without changing handler versions', () => {
    const platform = {
      ucp: {
        version: UCP_STABLE_VERSION,
        services: {
          'dev.ucp.shopping': [{
            version: UCP_STABLE_VERSION,
            spec: 'https://ucp.dev/2026-08-25/specification/overview',
            schema: 'https://ucp.dev/2026-08-25/services/shopping/rest.openapi.json',
            transport: 'rest'
          }]
        },
        payment_handlers: {
          'com.google.pay': [{
            id: 'google-pay',
            version: '2026-01-23',
            spec: 'https://pay.google.com/about/business/',
            schema: 'https://pay.google.com/gp/p/ucp/2026-01-23/schema.json'
          }]
        }
      }
    }

    expect(Value.Check(UcpPlatformProfileSchema, platform)).toBe(true)
    expect(platformProfileValidator.Check(platform)).toBe(true)
    expect(Value.Check(UcpPlatformProfileSchema, {
      ...platform,
      ucp: {
        ...platform.ucp,
        payment_handlers: {
          'com.google.pay': [{ id: 'google-pay', version: '2026-01-23' }]
        }
      }
    })).toBe(false)
  })

  it('requires payment instrument ids while allowing absent credentials', () => {
    expect(Value.Check(UcpPaymentInstrumentSchema, {
      id: 'pi_1',
      handler_id: 'google-pay',
      type: 'card'
    })).toBe(true)
    expect(Value.Check(UcpPaymentInstrumentSchema, {
      handler_id: 'google-pay',
      type: 'card',
      credential: { type: 'token' }
    })).toBe(false)
  })

  it('keeps create, checkout response, and order line quantities distinct', () => {
    expect(Value.Check(UcpLineItemCreateRequestSchema, {
      item: { id: 'sku_1' },
      quantity: 2
    })).toBe(true)
    expect(Value.Check(UcpLineItemCreateRequestSchema, {
      item: { id: 'sku_1' },
      quantity: { total: 2 }
    })).toBe(false)

    const checkoutLine = {
      id: 'line_1',
      item: { id: 'sku_1', title: 'Charger', price: 2999 },
      quantity: 2,
      totals: [{ type: 'total', amount: 5998 }]
    }
    expect(Value.Check(UcpLineItemSchema, checkoutLine)).toBe(true)
    expect(Value.Check(UcpLineItemSchema, {
      ...checkoutLine,
      quantity: { total: 2 }
    })).toBe(false)

    expect(Value.Check(UcpOrderLineItemSchema, {
      ...checkoutLine,
      quantity: { original: 2, total: 2, fulfilled: 1 },
      status: 'partial'
    })).toBe(true)
    expect(Value.Check(UcpOrderLineItemSchema, {
      ...checkoutLine,
      status: 'processing'
    })).toBe(false)
  })

  it('validates canonical public JWK shape on profile keys', () => {
    const profile = {
      ucp: {
        version: UCP_STABLE_VERSION,
        services: {},
        payment_handlers: {}
      }
    }

    expect(Value.Check(UcpBusinessProfileSchema, {
      ...profile,
      keys: [{ kid: 'ec_1', kty: 'EC', crv: 'P-256', x: 'x', y: 'y', alg: 'ES256' }]
    })).toBe(true)
    const missingCoordinate = {
      ...profile,
      keys: [{ kid: 'ec_1', kty: 'EC', crv: 'P-256', x: 'x' }]
    }
    expect(Value.Check(UcpBusinessProfileSchema, missingCoordinate)).toBe(false)
    expect(businessProfileValidator.Check(missingCoordinate)).toBe(false)
    expect(Value.Check(UcpBusinessProfileSchema, {
      ...profile,
      keys: [{ kid: 'ec_1', kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'private' }]
    })).toBe(false)
  })

})
