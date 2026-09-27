import type { CatalogProductSummary } from '../types/catalog'

export type CatalogProductGroup = {
  key: string
  product: CatalogProductSummary
  offers: CatalogProductSummary[]
  merchantCount: number
}

const offerIdentity = (product: CatalogProductSummary) =>
  product.seller?.domain || product.seller?.id || `business:${product.businessId}`

const comparablePrice = (left: CatalogProductSummary, right: CatalogProductSummary) => {
  if (!left.price && !right.price) return 0
  if (!left.price) return 1
  if (!right.price) return -1
  if (left.price.currency !== right.price.currency) return undefined
  return left.price.amountMinor - right.price.amountMinor
}

const offerRank = (left: CatalogProductSummary, right: CatalogProductSummary) => {
  const leftAvailable = left.availability === 'in_stock' || left.availability === 'limited'
  const rightAvailable = right.availability === 'in_stock' || right.availability === 'limited'
  if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1
  const price = comparablePrice(left, right)
  if (price !== undefined && price !== 0) return price
  // Different currencies are not numerically comparable. Stable Array#sort keeps
  // source-authoritative order when the comparator returns zero.
  return 0
}

export const productGroupKey = (product: CatalogProductSummary) =>
  `${product.businessId}:${product.productId}`

export const groupCatalogProducts = (products: CatalogProductSummary[]): CatalogProductGroup[] => {
  const grouped = new Map<string, CatalogProductSummary[]>()

  for (const product of products) {
    const key = productGroupKey(product)
    const offers = grouped.get(key)
    if (offers) offers.push(product)
    else grouped.set(key, [product])
  }

  return [...grouped.entries()].map(([key, candidates]) => {
    const byMerchant = new Map<string, CatalogProductSummary>()
    for (const candidate of candidates) {
      const identity = offerIdentity(candidate)
      const current = byMerchant.get(identity)
      if (!current || offerRank(candidate, current) < 0) byMerchant.set(identity, candidate)
    }

    const offers = [...byMerchant.values()].sort(offerRank)
    const product = offers[0] ?? candidates[0]!
    return {
      key,
      product,
      offers,
      merchantCount: new Set(offers.map(offerIdentity)).size
    }
  })
}

/**
 * Wraps one already-chosen offer as a group. Saved items, cart lines and rails
 * carry a single offer, but every card in the app renders from a group, so this
 * keeps one card component instead of two that drift apart.
 */
export const singleProductGroup = (product: CatalogProductSummary): CatalogProductGroup => ({
  key: productGroupKey(product),
  product,
  offers: [product],
  merchantCount: 1
})
