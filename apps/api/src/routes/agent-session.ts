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
import type { AgentSessionIssueHandler } from '../agent-session.ts'
import {
  agentSessionRateLimitPolicy,
  type ProtectedRateLimiter
} from '../rate-limit.ts'
import {
  enforceContentLength,
  enforceJsonContentType
} from '../request-guards.ts'

type AgentSessionRouteOptions = {
  authenticate: Authenticator
  recordAudit: AuditRecorder
  rateLimitProtectedRequest: ProtectedRateLimiter
  requiredScopes: string[]
  handleAgentSessionIssue: AgentSessionIssueHandler
}

export const registerAgentSessionRoute = <App extends AnyElysia>(
  app: App,
  {
    authenticate,
    recordAudit,
    rateLimitProtectedRequest,
    requiredScopes,
    handleAgentSessionIssue
  }: AgentSessionRouteOptions
) =>
  app.post('/v1/agent/session', async ({ request, body, requestId, correlationId, set }) => {
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
        routeGroup: 'agent_session',
        statusCode,
        decision,
        reasonCode,
        requiredScopes,
        latencyMs: Date.now() - startedAt,
        ...(metadata ? { metadata } : {})
      })

    const authResult = await authenticate({
      request,
      requestId,
      requiredScopes
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

    const rateLimitResult = await rateLimitProtectedRequest({
      request,
      requestId,
      principal: authResult.principal,
      policy: agentSessionRateLimitPolicy()
    })

    if (!rateLimitResult.allowed) {
      set.status = rateLimitResult.status
      set.headers['retry-after'] = String(rateLimitResult.retryAfterSeconds)
      await audit({
        statusCode: rateLimitResult.status,
        decision: 'rate_limited',
        reasonCode: rateLimitResult.reasonCode,
        principal: authResult.principal,
        metadata: {
          rateLimitRemaining: rateLimitResult.remaining,
          rateLimitResetAt: rateLimitResult.resetAt
        }
      })
      return rateLimitResult.body
    }

    const response = await handleAgentSessionIssue({
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
      : 'agent_session_issued'

    await audit({
      statusCode,
      decision: authResult.decision,
      reasonCode,
      principal: authResult.principal,
      metadata: {
        sessionIssued: reasonCode === 'agent_session_issued'
      }
    })

    return response
  })
