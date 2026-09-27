import {
  CardBrandAcceptanceFilter,
  CardBrandCategory,
  initPaymentSheet,
  initStripe,
  presentPaymentSheet
} from '@stripe/stripe-react-native'
import * as Linking from 'expo-linking'
import { Platform } from 'react-native'
import type { StripePaymentActionSession } from '../types/purchase'
import type {
  NativeStripePaymentAdapter,
  NativeStripePaymentPresentation
} from './stripe-payment-sheet'

const errorText = (error: unknown, fallback: string) => {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return fallback
}

let presentationQueue: Promise<void> = Promise.resolve()

const exclusively = async <T>(work: () => Promise<T>): Promise<T> => {
  const run = presentationQueue.then(work, work)
  presentationQueue = run.then(() => undefined, () => undefined)
  return run
}

const present = async (
  session: StripePaymentActionSession
): Promise<NativeStripePaymentPresentation> => exclusively(async () => {
  try {
    if (Date.parse(session.expiresAt) <= Date.now()) {
      return {
        status: 'failed',
        message: 'The Stripe payment session expired. Refresh checkout and try again.'
      }
    }
    await initStripe({
      publishableKey: session.publishableKey,
      ...(session.stripeAccountId ? { stripeAccountId: session.stripeAccountId } : {}),
      urlScheme: 'arro',
      setReturnUrlSchemeOnAndroid: true
    })
    const initialized = await initPaymentSheet({
      merchantDisplayName: session.merchantDisplayName,
      paymentIntentClientSecret: session.paymentIntentClientSecret,
      returnURL: Linking.createURL('checkout'),
      allowsDelayedPaymentMethods: false,
      paymentMethodOrder: ['card'],
      cardBrandAcceptance: {
        filter: CardBrandAcceptanceFilter.Allowed,
        brands: [CardBrandCategory.Visa, CardBrandCategory.Mastercard]
      },
      ...(Platform.OS === 'android'
        ? {
            googlePay: {
              merchantCountryCode: session.merchantCountryCode,
              currencyCode: session.currency,
              testEnv: false
            }
          }
        : {})
    })
    if (initialized.error) {
      return {
        status: 'failed',
        message: errorText(initialized.error, 'Stripe PaymentSheet could not be initialized.')
      }
    }
    const result = await presentPaymentSheet()
    if (result.didCancel || result.error?.code === 'Canceled') {
      return { status: 'canceled' }
    }
    if (result.error) {
      return {
        status: 'failed',
        message: errorText(result.error, 'Payment could not be authorized.')
      }
    }
    return { status: 'succeeded' }
  } catch (error) {
    return {
      status: 'failed',
      message: errorText(error, 'Payment could not be authorized.')
    }
  }
})

export const nativeStripePayment: NativeStripePaymentAdapter = {
  async prepare(session: StripePaymentActionSession) {
    if (Platform.OS !== 'ios' && Platform.OS !== 'android') {
      return {
        status: 'unavailable',
        reason: 'Stripe PaymentSheet is available only in the native iOS and Android app.'
      }
    }
    if (!session.livemode || !session.publishableKey.startsWith('pk_live_')) {
      return {
        status: 'unavailable',
        reason: 'The merchant did not return a live Stripe payment session.'
      }
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      return {
        status: 'unavailable',
        reason: 'The Stripe payment session expired. Refresh checkout and try again.'
      }
    }

    return {
      status: 'ready',
      payment: { present: () => present(session) }
    }
  }
}
