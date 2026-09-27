import { createHmac } from 'node:crypto'
import type {
  AgentActionScope,
  AgentInvocationContext,
  ApiError
} from '@arro/contracts'
import type { AuthPrincipal } from './auth.ts'
import {
  validateAgentSessionToken
} from './agent-session.ts'

export type CommercePrincipal = {
  keyId: string
  ownerPrincipal: string
  ownerPrincipalHash: string
  integrationId: string
  agentActionScope?: AgentActionScope
  agentAllowedActionScopes?: AgentActionScope[]
  externalSubjectRefHash?: string
  externalTaskRefHash?: string
  agentSessionId?: string
}

export type CommercePrincipalError = {
  status: 403 | 503
  body: ApiError
}

export type CommercePrincipalResult =
  | {
      ok: true
      principal: CommercePrincipal
    }
  | {
      ok: false
      error: CommercePrincipalError
    }

const hashScoped = (value: string, pepper: string) =>
  `sha256:${createHmac('sha256', pepper).update(value, 'utf8').digest('hex')}`

const apiErrorBody = (
  apiError: (code: string, message: string, requestId: string) => ApiError,
  code: string,
  message: string,
  requestId: string
) => apiError(code, message, requestId)

const hasExternalBindingClaim = (agentContext: AgentInvocationContext | undefined) =>
  Boolean(
    agentContext?.sessionToken ||
    agentContext?.externalSubjectRef ||
    agentContext?.externalTaskRef
  )

export const deriveCommercePrincipal = ({
  authPrincipal,
  agentContext,
  expectedScope,
  signingSecret,
  hashPepper,
  requestId,
  apiError
}: {
  authPrincipal: AuthPrincipal
  agentContext?: AgentInvocationContext | undefined
  expectedScope: AgentActionScope
  signingSecret?: string | undefined
  hashPepper?: string | undefined
  requestId: string
  apiError: (code: string, message: string, requestId: string) => ApiError
}): CommercePrincipalResult => {
  if (!hashPepper) {
    return {
      ok: false,
      error: {
        status: 503,
        body: apiErrorBody(
          apiError,
          'commerce_principal_hash_unavailable',
          'Commerce principal hashing is not configured.',
          requestId
        )
      }
    }
  }

  let agentSessionId: string | undefined
  let agentAllowedActionScopes: AgentActionScope[] | undefined
  const firstPartyShopper = authPrincipal.authType === 'shopper_session'
  const requiresSignedSession = expectedScope.startsWith('write:') && !firstPartyShopper
  if (requiresSignedSession && !agentContext?.sessionToken) {
    return {
      ok: false,
      error: {
        status: 403,
        body: apiErrorBody(
          apiError,
          'agent_session_token_required',
          `A signed Arro agent session token is required for ${expectedScope}.`,
          requestId
        )
      }
    }
  }

  if (firstPartyShopper && agentContext) {
    return {
      ok: false,
      error: {
        status: 403,
        body: apiErrorBody(
          apiError,
          'shopper_agent_context_not_allowed',
          'First-party shopper sessions cannot impersonate an external agent session.',
          requestId
        )
      }
    }
  }

  if (agentContext) {
    if (!agentContext.sessionToken) {
      return {
        ok: false,
        error: {
          status: 403,
          body: apiErrorBody(
            apiError,
            'agent_session_token_required',
            `A signed Arro agent session token is required for ${expectedScope}.`,
            requestId
          )
        }
      }
    }

    const session = validateAgentSessionToken({
      agentContext,
      expectedScope,
      signingSecret
    })

    if (!session.ok) {
      return {
        ok: false,
        error: {
          status: session.state === 'unavailable' ? 503 : 403,
          body: apiErrorBody(apiError, session.code, session.message, requestId)
        }
      }
    }

    if (session.state !== 'valid') {
      return {
        ok: false,
        error: {
          status: 403,
          body: apiErrorBody(
            apiError,
            'agent_session_token_required',
            `A signed Arro agent session token is required for ${expectedScope}.`,
            requestId
          )
        }
      }
    }

    agentSessionId = session.sessionId
    agentAllowedActionScopes = session.allowedActionScopes
  }

  if (hasExternalBindingClaim(agentContext) && !agentSessionId) {
    return {
      ok: false,
      error: {
        status: 403,
        body: apiErrorBody(
          apiError,
          'agent_session_token_required',
          `A signed Arro agent session token is required for ${expectedScope}.`,
          requestId
        )
      }
    }
  }

  const integrationId = firstPartyShopper
    ? 'first-party:arro-shopper'
    : agentContext
      ? `agent:${authPrincipal.keyId}:${agentContext.integrationId}`
      : `api-key:${authPrincipal.keyId}`

  return {
    ok: true,
    principal: {
      keyId: authPrincipal.keyId,
      ownerPrincipal: authPrincipal.ownerPrincipal,
      ownerPrincipalHash: hashScoped(
        `owner:${authPrincipal.keyId}:${authPrincipal.ownerPrincipal}`,
        hashPepper
      ),
      integrationId,
      ...(agentContext?.externalSubjectRef
        ? {
            externalSubjectRefHash: hashScoped(
              `subject:${authPrincipal.keyId}:${agentContext.integrationId}:${agentContext.externalSubjectRef}`,
              hashPepper
            )
          }
        : {}),
      ...(agentContext?.externalTaskRef
        ? {
            externalTaskRefHash: hashScoped(
              `task:${authPrincipal.keyId}:${agentContext.integrationId}:${agentContext.externalTaskRef}`,
              hashPepper
            )
          }
        : {}),
      ...(agentContext ? { agentActionScope: expectedScope } : {}),
      ...(agentAllowedActionScopes ? { agentAllowedActionScopes } : {}),
      ...(agentSessionId ? { agentSessionId } : {})
    }
  }
}
