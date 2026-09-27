import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  buildCatalogSearchSourcePolicy,
  type CatalogSource
} from '@arro/connectors'
import {
  CatalogSourceStateRequestSchema,
  type AgentActionPolicy,
  type ApiError,
  type CatalogSourceState,
  type CatalogSourceStateRequest,
  type CatalogSourceStateResponse,
  type CatalogSourceStateSummary,
  type PlainStatusMessage,
  type SearchSourceMode,
  type TargetBusinessRecord
} from '@arro/contracts'
import {
  agentActionScopeError,
  agentHostCapabilityError,
  agentSessionExpiryError
} from './agent-invocation.ts'
import { agentSessionBindingError } from './agent-session.ts'
import type { RequestTimeoutGuard } from './request-timeout.ts'

const sourceStateRequestValidator = TypeCompiler.Compile(
  CatalogSourceStateRequestSchema
)

type CreateSourceStateHandlerOptions = {
  loadTargetBusinessRecords: () => Promise<TargetBusinessRecord[]>
  connectedCatalogSources: CatalogSource[]
  agentSessionSigningSecret?: string | undefined
  apiError: (code: string, message: string, requestId: string) => ApiError
}

export type SourceStateHandlerOptions = {
  body: unknown
  requestId: string
  correlationId: string
  set: { status?: number | string }
  requestTimeoutGuard: RequestTimeoutGuard
}

export type SourceStateHandler = (
  options: SourceStateHandlerOptions
) => Promise<unknown>

const catalogSearch = 'dev.ucp.shopping.catalog.search'

const message = (
  severity: PlainStatusMessage['severity'],
  code: string,
  text: string,
  nextAction?: string
): PlainStatusMessage => ({
  severity,
  code,
  text,
  ...(nextAction ? { nextAction } : {})
})

const normalizeDomain = (value: string | undefined) =>
  value?.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]

const isFutureIsoDate = (value: string | undefined, now: Date) => {
  if (!value) return false

  const date = new Date(value)
  return Number.isFinite(date.getTime()) && date.getTime() > now.getTime()
}

const hasCurrentConformanceEvidence = (
  record: TargetBusinessRecord,
  now: Date
) =>
  record.evidence.some(
    (evidence) =>
      evidence.kind === 'arro_conformance' &&
      isFutureIsoDate(evidence.expiresAt, now)
  )

const lastObservedAt = (record: TargetBusinessRecord) => {
  const dates = [
    record.lastDiscoveredAt,
    ...record.evidence.map((evidence) => evidence.observedAt)
  ].filter((date): date is string => Boolean(date))

  return dates.sort().at(-1)
}

const hasApprovedCatalogCapability = (record: TargetBusinessRecord) =>
  record.capabilities.some((capability) =>
    capability.capability === catalogSearch && capability.status === 'approved'
  )

const isApprovedCatalogSource = (record: TargetBusinessRecord, now: Date) =>
  record.featureVisibility === 'catalog_visible' &&
  record.launchStatus === 'launch_visible' &&
  record.accessPolicyState === 'approved' &&
  hasCurrentConformanceEvidence(record, now) &&
  hasApprovedCatalogCapability(record)

const connectedSourceMatchesRecord = (
  source: CatalogSource,
  record: TargetBusinessRecord
) =>
  source.businessId === record.businessId ||
  normalizeDomain(source.domain) === normalizeDomain(record.domain)

const requestMatchesRecord = (
  request: CatalogSourceStateRequest,
  record: TargetBusinessRecord
) => {
  if (request.businessId && request.businessId !== record.businessId) return false

  const requestedDomain = normalizeDomain(request.domain)
  if (requestedDomain && requestedDomain !== normalizeDomain(record.domain)) return false

  return true
}

const requestMatchesConnectedSource = (
  request: CatalogSourceStateRequest,
  source: CatalogSource
) => {
  if (request.businessId && request.businessId !== source.businessId) return false

  const requestedDomain = normalizeDomain(request.domain)
  if (requestedDomain && requestedDomain !== normalizeDomain(source.domain)) return false

  return true
}

const recordSourceState = ({
  record,
  connectedSources,
  now
}: {
  record: TargetBusinessRecord
  connectedSources: CatalogSource[]
  now: Date
}): { state: CatalogSourceState; sourceMode: SearchSourceMode } => {
  if (isApprovedCatalogSource(record, now)) {
    return {
      state: 'ready',
      sourceMode: 'approved_sources'
    }
  }

  if (connectedSources.some((source) => connectedSourceMatchesRecord(source, record))) {
    return {
      state: 'ready',
      sourceMode: 'connected_sources'
    }
  }

  if (
    record.sourceType === 'unsupported' ||
    record.launchStatus === 'blocked' ||
    record.accessPolicyState === 'denied' ||
    record.accessPolicyState === 'error'
  ) {
    return {
      state: 'unavailable',
      sourceMode: 'unconfigured'
    }
  }

  return {
    state: 'limited',
    sourceMode: 'unconfigured'
  }
}

const recordMessage = (
  record: TargetBusinessRecord,
  state: CatalogSourceState
): PlainStatusMessage => {
  if (state === 'ready') {
    return message(
      'info',
      'source_state_ready',
      record.userFacingStatus.reason,
      record.userFacingStatus.nextAction
    )
  }

  if (state === 'limited') {
    return message(
      'warning',
      'source_state_limited',
      record.userFacingStatus.reason,
      record.userFacingStatus.nextAction
    )
  }

  return message(
    'warning',
    'source_state_unavailable',
    record.userFacingStatus.reason,
    record.userFacingStatus.nextAction
  )
}

const summaryForRecord = ({
  record,
  connectedSources,
  now
}: {
  record: TargetBusinessRecord
  connectedSources: CatalogSource[]
  now: Date
}): CatalogSourceStateSummary => {
  const { state, sourceMode } = recordSourceState({ record, connectedSources, now })
  const observedAt = lastObservedAt(record)

  return {
    businessId: record.businessId,
    businessName: record.displayName,
    domain: record.domain,
    sourceType: record.sourceType,
    sourceMode,
    state,
    launchStatus: record.launchStatus,
    featureVisibility: record.featureVisibility,
    accessPolicyState: record.accessPolicyState,
    ...(record.profileUrl ? { profileUrl: record.profileUrl } : {}),
    ...(record.profileHash ? { profileHash: record.profileHash } : {}),
    capabilities: record.capabilities.map((capability) => ({
      capability: capability.capability,
      status: capability.status
    })),
    freshness: {
      ...(observedAt ? { lastObservedAt: observedAt } : {}),
      ...(record.nextReviewAt ? { nextReviewAt: record.nextReviewAt } : {}),
      hasCurrentConformanceEvidence: hasCurrentConformanceEvidence(record, now)
    },
    messages: [recordMessage(record, state)]
  }
}

const summaryForConnectedSource = (
  source: CatalogSource
): CatalogSourceStateSummary => ({
  businessId: source.businessId,
  businessName: source.displayName,
  domain: source.domain,
  sourceType: source.sourceType,
  sourceMode: 'connected_sources',
  state: source.sourceType === 'unsupported' ? 'unavailable' : 'ready',
  ...(source.profileUrl ? { profileUrl: source.profileUrl } : {}),
  ...(source.profileHash ? { profileHash: source.profileHash } : {}),
  capabilities: [],
  freshness: {
    hasCurrentConformanceEvidence: false
  },
  messages: [
    source.sourceType === 'unsupported'
      ? message(
          'warning',
          'source_state_connected_unavailable',
          'The configured source is marked unsupported.',
          'Remove unsupported connector descriptors or replace them with official source capability.'
        )
      : message(
          'info',
          'source_state_connected_ready',
          'A configured official catalog connector can answer read-first product requests.',
          'Keep connector credentials, source labels, and response validation healthy before expanding traffic.'
        )
  ]
})

const dedupeSources = (sources: CatalogSourceStateSummary[]) => {
  const seen = new Set<string>()
  const deduped: CatalogSourceStateSummary[] = []

  for (const source of sources) {
    const key = `${source.businessId}:${normalizeDomain(source.domain)}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(source)
  }

  return deduped
}

const selectSourceSummaries = ({
  request,
  records,
  connectedSources,
  now
}: {
  request: CatalogSourceStateRequest
  records: TargetBusinessRecord[]
  connectedSources: CatalogSource[]
  now: Date
}) => {
  const hasFilter = Boolean(request.businessId || request.domain)
  const recordSummaries = records
    .filter((record) => hasFilter
      ? requestMatchesRecord(request, record)
      : isApprovedCatalogSource(record, now)
    )
    .map((record) => summaryForRecord({ record, connectedSources, now }))

  const connectedSummaries = connectedSources
    .filter((source) => source.sourceType !== 'unsupported')
    .filter((source) => hasFilter
      ? requestMatchesConnectedSource(request, source)
      : true
    )
    .filter((source) => !recordSummaries.some((summary) =>
      summary.businessId === source.businessId ||
      normalizeDomain(summary.domain) === normalizeDomain(source.domain)
    ))
    .map(summaryForConnectedSource)

  return dedupeSources([...recordSummaries, ...connectedSummaries]).slice(0, 20)
}

const responseState = (sources: CatalogSourceStateSummary[]): CatalogSourceState => {
  if (sources.some((source) => source.state === 'ready')) return 'ready'
  if (sources.some((source) => source.state === 'limited')) return 'limited'
  return 'unavailable'
}

const responseSourceMode = (
  sources: CatalogSourceStateSummary[],
  fallback: SearchSourceMode
): SearchSourceMode => {
  if (sources.some((source) => source.sourceMode === 'approved_sources')) {
    return 'approved_sources'
  }

  if (sources.some((source) => source.sourceMode === 'connected_sources')) {
    return 'connected_sources'
  }

  return fallback
}

const sourceStateActionPolicy = (
  state: CatalogSourceState
): AgentActionPolicy => {
  if (state === 'ready') {
    return {
      state: 'read',
      allowedNextActions: [
        {
          action: 'search_products',
          label: 'Search this supported source set',
          authority: 'limited',
          requiredActionScope: 'read:search',
          reason: 'Source state is ready for read-first catalog requests, but product facts must still come from search or detail responses.'
        },
        {
          action: 'get_product_detail',
          label: 'Inspect source-backed product detail',
          authority: 'limited',
          requiredActionScope: 'read:product_detail',
          reason: 'Product detail must be revalidated before cart or checkout-adjacent work.'
        }
      ]
    }
  }

  if (state === 'limited') {
    return {
      state: 'limited',
      allowedNextActions: [
        {
          action: 'search_products',
          label: 'Try supported search if available',
          authority: 'limited',
          requiredActionScope: 'read:search',
          reason: 'Some source evidence exists, but the source is not fully approved for broad catalog authority.'
        },
        {
          action: 'wait',
          label: 'Wait for source readiness',
          authority: 'allowed',
          reason: 'The safer path is to wait for approval, current conformance, or configured official connector readiness.'
        }
      ]
    }
  }

  return {
    state: 'unavailable',
    allowedNextActions: [
      {
        action: 'search_products',
        label: 'Search other supported sources',
        authority: 'limited',
        requiredActionScope: 'read:search',
        reason: 'The requested source is not ready for source-backed commerce answers.'
      },
      {
        action: 'wait',
        label: 'Wait for source readiness',
        authority: 'allowed',
        reason: 'Unsupported or unconfigured sources cannot create product, cart, checkout, or payment authority.'
      }
    ]
  }
}

const responseMessages = ({
  sources,
  sourceMode,
  state,
  requestedSpecificSource
}: {
  sources: CatalogSourceStateSummary[]
  sourceMode: SearchSourceMode
  state: CatalogSourceState
  requestedSpecificSource: boolean
}) => {
  if (sources.length === 0) {
    return [
      message(
        'info',
        'source_state_no_source',
        requestedSpecificSource
          ? 'No configured or tracked source matched the requested business or domain.'
          : 'No approved or connected source is ready for read-first catalog requests.',
        'Use supported alternatives or connect an official source before asking agents to rely on it.'
      )
    ]
  }

  return [
    message(
      state === 'ready' ? 'info' : 'warning',
      state === 'ready' ? 'source_state_sources_ready' : 'source_state_sources_limited',
      `Arro found ${sources.length} source state entr${sources.length === 1 ? 'y' : 'ies'} in ${sourceMode}.`,
      'Preserve source state, freshness, caveats, and allowed next actions when rendering this result.'
    )
  ]
}

export const createSourceStateHandler = ({
  loadTargetBusinessRecords,
  connectedCatalogSources,
  agentSessionSigningSecret,
  apiError
}: CreateSourceStateHandlerOptions): SourceStateHandler => async ({
  body,
  requestId,
  correlationId,
  set,
  requestTimeoutGuard
}) => {
  if (!sourceStateRequestValidator.Check(body)) {
    set.status = 422
    return apiError(
      'validation_failed',
      'The request did not match the API contract.',
      requestId
    )
  }

  const requestBody = body as CatalogSourceStateRequest
  const scopeError = agentActionScopeError({
    agentContext: requestBody.agentContext,
    expectedScope: 'read:source_state',
    requestId,
    apiError
  })
  if (scopeError) {
    set.status = 403
    return scopeError
  }

  const sessionExpiryError = agentSessionExpiryError({
    agentContext: requestBody.agentContext,
    requestId,
    apiError
  })
  if (sessionExpiryError) {
    set.status = 403
    return sessionExpiryError
  }

  const sessionBindingError = agentSessionBindingError({
    agentContext: requestBody.agentContext,
    expectedScope: 'read:source_state',
    signingSecret: agentSessionSigningSecret,
    requestId,
    apiError
  })
  if (sessionBindingError) {
    set.status = sessionBindingError.status
    return sessionBindingError.body
  }

  const hostCapabilityError = agentHostCapabilityError({
    agentContext: requestBody.agentContext,
    expectedScope: 'read:source_state',
    requestId,
    apiError
  })
  if (hostCapabilityError) {
    set.status = 403
    return hostCapabilityError
  }

  const now = new Date()
  const records = await loadTargetBusinessRecords()
  requestTimeoutGuard.throwIfTimedOut()

  const sourcePolicy = buildCatalogSearchSourcePolicy({
    records,
    connectedSources: connectedCatalogSources,
    now
  })
  const sources = selectSourceSummaries({
    request: requestBody,
    records,
    connectedSources: connectedCatalogSources,
    now
  })
  const state = responseState(sources)
  const sourceMode = responseSourceMode(sources, sourcePolicy.sourceMode)

  return {
    requestId,
    correlationId,
    sourceMode,
    state,
    sources,
    messages: responseMessages({
      sources,
      sourceMode,
      state,
      requestedSpecificSource: Boolean(requestBody.businessId || requestBody.domain)
    }),
    actionPolicy: sourceStateActionPolicy(state),
    fetchedAt: now.toISOString()
  } satisfies CatalogSourceStateResponse
}
