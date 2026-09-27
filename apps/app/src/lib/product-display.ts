import { formatMoney } from './money'
import type { CatalogProductDetail, CatalogProductSummary } from '../types/catalog'

export const productMoney = (product: CatalogProductSummary | CatalogProductDetail) =>
  product.price ? formatMoney(product.price) : 'Price unavailable'

/**
 * When the price was last confirmed with the shop. "Checked" rather than
 * "updated": nothing about the offer necessarily changed, and what the shopper
 * needs to know is how recently anyone looked.
 */
export const freshnessLabel = (date: string) => {
  const milliseconds = new Date(date).getTime()
  if (!Number.isFinite(milliseconds)) return 'Not checked recently'
  const minutes = Math.max(0, Math.round((Date.now() - milliseconds) / 60_000))
  if (minutes < 2) return 'Checked just now'
  if (minutes < 60) return `Checked ${minutes}m ago`
  if (minutes < 24 * 60) return `Checked ${Math.round(minutes / 60)}h ago`
  return `Checked ${Math.round(minutes / (24 * 60))}d ago`
}

/**
 * The shop is the source a shopper can act on. Which catalog Arro reached that
 * shop through is a fact about Arro's plumbing — real, auditable, and exposed
 * through the API's source labels, but not something a shopper can use, price
 * against or buy from. Putting an adapter name on the page spends the most
 * valuable line on the screen saying nothing.
 */
export const soldByLabel = (shopName: string, shopCount: number) =>
  shopCount > 1 ? `${shopCount} shops` : shopName

export const availabilityLabel = (value: CatalogProductSummary['availability']) => ({
  in_stock: 'In stock',
  limited: 'Limited stock',
  out_of_stock: 'Out of stock',
  unknown: 'Availability unknown'
}[value])

/**
 * Elapsed time in the same voice as `freshnessLabel`, for things the shopper
 * did rather than things a source reported.
 */
export const relativeTime = (date: string) => {
  const milliseconds = new Date(date).getTime()
  if (!Number.isFinite(milliseconds)) return ''
  const minutes = Math.max(0, Math.round((Date.now() - milliseconds) / 60_000))
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days < 30 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`
}
