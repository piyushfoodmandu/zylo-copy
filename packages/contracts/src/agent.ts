import { Type, type Static } from '@sinclair/typebox'
import { IsoDateTimeSchema, PlainStatusMessageSchema } from './common.ts'

export const AgentSurfaceSchema = Type.Union([
  Type.Literal('chatgpt'),
  Type.Literal('claude'),
  Type.Literal('hermes_agent'),
  Type.Literal('generic_mcp'),
  Type.Literal('direct_http'),
  Type.Literal('managed_channel'),
  Type.Literal('internal')
])

export const AgentActionScopeSchema = Type.Union([
  Type.Literal('read:search'),
  Type.Literal('read:product_detail'),
  Type.Literal('read:compare'),
  Type.Literal('read:source_state'),
  Type.Literal('read:sanity_check'),
  Type.Literal('read:checkout'),
  Type.Literal('read:order'),
  Type.Literal('read:purchase'),
  Type.Literal('write:memory'),
  Type.Literal('write:purchase'),
  Type.Literal('write:complete_purchase')
])

export const AgentTrustSignalCapabilitySchema = Type.Union([
  Type.Literal('source_labels'),
  Type.Literal('freshness'),
  Type.Literal('caveats'),
  Type.Literal('no_buy_warnings'),
  Type.Literal('commercial_disclosures'),
  Type.Literal('authority_limits'),
  Type.Literal('allowed_next_actions'),
  Type.Literal('user_confirmation'),
  Type.Literal('purchase_state')
])

export const AgentActionPolicyStateSchema = Type.Union([
  Type.Literal('read'),
  Type.Literal('compare'),
  Type.Literal('limited'),
  Type.Literal('denied'),
  Type.Literal('blocked'),
  Type.Literal('unavailable'),
  Type.Literal('stale'),
  Type.Literal('safer_next_action'),
  Type.Literal('checkout_continuation'),
  Type.Literal('gated_complete_checkout'),
  Type.Literal('purchase_prepared'),
  Type.Literal('merchant_continuation'),
  Type.Literal('purchase_confirmation')
])

export const AgentNextActionKindSchema = Type.Union([
  Type.Literal('search_products'),
  Type.Literal('get_product_detail'),
  Type.Literal('compare_products'),
  Type.Literal('prepare_purchase'),
  Type.Literal('update_purchase'),
  Type.Literal('confirm_purchase'),
  Type.Literal('get_purchase'),
  Type.Literal('cancel_purchase'),
  Type.Literal('continue_checkout'),
  Type.Literal('wait'),
  Type.Literal('stop')
])

export const AgentNextActionAuthoritySchema = Type.Union([
  Type.Literal('allowed'),
  Type.Literal('limited'),
  Type.Literal('requires_confirmation'),
  Type.Literal('requires_source_capability')
])

export const AgentAllowedNextActionSchema = Type.Object(
  {
    action: AgentNextActionKindSchema,
    label: Type.String({ minLength: 1, maxLength: 120 }),
    authority: AgentNextActionAuthoritySchema,
    reason: Type.String({ minLength: 1, maxLength: 360 }),
    requiredActionScope: Type.Optional(AgentActionScopeSchema)
  },
  { additionalProperties: false }
)

export const AgentActionPolicySchema = Type.Object(
  {
    state: AgentActionPolicyStateSchema,
    allowedNextActions: Type.Array(AgentAllowedNextActionSchema, {
      minItems: 1,
      maxItems: 8
    })
  },
  { additionalProperties: false }
)

export const AgentIntegrationIdSchema = Type.String({
  minLength: 1,
  maxLength: 96,
  pattern: '^[A-Za-z0-9._:-]+$'
})

export const AgentExternalSubjectRefSchema = Type.String({
  minLength: 1,
  maxLength: 160
})

export const AgentExternalTaskRefSchema = Type.String({
  minLength: 1,
  maxLength: 160
})

export const AgentSessionTokenSchema = Type.String({
  minLength: 96,
  maxLength: 4096,
  pattern: '^arro_session_v1\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$'
})

export const AgentInvocationContextSchema = Type.Object(
  {
    integrationId: AgentIntegrationIdSchema,
    surface: AgentSurfaceSchema,
    requestedActionScope: AgentActionScopeSchema,
    externalSubjectRef: Type.Optional(AgentExternalSubjectRefSchema),
    externalTaskRef: Type.Optional(AgentExternalTaskRefSchema),
    sessionExpiresAt: Type.Optional(IsoDateTimeSchema),
    sessionToken: Type.Optional(AgentSessionTokenSchema),
    hostCapabilities: Type.Optional(
      Type.Array(AgentTrustSignalCapabilitySchema, {
        minItems: 1,
        maxItems: 16,
        uniqueItems: true
      })
    )
  },
  { additionalProperties: false }
)

export const AgentSessionIssueRequestSchema = Type.Object(
  {
    integrationId: AgentIntegrationIdSchema,
    surface: AgentSurfaceSchema,
    allowedActionScopes: Type.Array(AgentActionScopeSchema, {
      minItems: 1,
      maxItems: 10,
      uniqueItems: true
    }),
    externalSubjectRef: Type.Optional(AgentExternalSubjectRefSchema),
    externalTaskRef: Type.Optional(AgentExternalTaskRefSchema),
    sessionExpiresAt: IsoDateTimeSchema,
    hostCapabilities: Type.Array(AgentTrustSignalCapabilitySchema, {
      minItems: 1,
      maxItems: 16,
      uniqueItems: true
    })
  },
  { additionalProperties: false }
)

export const AgentSessionIssueResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    session: Type.Object(
      {
        sessionId: Type.String({ minLength: 1, maxLength: 160 }),
        sessionToken: AgentSessionTokenSchema,
        integrationId: AgentIntegrationIdSchema,
        surface: AgentSurfaceSchema,
        allowedActionScopes: Type.Array(AgentActionScopeSchema, {
          minItems: 1,
          maxItems: 10,
          uniqueItems: true
        }),
        sessionExpiresAt: IsoDateTimeSchema,
        hostCapabilities: Type.Array(AgentTrustSignalCapabilitySchema, {
          minItems: 1,
          maxItems: 16,
          uniqueItems: true
        }),
        hasExternalSubjectRef: Type.Boolean(),
        hasExternalTaskRef: Type.Boolean()
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
)

export const AgentDiagnosticsRequestSchema = Type.Object(
  {
    agentContext: AgentInvocationContextSchema,
    expectedActionScope: AgentActionScopeSchema,
    renderedTrustSignals: Type.Optional(
      Type.Array(AgentTrustSignalCapabilitySchema, {
        minItems: 1,
        maxItems: 16,
        uniqueItems: true
      })
    )
  },
  { additionalProperties: false }
)

export const AgentDiagnosticsResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    state: Type.Union([
      Type.Literal('ready'),
      Type.Literal('blocked')
    ]),
    integrationId: AgentIntegrationIdSchema,
    surface: AgentSurfaceSchema,
    expectedActionScope: AgentActionScopeSchema,
    requestedActionScope: AgentActionScopeSchema,
    missingHostCapabilities: Type.Array(AgentTrustSignalCapabilitySchema, {
      maxItems: 16,
      uniqueItems: true
    }),
    missingRenderedTrustSignals: Type.Array(AgentTrustSignalCapabilitySchema, {
      maxItems: 16,
      uniqueItems: true
    }),
    hasExternalSubjectRef: Type.Boolean(),
    hasExternalTaskRef: Type.Boolean(),
    hasSessionToken: Type.Boolean(),
    renderingEvidenceState: Type.Union([
      Type.Literal('not_supplied'),
      Type.Literal('ready'),
      Type.Literal('blocked')
    ]),
    sessionBindingState: Type.Union([
      Type.Literal('not_supplied'),
      Type.Literal('valid'),
      Type.Literal('invalid'),
      Type.Literal('unavailable')
    ]),
    checks: Type.Array(PlainStatusMessageSchema, {
      minItems: 1,
      maxItems: 8
    })
  },
  { additionalProperties: false }
)

export type AgentSurface = Static<typeof AgentSurfaceSchema>
export type AgentActionScope = Static<typeof AgentActionScopeSchema>
export type AgentTrustSignalCapability = Static<typeof AgentTrustSignalCapabilitySchema>
export type AgentActionPolicyState = Static<typeof AgentActionPolicyStateSchema>
export type AgentNextActionKind = Static<typeof AgentNextActionKindSchema>
export type AgentNextActionAuthority = Static<typeof AgentNextActionAuthoritySchema>
export type AgentAllowedNextAction = Static<typeof AgentAllowedNextActionSchema>
export type AgentActionPolicy = Static<typeof AgentActionPolicySchema>
export type AgentIntegrationId = Static<typeof AgentIntegrationIdSchema>
export type AgentExternalSubjectRef = Static<typeof AgentExternalSubjectRefSchema>
export type AgentExternalTaskRef = Static<typeof AgentExternalTaskRefSchema>
export type AgentSessionToken = Static<typeof AgentSessionTokenSchema>
export type AgentInvocationContext = Static<typeof AgentInvocationContextSchema>
export type AgentSessionIssueRequest = Static<typeof AgentSessionIssueRequestSchema>
export type AgentSessionIssueResponse = Static<typeof AgentSessionIssueResponseSchema>
export type AgentDiagnosticsRequest = Static<typeof AgentDiagnosticsRequestSchema>
export type AgentDiagnosticsResponse = Static<typeof AgentDiagnosticsResponseSchema>
