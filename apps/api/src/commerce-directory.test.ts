import { describe, expect, it, vi } from 'vitest'
import { UCP_STABLE_VERSION } from '@arro/contracts'
import {
  createCommerceDirectory,
  createLiveUcpProfileCommerceDirectoryProvider,
  createUcpCheckerRegistryDirectoryProvider
} from './commerce-directory.ts'

describe('CommerceDirectory', () => {
  it('resolves explicit merchant domains into UCP profile URLs', async () => {
    const directory = createCommerceDirectory()

    await expect(directory.resolve({ merchantDomain: 'merchant.example' }))
      .resolves
      .toMatchObject({
        canonicalOrigin: 'https://merchant.example',
        profileUrl: 'https://merchant.example/.well-known/ucp',
        source: 'direct_domain'
      })
  })

  it('resolves Shopify selected-offer seller domains and checkout URLs without per-merchant configuration', async () => {
    const directory = createCommerceDirectory()

    await expect(directory.resolve({
      selectedOffer: {
        checkout_url: 'https://levelupkickzz.myshopify.com/checkouts/cn/checkout-token',
        seller: {
          name: 'LevelUpKickz',
          domain: 'levelupkickzz.myshopify.com'
        }
      }
    }))
      .resolves
      .toMatchObject({
        canonicalOrigin: 'https://levelupkickzz.myshopify.com',
        profileUrl: 'https://levelupkickzz.myshopify.com/.well-known/ucp',
        displayName: 'LevelUpKickz',
        platform: 'shopify',
        source: 'selected_offer'
      })
  })

  it('rejects unsafe or unresolved merchant identity', async () => {
    const directory = createCommerceDirectory()

    await expect(directory.resolve({
      selectedOffer: {
        seller: {
          url: 'https://user:pass@merchant.example'
        }
      }
    })).rejects.toThrow('commerce_directory_merchant_unresolved')
  })

  it('prefers nested Shopify selected-seller identity before catalog-level product URLs', async () => {
    const directory = createCommerceDirectory()

    await expect(directory.resolve({
      selectedOffer: {
        product_url: 'https://shopify.com/products/global-catalog-product',
        seller: {
          name: 'House of Parfum',
          shopify_domain: 'houseofparfum.myshopify.com'
        }
      }
    }))
      .resolves
      .toMatchObject({
        canonicalOrigin: 'https://houseofparfum.myshopify.com',
        profileUrl: 'https://houseofparfum.myshopify.com/.well-known/ucp',
        displayName: 'House of Parfum',
        platform: 'shopify'
      })
  })

  it('validates and caches UCP-ready merchant candidates at runtime', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      ucp: {
        version: UCP_STABLE_VERSION,
        services: {
          'dev.ucp.shopping': [
            {
              version: UCP_STABLE_VERSION,
              transport: 'rest',
              endpoint: 'https://houseofparfum.nl/ucp'
            }
          ]
        },
        capabilities: {
          'dev.ucp.shopping.cart': [{
            version: UCP_STABLE_VERSION,
            schema: `https://ucp.dev/${UCP_STABLE_VERSION}/schemas/shopping/cart.json`
          }],
          'dev.ucp.shopping.checkout': [{
            version: UCP_STABLE_VERSION,
            schema: `https://ucp.dev/${UCP_STABLE_VERSION}/schemas/shopping/checkout.json`
          }]
        },
        payment_handlers: {}
      }
    }))
    const provider = createLiveUcpProfileCommerceDirectoryProvider({
      fetch: fetcher,
      now: () => new Date('2026-07-11T00:00:00.000Z')
    })
    const directory = createCommerceDirectory([provider])

    const first = await directory.resolve({ merchantDomain: 'houseofparfum.nl' })
    const second = await directory.resolve({ merchantDomain: 'houseofparfum.nl' })

    expect(first.discoveryState).toBe('profile_valid')
    expect(second.profileUrl).toBe('https://houseofparfum.nl/.well-known/ucp')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('ingests UCP Checker registry pages into a PostgreSQL-shaped cache and dedupes providers', async () => {
    const rows = new Map<string, Record<string, unknown>>()
    const client = {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.includes('max(refreshed_at)')) {
          const latest = [...rows.values()]
            .map((row) => row.refreshed_at as string)
            .sort()
            .at(-1)
          return { rows: [{ latest: latest ?? null }], rowCount: 1 }
        }
        if (sql.includes('insert into ucp_checker_registry_merchants')) {
          const canonicalOrigin = values[0] as string
          rows.set(canonicalOrigin, {
            canonical_origin: canonicalOrigin,
            domain: values[1],
            profile_url: values[2],
            display_name: values[3],
            platform: values[4],
            advisory_score: values[5],
            capabilities_json: values[6],
            provider: 'ucp_checker',
            source_ref: values[7],
            refreshed_at: values[8],
            stale_after: values[9]
          })
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('where canonical_origin = $1')) {
          const row = rows.get(values[0] as string)
          return { rows: row ? [row] : [], rowCount: row ? 1 : 0 }
        }
        if (sql.includes('where domain = $1')) {
          const domain = values[0] as string
          return {
            rows: [...rows.values()].filter((row) => row.domain === domain),
            rowCount: rows.size
          }
        }
        return { rows: [], rowCount: 0 }
      })
    }
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({
        merchants: [
          {
            domain: 'houseofparfum.nl',
            name: 'House of Parfum',
            score: 94,
            capabilities: ['products', 'cart', 'checkout', 'buyer_consent']
          },
          {
            profile_url: 'https://houseofparfum.nl/.well-known/ucp',
            name: 'House of Parfum duplicate',
            score: 90
          }
        ]
      }))
      .mockRejectedValueOnce(new Error('offline'))
    const provider = createUcpCheckerRegistryDirectoryProvider({
      client,
      registryUrl: 'https://ucpchecker.com/api/registry',
      fetch: fetcher,
      cacheTtlMs: 1,
      staleCacheTtlMs: 60_000,
      now: () => new Date('2026-07-11T00:00:00.000Z')
    })
    const directory = createCommerceDirectory([provider])

    const first = await directory.resolve({ merchantDomain: 'houseofparfum.nl' })
    // The second resolve must be served from the cached registry snapshot, which
    // is why the offline second fetch never runs.
    const second = await directory.resolve({ merchantDomain: 'houseofparfum.nl' })

    expect(first).toMatchObject({
      canonicalOrigin: 'https://houseofparfum.nl',
      profileUrl: 'https://houseofparfum.nl/.well-known/ucp',
      source: 'ucp_checker_registry',
      advisoryScore: 94
    })
    expect(second).toMatchObject({ canonicalOrigin: 'https://houseofparfum.nl' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
