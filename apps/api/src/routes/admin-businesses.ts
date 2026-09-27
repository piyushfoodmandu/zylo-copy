import type { AnyElysia } from 'elysia'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  TargetBusinessAdminFiltersSchema,
  TargetBusinessAdminTransitionRequestSchema,
  type ApiError,
  type TargetBusinessAdminFilters,
  type TargetBusinessAdminTransitionRequest
} from '@arro/contracts'
import type { Authenticator } from '../auth.ts'
import {
  requestPath,
  type AuditRecorder
} from '../audit-log.ts'
import {
  enforceContentLength,
  enforceJsonContentType
} from '../request-guards.ts'
import {
  SourceGovernanceError,
  type SourceGovernanceOperations
} from '../source-governance.ts'

const targetBusinessAdminFiltersValidator = TypeCompiler.Compile(
  TargetBusinessAdminFiltersSchema
)
const targetBusinessAdminTransitionRequestValidator = TypeCompiler.Compile(
  TargetBusinessAdminTransitionRequestSchema
)

const parseAdminBusinessFilters = (url: string): TargetBusinessAdminFilters => {
  const searchParams = new URL(url).searchParams
  const domain = searchParams.get('domain')?.trim()
  const launchStatus = searchParams.get('launchStatus')?.trim()
  const featureVisibility = searchParams.get('featureVisibility')?.trim()
  const accessPolicyState = searchParams.get('accessPolicyState')?.trim()

  return {
    ...(domain ? { domain } : {}),
    ...(launchStatus ? { launchStatus } : {}),
    ...(featureVisibility ? { featureVisibility } : {}),
    ...(accessPolicyState ? { accessPolicyState } : {})
  } as TargetBusinessAdminFilters
}

type AdminBusinessesRouteOptions = {
  authenticate: Authenticator
  recordAudit: AuditRecorder
  sourceGovernance: SourceGovernanceOperations
  requiredScopes: string[]
  apiError: (code: string, message: string, requestId: string) => ApiError
}

export const registerAdminBusinessRoutes = <App extends AnyElysia>(
  app: App,
  {
    authenticate,
    recordAudit,
    sourceGovernance,
    requiredScopes,
    apiError
  }: AdminBusinessesRouteOptions
) =>
  app
    .get('/v1/admin/businesses', async ({ request, requestId, correlationId, set }) => {
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
          routeGroup: 'admin_businesses',
          statusCode: authResult.status,
          decision: authResult.decision,
          reasonCode: authResult.body.error.code,
          requiredScopes,
          latencyMs: Date.now() - startedAt
        })
        return authResult.body
      }

      const filters = parseAdminBusinessFilters(request.url)

      if (!targetBusinessAdminFiltersValidator.Check(filters)) {
        set.status = 422
        await recordAudit({
          requestId,
          correlationId,
          principal: authResult.principal,
          method: request.method,
          path: requestPath(request),
          routeGroup: 'admin_businesses',
          statusCode: 422,
          decision: authResult.decision,
          reasonCode: 'validation_failed',
          requiredScopes,
          latencyMs: Date.now() - startedAt
        })
        return apiError('validation_failed', 'The request did not match the API contract.', requestId)
      }

      try {
        const body = await sourceGovernance.listBusinesses({
          requestId,
          correlationId,
          filters
        })

        await recordAudit({
          requestId,
          correlationId,
          principal: authResult.principal,
          method: request.method,
          path: requestPath(request),
          routeGroup: 'admin_businesses',
          statusCode: 200,
          decision: authResult.decision,
          reasonCode: 'admin_businesses_listed',
          requiredScopes,
          latencyMs: Date.now() - startedAt,
          metadata: {
            recordCount: body.records.length,
            filters: body.filters
          }
        })

        return body
      } catch (error) {
        if (error instanceof SourceGovernanceError) {
          set.status = error.status
          await recordAudit({
            requestId,
            correlationId,
            principal: authResult.principal,
            method: request.method,
            path: requestPath(request),
            routeGroup: 'admin_businesses',
            statusCode: error.status,
            decision: authResult.decision,
            reasonCode: error.code,
            requiredScopes,
            latencyMs: Date.now() - startedAt
          })
          return apiError(error.code, error.message, requestId)
        }

        await recordAudit({
          requestId,
          correlationId,
          principal: authResult.principal,
          method: request.method,
          path: requestPath(request),
          routeGroup: 'admin_businesses',
          statusCode: 500,
          decision: authResult.decision,
          reasonCode: 'internal_error',
          requiredScopes,
          latencyMs: Date.now() - startedAt
        })
        throw error
      }
    })
    .get('/v1/admin/businesses/:businessId', async ({ request, params, requestId, correlationId, set }) => {
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
          routeGroup: 'admin_businesses',
          statusCode: authResult.status,
          decision: authResult.decision,
          reasonCode: authResult.body.error.code,
          requiredScopes,
          latencyMs: Date.now() - startedAt
        })
        return authResult.body
      }

      try {
        const body = await sourceGovernance.getBusinessDetail({
          requestId,
          correlationId,
          businessId: params.businessId
        })

        await recordAudit({
          requestId,
          correlationId,
          principal: authResult.principal,
          method: request.method,
          path: requestPath(request),
          routeGroup: 'admin_businesses',
          statusCode: 200,
          decision: authResult.decision,
          reasonCode: 'admin_business_detail_read',
          requiredScopes,
          latencyMs: Date.now() - startedAt,
          metadata: {
            businessId: body.record.businessId,
            discoveryObservationCount: body.recentDiscoveryObservations.length,
            transitionCount: body.transitions.length
          }
        })

        return body
      } catch (error) {
        if (error instanceof SourceGovernanceError) {
          set.status = error.status
          await recordAudit({
            requestId,
            correlationId,
            principal: authResult.principal,
            method: request.method,
            path: requestPath(request),
            routeGroup: 'admin_businesses',
            statusCode: error.status,
            decision: authResult.decision,
            reasonCode: error.code,
            requiredScopes,
            latencyMs: Date.now() - startedAt,
            metadata: {
              businessId: params.businessId
            }
          })
          return apiError(error.code, error.message, requestId)
        }

        await recordAudit({
          requestId,
          correlationId,
          principal: authResult.principal,
          method: request.method,
          path: requestPath(request),
          routeGroup: 'admin_businesses',
          statusCode: 500,
          decision: authResult.decision,
          reasonCode: 'internal_error',
          requiredScopes,
          latencyMs: Date.now() - startedAt,
          metadata: {
            businessId: params.businessId
          }
        })
        throw error
      }
    })
    .patch('/v1/admin/businesses/:businessId', async ({ request, params, body, requestId, correlationId, set }) => {
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
          routeGroup: 'admin_businesses',
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
          routeGroup: 'admin_businesses',
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
          routeGroup: 'admin_businesses',
          statusCode: contentTypeRejection.status,
          decision: authResult.decision,
          reasonCode: contentTypeRejection.reasonCode,
          requiredScopes,
          latencyMs: Date.now() - startedAt
        })
        return contentTypeRejection.body
      }

      if (!targetBusinessAdminTransitionRequestValidator.Check(body)) {
        set.status = 422
        await recordAudit({
          requestId,
          correlationId,
          principal: authResult.principal,
          method: request.method,
          path: requestPath(request),
          routeGroup: 'admin_businesses',
          statusCode: 422,
          decision: authResult.decision,
          reasonCode: 'validation_failed',
          requiredScopes,
          latencyMs: Date.now() - startedAt,
          metadata: {
            businessId: params.businessId
          }
        })
        return apiError('validation_failed', 'The request did not match the API contract.', requestId)
      }

      try {
        const transition = body as TargetBusinessAdminTransitionRequest
        const responseBody = await sourceGovernance.transitionBusiness({
          requestId,
          correlationId,
          principal: authResult.principal,
          businessId: params.businessId,
          transition
        })

        await recordAudit({
          requestId,
          correlationId,
          principal: authResult.principal,
          method: request.method,
          path: requestPath(request),
          routeGroup: 'admin_businesses',
          statusCode: 200,
          decision: authResult.decision,
          reasonCode: 'admin_business_transition_recorded',
          requiredScopes,
          latencyMs: Date.now() - startedAt,
          metadata: {
            businessId: responseBody.record.businessId,
            transitionId: responseBody.transition.id,
            nextLaunchStatus: responseBody.transition.nextLaunchStatus,
            nextFeatureVisibility: responseBody.transition.nextFeatureVisibility,
            nextAccessPolicyState: responseBody.transition.nextAccessPolicyState,
            transitionReasonCode: responseBody.transition.reasonCode
          }
        })

        return responseBody
      } catch (error) {
        if (error instanceof SourceGovernanceError) {
          set.status = error.status
          await recordAudit({
            requestId,
            correlationId,
            principal: authResult.principal,
            method: request.method,
            path: requestPath(request),
            routeGroup: 'admin_businesses',
            statusCode: error.status,
            decision: authResult.decision,
            reasonCode: error.code,
            requiredScopes,
            latencyMs: Date.now() - startedAt,
            metadata: {
              businessId: params.businessId
            }
          })
          return apiError(error.code, error.message, requestId)
        }

        await recordAudit({
          requestId,
          correlationId,
          principal: authResult.principal,
          method: request.method,
          path: requestPath(request),
          routeGroup: 'admin_businesses',
          statusCode: 500,
          decision: authResult.decision,
          reasonCode: 'internal_error',
          requiredScopes,
          latencyMs: Date.now() - startedAt,
          metadata: {
            businessId: params.businessId
          }
        })
        throw error
      }
    })
