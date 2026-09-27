import { describe, expect, it, vi } from 'vitest'
import { createHash, generateKeyPairSync } from 'node:crypto'
import {
  createPaymentHandlerRegistry,
  createProcessorTokenizerPaymentHandlerAdapter,
  createUcpClient,
  deriveUcpEs256PublicJwk,
  isUcpCheckout,
  isUcpErrorResponse,
  UCP_CLIENT_PROTOCOL_VERSION,
  UcpProtocolError
} from './index.ts'
import { UCP_STABLE_VERSION } from '@arro/contracts'
import {
  businessProfile,
  createReferenceMerchantFetch,
  platformProfile,
  referenceCheckout,
  referenceProcessorTokenizerSchema,
  referenceProcessorTokenizerSpec,
  referenceProcessorTokenizerVersion,
  type ReferenceMerchantState
} from './reference-merchant.test-support.ts'

const makeClient = (state: ReferenceMerchantState = {
  createCalls: 0,
  completeCalls: 0,
  idempotencyKeys: []
}) => ({
  state,
  client: createUcpClient({
    fetch: createReferenceMerchantFetch(state),
    platformProfileUrl: 'https://arro.example/.well-known/ucp',
    platformProfile: platformProfile()
  })
})

describe('UCP client', () => {
  it('recognizes MCP invalid parameters instead of misreporting an invalid checkout response', async () => {
    const client = createUcpClient({
      fetch: vi.fn().mockResolvedValue(Response.json({ jsonrpc: '2.0', error: { code: -32602, message: 'Invalid parameters' } })),
      platformProfileUrl: 'https://arro.example/.well-known/ucp', platformProfile: platformProfile()
    })
    const negotiation = await client.negotiate(platformProfile(), businessProfile('mcp'))
    await expect(client.getCheckout({ negotiation, checkoutId: 'checkout_1' })).rejects.toMatchObject({
      message: 'Invalid parameters', details: { code: 'ucp_mcp_invalid_params' }
    })
  })
  it('discovers and negotiates the latest stable shared UCP checkout path', async () => {
    const { client } = makeClient()
    const discovered = await client.discover('merchant.example')
    const negotiation = await client.negotiate(platformProfile(), discovered)

    expect(negotiation.version).toBe(UCP_CLIENT_PROTOCOL_VERSION)
    expect(negotiation.transport).toBe('rest')
    expect(negotiation.endpoint).toBe('https://merchant.example/ucp')
    expect(Object.keys(negotiation.capabilities)).toEqual(expect.arrayContaining([
      'dev.ucp.shopping.checkout',
      'dev.ucp.shopping.order'
    ]))
    expect(Object.keys(negotiation.paymentHandlers)).toContain('com.example.processor_tokenizer')
  })

  it('selects and validates the exact 2026-08-25 leaf without merging the current profile', async () => {
    const leaf = {
      ...businessProfile(),
      keys: [{
        kid: 'leaf-key',
        kty: 'EC',
        crv: 'P-256',
        alg: 'ES256',
        x: 'leaf-x',
        y: 'leaf-y'
      }]
    }
    leaf.ucp.services['dev.ucp.shopping']![0]!.endpoint = 'https://merchant.example/ucp-2026-08-25'
    const currentProfile = {
      ucp: {
        version: '2026-09-30',
        supported_versions: {
          [UCP_CLIENT_PROTOCOL_VERSION]: 'https://merchant.example/.well-known/ucp/2026-08-25'
        },
        services: {
          'dev.ucp.shopping': [{
            version: '2026-09-30',
            transport: 'rest',
            endpoint: 'https://merchant.example/future'
          }]
        },
        capabilities: {
          'com.example.future_only': [{
            version: '2026-09-30',
            schema: 'https://example.com/future-only.json'
          }]
        },
        payment_handlers: {}
      },
      keys: [{ kid: 'current-key', kty: 'OKP', crv: 'Ed25519', x: 'current-x' }]
    }
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
      return Response.json(url.pathname.endsWith('/2026-08-25') ? leaf : currentProfile)
    }) as unknown as typeof fetch
    const client = createUcpClient({
      fetch: fetcher,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      platformProfile: platformProfile()
    })

    const discovered = await client.discover('merchant.example')
    const negotiation = await client.negotiate(platformProfile(), discovered)

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(discovered.keys).toEqual(leaf.keys)
    expect(discovered.ucp.capabilities?.['com.example.future_only']).toBeUndefined()
    expect(negotiation.endpoint).toBe('https://merchant.example/ucp-2026-08-25')
    expect(negotiation.businessProfile).toEqual(discovered)
  })

  it('rejects a supported-version target that is not a self-contained matching leaf', async () => {
    const invalidLeaf = businessProfile()
    invalidLeaf.ucp.supported_versions = {
      [UCP_CLIENT_PROTOCOL_VERSION]: 'https://merchant.example/.well-known/ucp/recursive'
    }
    const currentProfile = {
      ucp: {
        version: '2026-09-30',
        supported_versions: {
          [UCP_CLIENT_PROTOCOL_VERSION]: 'https://merchant.example/.well-known/ucp/2026-08-25'
        }
      }
    }
    const client = createUcpClient({
      fetch: (async (input: string | URL | Request) => {
        const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
        return Response.json(url.pathname.endsWith('/2026-08-25') ? invalidLeaf : currentProfile)
      }) as typeof fetch,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      platformProfile: platformProfile()
    })

    await expect(client.discover('merchant.example')).rejects.toMatchObject({
      name: 'UcpProtocolError',
      details: { code: 'ucp_leaf_profile_invalid' }
    })
  })

  it('fails closed when the merchant does not publish the exact implemented core version', async () => {
    const client = createUcpClient({
      fetch: (async () => Response.json({
        ucp: {
          version: '2026-09-30',
          supported_versions: {}
        }
      })) as typeof fetch,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      platformProfile: platformProfile()
    })

    await expect(client.discover('merchant.example')).rejects.toMatchObject({
      name: 'UcpProtocolError',
      details: { code: 'ucp_version_incompatible' }
    })
  })

  it('ignores a stale core transport entry while negotiating the current merchant service', async () => {
    const mixedVersionProfile = businessProfile()
    mixedVersionProfile.ucp.services['dev.ucp.shopping']!.push({
      version: '2026-04-08',
      transport: 'embedded',
      spec: 'https://ucp.dev/2026-04-08/specification/overview',
      schema: 'https://ucp.dev/2026-04-08/services/shopping/embedded.openrpc.json'
    })
    mixedVersionProfile.ucp.capabilities!['dev.ucp.shopping.cart']!.push({
      version: '2026-04-08',
      spec: 'https://ucp.dev/2026-04-08/specification/shopping/cart',
      schema: 'https://ucp.dev/2026-04-08/schemas/shopping/cart.json'
    })
    const client = createUcpClient({
      fetch: (async () => Response.json(mixedVersionProfile)) as typeof fetch,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      platformProfile: platformProfile()
    })

    const discovered = await client.discover('merchant.example')
    const negotiation = await client.negotiate(platformProfile(), discovered)

    expect(discovered.ucp.services['dev.ucp.shopping']).toHaveLength(1)
    expect(discovered.ucp.services['dev.ucp.shopping']?.[0]).toMatchObject({
      version: UCP_CLIENT_PROTOCOL_VERSION,
      transport: 'rest'
    })
    expect(discovered.ucp.capabilities?.['dev.ucp.shopping.cart']).toHaveLength(1)
    expect(discovered.ucp.capabilities?.['dev.ucp.shopping.cart']?.[0]?.version)
      .toBe(UCP_CLIENT_PROTOCOL_VERSION)
    expect(negotiation.endpoint).toBe('https://merchant.example/ucp')
  })

  it('uses Shopify-compatible MCP cart envelopes, cart conversion arguments, and deterministic UUID keys', async () => {
    const calls: Array<{
      toolName: string
      argumentsValue: Record<string, unknown>
      idempotencyHeader: string | null
    }> = []
    const cart = {
      ucp: {
        version: UCP_CLIENT_PROTOCOL_VERSION,
        status: 'success',
        capabilities: {
          'dev.ucp.shopping.cart': [{ version: UCP_CLIENT_PROTOCOL_VERSION }]
        }
      },
      id: 'gid://shopify/Cart/cart_1',
      currency: 'USD',
      line_items: [{
        id: 'gid://shopify/CartLine/line_1',
        item: { id: 'gid://shopify/ProductVariant/variant_1', title: 'Travel seat', price: 2999 },
        quantity: 1,
        totals: [{ type: 'total', amount: 2999, currency: 'USD' }]
      }],
      totals: [{ type: 'total', amount: 2999, currency: 'USD' }],
      continue_url: 'https://merchant.example/cart/c/cart_1'
    }
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        id: string
        params: {
          name: string
          arguments: Record<string, unknown>
        }
      }
      calls.push({
        toolName: request.params.name,
        argumentsValue: request.params.arguments,
        idempotencyHeader: new Headers(init?.headers).get('idempotency-key')
      })

      return Response.json({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          // Shopify marks a structurally valid incomplete checkout as an MCP
          // tool error while still returning the authoritative Checkout in
          // structuredContent. Recoverable buyer/address messages must not
          // erase that state.
          isError: request.params.name === 'create_checkout',
          structuredContent: request.params.name === 'create_cart'
            ? { cart }
            : { checkout: referenceCheckout('requires_escalation', businessProfile('mcp')) }
        }
      })
    }) as unknown as typeof fetch
    const client = createUcpClient({
      fetch: fetcher,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      platformProfile: platformProfile()
    })
    const negotiation = await client.negotiate(platformProfile(), businessProfile('mcp'))
    const publicIdempotencyKey = 'prepare:550e8400-e29b-41d4-a716-446655440000'
    const cartRequest = {
      negotiation,
      idempotencyKey: publicIdempotencyKey,
      body: {
        line_items: [{ item: { id: 'gid://shopify/ProductVariant/variant_1' }, quantity: 1 }]
      }
    }

    const firstCart = await client.createCart(cartRequest)
    await client.createCart(cartRequest)
    await client.createCheckout({
      negotiation,
      idempotencyKey: publicIdempotencyKey,
      body: {
        cart_id: cart.id,
        buyer: { email: 'buyer@example.com' }
      }
    })

    expect(firstCart).toEqual(cart)
    const cartCalls = calls.filter((call) => call.toolName === 'create_cart')
    const checkoutCall = calls.find((call) => call.toolName === 'create_checkout')
    expect(cartCalls).toHaveLength(2)
    expect(checkoutCall).toBeDefined()

    const uuidV8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    const cartKey = (cartCalls[0]?.argumentsValue.meta as Record<string, unknown>)?.['idempotency-key']
    const replayCartKey = (cartCalls[1]?.argumentsValue.meta as Record<string, unknown>)?.['idempotency-key']
    const checkoutKey = (checkoutCall?.argumentsValue.meta as Record<string, unknown>)?.['idempotency-key']
    expect(cartKey).toMatch(uuidV8)
    expect(replayCartKey).toBe(cartKey)
    expect(checkoutKey).toMatch(uuidV8)
    expect(checkoutKey).not.toBe(cartKey)
    expect(cartCalls[0]?.idempotencyHeader).toBe(cartKey)
    expect(cartCalls[1]?.idempotencyHeader).toBe(cartKey)
    expect(checkoutCall?.idempotencyHeader).toBe(checkoutKey)

    expect(checkoutCall?.argumentsValue).toMatchObject({
      cart_id: cart.id,
      checkout: {
        cart_id: cart.id,
        buyer: { email: 'buyer@example.com' }
      }
    })
  })

  it('runs create, update, complete, recover, cancel, and order operations through UCP REST', async () => {
    const { client, state } = makeClient()
    const negotiation = await client.negotiate(platformProfile(), businessProfile())
    const cart = await client.createCart({
      negotiation,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000-cart-1',
      body: {
        line_items: [
          {
            item: { id: 'sku_65w_charger' },
            quantity: 1
          }
        ]
      }
    })

    expect(cart).toMatchObject({
      id: 'cart_1',
      status: 'active',
      continue_url: 'https://merchant.example/cart/cart_1'
    })

    const updatedCart = await client.updateCart({
      negotiation,
      cartId: 'cart_1',
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000-cart-2',
      body: {
        line_items: [
          {
            item: { id: 'sku_65w_charger' },
            quantity: 1
          }
        ],
        buyer: { email: 'shopper@example.com' }
      }
    })
    expect(updatedCart).toMatchObject({ id: 'cart_1', status: 'active' })

    const refreshedCart = await client.getCart({ negotiation, cartId: 'cart_1' })
    expect(refreshedCart).toMatchObject({ id: 'cart_1', status: 'active' })

    const create = await client.createCheckout({
      negotiation,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000-checkout-1',
      body: {
        cart_id: 'cart_1'
      }
    })

    expect(isUcpCheckout(create)).toBe(true)
    if (!isUcpCheckout(create)) throw new Error('createCheckout returned a UCP error response in the happy-path fixture')
    expect(create.status).toBe('ready_for_complete')
    expect(create.continue_url).toBe('https://merchant.example/checkout/chk_1')

    const update = await client.updateCheckout({
      negotiation,
      checkoutId: create.id,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000-checkout-2',
      body: {
        line_items: [{
          id: 'li_1',
          item: { id: 'sku_65w_charger' },
          quantity: 1
        }],
        buyer: { email: 'shopper@example.com' }
      }
    })
    expect(isUcpCheckout(update)).toBe(true)
    if (!isUcpCheckout(update)) throw new Error('updateCheckout returned a UCP error response in the happy-path fixture')
    expect(update.status).toBe('ready_for_complete')

    const complete = await client.completeCheckout({
      negotiation,
      checkoutId: create.id,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000-checkout-3',
      body: {
        payment: {
          instruments: [
            {
              id: 'pi_1',
              handler_id: 'merchant_processor_tokenizer_1',
              type: 'card',
              selected: true,
              display: { brand: 'visa', last_digits: '4242' },
              credential: { type: 'PAYMENT_GATEWAY', token: 'opaque-token' }
            }
          ]
        }
      }
    })

    expect(isUcpCheckout(complete)).toBe(true)
    if (!isUcpCheckout(complete)) throw new Error('completeCheckout returned a UCP error response in the happy-path fixture')
    expect(complete.status).toBe('complete_in_progress')
    expect(complete.order?.id).toBe('order_1')
    expect(state.lastCompleteBody).toMatchObject({
      payment: {
        instruments: [
          {
            handler_id: 'merchant_processor_tokenizer_1',
            credential: { token: 'opaque-token' }
          }
        ]
      }
    })

    const recovered = await client.getCheckout({ negotiation, checkoutId: create.id })
    expect(isUcpCheckout(recovered)).toBe(true)
    if (!isUcpCheckout(recovered)) throw new Error('getCheckout returned a UCP error response in the happy-path fixture')
    expect(recovered.status).toBe('completed')

    const order = await client.getOrder({ negotiation, orderId: 'order_1' })
    expect(order.checkout_id).toBe('chk_1')
    expect(order.permalink_url).toBe('https://merchant.example/orders/order_1')

    const canceled = await client.cancelCheckout({
      negotiation,
      checkoutId: create.id,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000-checkout-4',
      body: {}
    })
    expect(isUcpCheckout(canceled)).toBe(true)
    if (!isUcpCheckout(canceled)) throw new Error('cancelCheckout returned a UCP error response in the happy-path fixture')
    expect(canceled.status).toBe('canceled')
    const canceledCart = await client.cancelCart({
      negotiation,
      cartId: 'cart_1',
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000-cart-3',
      body: {}
    })
    expect(canceledCart).toMatchObject({ id: 'cart_1', status: 'canceled' })
    expect(state.cartCalls).toBe(3)
    expect(state.idempotencyKeys).toEqual([
      '550e8400-e29b-41d4-a716-446655440000-cart-1',
      '550e8400-e29b-41d4-a716-446655440000-cart-2',
      '550e8400-e29b-41d4-a716-446655440000-checkout-1',
      '550e8400-e29b-41d4-a716-446655440000-checkout-2',
      '550e8400-e29b-41d4-a716-446655440000-checkout-3',
      '550e8400-e29b-41d4-a716-446655440000-checkout-4',
      '550e8400-e29b-41d4-a716-446655440000-cart-3'
    ])
  })

  it('keeps completion state isolated across multiple merchant checkouts', async () => {
    const state: ReferenceMerchantState = {
      createCalls: 0,
      completeCalls: 0,
      idempotencyKeys: []
    }
    const client = createUcpClient({
      fetch: createReferenceMerchantFetch(state, {
        checkoutIdForCreate: (createCall) => `chk_${createCall}`,
        orderIdForCheckout: (_checkoutId, completeCall) => `order_${completeCall}`
      }),
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      platformProfile: platformProfile()
    })
    const negotiation = await client.negotiate(platformProfile(), businessProfile())
    const first = await client.createCheckout({
      negotiation,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440001',
      body: { line_items: [{ item: { id: 'sku_65w_charger' }, quantity: 1 }] }
    })
    if (!isUcpCheckout(first)) throw new Error('first createCheckout returned a UCP error response')
    await client.completeCheckout({
      negotiation,
      checkoutId: first.id,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440002',
      body: { payment: {} }
    })

    const second = await client.createCheckout({
      negotiation,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440003',
      body: { line_items: [{ item: { id: 'sku_65w_charger' }, quantity: 1 }] }
    })
    if (!isUcpCheckout(second)) throw new Error('second createCheckout returned a UCP error response')
    const refreshedFirst = await client.getCheckout({ negotiation, checkoutId: first.id })
    const refreshedSecond = await client.getCheckout({ negotiation, checkoutId: second.id })

    expect(first.id).toBe('chk_1')
    expect(second.id).toBe('chk_2')
    expect(isUcpCheckout(refreshedFirst) && refreshedFirst.status).toBe('completed')
    expect(isUcpCheckout(refreshedSecond) && refreshedSecond.status).toBe('ready_for_complete')
  })

  it('sends operation auth to the merchant endpoint and keeps redirects manual', async () => {
    const state: ReferenceMerchantState = {
      createCalls: 0,
      completeCalls: 0,
      idempotencyKeys: []
    }
    const referenceFetch = createReferenceMerchantFetch(state)
    const calls: Array<{
      url: string
      init?: RequestInit
    }> = []
    const client = createUcpClient({
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        calls.push({ url, init })
        return referenceFetch(input, init)
      }) as typeof fetch,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      platformProfile: platformProfile()
    })

    const discovered = await client.discover('merchant.example')
    const negotiation = await client.negotiate(platformProfile(), discovered)
    await client.createCheckout({
      negotiation,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000-auth',
      auth: {
        type: 'api_key',
        header: 'X-Merchant-Key',
        value: 'merchant-runtime-secret'
      },
      body: {
        line_items: [{ item: { id: 'sku_65w_charger' }, quantity: 1 }]
      }
    })

    expect(calls.every((call) => call.init?.redirect === 'manual')).toBe(true)
    const checkoutCall = calls.find((call) =>
      call.url === 'https://merchant.example/ucp/checkout-sessions'
    )
    expect(checkoutCall).toBeDefined()
    expect(new Headers(checkoutCall?.init?.headers).get('x-merchant-key')).toBe('merchant-runtime-secret')
  })

  it('signs the exact outbound REST body with the key published by the platform profile', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const exported = privateKey.export({ format: 'jwk' })
    const signingPrivateJwk = {
      ...exported,
      kid: 'arro-platform-test',
      alg: 'ES256',
      use: 'sig'
    }
    const signingPublicJwk = deriveUcpEs256PublicJwk(signingPrivateJwk)
    const signedPlatformProfile = {
      ...platformProfile(),
      keys: [signingPublicJwk]
    }
    const state: ReferenceMerchantState = {
      createCalls: 0,
      completeCalls: 0,
      idempotencyKeys: []
    }
    const referenceFetch = createReferenceMerchantFetch(state)
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const client = createUcpClient({
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        calls.push({ url, init })
        return referenceFetch(input, init)
      }) as typeof fetch,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      platformProfile: signedPlatformProfile,
      signingPrivateJwk
    })

    const negotiation = await client.negotiate(signedPlatformProfile, businessProfile())
    await client.createCheckout({
      negotiation,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000-signed',
      body: { line_items: [{ item: { id: 'sku_65w_charger' }, quantity: 1 }] }
    })

    const call = calls.find((candidate) => candidate.url.endsWith('/checkout-sessions'))
    expect(call).toBeDefined()
    const headers = new Headers(call?.init?.headers)
    const exactBody = String(call?.init?.body)
    const digest = createHash('sha256').update(Buffer.from(exactBody, 'utf8')).digest('base64')
    expect(headers.get('content-digest')).toBe(`sha-256=:${digest}:`)
    expect(headers.get('signature-input')).toContain(
      '"@method" "@authority" "@path" "ucp-agent" "idempotency-key" "content-digest" "content-type"'
    )
    expect(headers.get('signature-input')).toContain('keyid="arro-platform-test"')
    expect(headers.get('signature')).toMatch(/^sig1=:[A-Za-z0-9+/]+={0,2}:$/)
  })

  it('does not mix the generic UCP signature into an explicitly anonymous MCP request', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const signingPrivateJwk = {
      ...privateKey.export({ format: 'jwk' }),
      kid: 'arro-platform-test',
      alg: 'ES256',
      use: 'sig'
    }
    const signedPlatformProfile = {
      ...platformProfile(),
      keys: [deriveUcpEs256PublicJwk(signingPrivateJwk)]
    }
    const calls: RequestInit[] = []
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {})
      return Response.json({
        jsonrpc: '2.0',
        id: 'arro-ucp-create_checkout',
        result: {
          structuredContent: {
            checkout: referenceCheckout('requires_escalation', businessProfile('mcp'))
          }
        }
      })
    }) as unknown as typeof fetch
    const client = createUcpClient({
      fetch: fetcher,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      platformProfile: signedPlatformProfile,
      signingPrivateJwk
    })
    const negotiation = await client.negotiate(signedPlatformProfile, businessProfile('mcp'))
    const body = { line_items: [{ item: { id: 'sku_65w_charger' }, quantity: 1 }] }

    await client.createCheckout({
      negotiation,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440001',
      body
    })
    await client.createCheckout({
      negotiation,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440002',
      auth: { type: 'none' },
      body
    })

    const signedHeaders = new Headers(calls[0]?.headers)
    const anonymousHeaders = new Headers(calls[1]?.headers)
    expect(signedHeaders.has('signature')).toBe(true)
    expect(signedHeaders.has('signature-input')).toBe(true)
    expect(anonymousHeaders.has('signature')).toBe(false)
    expect(anonymousHeaders.has('signature-input')).toBe(false)
    expect(anonymousHeaders.has('content-digest')).toBe(false)
  })

  it('uses only canonical profile keys and requires the active signer to match exactly', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const signingPrivateJwk = {
      ...privateKey.export({ format: 'jwk' }),
      kid: 'active-platform-key',
      alg: 'ES256',
      use: 'sig'
    }
    const signingPublicJwk = deriveUcpEs256PublicJwk(signingPrivateJwk)

    expect(() => createUcpClient({
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      platformProfile: platformProfile(),
      signingPrivateJwk
    })).toThrow(/is not published exactly/)

    expect(() => createUcpClient({
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      platformProfile: {
        ...platformProfile(),
        keys: [{ ...signingPublicJwk, key_ops: ['verify'] }]
      },
      signingPrivateJwk
    })).toThrow(/is not published exactly/)

    expect(() => createUcpClient({
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      platformProfile: {
        ...platformProfile(),
        keys: undefined,
        signing_keys: [signingPublicJwk]
      } as unknown as ReturnType<typeof platformProfile>,
      signingPrivateJwk
    })).toThrow(/is not published exactly/)
  })

  it('rejects missing, blank, or undersized idempotency keys for state-changing REST and MCP calls before network access', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('network access must not occur')
    }) as unknown as typeof fetch
    const client = createUcpClient({
      fetch: fetcher,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      platformProfile: platformProfile()
    })
    const negotiation = await client.negotiate(platformProfile(), businessProfile())

    await expect(client.createCheckout({
      negotiation,
      body: { line_items: [{ item: { id: 'sku_65w_charger' }, quantity: 1 }] }
    })).rejects.toMatchObject({
      name: 'UcpProtocolError',
      details: { code: 'ucp_idempotency_key_required' }
    })
    await expect(client.cancelCheckout({
      negotiation,
      checkoutId: 'chk_1',
      idempotencyKey: '   ',
      body: {}
    })).rejects.toMatchObject({
      name: 'UcpProtocolError',
      details: { code: 'ucp_idempotency_key_required' }
    })
    await expect(client.createCheckout({
      negotiation,
      idempotencyKey: 'too-short',
      body: { line_items: [{ item: { id: 'sku_65w_charger' }, quantity: 1 }] }
    })).rejects.toMatchObject({
      name: 'UcpProtocolError',
      details: { code: 'ucp_idempotency_key_invalid' }
    })
    await expect(client.createCheckout({
      negotiation: {
        ...negotiation,
        transport: 'mcp',
        endpoint: 'https://merchant.example/ucp/mcp'
      },
      body: { line_items: [{ item: { id: 'sku_65w_charger' }, quantity: 1 }] }
    })).rejects.toMatchObject({
      name: 'UcpProtocolError',
      details: { code: 'ucp_idempotency_key_required' }
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('resolves only supported payment handlers and preserves merchant-hosted continuation', async () => {
    const registry = createPaymentHandlerRegistry([
      {
        adapterKind: 'processor_tokenizer',
        handlerName: 'com.example.processor_tokenizer',
        executionMode: 'client',
        supports: (declaration) => declaration.version === referenceProcessorTokenizerVersion
      }
    ])
    const { client } = makeClient()
    const negotiation = await client.negotiate(platformProfile(), businessProfile())
    const checkout = await client.createCheckout({
      negotiation,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440000-handler',
      body: {
        line_items: [{ item: { id: 'sku_65w_charger' }, quantity: 1 }]
      }
    })
    expect(isUcpCheckout(checkout)).toBe(true)
    if (!isUcpCheckout(checkout)) throw new Error('createCheckout returned a UCP error response in the payment-handler fixture')
    const support = registry.resolve({
      businessProfile: businessProfile(),
      checkout
    })

    expect(support).toEqual(expect.arrayContaining([
      expect.objectContaining({
        supported: true,
        handlerName: 'com.example.processor_tokenizer',
        executionMode: 'client'
      }),
      expect.objectContaining({
        supported: false,
        handlerName: 'com.example.unsupported_wallet'
      }),
      expect.objectContaining({
        supported: true,
        handlerName: 'merchant_hosted_continuation',
        executionMode: 'merchant_hosted'
      })
    ]))
  })

  it('raises structured UCP errors instead of treating HTTP errors as checkout state', async () => {
    const { client } = makeClient()
    const negotiation = await client.negotiate(platformProfile(), businessProfile())

    await expect(client.getOrder({ negotiation, orderId: 'missing_order' }))
      .rejects
      .toMatchObject({
        name: 'UcpProtocolError',
        details: {
          code: 'ucp_http_error',
          httpStatus: 404
        }
      } satisfies Partial<UcpProtocolError>)
  })

  it('accepts structured UCP checkout-operation errors returned with a successful protocol response', async () => {
    const { client } = makeClient()
    const negotiation = await client.negotiate(platformProfile(), businessProfile())

    const response = await client.createCheckout({
      negotiation,
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440004',
      body: {
        line_items: [{ item: { id: 'out_of_stock' }, quantity: 1 }]
      }
    })

    expect(isUcpErrorResponse(response)).toBe(true)
    expect(response).toMatchObject({
      ucp: { status: 'error' },
      messages: [
        expect.objectContaining({
          code: 'all_out_of_stock'
        })
      ]
    })
  })

  it('negotiates component versions independently from the protocol version', async () => {
    const platform = platformProfile()
    const business = businessProfile()
    platform.ucp.payment_handlers = {
      'com.google.pay': [{
        id: 'platform_gpay',
        version: '2026-01-23',
        spec: 'https://pay.google.com/gp/p/ucp/2026-01-23/',
        schema: 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json'
      }]
    }
    business.ucp.payment_handlers = {
      'com.google.pay': [{
        id: 'merchant_gpay',
        version: '2026-01-23',
        config: {
          environment: 'TEST',
          api_version: 2,
          api_version_minor: 0,
          allowed_payment_methods: []
        }
      }]
    }

    const { client } = makeClient()
    const negotiation = await client.negotiate(platform, business)

    expect(negotiation.version).toBe(UCP_STABLE_VERSION)
    expect(negotiation.paymentHandlers['com.google.pay']).toEqual([
      expect.objectContaining({
        id: 'merchant_gpay',
        version: '2026-01-23',
        spec: 'https://pay.google.com/gp/p/ucp/2026-01-23/',
        schema: 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json'
      })
    ])
  })

  it('negotiates the released payment-authentication extension from canonical capabilities', async () => {
    const platform = platformProfile()
    const business = businessProfile()
    platform.ucp.capabilities!['dev.ucp.common.payment.authentication'] = [{
      version: UCP_STABLE_VERSION,
      spec: `https://ucp.dev/${UCP_STABLE_VERSION}/specification/payment/extensions/authentication`,
      schema: `https://ucp.dev/${UCP_STABLE_VERSION}/schemas/common/payment_authentication.json`,
      extends: 'dev.ucp.shopping.checkout'
    }]
    business.ucp.capabilities!['dev.ucp.common.payment.authentication'] = [{
      version: UCP_STABLE_VERSION,
      schema: `https://ucp.dev/${UCP_STABLE_VERSION}/schemas/common/payment_authentication.json`,
      extends: 'dev.ucp.shopping.checkout'
    }]

    const { client } = makeClient()
    const negotiation = await client.negotiate(platform, business)

    expect(negotiation.capabilities['dev.ucp.common.payment.authentication']).toEqual([
      expect.objectContaining({
        spec: `https://ucp.dev/${UCP_STABLE_VERSION}/specification/payment/extensions/authentication`,
        schema: `https://ucp.dev/${UCP_STABLE_VERSION}/schemas/common/payment_authentication.json`,
        extends: 'dev.ucp.shopping.checkout'
      })
    ])
  })

  it('keeps a multi-parent extension when at least one declared parent is active', async () => {
    const platform = platformProfile()
    const business = businessProfile()
    platform.ucp.capabilities!['com.example.flexible_checkout'] = [{
      version: UCP_STABLE_VERSION,
      spec: 'https://example.com/ucp/flexible-checkout',
      schema: 'https://example.com/ucp/flexible-checkout/schema.json',
      extends: ['dev.ucp.shopping.checkout', 'dev.ucp.shopping.catalog.lookup']
    }]
    business.ucp.capabilities!['com.example.flexible_checkout'] = [{
      version: UCP_STABLE_VERSION,
      schema: 'https://example.com/ucp/flexible-checkout/schema.json',
      extends: ['dev.ucp.shopping.checkout', 'dev.ucp.shopping.catalog.lookup']
    }]

    const { client } = makeClient()
    const negotiation = await client.negotiate(platform, business)

    expect(negotiation.capabilities['com.example.flexible_checkout']).toEqual([
      expect.objectContaining({
        extends: ['dev.ucp.shopping.checkout', 'dev.ucp.shopping.catalog.lookup']
      })
    ])
  })

  it('does not negotiate the removed extensions registry alias', async () => {
    const platform = {
      ...platformProfile(),
      ucp: {
        ...platformProfile().ucp,
        extensions: {
          'com.example.legacy_extension': [{
            version: UCP_STABLE_VERSION,
            spec: 'https://example.com/legacy-extension',
            schema: 'https://example.com/legacy-extension/schema.json',
            extends: 'dev.ucp.shopping.checkout'
          }]
        }
      }
    }
    const business = {
      ...businessProfile(),
      ucp: {
        ...businessProfile().ucp,
        extensions: {
          'com.example.legacy_extension': [{
            version: UCP_STABLE_VERSION,
            schema: 'https://example.com/legacy-extension/schema.json',
            extends: 'dev.ucp.shopping.checkout'
          }]
        }
      }
    }

    const { client } = makeClient()
    const negotiation = await client.negotiate(platform, business)

    expect(negotiation.capabilities['com.example.legacy_extension']).toBeUndefined()
  })

  it('does not activate a component whose schema authority does not bind its namespace', async () => {
    const platform = platformProfile()
    const business = businessProfile()
    platform.ucp.capabilities!['com.example.loyalty'] = [{
      version: UCP_STABLE_VERSION,
      spec: 'https://example.com/loyalty',
      schema: 'https://example.com/loyalty/schema.json',
      extends: 'dev.ucp.shopping.checkout'
    }]
    business.ucp.capabilities!['com.example.loyalty'] = [{
      version: UCP_STABLE_VERSION,
      schema: 'https://evil.example/schema.json',
      extends: 'dev.ucp.shopping.checkout'
    }]

    const { client } = makeClient()
    const negotiation = await client.negotiate(platform, business)

    expect(negotiation.capabilities['com.example.loyalty']).toBeUndefined()
  })

  it('requires the exact platform and business capability declaration variants', async () => {
    const invalidBusiness = businessProfile()
    const checkoutDeclaration = invalidBusiness.ucp.capabilities?.['dev.ucp.shopping.checkout']?.[0] as unknown as Record<string, unknown>
    delete checkoutDeclaration.schema
    const { client } = makeClient()

    await expect(client.negotiate(platformProfile(), invalidBusiness)).rejects.toMatchObject({
      name: 'UcpProtocolError',
      details: { code: 'ucp_business_profile_invalid' }
    })
  })

  it('requires processor-tokenizer handler versions to be configured independently', () => {
    expect(() => createProcessorTokenizerPaymentHandlerAdapter({
      handlerName: 'com.example.processor_tokenizer',
      specificationUrl: referenceProcessorTokenizerSpec,
      schemaUrl: referenceProcessorTokenizerSchema,
      supportedVersions: [],
      environment: 'TEST',
      platformId: 'arro'
    })).toThrow(/explicit, non-empty list/)

    const adapter = createProcessorTokenizerPaymentHandlerAdapter({
      handlerName: 'com.example.processor_tokenizer',
      specificationUrl: referenceProcessorTokenizerSpec,
      schemaUrl: referenceProcessorTokenizerSchema,
      supportedVersions: [referenceProcessorTokenizerVersion],
      environment: 'TEST',
      platformId: 'arro'
    })
    expect(adapter.supports({
      id: 'merchant-handler',
      version: UCP_CLIENT_PROTOCOL_VERSION,
      spec: referenceProcessorTokenizerSpec,
      schema: referenceProcessorTokenizerSchema
    })).toBe(false)
  })

  it('merges negotiated handler identity into compact Checkout handler declarations', () => {
    const registry = createPaymentHandlerRegistry([{
      adapterKind: 'google_pay',
      handlerName: 'com.google.pay',
      executionMode: 'client',
      supports: (declaration) =>
        declaration.spec === 'https://pay.google.com/gp/p/ucp/2026-01-23/' &&
        declaration.schema === 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json'
    }])
    const checkout = {
      ...referenceCheckout('ready_for_complete'),
      ucp: {
        ...referenceCheckout('ready_for_complete').ucp,
        payment_handlers: {
          'com.google.pay': [{
            id: 'merchant_gpay',
            version: '2026-01-23',
            config: { environment: 'TEST' }
          }]
        }
      }
    }

    const support = registry.resolve({
      businessProfile: businessProfile(),
      negotiatedPaymentHandlers: {
        'com.google.pay': [{
          id: 'merchant_gpay',
          version: '2026-01-23',
          spec: 'https://pay.google.com/gp/p/ucp/2026-01-23/',
          schema: 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json'
        }]
      },
      checkout
    })

    expect(support).toEqual(expect.arrayContaining([
      expect.objectContaining({
        supported: true,
        handlerName: 'com.google.pay',
        declaration: expect.objectContaining({
          spec: 'https://pay.google.com/gp/p/ucp/2026-01-23/',
          schema: 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json'
        })
      })
    ]))
  })

})
