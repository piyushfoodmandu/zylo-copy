import { describe, expect, it } from 'vitest'
import {
  agentActionScopeError,
  agentHostCapabilityError,
  agentSessionExpiryError
} from './agent-invocation.ts'

const apiError = (code: string, message: string, requestId: string) => ({
  error: {
    code,
    message,
    requestId
  }
})

const agentContext = {
  integrationId: 'claude-demo',
  surface: 'claude' as const,
  requestedActionScope: 'read:search' as const,
  hostCapabilities: [
    'source_labels',
    'freshness',
    'caveats',
    'no_buy_warnings',
    'commercial_disclosures',
    'authority_limits',
    'allowed_next_actions'
  ] as const
}

describe('agent invocation policy', () => {
  it('allows matching route scope or absent agent context', () => {
    expect(agentActionScopeError({
      agentContext,
      expectedScope: 'read:search',
      requestId: 'agent-scope-request',
      apiError
    })).toBeUndefined()

    expect(agentActionScopeError({
      agentContext: undefined,
      expectedScope: 'read:search',
      requestId: 'agent-scope-request',
      apiError
    })).toBeUndefined()
  })

  it('rejects agent context whose requested action scope does not match the route', () => {
    expect(agentActionScopeError({
      agentContext,
      expectedScope: 'write:purchase',
      requestId: 'agent-scope-request',
      apiError
    })).toEqual({
      error: {
        code: 'agent_action_scope_denied',
        message: 'Agent context requested read:search, but this route requires write:purchase.',
        requestId: 'agent-scope-request'
      }
    })
  })

  it('rejects agent context when the host cannot preserve required trust signals', () => {
    expect(agentHostCapabilityError({
      agentContext: {
        ...agentContext,
        hostCapabilities: [
          'source_labels',
          'freshness'
        ] as const
      },
      expectedScope: 'read:search',
      requestId: 'agent-capability-request',
      apiError
    })).toEqual({
      error: {
        code: 'agent_host_capability_denied',
        message: 'Agent host does not advertise required trust-signal capabilities for read:search: caveats, no_buy_warnings, commercial_disclosures, authority_limits, allowed_next_actions.',
        requestId: 'agent-capability-request'
      }
    })
  })

  it('rejects expired agent session context without storing session state', () => {
    expect(agentSessionExpiryError({
      agentContext: {
        ...agentContext,
        sessionExpiresAt: '2026-06-23T10:00:00.000Z'
      },
      requestId: 'agent-expiry-request',
      apiError,
      now: new Date('2026-06-23T10:00:01.000Z')
    })).toEqual({
      error: {
        code: 'agent_session_expired',
        message: 'The agent session context is expired.',
        requestId: 'agent-expiry-request'
      }
    })

    expect(agentSessionExpiryError({
      agentContext: {
        ...agentContext,
        sessionExpiresAt: '2026-06-23T10:01:00.000Z'
      },
      requestId: 'agent-expiry-request',
      apiError,
      now: new Date('2026-06-23T10:00:01.000Z')
    })).toBeUndefined()
  })
})
