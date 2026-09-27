import { ArroApiError, getProductDetail, searchProducts } from '../api/client'
import type { CatalogProductDetail, SearchResponse } from '../types/catalog'
import { loadCategoryRails, type CategoryRails } from './catalog-page-data'
import { withCatalogDeadline } from './catalog-deadline'
import type { ProductIdentity } from './product-url'

export class CatalogDataError extends Error {
  constructor(readonly status: 404 | 503, message: string) {
    super(message)
    this.name = 'CatalogDataError'
  }
}

export type ProductDocument = {
  detail: CatalogProductDetail
  variantUnconfirmed?: boolean
}

type CacheEntry = {
  expiresAt: number
  promise: Promise<unknown>
}

type CatalogCacheGlobal = typeof globalThis & {
  __ARRO_PUBLIC_CATALOG_REQUEST_CACHE__?: Map<string, CacheEntry>
}

// Prefetch should still be useful if the shopper reads the card before opening
// it. This cache is process-local and the API retains the original fetchedAt.
const settledReuseMs = 30_000
const maximumEntries = 128

/**
 * Middleware, metadata and loaders are separately packaged server modules, but
 * some hosts execute them in one server realm. This bounded promise cache
 * collapses those phases when they share that realm; the API's source cache is
 * still the cross-realm authority. Pending work cannot expire midway, and the
 * short reuse window starts only after the source settles.
 */
const sharedRequest = <T>(key: string, load: () => Promise<T>): Promise<T> => {
  const globalCache = globalThis as CatalogCacheGlobal
  const cache = globalCache.__ARRO_PUBLIC_CATALOG_REQUEST_CACHE__ ??= new Map()
  const existing = cache.get(key)
  if (existing && existing.expiresAt > Date.now()) return existing.promise as Promise<T>

  const promise = load()
  const entry: CacheEntry = { expiresAt: Number.POSITIVE_INFINITY, promise }
  cache.set(key, entry)
  void promise.then(
    () => { entry.expiresAt = Date.now() + settledReuseMs },
    () => {
      // A transient source failure must not poison an immediate retry. Keep
      // only the in-flight coalescing benefit, then release the failed entry.
      if (cache.get(key) === entry) cache.delete(key)
    }
  )

  if (cache.size > maximumEntries) {
    const oldest = cache.keys().next().value
    if (oldest && oldest !== key) cache.delete(oldest)
  }
  return promise
}

export const loadSearchDocument = (query: string): Promise<SearchResponse> => {
  const normalized = query.trim()
  if (!normalized) return Promise.reject(new CatalogDataError(404, 'Search not found.'))

  return sharedRequest(`search:${normalized.toLowerCase()}`, async () => {
    let response: SearchResponse
    try {
      response = await withCatalogDeadline((signal) =>
        searchProducts(normalized, { sort: 'relevance' }, signal))
    } catch {
      throw new CatalogDataError(503, 'Search is temporarily unavailable.')
    }
    if (response.state === 'unavailable') {
      throw new CatalogDataError(503, 'Search is temporarily unavailable.')
    }
    return response
  })
}

export const loadCategoryDocument = (slug: string): Promise<CategoryRails> => {
  const normalized = slug.trim()
  if (!normalized) return Promise.reject(new CatalogDataError(404, 'Category not found.'))

  return sharedRequest(`category:${normalized.toLowerCase()}`, async () => {
    let result: CategoryRails | undefined
    try {
      result = await withCatalogDeadline((signal) => loadCategoryRails(normalized, signal))
    } catch {
      throw new CatalogDataError(503, 'Category offers are temporarily unavailable.')
    }
    if (!result) throw new CatalogDataError(404, 'Category not found.')
    if (result.unreachable) {
      throw new CatalogDataError(503, 'Category offers are temporarily unavailable.')
    }
    return result
  })
}

const productNotFoundCodes = new Set(['catalog_product_not_found', 'product_not_found'])

export const loadProductDocument = (identity: ProductIdentity | undefined): Promise<ProductDocument> => {
  if (!identity) return Promise.reject(new CatalogDataError(404, 'Product not found.'))
  const { businessId, productId } = identity

  return sharedRequest(`product:${businessId}\u0000${productId}`, async () => {
    let response
    try {
      response = await withCatalogDeadline((signal) =>
        getProductDetail({ businessId, productId }, signal))
    } catch (error) {
      if (error instanceof ArroApiError &&
          error.status === 404 &&
          error.code &&
          productNotFoundCodes.has(error.code)) {
        throw new CatalogDataError(404, 'Product not found.')
      }
      throw new CatalogDataError(503, 'Product details are temporarily unavailable.')
    }

    if (!response.product) {
      const missing = response.messages.some((message) => productNotFoundCodes.has(message.code))
      throw new CatalogDataError(
        missing ? 404 : 503,
        missing ? 'Product not found.' : 'Product details are temporarily unavailable.'
      )
    }

    return {
      detail: response.product,
      ...(response.variantUnconfirmed ? { variantUnconfirmed: true } : {})
    }
  })
}
