import type { CatalogProductDetail, CatalogProductSummary, Money } from '../types/catalog'
import { shopName } from './facets'

export type CartLine = {
  /** Stable per-offer identity. Two shops selling one product are two lines. */
  key: string
  /** The offer as it looked when it was added, so the cart renders offline. */
  product: CatalogProductSummary
  quantity: number
  addedAt: string
  /** What the shopper searched for when they added it. Shown as "why this is here". */
  query?: string
}

/** What revalidation found when the cart was reopened. */
export type CartLineCheck = {
  price?: Money
  availability: CatalogProductSummary['availability']
  checkedAt: string
  /** The source answered, but no longer has this offer at all. */
  missing?: boolean
}

export const merchantKeyOf = (product: CatalogProductSummary) =>
  product.seller?.domain || product.seller?.id || product.businessId

export const cartLineKey = (product: CatalogProductSummary) =>
  [product.businessId, product.productId, product.variantId ?? '', merchantKeyOf(product)].join('|')

export type CartMerchantGroup = {
  key: string
  name: string
  domain?: string
  lines: CartLine[]
  itemCount: number
  /**
   * A planning estimate from the prices Arro last saw, never a quote. The
   * authoritative total belongs to the shop's own checkout session, which is
   * where shipping, tax and final availability are settled.
   */
  estimate?: Money
  /** Set when the group's offers are priced in more than one currency. */
  mixedCurrency: boolean
  /** Set when at least one line has no price at all. */
  incomplete: boolean
}

const sumLines = (lines: CartLine[], priceOf: (line: CartLine) => Money | undefined) => {
  const currencies = new Set<string>()
  let total = 0
  let incomplete = false

  for (const line of lines) {
    const price = priceOf(line)
    if (!price) {
      incomplete = true
      continue
    }
    currencies.add(price.currency)
    total += price.amountMinor * line.quantity
  }

  const currency = currencies.size === 1 ? [...currencies][0] : undefined
  return {
    mixedCurrency: currencies.size > 1,
    incomplete,
    ...(currency && !incomplete ? { estimate: { amountMinor: total, currency } } : {})
  }
}

/**
 * The cart spans shops; a checkout never does. Grouping by merchant is not a
 * display choice — it is the shape the purchase runtime actually accepts, since
 * one UCP checkout belongs to exactly one merchant.
 */
export const groupCartByMerchant = (
  lines: CartLine[],
  priceOf: (line: CartLine) => Money | undefined = (line) => line.product.price
): CartMerchantGroup[] => {
  const grouped = new Map<string, CartLine[]>()
  for (const line of lines) {
    const key = merchantKeyOf(line.product)
    const existing = grouped.get(key)
    if (existing) existing.push(line)
    else grouped.set(key, [line])
  }

  return [...grouped.entries()].map(([key, groupLines]) => {
    const lead = groupLines[0]!.product
    return {
      key,
      name: shopName(lead),
      ...(lead.seller?.domain ? { domain: lead.seller.domain } : {}),
      lines: groupLines,
      itemCount: groupLines.reduce((total, line) => total + line.quantity, 0),
      ...sumLines(groupLines, priceOf)
    }
  })
}

/**
 * One number across shops is only ever a planning estimate, and only when every
 * shop prices in the same currency. Adding across currencies would invent an
 * exchange rate Arro has no source for.
 */
export const cartEstimate = (groups: CartMerchantGroup[]): { estimate?: Money; comparable: boolean } => {
  if (groups.some((group) => group.mixedCurrency || group.incomplete || !group.estimate)) {
    return { comparable: false }
  }
  const currencies = new Set(groups.map((group) => group.estimate!.currency))
  if (currencies.size !== 1) return { comparable: false }
  return {
    comparable: true,
    estimate: {
      amountMinor: groups.reduce((total, group) => total + group.estimate!.amountMinor, 0),
      currency: [...currencies][0]!
    }
  }
}

export const cartItemCount = (lines: CartLine[]) =>
  lines.reduce((total, line) => total + line.quantity, 0)

/** A line the shop can no longer sell must not be able to reach checkout. */
export const lineBlocked = (check: CartLineCheck | undefined) =>
  Boolean(check && (check.missing || check.availability === 'out_of_stock'))

export const priceChange = (line: CartLine, check: CartLineCheck | undefined) => {
  const before = line.product.price
  const after = check?.price
  if (!before || !after || before.currency !== after.currency) return undefined
  if (before.amountMinor === after.amountMinor) return undefined
  return { before, after, direction: after.amountMinor > before.amountMinor ? 'up' as const : 'down' as const }
}

/**
 * What a fresh detail response says about one cart line. The match is made on
 * the seller the line was added from, never on "the cheapest offer now" — a
 * line the shopper chose from one shop must not silently become another shop's.
 */
export const checkFromDetail = (
  line: CartLine,
  detail: CatalogProductDetail | undefined,
  checkedAt = new Date().toISOString()
): CartLineCheck => {
  if (!detail) return { availability: 'unknown', checkedAt, missing: true }

  const wantedSeller = merchantKeyOf(line.product)
  const candidates = detail.variants.filter((variant) =>
    (variant.seller?.domain || variant.seller?.id || detail.businessId) === wantedSeller)
  const exact = line.product.variantId
    ? candidates.find((variant) => variant.variantId === line.product.variantId)
    : undefined

  // Once the shopper chose an exact SKU, revalidation must stay on that SKU.
  // Falling back to another variant from the same merchant can silently turn a
  // 512 GB line into 256 GB while still looking like a successful refresh.
  if (line.product.variantId && !exact) {
    return { availability: 'unknown', checkedAt, missing: true }
  }

  const variant = exact ?? candidates[0]

  if (variant) {
    return {
      ...(variant.price ? { price: variant.price } : {}),
      availability: variant.availability,
      checkedAt
    }
  }

  // No variant from that seller survived, but the source still answers for the
  // product itself. Use it only when the line came from the same seller.
  if (candidates.length === 0 && merchantKeyOf(detail as unknown as CatalogProductSummary) === wantedSeller) {
    return {
      ...(detail.price ? { price: detail.price } : {}),
      availability: detail.availability,
      checkedAt
    }
  }

  return { availability: 'unknown', checkedAt, missing: true }
}
