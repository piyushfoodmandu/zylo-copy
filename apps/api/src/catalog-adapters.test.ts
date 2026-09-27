import { describe, expect, it, vi } from 'vitest'
import type { CatalogProductFetchRequest } from '@arro/connectors'
import {
  createRuntimeCatalogAdapterRegistry,
  createRuntimeCatalogProductFetcher,
  RuntimeCatalogAdapterConfigError
} from './catalog-adapters.ts'

const request: CatalogProductFetchRequest = {
  requestId: 'runtime-adapter-request',
  correlationId: 'runtime-adapter-correlation',
  source: {
    businessId: 'missing-runtime-adapter',
    domain: 'missing.example.com',
    displayName: 'Missing Runtime Adapter',
    sourceType: 'direct_ucp'
  },
  searchRequest: { query: 'iphone mobile' },
  timeoutMs: 250,
  now: new Date('2026-06-01T00:00:00.000Z')
}

describe('runtime catalog adapter configuration', () => {
  it('uses Shopify Global Catalog broad discovery as the built-in catalog source', () => {
    const registry = createRuntimeCatalogAdapterRegistry({}, {
      platformProfileUrl: 'https://arro.example.com/.well-known/ucp',
      fetcher: vi.fn()
    })

    expect(registry.connectedSources).toEqual([
      expect.objectContaining({
        businessId: 'shopify-global-catalog',
        domain: 'catalog.shopify.com',
        displayName: 'Shopify Global Catalog',
        sourceType: 'managed_channel'
      })
    ])
  })

  it('allows an explicit empty adapter registry to disable catalog sources', async () => {
    const registry = createRuntimeCatalogAdapterRegistry({
      CATALOG_ADAPTERS_JSON: '[]'
    })
    const result = await registry.fetcher(request)

    expect(registry.connectedSources).toEqual([])
    expect(result.status).toBe('unavailable')
    expect(result.products).toEqual([])
    expect(result.messages[0]?.code).toBe('connector_catalog_fetcher_not_configured')
  })

  it('rejects malformed adapter JSON at startup', () => {
    expect(() => createRuntimeCatalogProductFetcher({
      CATALOG_ADAPTERS_JSON: '{not-json'
    })).toThrow(RuntimeCatalogAdapterConfigError)
  })

  it('requires referenced connector secrets to exist', () => {
    expect(() => createRuntimeCatalogProductFetcher({
      CATALOG_ADAPTERS_JSON: JSON.stringify([
        {
          kind: 'shopify_storefront_graphql',
          adapterId: 'approved-shopify',
          businessId: 'approved-shop',
          shopDomain: 'approved-shop.myshopify.com',
          storefrontAccessTokenEnv: 'APPROVED_SHOPIFY_STOREFRONT_TOKEN'
        }
      ])
    })).toThrow(/APPROVED_SHOPIFY_STOREFRONT_TOKEN/)
  })

  it('requires a platform profile URL for MCP adapters', () => {
    expect(() => createRuntimeCatalogProductFetcher({
      CATALOG_ADAPTERS_JSON: JSON.stringify([
        {
          kind: 'shopify_storefront_mcp',
          adapterId: 'approved-shopify-mcp',
          businessId: 'approved-shop',
          shopDomain: 'approved-shop.myshopify.com'
        }
      ])
    })).toThrow(/platformProfileUrl/)
  })

  it('registers UCP MCP adapters as catalog/detail discovery sources only', async () => {
    const registry = createRuntimeCatalogAdapterRegistry({
      CATALOG_ADAPTERS_JSON: JSON.stringify([
        {
          kind: 'ucp_mcp',
          adapterId: 'approved-ucp-mcp',
          businessId: 'approved-ucp-business',
          displayName: 'Approved UCP Business',
          endpointUrl: 'https://approved.example.com/api/ucp/mcp'
        }
      ])
    }, {
      platformProfileUrl: 'https://arro.example.com/.well-known/ucp'
    })

    const result = await registry.fetcher(request)

    expect(Object.keys(registry).sort()).toEqual(['connectedSources', 'detailFetcher', 'fetcher'])
    expect(registry.connectedSources).toEqual([
      expect.objectContaining({
        businessId: 'approved-ucp-business',
        domain: 'approved.example.com',
        displayName: 'Approved UCP Business',
        sourceType: 'direct_ucp'
      })
    ])
    expect(result.status).toBe('unavailable')
    expect(result.messages[0]?.code).toBe('approved_catalog_adapter_not_registered')
  })

  it('ignores obsolete cart/checkout descriptor fields instead of exposing adapter-level transaction engines', () => {
    const registry = createRuntimeCatalogAdapterRegistry({
      CATALOG_ADAPTERS_JSON: JSON.stringify([
        {
          kind: 'ucp_mcp',
          adapterId: 'approved-ucp-mcp',
          businessId: 'approved-ucp-business',
          displayName: 'Approved UCP Business',
          endpointUrl: 'https://approved.example.com/api/ucp/mcp',
          cartPreparation: {
            enabled: true,
            toolName: 'create_checkout'
          },
          checkoutCompletion: {
            enabled: true,
            toolName: 'complete_checkout',
            paymentHandlerProof: true
          }
        }
      ])
    }, {
      platformProfileUrl: 'https://arro.example.com/.well-known/ucp',
      fetcher: vi.fn()
    })

    expect(Object.keys(registry).sort()).toEqual(['connectedSources', 'detailFetcher', 'fetcher'])
  })

  it('allows loopback platform profile URLs only for local development', () => {
    const env = {
      CATALOG_ADAPTERS_JSON: JSON.stringify([
        {
          kind: 'shopify_global_catalog_mcp',
          mode: 'broad_discovery',
          adapterId: 'shopify-global-broad-mcp',
          businessId: 'shopify-global-catalog'
        }
      ])
    }

    expect(() => createRuntimeCatalogAdapterRegistry(env, {
      platformProfileUrl: 'http://127.0.0.1:3000/.well-known/ucp'
    })).toThrow(/platform profile URL must use HTTPS/)

    expect(() => createRuntimeCatalogAdapterRegistry(env, {
      platformProfileUrl: 'http://127.0.0.1:3000/.well-known/ucp',
      allowLocalPlatformProfileUrl: true
    })).not.toThrow()
  })

  it('does not allow insecure non-local platform profile URLs in local development', () => {
    expect(() => createRuntimeCatalogAdapterRegistry({
      CATALOG_ADAPTERS_JSON: JSON.stringify([
        {
          kind: 'ucp_mcp',
          adapterId: 'approved-ucp-mcp',
          businessId: 'approved-ucp-business',
          endpointUrl: 'https://approved.example.com/api/ucp/mcp'
        }
      ])
    }, {
      platformProfileUrl: 'http://api.arro.com/.well-known/ucp',
      allowLocalPlatformProfileUrl: true
    })).toThrow(/platform profile URL must use HTTPS/)
  })
})
