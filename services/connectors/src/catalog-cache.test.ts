import { describe, expect, it } from 'vitest'
import {
  createCachedCatalogFetcher,
  createCachedCatalogProductDetailFetcher
} from './catalog-cache.ts'
import type {
  CatalogProductDetailFetchRequest,
  CatalogProductDetailFetchResult,
  CatalogProductFetchRequest,
  CatalogProductFetchResult
} from './catalog-fetcher.ts'

const request = (
  overrides: Partial<CatalogProductDetailFetchRequest['detailRequest']> = {}
): CatalogProductDetailFetchRequest => ({
  requestId: 'request-1',
  correlationId: 'correlation-1',
  source: {
    businessId: 'source-1',
    domain: 'source.example.com',
    displayName: 'Source',
    sourceType: 'direct_ucp',
    launchStatus: 'launched',
    featureVisibility: 'public',
    accessPolicyState: 'granted'
  } as CatalogProductDetailFetchRequest['source'],
  detailRequest: { businessId: 'source-1', productId: 'product-1', ...overrides },
  timeoutMs: 1000
})

const fetched = (variantId: string): CatalogProductDetailFetchResult => ({
  sourceId: 'source-1',
  sourceName: 'Source',
  status: 'fetched',
  product: { variantId } as CatalogProductDetailFetchResult['product'],
  messages: [],
  fetchedAt: '2026-08-20T00:00:00.000Z',
  latencyMs: 400
})

describe('catalog product detail cache', () => {
  it('answers a repeated product from the previous fetch', async () => {
    let calls = 0
    const fetcher = createCachedCatalogProductDetailFetcher(async () => {
      calls += 1
      return fetched('variant-1')
    }, { ttlMs: 60_000 })

    const first = await fetcher(request())
    const second = await fetcher(request())

    expect(calls).toBe(1)
    expect(second.product).toEqual(first.product)
    // The price is as old as the call that really happened, and says so.
    expect(second.fetchedAt).toBe(first.fetchedAt)
    expect(second.latencyMs).toBe(0)
  })

  it('treats a different configuration as a different product', async () => {
    let calls = 0
    const fetcher = createCachedCatalogProductDetailFetcher(async () => {
      calls += 1
      return fetched(`variant-${calls}`)
    }, { ttlMs: 60_000 })

    await fetcher(request())
    await fetcher(request({ selected: [{ name: 'Storage', label: '512gb' }] }))
    await fetcher(request({ variantId: 'variant-9' }))

    expect(calls).toBe(3)
  })

  it('does not pin a failure in place', async () => {
    let calls = 0
    const fetcher = createCachedCatalogProductDetailFetcher(async () => {
      calls += 1
      return calls === 1
        ? { ...fetched('variant-1'), status: 'error' as const, product: undefined }
        : fetched('variant-1')
    }, { ttlMs: 60_000 })

    await fetcher(request())
    const recovered = await fetcher(request())

    expect(calls).toBe(2)
    expect(recovered.status).toBe('fetched')
  })

  it('collapses concurrent callers into one upstream call', async () => {
    let calls = 0
    const fetcher = createCachedCatalogProductDetailFetcher(async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 10))
      return fetched('variant-1')
    }, { ttlMs: 60_000 })

    const [left, right] = await Promise.all([fetcher(request()), fetcher(request())])

    expect(calls).toBe(1)
    expect(left.product).toEqual(right.product)
  })

  it('re-fetches once the window has passed', async () => {
    let calls = 0
    let nowMs = 0
    const fetcher = createCachedCatalogProductDetailFetcher(async () => {
      calls += 1
      return fetched(`variant-${calls}`)
    }, { ttlMs: 60_000, currentTimeMs: () => nowMs })

    await fetcher(request())
    nowMs = 59_000
    await fetcher(request())
    nowMs = 61_000
    await fetcher(request())

    expect(calls).toBe(2)
  })
})

const searchRequest = (query: string): CatalogProductFetchRequest => ({
  requestId: 'request-1',
  correlationId: 'correlation-1',
  source: request().source,
  searchRequest: { query },
  timeoutMs: 1000
})

const searchFetched = (count: number): CatalogProductFetchResult => ({
  sourceId: 'source-1',
  sourceName: 'Source',
  status: 'fetched',
  products: Array.from({ length: count }, (_, index) => ({ productId: `product-${index}` })),
  messages: [],
  fetchedAt: '2026-08-20T00:00:00.000Z',
  latencyMs: 900
} as CatalogProductFetchResult)

describe('catalog search cache', () => {
  it('serves a repeated rail from the previous fetch', async () => {
    let calls = 0
    const fetcher = createCachedCatalogFetcher(async () => {
      calls += 1
      return searchFetched(3)
    }, { ttlMs: 60_000 })

    await fetcher(searchRequest('phones'))
    const second = await fetcher(searchRequest('phones'))

    expect(calls).toBe(1)
    expect(second.fetchedAt).toBe('2026-08-20T00:00:00.000Z')
    expect(second.latencyMs).toBe(0)
  })

  it('keeps different queries apart', async () => {
    let calls = 0
    const fetcher = createCachedCatalogFetcher(async () => {
      calls += 1
      return searchFetched(1)
    }, { ttlMs: 60_000 })

    await fetcher(searchRequest('phones'))
    await fetcher(searchRequest('laptops'))

    expect(calls).toBe(2)
  })
})
