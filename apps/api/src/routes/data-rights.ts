import type { AnyElysia } from 'elysia'
import type {
  AuthDecision,
  Authenticator,
  AuthPrincipal
} from '../auth.ts'
import {
  requestPath,
  type AuditRecorder
} from '../audit-log.ts'
import type { DataRightsHandler } from '../data-rights-handler.ts'
import {
  enforceContentLength,
  enforceJsonContentType
} from '../request-guards.ts'

type DataRightsRouteOptions = {
  authenticate: Authenticator
  recordAudit: AuditRecorder
  readScopes: string[]
  writeScopes: string[]
  handleDataRightsAccess: DataRightsHandler
  handleDataRightsExport: DataRightsHandler
  handleDataRightsCorrection: DataRightsHandler
  handleDataRightsDeletion: DataRightsHandler
}

type RouteConfig = {
  routeGroup: string
  requiredScopes: string[]
  successReasonCode: string
  handle: DataRightsHandler
}

export const registerDataRightsRoutes = <App extends AnyElysia>(
  app: App,
  {
    authenticate,
    recordAudit,
    readScopes,
    writeScopes,
    handleDataRightsAccess,
    handleDataRightsExport,
    handleDataRightsCorrection,
    handleDataRightsDeletion
  }: DataRightsRouteOptions
) => {
  const register = (path: string, config: RouteConfig) => {
    app.post(path, async ({ request, body, requestId, correlationId, set }) => {
      const startedAt = Date.now()
      const audit = async ({
        statusCode,
        decision,
        reasonCode,
        principal,
        metadata
      }: {
        statusCode: number
        decision: AuthDecision
        reasonCode: string
        principal?: AuthPrincipal
        metadata?: Record<string, unknown>
      }) =>
        recordAudit({
          requestId,
          correlationId,
          ...(principal ? { principal } : {}),
          method: request.method,
          path: requestPath(request),
          routeGroup: config.routeGroup,
          statusCode,
          decision,
          reasonCode,
          requiredScopes: config.requiredScopes,
          latencyMs: Date.now() - startedAt,
          ...(metadata ? { metadata } : {})
        })

      const authResult = await authenticate({
        request,
        requestId,
        requiredScopes: config.requiredScopes
      })

      if (!authResult.ok) {
        set.status = authResult.status
        await audit({
          statusCode: authResult.status,
          decision: authResult.decision,
          reasonCode: authResult.body.error.code,
          ...(authResult.principal ? { principal: authResult.principal } : {})
        })
        return authResult.body
      }

      const contentLengthRejection = enforceContentLength(request, requestId)
      if (contentLengthRejection) {
        set.status = contentLengthRejection.status
        await audit({
          statusCode: contentLengthRejection.status,
          decision: authResult.decision,
          reasonCode: contentLengthRejection.reasonCode,
          principal: authResult.principal
        })
        return contentLengthRejection.body
      }

      const contentTypeRejection = enforceJsonContentType(request, requestId)
      if (contentTypeRejection) {
        set.status = contentTypeRejection.status
        await audit({
          statusCode: contentTypeRejection.status,
          decision: authResult.decision,
          reasonCode: contentTypeRejection.reasonCode,
          principal: authResult.principal
        })
        return contentTypeRejection.body
      }

      const response = await config.handle({
        body,
        requestId,
        correlationId,
        set
      })
      const statusCode = typeof set.status === 'number' ? set.status : 200
      const responseRecord = response && typeof response === 'object'
        ? response as Record<string, unknown>
        : {}
      const reasonCode = 'error' in responseRecord &&
        responseRecord.error &&
        typeof responseRecord.error === 'object' &&
        typeof (responseRecord.error as { code?: unknown }).code === 'string'
        ? (responseRecord.error as { code: string }).code
        : config.successReasonCode

      await audit({
        statusCode,
        decision: authResult.decision,
        reasonCode,
        principal: authResult.principal,
        metadata: {
          hasExternalSubjectRef: Boolean(
            body &&
            typeof body === 'object' &&
            'externalSubjectRef' in body &&
            (body as { externalSubjectRef?: unknown }).externalSubjectRef
          )
        }
      })

      return response
    })
  }

  register('/v1/data-rights/access', {
    routeGroup: 'data_rights_access',
    requiredScopes: readScopes,
    successReasonCode: 'data_rights_access_ready',
    handle: handleDataRightsAccess
  })
  register('/v1/data-rights/export', {
    routeGroup: 'data_rights_export',
    requiredScopes: readScopes,
    successReasonCode: 'data_rights_export_ready',
    handle: handleDataRightsExport
  })
  register('/v1/data-rights/corrections', {
    routeGroup: 'data_rights_correction',
    requiredScopes: writeScopes,
    successReasonCode: 'data_rights_correction_recorded',
    handle: handleDataRightsCorrection
  })
  register('/v1/data-rights/delete', {
    routeGroup: 'data_rights_deletion',
    requiredScopes: writeScopes,
    successReasonCode: 'data_rights_deletion_completed',
    handle: handleDataRightsDeletion
  })
}
