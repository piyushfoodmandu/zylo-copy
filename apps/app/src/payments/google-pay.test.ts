import { describe, expect, it } from 'vitest'
import type { PurchasePaymentActionResponse } from '../types/purchase'
import {
  createNativeGooglePayAdapter,
  googlePayRequestFromAction,
  type GooglePayPaymentRequestConstructor,
  type MerchantGooglePayPaymentRequest
} from './google-pay'

const paymentRequest = (): MerchantGooglePayPaymentRequest => ({
  apiVersion: 2,
  apiVersionMinor: 0,
  environment: 'TEST',
  merchantInfo: {
    merchantId: '01234567890123456789',
    merchantName: 'Merchant supplied name'
  },
  allowedPaymentMethods: [{
    type: 'CARD',
    parameters: {
      allowedAuthMethods: ['PAN_ONLY'],
      allowedCardNetworks: ['VISA', 'MASTERCARD']
    },
    tokenizationSpecification: {
      type: 'PAYMENT_GATEWAY',
      parameters: {
        gateway: 'example',
        gatewayMerchantId: 'merchant-gateway-id'
      }
    }
  }],
  transactionInfo: {
    totalPriceStatus: 'FINAL',
    totalPrice: '14.95',
    currencyCode: 'USD',
    countryCode: 'US'
  }
})

const paymentAction = (): PurchasePaymentActionResponse => ({
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
  amount: 1495,
  currency: 'USD',
  expiresAt: '2099-01-01T00:00:00.000Z',
  actionToken: 'arro_pa1_signed-action',
  actionUrl: 'https://api.example/v1/payment-actions/arro_pa1_signed-action',
  action: {
    kind: 'google_pay',
    presentation: 'host_native',
    paymentRequest: paymentRequest()
  },
  message: 'Approve in Arro.'
})

describe('merchant Google Pay request', () => {
  it('retains and binds handler environment until the final native SDK boundary', () => {
    const action = paymentAction()
    const original = (action.action as { paymentRequest: MerchantGooglePayPaymentRequest }).paymentRequest
    const parsed = googlePayRequestFromAction(action, 'TEST')

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.request).toEqual(original)
    expect(parsed.request).not.toBe(original)
    expect(parsed.request.environment).toBe('TEST')

    expect(googlePayRequestFromAction(action, 'PRODUCTION')).toMatchObject({ ok: false })
  })

  it('accepts optional country but fails closed when signed total binding is wrong', () => {
    const withoutCountry = paymentAction()
    delete ((withoutCountry.action as { paymentRequest: MerchantGooglePayPaymentRequest })
      .paymentRequest.transactionInfo as Record<string, unknown>).countryCode
    expect(googlePayRequestFromAction(withoutCountry, 'TEST')).toMatchObject({ ok: true })

    const wrongTotal = paymentAction()
    ;(wrongTotal.action as { paymentRequest: MerchantGooglePayPaymentRequest })
      .paymentRequest.transactionInfo.totalPrice = '15.95'
    expect(googlePayRequestFromAction(wrongTotal, 'TEST')).toMatchObject({ ok: false })
  })

  it('rejects payment methods outside the installed native executor contract', () => {
    const unsupportedAuth = paymentAction()
    ;((unsupportedAuth.action as { paymentRequest: MerchantGooglePayPaymentRequest })
      .paymentRequest.allowedPaymentMethods[0]!.parameters as Record<string, unknown>)
      .allowedAuthMethods = ['CRYPTOGRAM_3DS']
    expect(googlePayRequestFromAction(unsupportedAuth, 'TEST')).toMatchObject({ ok: false })

    const unsupportedNetwork = paymentAction()
    ;((unsupportedNetwork.action as { paymentRequest: MerchantGooglePayPaymentRequest })
      .paymentRequest.allowedPaymentMethods[0]!.parameters as Record<string, unknown>)
      .allowedCardNetworks = ['NOT_A_NETWORK']
    expect(googlePayRequestFromAction(unsupportedNetwork, 'TEST')).toMatchObject({ ok: false })

    const unsupportedNativeTokenization = paymentAction()
    ;((unsupportedNativeTokenization.action as { paymentRequest: MerchantGooglePayPaymentRequest })
      .paymentRequest.allowedPaymentMethods[0]!.tokenizationSpecification as Record<string, unknown>)
      .type = 'DIRECT'
    expect(googlePayRequestFromAction(unsupportedNativeTokenization, 'TEST')).toMatchObject({ ok: false })
  })

  it('requires the payload kind and presentation to match the action envelope', () => {
    const wrongKind = paymentAction()
    ;(wrongKind.action as Record<string, unknown>).kind = 'processor_tokenizer_action'
    expect(googlePayRequestFromAction(wrongKind, 'TEST')).toMatchObject({ ok: false })

    const wrongPresentation = paymentAction()
    ;(wrongPresentation.action as Record<string, unknown>).presentation = 'external_action'
    expect(googlePayRequestFromAction(wrongPresentation, 'TEST')).toMatchObject({ ok: false })
  })
})

describe('native Google Pay adapter', () => {
  it('uses the merchant request in the official PaymentRequest facade', async () => {
    const request = paymentRequest()
    const { environment: _environment, ...nativeRequest } = request
    const paymentData = { apiVersion: 2, apiVersionMinor: 0, paymentMethodData: {} }
    let capturedMethods: unknown
    let capturedDetails: unknown

    class FakePaymentRequest {
      constructor(methods: unknown, details: unknown) {
        capturedMethods = methods
        capturedDetails = details
      }

      async canMakePayment() { return true }
      async show() { return paymentData }
    }

    const adapter = createNativeGooglePayAdapter(
      FakePaymentRequest as unknown as GooglePayPaymentRequestConstructor,
      'TEST'
    )

    const prepared = await adapter.prepare(request)
    expect(prepared.status).toBe('ready')
    if (prepared.status !== 'ready') return
    // Preflight does not present the sheet.
    expect(capturedMethods).toEqual([{ supportedMethods: 'google_pay', data: nativeRequest }])
    await expect(prepared.present()).resolves.toEqual({ status: 'approved', paymentData })
    expect(capturedMethods).toEqual([{ supportedMethods: 'google_pay', data: nativeRequest }])
    expect(capturedDetails).toEqual({
      total: {
        label: 'Merchant supplied name',
        amount: { currency: 'USD', value: '14.95' }
      }
    })
  })

  it('preserves a user cancellation instead of turning it into failure', async () => {
    class CanceledPaymentRequest {
      async canMakePayment() { return true }
      async show() { return null }
    }
    const adapter = createNativeGooglePayAdapter(
      CanceledPaymentRequest as unknown as GooglePayPaymentRequestConstructor,
      'TEST'
    )

    const prepared = await adapter.prepare(paymentRequest())
    expect(prepared.status).toBe('ready')
    if (prepared.status !== 'ready') return
    await expect(prepared.present()).resolves.toEqual({ status: 'canceled' })
  })

  it('checks readiness without presenting the Google Pay sheet', async () => {
    let showCount = 0
    class UnavailablePaymentRequest {
      async canMakePayment() { return false }
      async show() {
        showCount += 1
        return null
      }
    }
    const adapter = createNativeGooglePayAdapter(
      UnavailablePaymentRequest as unknown as GooglePayPaymentRequestConstructor,
      'TEST'
    )

    await expect(adapter.prepare(paymentRequest())).resolves.toEqual({
      status: 'unavailable',
      reason: 'Google Pay is not ready on this device.'
    })
    expect(showCount).toBe(0)
  })
})
