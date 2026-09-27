import { describe, expect, it, vi } from 'vitest'
import type { QueryResult, QueryResultRow } from 'pg'
import {
  insertRequestAuditLog,
  sanitizeAuditMetadata
} from './audit-log.ts'
import type { Queryable } from './target-business-repository.ts'

const queryResult = <Row extends QueryResultRow>(rows: Row[] = [], rowCount = rows.length) => ({
  command: 'INSERT',
  fields: [],
  oid: 0,
  rowCount,
  rows
}) satisfies QueryResult<Row>

const queryable = () => ({
  query: vi.fn(async <Row extends QueryResultRow>() => queryResult<Row>())
}) satisfies Queryable

describe('request audit log', () => {
  it('removes secret-like metadata before storage', () => {
    expect(sanitizeAuditMetadata({
      route: 'ucp_discovery',
      authorization: 'Bearer secret',
      nested: {
        apiKey: 'plain-key',
        status: 'blocked'
      },
      paymentToken: 'tok_123',
      tags: [{ token: 'hidden', safe: true }]
    })).toEqual({
      route: 'ucp_discovery',
      nested: {
        status: 'blocked'
      },
      tags: [{ safe: true }]
    })
  })

  it('inserts coarse request metadata without raw keys or bodies', async () => {
    const client = queryable()

    await insertRequestAuditLog(client, {
      requestId: 'audit-req',
      correlationId: 'audit-corr',
      principal: {
        keyId: 'key-123',
        ownerPrincipal: 'ops',
        scopes: ['discovery:write'],
        environment: 'test'
      },
      method: 'POST',
      path: '/v1/ucp/discover',
      routeGroup: 'ucp_discovery',
      statusCode: 422,
      decision: 'allowed',
      reasonCode: 'validation_failed',
      requiredScopes: ['discovery:write'],
      latencyMs: 12.5,
      metadata: {
        discoveryStatus: 'blocked',
        apiKey: 'arro_test_secret',
        body: { domain: 'example.com' }
      }
    })

    const [, values] = client.query.mock.calls[0]!
    expect(values).toContain('audit-req')
    expect(values).toContain('key-123')
    expect(values).toContain('/v1/ucp/discover')
    expect(values).toContain('allowed')
    expect(JSON.stringify(values)).not.toContain('arro_test_secret')
    expect(JSON.stringify(values)).not.toContain('example.com')
  })
})