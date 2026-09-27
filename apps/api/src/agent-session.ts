import {
  createHmac,
  randomUUID,
  timingSafeEqual
} from 'node:crypto'
import { Type } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  AgentActionScopeSchema,
  AgentSessionIssueRequestSchema,
  AgentSurfaceSchema,
  AgentTrustSignalCapabilitySchema,
  IsoDateTimeSchema,
  validationErrorSummary,
  type AgentActionScope,
  type AgentInvocationContext,
  type AgentSessionIssueRequest,
  type AgentSessionIssueResponse,
  type AgentTrustSignalCapability,
  type ApiError
} from '@arro/contracts'

const sessionTokenPrefix = 'arro_session_v1'
const refHashPrefix = 'hmac-sha256:'

const AgentSessionTokenPayloadSchema = Type.Object(
  {
    v: Type.Literal(1),
    sessionId: Type.String({ minLength: 1, maxLength: 160 }),
    issuedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    integrationId: Type.String({ minLength: 1, maxLength: 96 }),
    surface: AgentSurfaceSchema,
    allowedActionScopes: Type.Array(AgentActionScopeSchema, {
      minItems: 1,
      maxItems: 10,
      uniqueItems: true
    }),
    hostCapabilities: Type.Array(AgentTrustSignalCapabilitySchema, {
      minItems: 1,
      maxItems: 16,
      uniqueItems: true
    }),
    externalSubjectRefHash: Type.Optional(Type.String({ minLength: 76, maxLength: 76 })),
    externalTaskRefHash: Type.Optional(Type.String({ minLength: 76, maxLength: 76 }))
  },
  { additionalProperties: false }
)

const agentSessionIssueRequestValidator = TypeCompiler.Compile(
  AgentSessionIssueRequestSchema
)
const agentSessionTokenPayloadValidator = TypeCompiler.Compile(
  AgentSessionTokenPayloadSchema
)

type AgentSessionTokenPayload = {
  v: 1
  sessionId: string
  issuedAt: string
  expiresAt: string
  integrationId: string
  surface: AgentInvocationContext['surface']
  allowedActionScopes: AgentActionScope[]
  hostCapabilities: AgentTrustSignalCapability[]
  externalSubjectRefHash?: string | undefined
  externalTaskRefHash?: string | undefined
}

export type AgentSessionValidationState =
  | 'not_supplied'
  | 'valid'
  | 'invalid'
  | 'unavailable'

export type AgentSessionValidationResult =
  | {
      ok: true
      state: 'not_supplied'
    }
  | {
      ok: true
      state: 'valid'
      sessionId: string
      expiresAt: string
      allowedActionScopes: AgentActionScope[]
    }
  | {
      ok: false
      state: 'invalid' | 'unavailable'
      code: string
      message: string
    }

export type AgentSessionPolicyError = {
  status: 403 | 503
  body: ApiError
}

export type AgentSessionIssueHandler = (options: {
  body: unknown
  requestId: string
  correlationId: string
  set: { status?: number | string }
}) => Promise<unknown>

const normalizeScopes = (scopes: readonly AgentActionScope[]) =>
  [...new Set(scopes)].sort()

const normalizeCapabilities = (
  capabilities: readonly AgentTrustSignalCapability[]
) => [...new Set(capabilities)].sort()

const sortedEqual = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((value, index) => value === right[index])

const base64UrlJson = (value: unknown) =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

const hmac = (secret: string, value: string) =>
  createHmac('sha256', secret).update(value, 'utf8').digest('hex')

const hmacBase64Url = (secret: string, value: string) =>
  createHmac('sha256', secret).update(value, 'utf8').digest('base64url')

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  return leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
}

const hashRef = (value: string | undefined, signingSecret: string) =>
  value
    ? `${refHashPrefix}${hmac(signingSecret, `agent-session-ref:v1:${value}`)}`
    : undefined

const parsedDateMs = (value: string) => {
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : undefined
}

const policyError = ({
  state,
  code,
  message
}: {
  state: 'invalid' | 'unavailable'
  code: string
  message: string
}): Extract<AgentSessionValidationResult, { ok: false }> => ({
  ok: false,
  state,
  code,
  message
})

const parseTokenPayload = (
  sessionToken: string,
  signingSecret: string
): AgentSessionTokenPayload | AgentSessionValidationResult => {
  const parts = sessionToken.split('.')
  if (parts.length !== 3 || parts[0] !== sessionTokenPrefix) {
    return policyError({
      state: 'invalid',
      code: 'agent_session_token_invalid',
      message: 'Agent session token does not match the Arro session-token format.'
    })
  }

  const [, payloadSegment, signatureSegment] = parts as [string, string, string]
  const expectedSignature = hmacBase64Url(signingSecret, payloadSegment)
  if (!safeEqual(signatureSegment, expectedSignature)) {
    return policyError({
      state: 'invalid',
      code: 'agent_session_token_invalid',
      message: 'Agent session token signature could not be verified.'
    })
  }

  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'))
  } catch {
    return policyError({
      state: 'invalid',
      code: 'agent_session_token_invalid',
      message: 'Agent session token payload could not be decoded.'
    })
  }

  if (!agentSessionTokenPayloadValidator.Check(payload)) {
    return policyError({
      state: 'invalid',
      code: 'agent_session_token_invalid',
      message: `Agent session token payload is not valid: ${validationErrorSummary(agentSessionTokenPayloadValidator, payload)}`
    })
  }

  return payload as AgentSessionTokenPayload
}

export const createAgentSessionToken = ({
  request,
  signingSecret,
  maxTtlSeconds,
  now = new Date(),
  sessionId = randomUUID()
}: {
  request: AgentSessionIssueRequest
  signingSecret: string
  maxTtlSeconds: number
  now?: Date
  sessionId?: string
}) => {
  const expiresAtMs = parsedDateMs(request.sessionExpiresAt)
  if (!expiresAtMs || expiresAtMs <= now.getTime()) {
    return policyError({
      state: 'invalid',
      code: 'agent_session_expiry_invalid',
      message: 'Agent session expiry must be a future ISO timestamp.'
    })
  }

  if (expiresAtMs - now.getTime() > maxTtlSeconds * 1000) {
    return policyError({
      state: 'invalid',
      code: 'agent_session_ttl_exceeded',
      message: `Agent session expiry exceeds the configured maximum TTL of ${maxTtlSeconds} seconds.`
    })
  }

  const payload: AgentSessionTokenPayload = {
    v: 1,
    sessionId,
    issuedAt: now.toISOString(),
    expiresAt: request.sessionExpiresAt,
    integrationId: request.integrationId,
    surface: request.surface,
    allowedActionScopes: normalizeScopes(request.allowedActionScopes),
    hostCapabilities: normalizeCapabilities(request.hostCapabilities),
    ...(request.externalSubjectRef
      ? { externalSubjectRefHash: hashRef(request.externalSubjectRef, signingSecret) }
      : {}),
    ...(request.externalTaskRef
      ? { externalTaskRefHash: hashRef(request.externalTaskRef, signingSecret) }
      : {})
  }
  const payloadSegment = base64UrlJson(payload)
  const sessionToken = [
    sessionTokenPrefix,
    payloadSegment,
    hmacBase64Url(signingSecret, payloadSegment)
  ].join('.')

  return {
    ok: true as const,
    session: {
      sessionId,
      sessionToken,
      integrationId: request.integrationId,
      surface: request.surface,
      allowedActionScopes: payload.allowedActionScopes,
      sessionExpiresAt: request.sessionExpiresAt,
      hostCapabilities: payload.hostCapabilities,
      hasExternalSubjectRef: Boolean(request.externalSubjectRef),
      hasExternalTaskRef: Boolean(request.externalTaskRef)
    }
  }
}

export const validateAgentSessionToken = ({
  agentContext,
  expectedScope,
  signingSecret,
  now = new Date()
}: {
  agentContext: AgentInvocationContext | undefined
  expectedScope: AgentActionScope
  signingSecret?: string | undefined
  now?: Date
}): AgentSessionValidationResult => {
  if (!agentContext?.sessionToken) {
    return {
      ok: true,
      state: 'not_supplied'
    }
  }

  if (!signingSecret) {
    return policyError({
      state: 'unavailable',
      code: 'agent_session_signing_unavailable',
      message: 'Agent session token validation is not configured.'
    })
  }

  const payload = parseTokenPayload(agentContext.sessionToken, signingSecret)
  if ('ok' in payload) return payload

  const expiresAtMs = parsedDateMs(payload.expiresAt)
  if (!expiresAtMs || expiresAtMs <= now.getTime()) {
    return policyError({
      state: 'invalid',
      code: 'agent_session_token_expired',
      message: 'Agent session token is expired.'
    })
  }

  if (agentContext.integrationId !== payload.integrationId) {
    return policyError({
      state: 'invalid',
      code: 'agent_session_integration_mismatch',
      message: 'Agent session token is bound to a different integration.'
    })
  }

  if (agentContext.surface !== payload.surface) {
    return policyError({
      state: 'invalid',
      code: 'agent_session_surface_mismatch',
      message: 'Agent session token is bound to a different agent surface.'
    })
  }

  if (!payload.allowedActionScopes.includes(expectedScope)) {
    return policyError({
      state: 'invalid',
      code: 'agent_session_scope_denied',
      message: `Agent session token does not allow ${expectedScope}.`
    })
  }

  if (agentContext.sessionExpiresAt && agentContext.sessionExpiresAt !== payload.expiresAt) {
    return policyError({
      state: 'invalid',
      code: 'agent_session_expiry_mismatch',
      message: 'Agent session context expiry does not match the signed session token.'
    })
  }

  const contextCapabilities = normalizeCapabilities(agentContext.hostCapabilities ?? [])
  if (!sortedEqual(contextCapabilities, payload.hostCapabilities)) {
    return policyError({
      state: 'invalid',
      code: 'agent_session_capability_mismatch',
      message: 'Agent session token is bound to a different host capability set.'
    })
  }

  const expectedSubjectHash = hashRef(agentContext.externalSubjectRef, signingSecret)
  if (expectedSubjectHash !== payload.externalSubjectRefHash) {
    return policyError({
      state: 'invalid',
      code: 'agent_session_subject_mismatch',
      message: 'Agent session token is bound to a different external subject reference.'
    })
  }

  const expectedTaskHash = hashRef(agentContext.externalTaskRef, signingSecret)
  if (expectedTaskHash !== payload.externalTaskRefHash) {
    return policyError({
      state: 'invalid',
      code: 'agent_session_task_mismatch',
      message: 'Agent session token is bound to a different external task reference.'
    })
  }

  return {
    ok: true,
    state: 'valid',
    sessionId: payload.sessionId,
    expiresAt: payload.expiresAt,
    allowedActionScopes: payload.allowedActionScopes
  }
}

export const agentSessionBindingError = ({
  agentContext,
  expectedScope,
  signingSecret,
  requireSessionToken = false,
  requestId,
  apiError
}: {
  agentContext: AgentInvocationContext | undefined
  expectedScope: AgentActionScope
  signingSecret?: string | undefined
  requireSessionToken?: boolean
  requestId: string
  apiError: (code: string, message: string, requestId: string) => ApiError
}): AgentSessionPolicyError | undefined => {
  const result = validateAgentSessionToken({
    agentContext,
    expectedScope,
    signingSecret
  })

  if (requireSessionToken && result.ok && result.state === 'not_supplied') {
    return {
      status: 403,
      body: apiError(
        'agent_session_token_required',
        `A signed Arro agent session token is required for ${expectedScope}.`,
        requestId
      )
    }
  }

  if (result.ok) return undefined

  return {
    status: result.state === 'unavailable' ? 503 : 403,
    body: apiError(result.code, result.message, requestId)
  }
}

export const createAgentSessionIssueHandler = ({
  signingSecret,
  maxTtlSeconds,
  apiError
}: {
  signingSecret?: string | undefined
  maxTtlSeconds: number
  apiError: (code: string, message: string, requestId: string) => ApiError
}): AgentSessionIssueHandler => async ({
  body,
  requestId,
  correlationId,
  set
}) => {
  if (!agentSessionIssueRequestValidator.Check(body)) {
    set.status = 422
    return apiError(
      'validation_failed',
      'The request did not match the API contract.',
      requestId
    )
  }

  if (!signingSecret) {
    set.status = 503
    return apiError(
      'agent_session_signing_unavailable',
      'Agent session token issuance is not configured.',
      requestId
    )
  }

  const issued = createAgentSessionToken({
    request: body as AgentSessionIssueRequest,
    signingSecret,
    maxTtlSeconds
  })

  if (!issued.ok) {
    set.status = 422
    return apiError(issued.code, issued.message, requestId)
  }

  return {
    requestId,
    correlationId,
    session: issued.session
  } satisfies AgentSessionIssueResponse
}
