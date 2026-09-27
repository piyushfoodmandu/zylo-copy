import { Type, type Static } from '@sinclair/typebox'
import {
  AgentDiagnosticsRequestSchema,
  AgentInvocationContextSchema
} from './agent.ts'
import {
  CatalogProductCompareRequestSchema,
  CatalogProductDetailRequestSchema,
  CatalogProductSanityCheckRequestSchema,
  CatalogSourceStateRequestSchema,
  CatalogSearchRequestSchema
} from './catalog.ts'
import {
  PurchaseConfirmRequestSchema,
  PurchasePaymentActionCreateRequestSchema,
  PurchasePaymentActionResultRequestSchema,
  PurchasePrepareRequestSchema,
  PurchaseUpdateRequestSchema
} from './purchase.ts'

export const MCP_PROTOCOL_VERSION = '2025-11-25'

export const McpJsonRpcIdSchema = Type.Union([
  Type.String({ minLength: 1, maxLength: 128 }),
  Type.Number(),
  Type.Null()
])

const McpMetadataObjectSchema = Type.Object(
  {},
  { additionalProperties: true }
)

export const McpToolNameSchema = Type.Union([
  Type.Literal('agent_diagnostics'),
  Type.Literal('search_products'),
  Type.Literal('get_product_detail'),
  Type.Literal('compare_products'),
  Type.Literal('get_source_state'),
  Type.Literal('sanity_check_product'),
  Type.Literal('prepare_purchase'),
  Type.Literal('update_purchase'),
  Type.Literal('prepare_payment'),
  Type.Literal('provide_payment'),
  Type.Literal('confirm_purchase'),
  Type.Literal('get_purchase'),
  Type.Literal('cancel_purchase')
])

export const McpPublicToolNameSchema = Type.Union([
  Type.Literal('agent_diagnostics'),
  Type.Literal('search_products'),
  Type.Literal('get_product_detail'),
  Type.Literal('compare_products'),
  Type.Literal('get_source_state'),
  Type.Literal('sanity_check_product'),
  Type.Literal('prepare_purchase'),
  Type.Literal('update_purchase'),
  Type.Literal('prepare_payment'),
  Type.Literal('provide_payment'),
  Type.Literal('confirm_purchase'),
  Type.Literal('get_purchase'),
  Type.Literal('cancel_purchase')
])

export const McpInitializeRequestSchema = Type.Object(
  {
    jsonrpc: Type.Literal('2.0'),
    id: McpJsonRpcIdSchema,
    method: Type.Literal('initialize'),
    params: Type.Optional(
      Type.Object(
        {
          protocolVersion: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
          capabilities: Type.Optional(McpMetadataObjectSchema),
          clientInfo: Type.Optional(McpMetadataObjectSchema)
        },
        { additionalProperties: true }
      )
    )
  },
  { additionalProperties: false }
)

export const McpInitializedNotificationSchema = Type.Object(
  {
    jsonrpc: Type.Literal('2.0'),
    method: Type.Literal('notifications/initialized'),
    params: Type.Optional(McpMetadataObjectSchema)
  },
  { additionalProperties: false }
)

export const McpToolsListRequestSchema = Type.Object(
  {
    jsonrpc: Type.Literal('2.0'),
    id: McpJsonRpcIdSchema,
    method: Type.Literal('tools/list'),
    params: Type.Optional(
      Type.Object(
        {
          cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 512 }))
        },
        { additionalProperties: false }
      )
    )
  },
  { additionalProperties: false }
)

export const McpToolsCallParamsSchema = Type.Object(
  {
    name: McpToolNameSchema,
    arguments: Type.Optional(Type.Any())
  },
  { additionalProperties: false }
)

export const McpPurchasePrepareRequestSchema = PurchasePrepareRequestSchema

export const McpPurchaseUpdateRequestSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    ...PurchaseUpdateRequestSchema.properties
  },
  { additionalProperties: false }
)

export const McpPurchaseConfirmRequestSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    ...PurchaseConfirmRequestSchema.properties
  },
  { additionalProperties: false }
)

export const McpPurchasePreparePaymentRequestSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    ...PurchasePaymentActionCreateRequestSchema.properties
  },
  { additionalProperties: false }
)

export const McpPurchaseProvidePaymentRequestSchema = Type.Object(
  {
    actionToken: Type.String({ minLength: 32, maxLength: 40_000 }),
    ...PurchasePaymentActionResultRequestSchema.properties,
    agentContext: Type.Optional(AgentInvocationContextSchema)
  },
  { additionalProperties: false }
)

export const McpPurchaseGetRequestSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    agentContext: Type.Optional(AgentInvocationContextSchema)
  },
  { additionalProperties: false }
)

export const McpPurchaseCancelRequestSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    agentContext: Type.Optional(AgentInvocationContextSchema),
    idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 160 }))
  },
  { additionalProperties: false }
)

export const McpToolsCallRequestSchema = Type.Object(
  {
    jsonrpc: Type.Literal('2.0'),
    id: McpJsonRpcIdSchema,
    method: Type.Literal('tools/call'),
    params: McpToolsCallParamsSchema
  },
  { additionalProperties: false }
)

export const McpClientMessageSchema = Type.Union([
  McpInitializeRequestSchema,
  McpInitializedNotificationSchema,
  McpToolsListRequestSchema,
  McpToolsCallRequestSchema
])

export const McpToolDefinitionSchema = Type.Object(
  {
    name: McpToolNameSchema,
    description: Type.String({ minLength: 1 }),
    inputSchema: Type.Any(),
    outputSchema: Type.Optional(Type.Any())
  },
  { additionalProperties: false }
)

export const McpTextContentSchema = Type.Object(
  {
    type: Type.Literal('text'),
    text: Type.String()
  },
  { additionalProperties: false }
)

export const McpPresentationToneSchema = Type.Union([
  Type.Literal('neutral'),
  Type.Literal('info'),
  Type.Literal('success'),
  Type.Literal('warning'),
  Type.Literal('blocked')
])

export const McpPresentationFactSchema = Type.Object(
  {
    label: Type.String({ minLength: 1, maxLength: 80 }),
    value: Type.String({ minLength: 1, maxLength: 240 }),
    sourceId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 }))
  },
  { additionalProperties: false }
)

export const McpPresentationSourceLabelSchema = Type.Object(
  {
    sourceId: Type.String({ minLength: 1, maxLength: 160 }),
    sourceName: Type.String({ minLength: 1, maxLength: 160 }),
    factType: Type.String({ minLength: 1, maxLength: 120 }),
    freshnessClass: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    bindingStatus: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    fetchedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    expiresAt: Type.Optional(Type.String({ minLength: 1, maxLength: 80 }))
  },
  { additionalProperties: false }
)

export const McpPresentationActionSchema = Type.Object(
  {
    action: Type.String({ minLength: 1, maxLength: 80 }),
    label: Type.String({ minLength: 1, maxLength: 120 }),
    authority: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    url: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 }))
  },
  { additionalProperties: false }
)

export const McpPresentationSchema = Type.Object(
  {
    presentationVersion: Type.Literal('arro-mcp-presentation/v0.1'),
    surfaceHint: Type.Literal('commerce_card'),
    title: Type.String({ minLength: 1, maxLength: 180 }),
    subtitle: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    status: Type.String({ minLength: 1, maxLength: 80 }),
    tone: McpPresentationToneSchema,
    facts: Type.Array(McpPresentationFactSchema, { maxItems: 12 }),
    sourceLabels: Type.Array(McpPresentationSourceLabelSchema, { maxItems: 12 }),
    warnings: Type.Array(Type.String({ minLength: 1, maxLength: 240 }), { maxItems: 12 }),
    authorityLimits: Type.Array(Type.String({ minLength: 1, maxLength: 240 }), { maxItems: 8 }),
    allowedNextActions: Type.Array(McpPresentationActionSchema, { maxItems: 8 }),
    primaryAction: Type.Optional(McpPresentationActionSchema),
    receiptId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    checkoutState: Type.Optional(Type.String({ minLength: 1, maxLength: 120 }))
  },
  { additionalProperties: false }
)

export const McpToolStructuredContentSchema = Type.Object(
  {
    toolName: McpToolNameSchema,
    httpStatus: Type.Integer({ minimum: 100, maximum: 599 }),
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    presentation: McpPresentationSchema,
    response: Type.Any()
  },
  { additionalProperties: false }
)

export const McpPublicToolStructuredContentSchema = Type.Object(
  {
    toolName: McpPublicToolNameSchema,
    httpStatus: Type.Integer({ minimum: 100, maximum: 599 }),
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    presentation: McpPresentationSchema,
    response: Type.Any()
  },
  { additionalProperties: false }
)

export const McpToolCallResultSchema = Type.Object(
  {
    content: Type.Array(McpTextContentSchema, { minItems: 1, maxItems: 4 }),
    structuredContent: Type.Optional(McpToolStructuredContentSchema),
    isError: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
)

export const McpJsonRpcSuccessResponseSchema = Type.Object(
  {
    jsonrpc: Type.Literal('2.0'),
    id: McpJsonRpcIdSchema,
    result: Type.Any()
  },
  { additionalProperties: false }
)

export const McpJsonRpcErrorResponseSchema = Type.Object(
  {
    jsonrpc: Type.Literal('2.0'),
    id: Type.Optional(McpJsonRpcIdSchema),
    error: Type.Object(
      {
        code: Type.Integer(),
        message: Type.String({ minLength: 1 }),
        data: Type.Optional(Type.Any())
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
)

export const McpJsonRpcResponseSchema = Type.Union([
  McpJsonRpcSuccessResponseSchema,
  McpJsonRpcErrorResponseSchema
])

export const ArroMcpToolDefinitions = [
  {
    name: 'agent_diagnostics',
    description: 'Check whether an agent integration can call a requested Arro action and preserve required trust signals.',
    inputSchema: AgentDiagnosticsRequestSchema,
    outputSchema: McpPublicToolStructuredContentSchema
  },
  {
    name: 'search_products',
    description: 'Search source-governed products with source labels, caveats, and an allowed-next-action policy.',
    inputSchema: CatalogSearchRequestSchema,
    outputSchema: McpPublicToolStructuredContentSchema
  },
  {
    name: 'get_product_detail',
    description: 'Retrieve source-labeled product detail for a specific business/product/variant reference.',
    inputSchema: CatalogProductDetailRequestSchema,
    outputSchema: McpPublicToolStructuredContentSchema
  },
  {
    name: 'compare_products',
    description: 'Compare caller-supplied source-labeled products with source mode, caveats, and advisory next actions.',
    inputSchema: CatalogProductCompareRequestSchema,
    outputSchema: McpPublicToolStructuredContentSchema
  },
  {
    name: 'get_source_state',
    description: 'Inspect approved, connected, limited, or unavailable source state before relying on commerce facts.',
    inputSchema: CatalogSourceStateRequestSchema,
    outputSchema: McpPublicToolStructuredContentSchema
  },
  {
    name: 'sanity_check_product',
    description: 'Check submitted product evidence, visible claims, URLs, identifiers, or candidate sets without fetching unsupported pages.',
    inputSchema: CatalogProductSanityCheckRequestSchema,
    outputSchema: McpPublicToolStructuredContentSchema
  },
  {
    name: 'prepare_purchase',
    description: 'Resolve a merchant and prepare the strongest safe purchase path through Arro: direct UCP completion, merchant-hosted checkout, cart or product continuation.',
    inputSchema: McpPurchasePrepareRequestSchema,
    outputSchema: McpPublicToolStructuredContentSchema
  },
  {
    name: 'update_purchase',
    description: 'Update buyer, fulfillment, item, or checkout details for a prepared purchase and return a refreshed review.',
    inputSchema: McpPurchaseUpdateRequestSchema,
    outputSchema: McpPublicToolStructuredContentSchema
  },
  {
    name: 'prepare_payment',
    description: 'Intersect agent payment capabilities with the exact merchant Checkout and return one signed x402, MPP, or optional provider action.',
    inputSchema: McpPurchasePreparePaymentRequestSchema,
    outputSchema: McpPublicToolStructuredContentSchema
  },
  {
    name: 'provide_payment',
    description: 'Submit one protocol-native credential to its signed payment action. Arro vaults it for the current Checkout and never treats it as an Order.',
    inputSchema: McpPurchaseProvidePaymentRequestSchema,
    outputSchema: McpPublicToolStructuredContentSchema
  },
  {
    name: 'confirm_purchase',
    description: 'Apply exact human approval or delegated mandate authority and complete only when UCP payment, idempotency, and merchant gates pass.',
    inputSchema: McpPurchaseConfirmRequestSchema,
    outputSchema: McpPublicToolStructuredContentSchema
  },
  {
    name: 'get_purchase',
    description: 'Return the current merchant-authoritative purchase, checkout, order, fulfillment, and next-action state.',
    inputSchema: McpPurchaseGetRequestSchema,
    outputSchema: McpPublicToolStructuredContentSchema
  },
  {
    name: 'cancel_purchase',
    description: 'Cancel the prepared purchase through the strongest merchant-supported UCP operation without claiming refunds unless the merchant reports them.',
    inputSchema: McpPurchaseCancelRequestSchema,
    outputSchema: McpPublicToolStructuredContentSchema
  }
] as const satisfies readonly McpToolDefinition[]

export const ArroInternalMcpToolDefinitions = [
  ...ArroMcpToolDefinitions
] as const satisfies readonly McpToolDefinition[]

export type McpJsonRpcId = Static<typeof McpJsonRpcIdSchema>
export type McpToolName = Static<typeof McpToolNameSchema>
export type McpPublicToolName = Static<typeof McpPublicToolNameSchema>
export type McpInitializeRequest = Static<typeof McpInitializeRequestSchema>
export type McpInitializedNotification = Static<typeof McpInitializedNotificationSchema>
export type McpToolsListRequest = Static<typeof McpToolsListRequestSchema>
export type McpToolsCallParams = Static<typeof McpToolsCallParamsSchema>
export type McpToolsCallRequest = Static<typeof McpToolsCallRequestSchema>
export type McpClientMessage = Static<typeof McpClientMessageSchema>
export type McpToolDefinition = Static<typeof McpToolDefinitionSchema>
export type McpPresentation = Static<typeof McpPresentationSchema>
export type McpToolStructuredContent = Static<typeof McpToolStructuredContentSchema>
export type McpPublicToolStructuredContent = Static<typeof McpPublicToolStructuredContentSchema>
export type McpToolCallResult = Static<typeof McpToolCallResultSchema>
export type McpJsonRpcSuccessResponse = Static<typeof McpJsonRpcSuccessResponseSchema>
export type McpJsonRpcErrorResponse = Static<typeof McpJsonRpcErrorResponseSchema>
export type McpJsonRpcResponse = Static<typeof McpJsonRpcResponseSchema>
