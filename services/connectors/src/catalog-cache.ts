import type {
  CatalogProductDetailFetchRequest,
  CatalogProductDetailFetchResult,
  CatalogProductDetailFetcher,
  CatalogProductFetchRequest,
  CatalogProductFetchResult,
  CatalogProductFetcher
} from './catalog-fetcher.ts'
import {
  catalogProductDetailRequestIdentity,
  catalogSearchRequestIdentity
} from './catalog-request-identity.ts'

export type CatalogCacheOptions = {
  /** How long a fetched product may be reused. Zero disables the cache. */
  ttlMs: number
  maxEntries?: number
  currentTimeMs?: () => number
}

type CacheEntry<T> = {
  expiresAtMs: number
  result: T
}

const defaultMaxEntries = 512

const boundedExpiryMs = (
  cachedAtMs: number,
  ttlMs: number,
  sourceExpiries: Array<string | undefined>
) => Math.min(
  cachedAtMs + ttlMs,
  ...sourceExpiries
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
)

/**
 * Everything that changes the answer, and nothing that does not. Request and
 * correlation IDs identify the caller rather than the product, so they stay out
 * of the key; the selection does not, because two configurations of the same
 * product are two different SKUs at two different prices.
 */
const cacheKey = catalogProductDetailRequestIdentity

/**
 * A product page costs one upstream round trip, and a server render asks for the
 * same product twice — once to build the document and once to build its
 * metadata — before the shopper has done anything. Repeat views, back
 * navigation and several shoppers on the same popular product all pay again.
 *
 * Reuse is bounded by a short window because these are live prices, and the
 * cached result keeps the `fetchedAt` of the call that really happened, so the
 * page still tells the shopper exactly how old the price is instead of claiming
 * it was just checked. Only fetched results are stored: caching a failure would
 * pin an outage in place for the length of the window.
 */
export const createCachedCatalogProductDetailFetcher = (
  fetcher: CatalogProductDetailFetcher,
  { ttlMs, maxEntries = defaultMaxEntries, currentTimeMs = () => Date.now() }: CatalogCacheOptions
): CatalogProductDetailFetcher => {
  if (ttlMs <= 0) return fetcher

  const entries = new Map<string, CacheEntry<CatalogProductDetailFetchResult>>()
  const inFlight = new Map<string, Promise<CatalogProductDetailFetchResult>>()

  const evictExpired = (nowMs: number) => {
    for (const [key, entry] of entries) {
      if (entry.expiresAtMs <= nowMs) entries.delete(key)
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  return async (request) => {
    const nowMs = currentTimeMs()
    const key = cacheKey(request)

    evictExpired(nowMs)

    const cached = entries.get(key)
    if (cached) return { ...cached.result, latencyMs: 0, cacheLayer: 'memory' }

    // A second caller arriving while the first is still upstream waits for that
    // answer instead of opening its own connection to the shop.
    const pending = inFlight.get(key)
    if (pending) return pending

    const fetchPromise = fetcher(request)
      .then((result) => {
        if (result.status === 'fetched' && result.product) {
          const cachedAtMs = currentTimeMs()
          const expiresAtMs = boundedExpiryMs(
            cachedAtMs,
            ttlMs,
            [result.product.sourceLabel?.expiresAt]
          )
          if (expiresAtMs > cachedAtMs) entries.set(key, { expiresAtMs, result })
        }
        return result
      })
      .finally(() => {
        inFlight.delete(key)
      })

    inFlight.set(key, fetchPromise)
    return fetchPromise
  }
}


/**
 * Everything the source ranked on. Two searches that differ only in the caller's
 * request ID are the same search; two that differ in sort, filter, page or
 * locale are not.
 */
const searchCacheKey = (request: CatalogProductFetchRequest) =>
  catalogSearchRequestIdentity(request)

/**
 * A category page is several searches at once, and a server render runs the
 * whole set twice — once for the document and once for its metadata. Rails
 * shared between categories, a shopper stepping back into results, and repeat
 * queries all pay the same round trip again.
 *
 * The same bounded-reuse rules as product detail apply: only fetched results are
 * stored, and a reused result keeps its original `fetchedAt` so every price on
 * the page still says when it was really checked.
 */
export const createCachedCatalogFetcher = (
  fetcher: CatalogProductFetcher,
  { ttlMs, maxEntries = defaultMaxEntries, currentTimeMs = () => Date.now() }: CatalogCacheOptions
): CatalogProductFetcher => {
  if (ttlMs <= 0) return fetcher

  const entries = new Map<string, CacheEntry<CatalogProductFetchResult>>()
  const inFlight = new Map<string, Promise<CatalogProductFetchResult>>()

  return async (request) => {
    const nowMs = currentTimeMs()
    const key = searchCacheKey(request)

    for (const [candidate, entry] of entries) {
      if (entry.expiresAtMs <= nowMs) entries.delete(candidate)
    }
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }

    const cached = entries.get(key)
    if (cached) return { ...cached.result, latencyMs: 0, cacheLayer: 'memory' }

    const pending = inFlight.get(key)
    if (pending) return pending

    const fetchPromise = fetcher(request)
      .then((result) => {
        if (result.status === 'fetched') {
          const cachedAtMs = currentTimeMs()
          const expiresAtMs = boundedExpiryMs(
            cachedAtMs,
            ttlMs,
            result.products.map((product) => product.sourceLabel?.expiresAt)
          )
          if (expiresAtMs > cachedAtMs) entries.set(key, { expiresAtMs, result })
        }
        return result
      })
      .finally(() => {
        inFlight.delete(key)
      })

    inFlight.set(key, fetchPromise)
    return fetchPromise
  }
}
