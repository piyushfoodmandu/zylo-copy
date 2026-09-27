import type { PurchaseResponse } from '../types/purchase'

/**
 * The purchase runtime answers even when it could not negotiate a checkout with
 * the merchant. It returns the sentinel identity the API uses for "no session"
 * — `unknown-purchase` and an `unknown` merchant origin — with no line items,
 * plus the merchant URL so the shopper can still get there.
 *
 * That is a handoff, not a checkout. Treating it as one sends the shopper to a
 * checkout screen whose first read is a 404 on an ID that never existed.
 */
export const isPreparedCheckout = (purchase: PurchaseResponse) =>
  purchase.purchaseId !== 'unknown-purchase' &&
  purchase.merchant.canonicalOrigin !== 'unknown' &&
  purchase.merchant.profileUrl !== 'unknown'

/** Where a handoff-only purchase should send the shopper, if anywhere. */
export const handoffUrl = (purchase: PurchaseResponse) =>
  purchase.nextAction?.url || purchase.cart?.continueUrl

/**
 * The name the shopper has already been reading on the offer wins. A merchant
 * that never negotiated a session has no display name of its own, and the URL
 * behind it is often an internal platform handle — telling someone their order
 * goes to `brulerie-du-quai.myshopify.com` when the page said "Brulerie du Quai"
 * reads like a different shop.
 */
export const handoffMerchantName = (purchase: PurchaseResponse, fallback: string) => {
  const display = purchase.merchant.displayName
  if (display && display !== 'unknown') return display
  if (fallback.trim()) return fallback
  const url = handoffUrl(purchase)
  if (!url) return 'this shop'
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'this shop'
  }
}
