import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  AgentDiagnosticsRequestSchema,
  type AgentDiagnosticsRequest,
  type AgentDiagnosticsResponse,
  type ApiError,
  type PlainStatusMessage
} from '@arro/contracts'
import {
  agentSessionExpiryError,
  missingAgentHostCapabilities,
  requiredAgentHostCapabilitiesByScope
} from './agent-invocation.ts'
import { validateAgentSessionToken } from './agent-session.ts'

const agentDiagnosticsRequestValidator = TypeCompiler.Compile(
  AgentDiagnosticsRequestSchema
)

type CreateAgentDiagnosticsHandlerOptions = {
  agentSessionSigningSecret?: string | undefined
  apiError: (code: string, message: string, requestId: string) => ApiError
}

export type AgentDiagnosticsHandlerOptions = {
  body: unknown
  requestId: string
  correlationId: string
  set: { status?: number | string }
}

export type AgentDiagnosticsHandler = (
  options: AgentDiagnosticsHandlerOptions
) => Promise<unknown>

const diagnosticsMessage = (
  severity: PlainStatusMessage['severity'],
  code: string,
  text: string,
  nextAction: string
): PlainStatusMessage => ({
  severity,
  code,
  text,
  nextAction
})

export const createAgentDiagnosticsHandler = ({
  agentSessionSigningSecret,
  apiError
}: CreateAgentDiagnosticsHandlerOptions): AgentDiagnosticsHandler => async ({
  body,
  requestId,
  correlationId,
  set
}) => {
  if (!agentDiagnosticsRequestValidator.Check(body)) {
    set.status = 422
    return apiError(
      'validation_failed',
      'The request did not match the API contract.',
      requestId
    )
  }

  const requestBody = body as AgentDiagnosticsRequest
  const { agentContext, expectedActionScope } = requestBody
  const checks: PlainStatusMessage[] = []

  if (agentContext.requestedActionScope !== expectedActionScope) {
    checks.push(diagnosticsMessage(
      'error',
      'agent_action_scope_mismatch',
      `Agent context requested ${agentContext.requestedActionScope}, but the expected route requires ${expectedActionScope}.`,
      'Retry with the exact action scope required by the Arro route.'
    ))
  }

  const missingHostCapabilities = missingAgentHostCapabilities({
    agentContext,
    expectedScope: expectedActionScope
  })

  if (missingHostCapabilities.length > 0) {
    checks.push(diagnosticsMessage(
      'error',
      'agent_host_capabilities_missing',
      `Agent host is missing required trust-signal capabilities: ${missingHostCapabilities.join(', ')}.`,
      'Add the missing source-label, caveat, authority, disclosure, receipt, or allowed-next-action rendering capability before calling the route.'
    ))
  }

  const requiredTrustSignals = requiredAgentHostCapabilitiesByScope[expectedActionScope]
  const renderedTrustSignals = requestBody.renderedTrustSignals
  const missingRenderedTrustSignals = renderedTrustSignals
    ? requiredTrustSignals.filter((capability) => !renderedTrustSignals.includes(capability))
    : []
  const renderingEvidenceState = renderedTrustSignals
    ? missingRenderedTrustSignals.length > 0
      ? 'blocked'
      : 'ready'
    : 'not_supplied'

  if (missingRenderedTrustSignals.length > 0) {
    checks.push(diagnosticsMessage(
      'error',
      'agent_rendering_evidence_missing',
      `Rendered fixture evidence is missing required trust signals: ${missingRenderedTrustSignals.join(', ')}.`,
      'Update the host output fixture so it preserves every required source label, caveat, disclosure, authority limit, receipt, confirmation, and allowed-next-action field before approving the integration.'
    ))
  } else if (renderedTrustSignals) {
    checks.push(diagnosticsMessage(
      'info',
      'agent_rendering_evidence_ready',
      'Rendered fixture evidence preserves the required trust signals for the expected action scope.',
      'Keep this fixture in the host integration package and rerun it when output templates change.'
    ))
  }

  const expiryError = agentSessionExpiryError({
    agentContext,
    requestId,
    apiError
  })

  if (expiryError) {
    checks.push(diagnosticsMessage(
      'error',
      'agent_session_expired',
      'The agent session context is expired.',
      'Start a new scoped agent session before calling Arro routes.'
    ))
  }

  const sessionBinding = validateAgentSessionToken({
    agentContext,
    expectedScope: expectedActionScope,
    signingSecret: agentSessionSigningSecret
  })

  if (!sessionBinding.ok) {
    checks.push(diagnosticsMessage(
      'error',
      sessionBinding.code,
      sessionBinding.message,
      sessionBinding.state === 'unavailable'
        ? 'Configure agent session signing before using signed preview sessions.'
        : 'Issue a fresh scoped agent session token and retry with unchanged integration, subject, task, expiry, scope, and host capability context.'
    ))
  } else if (sessionBinding.state === 'valid') {
    checks.push(diagnosticsMessage(
      'info',
      'agent_session_bound',
      'Agent session token is valid for the expected action scope and declared host context.',
      'Call the matching Arro route with the same session-bound agent context.'
    ))
  }

  if (checks.length === 0) {
    checks.push(diagnosticsMessage(
      'info',
      'agent_diagnostics_ready',
      'Agent context can call the expected action scope with required trust-signal capabilities.',
      'Call the matching Arro route and preserve required source labels, caveats, authority limits, and allowed next actions.'
    ))
  }

  return {
    requestId,
    correlationId,
    state: checks.some((check) => check.severity === 'error') ? 'blocked' : 'ready',
    integrationId: agentContext.integrationId,
    surface: agentContext.surface,
    expectedActionScope,
    requestedActionScope: agentContext.requestedActionScope,
    missingHostCapabilities,
    missingRenderedTrustSignals,
    hasExternalSubjectRef: Boolean(agentContext.externalSubjectRef),
    hasExternalTaskRef: Boolean(agentContext.externalTaskRef),
    hasSessionToken: Boolean(agentContext.sessionToken),
    renderingEvidenceState,
    sessionBindingState: sessionBinding.state,
    checks
  } satisfies AgentDiagnosticsResponse
}
