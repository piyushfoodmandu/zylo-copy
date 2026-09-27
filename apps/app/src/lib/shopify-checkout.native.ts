import {
  ShopifyCheckoutSheet,
  type CheckoutException
} from '@shopify/checkout-sheet-kit'

const checkoutSheet = new ShopifyCheckoutSheet({ preloading: true })

export const preloadShopifyCheckout = (url: string) => {
  try {
    checkoutSheet.preload(url)
    return true
  } catch {
    return false
  }
}

/**
 * Present the merchant-owned, production Shopify checkout as a native sheet.
 * Completion is still re-read from UCP by the caller; an SDK callback is a UI
 * lifecycle event, not Arro's authority to invent an Order.
 */
export const openShopifyCheckout = (url: string): Promise<'dismissed'> => {
  return new Promise((resolve, reject) => {
    let settled = false
    const subscriptions: Array<{ remove: () => void }> = []

    const cleanup = () => {
      for (const subscription of subscriptions) subscription.remove()
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        try { checkoutSheet.dismiss() } catch { /* An unavailable sheet has nothing to dismiss. */ }
        reject(error)
      } else resolve('dismissed')
    }

    const completed = checkoutSheet.addEventListener('completed', () => finish())
    const closed = checkoutSheet.addEventListener('close', () => finish())
    const failed = checkoutSheet.addEventListener('error', (error: CheckoutException) => {
      if (error.recoverable) return
      finish(new Error('This shop’s checkout could not open inside Arro. Try again or continue on its site.'))
    })
    if (completed) subscriptions.push(completed)
    if (closed) subscriptions.push(closed)
    if (failed) subscriptions.push(failed)

    try {
      checkoutSheet.present(url)
    } catch (error) {
      finish(error instanceof Error ? error : new Error('Shopify Checkout Kit could not open.'))
    }
  })
}
