import { describe, expect, it, vi } from 'vitest'
import type { QueryResult, QueryResultRow } from 'pg'
import { runTargetBusinessConformance, ConformanceError } from './conformance.ts'
import type { Queryable } from './target-business-repository.ts'

const queryResult = <Row extends QueryResultRow>(rows: Row[], rowCount = rows.length) => ({
  command: 'SELECT',
  fields: [],
  oid: 0,
  rowCount,
  rows
}) satisfies QueryResult<Row>

const queryableFromResults = (results: QueryResult[]) => {
  const pendingResults = [...results]

  return {
    query: vi.fn(async <Row extends QueryResultRow>(sql: string) => {
      const result = pendingResults.shift()
      if (!result) throw new Error(`Unexpected conformance query: ${sql}`)

      return result as QueryResult<Row>
    })
  } satisfies Queryable
}

const businessRow = ({ profileHash = 'sha256:conformance-profile' } = {}) => ({
  business_id: 'allbirds-public-ucp-candidate',
  domain: 'www.allbirds.com',
  profile_hash: profileHash
})

const discoveryRow = ({
  profileHash = 'sha256:conformance-profile',
  capabilities = ['dev.ucp.shopping.catalog.search'],
  services = [
    {
      id: 'catalog',
      transport: 'mcp',
      url: 'https://api.allbirds.example/ucp',
      capabilities: ['dev.ucp.shopping.catalog.search']
    }
  ],
  cacheSummary = {
    cacheControl: 'public, max-age=300',
    maxAgeSeconds: 300,
    internallyCappedMaxAgeSeconds: 300
  }
}: {
  profileHash?: string | null
  capabilities?: string[]
  services?: unknown[]
  cacheSummary?: Record<string, unknown>
} = {}) => ({
  id: '11',
  business_id: 'allbirds-public-ucp-candidate',
  domain: 'www.allbirds.com',
  discovery_status: 'fetched',
  access_policy_state: 'profile_fetched',
  profile_hash: profileHash,
  capabilities,
  services,
  cache_summary: cacheSummary,
  fetched_at: '2026-05-31T00:00:00.000Z',
  created_at: '2026-05-31T00:00:00.000Z'
})

const capabilityRows = [{
  capability: 'dev.ucp.shopping.catalog.search',
  status: 'discovery_only'
}]

const conformanceRunRow = ({
  runStatus = 'passed',
  checksPassed = 8,
  checksFailed = 0,
  profileHash = 'sha256:conformance-profile',
  expiresAt = '2026-05-31T00:05:00.000Z',
  metadata = { verifier: 'conformance-test' }
}: {
  runStatus?: string
  checksPassed?: number
  checksFailed?: number
  profileHash?: string | null
  expiresAt?: string | null
  metadata?: Record<string, unknown>
} = {}) => ({
  id: '77',
  business_id: 'allbirds-public-ucp-candidate',
  request_id: 'conformance-request',
  correlation_id: 'conformance-correlation',
  principal_key_id: 'admin-key',
  owner_principal: 'admin-test',
  linked_discovery_observation_id: '11',
  run_mode: 'live',
  run_status: runStatus,
  profile_hash: profileHash,
  checks_passed: checksPassed,
  checks_failed: checksFailed,
  check_details: [
    {
      id: checksFailed === 0 ? 'profile_hash_matches_business' : 'catalog_capability_declared',
      status: checksFailed === 0 ? 'passed' : 'failed',
      message: checksFailed === 0
        ? 'The discovery profile hash matches the current business profile hash.'
        : 'The UCP profile is missing required catalog search capability declarations.'
    }
  ],
  capability_coverage: {
    required: ['dev.ucp.shopping.catalog.search'],
    declared: checksFailed === 0 ? ['dev.ucp.shopping.catalog.search'] : [],
    missing: checksFailed === 0 ? [] : ['dev.ucp.shopping.catalog.search']
  },
  failure_classification: checksFailed === 0 ? 'none' : 'capability_missing',
  started_at: '2026-05-31T00:00:00.000Z',
  completed_at: '2026-05-31T00:00:00.000Z',
  expires_at: expiresAt,
  reviewer_summary: 'Conformance test run.',
  metadata,
  created_at: '2026-05-31T00:00:00.000Z'
})

const adminPrincipal = {
  keyId: 'admin-key',
  ownerPrincipal: 'admin-test',
  scopes: ['admin:*'],
  environment: 'test'
}

describe('target-business conformance', () => {
  it('records a passing live conformance run with sanitized metadata and evidence', async () => {
    const queryable = queryableFromResults([
      queryResult([businessRow()]),
      queryResult([discoveryRow()]),
      queryResult(capabilityRows),
      queryResult([conformanceRunRow()], 1),
      queryResult([], 1)
    ])

    const response = await runTargetBusinessConformance(queryable, {
      requestId: 'conformance-request',
      correlationId: 'conformance-correlation',
      principal: adminPrincipal,
      businessId: 'allbirds-public-ucp-candidate',
      request: {
        runMode: 'live',
        linkedDiscoveryObservationId: '11',
        reviewerSummary: 'Conformance test run.',
        metadata: {
          verifier: 'conformance-test',
          secretToken: 'must-not-be-stored'
        }
      },
      now: new Date('2026-05-31T00:00:00.000Z')
    })

    expect(response.run.runStatus).toBe('passed')
    expect(response.run.failureClassification).toBe('none')
    expect(response.run.expiresAt).toBeDefined()
    expect(response.run.metadata).toEqual({ verifier: 'conformance-test' })
    expect(queryable.query).toHaveBeenCalledTimes(5)
    expect(queryable.query.mock.calls[3]?.[0]).toContain('insert into target_business_conformance_runs')
    expect(queryable.query.mock.calls[4]?.[0]).toContain('insert into target_business_evidence')
    expect(JSON.stringify(queryable.query.mock.calls[3]?.[1])).not.toContain('must-not-be-stored')
  })

  it('accepts canonical UCP service maps without duplicated service capability arrays', async () => {
    const queryable = queryableFromResults([
      queryResult([businessRow()]),
      queryResult([discoveryRow({
        capabilities: ['dev.ucp.shopping.catalog.search'],
        services: [
          {
            namespace: 'dev.ucp.shopping',
            transport: 'mcp',
            url: 'https://api.allbirds.example/ucp/mcp',
            capabilities: []
          }
        ]
      })]),
      queryResult(capabilityRows),
      queryResult([conformanceRunRow()], 1),
      queryResult([], 1)
    ])

    const response = await runTargetBusinessConformance(queryable, {
      requestId: 'conformance-request',
      correlationId: 'conformance-correlation',
      principal: adminPrincipal,
      businessId: 'allbirds-public-ucp-candidate',
      request: {
        runMode: 'live',
        linkedDiscoveryObservationId: '11'
      },
      now: new Date('2026-05-31T00:00:00.000Z')
    })

    const insertValues = queryable.query.mock.calls[3]?.[1] as unknown[] | undefined
    const checkDetails = insertValues?.[11] as Array<{ id: string, status: string }> | undefined

    expect(response.run.runStatus).toBe('passed')
    expect(checkDetails?.find((check) => check.id === 'catalog_service_public_https')).toMatchObject({
      status: 'passed'
    })
  })

  it('records failed conformance without inserting conformance evidence', async () => {
    const queryable = queryableFromResults([
      queryResult([businessRow()]),
      queryResult([discoveryRow({ capabilities: [] })]),
      queryResult([]),
      queryResult([conformanceRunRow({
        runStatus: 'failed',
        checksPassed: 5,
        checksFailed: 3,
        expiresAt: null
      })], 1)
    ])

    const response = await runTargetBusinessConformance(queryable, {
      requestId: 'conformance-request',
      correlationId: 'conformance-correlation',
      principal: adminPrincipal,
      businessId: 'allbirds-public-ucp-candidate',
      request: {
        runMode: 'live',
        linkedDiscoveryObservationId: '11'
      },
      now: new Date('2026-05-31T00:00:00.000Z')
    })

    expect(response.run.runStatus).toBe('failed')
    expect(response.run.failureClassification).toBe('capability_missing')
    expect(response.run.expiresAt).toBeUndefined()
    expect(queryable.query).toHaveBeenCalledTimes(4)
  })

  it('rejects missing businesses before recording conformance evidence', async () => {
    const queryable = queryableFromResults([
      queryResult([])
    ])

    await expect(runTargetBusinessConformance(queryable, {
      requestId: 'conformance-request',
      correlationId: 'conformance-correlation',
      principal: adminPrincipal,
      businessId: 'missing-business',
      request: { runMode: 'live' }
    })).rejects.toMatchObject({
      status: 404,
      code: 'target_business_not_found'
    } satisfies Partial<ConformanceError>)

    expect(queryable.query).toHaveBeenCalledTimes(1)
  })
})
