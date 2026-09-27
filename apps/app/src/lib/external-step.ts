import { Linking, Platform } from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { affiliateUrl } from './affiliate'
import { color } from './theme'

/**
 * Opens one exact external URL while keeping Arro available underneath on
 * native. Callers decide whether the URL is a merchant handoff (which may carry
 * attribution) or a signed payment/authentication URL (which must never be
 * rewritten).
 */
const openExternalStep = async (url: string): Promise<'dismissed' | 'left'> => {
  if (Platform.OS === 'web') {
    // Checkout must never depend on popup permission. The cart, shopper
    // credential, and purchase id are durable device state, so same-tab
    // navigation remains resumable with the browser's Back button.
    if (typeof window !== 'undefined') {
      window.location.assign(url)
      return 'left'
    }
    await Linking.openURL(url)
    return 'left'
  }

  try {
    await WebBrowser.openBrowserAsync(url, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      controlsColor: color.arro600,
      toolbarColor: color.white,
      enableBarCollapsing: true,
      showTitle: true
    })
    // Resolves when the sheet closes, whatever the outcome. The merchant is the
    // authority on what happened, so the caller re-reads the purchase rather
    // than inferring success from a dismissal.
    return 'dismissed'
  } catch {
    await Linking.openURL(url)
    return 'left'
  }
}

/**
 * Shopping/product links may carry Arro attribution. Checkout continuation,
 * payment and order links use openExactExternalStep instead.
 */
export const openMerchantStep = (rawUrl: string) => openExternalStep(affiliateUrl(rawUrl))

/**
 * Payment and authentication URLs are signed or provider-bound. Query-string
 * mutation can invalidate them, so they always travel byte-for-byte as issued.
 */
export const openExactExternalStep = (url: string) => openExternalStep(url)

/** Semantic alias used by checkout's provider and authentication actions. */
export const openPaymentStep = openExactExternalStep
