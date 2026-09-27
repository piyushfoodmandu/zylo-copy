import { describe, expect, it, vi } from 'vitest'
import { UCP_STABLE_VERSION, type UcpProfile } from '@arro/contracts'
import type { UcpNegotiation } from '@arro/ucp-client'
import {
  createMerchantAuthResolver,
  createMerchantAuthResolverFromEnv,
  type MerchantAuthOperation
} from './merchant-auth-resolver.ts'

const businessProfile: UcpProfile = {
  ucp: {
    version: UCP_STABLE_VERSION,
    services: {},
    capabilities: {}
  }
}

const negotiation: UcpNegotiation = {
  version: UCP_STABLE_VERSION,
  transport: 'rest',
  serviceNamespace: 'dev.ucp.shopping',
  service: {
    version: UCP_STABLE_VERSION,
    transport: 'rest',
    endpoint: 'https://merchant.example/ucp'
  },
  endpoint: 'https://merchant.example/ucp',
  capabilities: {},
  paymentHandlers: {},
  businessProfile
}

const resolveInput = {
  merchantOrigin: 'https://merchant.example',
  merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
  businessProfile,
  negotiation,
  operation: 'create_checkout' as const
}

const shopifyNegotiation = (
  endpoint = 'https://checkout.myshopify.com/api/ucp/mcp'
): UcpNegotiation => ({
  ...negotiation,
  transport: 'mcp',
  service: {
    ...negotiation.service,
    transport: 'mcp',
    endpoint
  },
  endpoint
})

const shopifyEnv = {
  SHOPIFY_AGENT_CLIENT_ID: 'shopify-agent-client',
  SHOPIFY_AGENT_CLIENT_SECRET: 'shopify-agent-secret'
} as NodeJS.ProcessEnv

const tokenResponse = (accessToken: string, expiresIn = 100) => Response.json({
  access_token: accessToken,
  expires_in: expiresIn
})

describe('merchant auth resolver', () => {
  it('returns only the credential scoped to the exact merchant origin', async () => {
    const resolver = createMerchantAuthResolver({
      'https://merchant.example': {
        type: 'bearer',
        token: 'merchant-runtime-token'
      }
    })

    await expect(resolver.resolve(resolveInput)).resolves.toEqual({
      type: 'bearer',
      token: 'merchant-runtime-token'
    })
    await expect(resolver.resolve({
      ...resolveInput,
      merchantOrigin: 'https://other-merchant.example',
      merchantProfileUrl: 'https://other-merchant.example/.well-known/ucp'
    })).resolves.toBeUndefined()
  })

  it('rejects unsafe merchant auth origins and header values', () => {
    expect(() =>
      createMerchantAuthResolver({
        'https://user:secret@merchant.example': { type: 'none' }
      })
    ).toThrow('merchant_auth_origin_must_not_include_credentials')

    expect(() =>
      createMerchantAuthResolver({
        'http://merchant.example': { type: 'none' }
      })
    ).toThrow('merchant_auth_origin_must_be_https')

    expect(() =>
      createMerchantAuthResolver({
        'https://merchant.example': {
          type: 'api_key',
          header: 'X-Merchant-Key',
          value: 'secret\r\nX-Leaked: yes'
        }
      })
    ).toThrow('merchant_auth_api_key_value_contains_control_characters')
  })

  it('loads origin-scoped credentials from UCP_MERCHANT_AUTH_JSON', async () => {
    const resolver = createMerchantAuthResolverFromEnv({
      UCP_MERCHANT_AUTH_JSON: JSON.stringify({
        'https://merchant.example': {
          type: 'api_key',
          header: 'X-Merchant-Key',
          value: 'runtime-secret'
        }
      })
    } as NodeJS.ProcessEnv)

    await expect(resolver.resolve(resolveInput)).resolves.toEqual({
      type: 'api_key',
      header: 'X-Merchant-Key',
      value: 'runtime-secret'
    })
  })

  it('mints checkout credentials only for an exact myshopify.com host', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(tokenResponse('shopify-access-token'))
    const resolver = createMerchantAuthResolverFromEnv(shopifyEnv, { fetch: fetcher })

    await expect(resolver.resolve({
      ...resolveInput,
      negotiation: shopifyNegotiation('https://checkout.myshopify.com.attacker.example/api/ucp/mcp')
    })).resolves.toBeUndefined()
    await expect(resolver.resolve({
      ...resolveInput,
      negotiation: shopifyNegotiation('https://not-shopify.example/api/ucp/mcp')
    })).resolves.toBeUndefined()
    expect(fetcher).not.toHaveBeenCalled()

    await expect(resolver.resolve({
      ...resolveInput,
      negotiation: shopifyNegotiation('https://checkout.myshopify.com/api/ucp/mcp')
    })).resolves.toEqual({
      type: 'bearer',
      token: 'shopify-access-token'
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('coalesces token acquisition, caches it, and refreshes at the early-refresh boundary', async () => {
    let currentTimeMs = 0
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse('shopify-access-token-1'))
      .mockResolvedValueOnce(tokenResponse('shopify-access-token-2'))
    const resolver = createMerchantAuthResolverFromEnv(shopifyEnv, {
      fetch: fetcher,
      nowMs: () => currentTimeMs,
      tokenTimeoutMs: 1_234
    })
    const input = { ...resolveInput, negotiation: shopifyNegotiation() }

    await expect(Promise.all([
      resolver.resolve(input),
      resolver.resolve(input)
    ])).resolves.toEqual([
      { type: 'bearer', token: 'shopify-access-token-1' },
      { type: 'bearer', token: 'shopify-access-token-1' }
    ])
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.shopify.com/auth/access_token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          client_id: 'shopify-agent-client',
          client_secret: 'shopify-agent-secret',
          grant_type: 'client_credentials'
        }),
        signal: expect.any(AbortSignal)
      })
    )

    currentTimeMs = 89_999
    await expect(resolver.resolve(input)).resolves.toEqual({
      type: 'bearer',
      token: 'shopify-access-token-1'
    })
    expect(fetcher).toHaveBeenCalledOnce()

    currentTimeMs = 90_000
    await expect(Promise.all([
      resolver.resolve(input),
      resolver.resolve(input)
    ])).resolves.toEqual([
      { type: 'bearer', token: 'shopify-access-token-2' },
      { type: 'bearer', token: 'shopify-access-token-2' }
    ])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('keeps a still-valid token when an early refresh temporarily fails', async () => {
    let currentTimeMs = 0
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(tokenResponse('shopify-access-token'))
      .mockRejectedValueOnce(new Error('temporary Shopify auth outage'))
      .mockRejectedValueOnce(new Error('continued Shopify auth outage'))
    const resolver = createMerchantAuthResolverFromEnv(shopifyEnv, {
      fetch: fetcher,
      nowMs: () => currentTimeMs
    })
    const input = { ...resolveInput, negotiation: shopifyNegotiation() }

    await expect(resolver.resolve(input)).resolves.toEqual({
      type: 'bearer',
      token: 'shopify-access-token'
    })

    currentTimeMs = 90_000
    await expect(resolver.resolve(input)).resolves.toEqual({
      type: 'bearer',
      token: 'shopify-access-token'
    })

    currentTimeMs = 100_000
    await expect(resolver.resolve(input)).rejects.toThrow('continued Shopify auth outage')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('prefers explicit merchant authentication without requesting a Shopify token', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const resolver = createMerchantAuthResolverFromEnv({
      ...shopifyEnv,
      UCP_MERCHANT_AUTH_JSON: JSON.stringify({
        'https://merchant.example': {
          type: 'api_key',
          header: 'X-Merchant-Key',
          value: 'merchant-specific-secret'
        }
      })
    }, { fetch: fetcher })

    await expect(resolver.resolve({
      ...resolveInput,
      negotiation: shopifyNegotiation()
    })).resolves.toEqual({
      type: 'api_key',
      header: 'X-Merchant-Key',
      value: 'merchant-specific-secret'
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each<MerchantAuthOperation>([
    'create_cart',
    'get_cart',
    'update_cart',
    'cancel_cart'
  ])('uses the Shopify token tier for cart operation %s when credentials exist', async (operation) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(tokenResponse('shopify-access-token'))
    const resolver = createMerchantAuthResolverFromEnv(shopifyEnv, { fetch: fetcher })

    await expect(resolver.resolve({
      ...resolveInput,
      negotiation: shopifyNegotiation(),
      operation
    })).resolves.toEqual({
      type: 'bearer',
      token: 'shopify-access-token'
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it.each<MerchantAuthOperation>([
    'create_cart',
    'get_cart',
    'update_cart',
    'cancel_cart',
    'create_checkout',
    'get_checkout',
    'update_checkout',
    'complete_checkout',
    'cancel_checkout',
    'get_order'
  ])('selects Shopify anonymous production auth for %s when no token credentials exist', async (operation) => {
    const fetcher = vi.fn<typeof fetch>()
    const resolver = createMerchantAuthResolverFromEnv({}, { fetch: fetcher })

    await expect(resolver.resolve({
      ...resolveInput,
      negotiation: shopifyNegotiation(),
      operation
    })).resolves.toEqual({ type: 'none' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
