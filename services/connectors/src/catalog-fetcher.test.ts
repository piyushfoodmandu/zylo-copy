import { describe, expect, it } from 'vitest'
import type { CatalogProductSearchInput, TargetBusinessRecord } from '@arro/contracts'
import {
  approvedCatalogSourcesForPolicy,
  CatalogProductValidationError,
  createTimeoutEnforcedCatalogFetcher,
  createUnavailableCatalogFetcher,
  validateCatalogProductsForSource
} from './catalog-fetcher.ts'

const now = new Date('2026-06-01T00:00:00.000Z')

const approvedRecord: TargetBusinessRecord = {
  businessId: 'approved-catalog-source',
  domain: 'approved.example.com',
  displayName: 'Approved Catalog Source',
  sourceType: 'direct_ucp',
  launchStatus: 'launch_visible',
  featureVisibility: 'catalog_visible',
  accessPolicyState: 'approved',
  profileUrl: 'https://approved.example.com/.well-known/ucp',
  profileHash: 'sha256:approved-profile',
  capabilities: [
    {
      capability: 'dev.ucp.shopping.catalog.search',
      status: 'approved',
      source: 'arro_conformance'
    }
  ],
  evidence: [
    {
      kind: 'arro_conformance',
      source: 'target_business_conformance_runs:77; request:approved',
      observedAt: '2026-06-01T00:00:00.000Z',
      expiresAt: '2026-06-02T00:00:00.000Z',
      summary: 'Conformance passed for profile sha256:approved-profile with 8 passing checks.'
    }
  ],
  userFacingStatus: {
    label: 'Admin review recorded',
    reason: 'Source authority remains limited until conformance and explicit approval are complete.',
    nextAction: 'Keep discovery, conformance, and policy evidence current before launch exposure.'
  }
}

const product: CatalogProductSearchInput = {
  productId: 'approved-running-shoe-neutral',
  businessId: 'approved-catalog-source',
  businessName: 'Approved Catalog Source',
  title: 'Approved Neutral Daily Running Shoe',
  brand: 'Approved Run Lab',
  description: 'Neutral road running shoe from an approved source.',
  categoryPath: ['Footwear', 'Running Shoes'],
  variantId: 'approved-running-shoe-neutral-10',
  price: { amountMinor: 118, currency: 'USD' },
  availability: 'in_stock',
  condition: 'new',
  productUrl: 'https://approved.example.com/products/running-shoe-neutral',
  tags: ['running', 'shoe', 'trainer'],
  sourceLabel: {
    sourceId: 'approved-catalog-source',
    sourceName: 'Approved Catalog Source',
    factType: 'approved_catalog_product',
    fetchedAt: now.toISOString(),
    expiresAt: '2026-06-01T00:15:00.000Z',
    freshnessClass: 'advisory_catalog',
    bindingStatus: 'advisory'
  }
}

describe('approved catalog source policy boundary', () => {
  it('derives fetchable sources only from allowed current catalog-visible records', () => {
    const sources = approvedCatalogSourcesForPolicy({
      records: [approvedRecord],
      allowedBusinessIds: ['approved-catalog-source'],
      now
    })

    expect(sources).toEqual([
      {
        businessId: 'approved-catalog-source',
        domain: 'approved.example.com',
        displayName: 'Approved Catalog Source',
        sourceType: 'direct_ucp',
        profileUrl: 'https://approved.example.com/.well-known/ucp',
        profileHash: 'sha256:approved-profile'
      }
    ])
  })

  it('rejects product facts that include commercial fields', () => {
    expect(() => validateCatalogProductsForSource({
      source: {
        businessId: 'approved-catalog-source',
        domain: 'approved.example.com',
        displayName: 'Approved Catalog Source',
        sourceType: 'direct_ucp'
      },
      products: [
        {
          ...product,
          commissionRate: 0.25
        }
      ]
    })).toThrow(CatalogProductValidationError)
  })

  it('rejects products whose business or source label does not match the approved source', () => {
    expect(() => validateCatalogProductsForSource({
      source: {
        businessId: 'approved-catalog-source',
        domain: 'approved.example.com',
        displayName: 'Approved Catalog Source',
        sourceType: 'direct_ucp'
      },
      products: [
        {
          ...product,
          sourceLabel: {
            ...product.sourceLabel,
            sourceId: 'other-source'
          }
        }
      ]
    })).toThrow(/does not belong to source/)
  })

  it('provides an explicit unavailable fetcher for sources without live adapters', async () => {
    const fetcher = createUnavailableCatalogFetcher()
    const result = await fetcher({
      requestId: 'fetch-request',
      correlationId: 'fetch-correlation',
      timeoutMs: 250,
      now,
      source: {
        businessId: 'approved-catalog-source',
        domain: 'approved.example.com',
        displayName: 'Approved Catalog Source',
        sourceType: 'direct_ucp'
      },
      searchRequest: { query: 'running shoe' }
    })

    expect(result).toMatchObject({
      sourceId: 'approved-catalog-source',
      sourceName: 'Approved Catalog Source',
      status: 'unavailable',
      products: [],
      messages: [
        {
          code: 'connector_catalog_fetcher_not_configured'
        }
      ]
    })
  })

  it('returns a timeout result when an adapter exceeds its budget', async () => {
    const fetcher = createTimeoutEnforcedCatalogFetcher(async () =>
      new Promise(() => undefined)
    )
    const result = await fetcher({
      requestId: 'fetch-request',
      correlationId: 'fetch-correlation',
      timeoutMs: 1,
      now,
      source: {
        businessId: 'approved-catalog-source',
        domain: 'approved.example.com',
        displayName: 'Approved Catalog Source',
        sourceType: 'direct_ucp'
      },
      searchRequest: { query: 'running shoe' }
    })

    expect(result.status).toBe('timeout')
    expect(result.messages[0]?.code).toBe('connector_catalog_fetch_timeout')
    expect(result.products).toEqual([])
  })

  it('passes an abortable signal to adapters and returns timeout status', async () => {
    let observedSignal: AbortSignal | undefined
    const fetcher = createTimeoutEnforcedCatalogFetcher(async ({ signal }) => {
      observedSignal = signal
      return new Promise(() => undefined)
    })
    const result = await fetcher({
      requestId: 'fetch-request',
      correlationId: 'fetch-correlation',
      timeoutMs: 1,
      now,
      source: {
        businessId: 'approved-catalog-source',
        domain: 'approved.example.com',
        displayName: 'Approved Catalog Source',
        sourceType: 'direct_ucp'
      },
      searchRequest: { query: 'running shoe' }
    })

    expect(result.status).toBe('timeout')
    expect(observedSignal?.aborted).toBe(true)
  })

  it('returns an aborted result when the caller signal is already canceled', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetcher = createTimeoutEnforcedCatalogFetcher(async () => ({
      sourceId: 'approved-catalog-source',
      sourceName: 'Approved Catalog Source',
      status: 'fetched',
      products: [product],
      messages: [],
      fetchedAt: now.toISOString(),
      latencyMs: 0
    }))

    const result = await fetcher({
      requestId: 'fetch-request',
      correlationId: 'fetch-correlation',
      timeoutMs: 250,
      signal: controller.signal,
      now,
      source: {
        businessId: 'approved-catalog-source',
        domain: 'approved.example.com',
        displayName: 'Approved Catalog Source',
        sourceType: 'direct_ucp'
      },
      searchRequest: { query: 'running shoe' }
    })

    expect(result.status).toBe('error')
    expect(result.messages[0]?.code).toBe('connector_catalog_fetch_aborted')
    expect(result.products).toEqual([])
  })

  it('normalizes thrown adapter errors without leaking raw error details', async () => {
    const fetcher = createTimeoutEnforcedCatalogFetcher(async () => {
      throw new Error('secret adapter failure detail')
    })
    const result = await fetcher({
      requestId: 'fetch-request',
      correlationId: 'fetch-correlation',
      timeoutMs: 250,
      now,
      source: {
        businessId: 'approved-catalog-source',
        domain: 'approved.example.com',
        displayName: 'Approved Catalog Source',
        sourceType: 'direct_ucp'
      },
      searchRequest: { query: 'running shoe' }
    })

    expect(result.status).toBe('error')
    expect(result.messages[0]?.code).toBe('connector_catalog_fetch_failed')
    expect(JSON.stringify(result)).not.toContain('secret adapter failure detail')
  })
})
