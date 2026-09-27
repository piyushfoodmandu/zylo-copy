import type { NativeGooglePayAdapter } from './google-pay'

/** iOS and web deliberately have no host-native Google Pay executor. */
export const nativeGooglePay: NativeGooglePayAdapter = {
  environment: 'TEST',
  async prepare() {
    return {
      status: 'unavailable',
      reason: 'Native Google Pay is available only in the Android app.'
    }
  }
}
