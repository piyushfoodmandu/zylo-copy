import type { AnyElysia } from 'elysia'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  UcpDiscoveryRequestSchema,
  type ApiError,
  type UcpDiscoveryRequest,
  type UcpDiscoveryResponse
} from '@arro/contracts'
import type { DiscoverUcpProfileOptions } from '@arro/connectors'
import type { Authenticator } from '../auth.ts'
import {
  requestPath,
  type AuditRecorder
} from '../audit-log.ts'
import {
  ucpDiscoveryRateLimitPolicy,
  type ProtectedRateLimiter
} from '../rate-limit.ts'
import {
  enforceContentLength,
  enforceJsonContentType
} from '../request-guards.ts'
import type {
  DiscoveryObservationPersistenceResult,
  PersistDiscoveryObservationOptions
} from '../target-business-repository.ts'

const ucpDiscoveryRequestValidator = TypeCompiler.Compile(
  UcpDiscoveryRequestSchema
)

type UcpDiscoveryRouteOptions = {
  authenticate: Authenticator
  recordAudit: AuditRecorder
  rateLimitProtectedRequest: ProtectedRateLimiter
  discoverUcpProfile: (request: UcpDiscoveryRequest, options: DiscoverUcpProfileOptions) => Promise<UcpDiscoveryResponse>
  persistDiscoveryObservation: (options: PersistDiscoveryObservationOptions) => Promise<DiscoveryObservationPersistenceResult | undefined>
  requiredScopes: string[]
  platformProfileUrl: string
  timeoutMs: number
  apiError: (code: string, message: string, requestId: string) => ApiError
}

export const registerUcpDiscoveryRoute = <App extends AnyElysia>(
  app: App,
  {
    authenticate,
    recordAudit,
    rateLimitProtectedRequest,
    discoverUcpProfile,
    persistDiscoveryObservation,
    requiredScopes,
    platformProfileUrl,
    timeoutMs,
    apiError
  }: UcpDiscoveryRouteOptions
) =>
  app.post('/v1/ucp/discover', async ({ request, body, requestId, correlationId, set }) => {
    const startedAt = Date.now()
    const authResult = await authenticate({
      request,
      requestId,
      requiredScopes
    })

    if (!authResult.ok) {
      set.status = authResult.status
      await recordAudit({
        requestId,
        correlationId,
        ...(authResult.principal ? { principal: authResult.principal } : {}),
        method: request.method,
        path: requestPath(request),
        routeGroup: 'ucp_discovery',
        statusCode: authResult.status,
        decision: authResult.decision,
        reasonCode: authResult.body.error.code,
        requiredScopes,
        latencyMs: Date.now() - startedAt
      })
      return authResult.body
    }

    const contentLengthRejection = enforceContentLength(request, requestId)
    if (contentLengthRejection) {
      set.status = contentLengthRejection.status
      await recordAudit({
        requestId,
        correlationId,
        principal: authResult.principal,
        method: request.method,
        path: requestPath(request),
        routeGroup: 'ucp_discovery',
        statusCode: contentLengthRejection.status,
        decision: authResult.decision,
        reasonCode: contentLengthRejection.reasonCode,
        requiredScopes,
        latencyMs: Date.now() - startedAt
      })
      return contentLengthRejection.body
    }

    const contentTypeRejection = enforceJsonContentType(request, requestId)
    if (contentTypeRejection) {
      set.status = contentTypeRejection.status
      await recordAudit({
        requestId,
        correlationId,
        principal: authResult.principal,
        method: request.method,
        path: requestPath(request),
        routeGroup: 'ucp_discovery',
        statusCode: contentTypeRejection.status,
        decision: authResult.decision,
        reasonCode: contentTypeRejection.reasonCode,
        requiredScopes,
        latencyMs: Date.now() - startedAt
      })
      return contentTypeRejection.body
    }

    const rateLimitResult = await rateLimitProtectedRequest({
      request,
      requestId,
      principal: authResult.principal,
      policy: ucpDiscoveryRateLimitPolicy()
    })

    if (!rateLimitResult.allowed) {
      set.status = rateLimitResult.status
      set.headers['retry-after'] = String(rateLimitResult.retryAfterSeconds)
      await recordAudit({
        requestId,
        correlationId,
        principal: authResult.principal,
        method: request.method,
        path: requestPath(request),
        routeGroup: 'ucp_discovery',
        statusCode: rateLimitResult.status,
        decision: 'rate_limited',
        reasonCode: rateLimitResult.reasonCode,
        requiredScopes,
        latencyMs: Date.now() - startedAt,
        metadata: {
          rateLimitRemaining: rateLimitResult.remaining,
          rateLimitResetAt: rateLimitResult.resetAt
        }
      })
      return rateLimitResult.body
    }

    if (!ucpDiscoveryRequestValidator.Check(body)) {
      set.status = 422
      await recordAudit({
        requestId,
        correlationId,
        principal: authResult.principal,
        method: request.method,
        path: requestPath(request),
        routeGroup: 'ucp_discovery',
        statusCode: 422,
        decision: authResult.decision,
        reasonCode: 'validation_failed',
        requiredScopes,
        latencyMs: Date.now() - startedAt
      })
      return apiError('validation_failed', 'The request did not match the API contract.', requestId)
    }

    try {
      const discoveryResponse = await discoverUcpProfile(body, {
        requestId,
        correlationId,
        platformProfileUrl,
        timeoutMs
      })
      const persistedObservation = await persistDiscoveryObservation({
        requestId,
        correlationId,
        principal: authResult.principal,
        discoveryResponse
      })

      await recordAudit({
        requestId,
        correlationId,
        principal: authResult.principal,
        method: request.method,
        path: requestPath(request),
        routeGroup: 'ucp_discovery',
        statusCode: 200,
        decision: authResult.decision,
        reasonCode: `discovery_${discoveryResponse.status}`,
        requiredScopes,
        latencyMs: Date.now() - startedAt,
        metadata: {
          ...(persistedObservation
            ? {
                discoveryObservationId: persistedObservation.observationId,
                discoveryBusinessId: persistedObservation.businessId,
                discoveryCreatedBusiness: persistedObservation.createdBusiness,
                discoveryCapabilitiesUpserted: persistedObservation.capabilitiesUpserted,
                discoveryEvidenceInserted: persistedObservation.evidenceInserted
              }
            : {}),
          discoveryStatus: discoveryResponse.status,
          accessPolicyState: discoveryResponse.accessPolicyState,
          profileHash: discoveryResponse.profile?.profileHash,
          capabilityCount: discoveryResponse.profile?.capabilities.length ?? 0
        }
      })

      return discoveryResponse
    } catch (error) {
      await recordAudit({
        requestId,
        correlationId,
        principal: authResult.principal,
        method: request.method,
        path: requestPath(request),
        routeGroup: 'ucp_discovery',
        statusCode: 500,
        decision: authResult.decision,
        reasonCode: 'internal_error',
        requiredScopes,
        latencyMs: Date.now() - startedAt
      })
      throw error
    }
  })
