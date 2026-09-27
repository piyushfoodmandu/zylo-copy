import { searchProducts } from '../api/client'
import type { CatalogProductSummary } from '../types/catalog'
import { categoryBySlug, popularSearches } from './categories'
import { mostReviewed, topRated } from './deals'
import { groupCatalogProducts } from './product-groups'

export type HomeRails = {
  popular: CatalogProductSummary[]
  rated: CatalogProductSummary[]
  /** Every seed failed before any useful product arrived. */
  unreachable: boolean
}

const homeSeeds = popularSearches.slice(0, 6)
const homeSeedSize = 16
const homeRailSize = 12

/** One source may fail without turning the whole front door into an error. */
export const loadHomeRails = async (signal?: AbortSignal): Promise<HomeRails> => {
  const responses = await Promise.all(homeSeeds.map(async (query) => {
    try {
      const response = await searchProducts(query, { sort: 'relevance', limit: homeSeedSize }, signal)
      return { items: response.items, settled: response.state === 'ready' }
    } catch (error) {
      if (signal?.aborted) throw signal.reason ?? error
      return { items: [] as CatalogProductSummary[], settled: false }
    }
  }))

  const pooled = groupCatalogProducts(responses.flatMap((response) => response.items))
  const popular = mostReviewed(pooled, homeRailSize)
  const popularIds = new Set(popular.map((group) => `${group.product.businessId}:${group.product.productId}`))

  return {
    popular: popular.map((group) => group.product),
    rated: topRated(
      pooled.filter((group) => !popularIds.has(`${group.product.businessId}:${group.product.productId}`)),
      homeRailSize
    ).map((group) => group.product),
    unreachable: pooled.length === 0 && responses.some((response) => !response.settled)
  }
}

export type CategoryRail = {
  label: string
  query: string
  items: CatalogProductSummary[]
}

export type CategoryRails = {
  slug: string
  rails: CategoryRail[]
  fetchedAt?: string
  /** Every useful rail was empty and at least one source never settled. */
  unreachable: boolean
}

type RailResult = CategoryRail & { settled: boolean; fetchedAt?: string }
const categoryRailCount = 3
const categoryRailSize = 8

const loadRail = async (child: { label: string; query: string }, signal?: AbortSignal): Promise<RailResult> => {
  try {
    const response = await searchProducts(child.query, { sort: 'relevance', limit: categoryRailSize }, signal)
    return {
      label: child.label,
      query: child.query,
      items: response.items,
      settled: response.state === 'ready',
      ...(response.items[0]?.sourceLabel.fetchedAt
        ? { fetchedAt: response.items[0].sourceLabel.fetchedAt }
        : {})
    }
  } catch (error) {
    if (signal?.aborted) throw signal.reason ?? error
    return { label: child.label, query: child.query, items: [], settled: false }
  }
}

/**
 * Universal category data. Web loaders call this for SSR; installed apps call
 * the same bounded source path directly because Expo route loaders are web-only.
 */
export const loadCategoryRails = async (slug: string, signal?: AbortSignal): Promise<CategoryRails | undefined> => {
  const category = categoryBySlug(slug)
  if (!category) return undefined

  const results = await Promise.all(category.children.slice(0, categoryRailCount).map((child) => loadRail(child, signal)))
  const usable = results.filter((rail) => rail.items.length > 0)
  let nextChild = categoryRailCount
  while (usable.length < categoryRailCount && nextChild < category.children.length) {
    const missing = categoryRailCount - usable.length
    const candidates = category.children.slice(nextChild, nextChild + missing)
    const fallbacks = await Promise.all(candidates.map((child) => loadRail(child, signal)))
    results.push(...fallbacks)
    usable.push(...fallbacks.filter((rail) => rail.items.length > 0))
    nextChild += candidates.length
  }

  const rails = usable.slice(0, categoryRailCount)
  const fetchedAt = results.find((rail) => rail.fetchedAt)?.fetchedAt
  return {
    slug,
    rails,
    unreachable: rails.length === 0 && results.some((rail) => !rail.settled),
    ...(fetchedAt ? { fetchedAt } : {})
  }
}
