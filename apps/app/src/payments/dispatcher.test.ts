import { describe, expect, it, vi } from 'vitest'
import type {
  PurchasePaymentActionResponse,
  PurchasePaymentActionResult,
  PurchaseResponse,
  StripePaymentActionSession
} from '../types/purchase'
import {
  createPaymentActionPreparer,
  createPreparedPaymentActionExecutor
} from './dispatcher'
import type { NativeGooglePayAdapter } from './google-pay'
import type { NativeStripePaymentAdapter } from './stripe-payment-sheet'

const request = {
  apiVersion: 2,
  apiVersionMinor: 0,
  environment: 'TEST',
  merchantInfo: {
    merchantId: '01234567890123456789',
    merchantName: 'Example Merchant'
  },
  allowedPaymentMethods: [{
    type: 'CARD',
    parameters: {
      allowedAuthMethods: ['PAN_ONLY'],
      allowedCardNetworks: ['VISA']
    },
    tokenizationSpecification: {
      type: 'PAYMENT_GATEWAY',
      parameters: { gateway: 'example', gatewayMerchantId: 'merchant-1' }
    }
  }],
  transactionInfo: {
    totalPriceStatus: 'FINAL',
    totalPrice: '14.95',
    currencyCode: 'USD',
    countryCode: 'US'
  }
}

const action = (overrides: Partial<PurchasePaymentActionResponse> = {}): PurchasePaymentActionResponse => ({
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
  action: { kind: 'google_pay', presentation: 'host_native', paymentRequest: request },
  message: 'Approve in Arro.',
  ...overrides
})

const paymentData = {
  apiVersion: 2,
  apiVersionMinor: 0,
  paymentMethodData: {
    type: 'CARD',
    description: 'Visa •••• 4242',
    info: { cardNetwork: 'VISA', cardDetails: '4242', unexpected: 'removed' },
    tokenizationData: {
      type: 'PAYMENT_GATEWAY',
      token: '{"opaque":"checkout-scoped"}'
    }
  },
  unexpected: 'removed'
}

const purchaseResponse: PurchaseResponse = {
  purchaseId: 'ucptx_purchase_1',
  state: 'ready_for_autonomous_completion',
  executionLevel: 'direct_payment',
  merchant: {
    merchantId: 'merchant-1',
    canonicalOrigin: 'https://merchant.example',
    profileUrl: 'https://merchant.example/.well-known/ucp'
  },
  items: [{ itemId: 'item-1' }],
  links: [],
  payment: {
    completedByArro: false,
    executionLevel: 'direct_payment'
  },
  messages: [],
  nextAction: { type: 'confirm_purchase', label: 'Place order' }
}

const stripeSession: StripePaymentActionSession = {
  provider: 'stripe',
  livemode: true,
  publishableKey: 'pk_live_merchant_123',
  paymentIntentClientSecret: 'pi_checkout_123_secret_checkout_456',
  paymentIntentId: 'pi_checkout_123',
  stripeAccountId: 'acct_merchant_123',
  merchantDisplayName: 'Example Merchant',
  merchantCountryCode: 'US',
  currency: 'USD',
  amount: 1495,
  captureMethod: 'manual',
  paymentMethodTypes: ['card'],
  allowedCardBrands: ['visa', 'mastercard'],
  expiresAt: '2099-01-01T00:00:00.000Z'
}

const stripeAction = (overrides: Partial<PurchasePaymentActionResponse> = {}) => action({
  actionType: 'processor_tokenizer',
  provider: 'com.merchant.stripe',
  handlerId: 'merchant_stripe_1',
  handlerName: 'com.merchant.stripe',
  action: {
    kind: 'stripe_payment_sheet',
    presentation: 'host_native'
  },
  ...overrides
})

const dispatcher = (googlePay: NativeGooglePayAdapter) => {
  const submitted = vi.fn(async (
    _token: string,
    _result: PurchasePaymentActionResult,
    _idempotencyKey: string
  ) => purchaseResponse)
  const dependencies = {
    googlePay,
    submitResult: submitted,
    now: () => Date.parse('2026-09-01T00:00:00.000Z')
  }
  return {
    submitted,
    prepare: createPaymentActionPreparer(dependencies),
    execute: createPreparedPaymentActionExecutor(dependencies)
  }
}

describe('payment action dispatcher', () => {
  it('submits native Google Pay data without claiming that an order succeeded', async () => {
    const { prepare, execute, submitted } = dispatcher({
      environment: 'TEST',
      async prepare() {
        return {
          status: 'ready',
          async present() { return { status: 'approved', paymentData } }
        }
      }
    })

    const prepared = await prepare(action())
    const outcome = await execute(prepared)

    expect(outcome.status).toBe('result_submitted')
    expect(outcome).not.toHaveProperty('order')
    expect(submitted).toHaveBeenCalledWith(
      'arro_pa1_signed-action',
      {
        type: 'google_pay_payment_data',
        source: 'native',
        paymentData: {
          apiVersion: 2,
          apiVersionMinor: 0,
          paymentMethodData: {
            type: 'CARD',
            description: 'Visa •••• 4242',
            info: { cardNetwork: 'VISA', cardDetails: '4242' },
            tokenizationData: {
              type: 'PAYMENT_GATEWAY',
              token: '{"opaque":"checkout-scoped"}'
            }
          }
        }
      },
      'arro_pa_action_1:native-google-pay-result'
    )
  })

  it('preserves cancellation and never submits a result', async () => {
    const { prepare, execute, submitted } = dispatcher({
      environment: 'TEST',
      async prepare() {
        return {
          status: 'ready',
          async present() { return { status: 'canceled' } }
        }
      }
    })

    await expect(execute(await prepare(action()))).resolves.toEqual({ status: 'canceled' })
    expect(submitted).not.toHaveBeenCalled()
  })

  it('does not turn a host-native action URL into a browser fallback', async () => {
    const { prepare, submitted } = dispatcher({
      environment: 'TEST',
      async prepare() { return { status: 'unavailable', reason: 'No wallet is ready.' } }
    })

    const outcome = await prepare(action())

    expect(outcome).toEqual({
      status: 'unavailable',
      reason: 'No wallet is ready.',
      fallback: 'request_external_action'
    })
    expect(outcome).not.toHaveProperty('actionUrl')
    expect(submitted).not.toHaveBeenCalled()
  })

  it('returns an external destination only for an explicitly external action', async () => {
    const googlePay = { environment: 'TEST', prepare: vi.fn() }
    const { prepare, execute } = dispatcher(googlePay as unknown as NativeGooglePayAdapter)

    const prepared = await prepare(action({ presentation: 'external_action' }))
    await expect(execute(prepared)).resolves.toEqual({
      status: 'external_action_required',
      actionUrl: 'https://api.example/v1/payment-actions/arro_pa1_signed-action',
      presentation: 'external_action'
    })
    expect(googlePay.prepare).not.toHaveBeenCalled()
  })

  it('submits only the confirmed live Stripe PaymentIntent reference', async () => {
    const present = vi.fn(async () => ({ status: 'succeeded' as const }))
    const stripe: NativeStripePaymentAdapter = {
      async prepare(session) {
        expect(session).toEqual(stripeSession)
        return { status: 'ready', payment: { present } }
      }
    }
    const createStripeSession = vi.fn(async () => stripeSession)
    const submitResult = vi.fn(async () => purchaseResponse)
    const dependencies = {
      stripe,
      createStripeSession,
      submitResult,
      now: () => Date.parse('2026-09-01T00:00:00.000Z')
    }
    const prepare = createPaymentActionPreparer(dependencies)
    const execute = createPreparedPaymentActionExecutor(dependencies)

    const prepared = await prepare(stripeAction())
    await expect(execute(prepared)).resolves.toEqual({
      status: 'result_submitted',
      purchase: purchaseResponse
    })
    expect(createStripeSession).toHaveBeenCalledWith('arro_pa1_signed-action')
    expect(present).toHaveBeenCalledOnce()
    expect(submitResult).toHaveBeenCalledWith(
      'arro_pa1_signed-action',
      {
        type: 'stripe_payment_intent',
        paymentIntentId: stripeSession.paymentIntentId
      },
      'arro_pa_action_1:native-stripe-result'
    )
  })

  it('preserves Stripe PaymentSheet cancellation without submitting a result', async () => {
    const submitResult = vi.fn(async () => purchaseResponse)
    const dependencies = {
      stripe: {
        async prepare() {
          return {
            status: 'ready' as const,
            payment: { async present() { return { status: 'canceled' as const } } }
          }
        }
      },
      createStripeSession: async () => stripeSession,
      submitResult,
      now: () => Date.parse('2026-09-01T00:00:00.000Z')
    }
    const prepared = await createPaymentActionPreparer(dependencies)(stripeAction())

    await expect(createPreparedPaymentActionExecutor(dependencies)(prepared)).resolves.toEqual({
      status: 'canceled'
    })
    expect(submitResult).not.toHaveBeenCalled()
  })

  it('retries result delivery after confirmation without presenting or charging twice', async () => {
    const present = vi.fn(async () => ({ status: 'succeeded' as const }))
    const submitResult = vi.fn()
      .mockRejectedValueOnce(new Error('Temporary API interruption'))
      .mockResolvedValueOnce(purchaseResponse)
    const dependencies = {
      stripe: {
        async prepare() {
          return { status: 'ready' as const, payment: { present } }
        }
      },
      createStripeSession: async () => stripeSession,
      submitResult,
      now: () => Date.parse('2026-09-01T00:00:00.000Z')
    }
    const prepared = await createPaymentActionPreparer(dependencies)(stripeAction())
    const execute = createPreparedPaymentActionExecutor(dependencies)

    await expect(execute(prepared)).resolves.toEqual({
      status: 'failed',
      message: 'Temporary API interruption'
    })
    await expect(execute(prepared)).resolves.toEqual({
      status: 'result_submitted',
      purchase: purchaseResponse
    })
    expect(present).toHaveBeenCalledOnce()
    expect(submitResult).toHaveBeenCalledTimes(2)
  })

  it('recovers an approved Stripe action after restart without presenting again', async () => {
    const present = vi.fn(async () => ({ status: 'succeeded' as const }))
    const submitResult = vi.fn(async () => purchaseResponse)
    const dependencies = {
      stripe: {
        async prepare() {
          return { status: 'ready' as const, payment: { present } }
        }
      },
      createStripeSession: async () => stripeSession,
      submitResult,
      now: () => Date.parse('2026-09-01T00:00:00.000Z')
    }
    const prepared = await createPaymentActionPreparer(dependencies)(
      stripeAction({ status: 'approved' })
    )

    await expect(createPreparedPaymentActionExecutor(dependencies)(prepared)).resolves.toEqual({
      status: 'result_submitted',
      purchase: purchaseResponse
    })
    expect(present).not.toHaveBeenCalled()
    expect(submitResult).toHaveBeenCalledWith(
      'arro_pa1_signed-action',
      {
        type: 'stripe_payment_intent',
        paymentIntentId: stripeSession.paymentIntentId
      },
      'arro_pa_action_1:native-stripe-result'
    )
  })
})
