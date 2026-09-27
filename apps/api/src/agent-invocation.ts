import type {
  AgentActionScope,
  AgentTrustSignalCapability,
  AgentInvocationContext,
  ApiError
} from '@arro/contracts'

export const requiredAgentHostCapabilitiesByScope = {
  'read:search': [
    'source_labels',
    'freshness',
    'caveats',
    'no_buy_warnings',
    'commercial_disclosures',
    'authority_limits',
    'allowed_next_actions'
  ],
  'read:product_detail': [
    'source_labels',
    'freshness',
    'caveats',
    'no_buy_warnings',
    'commercial_disclosures',
    'authority_limits',
    'allowed_next_actions'
  ],
  'read:compare': [
    'source_labels',
    'freshness',
    'caveats',
    'no_buy_warnings',
    'commercial_disclosures',
    'authority_limits',
    'allowed_next_actions'
  ],
  'read:source_state': [
    'source_labels',
    'freshness',
    'caveats',
    'commercial_disclosures',
    'authority_limits',
    'allowed_next_actions'
  ],
  'read:sanity_check': [
    'source_labels',
    'freshness',
    'caveats',
    'no_buy_warnings',
    'commercial_disclosures',
    'authority_limits',
    'allowed_next_actions'
  ],
  'read:checkout': [
    'source_labels',
    'freshness',
    'caveats',
    'commercial_disclosures',
    'authority_limits',
    'allowed_next_actions',
    'purchase_state'
  ],
  'read:order': [
    'source_labels',
    'freshness',
    'caveats',
    'commercial_disclosures',
    'authority_limits',
    'allowed_next_actions',
    'purchase_state'
  ],
  'read:purchase': [
    'source_labels',
    'freshness',
    'caveats',
    'no_buy_warnings',
    'commercial_disclosures',
    'authority_limits',
    'allowed_next_actions',
    'purchase_state'
  ],
  'write:memory': [
    'source_labels',
    'freshness',
    'caveats',
    'no_buy_warnings',
    'commercial_disclosures',
    'authority_limits',
    'allowed_next_actions',
    'user_confirmation'
  ],
  'write:purchase': [
    'source_labels',
    'freshness',
    'caveats',
    'no_buy_warnings',
    'commercial_disclosures',
    'authority_limits',
    'allowed_next_actions',
    'user_confirmation',
    'purchase_state'
  ],
  'write:complete_purchase': [
    'source_labels',
    'freshness',
    'caveats',
    'no_buy_warnings',
    'commercial_disclosures',
    'authority_limits',
    'allowed_next_actions',
    'user_confirmation',
    'purchase_state'
  ]
} satisfies Record<AgentActionScope, AgentTrustSignalCapability[]>

export const agentActionScopeError = ({
  agentContext,
  expectedScope,
  requestId,
  apiError
}: {
  agentContext: AgentInvocationContext | undefined
  expectedScope: AgentActionScope
  requestId: string
  apiError: (code: string, message: string, requestId: string) => ApiError
}) => {
  if (!agentContext || agentContext.requestedActionScope === expectedScope) {
    return undefined
  }

  return apiError(
    'agent_action_scope_denied',
    `Agent context requested ${agentContext.requestedActionScope}, but this route requires ${expectedScope}.`,
    requestId
  )
}

export const missingAgentHostCapabilities = ({
  agentContext,
  expectedScope
}: {
  agentContext: AgentInvocationContext | undefined
  expectedScope: AgentActionScope
}) => {
  if (!agentContext) return []

  const advertised = new Set(agentContext.hostCapabilities ?? [])
  return requiredAgentHostCapabilitiesByScope[expectedScope].filter(
    (capability) => !advertised.has(capability)
  )
}

export const agentHostCapabilityError = ({
  agentContext,
  expectedScope,
  requestId,
  apiError
}: {
  agentContext: AgentInvocationContext | undefined
  expectedScope: AgentActionScope
  requestId: string
  apiError: (code: string, message: string, requestId: string) => ApiError
}) => {
  const missingCapabilities = missingAgentHostCapabilities({
    agentContext,
    expectedScope
  })

  if (missingCapabilities.length === 0) return undefined

  return apiError(
    'agent_host_capability_denied',
    `Agent host does not advertise required trust-signal capabilities for ${expectedScope}: ${missingCapabilities.join(', ')}.`,
    requestId
  )
}

export const agentSessionExpiryError = ({
  agentContext,
  requestId,
  apiError,
  now = new Date()
}: {
  agentContext: AgentInvocationContext | undefined
  requestId: string
  apiError: (code: string, message: string, requestId: string) => ApiError
  now?: Date
}) => {
  if (!agentContext?.sessionExpiresAt) return undefined

  const expiresAtMs = new Date(agentContext.sessionExpiresAt).getTime()
  if (!Number.isFinite(expiresAtMs) || expiresAtMs > now.getTime()) {
    return undefined
  }

  return apiError(
    'agent_session_expired',
    'The agent session context is expired.',
    requestId
  )
}
