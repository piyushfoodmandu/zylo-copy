import { Type, type Static } from '@sinclair/typebox'
import { IsoDateTimeSchema, PlainStatusMessageSchema } from './common.ts'

export const UcpAccessPolicyStateSchema = Type.Union([
  Type.Literal('unknown'),
  Type.Literal('profile_fetched'),
  Type.Literal('partner_required'),
  Type.Literal('approved'),
  Type.Literal('limited'),
  Type.Literal('rate_limited'),
  Type.Literal('denied'),
  Type.Literal('error')
])

export const UcpDiscoveryStatusSchema = Type.Union([
  Type.Literal('fetched'),
  Type.Literal('blocked'),
  Type.Literal('not_found'),
  Type.Literal('invalid_profile'),
  Type.Literal('error')
])

export const UcpDiscoveryRequestSchema = Type.Object(
  {
    domain: Type.String({
      minLength: 4,
      maxLength: 253,
      pattern: '^(?=.{4,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)+[a-zA-Z]{2,63}$'
    }),
    requestedCapabilities: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
        maxItems: 16
      })
    )
  },
  { additionalProperties: false }
)

export const UcpDiscoveryServiceSummarySchema = Type.Object(
  {
    namespace: Type.Optional(Type.String({ minLength: 1 })),
    id: Type.Optional(Type.String({ minLength: 1 })),
    transport: Type.String({ minLength: 1 }),
    url: Type.Optional(Type.String({ minLength: 1 })),
    capabilities: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export const UcpDiscoveryCacheSummarySchema = Type.Object(
  {
    cacheControl: Type.Optional(Type.String({ minLength: 1 })),
    maxAgeSeconds: Type.Optional(Type.Integer({ minimum: 0 })),
    internallyCappedMaxAgeSeconds: Type.Integer({ minimum: 0 })
  },
  { additionalProperties: false }
)

export const UcpDiscoveryDnsSummarySchema = Type.Object(
  {
    hostname: Type.String({ minLength: 1 }),
    checkedAddresses: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export const UcpDiscoveryEvidenceSchema = Type.Object(
  {
    httpsOnly: Type.Literal(true),
    redirectsAllowed: Type.Literal(false),
    privateNetworkBlocked: Type.Literal(true),
    contentType: Type.Optional(Type.String({ minLength: 1 })),
    responseBytes: Type.Optional(Type.Integer({ minimum: 0 })),
    latencyMs: Type.Optional(Type.Number({ minimum: 0 }))
  },
  { additionalProperties: false }
)

export const UcpDiscoveredProfileSummarySchema = Type.Object(
  {
    domain: Type.String({ minLength: 1 }),
    profileUrl: Type.String({ minLength: 1 }),
    profileHash: Type.String({ minLength: 1 }),
    profileShape: Type.Union([
      Type.Literal('canonical_ucp'),
      Type.Literal('root_profile')
    ]),
    protocolVersions: Type.Array(Type.String({ minLength: 1 })),
    supportedVersionUrls: Type.Array(Type.String({ minLength: 1 })),
    services: Type.Array(UcpDiscoveryServiceSummarySchema),
    capabilities: Type.Array(Type.String({ minLength: 1 })),
    paymentHandlers: Type.Array(Type.String({ minLength: 1 })),
    signingKeyCount: Type.Integer({ minimum: 0 }),
    cache: UcpDiscoveryCacheSummarySchema,
    dns: UcpDiscoveryDnsSummarySchema,
    validatedAt: IsoDateTimeSchema
  },
  { additionalProperties: false }
)

export const UcpDiscoveryResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    status: UcpDiscoveryStatusSchema,
    accessPolicyState: UcpAccessPolicyStateSchema,
    domain: Type.String({ minLength: 1 }),
    profileUrl: Type.String({ minLength: 1 }),
    httpStatus: Type.Optional(Type.Integer({ minimum: 100, maximum: 599 })),
    fetchedAt: IsoDateTimeSchema,
    evidence: UcpDiscoveryEvidenceSchema,
    profile: Type.Optional(UcpDiscoveredProfileSummarySchema),
    messages: Type.Array(PlainStatusMessageSchema)
  },
  { additionalProperties: false }
)

export const TargetBusinessSourceTypeSchema = Type.Union([
  Type.Literal('direct_ucp'),
  Type.Literal('managed_channel'),
  Type.Literal('approved_feed'),
  Type.Literal('unsupported')
])

export const TargetBusinessLaunchStatusSchema = Type.Union([
  Type.Literal('candidate'),
  Type.Literal('outreach'),
  Type.Literal('launch_visible'),
  Type.Literal('blocked')
])

export const TargetBusinessFeatureVisibilitySchema = Type.Union([
  Type.Literal('hidden'),
  Type.Literal('discovery_only'),
  Type.Literal('catalog_visible'),
  Type.Literal('checkout_visible')
])

export const TargetBusinessCapabilityStatusSchema = Type.Union([
  Type.Literal('unknown'),
  Type.Literal('not_supported'),
  Type.Literal('discovery_only'),
  Type.Literal('limited'),
  Type.Literal('approved'),
  Type.Literal('blocked')
])

export const TargetBusinessCapabilityRecordSchema = Type.Object(
  {
    capability: Type.String({ minLength: 1 }),
    status: TargetBusinessCapabilityStatusSchema,
    source: Type.String({ minLength: 1 }),
    notes: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export const TargetBusinessEvidenceSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal('arro_discovery'),
      Type.Literal('arro_conformance'),
      Type.Literal('public_readiness_snapshot'),
      Type.Literal('managed_channel_signal'),
      Type.Literal('manual_review')
    ]),
    source: Type.String({ minLength: 1 }),
    observedAt: IsoDateTimeSchema,
    expiresAt: Type.Optional(IsoDateTimeSchema),
    summary: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
)

export const TargetBusinessRecordSchema = Type.Object(
  {
    businessId: Type.String({ minLength: 1 }),
    domain: Type.String({ minLength: 1 }),
    displayName: Type.String({ minLength: 1 }),
    sourceType: TargetBusinessSourceTypeSchema,
    launchStatus: TargetBusinessLaunchStatusSchema,
    featureVisibility: TargetBusinessFeatureVisibilitySchema,
    accessPolicyState: UcpAccessPolicyStateSchema,
    profileUrl: Type.Optional(Type.String({ minLength: 1 })),
    profileHash: Type.Optional(Type.String({ minLength: 1 })),
    lastDiscoveredAt: Type.Optional(IsoDateTimeSchema),
    nextReviewAt: Type.Optional(IsoDateTimeSchema),
    capabilities: Type.Array(TargetBusinessCapabilityRecordSchema),
    evidence: Type.Array(TargetBusinessEvidenceSchema),
    userFacingStatus: Type.Object(
      {
        label: Type.String({ minLength: 1 }),
        reason: Type.String({ minLength: 1 }),
        nextAction: Type.String({ minLength: 1 })
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
)

export const TargetBusinessMatrixResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    generatedAt: IsoDateTimeSchema,
    records: Type.Array(TargetBusinessRecordSchema)
  },
  { additionalProperties: false }
)

export const TargetBusinessAdminTransitionReasonCodeSchema = Type.Union([
  Type.Literal('manual_review'),
  Type.Literal('policy_block'),
  Type.Literal('source_quality_issue'),
  Type.Literal('partner_required'),
  Type.Literal('unsupported_source'),
  Type.Literal('discovery_review'),
  Type.Literal('conformance_required'),
  Type.Literal('operational_risk')
])

export const TargetBusinessAdminFiltersSchema = Type.Object(
  {
    domain: Type.Optional(Type.String({ minLength: 1, maxLength: 253 })),
    launchStatus: Type.Optional(TargetBusinessLaunchStatusSchema),
    featureVisibility: Type.Optional(TargetBusinessFeatureVisibilitySchema),
    accessPolicyState: Type.Optional(UcpAccessPolicyStateSchema)
  },
  { additionalProperties: false }
)

export const TargetBusinessDiscoveryObservationSummarySchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    principalKeyId: Type.Optional(Type.String({ minLength: 1 })),
    ownerPrincipal: Type.Optional(Type.String({ minLength: 1 })),
    businessId: Type.Optional(Type.String({ minLength: 1 })),
    domain: Type.String({ minLength: 1 }),
    profileUrl: Type.String({ minLength: 1 }),
    discoveryStatus: UcpDiscoveryStatusSchema,
    accessPolicyState: UcpAccessPolicyStateSchema,
    profileHash: Type.Optional(Type.String({ minLength: 1 })),
    fetchedAt: IsoDateTimeSchema,
    createdAt: IsoDateTimeSchema,
    messages: Type.Array(PlainStatusMessageSchema)
  },
  { additionalProperties: false }
)

export const TargetBusinessStateTransitionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    businessId: Type.String({ minLength: 1 }),
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    principalKeyId: Type.Optional(Type.String({ minLength: 1 })),
    ownerPrincipal: Type.Optional(Type.String({ minLength: 1 })),
    previousLaunchStatus: TargetBusinessLaunchStatusSchema,
    nextLaunchStatus: TargetBusinessLaunchStatusSchema,
    previousFeatureVisibility: TargetBusinessFeatureVisibilitySchema,
    nextFeatureVisibility: TargetBusinessFeatureVisibilitySchema,
    previousAccessPolicyState: UcpAccessPolicyStateSchema,
    nextAccessPolicyState: UcpAccessPolicyStateSchema,
    reasonCode: TargetBusinessAdminTransitionReasonCodeSchema,
    reviewerNote: Type.Optional(Type.String({ minLength: 1 })),
    linkedDiscoveryObservationId: Type.Optional(Type.String({ minLength: 1 })),
    linkedConformanceRunId: Type.Optional(Type.String({ minLength: 1 })),
    overrideApplied: Type.Boolean(),
    metadata: Type.Record(Type.String({ minLength: 1 }), Type.Unknown()),
    createdAt: IsoDateTimeSchema
  },
  { additionalProperties: false }
)

export const TargetBusinessAdminListResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    generatedAt: IsoDateTimeSchema,
    filters: TargetBusinessAdminFiltersSchema,
    records: Type.Array(TargetBusinessRecordSchema),
    messages: Type.Array(PlainStatusMessageSchema)
  },
  { additionalProperties: false }
)

export const TargetBusinessAdminDetailResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    generatedAt: IsoDateTimeSchema,
    record: TargetBusinessRecordSchema,
    recentDiscoveryObservations: Type.Array(TargetBusinessDiscoveryObservationSummarySchema),
    transitions: Type.Array(TargetBusinessStateTransitionSchema),
    messages: Type.Array(PlainStatusMessageSchema)
  },
  { additionalProperties: false }
)

export const TargetBusinessAdminTransitionRequestSchema = Type.Object(
  {
    nextLaunchStatus: Type.Optional(TargetBusinessLaunchStatusSchema),
    nextFeatureVisibility: Type.Optional(TargetBusinessFeatureVisibilitySchema),
    nextAccessPolicyState: Type.Optional(UcpAccessPolicyStateSchema),
    reasonCode: TargetBusinessAdminTransitionReasonCodeSchema,
    reviewerNote: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    linkedDiscoveryObservationId: Type.Optional(Type.String({ minLength: 1, pattern: '^[0-9]+$' })),
    linkedConformanceRunId: Type.Optional(Type.String({ minLength: 1, pattern: '^[0-9]+$' })),
    metadata: Type.Optional(Type.Record(Type.String({ minLength: 1, maxLength: 80 }), Type.Unknown()))
  },
  { additionalProperties: false }
)

export const TargetBusinessConformanceRunModeSchema = Type.Union([
  Type.Literal('live'),
  Type.Literal('fixture')
])

export const TargetBusinessConformanceRunStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('passed'),
  Type.Literal('failed'),
  Type.Literal('error')
])

export const TargetBusinessConformanceCheckStatusSchema = Type.Union([
  Type.Literal('passed'),
  Type.Literal('failed'),
  Type.Literal('warning'),
  Type.Literal('skipped')
])

export const TargetBusinessConformanceFailureClassificationSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('business_not_found'),
  Type.Literal('discovery_missing'),
  Type.Literal('profile_missing'),
  Type.Literal('profile_hash_mismatch'),
  Type.Literal('capability_missing'),
  Type.Literal('service_insecure'),
  Type.Literal('freshness_invalid'),
  Type.Literal('fixture_mode_disabled'),
  Type.Literal('internal_error')
])

export const TargetBusinessConformanceCheckSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    status: TargetBusinessConformanceCheckStatusSchema,
    message: Type.String({ minLength: 1 }),
    evidence: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.Unknown()))
  },
  { additionalProperties: false }
)

export const TargetBusinessConformanceCapabilityCoverageSchema = Type.Object(
  {
    required: Type.Array(Type.String({ minLength: 1 })),
    declared: Type.Array(Type.String({ minLength: 1 })),
    missing: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export const TargetBusinessConformanceRunSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    businessId: Type.String({ minLength: 1 }),
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    principalKeyId: Type.Optional(Type.String({ minLength: 1 })),
    ownerPrincipal: Type.Optional(Type.String({ minLength: 1 })),
    linkedDiscoveryObservationId: Type.Optional(Type.String({ minLength: 1 })),
    runMode: TargetBusinessConformanceRunModeSchema,
    runStatus: TargetBusinessConformanceRunStatusSchema,
    profileHash: Type.Optional(Type.String({ minLength: 1 })),
    checksPassed: Type.Integer({ minimum: 0 }),
    checksFailed: Type.Integer({ minimum: 0 }),
    checkDetails: Type.Array(TargetBusinessConformanceCheckSchema),
    capabilityCoverage: TargetBusinessConformanceCapabilityCoverageSchema,
    failureClassification: TargetBusinessConformanceFailureClassificationSchema,
    startedAt: IsoDateTimeSchema,
    completedAt: Type.Optional(IsoDateTimeSchema),
    expiresAt: Type.Optional(IsoDateTimeSchema),
    reviewerSummary: Type.Optional(Type.String({ minLength: 1 })),
    metadata: Type.Record(Type.String({ minLength: 1 }), Type.Unknown()),
    createdAt: IsoDateTimeSchema
  },
  { additionalProperties: false }
)

export const TargetBusinessConformanceTriggerRequestSchema = Type.Object(
  {
    runMode: Type.Optional(TargetBusinessConformanceRunModeSchema),
    linkedDiscoveryObservationId: Type.Optional(Type.String({ minLength: 1, pattern: '^[0-9]+$' })),
    reviewerSummary: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    metadata: Type.Optional(Type.Record(Type.String({ minLength: 1, maxLength: 80 }), Type.Unknown()))
  },
  { additionalProperties: false }
)

export const TargetBusinessConformanceRunResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    generatedAt: IsoDateTimeSchema,
    run: TargetBusinessConformanceRunSchema,
    messages: Type.Array(PlainStatusMessageSchema)
  },
  { additionalProperties: false }
)

export const TargetBusinessConformanceListResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    generatedAt: IsoDateTimeSchema,
    businessId: Type.String({ minLength: 1 }),
    runs: Type.Array(TargetBusinessConformanceRunSchema),
    messages: Type.Array(PlainStatusMessageSchema)
  },
  { additionalProperties: false }
)

export const TargetBusinessAdminTransitionResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    generatedAt: IsoDateTimeSchema,
    record: TargetBusinessRecordSchema,
    transition: TargetBusinessStateTransitionSchema,
    messages: Type.Array(PlainStatusMessageSchema)
  },
  { additionalProperties: false }
)

export type UcpAccessPolicyState = Static<typeof UcpAccessPolicyStateSchema>
export type UcpDiscoveryRequest = Static<typeof UcpDiscoveryRequestSchema>
export type UcpDiscoveryResponse = Static<typeof UcpDiscoveryResponseSchema>
export type UcpDiscoveredProfileSummary = Static<typeof UcpDiscoveredProfileSummarySchema>
export type TargetBusinessRecord = Static<typeof TargetBusinessRecordSchema>
export type TargetBusinessMatrixResponse = Static<typeof TargetBusinessMatrixResponseSchema>
export type TargetBusinessAdminFilters = Static<typeof TargetBusinessAdminFiltersSchema>
export type TargetBusinessAdminListResponse = Static<typeof TargetBusinessAdminListResponseSchema>
export type TargetBusinessAdminDetailResponse = Static<typeof TargetBusinessAdminDetailResponseSchema>
export type TargetBusinessAdminTransitionRequest = Static<typeof TargetBusinessAdminTransitionRequestSchema>
export type TargetBusinessAdminTransitionResponse = Static<typeof TargetBusinessAdminTransitionResponseSchema>
export type TargetBusinessStateTransition = Static<typeof TargetBusinessStateTransitionSchema>
export type TargetBusinessConformanceRunMode = Static<typeof TargetBusinessConformanceRunModeSchema>
export type TargetBusinessConformanceRunStatus = Static<typeof TargetBusinessConformanceRunStatusSchema>
export type TargetBusinessConformanceFailureClassification = Static<typeof TargetBusinessConformanceFailureClassificationSchema>
export type TargetBusinessConformanceCheck = Static<typeof TargetBusinessConformanceCheckSchema>
export type TargetBusinessConformanceCapabilityCoverage = Static<typeof TargetBusinessConformanceCapabilityCoverageSchema>
export type TargetBusinessConformanceRun = Static<typeof TargetBusinessConformanceRunSchema>
export type TargetBusinessConformanceTriggerRequest = Static<typeof TargetBusinessConformanceTriggerRequestSchema>
export type TargetBusinessConformanceRunResponse = Static<typeof TargetBusinessConformanceRunResponseSchema>
export type TargetBusinessConformanceListResponse = Static<typeof TargetBusinessConformanceListResponseSchema>
