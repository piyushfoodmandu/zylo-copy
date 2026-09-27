import { Elysia } from 'elysia'
import { describe, expect, it, vi } from 'vitest'
import { buildApp } from './app.ts'
import type { PurchaseOrchestrator } from './purchase-orchestrator.ts'

describe('Arro Google Pay Web reference route', () => {
  it('renders the official pay.js lifecycle from exact trusted action configuration', async () => {
    const purchases = {
      getPaymentAction: vi.fn().mockResolvedValue({
        actionId: 'action_google_1',
        purchaseId: 'purchase_google_1',
        status: 'pending_user_approval',
        actionType: 'google_pay',
        provider: 'com.google.pay',
        handlerId: 'merchant_google_pay_1',
        handlerName: 'com.google.pay',
        merchantOrigin: 'https://merchant.example',
        checkoutId: 'checkout_google_1',
        checkoutSnapshotHash: `sha256:${'1'.repeat(64)}`,
        amount: 3299,
        currency: 'USD',
        presentation: 'external_action',
        expiresAt: '2099-07-13T00:00:00.000Z',
        message: 'Approve Google Pay for this merchant checkout.',
        action: {
          kind: 'google_pay',
          paymentRequest: {
            apiVersion: 2,
            apiVersionMinor: 0,
            environment: 'TEST',
            allowedPaymentMethods: [{
              type: 'CARD',
              parameters: {
                allowedAuthMethods: ['PAN_ONLY'],
                allowedCardNetworks: ['VISA', 'MASTERCARD']
              },
              tokenizationSpecification: {
                type: 'PAYMENT_GATEWAY',
                parameters: { gateway: 'example', gatewayMerchantId: 'merchant-1' }
              }
            }],
            merchantInfo: {
              merchantId: 'merchant-1',
              merchantName: 'Reference Merchant',
              merchantOrigin: 'https://merchant.example'
            },
            transactionInfo: {
              totalPriceStatus: 'FINAL',
              totalPrice: '32.99',
              currencyCode: 'USD'
            }
          }
        }
      })
    } as unknown as PurchaseOrchestrator
    const app = buildApp(new Elysia(), {
      purchaseOrchestrator: purchases,
      publicBaseUrl: 'https://arro.example',
      googlePayAllowedOrigins: ['https://arro.example']
    })

    const response = await app.handle(new Request('http://localhost/v1/payment-actions/arro_pa1_reference_google_action', {
      headers: { accept: 'text/html' }
    }))
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-security-policy')).toContain('https://pay.google.com')
    expect(html).toContain('https://pay.google.com/gp/p/js/pay.js')
    expect(html.match(/new google\.payments\.api\.PaymentsClient/g)).toHaveLength(1)
    expect(html).toContain('isReadyToPay')
    expect(html).toContain('createButton')
    expect(html).toContain('loadPaymentData')
    expect(html).toContain('"totalPrice":"32.99"')
    expect(html).toContain("type: 'google_pay_payment_data'")
    expect(html).toContain("source: 'web'")
    expect(html).toContain("'idempotency-key': paymentAction.actionId + ':google-pay-web-result'")
    expect(html).toContain("credentials: 'omit'")
    expect(html).toContain('Reference Merchant')
    expect(html).not.toContain('Arro merchant checkout')
  })

  it('accepts a native result without browser Origin only for a host-native action', async () => {
    const purchases = {
      getPaymentAction: vi.fn().mockResolvedValue({
        actionId: 'action_google_native_1',
        presentation: 'host_native'
      }),
      recordPaymentActionResult: vi.fn().mockResolvedValue({
        purchaseId: 'purchase_google_native_1',
        state: 'awaiting_confirmation'
      })
    } as unknown as PurchaseOrchestrator
    const app = buildApp(new Elysia(), {
      purchaseOrchestrator: purchases,
      publicBaseUrl: 'https://arro.example',
      googlePayAllowedOrigins: ['https://arro.example']
    })
    const response = await app.handle(new Request(
      'http://localhost/v1/payment-actions/arro_pa1_reference_google_native/result',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'google-native-result-1'
        },
        body: JSON.stringify({
          result: {
            type: 'google_pay_payment_data',
            source: 'native',
            paymentData: {
              apiVersion: 2,
              apiVersionMinor: 0,
              paymentMethodData: {
                type: 'CARD',
                tokenizationData: {
                  type: 'PAYMENT_GATEWAY',
                  token: '{"opaque":"native-google-pay-result"}'
                }
              }
            }
          }
        })
      }
    ))

    expect(response.status).toBe(200)
    expect(purchases.recordPaymentActionResult).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'google-native-result-1',
      result: expect.objectContaining({ source: 'native' })
    }))
  })

  it('rejects a native result for a browser-presented action', async () => {
    const purchases = {
      getPaymentAction: vi.fn().mockResolvedValue({
        actionId: 'action_google_web_1',
        presentation: 'external_action'
      }),
      recordPaymentActionResult: vi.fn()
    } as unknown as PurchaseOrchestrator
    const app = buildApp(new Elysia(), {
      purchaseOrchestrator: purchases,
      publicBaseUrl: 'https://arro.example',
      googlePayAllowedOrigins: ['https://arro.example']
    })
    const response = await app.handle(new Request(
      'http://localhost/v1/payment-actions/arro_pa1_reference_google_web/result',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'google-native-result-2'
        },
        body: JSON.stringify({
          result: {
            type: 'google_pay_payment_data',
            source: 'native',
            paymentData: {
              apiVersion: 2,
              apiVersionMinor: 0,
              paymentMethodData: {
                type: 'CARD',
                tokenizationData: {
                  type: 'PAYMENT_GATEWAY',
                  token: '{"opaque":"mismatched-google-pay-result"}'
                }
              }
            }
          }
        })
      }
    ))

    expect(response.status).toBe(403)
    expect(purchases.recordPaymentActionResult).not.toHaveBeenCalled()
  })

  it('keeps browser Origin enforcement for web results', async () => {
    const purchases = {
      getPaymentAction: vi.fn().mockResolvedValue({
        actionId: 'action_google_web_origin_1',
        presentation: 'external_action'
      }),
      recordPaymentActionResult: vi.fn().mockResolvedValue({
        purchaseId: 'purchase_google_web_origin_1',
        state: 'awaiting_confirmation'
      })
    } as unknown as PurchaseOrchestrator
    const app = buildApp(new Elysia(), {
      purchaseOrchestrator: purchases,
      publicBaseUrl: 'https://arro.example',
      googlePayAllowedOrigins: ['https://arro.example']
    })
    const body = JSON.stringify({
      result: {
        type: 'google_pay_payment_data',
        source: 'web',
        paymentData: {
          apiVersion: 2,
          apiVersionMinor: 0,
          paymentMethodData: {
            type: 'CARD',
            tokenizationData: {
              type: 'PAYMENT_GATEWAY',
              token: '{"opaque":"web-google-pay-result"}'
            }
          }
        }
      }
    })
    const resultUrl = 'http://localhost/v1/payment-actions/arro_pa1_reference_google_web_origin/result'
    const missingOrigin = await app.handle(new Request(resultUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'google-web-result-1'
      },
      body
    }))
    expect(missingOrigin.status).toBe(403)
    expect(purchases.recordPaymentActionResult).not.toHaveBeenCalled()

    const allowedOrigin = await app.handle(new Request(resultUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'google-web-result-2',
        origin: 'https://arro.example'
      },
      body
    }))
    expect(allowedOrigin.status).toBe(200)
    expect(purchases.recordPaymentActionResult).toHaveBeenCalledOnce()
  })
})
