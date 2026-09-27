import type { StripePaymentActionSession } from '../types/purchase'

export type NativeStripePaymentPresentation =
  | { status: 'succeeded' }
  | { status: 'canceled' }
  | { status: 'failed'; message: string }

export type PreparedNativeStripePayment = {
  present(): Promise<NativeStripePaymentPresentation>
}

export interface NativeStripePaymentAdapter {
  prepare(session: StripePaymentActionSession): Promise<
    | { status: 'ready'; payment: PreparedNativeStripePayment }
    | { status: 'unavailable'; reason: string }
  >
}

export const nativeStripePayment: NativeStripePaymentAdapter = {
  async prepare() {
    return {
      status: 'unavailable',
      reason: 'Stripe PaymentSheet is available only in the native iOS and Android app.'
    }
  }
}
