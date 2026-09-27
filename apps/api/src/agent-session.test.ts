import { describe, expect, it } from 'vitest'
import {
  createAgentSessionIssueHandler,
  createAgentSessionToken,
  validateAgentSessionToken
} from './agent-session.ts'
import type {
  AgentSessionIssueRequest,
  AgentTrustSignalCapability
} from '@arro/contracts'

const signingSecret = 'test-agent-session-signing-secret-with-at-least-32-characters'

const hostCapabilities: AgentTrustSignalCapability[] = [
  'source_labels',
  'freshness',
  'caveats',
  'no_buy_warnings',
  'commercial_disclosures',
  'authority_limits',
  'allowed_next_actions',
  'purchase_state'
]

const sessionRequest = {
  integrationId: 'hermes-agent-preview',
  surface: 'hermes_agent',
  allowedActionScopes: ['read:search', 'write:purchase'],
  externalSubjectRef: 'opaque-subject-1',
  externalTaskRef: 'opaque-task-1',
  sessionExpiresAt: '2026-06-24T00:30:00.000Z',
  hostCapabilities
} satisfies AgentSessionIssueRequest

const apiError = (code: string, message: string, requestId: string) => ({
  error: {
    code,
    message,
    requestId
  }
})

describe('agent session signing and validation', () => {
  it('issues a short-lived token bound to integration, subject, task, scope, expiry, and capabilities', () => {
    const issued = createAgentSessionToken({
      request: sessionRequest,
      signingSecret,
      maxTtlSeconds: 1800,
      now: new Date('2026-06-24T00:00:00.000Z'),
      sessionId: 'session-test-1'
    })

    expect(issued.ok).toBe(true)
    if (!issued.ok) return

    expect(issued.session).toMatchObject({
      sessionId: 'session-test-1',
      integrationId: 'hermes-agent-preview',
      surface: 'hermes_agent',
      allowedActionScopes: ['read:search', 'write:purchase'],
      sessionExpiresAt: '2026-06-24T00:30:00.000Z',
      hasExternalSubjectRef: true,
      hasExternalTaskRef: true
    })
    expect(issued.session.sessionToken).toMatch(/^arro_session_v1\./)
    expect(issued.session.sessionToken).not.toContain('opaque-subject-1')
    expect(issued.session.sessionToken).not.toContain('opaque-task-1')

    expect(validateAgentSessionToken({
      agentContext: {
        integrationId: 'hermes-agent-preview',
        surface: 'hermes_agent',
        requestedActionScope: 'read:search',
        externalSubjectRef: 'opaque-subject-1',
        externalTaskRef: 'opaque-task-1',
        sessionExpiresAt: '2026-06-24T00:30:00.000Z',
        sessionToken: issued.session.sessionToken,
        hostCapabilities
      },
      expectedScope: 'read:search',
      signingSecret,
      now: new Date('2026-06-24T00:01:00.000Z')
    })).toEqual({
      ok: true,
      state: 'valid',
      sessionId: 'session-test-1',
      expiresAt: '2026-06-24T00:30:00.000Z',
      allowedActionScopes: ['read:search', 'write:purchase']
    })
  })

  it('rejects token rebinding across action scopes, capabilities, subject refs, and signatures', () => {
    const issued = createAgentSessionToken({
      request: sessionRequest,
      signingSecret,
      maxTtlSeconds: 1800,
      now: new Date('2026-06-24T00:00:00.000Z'),
      sessionId: 'session-test-2'
    })
    if (!issued.ok) throw new Error('Expected session token to be issued.')

    const context = {
      integrationId: 'hermes-agent-preview',
      surface: 'hermes_agent' as const,
      requestedActionScope: 'read:search' as const,
      externalSubjectRef: 'opaque-subject-1',
      externalTaskRef: 'opaque-task-1',
      sessionExpiresAt: '2026-06-24T00:30:00.000Z',
      sessionToken: issued.session.sessionToken,
      hostCapabilities
    }

    expect(validateAgentSessionToken({
      agentContext: {
        ...context,
        requestedActionScope: 'write:complete_purchase'
      },
      expectedScope: 'write:complete_purchase',
      signingSecret,
      now: new Date('2026-06-24T00:01:00.000Z')
    })).toMatchObject({
      ok: false,
      code: 'agent_session_scope_denied'
    })

    expect(validateAgentSessionToken({
      agentContext: {
        ...context,
        hostCapabilities: ['source_labels', 'freshness']
      },
      expectedScope: 'read:search',
      signingSecret,
      now: new Date('2026-06-24T00:01:00.000Z')
    })).toMatchObject({
      ok: false,
      code: 'agent_session_capability_mismatch'
    })

    expect(validateAgentSessionToken({
      agentContext: {
        ...context,
        externalSubjectRef: 'different-subject'
      },
      expectedScope: 'read:search',
      signingSecret,
      now: new Date('2026-06-24T00:01:00.000Z')
    })).toMatchObject({
      ok: false,
      code: 'agent_session_subject_mismatch'
    })

    expect(validateAgentSessionToken({
      agentContext: {
        ...context,
        sessionToken: `${issued.session.sessionToken}tampered`
      },
      expectedScope: 'read:search',
      signingSecret,
      now: new Date('2026-06-24T00:01:00.000Z')
    })).toMatchObject({
      ok: false,
      code: 'agent_session_token_invalid'
    })
  })

  it('rejects expired or overlong session issuance without creating a token', () => {
    expect(createAgentSessionToken({
      request: {
        ...sessionRequest,
        sessionExpiresAt: '2026-06-24T00:31:00.000Z'
      },
      signingSecret,
      maxTtlSeconds: 1800,
      now: new Date('2026-06-24T00:00:00.000Z')
    })).toMatchObject({
      ok: false,
      code: 'agent_session_ttl_exceeded'
    })

    expect(createAgentSessionToken({
      request: sessionRequest,
      signingSecret,
      maxTtlSeconds: 1800,
      now: new Date('2026-06-24T00:31:00.000Z')
    })).toMatchObject({
      ok: false,
      code: 'agent_session_expiry_invalid'
    })
  })

  it('returns bounded API errors from the issue handler when signing is unavailable', async () => {
    const set: { status?: number | string } = {}
    const handler = createAgentSessionIssueHandler({
      maxTtlSeconds: 1800,
      apiError
    })

    await expect(handler({
      body: sessionRequest,
      requestId: 'session-unavailable',
      correlationId: 'session-unavailable',
      set
    })).resolves.toEqual({
      error: {
        code: 'agent_session_signing_unavailable',
        message: 'Agent session token issuance is not configured.',
        requestId: 'session-unavailable'
      }
    })
    expect(set.status).toBe(503)
  })
})
