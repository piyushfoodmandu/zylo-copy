import { describe, expect, it } from 'vitest'
import { Elysia } from 'elysia'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  CatalogProductCompareResponseSchema,
  CatalogProductSanityCheckResponseSchema,
  CatalogSearchResponseSchema,
  CatalogSourceStateResponseSchema,
  MCP_PROTOCOL_VERSION,
  McpJsonRpcResponseSchema,
  McpPresentationSchema
} from '@arro/contracts'
import { buildApp } from './app.ts'
import { createAgentSessionToken } from './agent-session.ts'
import { createMcpHandler } from './mcp-handler.ts'

const mcpResponseValidator = TypeCompiler.Compile(McpJsonRpcResponseSchema)
const mcpPresentationValidator = TypeCompiler.Compile(McpPresentationSchema)
const catalogSearchResponseValidator = TypeCompiler.Compile(CatalogSearchResponseSchema)
const productCompareResponseValidator = TypeCompiler.Compile(CatalogProductCompareResponseSchema)
const productSanityCheckResponseValidator = TypeCompiler.Compile(CatalogProductSanityCheckResponseSchema)
const sourceStateResponseValidator = TypeCompiler.Compile(CatalogSourceStateResponseSchema)

const requiredSearchHostCapabilities = [
  'source_labels',
  'freshness',
  'caveats',
  'no_buy_warnings',
  'commercial_disclosures',
  'authority_limits',
  'allowed_next_actions'
] as const

const app = buildApp(new Elysia(), {
  loadTargetBusinessRecords: async () => []
})

const jsonRpcRequest = (body: unknown, requestId = 'mcp-test-request') =>
  new Request('http://localhost/v1/mcp', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-request-id': requestId
    },
    body: JSON.stringify(body)
  })

const genericMcpSearchAgentContext = (hostCapabilities = requiredSearchHostCapabilities) => ({
  integrationId: 'hermes-agent-preview',
  surface: 'hermes_agent' as const,
  requestedActionScope: 'read:search' as const,
  hostCapabilities
})

const noOpToolHandler = async () => ({})

const requestTimeoutGuard = {
  signal: new AbortController().signal,
  run: async <T>(operation: () => Promise<T>) => operation(),
  throwIfTimedOut: () => undefined,
  cleanup: () => undefined
}

const mcpSigningSecret = 'mcp-handler-test-agent-session-signing-secret-32'
const mcpPurchaseAgentContext = () => {
  const sessionExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const issued = createAgentSessionToken({
    request: {
      integrationId: 'hermes-agent-preview',
      surface: 'hermes_agent',
      allowedActionScopes: ['write:purchase', 'read:purchase'],
      sessionExpiresAt,
      hostCapabilities: [...requiredSearchHostCapabilities]
    },
    signingSecret: mcpSigningSecret,
    maxTtlSeconds: 900
  })
  if (!issued.ok) throw new Error(issued.message)
  return {
    integrationId: 'hermes-agent-preview',
    surface: 'hermes_agent' as const,
    requestedActionScope: 'write:purchase' as const,
    sessionExpiresAt,
    sessionToken: issued.session.sessionToken,
    hostCapabilities: [...requiredSearchHostCapabilities]
  }
}

describe('Arro MCP preview route', () => {
  it('initializes with tools capability and the pinned protocol version', async () => {
    const response = await app.handle(
      jsonRpcRequest({
        jsonrpc: '2.0',
        id: 'init-1',
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: 'mcp-test-client',
            version: '0.1.0'
          }
        }
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('mcp-protocol-version')).toBe(MCP_PROTOCOL_VERSION)

    const body = (await response.json()) as Record<string, any>
    expect(mcpResponseValidator.Check(body)).toBe(true)
    expect(body.result.protocolVersion).toBe(MCP_PROTOCOL_VERSION)
    expect(body.result.capabilities.tools.listChanged).toBe(false)
    expect(body.result.serverInfo.name).toBe('arro-commerce-preflight')
  })

  it('lists only Arro-owned commerce tools instead of raw connector passthroughs', async () => {
    const response = await app.handle(
      jsonRpcRequest({
        jsonrpc: '2.0',
        id: 'tools-1',
        method: 'tools/list'
      })
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, any>
    expect(mcpResponseValidator.Check(body)).toBe(true)
    const toolNames = body.result.tools.map((tool: { name: string }) => tool.name)
    expect(toolNames).toEqual([
      'agent_diagnostics',
      'search_products',
      'get_product_detail',
      'compare_products',
      'get_source_state',
      'sanity_check_product',
      'prepare_purchase',
      'update_purchase',
      'prepare_payment',
      'provide_payment',
      'confirm_purchase',
      'get_purchase',
      'cancel_purchase'
    ])
    const advertisedOutputToolNames = body.result.tools.flatMap((tool: {
      outputSchema?: { properties?: { toolName?: { anyOf?: Array<{ const?: string }> } } }
    }) => tool.outputSchema?.properties?.toolName?.anyOf?.map((entry) => entry.const) ?? [])
    expect(toolNames).toHaveLength(new Set(toolNames).size)
    expect(advertisedOutputToolNames.length).toBeGreaterThanOrEqual(toolNames.length)
    expect(JSON.stringify(body.result.tools)).not.toContain('raw_ucp')
    expect(JSON.stringify(body.result.tools)).not.toContain('browser')
    expect(JSON.stringify(body.result.tools)).not.toContain('scrape')
  })

  it('derives MCP mutation idempotency from commerce principal and business input, not transient request identity', async () => {
    const idempotencyKeys: string[] = []
    const handler = createMcpHandler({
      authenticate: async () => ({
        ok: true,
        decision: 'allowed',
        principal: {
          keyId: 'mcp-key-1',
          ownerPrincipal: 'owner:test',
          scopes: ['write:purchase'],
          environment: 'test'
        }
      }),
      agentSessionSigningSecret: mcpSigningSecret,
      hashPepper: 'mcp-test-pepper',
      apiError: (code, message, requestId) => ({ error: { code, message, requestId } }),
      handleAgentDiagnostics: noOpToolHandler,
      handleSearch: noOpToolHandler,
      handleProductDetail: noOpToolHandler,
      handleProductCompare: noOpToolHandler,
      handleSourceState: noOpToolHandler,
      handleProductSanityCheck: noOpToolHandler,
      handleCheckoutHandoffStatus: noOpToolHandler,
      handleCheckoutHandoffRefresh: noOpToolHandler,
      handlePurchases: {
        preparePurchase: async (input: { idempotencyKey: string }) => {
          idempotencyKeys.push(input.idempotencyKey)
          return {
            purchaseId: 'ucptx_test_1',
            state: 'merchant_continuation_required',
            executionLevel: 'hosted_checkout',
            merchant: {
              merchantId: 'merchant.example',
              canonicalOrigin: 'https://merchant.example',
              profileUrl: 'https://merchant.example/.well-known/ucp'
            },
            items: [
              {
                itemId: 'variant_1',
                title: 'USB-C charger',
                quantity: 1,
                url: 'https://merchant.example/products/charger'
              }
            ],
            payment: {
              completedByArro: false,
              executionLevel: 'hosted_checkout'
            },
            messages: [
              {
                severity: 'info',
                text: 'Prepared merchant-hosted checkout continuation.'
              }
            ],
            nextAction: {
              type: 'continue_on_merchant',
              label: 'Continue on merchant checkout',
              url: 'https://merchant.example/checkout/ucptx_test_1'
            },
            rawUcpTransactionId: 'ucptx_test_1'
          }
        },
        createPaymentAction: async () => ({
          actionId: 'arro_pa_test_1',
          purchaseId: 'ucptx_test_1',
          status: 'pending_user_approval' as const,
          actionType: 'x402',
          provider: 'dev.arro.payment.x402',
          handlerId: 'merchant_internal_handler_1',
          handlerName: 'dev.arro.payment.x402',
          handlerVersion: '2026-08-25',
          handlerSpecification: 'https://merchant.example/specs/x402',
          handlerSchema: 'https://merchant.example/schemas/x402.json',
          capabilityId: 'x402:internal-capability',
          merchantOrigin: 'https://merchant.example',
          checkoutId: 'checkout_test_1',
          checkoutSnapshotHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          amount: 4999,
          currency: 'USD',
          expiresAt: '2099-07-13T12:00:00.000Z',
          actionToken: 'signed-payment-action-token-000000000001',
          action: {
            kind: 'portable_payment_action',
            protocol: 'x402',
            challenge: { x402Version: 2 }
          },
          message: 'Approve this payment action once.'
        }),
        getPurchase: noOpToolHandler,
        updatePurchase: noOpToolHandler,
        confirmPurchase: noOpToolHandler,
        cancelPurchase: noOpToolHandler
      }
    })

    const purchaseAgentContext = mcpPurchaseAgentContext()
    const body = (jsonRpcId: string) => ({
      jsonrpc: '2.0',
      id: jsonRpcId,
      method: 'tools/call',
      params: {
        name: 'prepare_purchase',
        arguments: {
          merchantDomain: 'merchant.example',
          selectedOffer: {
            itemId: 'variant_1',
            title: 'USB-C charger',
            quantity: 1,
            url: 'https://merchant.example/products/charger'
          },
          agentContext: purchaseAgentContext
        }
      }
    })

    for (const [jsonRpcId, requestId, correlationId] of [
      ['rpc-1', 'http-request-1', 'corr-1'],
      ['rpc-2', 'http-request-2', 'corr-2']
    ]) {
      const set = { headers: {} as Record<string, string | number> }
      const response = await handler({
        body: body(jsonRpcId),
        request: jsonRpcRequest(body(jsonRpcId), requestId),
        requestId,
        correlationId,
        set,
        requestTimeoutGuard
      })
      expect(mcpResponseValidator.Check(response)).toBe(true)
    }

    expect(idempotencyKeys).toHaveLength(2)
    expect(idempotencyKeys[0]).toMatch(/^mcp:[0-9a-f]{64}$/)
    expect(idempotencyKeys[0]).toBe(idempotencyKeys[1])

    const paymentBody = {
      jsonrpc: '2.0',
      id: 'rpc-payment-1',
      method: 'tools/call',
      params: {
        name: 'prepare_payment',
        arguments: {
          id: 'ucptx_test_1',
          portableCapabilities: [{
            protocol: 'x402',
            version: '2',
            methods: ['exact'],
            networks: ['eip155:8453'],
            assets: ['USDC']
          }],
          agentContext: purchaseAgentContext
        }
      }
    }
    const paymentResult = await handler({
      body: paymentBody,
      request: jsonRpcRequest(paymentBody, 'http-payment-request-1'),
      requestId: 'http-payment-request-1',
      correlationId: 'corr-payment-1',
      set: { headers: {} as Record<string, string | number> },
      requestTimeoutGuard
    }) as Record<string, any>
    const publicPayment = paymentResult.result.structuredContent.response
    expect(publicPayment.actionToken).toBe('signed-payment-action-token-000000000001')
    expect(publicPayment.action.protocol).toBe('x402')
    expect(publicPayment).not.toHaveProperty('handlerId')
    expect(publicPayment).not.toHaveProperty('handlerName')
    expect(publicPayment).not.toHaveProperty('handlerSpecification')
    expect(publicPayment).not.toHaveProperty('capabilityId')
  })

  it('delegates search_products through the same catalog search contract', async () => {
    const response = await app.handle(
      jsonRpcRequest({
        jsonrpc: '2.0',
        id: 'search-1',
        method: 'tools/call',
        params: {
          name: 'search_products',
          arguments: {
            query: 'trail running shoes',
            agentContext: genericMcpSearchAgentContext()
          }
        }
      }, 'mcp-search-request')
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, any>
    expect(mcpResponseValidator.Check(body)).toBe(true)
    expect(body.result.isError).toBeUndefined()
    expect(body.result.structuredContent).toMatchObject({
      toolName: 'search_products',
      httpStatus: 200,
      requestId: 'mcp-search-request'
    })
    expect(mcpPresentationValidator.Check(
      body.result.structuredContent.presentation
    )).toBe(true)
    expect(body.result.structuredContent.presentation).toMatchObject({
      presentationVersion: 'arro-mcp-presentation/v0.1',
      surfaceHint: 'commerce_card'
    })
    expect(body.result.content[0].text).toContain('Arro:')
    expect(body.result.content[0].text).toContain('Allowed next actions:')
    expect(catalogSearchResponseValidator.Check(
      body.result.structuredContent.response
    )).toBe(true)
    expect(body.result.structuredContent.response.actionPolicy.allowedNextActions.length).toBeGreaterThan(0)
  })

  it('delegates sanity_check_product through the same product sanity-check contract', async () => {
    const response = await app.handle(
      jsonRpcRequest({
        jsonrpc: '2.0',
        id: 'sanity-1',
        method: 'tools/call',
        params: {
          name: 'sanity_check_product',
          arguments: {
            submittedUrl: 'https://example.com/products/trail-shoe',
            agentContext: {
              ...genericMcpSearchAgentContext(),
              requestedActionScope: 'read:sanity_check' as const
            }
          }
        }
      }, 'mcp-sanity-request')
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, any>
    expect(mcpResponseValidator.Check(body)).toBe(true)
    expect(body.result.isError).toBeUndefined()
    expect(body.result.structuredContent).toMatchObject({
      toolName: 'sanity_check_product',
      httpStatus: 200,
      requestId: 'mcp-sanity-request'
    })
    expect(productSanityCheckResponseValidator.Check(
      body.result.structuredContent.response
    )).toBe(true)
    expect(body.result.structuredContent.response.state).toBe('needs_review')
  })

  it('delegates compare_products through the same product comparison contract', async () => {
    const sourceLabel = {
      sourceId: 'mcp-source',
      sourceName: 'MCP Source',
      factType: 'connected_catalog_product',
      fetchedAt: '2099-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:15:00.000Z',
      freshnessClass: 'advisory_catalog',
      bindingStatus: 'advisory'
    }
    const baseProduct = {
      productId: 'mcp-trail-shoe-1',
      businessId: 'mcp-source',
      businessName: 'MCP Source',
      title: 'MCP Trail Shoe 1',
      categoryPath: ['Footwear', 'Running Shoes'],
      price: { amountMinor: 120, currency: 'USD' },
      availability: 'in_stock',
      condition: 'new',
      productUrl: 'https://mcp-source.example.com/products/trail-shoe-1',
      seller: {
        name: 'MCP Source',
        domain: 'mcp-source.example.com',
        url: 'https://mcp-source.example.com'
      },
      handoff: {
        type: 'product',
        url: 'https://mcp-source.example.com/products/trail-shoe-1'
      },
      tags: ['trail', 'shoe'],
      sourceLabel
    }
    const response = await app.handle(
      jsonRpcRequest({
        jsonrpc: '2.0',
        id: 'compare-1',
        method: 'tools/call',
        params: {
          name: 'compare_products',
          arguments: {
            sourceMode: 'connected_sources',
            products: [
              baseProduct,
              {
                ...baseProduct,
                productId: 'mcp-trail-shoe-2',
                title: 'MCP Trail Shoe 2',
                price: { amountMinor: 110, currency: 'USD' },
                productUrl: 'https://mcp-source.example.com/products/trail-shoe-2',
                handoff: {
                  type: 'product',
                  url: 'https://mcp-source.example.com/products/trail-shoe-2'
                }
              }
            ],
            agentContext: {
              ...genericMcpSearchAgentContext(),
              requestedActionScope: 'read:compare' as const
            }
          }
        }
      }, 'mcp-compare-request')
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, any>
    expect(mcpResponseValidator.Check(body)).toBe(true)
    expect(body.result.isError).toBeUndefined()
    expect(body.result.structuredContent).toMatchObject({
      toolName: 'compare_products',
      httpStatus: 200,
      requestId: 'mcp-compare-request'
    })
    expect(productCompareResponseValidator.Check(
      body.result.structuredContent.response
    )).toBe(true)
    expect(body.result.structuredContent.response.state).toBe('ready')
    expect(JSON.stringify(body)).not.toContain(['complete', 'checkout'].join('_'))
  })

  it('delegates get_source_state through the same source-state contract', async () => {
    const response = await app.handle(
      jsonRpcRequest({
        jsonrpc: '2.0',
        id: 'source-state-1',
        method: 'tools/call',
        params: {
          name: 'get_source_state',
          arguments: {
            domain: 'example.com',
            agentContext: {
              ...genericMcpSearchAgentContext(),
              requestedActionScope: 'read:source_state' as const
            }
          }
        }
      }, 'mcp-source-state-request')
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, any>
    expect(mcpResponseValidator.Check(body)).toBe(true)
    expect(body.result.isError).toBeUndefined()
    expect(body.result.structuredContent).toMatchObject({
      toolName: 'get_source_state',
      httpStatus: 200,
      requestId: 'mcp-source-state-request'
    })
    expect(sourceStateResponseValidator.Check(
      body.result.structuredContent.response
    )).toBe(true)
    expect(body.result.structuredContent.response.state).toBe('unavailable')
    expect(JSON.stringify(body)).not.toContain(['complete', 'checkout'].join('_'))
  })

  it('returns MCP tool errors when host trust-signal capability checks fail', async () => {
    const response = await app.handle(
      jsonRpcRequest({
        jsonrpc: '2.0',
        id: 'search-denied-1',
        method: 'tools/call',
        params: {
          name: 'search_products',
          arguments: {
            query: 'trail running shoes',
            agentContext: genericMcpSearchAgentContext([
              'source_labels',
              'freshness'
            ])
          }
        }
      }, 'mcp-search-denied-request')
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, any>
    expect(mcpResponseValidator.Check(body)).toBe(true)
    expect(body.result.isError).toBe(true)
    expect(body.result.structuredContent).toMatchObject({
      toolName: 'search_products',
      httpStatus: 403,
      requestId: 'mcp-search-denied-request'
    })
    expect(body.result.structuredContent.response.error.code).toBe(
      'agent_host_capability_denied'
    )
  })

  it('rejects unsupported MCP methods and non-POST transport use', async () => {
    const unsupportedResponse = await app.handle(
      jsonRpcRequest({
        jsonrpc: '2.0',
        id: 'unsupported-1',
        method: 'resources/list'
      })
    )

    expect(unsupportedResponse.status).toBe(400)
    const unsupportedBody = (await unsupportedResponse.json()) as Record<string, any>
    expect(mcpResponseValidator.Check(unsupportedBody)).toBe(true)
    expect(unsupportedBody.error.code).toBe(-32601)

    const getResponse = await app.handle(
      new Request('http://localhost/v1/mcp', {
        method: 'GET'
      })
    )

    expect(getResponse.status).toBe(405)
    expect(getResponse.headers.get('allow')).toBe('POST')
    const getBody = (await getResponse.json()) as Record<string, any>
    expect(getBody.error.code).toBe('method_not_allowed')
  })
})
