import { describe, expect, it } from 'vitest'
import type {
  ApprovedCatalogSource,
  CatalogProductFetcher
} from '@arro/connectors'
import type { CatalogProductSearchInput } from '@arro/contracts'
import { fetchConnectorCatalogProducts } from './connector-catalog-fetch.ts'

const now = new Date('2026-06-01T00:00:00.000Z')

const source = (businessId: string): ApprovedCatalogSource => ({
  businessId,
  domain: `${businessId}.example.com`,
  displayName: businessId,
  sourceType: 'direct_ucp'
})

const productForSource = (catalogSource: ApprovedCatalogSource): CatalogProductSearchInput => ({
  productId: `${catalogSource.businessId}-shoe`,
  businessId: catalogSource.businessId,
  businessName: catalogSource.displayName,
  title: `${catalogSource.displayName} Running Shoe`,
  brand: 'Arro Test Brand',
  description: 'Source-scoped catalog product for connector fan-out testing.',
  categoryPath: ['Footwear', 'Running Shoes'],
  price: { amountMinor: 120, currency: 'USD' },
  availability: 'in_stock',
  condition: 'new',
  productUrl: `https://${catalogSource.domain}/products/shoe`,
  tags: ['running'],
  sourceLabel: {
    sourceId: catalogSource.businessId,
    sourceName: catalogSource.displayName,
    factType: 'approved_catalog_product',
    fetchedAt: now.toISOString(),
    freshnessClass: 'advisory_catalog',
    bindingStatus: 'advisory'
  }
})

describe('connector catalog fetch budget', () => {
  it('limits source fan-out and per-request concurrency before connector dispatch', async () => {
    const sources = [
      source('source-one'),
      source('source-two'),
      source('source-three')
    ]
    const startedSources: string[] = []
    let activeFetches = 0
    let maxActiveFetches = 0

    const fetcher: CatalogProductFetcher = async ({ source: catalogSource }) => {
      startedSources.push(catalogSource.businessId)
      activeFetches += 1
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches)
      await Promise.resolve()
      activeFetches -= 1

      return {
        sourceId: catalogSource.businessId,
        sourceName: catalogSource.displayName,
        status: 'fetched',
        products: [productForSource(catalogSource)],
        fetchedAt: now.toISOString(),
        latencyMs: 1,
        messages: []
      }
    }

    const result = await fetchConnectorCatalogProducts({
      requestId: 'fan-out-budget-request',
      correlationId: 'fan-out-budget-correlation',
      searchRequest: { query: 'running shoe' },
      sources,
      fetcher,
      timeoutMs: 250,
      now,
      maxSourcesPerRequest: 2,
      maxConcurrencyPerRequest: 1
    })

    expect(startedSources).toEqual(['source-one', 'source-two'])
    expect(maxActiveFetches).toBe(1)
    expect(result.products.map((product) => product.businessId)).toEqual([
      'source-one',
      'source-two'
    ])
    expect(result.summary).toMatchObject({
      requestedSourceCount: 3,
      dispatchedSourceCount: 2,
      skippedSourceCount: 1,
      fetchedSourceCount: 2,
      resultProductCount: 2
    })
    expect(result.messages.map((message) => message.code)).toContain(
      'connector_catalog_source_budget_limited'
    )
  })

  it('applies an API-decoded cursor only to its matching source and preserves the next source cursor', async () => {
    const catalogSource = source('source-one')
    let receivedCursor: string | undefined
    const fetcher: CatalogProductFetcher = async ({ source: fetchedSource, searchRequest }) => {
      receivedCursor = searchRequest.pagination?.cursor
      return {
        sourceId: fetchedSource.businessId,
        sourceName: fetchedSource.displayName,
        status: 'fetched',
        products: [productForSource(fetchedSource)],
        pagination: { cursor: 'source-next-cursor', hasNextPage: true },
        fetchedAt: now.toISOString(),
        latencyMs: 1,
        messages: []
      }
    }

    const result = await fetchConnectorCatalogProducts({
      requestId: 'cursor-request',
      correlationId: 'cursor-correlation',
      searchRequest: { query: 'running shoe', pagination: { limit: 20 } },
      sources: [catalogSource],
      sourceCursors: new Map([[catalogSource.businessId, 'source-current-cursor']]),
      fetcher,
      timeoutMs: 250,
      now
    })

    expect(receivedCursor).toBe('source-current-cursor')
    expect(result.fetchResults[0]?.pagination).toEqual({
      cursor: 'source-next-cursor',
      hasNextPage: true
    })
  })

  it('coalesces identical source fetches inside the configured short window', async () => {
    const catalogSource = source('source-one')
    let fetchCount = 0
    const fetcher: CatalogProductFetcher = async ({ source: fetchedSource }) => {
      fetchCount += 1
      await Promise.resolve()

      return {
        sourceId: fetchedSource.businessId,
        sourceName: fetchedSource.displayName,
        status: 'fetched',
        products: [productForSource(fetchedSource)],
        fetchedAt: now.toISOString(),
        latencyMs: 1,
        messages: []
      }
    }

    const [firstResult, secondResult] = await Promise.all([
      fetchConnectorCatalogProducts({
        requestId: 'coalesced-request-one',
        correlationId: 'coalesced-correlation-one',
        searchRequest: {
          query: 'running shoe',
          agentContext: {
            integrationId: 'test-agent-one',
            surface: 'direct_http',
            requestedActionScope: 'read:search',
            externalSubjectRef: 'opaque-subject-one'
          }
        },
        sources: [catalogSource],
        fetcher,
        timeoutMs: 250,
        now,
        coalescingWindowMs: 1000
      }),
      fetchConnectorCatalogProducts({
        requestId: 'coalesced-request-two',
        correlationId: 'coalesced-correlation-two',
        searchRequest: {
          query: 'running shoe',
          agentContext: {
            integrationId: 'test-agent-two',
            surface: 'direct_http',
            requestedActionScope: 'read:search',
            externalSubjectRef: 'opaque-subject-two'
          }
        },
        sources: [catalogSource],
        fetcher,
        timeoutMs: 250,
        now,
        coalescingWindowMs: 1000
      })
    ])

    expect(fetchCount).toBe(1)
    expect(firstResult.products).toHaveLength(1)
    expect(secondResult.products).toHaveLength(1)
    expect(firstResult.summary.coalescedSourceCount).toBe(0)
    expect(secondResult.summary.coalescedSourceCount).toBe(1)
  })

  it('does not coalesce source fetches when structured search intent differs', async () => {
    const catalogSource = source('source-intent-aware')
    const receivedIntents: unknown[] = []
    const fetcher: CatalogProductFetcher = async ({ source: fetchedSource, searchRequest }) => {
      receivedIntents.push(searchRequest.intent)

      return {
        sourceId: fetchedSource.businessId,
        sourceName: fetchedSource.displayName,
        status: 'fetched',
        products: [productForSource(fetchedSource)],
        fetchedAt: now.toISOString(),
        latencyMs: 1,
        messages: []
      }
    }

    const [firstResult, secondResult] = await Promise.all([
      fetchConnectorCatalogProducts({
        requestId: 'intent-aware-request-one',
        correlationId: 'intent-aware-correlation-one',
        searchRequest: {
          query: 'laundry',
          intent: { productTypes: ['washing machine'] }
        },
        sources: [catalogSource],
        fetcher,
        timeoutMs: 250,
        now,
        coalescingWindowMs: 1000
      }),
      fetchConnectorCatalogProducts({
        requestId: 'intent-aware-request-two',
        correlationId: 'intent-aware-correlation-two',
        searchRequest: {
          query: 'laundry',
          intent: { productTypes: ['laundry basket'] }
        },
        sources: [catalogSource],
        fetcher,
        timeoutMs: 250,
        now,
        coalescingWindowMs: 1000
      })
    ])

    expect(receivedIntents).toEqual([
      { productTypes: ['washing machine'] },
      { productTypes: ['laundry basket'] }
    ])
    expect(firstResult.summary.coalescedSourceCount).toBe(0)
    expect(secondResult.summary.coalescedSourceCount).toBe(0)
  })

  it('keeps a coalesced source fetch alive when another waiter is still active', async () => {
    const catalogSource = source('source-coalesce-survives-abort')
    const firstController = new AbortController()
    const secondController = new AbortController()
    let fetchCount = 0
    let sharedSignal: AbortSignal | undefined
    let resolveFetch!: () => void

    const fetcher: CatalogProductFetcher = async ({ source: fetchedSource, signal }) => {
      fetchCount += 1
      sharedSignal = signal

      await new Promise<void>((resolve, reject) => {
        resolveFetch = resolve
        signal?.addEventListener('abort', () => {
          reject(signal.reason ?? new Error('shared fetch aborted'))
        }, { once: true })
      })

      return {
        sourceId: fetchedSource.businessId,
        sourceName: fetchedSource.displayName,
        status: 'fetched',
        products: [productForSource(fetchedSource)],
        fetchedAt: now.toISOString(),
        latencyMs: 1,
        messages: []
      }
    }

    const firstResultPromise = fetchConnectorCatalogProducts({
      requestId: 'coalesced-cancelled-request',
      correlationId: 'coalesced-cancelled-correlation',
      searchRequest: { query: 'coalesced cancellation shoe' },
      sources: [catalogSource],
      fetcher,
      timeoutMs: 250,
      now,
      signal: firstController.signal,
      coalescingWindowMs: 1000
    })
    await Promise.resolve()
    const secondResultPromise = fetchConnectorCatalogProducts({
      requestId: 'coalesced-active-request',
      correlationId: 'coalesced-active-correlation',
      searchRequest: { query: 'coalesced cancellation shoe' },
      sources: [catalogSource],
      fetcher,
      timeoutMs: 250,
      now,
      signal: secondController.signal,
      coalescingWindowMs: 1000
    })
    await Promise.resolve()

    firstController.abort(new Error('first caller cancelled'))
    await Promise.resolve()

    expect(sharedSignal?.aborted).toBe(false)

    resolveFetch()
    const [firstResult, secondResult] = await Promise.all([
      firstResultPromise,
      secondResultPromise
    ])

    expect(fetchCount).toBe(1)
    expect(firstResult.products).toHaveLength(0)
    expect(firstResult.summary.errorSourceCount).toBe(1)
    expect(secondResult.products).toHaveLength(1)
    expect(secondResult.summary.coalescedSourceCount).toBe(1)
  })

  it('aborts coalesced source work after every waiter cancels', async () => {
    const catalogSource = source('source-coalesce-all-cancelled')
    const firstController = new AbortController()
    const secondController = new AbortController()
    let fetchCount = 0
    let sharedSignal: AbortSignal | undefined

    const fetcher: CatalogProductFetcher = async ({ signal }) => {
      fetchCount += 1
      sharedSignal = signal

      await new Promise<void>((_, reject) => {
        signal?.addEventListener('abort', () => {
          reject(signal.reason ?? new Error('shared fetch aborted'))
        }, { once: true })
      })

      throw new Error('unreachable')
    }

    const firstResultPromise = fetchConnectorCatalogProducts({
      requestId: 'coalesced-all-cancelled-request-one',
      correlationId: 'coalesced-all-cancelled-correlation-one',
      searchRequest: { query: 'coalesced all cancelled shoe' },
      sources: [catalogSource],
      fetcher,
      timeoutMs: 250,
      now,
      signal: firstController.signal,
      coalescingWindowMs: 1000
    })
    await Promise.resolve()
    const secondResultPromise = fetchConnectorCatalogProducts({
      requestId: 'coalesced-all-cancelled-request-two',
      correlationId: 'coalesced-all-cancelled-correlation-two',
      searchRequest: { query: 'coalesced all cancelled shoe' },
      sources: [catalogSource],
      fetcher,
      timeoutMs: 250,
      now,
      signal: secondController.signal,
      coalescingWindowMs: 1000
    })
    await Promise.resolve()

    firstController.abort(new Error('first caller cancelled'))
    secondController.abort(new Error('second caller cancelled'))
    const [firstResult, secondResult] = await Promise.all([
      firstResultPromise,
      secondResultPromise
    ])

    expect(fetchCount).toBe(1)
    expect(sharedSignal?.aborted).toBe(true)
    expect(firstResult.summary.errorSourceCount).toBe(1)
    expect(secondResult.summary.errorSourceCount).toBe(1)
  })
})
