import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  approvedCatalogSourcesForPolicy,
  buildCatalogSearchSourcePolicy,
  type CatalogSource,
  type CatalogProductDetailFetcher
} from '@arro/connectors'
import {
  CatalogProductDetailRequestSchema,
  type ApiError,
  type AgentActionPolicy,
  type CatalogProductDetailRequest,
  type CatalogProductDetailResponse,
  type TargetBusinessRecord
} from '@arro/contracts'
import { assessProductDetailQuality } from '@arro/product-intelligence'
import type { RequestTimeoutGuard } from './request-timeout.ts'
import {
  agentActionScopeError,
  agentHostCapabilityError,
  agentSessionExpiryError
} from './agent-invocation.ts'
import { agentSessionBindingError } from './agent-session.ts'
import {
  productDetailCommercialIsolationVersion,
  type ProductDetailAuditRecorder,
  type ProductDetailAuditRoute
} from './product-detail-audit.ts'

const catalogProductDetailRequestValidator = TypeCompiler.Compile(
  CatalogProductDetailRequestSchema
)

type CreateProductDetailHandlerOptions = {
  loadTargetBusinessRecords: () => Promise<TargetBusinessRecord[]>
  catalogProductDetailFetcher: CatalogProductDetailFetcher
  connectedCatalogSources: CatalogSource[]
  connectorTimeoutMs: number
  recordProductDetailAudit: ProductDetailAuditRecorder
  agentSessionSigningSecret?: string | undefined
  apiError: (code: string, message: string, requestId: string) => ApiError
}

export type ProductDetailHandlerOptions = {
  body: unknown
  requestId: string
  correlationId: string
  route: ProductDetailAuditRoute
  set: { status?: number | string }
  requestTimeoutGuard: RequestTimeoutGuard
}

export type ProductDetailHandler = (options: ProductDetailHandlerOptions) => Promise<unknown>

const connectorBackedSourceModes = new Set<CatalogProductDetailResponse['sourceMode']>([
  'approved_sources',
  'connected_sources'
])

const isConnectorBackedSourceMode = (sourceMode: CatalogProductDetailResponse['sourceMode']) =>
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

const unavailableResponse = ({
  requestId,
  correlationId,
  sourceMode,
  messages,
  now
}: {
  requestId: string
  correlationId: string
  sourceMode: CatalogProductDetailResponse['sourceMode']
  messages: CatalogProductDetailResponse['messages']
  now: Date
}): CatalogProductDetailResponse => ({
  requestId,
  correlationId,
  sourceMode,
  state: 'unavailable',
  messages,
  actionPolicy: productDetailActionPolicy('unavailable'),
  fetchedAt: now.toISOString()
})

const productDetailActionPolicy = (
  state: CatalogProductDetailResponse['state'],
  purchaseReady = false
): AgentActionPolicy => {
  if (state === 'ready' || state === 'limited') {
    return {
      state: state === 'limited' ? 'limited' : 'read',
      allowedNextActions: purchaseReady
        ? [
            {
              action: 'prepare_purchase',
              label: 'Prepare purchase',
              authority: 'allowed',
              requiredActionScope: 'write:purchase',
              reason: 'Arro has an exact source-confirmed configuration that can move into purchase preparation.'
            }
          ]
        : [
            {
              action: 'get_product_detail',
              label: 'Resolve product options',
              authority: 'allowed',
              requiredActionScope: 'read:product_detail',
              reason: 'The product remains usable for shopping, but its configurable options must resolve to an exact source-confirmed variant before purchase preparation.'
            }
          ]
    }
  }

  return {
    state: 'unavailable',
    allowedNextActions: [
      {
        action: 'search_products',
        label: 'Return to supported search',
        authority: 'limited',
        requiredActionScope: 'read:search',
        reason: 'Product detail is not source-confirmed, so checkout-adjacent work remains blocked.'
      },
      {
        action: 'wait',
        label: 'Wait for source readiness',
        authority: 'allowed',
        reason: 'The safer path is to wait until the product detail source can answer.'
      }
    ]
  }
}

export const createProductDetailHandler = ({
  loadTargetBusinessRecords,
  catalogProductDetailFetcher,
  connectedCatalogSources,
  connectorTimeoutMs,
  recordProductDetailAudit,
  agentSessionSigningSecret,
  apiError
}: CreateProductDetailHandlerOptions): ProductDetailHandler => async ({
  body,
  requestId,
  correlationId,
  route,
  set,
  requestTimeoutGuard
}) => {
  const startedAt = Date.now()

  if (!catalogProductDetailRequestValidator.Check(body)) {
    set.status = 422
    return apiError(
      'validation_failed',
      'The request did not match the API contract.',
      requestId
    )
  }

  const requestBody = body as CatalogProductDetailRequest
  const scopeError = agentActionScopeError({
    agentContext: requestBody.agentContext,
    expectedScope: 'read:product_detail',
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
    expectedScope: 'read:product_detail',
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
    expectedScope: 'read:product_detail',
    requestId,
    apiError
  })
  if (hostCapabilityError) {
    set.status = 403
    return hostCapabilityError
  }

  const records = await loadTargetBusinessRecords()
  requestTimeoutGuard.throwIfTimedOut()

  const policyNow = new Date()
  const sourcePolicy = buildCatalogSearchSourcePolicy({
    records,
    connectedSources: connectedCatalogSources,
    now: policyNow
  })
  const auditedResponse = async (
    response: CatalogProductDetailResponse,
    metadata: Record<string, unknown> = {}
  ) => {
    const auditResult = await recordProductDetailAudit({
      requestId,
      correlationId,
      route,
      request: requestBody,
      sourcePolicy,
      response,
      latencyMs: Date.now() - startedAt,
      metadata: {
        sourcePolicyAllowedBusinessCount: sourcePolicy.allowedBusinessIds.length,
        sourcePolicyMessageCode: sourcePolicy.message.code,
        commercialIsolationVersion: productDetailCommercialIsolationVersion,
        hasVariantId: Boolean(requestBody.variantId),
        ...(requestBody.agentContext
          ? {
              agentInvocation: {
                integrationId: requestBody.agentContext.integrationId,
                surface: requestBody.agentContext.surface,
                requestedActionScope: requestBody.agentContext.requestedActionScope,
                hostCapabilities: requestBody.agentContext.hostCapabilities ?? [],
                hasExternalSubjectRef: Boolean(requestBody.agentContext.externalSubjectRef),
                hasExternalTaskRef: Boolean(requestBody.agentContext.externalTaskRef),
                hasSessionToken: Boolean(requestBody.agentContext.sessionToken),
                ...(requestBody.agentContext.sessionExpiresAt
                  ? { sessionExpiresAt: requestBody.agentContext.sessionExpiresAt }
                  : {})
              }
            }
          : {}),
        ...metadata
      }
    })
    requestTimeoutGuard.throwIfTimedOut()

    if (!auditResult.recorded && isConnectorBackedSourceMode(response.sourceMode)) {
      set.status = 503
      return apiError(
        'product_detail_audit_unavailable',
        'Connector-backed product detail is unavailable because product-detail audit persistence is not available.',
        requestId
      )
    }

    return response
  }
  const candidateSources = sourcePolicy.sourceMode === 'approved_sources'
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
  const source = candidateSources.find((candidate) => candidate.businessId === requestBody.businessId)

  if (!isConnectorBackedSourceMode(sourcePolicy.sourceMode) || !source) {
    return auditedResponse(unavailableResponse({
      requestId,
      correlationId,
      sourceMode: sourcePolicy.sourceMode,
      now: policyNow,
      messages: [
        sourcePolicy.message,
        {
          severity: 'info',
          code: 'catalog_product_detail_source_unavailable',
          text: 'Product detail is unavailable because the requested source is not connector-backed for this request.',
          nextAction: 'Use only products returned by connector-backed search responses, or configure an official source before requesting detail.'
        }
      ]
    }), {
      sourceAvailable: false
    })
  }

  const detailResult = await catalogProductDetailFetcher({
    requestId,
    correlationId,
    source,
    detailRequest: requestBody,
    timeoutMs: connectorTimeoutMs,
    now: policyNow,
    signal: requestTimeoutGuard.signal
  })
  requestTimeoutGuard.throwIfTimedOut()

  if (detailResult.status !== 'fetched' || !detailResult.product) {
    return auditedResponse(unavailableResponse({
      requestId,
      correlationId,
      sourceMode: sourcePolicy.sourceMode,
      now: policyNow,
      messages: [sourcePolicy.message, ...detailResult.messages]
    }), {
      sourceAvailable: true,
      detailFetch: {
        sourceId: detailResult.sourceId,
        status: detailResult.status,
        latencyMs: detailResult.latencyMs,
        messageCodes: detailResult.messages.map((message) => message.code)
      }
    })
  }

  const quality = assessProductDetailQuality(detailResult.product, {
    ...(requestBody.variantId ? { selectedVariantId: requestBody.variantId } : {}),
    ...(requestBody.selected ? { requestedSelected: requestBody.selected } : {})
  })
  const responseState: CatalogProductDetailResponse['state'] = quality.state === 'ready' ? 'ready' : 'limited'

  return auditedResponse({
    requestId,
    correlationId,
    sourceMode: sourcePolicy.sourceMode,
    state: responseState,
    product: detailResult.product,
    messages: [sourcePolicy.message, ...detailResult.messages, ...quality.messages],
    actionPolicy: productDetailActionPolicy(responseState, quality.purchaseReady),
    fetchedAt: detailResult.fetchedAt
  } satisfies CatalogProductDetailResponse, {
    sourceAvailable: true,
    detailFetch: {
      sourceId: detailResult.sourceId,
      status: detailResult.status,
      latencyMs: detailResult.latencyMs,
      messageCodes: detailResult.messages.map((message) => message.code)
    }
  })
}
