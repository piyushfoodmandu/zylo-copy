import type { AnyElysia } from 'elysia'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  TargetBusinessConformanceTriggerRequestSchema,
  type ApiError,
  type TargetBusinessConformanceTriggerRequest
} from '@arro/contracts'
import type { Authenticator } from '../auth.ts'
import {
  requestPath,
  type AuditRecorder
} from '../audit-log.ts'
import {
  ConformanceError,
  type ConformanceOperations
} from '../conformance.ts'
import {
  enforceContentLength,
  enforceJsonContentType
} from '../request-guards.ts'

const targetBusinessConformanceTriggerRequestValidator = TypeCompiler.Compile(
  TargetBusinessConformanceTriggerRequestSchema
)

type AdminConformanceRouteOptions = {
  authenticate: Authenticator
  recordAudit: AuditRecorder
  conformance: ConformanceOperations
  requiredScopes: string[]
  apiError: (code: string, message: string, requestId: string) => ApiError
}

export const registerAdminConformanceRoutes = <App extends AnyElysia>(
  app: App,
  {
    authenticate,
    recordAudit,
    conformance,
    requiredScopes,
    apiError
  }: AdminConformanceRouteOptions
) =>
  app
    .get('/v1/admin/businesses/:businessId/conformance', async ({ request, params, requestId, correlationId, set }) => {
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
          routeGroup: 'admin_conformance',
          statusCode: authResult.status,
          decision: authResult.decision,
          reasonCode: authResult.body.error.code,
          requiredScopes,
          latencyMs: Date.now() - startedAt
        })
        return authResult.body
      }

      try {
        const body = await conformance.listConformanceRuns({
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
          routeGroup: 'admin_conformance',
          statusCode: 200,
          decision: authResult.decision,
          reasonCode: 'admin_conformance_runs_listed',
          requiredScopes,
          latencyMs: Date.now() - startedAt,
          metadata: {
            businessId: body.businessId,
            runCount: body.runs.length
          }
        })

        return body
      } catch (error) {
        if (error instanceof ConformanceError) {
          set.status = error.status
          await recordAudit({
            requestId,
            correlationId,
            principal: authResult.principal,
            method: request.method,
            path: requestPath(request),
            routeGroup: 'admin_conformance',
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
          routeGroup: 'admin_conformance',
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
    .post('/v1/admin/businesses/:businessId/conformance', async ({ request, params, body, requestId, correlationId, set }) => {
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
          routeGroup: 'admin_conformance',
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
          routeGroup: 'admin_conformance',
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
          routeGroup: 'admin_conformance',
          statusCode: contentTypeRejection.status,
          decision: authResult.decision,
          reasonCode: contentTypeRejection.reasonCode,
          requiredScopes,
          latencyMs: Date.now() - startedAt
        })
        return contentTypeRejection.body
      }

      if (!targetBusinessConformanceTriggerRequestValidator.Check(body)) {
        set.status = 422
        await recordAudit({
          requestId,
          correlationId,
          principal: authResult.principal,
          method: request.method,
          path: requestPath(request),
          routeGroup: 'admin_conformance',
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
        const conformanceRequest = body as TargetBusinessConformanceTriggerRequest
        const responseBody = await conformance.runConformance({
          requestId,
          correlationId,
          principal: authResult.principal,
          businessId: params.businessId,
          request: conformanceRequest
        })

        await recordAudit({
          requestId,
          correlationId,
          principal: authResult.principal,
          method: request.method,
          path: requestPath(request),
          routeGroup: 'admin_conformance',
          statusCode: 200,
          decision: authResult.decision,
          reasonCode: `conformance_${responseBody.run.runStatus}`,
          requiredScopes,
          latencyMs: Date.now() - startedAt,
          metadata: {
            businessId: responseBody.run.businessId,
            conformanceRunId: responseBody.run.id,
            runMode: responseBody.run.runMode,
            runStatus: responseBody.run.runStatus,
            checksPassed: responseBody.run.checksPassed,
            checksFailed: responseBody.run.checksFailed,
            failureClassification: responseBody.run.failureClassification
          }
        })

        return responseBody
      } catch (error) {
        if (error instanceof ConformanceError) {
          set.status = error.status
          await recordAudit({
            requestId,
            correlationId,
            principal: authResult.principal,
            method: request.method,
            path: requestPath(request),
            routeGroup: 'admin_conformance',
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
          routeGroup: 'admin_conformance',
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
