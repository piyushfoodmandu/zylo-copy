import { createServer } from 'node:net'
import { Elysia } from 'elysia'
import { node } from '@elysiajs/node'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  ApiErrorSchema,
  CatalogSearchResponseSchema,
  MCP_PROTOCOL_VERSION,
  McpJsonRpcResponseSchema,
  McpToolCallResultSchema,
  validationErrorSummary,
  type ApiError,
  type CatalogSearchResponse,
  type McpJsonRpcResponse,
  type McpToolCallResult,
  type McpToolName
} from '@arro/contracts'
import { buildApp } from './app.ts'

const mcpResponseValidator = TypeCompiler.Compile(McpJsonRpcResponseSchema)
const mcpToolCallResultValidator = TypeCompiler.Compile(McpToolCallResultSchema)
const catalogSearchResponseValidator = TypeCompiler.Compile(
  CatalogSearchResponseSchema
)
const apiErrorValidator = TypeCompiler.Compile(ApiErrorSchema)

type ServerHandle = {
  stop: (closeActiveConnections?: boolean) => unknown
}

type CompatibilityTarget = {
  baseUrl: URL
  stop: () => Promise<void>
  description: string
  requireConnectorBackedSearch: boolean
}

type JsonRpcSuccess = {
  jsonrpc: '2.0'
  id: string | number | null
  result: unknown
}

class McpTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'McpTransportError'
  }
}

const failures: string[] = []

const assertVerifier = (condition: unknown, message: string) => {
  if (!condition) failures.push(message)
}

const errorSummary = (error: unknown) => {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : ''
  return `${error.message}${cause}`
}

const reserveAvailablePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer()

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : undefined

      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        if (typeof port === 'number') {
          resolve(port)
          return
        }

        reject(new Error('Could not reserve an available local port.'))
      })
    })
  })

const startCompatibilityServer = async () => {
  const app = buildApp(new Elysia({ adapter: node() }), {
    loadTargetBusinessRecords: async () => [],
    requestTimeoutMs: 1000
  })
  const port = await reserveAvailablePort()
  let serverHandle: ServerHandle | undefined

  await new Promise<void>((resolve) => {
    app.listen({ hostname: '127.0.0.1', port }, (server) => {
      serverHandle = server
      resolve()
    })
  })

  return {
    baseUrl: new URL(`http://127.0.0.1:${port}`),
    stop: async () => {
      if (serverHandle) {
        await Promise.resolve(serverHandle.stop())
        return
      }

      await app.stop()
    }
  }
}

const configuredCompatibilityBaseUrl = () => {
  const rawBaseUrl = process.env.MCP_COMPATIBILITY_BASE_URL?.trim()
  if (!rawBaseUrl) return undefined

  try {
    const baseUrl = new URL(rawBaseUrl)
    if (baseUrl.protocol !== 'http:' && baseUrl.protocol !== 'https:') {
      failures.push('MCP_COMPATIBILITY_BASE_URL must be an HTTP or HTTPS origin.')
      return undefined
    }

    return baseUrl
  } catch {
    failures.push('MCP_COMPATIBILITY_BASE_URL must be a valid URL.')
    return undefined
  }
}

const compatibilityTarget = async (): Promise<CompatibilityTarget> => {
  const remoteBaseUrl = configuredCompatibilityBaseUrl()
  if (remoteBaseUrl) {
    return {
      baseUrl: remoteBaseUrl,
      stop: async () => undefined,
      description: 'configured public HTTP base URL',
      requireConnectorBackedSearch: process.env.MCP_COMPATIBILITY_REQUIRE_CONNECTOR_BACKED !== 'false'
    }
  }

  const server = await startCompatibilityServer()
  return {
    ...server,
    description: 'localhost HTTP compatibility server',
    requireConnectorBackedSearch: process.env.MCP_COMPATIBILITY_REQUIRE_CONNECTOR_BACKED === 'true'
  }
}

const isJsonRpcSuccess = (body: McpJsonRpcResponse): body is JsonRpcSuccess =>
  'result' in body && !('error' in body)

const postMcp = async ({
  baseUrl,
  requestId,
  body
}: {
  baseUrl: URL
  requestId: string
  body: unknown
}) => {
  let response: Response

  try {
    response = await fetch(new URL('/v1/mcp', baseUrl), {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'mcp-protocol-version': MCP_PROTOCOL_VERSION,
        'x-request-id': requestId,
        'x-correlation-id': requestId
      },
      body: JSON.stringify(body)
    })
  } catch (error) {
    throw new McpTransportError(`${requestId}: MCP HTTP request failed: ${errorSummary(error)}.`)
  }

  const text = await response.text()
  let parsed: unknown

  if (text.length > 0) {
    try {
      parsed = JSON.parse(text)
    } catch {
      failures.push(`${requestId}: response body is not valid JSON.`)
    }
  }

  assertVerifier(
    response.headers.get('mcp-protocol-version') === MCP_PROTOCOL_VERSION,
    `${requestId}: expected MCP protocol response header ${MCP_PROTOCOL_VERSION}.`
  )

  return {
    response,
    body: parsed
  }
}

const validatedMcpSuccess = ({
  label,
  response,
  body
}: {
  label: string
  response: Response
  body: unknown
}) => {
  assertVerifier(response.status === 200, `${label}: expected HTTP 200.`)

  if (!mcpResponseValidator.Check(body)) {
    failures.push(
      `${label}: response does not match MCP JSON-RPC response contract: ${validationErrorSummary(mcpResponseValidator, body)}`
    )
    return undefined
  }

  const mcpBody = body as McpJsonRpcResponse
  if (!isJsonRpcSuccess(mcpBody)) {
    failures.push(`${label}: expected JSON-RPC success response.`)
    return undefined
  }

  return mcpBody.result
}

const validatedToolResult = ({
  label,
  result,
  toolName,
  expectedHttpStatus,
  expectedIsError
}: {
  label: string
  result: unknown
  toolName: McpToolName
  expectedHttpStatus: number
  expectedIsError: boolean
}) => {
  if (!mcpToolCallResultValidator.Check(result)) {
    failures.push(
      `${label}: result does not match MCP tool-call result contract: ${validationErrorSummary(mcpToolCallResultValidator, result)}`
    )
    return undefined
  }

  const toolResult = result as McpToolCallResult
  const structuredContent = toolResult.structuredContent
  if (!structuredContent || typeof structuredContent !== 'object') {
    failures.push(`${label}: missing structuredContent.`)
    return undefined
  }

  const structured = structuredContent as {
    toolName?: unknown
    httpStatus?: unknown
    response?: unknown
  }

  assertVerifier(
    structured.toolName === toolName,
    `${label}: expected toolName ${toolName}.`
  )
  assertVerifier(
    structured.httpStatus === expectedHttpStatus,
    `${label}: expected delegated HTTP status ${expectedHttpStatus}.`
  )
  assertVerifier(
    (toolResult.isError === true) === expectedIsError,
    `${label}: expected isError=${expectedIsError}.`
  )

  return structured.response
}

const requiredSearchHostCapabilities = [
  'source_labels',
  'freshness',
  'caveats',
  'no_buy_warnings',
  'commercial_disclosures',
  'authority_limits',
  'allowed_next_actions'
] as const

const genericMcpSearchAgentContext = (
  hostCapabilities: readonly string[] = requiredSearchHostCapabilities
) => ({
  integrationId: 'verify-generic-mcp-client',
  surface: 'generic_mcp' as const,
  requestedActionScope: 'read:search' as const,
  sessionExpiresAt: '2099-01-01T00:00:00.000Z',
  hostCapabilities
})

const target = await compatibilityTarget()

try {
  const initialize = await postMcp({
    baseUrl: target.baseUrl,
    requestId: 'verify-mcp-initialize',
    body: {
      jsonrpc: '2.0',
      id: 'initialize-1',
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: 'arro-generic-mcp-compatibility-verifier',
          version: '0.1.0'
        }
      }
    }
  })
  const initializeResult = validatedMcpSuccess({
    label: 'initialize',
    response: initialize.response,
    body: initialize.body
  }) as { protocolVersion?: unknown; capabilities?: unknown } | undefined

  assertVerifier(
    initializeResult?.protocolVersion === MCP_PROTOCOL_VERSION,
    'initialize: expected negotiated protocol version.'
  )
  assertVerifier(
    Boolean(
      initializeResult?.capabilities &&
        typeof initializeResult.capabilities === 'object' &&
        'tools' in initializeResult.capabilities
    ),
    'initialize: expected tools capability.'
  )

  const initialized = await postMcp({
    baseUrl: target.baseUrl,
    requestId: 'verify-mcp-initialized',
    body: {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }
  })
  assertVerifier(
    initialized.response.status === 202,
    'initialized notification: expected HTTP 202.'
  )

  const toolsList = await postMcp({
    baseUrl: target.baseUrl,
    requestId: 'verify-mcp-tools-list',
    body: {
      jsonrpc: '2.0',
      id: 'tools-1',
      method: 'tools/list'
    }
  })
  const toolsResult = validatedMcpSuccess({
    label: 'tools/list',
    response: toolsList.response,
    body: toolsList.body
  }) as { tools?: Array<{ name?: unknown }> } | undefined
  const toolNames = new Set((toolsResult?.tools ?? []).map((tool) => tool.name))

  for (const expectedTool of [
    'agent_diagnostics',
    'search_products',
    'get_product_detail',
    'compare_products',
    'get_source_state',
    'sanity_check_product',
    'prepare_purchase',
    'update_purchase',
    'confirm_purchase',
    'get_purchase',
    'cancel_purchase'
  ]) {
    assertVerifier(
      toolNames.has(expectedTool),
      `tools/list: expected ${expectedTool} tool.`
    )
  }

  const searchCall = await postMcp({
    baseUrl: target.baseUrl,
    requestId: 'verify-mcp-search',
    body: {
      jsonrpc: '2.0',
      id: 'search-1',
      method: 'tools/call',
      params: {
        name: 'search_products',
        arguments: {
          query: 'trail running shoes',
          context: {
            locale: 'en-US',
            region: 'US',
            currency: 'USD',
            channel: 'agent'
          },
          agentContext: genericMcpSearchAgentContext()
        }
      }
    }
  })
  const searchResult = validatedMcpSuccess({
    label: 'search_products',
    response: searchCall.response,
    body: searchCall.body
  })
  const searchResponse = validatedToolResult({
    label: 'search_products',
    result: searchResult,
    toolName: 'search_products',
    expectedHttpStatus: 200,
    expectedIsError: false
  })

  if (!catalogSearchResponseValidator.Check(searchResponse)) {
    failures.push(
      `search_products: delegated response does not match catalog search contract: ${validationErrorSummary(catalogSearchResponseValidator, searchResponse)}`
    )
  } else {
    const catalogSearch = searchResponse as CatalogSearchResponse
    if (target.requireConnectorBackedSearch) {
      assertVerifier(
        catalogSearch.sourceMode === 'approved_sources' || catalogSearch.sourceMode === 'connected_sources',
        'search_products: expected connector-backed source mode for public MCP production verification.'
      )
    } else {
      assertVerifier(
        catalogSearch.sourceMode === 'unconfigured',
        'search_products: expected unconfigured source mode without merchant connector access.'
      )
    }
    assertVerifier(
      catalogSearch.actionPolicy.allowedNextActions.length > 0,
      'search_products: expected allowed next actions for a renderable agent response.'
    )
  }

  const deniedCall = await postMcp({
    baseUrl: target.baseUrl,
    requestId: 'verify-mcp-search-denied',
    body: {
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
    }
  })
  const deniedResult = validatedMcpSuccess({
    label: 'search_products denied',
    response: deniedCall.response,
    body: deniedCall.body
  })
  const deniedResponse = validatedToolResult({
    label: 'search_products denied',
    result: deniedResult,
    toolName: 'search_products',
    expectedHttpStatus: 403,
    expectedIsError: true
  })

  if (!apiErrorValidator.Check(deniedResponse)) {
    failures.push(
      `search_products denied: delegated response does not match API error contract: ${validationErrorSummary(apiErrorValidator, deniedResponse)}`
    )
  } else {
    const apiError = deniedResponse as ApiError
    assertVerifier(
      apiError.error.code === 'agent_host_capability_denied',
      'search_products denied: expected agent_host_capability_denied.'
    )
  }
} catch (error) {
  if (error instanceof McpTransportError) {
    failures.push(error.message)
  } else {
    throw error
  }
} finally {
  await target.stop()
}

if (failures.length > 0) {
  console.error(`Generic MCP client compatibility verification failed for ${target.baseUrl}`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log(`Generic MCP client compatibility verification passed for ${target.baseUrl}`)
  console.log(`Validated initialize, initialized notification, tools/list, read-first tool call, structured blocked state, and MCP protocol headers over ${target.description}.`)
}
