import { Platform } from 'react-native'
import type { PurchaseAction } from '@arro/contracts'
import { openShopifyCheckout, preloadShopifyCheckout } from '../lib/shopify-checkout'

// Only this adapter registry knows about merchant SDKs. Direct UCP payment
// execution and the generic embedded host are independent of catalog providers.
const nativePresenters = {
  shopify: { open: openShopifyCheckout, preload: preloadShopifyCheckout }
}

export const preloadNativeCheckout = (action: PurchaseAction | undefined) => {
  if (Platform.OS === 'web' || action?.type !== 'continue_on_merchant' ||
    action.presentation?.type !== 'native_checkout' || !action.url) return
  nativePresenters[action.presentation.provider].preload(action.url)
}

export const openNativeCheckout = (action: PurchaseAction) => {
  if (Platform.OS === 'web' || action.type !== 'continue_on_merchant' ||
    action.presentation?.type !== 'native_checkout' || !action.url) return undefined
  const presentation = nativePresenters[action.presentation.provider].open(action.url)
  if (!presentation) throw new Error('This shop’s checkout could not open inside Arro. Try again or continue on its site.')
  return presentation
}
