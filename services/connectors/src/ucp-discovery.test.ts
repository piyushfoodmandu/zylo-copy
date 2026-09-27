import { describe, expect, it, vi } from 'vitest'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { UcpDiscoveryResponseSchema } from '@arro/contracts'
import type { ConnectorHttpFetcher } from './http-transport.ts'
import {
  connectorHttpResponse as httpResponse,
  discardableConnectorResponse
} from './test-http-response.test-support.ts'
import { discoverUcpProfile } from './ucp-discovery.ts'

const responseValidator = TypeCompiler.Compile(UcpDiscoveryResponseSchema)
const now = new Date('2026-05-30T12:00:00.000Z')

const publicResolver = async () => [{ address: '203.0.113.10' }]

const businessProfile = {
  ucp: {
    version: '2026-08-25',
    services: {
      'dev.ucp.shopping': [{
        version: '2026-08-25',
        transport: 'rest',
        endpoint: 'https://example.com/api/ucp'
      }]
    },
    capabilities: {
      'dev.ucp.shopping.cart': [{
        version: '2026-08-25',
        schema: 'https://ucp.dev/2026-08-25/schemas/shopping/cart.json'
      }],
      'dev.ucp.shopping.catalog.search': [{
        version: '2026-08-25',
        schema: 'https://ucp.dev/2026-08-25/schemas/shopping/catalog_search.json'
      }],
      'dev.ucp.shopping.catalog.lookup': [{
        version: '2026-08-25',
        schema: 'https://ucp.dev/2026-08-25/schemas/shopping/catalog_lookup.json'
      }]
    },
    payment_handlers: {
      'com.example.wallet': [{ id: 'wallet-1', version: '2026-07-15' }]
    }
  },
  keys: [{
    kid: 'example-key',
    kty: 'EC',
    crv: 'P-256',
    alg: 'ES256',
    x: 'x',
    y: 'y'
  }]
}

describe('UCP profile discovery', () => {
  it('fetches, validates, and summarizes a canonical UCP profile without approving access', async () => {
    const fetcher = vi.fn(async (_input: Parameters<ConnectorHttpFetcher>[0], init?: Parameters<ConnectorHttpFetcher>[1]) => {
      expect((init?.headers as Record<string, string>)['UCP-Agent']).toBe('profile="https://arro.example/.well-known/ucp"')

      return httpResponse(JSON.stringify(businessProfile), 200, {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=600'
      })
    })

    const result = await discoverUcpProfile(
      { domain: 'Example.com' },
      {
        requestId: 'req-1',
        correlationId: 'corr-1',
        now,
        fetcher,
        resolver: publicResolver,
        platformProfileUrl: 'https://arro.example/.well-known/ucp'
      }
    )

    expect(responseValidator.Check(result)).toBe(true)
    expect(result.status).toBe('fetched')
    expect(result.accessPolicyState).toBe('profile_fetched')
    expect(result.domain).toBe('example.com')
    expect(result.profileUrl).toBe('https://example.com/.well-known/ucp')
    expect(result.profile?.profileShape).toBe('canonical_ucp')
    expect(result.profile?.capabilities).toEqual([
      'dev.ucp.shopping.cart',
      'dev.ucp.shopping.catalog.lookup',
      'dev.ucp.shopping.catalog.search'
    ])
    expect(result.profile?.services[0]?.transport).toBe('rest')
    expect(result.profile?.cache.maxAgeSeconds).toBe(600)
    expect(result.profile?.dns.checkedAddresses).toEqual(['203.0.113.10'])
    expect(result.profile?.signingKeyCount).toBe(1)
    expect(result.messages[0]?.code).toBe('profile_fetched')
  })

  it('fetches the exact supported-version leaf and never merges the current profile', async () => {
    const current = {
      ucp: {
        version: '2026-09-30',
        supported_versions: {
          '2026-08-25': 'https://profiles.example.com/ucp/2026-08-25'
        },
        services: {
          'dev.ucp.shopping': [{
            version: '2026-09-30',
            transport: 'rest',
            endpoint: 'https://example.com/future'
          }]
        },
        capabilities: {
          'com.example.future_only': [{
            version: '2026-09-30',
            schema: 'https://example.com/future.json'
          }]
        },
        payment_handlers: {}
      },
      keys: [{ kid: 'current', kty: 'OKP', crv: 'Ed25519', x: 'current-x' }]
    }
    const leaf = {
      ...businessProfile,
      keys: [{ kid: 'leaf', kty: 'OKP', crv: 'Ed25519', x: 'leaf-x' }]
    }
    const fetcher = vi.fn(async (input: Parameters<ConnectorHttpFetcher>[0]) => {
      const url = new URL(String(input))
      return httpResponse(JSON.stringify(url.hostname === 'profiles.example.com' ? leaf : current), 200, {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=300'
      })
    })

    const result = await discoverUcpProfile(
      { domain: 'example.com' },
      {
        requestId: 'req-leaf',
        correlationId: 'corr-leaf',
        now,
        fetcher,
        resolver: publicResolver
      }
    )

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(result.status).toBe('fetched')
    expect(result.profileUrl).toBe('https://profiles.example.com/ucp/2026-08-25')
    expect(result.profile?.protocolVersions).toEqual(['2026-08-25'])
    expect(result.profile?.capabilities).not.toContain('com.example.future_only')
    expect(result.profile?.signingKeyCount).toBe(1)
  })

  it('rejects a version leaf that is not self-contained', async () => {
    const current = {
      ucp: {
        version: '2026-09-30',
        supported_versions: {
          '2026-08-25': 'https://profiles.example.com/ucp/2026-08-25'
        }
      }
    }
    const leaf = {
      ...businessProfile,
      ucp: {
        ...businessProfile.ucp,
        supported_versions: {
          '2026-07-01': 'https://profiles.example.com/ucp/2026-07-01'
        }
      }
    }
    const result = await discoverUcpProfile(
      { domain: 'example.com' },
      {
        requestId: 'req-recursive-leaf',
        correlationId: 'corr-recursive-leaf',
        now,
        resolver: publicResolver,
        fetcher: async (input) => httpResponse(
          JSON.stringify(String(input).includes('/2026-08-25') ? leaf : current),
          200,
          { 'content-type': 'application/json' }
        )
      }
    )

    expect(result.status).toBe('invalid_profile')
    expect(result.messages[0]?.code).toBe('profile_leaf_invalid')
  })

  it('rejects a business capability declaration without its required schema', async () => {
    const invalid = structuredClone(businessProfile)
    delete (invalid.ucp.capabilities['dev.ucp.shopping.cart']![0] as Record<string, unknown>).schema
    const result = await discoverUcpProfile(
      { domain: 'example.com' },
      {
        requestId: 'req-capability-schema',
        correlationId: 'corr-capability-schema',
        now,
        resolver: publicResolver,
        fetcher: async () => httpResponse(JSON.stringify(invalid), 200, {
          'content-type': 'application/json'
        })
      }
    )

    expect(result.status).toBe('invalid_profile')
    expect(result.messages[0]?.code).toBe('profile_shape_invalid')
  })

  it('ignores removed signing-key aliases and counts only root keys', async () => {
    const discoverProfile = (signingKeys: unknown, requestId: string) => discoverUcpProfile(
      { domain: 'legacy.example' },
      {
        requestId,
        correlationId: `corr-${requestId}`,
        now,
        resolver: publicResolver,
        fetcher: async () => httpResponse(JSON.stringify({
          ucp: {
            version: '2026-08-25',
            services: {
              'dev.ucp.shopping': [{
                version: '2026-08-25',
                transport: 'rest',
                endpoint: 'https://legacy.example/ucp'
              }]
            },
            capabilities: {
              'dev.ucp.shopping.cart': [{
                version: '2026-08-25',
                schema: 'https://ucp.dev/2026-08-25/schemas/shopping/cart.json'
              }]
            },
            payment_handlers: {},
            signingKeys
          }
        }), 200, {
          'content-type': 'application/json'
        })
      }
    )

    const arrayResult = await discoverProfile(
      [{ kid: 'legacy-array-1' }, { kid: 'legacy-array-2' }],
      'req-legacy-array'
    )

    expect(arrayResult.profile?.signingKeyCount).toBe(0)
  })

  it('does not let legacy aliases conflict with the canonical root key set', async () => {
    const result = await discoverUcpProfile(
      { domain: 'conflicting-keys.example' },
      {
        requestId: 'req-conflicting-keys',
        correlationId: 'corr-conflicting-keys',
        now,
        resolver: publicResolver,
        fetcher: async () => httpResponse(JSON.stringify({
          ucp: {
            version: '2026-08-25',
            services: {
              'dev.ucp.shopping': [{
                version: '2026-08-25',
                transport: 'rest',
                endpoint: 'https://conflicting-keys.example/ucp'
              }]
            },
            capabilities: {
              'dev.ucp.shopping.cart': [{
                version: '2026-08-25',
                schema: 'https://ucp.dev/2026-08-25/schemas/shopping/cart.json'
              }]
            },
            payment_handlers: {},
            signingKeys: {
              legacy: { kid: 'legacy-key' }
            }
          },
          keys: [{ kid: 'current-key', kty: 'OKP', crv: 'Ed25519', x: 'current-x' }],
          signing_keys: [{ kid: 'stable-key' }]
        }), 200, {
          'content-type': 'application/json'
        })
      }
    )

    expect(result.profile?.signingKeyCount).toBe(1)
  })

  it('summarizes canonical service maps that use endpoint URLs', async () => {
    const result = await discoverUcpProfile(
      { domain: 'mapped.example' },
      {
        requestId: 'req-service-map',
        correlationId: 'corr-service-map',
        now,
        resolver: publicResolver,
        fetcher: async () => httpResponse(JSON.stringify({
          ucp: {
            version: '2026-08-25',
            services: {
              'dev.ucp.shopping': [
                {
                  version: '2026-08-25',
                  transport: 'mcp',
                  endpoint: 'https://mapped.example/api/ucp/mcp'
                }
              ]
            },
            capabilities: {
              'dev.ucp.shopping.catalog.search': [{
                version: '2026-08-25',
                schema: 'https://ucp.dev/2026-08-25/schemas/shopping/catalog_search.json'
              }],
              'dev.ucp.shopping.catalog.lookup': [{
                version: '2026-08-25',
                schema: 'https://ucp.dev/2026-08-25/schemas/shopping/catalog_lookup.json'
              }]
            },
            payment_handlers: {}
          }
        }), 200, {
          'content-type': 'application/json'
        })
      }
    )

    expect(responseValidator.Check(result)).toBe(true)
    expect(result.status).toBe('fetched')
    expect(result.profile?.services).toEqual([
      {
        namespace: 'dev.ucp.shopping',
        transport: 'mcp',
        url: 'https://mapped.example/api/ucp/mcp',
        capabilities: []
      }
    ])
    expect(result.profile?.capabilities).toEqual([
      'dev.ucp.shopping.catalog.lookup',
      'dev.ucp.shopping.catalog.search'
    ])
  })

  it('blocks private-network discovery targets before fetch', async () => {
    const fetcher = vi.fn()

    const result = await discoverUcpProfile(
      { domain: 'private.example' },
      {
        requestId: 'req-2',
        correlationId: 'corr-2',
        now,
        fetcher,
        resolver: async () => [{ address: '127.0.0.1' }]
      }
    )

    expect(responseValidator.Check(result)).toBe(true)
    expect(result.status).toBe('blocked')
    expect(result.accessPolicyState).toBe('unknown')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not follow profile redirects', async () => {
    const result = await discoverUcpProfile(
      { domain: 'redirect.example' },
      {
        requestId: 'req-3',
        correlationId: 'corr-3',
        now,
        resolver: publicResolver,
        fetcher: async () => httpResponse('', 302, {
          location: 'https://www.redirect.example/.well-known/ucp'
        })
      }
    )

    expect(responseValidator.Check(result)).toBe(true)
    expect(result.status).toBe('blocked')
    expect(result.messages[0]?.code).toBe('profile_redirect_blocked')
  })

  it('dumps redirect response bodies before returning blocked discovery', async () => {
    const response = discardableConnectorResponse({
      status: 302,
      payload: '{"profile":true}'
    })
    const result = await discoverUcpProfile(
      { domain: 'redirect-body.example' },
      {
        requestId: 'req-redirect-body',
        correlationId: 'corr-redirect-body',
        now,
        resolver: publicResolver,
        fetcher: async () => response.response
      }
    )
    await Promise.resolve()

    expect(result.status).toBe('blocked')
    expect(result.messages[0]?.code).toBe('profile_redirect_blocked')
    expect(response.discarded()).toBe(true)
  })

  it('marks non-JSON profiles invalid', async () => {
    const result = await discoverUcpProfile(
      { domain: 'html.example' },
      {
        requestId: 'req-4',
        correlationId: 'corr-4',
        now,
        resolver: publicResolver,
        fetcher: async () => httpResponse('<html></html>', 200, {
          'content-type': 'text/html'
        })
      }
    )

    expect(responseValidator.Check(result)).toBe(true)
    expect(result.status).toBe('invalid_profile')
    expect(result.accessPolicyState).toBe('error')
    expect(result.messages[0]?.code).toBe('profile_content_type_invalid')
  })

  it('dumps non-JSON profile response bodies before returning invalid profile', async () => {
    const response = discardableConnectorResponse({
      status: 200,
      contentType: 'text/html',
      payload: '{"profile":true}'
    })
    const result = await discoverUcpProfile(
      { domain: 'html-body.example' },
      {
        requestId: 'req-html-body',
        correlationId: 'corr-html-body',
        now,
        resolver: publicResolver,
        fetcher: async () => response.response
      }
    )
    await Promise.resolve()

    expect(result.status).toBe('invalid_profile')
    expect(result.messages[0]?.code).toBe('profile_content_type_invalid')
    expect(response.discarded()).toBe(true)
  })
})
