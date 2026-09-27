import { describe, expect, it, vi } from 'vitest'
import type {
  CatalogProductFetcher,
  CatalogProductFetchRequest,
  CatalogProductFetchResult
} from '@arro/connectors'
import {
  createCatalogReadModelFetcher,
  type CatalogReadModelClient
} from './catalog-read-model.ts'

const baseTimeMs = Date.parse('2026-09-04T12:00:00.000Z')
const freshForMs = 5 * 60_000

const request = (
  overrides: Partial<CatalogProductFetchRequest> = {}
): CatalogProductFetchRequest => ({
  requestId: 'request-1',
  correlationId: 'correlation-1',
  source: {
    businessId: 'shopify-global-catalog',
    domain: 'catalog.shopify.com',
    displayName: 'Shopify Global Catalog',
    sourceType: 'broad_mcp',
    profileHash: 'profile-hash-1',
    profileUrl: 'https://catalog.shopify.com/.well-known/ucp'
  } as CatalogProductFetchRequest['source'],
  searchRequest: {
    query: 'pushchair stroller',
    intent: { sort: 'relevance' },
    context: { channel: 'web', locale: 'en-US', currency: 'USD' },
    pagination: { limit: 8 }
  },
  timeoutMs: 10_000,
  now: new Date(baseTimeMs),
  ...overrides
})

const fetched = (
  productId: string,
  fetchedAtMs = baseTimeMs
): CatalogProductFetchResult => ({
  sourceId: 'shopify-global-catalog',
  sourceName: 'Shopify Global Catalog',
  status: 'fetched',
  products: [{
    productId,
    sourceLabel: {
      sourceId: 'shopify-global-catalog',
      sourceName: 'Shopify Global Catalog',
      factType: 'connected_catalog_product',
      fetchedAt: new Date(fetchedAtMs).toISOString(),
      expiresAt: new Date(baseTimeMs + 15 * 60_000).toISOString(),
      freshnessClass: 'advisory_catalog',
      bindingStatus: 'advisory'
    }
  }] as CatalogProductFetchResult['products'],
  messages: [],
  fetchedAt: new Date(fetchedAtMs).toISOString(),
  latencyMs: 900
})

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const flushMicrotasks = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

const memoryClient = (nowMs: () => number) => {
  const values = new Map<string, { value: string; expiresAtMs: number }>()
  const get = vi.fn(async (key: string) => {
    const entry = values.get(key)
    if (!entry) return null
    if (entry.expiresAtMs <= nowMs()) {
      values.delete(key)
      return null
    }
    return entry.value
  })
  const set = vi.fn(async (
    key: string,
    value: string,
    options: { PX: number; NX?: boolean }
  ) => {
    const existing = values.get(key)
    if (existing && existing.expiresAtMs <= nowMs()) values.delete(key)
    if (options.NX && values.has(key)) return null
    values.set(key, { value, expiresAtMs: nowMs() + options.PX })
    return 'OK'
  })
  return {
    client: { get, set } satisfies CatalogReadModelClient,
    get,
    set,
    values
  }
}

describe('catalog read model', () => {
  it('serves a fresh projection without returning to the source', async () => {
    let nowMs = baseTimeMs
    const redis = memoryClient(() => nowMs)
    const source = vi.fn<CatalogProductFetcher>(async () => fetched('initial-product'))
    const fetchCatalog = createCatalogReadModelFetcher(source, {
      getClient: async () => redis.client,
      freshForMs,
      nowMs: () => nowMs
    })

    await fetchCatalog(request())
    const projected = await fetchCatalog(request({
      requestId: 'request-2',
      correlationId: 'correlation-2'
    }))

    expect(source).toHaveBeenCalledTimes(1)
    expect(projected.products[0]?.productId).toBe('initial-product')
    expect(projected.fetchedAt).toBe(new Date(baseTimeMs).toISOString())
    expect(projected.latencyMs).toBe(0)
    expect(projected.cacheLayer).toBe('projection')
    expect(redis.set.mock.calls.filter(([key]) => !key.endsWith(':refresh'))).toHaveLength(1)
  })

  it('returns a stale projection immediately and refreshes it in the background', async () => {
    let nowMs = baseTimeMs
    const redis = memoryClient(() => nowMs)
    const background = deferred<CatalogProductFetchResult>()
    const source = vi.fn<CatalogProductFetcher>()
      .mockResolvedValueOnce(fetched('initial-product'))
      .mockReturnValueOnce(background.promise)
    const fetchCatalog = createCatalogReadModelFetcher(source, {
      getClient: async () => redis.client,
      freshForMs,
      nowMs: () => nowMs
    })

    await fetchCatalog(request())
    nowMs += freshForMs + 1

    const stale = await fetchCatalog(request({ requestId: 'stale-request' }))

    expect(stale.products[0]?.productId).toBe('initial-product')
    expect(stale.cacheLayer).toBe('projection')
    await flushMicrotasks()
    expect(source).toHaveBeenCalledTimes(2)

    background.resolve(fetched('refreshed-product', nowMs))
    await flushMicrotasks()

    const refreshed = await fetchCatalog(request({ requestId: 'refreshed-request' }))
    expect(refreshed.products[0]?.productId).toBe('refreshed-product')
    expect(refreshed.cacheLayer).toBe('projection')
    expect(source).toHaveBeenCalledTimes(2)
  })

  it('keeps the last usable projection when a background refresh fails', async () => {
    let nowMs = baseTimeMs
    const redis = memoryClient(() => nowMs)
    const source = vi.fn<CatalogProductFetcher>()
      .mockResolvedValueOnce(fetched('last-known-good'))
      .mockRejectedValueOnce(new Error('source unavailable'))
    const fetchCatalog = createCatalogReadModelFetcher(source, {
      getClient: async () => redis.client,
      freshForMs,
      nowMs: () => nowMs
    })

    await fetchCatalog(request())
    nowMs += freshForMs + 1
    const stale = await fetchCatalog(request({ requestId: 'refresh-trigger' }))
    await flushMicrotasks()
    const afterFailure = await fetchCatalog(request({ requestId: 'after-failure' }))

    expect(source).toHaveBeenCalledTimes(2)
    expect(stale.products[0]?.productId).toBe('last-known-good')
    expect(afterFailure.products[0]?.productId).toBe('last-known-good')
    expect(afterFailure.cacheLayer).toBe('projection')
    expect(redis.set.mock.calls.filter(([key]) => !key.endsWith(':refresh'))).toHaveLength(1)
  })

  it('does not fragment projection identity by agent context', async () => {
    let nowMs = baseTimeMs
    const redis = memoryClient(() => nowMs)
    const source = vi.fn<CatalogProductFetcher>(async () => fetched('shared-product'))
    const fetchCatalog = createCatalogReadModelFetcher(source, {
      getClient: async () => redis.client,
      freshForMs,
      nowMs: () => nowMs
    })
    const firstRequest = request({
      searchRequest: {
        ...request().searchRequest,
        agentContext: {
          integrationId: 'assistant-one',
          surface: 'hermes_agent',
          requestedActionScope: 'read:search',
          externalSubjectRef: 'shopper-one',
          externalTaskRef: 'task-one',
          hostCapabilities: ['source_labels']
        }
      }
    })
    const secondRequest = request({
      requestId: 'request-from-another-agent',
      correlationId: 'correlation-from-another-agent',
      searchRequest: {
        ...request().searchRequest,
        agentContext: {
          integrationId: 'assistant-two',
          surface: 'hermes_agent',
          requestedActionScope: 'read:search',
          externalSubjectRef: 'shopper-two',
          externalTaskRef: 'task-two',
          hostCapabilities: ['freshness']
        }
      }
    })

    await fetchCatalog(firstRequest)
    const projected = await fetchCatalog(secondRequest)

    expect(source).toHaveBeenCalledTimes(1)
    expect(projected.products[0]?.productId).toBe('shared-product')
    expect(projected.cacheLayer).toBe('projection')
    expect(redis.values.size).toBe(1)
  })
})
