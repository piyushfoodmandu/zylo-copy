import { Platform } from 'react-native'
import type {
  PurchaseClientCapabilities,
  PurchaseClientPlatform
} from '../types/purchase'

export type PaymentSurfaceMode = 'native_preferred' | 'external_only'

const clientPlatform = (platform: typeof Platform.OS): PurchaseClientPlatform => {
  if (platform === 'android' || platform === 'ios' || platform === 'web') return platform
  // Arro currently ships Android, iOS and web. An unexpected React Native target
  // must not accidentally claim Android's Google Pay integration.
  return 'web'
}

/**
 * Capabilities describe executable UI in this first-party app, not an attested
 * agent host. Android and iOS ship Stripe PaymentSheet; Android additionally
 * supports a merchant-declared direct Google Pay UCP handler.
 */
export const paymentClientCapabilities = (
  surfaceMode: PaymentSurfaceMode = 'native_preferred',
  platform: typeof Platform.OS = Platform.OS
): PurchaseClientCapabilities => {
  const normalizedPlatform = clientPlatform(platform)
  const canUseNativePayments =
    (normalizedPlatform === 'android' || normalizedPlatform === 'ios') &&
    surfaceMode === 'native_preferred'
  const canUseNativeGooglePay = normalizedPlatform === 'android' && canUseNativePayments

  return {
    platform: normalizedPlatform,
    surfaces: canUseNativePayments
      ? ['host_native', 'external_action', 'merchant_hosted']
      : ['external_action', 'merchant_hosted'],
    providerKinds: canUseNativePayments
      ? [
          ...(canUseNativeGooglePay ? ['google_pay' as const] : []),
          'stripe',
          'merchant_hosted'
        ]
      : ['merchant_hosted'],
  }
}
