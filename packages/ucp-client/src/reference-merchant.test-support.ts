import {
  UCP_STABLE_VERSION,
  type UcpBusinessProfile,
  type UcpCart,
  type UcpCheckout,
  type UcpOrder,
  type UcpPlatformProfile
} from '@arro/contracts'

export const referenceMerchantSigningKeyId = 'merchant-test-key'
export const referenceProcessorTokenizerSpec =
  'https://example.com/ucp/handlers/com.example.processor_tokenizer'
export const referenceProcessorTokenizerSchema =
  'https://example.com/ucp/handlers/com.example.processor_tokenizer/schema.json'
export const referenceProcessorTokenizerVersion = '2026-08-01'
export const referenceUnsupportedWalletVersion = '2026-07-15'

const ucpShoppingServiceSpec = `https://ucp.dev/${UCP_STABLE_VERSION}/specification/overview/`
const ucpShoppingRestSchema = `https://ucp.dev/${UCP_STABLE_VERSION}/services/shopping/rest.openapi.json`
const ucpShoppingMcpSchema = `https://ucp.dev/${UCP_STABLE_VERSION}/services/shopping/mcp.openrpc.json`
const ucpCapability = (path: string) => `https://ucp.dev/${UCP_STABLE_VERSION}/${path}`

export const referenceMerchantSigningPrivateJwk = {
  kty: 'EC',
  x: 'USZp-1J-S_t4keHJTO_gA2IuzGgPijTIFT-UMDeaVnE',
  y: 'Ilz4d57B-EXsQwj3nDxvR0B9PREHPaXD_fvbcAjsSng',
  crv: 'P-256',
  d: 'Aq3h-Qvn1TfaUyIyydVoOqC9K_O7NQqOSiG6sMWKh7s'
}

export const platformProfile = (): UcpPlatformProfile => ({
  ucp: {
    version: UCP_STABLE_VERSION,
    services: {
      'dev.ucp.shopping': [
        {
          version: UCP_STABLE_VERSION,
          transport: 'rest',
          spec: ucpShoppingServiceSpec,
          schema: ucpShoppingRestSchema
        },
        {
          version: UCP_STABLE_VERSION,
          transport: 'mcp',
          spec: ucpShoppingServiceSpec,
          schema: ucpShoppingMcpSchema
        }
      ]
    },
    capabilities: {
      'dev.ucp.shopping.cart': [{
        version: UCP_STABLE_VERSION,
        spec: ucpCapability('specification/shopping/cart'),
        schema: ucpCapability('schemas/shopping/cart.json')
      }],
      'dev.ucp.shopping.checkout': [{
        version: UCP_STABLE_VERSION,
        spec: ucpCapability('specification/shopping/checkout'),
        schema: ucpCapability('schemas/shopping/checkout.json')
      }],
      'dev.ucp.shopping.order': [{
        version: UCP_STABLE_VERSION,
        spec: ucpCapability('specification/shopping/order'),
        schema: ucpCapability('schemas/shopping/order.json')
      }],
      'dev.ucp.shopping.buyer_consent': [
        {
          version: UCP_STABLE_VERSION,
          spec: ucpCapability('specification/shopping/extensions/buyer-consent'),
          schema: ucpCapability('schemas/shopping/buyer_consent.json'),
          extends: 'dev.ucp.shopping.checkout'
        }
      ]
    },
    payment_handlers: {
      'com.example.processor_tokenizer': [
        {
          id: 'arro_processor_tokenizer_client',
          version: referenceProcessorTokenizerVersion,
          spec: referenceProcessorTokenizerSpec,
          schema: referenceProcessorTokenizerSchema,
          available_instruments: [{ type: 'card', constraints: { brands: ['visa', 'mastercard'] } }],
          config: { environment: 'TEST', platform_id: 'arro' }
        }
      ]
    }
  }
})

export const businessProfile = (transport: 'rest' | 'mcp' = 'rest'): UcpBusinessProfile => ({
  ucp: {
    version: UCP_STABLE_VERSION,
    services: {
      'dev.ucp.shopping': [
        {
          version: UCP_STABLE_VERSION,
          transport,
          spec: ucpShoppingServiceSpec,
          endpoint: transport === 'rest'
            ? 'https://merchant.example/ucp'
            : 'https://merchant.example/mcp',
          schema: transport === 'rest'
            ? ucpShoppingRestSchema
            : ucpShoppingMcpSchema
        }
      ]
    },
    capabilities: {
      'dev.ucp.shopping.cart': [{
        version: UCP_STABLE_VERSION,
        spec: ucpCapability('specification/shopping/cart'),
        schema: ucpCapability('schemas/shopping/cart.json')
      }],
      'dev.ucp.shopping.checkout': [{
        version: UCP_STABLE_VERSION,
        spec: ucpCapability('specification/shopping/checkout'),
        schema: ucpCapability('schemas/shopping/checkout.json')
      }],
      'dev.ucp.shopping.order': [{
        version: UCP_STABLE_VERSION,
        spec: ucpCapability('specification/shopping/order'),
        schema: ucpCapability('schemas/shopping/order.json')
      }],
      'dev.ucp.shopping.buyer_consent': [
        {
          version: UCP_STABLE_VERSION,
          spec: ucpCapability('specification/shopping/extensions/buyer-consent'),
          schema: ucpCapability('schemas/shopping/buyer_consent.json'),
          extends: 'dev.ucp.shopping.checkout'
        }
      ]
    },
    payment_handlers: {
      'com.example.processor_tokenizer': [
        {
          id: 'merchant_processor_tokenizer_1',
          version: referenceProcessorTokenizerVersion,
          spec: referenceProcessorTokenizerSpec,
          schema: referenceProcessorTokenizerSchema,
          available_instruments: [{ type: 'card', constraints: { brands: ['visa'] } }],
          config: {
            environment: 'TEST',
            tokenize_url: 'https://merchant.example/ucp/payment-handlers/com.example.processor_tokenizer/tokenize',
            merchant_info: {
              merchant_name: 'Example Merchant',
              merchant_origin: 'merchant.example'
            }
          }
        }
      ],
      'com.example.unsupported_wallet': [
        {
          id: 'unsupported_wallet_1',
          version: referenceUnsupportedWalletVersion,
          available_instruments: [{ type: 'example_wallet' }]
        }
      ]
    }
  },
  keys: [
    {
      kid: referenceMerchantSigningKeyId,
      alg: 'ES256',
      use: 'sig',
      kty: 'EC',
      x: 'USZp-1J-S_t4keHJTO_gA2IuzGgPijTIFT-UMDeaVnE',
      y: 'Ilz4d57B-EXsQwj3nDxvR0B9PREHPaXD_fvbcAjsSng',
      crv: 'P-256'
    }
  ]
})

export const referenceCheckout = (
  status: UcpCheckout['status'],
  profile: UcpBusinessProfile = businessProfile(),
  checkoutId = 'chk_1'
): UcpCheckout => ({
  ucp: {
    version: UCP_STABLE_VERSION,
    status: 'success',
    capabilities: {
      'dev.ucp.shopping.checkout': [{ version: UCP_STABLE_VERSION }],
      'dev.ucp.shopping.order': [{ version: UCP_STABLE_VERSION }]
    },
    payment_handlers: profile.ucp.payment_handlers ?? {}
  },
  id: checkoutId,
  status,
  currency: 'USD',
  continue_url: `https://merchant.example/checkout/${checkoutId}`,
  expires_at: '2026-07-11T12:00:00.000Z',
  buyer: {
    email: 'shopper@example.com'
  },
  line_items: [
    {
      id: 'li_1',
      item: { id: 'sku_65w_charger', title: '65W USB-C Charger', price: 2999 },
      quantity: 1,
      totals: [{ type: 'total', amount: 2999, currency: 'USD' }]
    }
  ],
  fulfillment: {
    methods: [
      {
        id: 'standard_shipping',
        type: 'shipping'
      }
    ]
  },
  totals: [
    { type: 'subtotal', amount: 2999, currency: 'USD' },
    { type: 'total', amount: 3299, currency: 'USD' }
  ],
  messages: [
    {
      type: 'info',
      code: 'ready_for_complete',
      content: 'Checkout is ready for buyer approval and payment instrument submission.'
    }
  ],
  links: [
    {
      type: 'checkout',
      url: `https://merchant.example/checkout/${checkoutId}`
    }
  ]
})

const cartBase = (status = 'active', cartId = 'cart_1'): UcpCart => ({
  ucp: {
    version: UCP_STABLE_VERSION,
    status: 'success',
    capabilities: {
      'dev.ucp.shopping.cart': [{ version: UCP_STABLE_VERSION }]
    }
  },
  id: cartId,
  status,
  currency: 'USD',
  continue_url: `https://merchant.example/cart/${cartId}`,
  expires_at: '2026-07-11T12:00:00.000Z',
  line_items: [
    {
      id: 'cart_li_1',
      item: { id: 'sku_65w_charger', title: '65W USB-C Charger', price: 2999 },
      quantity: 1,
      totals: [{ type: 'subtotal', amount: 2999, currency: 'USD' }]
    }
  ],
  fulfillment: {
    methods: [
      {
        id: 'standard_shipping',
        type: 'shipping'
      }
    ]
  },
  totals: [
    { type: 'subtotal_estimate', amount: 2999, currency: 'USD' },
    { type: 'total_estimate', amount: 3299, currency: 'USD' }
  ],
  messages: [
    {
      type: 'info',
      code: 'cart_totals_are_estimates',
      content: 'Cart totals are estimates until merchant checkout finalizes shipping and tax.'
    }
  ],
  links: [
    {
      type: 'cart',
      url: `https://merchant.example/cart/${cartId}`
    }
  ]
})

const order = (orderId = 'order_1', checkoutId = 'chk_1'): UcpOrder => ({
  ucp: {
    version: UCP_STABLE_VERSION,
    status: 'success',
    capabilities: {
      'dev.ucp.shopping.order': [{ version: UCP_STABLE_VERSION }]
    }
  },
  id: orderId,
  checkout_id: checkoutId,
  permalink_url: `https://merchant.example/orders/${orderId}`,
  currency: 'USD',
  line_items: [
    {
      id: 'li_1',
      item: { id: 'sku_65w_charger', title: '65W USB-C Charger', price: 2999 },
      quantity: { total: 1, fulfilled: 0 },
      totals: [{ type: 'total', amount: 3299, currency: 'USD' }],
      status: 'processing'
    }
  ],
  fulfillment: {
    events: []
  },
  totals: [
    { type: 'subtotal', amount: 2999, currency: 'USD' },
    { type: 'tax', amount: 300, currency: 'USD' },
    { type: 'total', amount: 3299, currency: 'USD' }
  ]
})

export type ReferenceMerchantState = {
  cartCalls?: number
  createCalls: number
  completeCalls: number
  idempotencyKeys: string[]
  lastCompleteBody?: unknown
}

export type ReferenceMerchantOptions = {
  profile?: UcpBusinessProfile
  checkout?: (status: UcpCheckout['status']) => UcpCheckout
  checkoutId?: string
  checkoutIdForCreate?: (createCall: number) => string
  cartId?: string
  orderId?: string
  orderIdForCheckout?: (checkoutId: string, completeCall: number) => string
  completeImmediately?: boolean
}

export const createReferenceMerchantFetch = (
  state: ReferenceMerchantState,
  options: ReferenceMerchantOptions = {}
): typeof fetch => {
  const knownCheckoutIds = new Set<string>()
  const completedCheckoutIds = new Set<string>()
  const checkoutIdByOrderId = new Map<string, string>()

  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const method = (init?.method ?? 'GET').toUpperCase()
    const idempotencyKey = new Headers(init?.headers).get('idempotency-key')
    if (idempotencyKey) state.idempotencyKeys.push(idempotencyKey)

    const profile = options.profile ?? businessProfile()
    const checkoutId = options.checkoutId ?? 'chk_1'
    const cartId = options.cartId ?? 'cart_1'
    const orderId = options.orderId ?? 'order_1'
    knownCheckoutIds.add(checkoutId)
    const checkout = (status: UcpCheckout['status'], selectedCheckoutId = checkoutId) =>
      options.checkout?.(status) ?? referenceCheckout(status, profile, selectedCheckoutId)

    if (url.href === 'https://merchant.example/.well-known/ucp') {
      return Response.json(profile)
    }

    if (url.href === 'https://merchant.example/ucp/checkout-sessions' && method === 'POST') {
      const requestBody = JSON.parse(String(init?.body ?? '{}')) as {
        cart_id?: string
        line_items?: Array<{ item?: { id?: string } }>
      }
      if (requestBody.cart_id && requestBody.cart_id !== cartId) {
        return Response.json({
          ucp: { version: UCP_STABLE_VERSION, status: 'error' },
          messages: [
            {
              type: 'error',
              code: 'cart_not_found',
              content: 'The requested cart was not found.',
              severity: 'unrecoverable'
            }
          ]
        }, { status: 404 })
      }
      if (requestBody.line_items?.some((lineItem) => lineItem.item?.id === 'out_of_stock')) {
        return Response.json({
          ucp: { version: UCP_STABLE_VERSION, status: 'error' },
          messages: [
            {
              type: 'error',
              code: 'all_out_of_stock',
              content: 'Every requested item is currently out of stock.',
              severity: 'unrecoverable'
            }
          ],
          continue_url: 'https://merchant.example/products/alternatives'
        })
      }
      state.createCalls += 1
      const createdCheckoutId = options.checkoutIdForCreate?.(state.createCalls) ?? checkoutId
      knownCheckoutIds.add(createdCheckoutId)
      return Response.json(checkout('ready_for_complete', createdCheckoutId), { status: 201 })
    }

    if (url.href === 'https://merchant.example/ucp/carts' && method === 'POST') {
      state.cartCalls = (state.cartCalls ?? 0) + 1
      return Response.json(cartBase('active', cartId), { status: 201 })
    }

    if (url.href === `https://merchant.example/ucp/carts/${cartId}` && method === 'GET') {
      return Response.json(cartBase('active', cartId))
    }

    if (url.href === `https://merchant.example/ucp/carts/${cartId}` && method === 'PUT') {
      state.cartCalls = (state.cartCalls ?? 0) + 1
      return Response.json(cartBase('active', cartId))
    }

    if (url.href === `https://merchant.example/ucp/carts/${cartId}/cancel` && method === 'POST') {
      state.cartCalls = (state.cartCalls ?? 0) + 1
      return Response.json(cartBase('canceled', cartId))
    }

    const checkoutPathMatch = /^\/ucp\/checkout-sessions\/([^/]+?)(?:\/(complete|cancel))?$/.exec(url.pathname)
    const selectedCheckoutId = checkoutPathMatch?.[1] ? decodeURIComponent(checkoutPathMatch[1]) : undefined
    const checkoutOperation = checkoutPathMatch?.[2]

    if (url.origin === 'https://merchant.example' && selectedCheckoutId && knownCheckoutIds.has(selectedCheckoutId) && !checkoutOperation && method === 'GET') {
      return Response.json(checkout(
        completedCheckoutIds.has(selectedCheckoutId) ? 'completed' : 'ready_for_complete',
        selectedCheckoutId
      ))
    }

    if (url.origin === 'https://merchant.example' && selectedCheckoutId && knownCheckoutIds.has(selectedCheckoutId) && !checkoutOperation && method === 'PUT') {
      return Response.json(checkout('ready_for_complete', selectedCheckoutId))
    }

    if (url.origin === 'https://merchant.example' && selectedCheckoutId && knownCheckoutIds.has(selectedCheckoutId) && checkoutOperation === 'complete' && method === 'POST') {
      state.completeCalls += 1
      state.lastCompleteBody = JSON.parse(String(init?.body ?? '{}'))
      completedCheckoutIds.add(selectedCheckoutId)
      const selectedOrderId = options.orderIdForCheckout?.(selectedCheckoutId, state.completeCalls) ?? orderId
      checkoutIdByOrderId.set(selectedOrderId, selectedCheckoutId)
      return Response.json({
        ...checkout(
          options.completeImmediately || state.completeCalls > 1 ? 'completed' : 'complete_in_progress',
          selectedCheckoutId
        ),
        order: {
          id: selectedOrderId,
          permalink_url: `https://merchant.example/orders/${selectedOrderId}`
        }
      })
    }

    if (url.href === 'https://merchant.example/ucp/payment-handlers/com.example.processor_tokenizer/tokenize' && method === 'POST') {
      const requestBody = JSON.parse(String(init?.body ?? '{}')) as {
        checkout_id?: string
        binding?: {
          checkout_id?: string
        }
      }
      return Response.json({
        instrument: {
          id: 'pi_reference_processor_tokenizer_1',
          handler_id: 'merchant_processor_tokenizer_1',
          type: 'card',
          selected: true,
          display: {
            brand: 'visa',
            last_digits: '4242'
          },
          credential: {
            type: 'PROCESSOR_TOKEN',
            token: 'merchant-checkout-scoped-token',
            reusable: false,
            scope: {
          checkout_id: requestBody.binding?.checkout_id ?? requestBody.checkout_id ?? checkoutId,
              merchant_origin: 'https://merchant.example'
            },
            expires_at: '2099-07-11T12:00:00.000Z'
          }
        }
      })
    }

    if (url.origin === 'https://merchant.example' && selectedCheckoutId && knownCheckoutIds.has(selectedCheckoutId) && checkoutOperation === 'cancel' && method === 'POST') {
      return Response.json(checkout('canceled', selectedCheckoutId))
    }

    const orderPathMatch = /^\/ucp\/orders\/([^/]+)$/.exec(url.pathname)
    const selectedOrderId = orderPathMatch?.[1] ? decodeURIComponent(orderPathMatch[1]) : undefined
    const orderCheckoutId = selectedOrderId
      ? checkoutIdByOrderId.get(selectedOrderId) ?? (selectedOrderId === orderId ? checkoutId : undefined)
      : undefined
    if (url.origin === 'https://merchant.example' && selectedOrderId && orderCheckoutId && method === 'GET') {
      return Response.json(order(selectedOrderId, orderCheckoutId))
    }

    return Response.json({
      ucp: { version: UCP_STABLE_VERSION, status: 'error' },
      messages: [
        {
          type: 'error',
          code: 'not_found',
          content: `No reference merchant route matched ${method} ${url.href}`,
          severity: 'unrecoverable'
        }
      ]
    }, { status: 404 })
  }) as typeof fetch
}
