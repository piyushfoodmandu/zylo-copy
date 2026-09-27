import { describe, expect, it } from 'vitest'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  MCP_PROTOCOL_VERSION,
  McpClientMessageSchema,
  McpJsonRpcResponseSchema,
  McpPublicToolStructuredContentSchema,
  McpToolCallResultSchema,
  ArroInternalMcpToolDefinitions,
  ArroMcpToolDefinitions
} from './mcp.ts'

const clientMessageValidator = TypeCompiler.Compile(McpClientMessageSchema)
const jsonRpcResponseValidator = TypeCompiler.Compile(McpJsonRpcResponseSchema)
const toolCallResultValidator = TypeCompiler.Compile(McpToolCallResultSchema)

describe('Arro MCP contract', () => {
  it('declares the preview protocol version and canonical tool names', () => {
    expect(MCP_PROTOCOL_VERSION).toBe('2025-11-25')
    expect(ArroMcpToolDefinitions.map((tool) => tool.name)).toEqual([
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
    expect(ArroMcpToolDefinitions.every((tool) => tool.outputSchema === McpPublicToolStructuredContentSchema)).toBe(true)
  })

  it('accepts initialize, list, call, and initialized notification messages', () => {
    expect(clientMessageValidator.Check({
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: {
          name: 'test-agent',
          version: '0.1.0'
        }
      }
    })).toBe(true)

    expect(clientMessageValidator.Check({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    })).toBe(true)

    expect(clientMessageValidator.Check({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: {
        name: 'search_products',
        arguments: {
          query: 'running shoes'
        }
      }
    })).toBe(true)

    expect(clientMessageValidator.Check({
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    })).toBe(true)
  })

  it('rejects unknown tools and non-canonical JSON-RPC messages', () => {
    expect(clientMessageValidator.Check({
      jsonrpc: '2.0',
      id: 'bad-tool',
      method: 'tools/call',
      params: {
        name: 'raw_ucp_passthrough',
        arguments: {}
      }
    })).toBe(false)

    expect(clientMessageValidator.Check({
      jsonrpc: '2.0',
      id: 'missing-method'
    })).toBe(false)
  })

  it('validates MCP responses and tool results', () => {
    expect(jsonRpcResponseValidator.Check({
      jsonrpc: '2.0',
      id: 'list-1',
      result: {
        tools: ArroMcpToolDefinitions
      }
    })).toBe(true)

    expect(jsonRpcResponseValidator.Check({
      jsonrpc: '2.0',
      id: 'error-1',
      error: {
        code: -32601,
        message: 'Method not found.'
      }
    })).toBe(true)

    expect(toolCallResultValidator.Check({
      content: [
        {
          type: 'text',
          text: 'Arro tool result'
        }
      ],
      structuredContent: {
        toolName: 'search_products',
        httpStatus: 200,
        requestId: 'request-1',
        correlationId: 'correlation-1',
        presentation: {
          presentationVersion: 'arro-mcp-presentation/v0.1',
          surfaceHint: 'commerce_card',
          title: 'Search results',
          status: 'ready',
          tone: 'info',
          facts: [],
          sourceLabels: [],
          warnings: [],
          authorityLimits: [],
          allowedNextActions: []
        },
        response: {
          ok: true
        }
      }
    })).toBe(true)
  })

  it('keeps raw UCP transaction tools out of MCP and requires compact purchase orchestration', () => {
    const internalNames = ArroInternalMcpToolDefinitions.map((tool) => tool.name)
    for (const removedTool of [
      ['create', 'checkout'],
      ['get', 'checkout'],
      ['update', 'checkout'],
      ['list', 'checkout', 'payment', 'handlers'],
      ['prepare', 'checkout', 'payment'],
      ['confirm', 'checkout'],
      ['complete', 'checkout'],
      ['cancel', 'checkout'],
      ['get', 'order']
    ].map((parts) => parts.join('_'))) {
      expect(internalNames).not.toContain(removedTool)
      expect(clientMessageValidator.Check({
        jsonrpc: '2.0',
        id: `removed-${removedTool}`,
        method: 'tools/call',
        params: {
          name: removedTool,
          arguments: {}
        }
      })).toBe(false)
    }

    expect(clientMessageValidator.Check({
      jsonrpc: '2.0',
      id: 'prepare-purchase',
      method: 'tools/call',
      params: {
        name: 'prepare_purchase',
        arguments: {
          merchantDomain: 'merchant.example',
          selectedOffer: {
            variantId: 'sku_1',
            quantity: 1
          }
        }
      }
    })).toBe(true)
  })
})
