import type { CatalogProductGroup } from './product-groups'
import type { CatalogProductSummary } from '../types/catalog'

export type ShopperFilters = {
  shop?: string
  currency?: string
  /** Applied at the source, because narrowing there returns more matching rows. */
  brand?: string
  condition?: CatalogProductSummary['condition']
  minRating?: number
  inStockOnly: boolean
}

export const emptyFilters: ShopperFilters = { inStockOnly: false }

export const hasActiveFilters = (filters: ShopperFilters, minPrice?: number, maxPrice?: number) =>
  Boolean(
    filters.shop ||
    filters.currency ||
    filters.brand ||
    filters.condition ||
    filters.minRating ||
    filters.inStockOnly ||
    minPrice !== undefined ||
    maxPrice !== undefined
  )

export const shopName = (product: CatalogProductSummary) =>
  product.seller?.name || product.seller?.domain || product.businessName

const countBy = <T>(values: T[]) => {
  const counts = new Map<T, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
}

/**
 * Facets are derived from what the sources actually returned, so a dimension
 * only appears when it can change the result set. A "Condition" control over
 * results that are all `new`, or a "Brand" control over results with no brand,
 * is dead UI that costs a tap to discover.
 */
export const deriveFacets = (groups: CatalogProductGroup[]) => {
  const offers = groups.flatMap((group) => group.offers)

  const shops = countBy(offers.map(shopName))
  const currencies = countBy(offers.flatMap((offer) => offer.price ? [offer.price.currency] : []))
  const brands = countBy(offers.flatMap((offer) => offer.brand ? [offer.brand] : []))
  const conditions = countBy(offers.map((offer) => offer.condition))
  const availabilities = new Set(offers.map((offer) => offer.availability))
  const ratedCount = offers.filter((offer) => offer.rating).length

  return {
    shops: shops.length > 1 ? shops : [],
    currencies: currencies.length > 1 ? currencies : [],
    brands: brands.length > 1 ? brands : [],
    conditions: conditions.length > 1 ? conditions : [],
    // Only worth a control when some result would actually be hidden by it.
    showAvailability: availabilities.size > 1,
    showRating: ratedCount > 1,
    singleCurrency: currencies.length === 1 ? currencies[0]![0] : undefined
  }
}

const matchesFilters = (offer: CatalogProductSummary, filters: ShopperFilters) => {
  if (filters.shop && shopName(offer) !== filters.shop) return false
  if (filters.currency && offer.price?.currency !== filters.currency) return false
  if (filters.condition && offer.condition !== filters.condition) return false
  if (filters.inStockOnly && offer.availability !== 'in_stock') return false
  if (filters.minRating !== undefined && !(offer.rating && offer.rating.value >= filters.minRating)) return false
  return true
}

/**
 * Filters are applied to offers, then the group is rebuilt around the offers
 * that survived. Filtering whole groups on their lead offer would silently drop
 * a matching shop just because a different shop happened to be cheapest.
 */
export const applyFilters = (groups: CatalogProductGroup[], filters: ShopperFilters): CatalogProductGroup[] => {
  const groupOffers = groups.map((group) => ({
    group,
    offers: group.offers.filter((offer) => matchesFilters(offer, filters))
  }))

  return groupOffers
    .filter(({ offers }) => offers.length > 0)
    .map(({ group, offers }) => ({
      key: group.key,
      product: offers[0]!,
      offers,
      merchantCount: new Set(offers.map(shopName)).size
    }))
}

export const conditionLabel = (condition: CatalogProductSummary['condition']) => ({
  new: 'New',
  refurbished: 'Refurbished',
  open_box: 'Open box',
  used: 'Used',
  unknown: 'Not stated'
}[condition])
