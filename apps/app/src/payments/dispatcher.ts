import {
  createPurchasePaymentActionSession,
  submitPurchasePaymentActionResult
} from '../api/client'
import type {
  PurchasePaymentActionResponse,
  PurchasePaymentActionResult,
  PurchaseResponse,
  StripePaymentActionSession
} from '../types/purchase'
import {
  googlePayRequestFromAction,
  googlePayResultFromPaymentData,
  type MerchantGooglePayPaymentRequest,
  type NativeGooglePayAdapter,
  type NativeGooglePayPresentation
} from './google-pay'
import { nativeGooglePay } from './native-google-pay'
import {
  nativeStripePayment,
  type NativeStripePaymentAdapter,
  type NativeStripePaymentPresentation
} from './stripe-payment-sheet'

export type PaymentActionExecution =
  | {
      status: 'result_submitted'
      /** This state comes from the purchase runtime; only `completed` is an order. */
      purchase: PurchaseResponse
    }
  | { status: 'canceled' }
  | {
      status: 'unavailable'
      reason: string
      fallback: 'request_external_action' | 'none'
    }
  | {
      status: 'external_action_required'
      actionUrl: string
      presentation: 'external_action' | 'merchant_hosted'
    }
  | { status: 'failed'; message: string }

export type PaymentActionDispatcherDependencies = {
  googlePay: NativeGooglePayAdapter
  stripe: NativeStripePaymentAdapter
  createStripeSession: (actionToken: string) => Promise<StripePaymentActionSession>
  submitResult: (
    actionToken: string,
    result: PurchasePaymentActionResult,
    idempotencyKey: string
  ) => Promise<PurchaseResponse>
  now: () => number
}

export type PreparedPaymentAction =
  | {
      status: 'native_ready'
      nativeProvider: 'google_pay'
      action: PurchasePaymentActionResponse & { actionToken: string }
      request: MerchantGooglePayPaymentRequest
      /** The official PaymentRequest instance that already passed canMakePayment. */
      present(): Promise<NativeGooglePayPresentation>
    }
  | {
      status: 'native_ready'
      nativeProvider: 'stripe'
      action: PurchasePaymentActionResponse & { actionToken: string }
      session: StripePaymentActionSession
      present(): Promise<NativeStripePaymentPresentation>
    }
  | {
      status: 'external_action_required'
      actionUrl: string
      presentation: 'external_action' | 'merchant_hosted'
    }
  | {
      status: 'unavailable'
      reason: string
      fallback: 'request_external_action' | 'none'
    }

const defaultDependencies: PaymentActionDispatcherDependencies = {
  googlePay: nativeGooglePay,
  stripe: nativeStripePayment,
  createStripeSession: createPurchasePaymentActionSession,
  submitResult: submitPurchasePaymentActionResult,
  now: Date.now
}

const messageFrom = (error: unknown) =>
  error instanceof Error && error.message.trim()
    ? error.message
    : 'The payment result could not be recorded. Your order has not been placed.'

const preparationMessageFrom = (error: unknown) =>
  error instanceof Error && error.message.trim()
    ? error.message
    : 'The shop could not prepare this native payment. Refresh checkout and try again.'

/**
 * Resolve and preflight the presentation selected by the signed payment
 * action. A host-native action reaches `native_ready` only after its installed
 * provider SDK has validated and initialized the exact merchant request.
 */
export const createPaymentActionPreparer = (
  overrides: Partial<PaymentActionDispatcherDependencies> = {}
) => async (action: PurchasePaymentActionResponse): Promise<PreparedPaymentAction> => {
  const dependencies = { ...defaultDependencies, ...overrides }
  if (action.presentation === 'external_action' || action.presentation === 'merchant_hosted') {
    return action.actionUrl
      ? {
          status: 'external_action_required',
          actionUrl: action.actionUrl,
          presentation: action.presentation
        }
      : {
          status: 'unavailable',
          reason: 'This payment action did not include its external destination.',
          fallback: 'none'
        }
  }

  if (action.presentation !== 'host_native') {
    return {
      status: 'unavailable',
      reason: 'This version of Arro cannot render the selected payment component.',
      fallback: 'request_external_action'
    }
  }

  if (action.status !== 'pending_user_approval' && action.status !== 'approved') {
    return {
      status: 'unavailable',
      reason: `This payment action is ${action.status.replaceAll('_', ' ')}.`,
      fallback: 'none'
    }
  }

  const expiresAt = Date.parse(action.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= dependencies.now()) {
    return {
      status: 'unavailable',
      reason: 'This payment action has expired.',
      fallback: 'request_external_action'
    }
  }

  const actionKind = action.action && typeof action.action === 'object' && !Array.isArray(action.action)
    ? action.action.kind
    : undefined
  if (
    action.actionType === 'processor_tokenizer' &&
    actionKind === 'stripe_payment_sheet'
  ) {
    if (!action.actionToken) {
      return {
        status: 'unavailable',
        reason: 'This native Stripe action cannot create its short-lived session.',
        fallback: 'request_external_action'
      }
    }
    let session: StripePaymentActionSession
    try {
      session = await dependencies.createStripeSession(action.actionToken)
    } catch (error) {
      return {
        status: 'unavailable',
        reason: preparationMessageFrom(error),
        fallback: 'request_external_action'
      }
    }
    if (
      session.paymentIntentId.length === 0 ||
      session.currency !== action.currency ||
      session.amount !== action.amount
    ) {
      return {
        status: 'unavailable',
        reason: 'The live Stripe session does not match this payment action.',
        fallback: 'none'
      }
    }
    const preparation = await dependencies.stripe.prepare(session)
    if (preparation.status === 'unavailable') {
      return {
        status: 'unavailable',
        reason: preparation.reason,
        fallback: 'request_external_action'
      }
    }
    // `approved` means this exact bound PaymentIntent was already returned
    // after a successful sheet confirmation, but merchant tokenization did not
    // finish. This survives an app restart: resubmit the reference without
    // presenting or authorizing it a second time.
    let confirmed = action.status === 'approved'
    return {
      status: 'native_ready',
      nativeProvider: 'stripe',
      action: { ...action, actionToken: action.actionToken },
      session,
      present: async () => {
        if (confirmed) return { status: 'succeeded' as const }
        const outcome = await preparation.payment.present()
        if (outcome.status === 'succeeded') confirmed = true
        return outcome
      }
    }
  }

  if (
    action.actionType !== 'google_pay' ||
    action.provider !== 'com.google.pay' ||
    action.handlerName !== 'com.google.pay'
  ) {
    return {
      status: 'unavailable',
      reason: 'No native executor is installed for this payment action.',
      fallback: 'request_external_action'
    }
  }

  if (!action.actionToken) {
    return {
      status: 'unavailable',
      reason: 'This native payment action cannot return its result securely.',
      fallback: 'request_external_action'
    }
  }

  const merchantRequest = googlePayRequestFromAction(action, dependencies.googlePay.environment)
  if (!merchantRequest.ok) {
    return {
      status: 'unavailable',
      reason: merchantRequest.reason,
      fallback: 'request_external_action'
    }
  }

  const preparation = await dependencies.googlePay.prepare(merchantRequest.request)
  if (preparation.status === 'unavailable') {
    return {
      status: 'unavailable',
      reason: preparation.reason,
      fallback: 'request_external_action'
    }
  }

  return {
    status: 'native_ready',
    nativeProvider: 'google_pay',
    action: { ...action, actionToken: action.actionToken },
    request: merchantRequest.request,
    present: preparation.present
  }
}

/**
 * Execute a presentation that was already negotiated and preflighted. The
 * checkout UI calls Google Pay only from its official branded control and
 * Stripe only from the explicit secure-payment control.
 */
export const createPreparedPaymentActionExecutor = (
  overrides: Partial<PaymentActionDispatcherDependencies> = {}
) => async (prepared: PreparedPaymentAction): Promise<PaymentActionExecution> => {
  const dependencies = { ...defaultDependencies, ...overrides }
  if (prepared.status === 'external_action_required') return prepared
  if (prepared.status === 'unavailable') return prepared

  const { action } = prepared
  const expiresAt = Date.parse(action.expiresAt)
  if (!Number.isFinite(expiresAt) || expiresAt <= dependencies.now()) {
    return {
      status: 'unavailable',
      reason: 'This payment action has expired.',
      fallback: 'request_external_action'
    }
  }

  const presented = await prepared.present()
  if (presented.status === 'canceled') return { status: 'canceled' }
  if (presented.status === 'unavailable') {
    return {
      status: 'unavailable',
      reason: presented.reason,
      fallback: 'request_external_action'
    }
  }
  if (presented.status === 'failed') {
    return { status: 'failed', message: presented.message }
  }

  let result: PurchasePaymentActionResult
  if (prepared.nativeProvider === 'stripe') {
    if (presented.status !== 'succeeded') {
      return { status: 'failed', message: 'Stripe returned no successful payment confirmation.' }
    }
    result = {
      type: 'stripe_payment_intent',
      paymentIntentId: prepared.session.paymentIntentId
    }
  } else {
    if (presented.status !== 'approved' || !('paymentData' in presented)) {
      return { status: 'failed', message: 'Google Pay returned no payment data.' }
    }
    const parsed = googlePayResultFromPaymentData(presented.paymentData)
    if (!parsed.ok) return { status: 'failed', message: parsed.reason }
    result = parsed.result
  }

  try {
    // Recording a checkout-scoped credential is only the end of this payment
    // action. The merchant's later Purchase/Order response remains the sole
    // source of truth for whether an order exists.
    return {
      status: 'result_submitted',
      purchase: await dependencies.submitResult(
        action.actionToken,
        result,
        `${action.actionId}:native-${prepared.nativeProvider === 'google_pay' ? 'google-pay' : 'stripe'}-result`
      )
    }
  } catch (error) {
    return { status: 'failed', message: messageFrom(error) }
  }
}

export const preparePaymentAction = createPaymentActionPreparer()
export const executePreparedPaymentAction = createPreparedPaymentActionExecutor()
