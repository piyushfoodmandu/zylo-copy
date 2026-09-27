import { describe, expect, it, vi } from 'vitest'
import { Elysia } from 'elysia'
import type {
  DataRightsDeletionResponse,
  DataRightsExportResponse
} from '@arro/contracts'
import { buildApp } from './app.ts'
import { hasRequiredScope } from './auth.ts'
import type { DataRightsStore } from './data-rights-service.ts'

const jsonRequest = (
  path: string,
  body: unknown,
  headers?: Record<string, string>
) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  })

const exportResponse = (state: 'access_ready' | 'export_ready'): DataRightsExportResponse => ({
  requestId: 'data-rights-route-test',
  correlationId: 'data-rights-route-correlation',
  state,
  scope: {
    integrationId: 'integration-route-test',
    hasExternalSubjectRef: true
  },
  records: {
    decisionReceipts: [],
    checkoutAttempts: [],
    dataRightsEvents: []
  },
  summary: {
    generatedAt: '2026-07-02T00:00:00.000Z',
    decisionReceiptCount: 0,
    checkoutAttemptCount: 0,
    dataRightsEventCount: 0,
    messages: []
  }
})

const deletionResponse: DataRightsDeletionResponse = {
  requestId: 'data-rights-delete-test',
  correlationId: 'data-rights-delete-correlation',
  state: 'deletion_completed',
  deleted: {
    decisionReceiptCount: 0,
    checkoutAttemptCount: 0
  },
  retained: {
    dataRightsEventCount: 1,
    sourceGovernanceHistory: 'not_in_scope',
    requestAuditLog: 'retained_by_policy'
  },
  event: {
    eventId: 'dre_route_test',
    action: 'deletion',
    status: 'completed',
    target: {
      kind: 'subject_scope'
    },
    createdAt: '2026-07-02T00:00:00.000Z',
    resultSummary: {}
  }
}

const createStore = () => ({
  accessRecords: vi.fn(async () => exportResponse('access_ready')),
  exportRecords: vi.fn(async () => exportResponse('export_ready')),
  recordCorrection: vi.fn(async () => ({
    recorded: false,
    issues: []
  })),
  deleteRecords: vi.fn(async () => deletionResponse)
}) satisfies DataRightsStore

const createDataRightsRouteApp = (store: DataRightsStore) => {
  const auditEvents: any[] = []
  const app = buildApp(new Elysia(), {
    dataRightsStore: store,
    authenticate: async ({ request, requestId, requiredScopes }) => {
      const key = request.headers.get('x-api-key')
      const scopes = key === 'read-key'
        ? ['data-rights:read']
        : key === 'write-key'
          ? ['data-rights:write']
          : []
      const principal = {
        keyId: key ?? 'missing-key',
        ownerPrincipal: 'data-rights-route-test',
        scopes,
        environment: 'test'
      }

      if (!hasRequiredScope(scopes, requiredScopes)) {
        return {
          ok: false,
          decision: 'insufficient_scope',
          status: 403,
          principal,
          body: {
            error: {
              code: 'insufficient_scope',
              message: 'The API key is not authorized for this endpoint.',
              requestId
            }
          }
        }
      }

      return {
        ok: true,
        decision: 'allowed',
        principal
      }
    },
    recordAudit: async (event) => {
      auditEvents.push(event)
    }
  })

  return { app, auditEvents }
}

describe('data-rights routes', () => {
  it('allows read-scoped access and audits only bounded subject metadata', async () => {
    const store = createStore()
    const { app, auditEvents } = createDataRightsRouteApp(store)
    const response = await app.handle(jsonRequest('/v1/data-rights/access', {
      integrationId: 'integration-route-test',
      externalSubjectRef: 'subject-secret-route-test'
    }, {
      'x-api-key': 'read-key'
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.state).toBe('access_ready')
    expect(store.accessRecords).toHaveBeenCalledOnce()
    expect(store.accessRecords).toHaveBeenCalledWith(
      {
        integrationId: 'integration-route-test',
        externalSubjectRef: 'subject-secret-route-test'
      },
      expect.objectContaining({
        requestId: expect.any(String),
        correlationId: expect.any(String)
      })
    )
    expect(auditEvents.at(-1)).toMatchObject({
      routeGroup: 'data_rights_access',
      statusCode: 200,
      reasonCode: 'data_rights_access_ready',
      requiredScopes: ['data-rights:read'],
      metadata: {
        hasExternalSubjectRef: true
      }
    })
    expect(JSON.stringify(auditEvents)).not.toContain('subject-secret-route-test')
  })

  it('requires write scope before deletion handler execution', async () => {
    const store = createStore()
    const { app, auditEvents } = createDataRightsRouteApp(store)
    const response = await app.handle(jsonRequest('/v1/data-rights/delete', {
      integrationId: 'integration-route-test',
      externalSubjectRef: 'subject-delete-route-test'
    }, {
      'x-api-key': 'read-key'
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('insufficient_scope')
    expect(store.deleteRecords).not.toHaveBeenCalled()
    expect(auditEvents.at(-1)).toMatchObject({
      routeGroup: 'data_rights_deletion',
      statusCode: 403,
      reasonCode: 'insufficient_scope',
      requiredScopes: ['data-rights:write']
    })
  })

  it('allows write-scoped deletion and records bounded audit metadata', async () => {
    const store = createStore()
    const { app, auditEvents } = createDataRightsRouteApp(store)
    const response = await app.handle(jsonRequest('/v1/data-rights/delete', {
      integrationId: 'integration-route-test',
      externalSubjectRef: 'subject-delete-route-test'
    }, {
      'x-api-key': 'write-key'
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.deleted).toEqual({
      decisionReceiptCount: 0,
      checkoutAttemptCount: 0
    })
    expect(body.retained.requestAuditLog).toBe('retained_by_policy')
    expect(store.deleteRecords).toHaveBeenCalledOnce()
    expect(auditEvents.at(-1)).toMatchObject({
      routeGroup: 'data_rights_deletion',
      statusCode: 200,
      reasonCode: 'data_rights_deletion_completed',
      requiredScopes: ['data-rights:write'],
      metadata: {
        hasExternalSubjectRef: true
      }
    })
    expect(JSON.stringify(auditEvents)).not.toContain('subject-delete-route-test')
  })

  it('rejects invalid read bodies before store execution', async () => {
    const store = createStore()
    const { app, auditEvents } = createDataRightsRouteApp(store)
    const response = await app.handle(jsonRequest('/v1/data-rights/export', {
      integrationId: 'integration-route-test'
    }, {
      'x-api-key': 'read-key'
    }))
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.error.code).toBe('validation_failed')
    expect(store.exportRecords).not.toHaveBeenCalled()
    expect(auditEvents.at(-1)).toMatchObject({
      routeGroup: 'data_rights_export',
      statusCode: 422,
      reasonCode: 'validation_failed',
      metadata: {
        hasExternalSubjectRef: false
      }
    })
  })
})
