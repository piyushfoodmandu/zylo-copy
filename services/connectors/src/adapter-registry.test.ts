import { describe, expect, it, vi } from 'vitest'
import type { CatalogProductSearchInput } from '@arro/contracts'
import type { CatalogProductFetcher } from './catalog-fetcher.ts'
import {
  CatalogAdapterRegistryError,
  createCatalogAdapterDispatcher,
  type CatalogAdapterDescriptor
} from './adapter-registry.ts'

const now = new Date('2026-06-01T00:00:00.000Z')

const product: CatalogProductSearchInput = {
  productId: 'registered-iphone-16-pro',
  businessId: 'registered-source',
  businessName: 'Registered Source',
  title: 'Registered iPhone 16 Pro',
  brand: 'Apple',
  description: 'Contract-safe product facts from a registered adapter.',
  categoryPath: ['Electronics', 'Smartphones'],
  price: { amountMinor: 999, currency: 'USD' },
  availability: 'in_stock',
  condition: 'new',
  productUrl: 'https://registered.example.com/products/iphone-16-pro',
  tags: ['iphone', 'mobile', 'smartphone'],
  sourceLabel: {
    sourceId: 'registered-source',
    sourceName: 'Registered Source',
    factType: 'approved_catalog_product',
    fetchedAt: now.toISOString(),
    expiresAt: '2026-06-01T00:15:00.000Z',
    freshnessClass: 'advisory_catalog',
    bindingStatus: 'advisory'
  }
}

const fetchRequest = {
  requestId: 'adapter-request',
  correlationId: 'adapter-correlation',
  timeoutMs: 250,
  now,
  source: {
    businessId: 'registered-source',
    domain: 'registered.example.com',
    displayName: 'Registered Source',
    sourceType: 'direct_ucp' as const
  },
  searchRequest: { query: 'iphone' }
}

describe('catalog adapter registry', () => {
  it('dispatches approved-source fetches to the registered business adapter', async () => {
    const fetcher = vi.fn<CatalogProductFetcher>(async ({ source }) => ({
      sourceId: source.businessId,
      sourceName: source.displayName,
      status: 'fetched',
      products: [product],
      messages: [],
      fetchedAt: now.toISOString(),
      latencyMs: 3
    }))
    const dispatcher = createCatalogAdapterDispatcher([
      {
        adapterId: 'registered-source-rest-v1',
        businessId: 'registered-source',
        transport: 'rest',
        fetcher
      }
    ])

    const result = await dispatcher(fetchRequest)

    expect(fetcher).toHaveBeenCalledWith(fetchRequest)
    expect(result).toMatchObject({
      sourceId: 'registered-source',
      status: 'fetched',
      products: [product]
    })
  })

  it('returns an unavailable result when no adapter is registered for the approved source', async () => {
    const dispatcher = createCatalogAdapterDispatcher([])
    const result = await dispatcher(fetchRequest)

    expect(result).toMatchObject({
      sourceId: 'registered-source',
      sourceName: 'Registered Source',
      status: 'unavailable',
      products: [],
      messages: [
        expect.objectContaining({
          code: 'approved_catalog_adapter_not_registered'
        })
      ]
    })
  })

  it('rejects duplicate business registrations before dispatch', () => {
    const descriptors: CatalogAdapterDescriptor[] = [
      {
        adapterId: 'registered-source-rest-v1',
        businessId: 'registered-source',
        transport: 'rest',
        fetcher: async () => ({
          sourceId: 'registered-source',
          sourceName: 'Registered Source',
          status: 'unavailable',
          products: [],
          messages: [],
          fetchedAt: now.toISOString(),
          latencyMs: 0
        })
      },
      {
        adapterId: 'registered-source-rest-v2',
        businessId: 'registered-source',
        transport: 'rest',
        fetcher: async () => ({
          sourceId: 'registered-source',
          sourceName: 'Registered Source',
          status: 'unavailable',
          products: [],
          messages: [],
          fetchedAt: now.toISOString(),
          latencyMs: 0
        })
      }
    ]

    expect(() => createCatalogAdapterDispatcher(descriptors)).toThrow(CatalogAdapterRegistryError)
  })
})