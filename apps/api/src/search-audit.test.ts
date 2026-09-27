import { describe, expect, it, vi } from 'vitest'
import type { QueryResult, QueryResultRow } from 'pg'
import type { CatalogSearchResponse, PlainStatusMessage } from '@arro/contracts'
import type { CatalogSearchSourcePolicy } from '@arro/connectors'
import {
  insertSearchAuditLog,
  searchAuditQueryStorageMode,
  searchCommercialIsolationVersion
} from './search-audit.ts'
import type { Queryable } from './target-business-repository.ts'

const queryable = () => ({
  query: vi.fn(async <Row extends QueryResultRow>() => ({
    command: 'INSERT',
    fields: [],
    oid: 0,
    rowCount: 1,
    rows: []
  }) satisfies QueryResult<Row>)
}) satisfies Queryable

const policyMessage: PlainStatusMessage = {
  severity: 'info',
  code: 'connected_catalog_sources',
  text: 'Results are constrained to configured official catalog connectors.',
  nextAction: 'Connect approved UCP or official catalog sources before showing live results.'
}

const sourcePolicy: CatalogSearchSourcePolicy = {
  sourceMode: 'connected_sources',
  allowedBusinessIds: ['connected-shopify-storefront'],
  message: policyMessage
}

const response: CatalogSearchResponse = {
  requestId: 'search-audit-request',
  correlationId: 'search-audit-correlation',
  sourceMode: 'connected_sources',
  interpretedQuery: {
    raw: 'iphone',
    normalized: 'iphone',
    detectedBrands: ['Apple'],
    detectedCategories: ['Smartphones'],
    constraints: ['Brand: Apple', 'Category: Smartphones']
  },
  state: 'ready',
  items: [],
  messages: [policyMessage],
  fetchedAt: '2026-05-31T00:00:00.000Z'
}

describe('search audit', () => {
  it('inserts bounded commercial-isolation audit fields without sensitive metadata', async () => {
    const client = queryable()

    await insertSearchAuditLog(client, {
      requestId: 'search-audit-request',
      correlationId: 'search-audit-correlation',
      route: '/v1/catalog/search',
      normalizedQuery: 'iphone',
      sourcePolicy,
      response,
      latencyMs: 12.7,
      metadata: {
        verifier: 'search-audit-test',
        secretToken: 'must-not-be-stored'
      }
    })

    expect(client.query).toHaveBeenCalledTimes(1)
    const [sql, values] = client.query.mock.calls[0]!

    expect(sql).toContain('insert into search_audit_logs')
    expect(sql).toContain('payout_fields_accessed')
    expect(values?.[0]).toBe('search-audit-request')
    expect(values?.[2]).toBe('/v1/catalog/search')
    expect(values?.[3]).toMatch(/^[a-f0-9]{64}$/)
    expect(values?.[4]).toBeNull()
    expect(values?.[5]).toBe('connected_sources')
    expect(values?.[7]).toEqual(['connected-shopify-storefront'])
    expect(values?.[9]).toBe('connected_catalog_sources')
    expect(values?.[10]).toBe(searchCommercialIsolationVersion)
    expect(values?.[11]).toBe(12)
    expect(values?.[12]).toEqual({
      verifier: 'search-audit-test',
      queryStorage: searchAuditQueryStorageMode
    })
    expect(JSON.stringify(values)).not.toContain('iphone')
    expect(JSON.stringify(values)).not.toContain('must-not-be-stored')
  })
})
