import { describe, expect, it, vi } from 'vitest'
import {
  catalogToolSupportFromMcpTools,
  commerceToolSupportFromMcpTools,
  introspectUcpMcpTools
} from './ucp-mcp-introspection.ts'
import type { ConnectorHttpFetcher } from './http-transport.ts'
import {
  connectorHttpResponse as httpResponse,
  discardableConnectorResponse
} from './test-http-response.test-support.ts'

const now = new Date('2026-06-03T00:00:00.000Z')
const publicResolver = async () => [{ address: '203.0.113.20' }]

describe('UCP MCP tool introspection', () => {
  it('lists MCP tools with platform profile metadata', async () => {
    const fetcher = vi.fn(async (_input: Parameters<ConnectorHttpFetcher>[0], init?: Parameters<ConnectorHttpFetcher>[1]) => {
      const body = JSON.parse(String(init?.body)) as Record<string, any>

      expect(init?.method).toBe('POST')
      expect((init?.headers as Record<string, string>)['UCP-Agent']).toBe('https://arro.example/.well-known/ucp')
      expect(body.method).toBe('tools/list')
      expect(body.params.arguments.meta['ucp-agent'].profile).toBe('https://arro.example/.well-known/ucp')

      return httpResponse(JSON.stringify({
        jsonrpc: '2.0',
        id: 'tools-1',
        result: {
          tools: [
            {
              name: 'search_catalog',
              description: 'Search catalog products.',
              inputSchema: { type: 'object' }
            },
            { name: 'lookup_catalog' },
            { name: 'get_product' },
            { name: 'create_cart' },
            { name: 'create_checkout' },
            { name: 'get_checkout' },
            { name: 'list_payment_methods' },
            { name: 'authorize_payment' }
          ]
        }
      }), 200, {
        'content-type': 'application/json'
      })
    })

    const result = await introspectUcpMcpTools({
      endpointUrl: 'https://store.example/api/ucp/mcp',
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      requestId: 'tools-1',
      now,
      fetcher,
      resolver: publicResolver
    })

    expect(result.status).toBe('fetched')
    expect(result.endpointUrl).toBe('https://store.example/api/ucp/mcp')
    expect(result.fetchedAt).toBe(now.toISOString())
    expect(result.tools.map((tool) => tool.name)).toEqual([
      'search_catalog',
      'lookup_catalog',
      'get_product',
      'create_cart',
      'create_checkout',
      'get_checkout',
      'list_payment_methods',
      'authorize_payment'
    ])
    expect(catalogToolSupportFromMcpTools(result.tools)).toEqual({
      searchCatalog: true,
      lookupCatalog: true,
      getProduct: true
    })
    expect(commerceToolSupportFromMcpTools(result.tools)).toMatchObject({
      searchCatalog: true,
      lookupCatalog: true,
      getProduct: true,
      cart: {
        create: true,
        get: false,
        update: false,
        cancel: false
      },
      checkout: {
        create: true,
        get: true,
        update: false,
        complete: false,
        cancel: false
      },
      payment: {
        listMethods: true,
        authorize: true,
        confirm: false
      }
    })
    expect(result.messages[0]?.code).toBe('ucp_mcp_tools_fetched')
  })

  it('blocks non-HTTPS MCP endpoints before fetch', async () => {
    const fetcher = vi.fn()

    const result = await introspectUcpMcpTools({
      endpointUrl: 'http://store.example/api/ucp/mcp',
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      requestId: 'tools-2',
      now,
      fetcher,
      resolver: publicResolver
    })

    expect(result.status).toBe('blocked')
    expect(result.messages[0]?.code).toBe('ucp_mcp_tools_endpoint_blocked')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns invalid response when tools are missing', async () => {
    const result = await introspectUcpMcpTools({
      endpointUrl: 'https://store.example/api/ucp/mcp',
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      requestId: 'tools-3',
      now,
      resolver: publicResolver,
      fetcher: async () => httpResponse(JSON.stringify({
        jsonrpc: '2.0',
        id: 'tools-3',
        result: {}
      }), 200, {
        'content-type': 'application/json'
      })
    })

    expect(result.status).toBe('invalid_response')
    expect(result.tools).toEqual([])
    expect(result.messages[0]?.code).toBe('ucp_mcp_tools_missing')
  })

  it('dumps non-success tools/list response bodies before returning errors', async () => {
    const response = discardableConnectorResponse({ status: 500 })
    const result = await introspectUcpMcpTools({
      endpointUrl: 'https://store.example/api/ucp/mcp',
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      requestId: 'tools-4',
      now,
      resolver: publicResolver,
      fetcher: async () => response.response
    })
    await Promise.resolve()

    expect(result.status).toBe('error')
    expect(result.messages[0]?.code).toBe('ucp_mcp_tools_http_error')
    expect(response.discarded()).toBe(true)
  })

  it('dumps invalid content-type tools/list response bodies before returning invalid response', async () => {
    const response = discardableConnectorResponse({
      status: 200,
      contentType: 'text/plain'
    })
    const result = await introspectUcpMcpTools({
      endpointUrl: 'https://store.example/api/ucp/mcp',
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      requestId: 'tools-5',
      now,
      resolver: publicResolver,
      fetcher: async () => response.response
    })
    await Promise.resolve()

    expect(result.status).toBe('invalid_response')
    expect(result.messages[0]?.code).toBe('ucp_mcp_tools_response_invalid')
    expect(response.discarded()).toBe(true)
  })
})
