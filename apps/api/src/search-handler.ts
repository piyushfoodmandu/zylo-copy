import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  approvedCatalogSourcesForPolicy,
  buildCatalogSearchSourcePolicy,
  type CatalogSource,
  type CatalogProductFetcher
} from '@arro/connectors'
import {
  catalogSearchRequestForConnector,
  searchActionPolicy,
  searchCatalog
} from '@arro/product-intelligence'
import {
  CatalogSearchRequestSchema,
  type ApiError,
  type CatalogSearchResponse,
  type CatalogSearchRequest,
  type AgentInvocationContext,
  type TargetBusinessRecord
} from '@arro/contracts'
import {
  fetchConnectorCatalogProducts,
  type ConnectorCatalogFetchSummary
} from './connector-catalog-fetch.ts'
import {
  searchCommercialIsolationVersion,
  type SearchAuditRecorder,
  type SearchAuditRoute
} from './search-audit.ts'
import type { RequestTimeoutGuard } from './request-timeout.ts'
import {
  agentActionScopeError,
  agentHostCapabilityError,
  agentSessionExpiryError
} from './agent-invocation.ts'
import { agentSessionBindingError } from './agent-session.ts'
import {
  decodeCatalogContinuation,
  encodeCatalogContinuation,
  type CatalogContinuation
} from './catalog-pagination.ts'

const catalogSearchRequestValidator = TypeCompiler.Compile(
  CatalogSearchRequestSchema
)

type CreateSearchHandlerOptions = {
  loadTargetBusinessRecords: () => Promise<TargetBusinessRecord[]>
  catalogProductFetcher: CatalogProductFetcher
  connectedCatalogSources: CatalogSource[]
  connectorTimeoutMs: number
  connectorMaxSourcesPerRequest: number
  connectorMaxConcurrencyPerRequest: number
  connectorCoalescingWindowMs: number
  recordSearchAudit: SearchAuditRecorder
  agentSessionSigningSecret?: string | undefined
  apiError: (code: string, message: string, requestId: string) => ApiError
}

export type SearchHandlerOptions = {
  body: unknown
  requestId: string
  correlationId: string
  route: SearchAuditRoute
  set: { status?: number | string; headers?: Record<string, string | number> }
  requestTimeoutGuard: RequestTimeoutGuard
}

export type SearchHandler = (options: SearchHandlerOptions) => Promise<unknown>

const failedConnectorSourceCount = (summary: ConnectorCatalogFetchSummary) =>
  summary.timeoutSourceCount +
  summary.unavailableSourceCount +
  summary.invalidResponseSourceCount +
  summary.errorSourceCount

const connectorSourceState = (
  baseState: CatalogSearchResponse['state'],
  summary: ConnectorCatalogFetchSummary
): CatalogSearchResponse['state'] => {
  const incompleteSourceCount = failedConnectorSourceCount(summary) + summary.skippedSourceCount

  if (summary.requestedSourceCount > 0 && summary.fetchedSourceCount === 0 && incompleteSourceCount > 0) {
    return 'unavailable'
  }

  if (summary.fetchedSourceCount > 0 && incompleteSourceCount > 0) {
    return 'limited'
  }

  return baseState
}

const connectorBackedSourceModes = new Set<CatalogSearchResponse['sourceMode']>([
  'approved_sources',
  'connected_sources'
])

const isConnectorBackedSourceMode = (sourceMode: CatalogSearchResponse['sourceMode']) =>
  connectorBackedSourceModes.has(sourceMode)

const connectedSourcesForPolicy = ({
  sources,
  allowedBusinessIds
}: {
  sources: CatalogSource[]
  allowedBusinessIds: string[]
}) => {
  const allowed = new Set(allowedBusinessIds)
  return sources.filter((source) =>
    allowed.has(source.businessId) && source.sourceType !== 'unsupported'
  )
}

const agentInvocationAuditMetadata = (
  agentContext: AgentInvocationContext | undefined
) => {
  if (!agentContext) return undefined

  return {
    integrationId: agentContext.integrationId,
    surface: agentContext.surface,
    requestedActionScope: agentContext.requestedActionScope,
    hostCapabilities: agentContext.hostCapabilities ?? [],
    hasExternalSubjectRef: Boolean(agentContext.externalSubjectRef),
    hasExternalTaskRef: Boolean(agentContext.externalTaskRef),
    hasSessionToken: Boolean(agentContext.sessionToken),
    ...(agentContext.sessionExpiresAt
      ? { sessionExpiresAt: agentContext.sessionExpiresAt }
      : {})
  }
}

export const createSearchHandler = ({
  loadTargetBusinessRecords,
  catalogProductFetcher,
  connectedCatalogSources,
  connectorTimeoutMs,
  connectorMaxSourcesPerRequest,
  connectorMaxConcurrencyPerRequest,
  connectorCoalescingWindowMs,
  recordSearchAudit,
  agentSessionSigningSecret,
  apiError
}: CreateSearchHandlerOptions): SearchHandler => async ({
  body,
  requestId,
  correlationId,
  route,
  set,
  requestTimeoutGuard
}) => {
  const startedAt = Date.now()
  let recordsDurationMs = 0
  let connectorDurationMs = 0
  let rankingDurationMs = 0
  let auditDurationMs = 0
  let cacheLayer = 'not-used'

  const publishServerTiming = () => {
    const headers = set.headers ??= {}
    headers['server-timing'] = [
      `catalog;dur=${Math.max(Date.now() - startedAt, 0)}`,
      `records;dur=${recordsDurationMs}`,
      `connector;dur=${connectorDurationMs}`,
      `cache;desc="${cacheLayer}"`,
      `ranking;dur=${rankingDurationMs}`,
      `audit;dur=${auditDurationMs}`
    ].join(', ')
  }

  if (!catalogSearchRequestValidator.Check(body)) {
    set.status = 422
    return apiError(
      'validation_failed',
      'The request did not match the API contract.',
      requestId
    )
  }

  const requestBody = body as CatalogSearchRequest
  let continuation: CatalogContinuation | undefined
  if (requestBody.pagination?.cursor) {
    try {
      continuation = decodeCatalogContinuation(requestBody.pagination.cursor)
    } catch {
      set.status = 422
      return apiError(
        'catalog_pagination_cursor_invalid',
        'The catalog pagination cursor is invalid or no longer supported.',
        requestId
      )
    }
  }

  const connectorRequestPagination = requestBody.pagination?.limit
    ? { limit: requestBody.pagination.limit }
    : undefined
  const requestWithoutPagination: CatalogSearchRequest = { ...requestBody }
  delete requestWithoutPagination.pagination
  const connectorSearchRequest = catalogSearchRequestForConnector({
    ...requestWithoutPagination,
    ...(connectorRequestPagination ? { pagination: connectorRequestPagination } : {})
  })
  const scopeError = agentActionScopeError({
    agentContext: requestBody.agentContext,
    expectedScope: 'read:search',
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
    expectedScope: 'read:search',
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
    expectedScope: 'read:search',
    requestId,
    apiError
  })
  if (hostCapabilityError) {
    set.status = 403
    return hostCapabilityError
  }

  const recordsStartedAt = Date.now()
  const records = await loadTargetBusinessRecords()
  recordsDurationMs = Math.max(Date.now() - recordsStartedAt, 0)
  requestTimeoutGuard.throwIfTimedOut()

  const policyNow = new Date()
  const sourcePolicy = buildCatalogSearchSourcePolicy({
    records,
    connectedSources: connectedCatalogSources,
    now: policyNow
  })
  const eligibleCatalogFetchSources = sourcePolicy.sourceMode === 'approved_sources'
    ? approvedCatalogSourcesForPolicy({
        records,
        allowedBusinessIds: sourcePolicy.allowedBusinessIds,
        now: policyNow
      })
    : sourcePolicy.sourceMode === 'connected_sources'
      ? connectedSourcesForPolicy({
          sources: connectedCatalogSources,
          allowedBusinessIds: sourcePolicy.allowedBusinessIds
        })
      : []
  const catalogFetchSources = continuation
    ? eligibleCatalogFetchSources.filter((source) => source.businessId === continuation.sourceId)
    : eligibleCatalogFetchSources

  if (continuation && catalogFetchSources.length !== 1) {
    set.status = 422
    return apiError(
      'catalog_pagination_cursor_invalid',
      'The catalog pagination cursor does not match an available catalog source.',
      requestId
    )
  }

  const connectorStartedAt = Date.now()
  const connectorCatalogFetch = isConnectorBackedSourceMode(sourcePolicy.sourceMode)
    ? await fetchConnectorCatalogProducts({
        requestId,
        correlationId,
        searchRequest: connectorSearchRequest,
        sources: catalogFetchSources,
        fetcher: catalogProductFetcher,
        timeoutMs: connectorTimeoutMs,
        maxSourcesPerRequest: connectorMaxSourcesPerRequest,
        maxConcurrencyPerRequest: connectorMaxConcurrencyPerRequest,
        coalescingWindowMs: connectorCoalescingWindowMs,
        ...(continuation
          ? { sourceCursors: new Map([[continuation.sourceId, continuation.sourceCursor]]) }
          : {}),
        now: policyNow,
        signal: requestTimeoutGuard.signal
      })
    : undefined
  connectorDurationMs = Math.max(Date.now() - connectorStartedAt, 0)
  if (connectorCatalogFetch) {
    const successfulLayers = connectorCatalogFetch.fetchResults
      .filter((result) => result.status === 'fetched')
      .map((result) => result.cacheLayer ?? 'source')
    cacheLayer = successfulLayers.length === 0
      ? 'none'
      : new Set(successfulLayers).size === 1
        ? successfulLayers[0]!
        : 'mixed'
  }
  requestTimeoutGuard.throwIfTimedOut()

  const rankingStartedAt = Date.now()
  const searchOptions = {
    requestId,
    correlationId,
    sourcePolicy,
    now: policyNow,
    ...(isConnectorBackedSourceMode(sourcePolicy.sourceMode)
      ? { products: connectorCatalogFetch?.products ?? [] }
      : {})
  }
  const searchResponseBody = searchCatalog(requestBody, searchOptions)
  rankingDurationMs = Math.max(Date.now() - rankingStartedAt, 0)

  requestTimeoutGuard.throwIfTimedOut()
  const responseState = connectorCatalogFetch
    ? connectorSourceState(searchResponseBody.state, connectorCatalogFetch.summary)
    : searchResponseBody.state
  const singleSourceFetchResult = connectorCatalogFetch &&
    connectorCatalogFetch.summary.requestedSourceCount === 1 &&
    connectorCatalogFetch.summary.dispatchedSourceCount === 1
    ? connectorCatalogFetch.fetchResults.find((fetchResult) => fetchResult.status === 'fetched')
    : undefined
  const singleSourcePagination = singleSourceFetchResult?.pagination
  const nextCursor = singleSourceFetchResult?.pagination?.hasNextPage && singleSourceFetchResult.pagination.cursor
    ? encodeCatalogContinuation({
        sourceId: singleSourceFetchResult.sourceId,
        sourceCursor: singleSourceFetchResult.pagination.cursor
      })
    : undefined
  const responseBody = connectorCatalogFetch
    ? {
        ...searchResponseBody,
        state: responseState,
        ...(singleSourcePagination
          ? {
              pageInfo: {
                hasNextPage: Boolean(nextCursor),
                ...(nextCursor ? { nextCursor } : {})
              }
            }
          : {}),
        actionPolicy: searchActionPolicy(responseState, searchResponseBody.items.length),
        ...(connectorCatalogFetch.messages.length > 0
          ? {
              messages: [
                ...searchResponseBody.messages,
                ...connectorCatalogFetch.messages
              ]
            }
          : {})
      }
    : searchResponseBody

  requestTimeoutGuard.throwIfTimedOut()

  const auditStartedAt = Date.now()
  const auditResult = await recordSearchAudit({
    requestId,
    correlationId,
    route,
    normalizedQuery: responseBody.interpretedQuery.normalized,
    sourcePolicy,
    response: responseBody,
    latencyMs: Date.now() - startedAt,
    metadata: {
      sourcePolicyAllowedBusinessCount: sourcePolicy.allowedBusinessIds.length,
      sourcePolicyMessageCode: sourcePolicy.message.code,
      commercialIsolationVersion: searchCommercialIsolationVersion,
      hasStructuredSearchIntent: Boolean(requestBody.intent),
      structuredSearchIntentKeys: requestBody.intent
        ? Object.keys(requestBody.intent).sort()
        : [],
      connectorSearchIntentKeys: connectorSearchRequest.intent
        ? Object.keys(connectorSearchRequest.intent).sort()
        : [],
      ...(requestBody.agentContext
        ? {
            agentInvocation: agentInvocationAuditMetadata(requestBody.agentContext)
          }
        : {}),
      ...(connectorCatalogFetch
        ? {
            connectorCatalogFetch: {
              summary: connectorCatalogFetch.summary,
              fetchResults: connectorCatalogFetch.fetchResults.map((fetchResult) => ({
                sourceId: fetchResult.sourceId,
                status: fetchResult.status,
                latencyMs: fetchResult.latencyMs,
                ...(fetchResult.validationErrorCode
                  ? { validationErrorCode: fetchResult.validationErrorCode }
                  : {})
              })),
              ...(responseBody.pageInfo
                ? { hasNextPage: responseBody.pageInfo.hasNextPage }
                : {})
            }
          }
        : {})
    }
  })
  auditDurationMs = Math.max(Date.now() - auditStartedAt, 0)
  publishServerTiming()
  requestTimeoutGuard.throwIfTimedOut()

  if (!auditResult.recorded && isConnectorBackedSourceMode(responseBody.sourceMode)) {
    set.status = 503
    return apiError(
      'search_audit_unavailable',
      'Connector-backed search is unavailable because search audit persistence is not available.',
      requestId
    )
  }

  return responseBody
}
