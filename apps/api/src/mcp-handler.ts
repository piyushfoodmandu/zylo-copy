import { createHash } from 'node:crypto'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  MCP_PROTOCOL_VERSION,
  McpClientMessageSchema,
  McpJsonRpcIdSchema,
  ArroInternalMcpToolDefinitions,
  ArroMcpToolDefinitions,
  validationErrorSummary,
  type AgentActionScope,
  type AgentInvocationContext,
  type ApiError,
  type McpClientMessage,
  type McpJsonRpcErrorResponse,
  type McpJsonRpcId,
  type McpJsonRpcSuccessResponse,
  type McpToolCallResult,
  type McpToolName,
  type McpToolsCallRequest
} from '@arro/contracts'
import type { Authenticator } from './auth.ts'
import { deriveCommercePrincipal, type CommercePrincipal } from './commerce-principal.ts'
import type { AgentDiagnosticsHandler } from './agent-diagnostics-handler.ts'
import type { ProductCompareHandler } from './product-compare-handler.ts'
import type { ProductDetailHandler } from './product-detail-handler.ts'
import type { ProductSanityCheckHandler } from './product-sanity-check-handler.ts'
import type { PurchaseOrchestrator } from './purchase-orchestrator.ts'
import type { RequestTimeoutGuard } from './request-timeout.ts'
import type { SearchHandler } from './search-handler.ts'
import type { SourceStateHandler } from './source-state-handler.ts'
import {
  buildMcpPresentation,
  renderMcpPresentationText
} from './mcp-presentation.ts'
import { stableJsonStringify } from './stable-json.ts'

const mcpClientMessageValidator = TypeCompiler.Compile(McpClientMessageSchema)
const mcpJsonRpcIdValidator = TypeCompiler.Compile(McpJsonRpcIdSchema)
const mcpToolInputValidators = new Map(
  ArroInternalMcpToolDefinitions.map((tool) => [
    tool.name,
    TypeCompiler.Compile(tool.inputSchema)
  ])
)

type McpSet = {
  status?: number | string
  headers: Record<string, string | number>
}

type ToolSet = {
  status?: number | string
}

type CreateMcpHandlerOptions = {
  authenticate: Authenticator
  agentSessionSigningSecret?: string | undefined
  hashPepper?: string | undefined
  apiError: (code: string, message: string, requestId: string) => ApiError
  handleAgentDiagnostics: AgentDiagnosticsHandler
  handleSearch: SearchHandler
  handleProductDetail: ProductDetailHandler
  handleProductCompare: ProductCompareHandler
  handleSourceState: SourceStateHandler
  handleProductSanityCheck: ProductSanityCheckHandler
  handlePurchases?: PurchaseOrchestrator
  mppPaymentMethods?: string[]
}

export type McpHandlerOptions = {
  body: unknown
  request: Request
  requestId: string
  correlationId: string
  set: McpSet
  requestTimeoutGuard: RequestTimeoutGuard
}

export type McpHandler = (options: McpHandlerOptions) => Promise<unknown>

const knownMethods = new Set([
  'initialize',
  'notifications/initialized',
  'tools/list',
  'tools/call'
])

const extractRequestId = (body: unknown): McpJsonRpcId | undefined => {
  if (!body || typeof body !== 'object' || !('id' in body)) return undefined

  const id = (body as { id: unknown }).id
  return mcpJsonRpcIdValidator.Check(id) ? id : undefined
}

const requestMethod = (body: unknown) =>
  body &&
  typeof body === 'object' &&
  typeof (body as { method?: unknown }).method === 'string'
    ? (body as { method: string }).method
    : undefined

const setMcpHeaders = (set: McpSet) => {
  set.headers['MCP-Protocol-Version'] = MCP_PROTOCOL_VERSION
}

const jsonRpcSuccess = (
  id: McpJsonRpcId,
  result: unknown
): McpJsonRpcSuccessResponse => ({
  jsonrpc: '2.0',
  id,
  result
})

const jsonRpcError = ({
  id,
  code,
  message,
  data
}: {
  id?: McpJsonRpcId
  code: number
  message: string
  data?: unknown
}): McpJsonRpcErrorResponse => ({
  jsonrpc: '2.0',
  ...(typeof id === 'undefined' ? {} : { id }),
  error: {
    code,
    message,
    ...(typeof data === 'undefined' ? {} : { data })
  }
})

const statusCodeFromSet = (status: unknown) =>
  typeof status === 'number' ? status : 200

const isApiErrorPayload = (value: unknown) =>
  Boolean(
    value &&
    typeof value === 'object' &&
    'error' in value &&
    (value as { error?: unknown }).error &&
    typeof (value as { error: { code?: unknown } }).error.code === 'string'
  )

const publicMcpResponse = (toolName: McpToolName, response: unknown): unknown => {
  if (!response || typeof response !== 'object' || Array.isArray(response) || isApiErrorPayload(response)) {
    return response
  }
  const output = { ...(response as Record<string, unknown>) }
  delete output.rawUcpTransactionId

  if (output.payment && typeof output.payment === 'object' && !Array.isArray(output.payment)) {
    const payment = { ...(output.payment as Record<string, unknown>) }
    delete payment.selectedHandlerId
    delete payment.capabilityId
    output.payment = payment
  }

  if (toolName === 'prepare_payment') {
    delete output.handlerId
    delete output.handlerName
    delete output.handlerVersion
    delete output.handlerSpecification
    delete output.handlerSchema
    delete output.capabilityId
  }

  return output
}

const structuredToolResult = ({
  toolName,
  httpStatus,
  requestId,
  correlationId,
  response
}: {
  toolName: McpToolName
  httpStatus: number
  requestId: string
  correlationId: string
  response: unknown
}): McpToolCallResult => {
  const publicResponse = publicMcpResponse(toolName, response)
  const presentation = buildMcpPresentation({
    toolName,
    httpStatus,
    response: publicResponse
  })
  const structuredContent = {
    toolName,
    httpStatus,
    requestId,
    correlationId,
    presentation,
    response: publicResponse
  }
  const isError = httpStatus >= 400 || isApiErrorPayload(publicResponse)

  return {
    content: [
      {
        type: 'text',
        text: renderMcpPresentationText({
          presentation,
          requestId
        })
      }
    ],
    structuredContent,
    ...(isError ? { isError: true } : {})
  }
}

const protectedToolScopes = new Map<McpToolName, AgentActionScope>([
  ['prepare_purchase', 'write:purchase'],
  ['update_purchase', 'write:purchase'],
  ['prepare_payment', 'write:purchase'],
  ['provide_payment', 'write:complete_purchase'],
  ['confirm_purchase', 'write:complete_purchase'],
  ['get_purchase', 'read:purchase'],
  ['cancel_purchase', 'write:purchase']
])

const agentContextFromArgs = (args: Record<string, unknown>): AgentInvocationContext | undefined =>
  args.agentContext && typeof args.agentContext === 'object' && !Array.isArray(args.agentContext)
    ? args.agentContext as AgentInvocationContext
    : undefined

export const createMcpHandler = ({
  authenticate,
  agentSessionSigningSecret,
  hashPepper,
  apiError,
  handleAgentDiagnostics,
  handleSearch,
  handleProductDetail,
  handleProductCompare,
  handleSourceState,
  handleProductSanityCheck,
  handlePurchases,
  mppPaymentMethods = []
}: CreateMcpHandlerOptions): McpHandler => async ({
  body,
  request,
  requestId,
  correlationId,
  set,
  requestTimeoutGuard
}) => {
  setMcpHeaders(set)

  if (!mcpClientMessageValidator.Check(body)) {
    set.status = 400
    const method = requestMethod(body)
    if (method && !knownMethods.has(method)) {
      const id = extractRequestId(body)
      return jsonRpcError({
        ...(typeof id === 'undefined' ? {} : { id }),
        code: -32601,
        message: `MCP method ${method} is not supported by Arro.`
      })
    }

    const id = extractRequestId(body)
    return jsonRpcError({
      ...(typeof id === 'undefined' ? {} : { id }),
      code: -32600,
      message: 'The request did not match Arro MCP JSON-RPC contract.',
      data: validationErrorSummary(mcpClientMessageValidator, body)
    })
  }

  const message = body as McpClientMessage

  if (message.method === 'notifications/initialized') {
    set.status = 202
    return undefined
  }

  if (message.method === 'initialize') {
    return jsonRpcSuccess(message.id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {
          listChanged: false
        },
        ...(mppPaymentMethods.length > 0
          ? { experimental: { payment: { methods: mppPaymentMethods } } }
          : {})
      },
      serverInfo: {
        name: 'arro-commerce-preflight',
        version: '0.1.0'
      },
      instructions: 'Use Arro for source-backed discovery, purchase preparation, exact payment-capability negotiation, confirmation, and merchant Order continuity. A payment credential or completed Checkout state is not completion until the merchant returns an Order.'
    })
  }

  if (message.method === 'tools/list') {
    return jsonRpcSuccess(message.id, {
      tools: ArroMcpToolDefinitions
    })
  }

  const toolCall = message as McpToolsCallRequest
  const toolName = toolCall.params.name
  const toolArguments = toolCall.params.arguments ?? {}
  const toolSet: ToolSet = {}

  const validateToolArguments = () => {
    const validator = mcpToolInputValidators.get(toolName)
    if (!validator) return undefined
    if (validator.Check(toolArguments)) return undefined
    return validationErrorSummary(validator, toolArguments)
  }

  const idempotencyKeyFromMeta = (args: Record<string, unknown>) => {
    if (typeof args.idempotencyKey === 'string' && args.idempotencyKey.trim()) {
      return args.idempotencyKey.trim()
    }

    const meta = args.meta && typeof args.meta === 'object' && !Array.isArray(args.meta)
      ? args.meta as Record<string, unknown>
      : {}
    for (const key of ['idempotency-key', 'idempotencyKey', 'clientInvocationId', 'client_invocation_id']) {
      if (typeof meta[key] === 'string' && meta[key].trim()) return meta[key].trim()
    }
    return undefined
  }

  const stringArg = (value: unknown) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined

  const argsRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

  const canonicalBusinessInput = (args: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(args)
        .filter(([key]) => !['agentContext', 'idempotencyKey', 'meta'].includes(key))
    )

  const resourceIdentity = (args: Record<string, unknown>) => {
    const checkout = argsRecord(args.checkout)
    return {
      id: stringArg(args.id),
      purchaseId: stringArg(args.purchaseId),
      transactionId: stringArg(args.transactionId),
      orderId: stringArg(args.orderId),
      checkoutId: stringArg(args.checkoutId) ?? stringArg(checkout.id),
      merchantProfileUrl: stringArg(args.merchantProfileUrl) ?? stringArg(args.merchant_profile_url),
      merchantDomain: stringArg(args.merchantDomain) ?? stringArg(args.merchant_domain)
    }
  }

  const principalIdentity = (principal: CommercePrincipal) => ({
    keyId: principal.keyId,
    ownerPrincipalHash: principal.ownerPrincipalHash,
    integrationId: principal.integrationId,
    externalSubjectRefHash: principal.externalSubjectRefHash,
    externalTaskRefHash: principal.externalTaskRefHash,
    agentSessionId: principal.agentSessionId
  })

  const derivedMcpIdempotencyKey = (args: Record<string, unknown>, principal: CommercePrincipal) =>
    `mcp:${createHash('sha256')
      .update(stableJsonStringify({
        principal: principalIdentity(principal),
        toolName,
        resource: resourceIdentity(args),
        input: canonicalBusinessInput(args)
      }), 'utf8')
      .digest('hex')}`

  const mcpIdempotencyKey = (args: Record<string, unknown>, principal: CommercePrincipal) =>
    idempotencyKeyFromMeta(args) ?? derivedMcpIdempotencyKey(args, principal)

  const authorizeToolCall = async (): Promise<
    | { ok: true; principal: CommercePrincipal }
    | { ok: false; response: unknown }
  > => {
    const requiredScope = protectedToolScopes.get(toolName)
    if (!requiredScope) {
      return {
        ok: false,
        response: {
          error: {
            code: 'mcp_tool_scope_unavailable',
            message: `MCP tool ${toolName} does not have a purchase authority scope.`,
            requestId
          }
        }
      }
    }

    const authResult = await authenticate({
      request,
      requestId,
      requiredScopes: [requiredScope]
    })

    if (!authResult.ok) {
      toolSet.status = authResult.status
      return { ok: false, response: authResult.body }
    }

    const args = toolArguments && typeof toolArguments === 'object' && !Array.isArray(toolArguments)
      ? toolArguments as Record<string, unknown>
      : {}
    const principal = deriveCommercePrincipal({
      authPrincipal: authResult.principal,
      agentContext: agentContextFromArgs(args),
      expectedScope: requiredScope,
      signingSecret: agentSessionSigningSecret,
      hashPepper,
      requestId,
      apiError
    })

    if (!principal.ok) {
      toolSet.status = principal.error.status
      return { ok: false, response: principal.error.body }
    }

    return { ok: true, principal: principal.principal }
  }

  const requirePurchases = () => {
    if (handlePurchases) return handlePurchases
    toolSet.status = 503
    return undefined
  }

  const toolResponse = await (async () => {
    if (toolName === 'prepare_purchase') {
      const validationError = validateToolArguments()
      if (validationError) {
        toolSet.status = 422
        return {
          error: {
            code: 'mcp_tool_input_invalid',
            message: `MCP tool ${toolName} arguments do not match Arro's typed input schema.`,
            requestId,
            details: validationError
          }
        }
      }
      const purchases = requirePurchases()
      if (!purchases) {
        return {
          error: {
            code: 'purchase_runtime_store_required',
            message: 'Purchase orchestration is not configured for this Arro MCP server.',
            requestId
          }
        }
      }
      const auth = await authorizeToolCall()
      if (!auth.ok) return auth.response
      const args = argsRecord(toolArguments)
      return purchases.preparePurchase({
        ...args,
        idempotencyKey: mcpIdempotencyKey(args, auth.principal),
        principal: auth.principal
      } as never)
    }

    if (toolName === 'update_purchase') {
      const validationError = validateToolArguments()
      if (validationError) {
        toolSet.status = 422
        return {
          error: {
            code: 'mcp_tool_input_invalid',
            message: `MCP tool ${toolName} arguments do not match Arro's typed input schema.`,
            requestId,
            details: validationError
          }
        }
      }
      const purchases = requirePurchases()
      if (!purchases) {
        return {
          error: {
            code: 'purchase_runtime_store_required',
            message: 'Purchase orchestration is not configured for this Arro MCP server.',
            requestId
          }
        }
      }
      const auth = await authorizeToolCall()
      if (!auth.ok) return auth.response
      const args = argsRecord(toolArguments)
      return purchases.updatePurchase({
        ...args,
        idempotencyKey: mcpIdempotencyKey(args, auth.principal),
        principal: auth.principal
      } as never)
    }

    if (toolName === 'confirm_purchase') {
      const validationError = validateToolArguments()
      if (validationError) {
        toolSet.status = 422
        return {
          error: {
            code: 'mcp_tool_input_invalid',
            message: `MCP tool ${toolName} arguments do not match Arro's typed input schema.`,
            requestId,
            details: validationError
          }
        }
      }
      const purchases = requirePurchases()
      if (!purchases) {
        return {
          error: {
            code: 'purchase_runtime_store_required',
            message: 'Purchase orchestration is not configured for this Arro MCP server.',
            requestId
          }
        }
      }
      const auth = await authorizeToolCall()
      if (!auth.ok) return auth.response
      const args = argsRecord(toolArguments)
      return purchases.confirmPurchase({
        ...args,
        idempotencyKey: mcpIdempotencyKey(args, auth.principal),
        principal: auth.principal
      } as never)
    }

    if (toolName === 'prepare_payment') {
      const validationError = validateToolArguments()
      if (validationError) {
        toolSet.status = 422
        return { error: { code: 'mcp_tool_input_invalid', message: `MCP tool ${toolName} arguments do not match Arro's typed input schema.`, requestId, details: validationError } }
      }
      const purchases = requirePurchases()
      if (!purchases) return { error: { code: 'purchase_runtime_store_required', message: 'Purchase orchestration is not configured for this Arro MCP server.', requestId } }
      const auth = await authorizeToolCall()
      if (!auth.ok) return auth.response
      const args = argsRecord(toolArguments)
      return purchases.createPaymentAction({
        ...args,
        idempotencyKey: mcpIdempotencyKey(args, auth.principal),
        principal: auth.principal
      } as never)
    }

    if (toolName === 'provide_payment') {
      const validationError = validateToolArguments()
      if (validationError) {
        toolSet.status = 422
        return { error: { code: 'mcp_tool_input_invalid', message: `MCP tool ${toolName} arguments do not match Arro's typed input schema.`, requestId, details: validationError } }
      }
      const purchases = requirePurchases()
      if (!purchases) return { error: { code: 'purchase_runtime_store_required', message: 'Purchase orchestration is not configured for this Arro MCP server.', requestId } }
      const auth = await authorizeToolCall()
      if (!auth.ok) return auth.response
      const args = argsRecord(toolArguments)
      return purchases.recordPaymentActionResult({
        ...args,
        idempotencyKey: mcpIdempotencyKey(args, auth.principal)
      } as never)
    }

    if (toolName === 'get_purchase') {
      const validationError = validateToolArguments()
      if (validationError) {
        toolSet.status = 422
        return {
          error: {
            code: 'mcp_tool_input_invalid',
            message: `MCP tool ${toolName} arguments do not match Arro's typed input schema.`,
            requestId,
            details: validationError
          }
        }
      }
      const purchases = requirePurchases()
      if (!purchases) {
        return {
          error: {
            code: 'purchase_runtime_store_required',
            message: 'Purchase orchestration is not configured for this Arro MCP server.',
            requestId
          }
        }
      }
      const id = typeof (toolArguments as { id?: unknown }).id === 'string' ? (toolArguments as { id: string }).id : ''
      const auth = await authorizeToolCall()
      if (!auth.ok) return auth.response
      return purchases.getPurchase(id, auth.principal)
    }

    if (toolName === 'cancel_purchase') {
      const validationError = validateToolArguments()
      if (validationError) {
        toolSet.status = 422
        return {
          error: {
            code: 'mcp_tool_input_invalid',
            message: `MCP tool ${toolName} arguments do not match Arro's typed input schema.`,
            requestId,
            details: validationError
          }
        }
      }
      const purchases = requirePurchases()
      if (!purchases) {
        return {
          error: {
            code: 'purchase_runtime_store_required',
            message: 'Purchase orchestration is not configured for this Arro MCP server.',
            requestId
          }
        }
      }
      const auth = await authorizeToolCall()
      if (!auth.ok) return auth.response
      const args = argsRecord(toolArguments)
      return purchases.cancelPurchase({
        ...args,
        idempotencyKey: mcpIdempotencyKey(args, auth.principal),
        principal: auth.principal
      } as never)
    }

    if (toolName === 'agent_diagnostics') {
      return handleAgentDiagnostics({
        body: toolArguments,
        requestId,
        correlationId,
        set: toolSet
      })
    }

    if (toolName === 'search_products') {
      return handleSearch({
        body: toolArguments,
        requestId,
        correlationId,
        route: '/v1/catalog/search',
        set: toolSet,
        requestTimeoutGuard
      })
    }

    if (toolName === 'get_product_detail') {
      return handleProductDetail({
        body: toolArguments,
        requestId,
        correlationId,
        route: '/v1/catalog/product',
        set: toolSet,
        requestTimeoutGuard
      })
    }

    if (toolName === 'compare_products') {
      return handleProductCompare({
        body: toolArguments,
        requestId,
        correlationId,
        set: toolSet
      })
    }

    if (toolName === 'get_source_state') {
      return handleSourceState({
        body: toolArguments,
        requestId,
        correlationId,
        set: toolSet,
        requestTimeoutGuard
      })
    }

    if (toolName === 'sanity_check_product') {
      return handleProductSanityCheck({
        body: toolArguments,
        requestId,
        correlationId,
        set: toolSet
      })
    }

    toolSet.status = 400
    return {
      error: {
        code: 'mcp_tool_not_supported',
        message: `MCP tool ${toolName} is not supported by this Arro MCP server.`,
        requestId
      }
    }
  })()

  return jsonRpcSuccess(
    toolCall.id,
    structuredToolResult({
      toolName,
      httpStatus: statusCodeFromSet(toolSet.status),
      requestId,
      correlationId,
      response: toolResponse
    })
  )
}
