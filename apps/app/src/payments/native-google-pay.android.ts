import {
  GooglePayButtonConstants,
  PaymentRequest
} from '@google/react-native-make-payment'
import Constants from 'expo-constants'
import {
  createNativeGooglePayAdapter,
  type GooglePayPaymentRequestConstructor
} from './google-pay'

// Arro validates the merchant request against the native module's generated
// Android contract before it reaches this boundary.
const configuredEnvironment = Constants.expoConfig?.extra?.googlePayEnvironment

if (configuredEnvironment !== 'PRODUCTION') {
  throw new Error('Android builds require the baked Google Pay PRODUCTION environment.')
}

export const nativeGooglePay = GooglePayButtonConstants
  ? createNativeGooglePayAdapter(
      PaymentRequest as unknown as GooglePayPaymentRequestConstructor,
      configuredEnvironment
    )
  : {
      environment: configuredEnvironment,
      async prepare() {
        return {
          status: 'unavailable' as const,
          reason: 'The official Google Pay control is unavailable in this app build.'
        }
      }
    }
