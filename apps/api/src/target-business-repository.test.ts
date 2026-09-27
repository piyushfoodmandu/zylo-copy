import { describe, expect, it, vi } from 'vitest'
import type { QueryResult, QueryResultRow } from 'pg'
import type { UcpDiscoveryResponse } from '@arro/contracts'
import {
  persistUcpDiscoveryObservation,
  readTargetBusinessRecords,
  type Queryable
} from './target-business-repository.ts'

const fetchedDiscoveryResponse = ({
  domain = 'www.example.com',
  profileHash = 'sha256:test-profile-hash'
}: {
  domain?: string
  profileHash?: string
} = {}): UcpDiscoveryResponse => ({
  requestId: 'repo-discovery-request',
  correlationId: 'repo-discovery-correlation',
  status: 'fetched',
  accessPolicyState: 'profile_fetched',
  domain,
  profileUrl: `https://${domain}/.well-known/ucp`,
  httpStatus: 200,
  fetchedAt: '2026-05-31T00:00:00.000Z',
  evidence: {
    httpsOnly: true,
    redirectsAllowed: false,
    privateNetworkBlocked: true,
    contentType: 'application/json',
    responseBytes: 512,
    latencyMs: 42
  },
  profile: {
    domain,
    profileUrl: `https://${domain}/.well-known/ucp`,
    profileHash,
    profileShape: 'canonical_ucp',
    protocolVersions: ['2026-08-25'],
    supportedVersionUrls: ['https://example.com/v1'],
    services: [
      {
        id: 'catalog',
        transport: 'mcp',
        url: 'https://api.example.com/ucp',
        capabilities: ['dev.ucp.shopping.catalog.search']
      }
    ],
    capabilities: [
      'dev.ucp.shopping.catalog.lookup',
      'dev.ucp.shopping.catalog.search'
    ],
    paymentHandlers: [],
    signingKeyCount: 1,
    cache: {
      cacheControl: 'public, max-age=300',
      maxAgeSeconds: 300,
      internallyCappedMaxAgeSeconds: 300
    },
    dns: {
      hostname: domain,
      checkedAddresses: ['93.184.216.34']
    },
    validatedAt: '2026-05-31T00:00:00.000Z'
  },
  messages: [
    {
      severity: 'info',
      code: 'profile_fetched',
      text: 'The UCP profile was fetched and summarized.'
    }
  ]
})

const failedDiscoveryResponse = (): UcpDiscoveryResponse => ({
  requestId: 'repo-discovery-request',
  correlationId: 'repo-discovery-correlation',
  status: 'not_found',
  accessPolicyState: 'unknown',
  domain: 'unknown.example.com',
  profileUrl: 'https://unknown.example.com/.well-known/ucp',
  httpStatus: 404,
  fetchedAt: '2026-05-31T00:00:00.000Z',
  evidence: {
    httpsOnly: true,
    redirectsAllowed: false,
    privateNetworkBlocked: true,
    contentType: 'text/html',
    latencyMs: 12
  },
  messages: [
    {
      severity: 'warning',
      code: 'profile_not_found',
      text: 'No public UCP profile was found at this business domain.'
    }
  ]
})

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
    query: vi.fn(async <Row extends QueryResultRow>(sql: string, values?: unknown[]) => {
      const result = pendingResults.shift()
      if (!result) throw new Error(`Unexpected repository query: ${sql}`)

      return result as QueryResult<Row>
    })
  } satisfies Queryable
}

describe('target-business repository', () => {
  it('maps grouped Postgres rows into schema-valid target-business records', async () => {
    const queryable = queryableFromResults([
      queryResult([
        {
          business_id: 'allbirds-public-ucp-candidate',
          domain: 'www.allbirds.com',
          display_name: 'Allbirds',
          source_type: 'direct_ucp',
          launch_status: 'candidate',
          feature_visibility: 'hidden',
          access_policy_state: 'profile_fetched',
          profile_url: 'https://www.allbirds.com/.well-known/ucp',
          profile_hash: null,
          last_discovered_at: '2026-05-30T00:00:00.000Z',
          next_review_at: '2026-06-30T00:00:00.000Z',
          user_facing_label: 'Connector candidate',
          user_facing_reason: 'A public profile exists, but catalog calls are not approved yet.',
          user_facing_next_action: 'Complete approval before live results.'
        }
      ]),
      queryResult([
        {
          business_id: 'allbirds-public-ucp-candidate',
          capability: 'dev.ucp.shopping.catalog.search',
          status: 'discovery_only',
          source: 'arro_discovery',
          notes: null
        },
        {
          business_id: 'allbirds-public-ucp-candidate',
          capability: 'dev.ucp.shopping.catalog.lookup',
          status: 'discovery_only',
          source: 'arro_discovery',
          notes: 'Observed in public UCP profile.'
        }
      ]),
      queryResult([
        {
          business_id: 'allbirds-public-ucp-candidate',
          kind: 'public_readiness_snapshot',
          source: 'repo memory: ucp-discovery.md',
          observed_at: '2026-05-30T00:00:00.000Z',
          expires_at: '2026-06-30T00:00:00.000Z',
          summary: 'Prior probe found public UCP profile.'
        }
      ])
    ])

    const records = await readTargetBusinessRecords(queryable)
    const readQueries = queryable.query.mock.calls.map(([sql]) => sql)

    expect(records).toHaveLength(1)
    expect(readQueries[0]).toContain('from target_businesses')
    expect(readQueries[1]).toContain('from target_business_capabilities')
    expect(readQueries[2]).toContain('from target_business_evidence')
    expect(readQueries[2]).toContain('cross join lateral')
    expect(readQueries[2]).toContain("kind = 'arro_conformance'")
    expect(queryable.query.mock.calls[2]?.[1]).toEqual([32])
    expect(records[0]).toMatchObject({
      businessId: 'allbirds-public-ucp-candidate',
      domain: 'www.allbirds.com',
      sourceType: 'direct_ucp',
      launchStatus: 'candidate',
      featureVisibility: 'hidden',
      accessPolicyState: 'profile_fetched',
      lastDiscoveredAt: '2026-05-30T00:00:00.000Z',
      nextReviewAt: '2026-06-30T00:00:00.000Z'
    })
    expect(records[0]!.profileHash).toBeUndefined()
    expect(records[0]!.capabilities).toEqual([
      {
        capability: 'dev.ucp.shopping.catalog.search',
        status: 'discovery_only',
        source: 'arro_discovery'
      },
      {
        capability: 'dev.ucp.shopping.catalog.lookup',
        status: 'discovery_only',
        source: 'arro_discovery',
        notes: 'Observed in public UCP profile.'
      }
    ])
    expect(records[0]!.evidence[0]!.expiresAt).toBe('2026-06-30T00:00:00.000Z')
  })

  it('rejects malformed database rows before they become runtime authority', async () => {
    const queryable = queryableFromResults([
      queryResult([
        {
          business_id: 'broken-business',
          domain: 'example.com',
          display_name: '',
          source_type: 'direct_ucp',
          launch_status: 'candidate',
          feature_visibility: 'hidden',
          access_policy_state: 'profile_fetched',
          profile_url: null,
          profile_hash: null,
          last_discovered_at: null,
          next_review_at: null,
          user_facing_label: 'Broken',
          user_facing_reason: 'This row is intentionally malformed.',
          user_facing_next_action: 'Fix the row.'
        }
      ]),
      queryResult([]),
      queryResult([])
    ])

    await expect(readTargetBusinessRecords(queryable)).rejects.toThrow(
      'Invalid target-business record from Postgres (broken-business)'
    )
  })

  it('persists fetched discovery for an existing business without granting authority', async () => {
    const discoveryResponse = fetchedDiscoveryResponse({ domain: 'www.allbirds.com' })
    const queryable = queryableFromResults([
      queryResult([
        {
          business_id: 'allbirds-public-ucp-candidate',
          source_type: 'direct_ucp',
          launch_status: 'candidate',
          feature_visibility: 'hidden',
          access_policy_state: 'profile_fetched'
        }
      ]),
      queryResult([{ id: '101' }], 1),
      queryResult([], 1),
      queryResult([], 1),
      queryResult([], 1),
      queryResult([], 1)
    ])

    const result = await persistUcpDiscoveryObservation(queryable, {
      requestId: 'repo-discovery-request',
      correlationId: 'repo-discovery-correlation',
      principal: {
        keyId: 'principal-key',
        ownerPrincipal: 'repo-test',
        scopes: ['discovery:write'],
        environment: 'test'
      },
      discoveryResponse
    })

    expect(result).toEqual({
      observationId: '101',
      businessId: 'allbirds-public-ucp-candidate',
      createdBusiness: false,
      capabilitiesUpserted: 2,
      evidenceInserted: true
    })

    const observationCall = queryable.query.mock.calls[1]
    expect(observationCall?.[0]).toContain('target_business_discovery_observations')
    expect(observationCall?.[1]?.[2]).toBe('principal-key')
    expect(observationCall?.[1]?.[4]).toBe('allbirds-public-ucp-candidate')
    expect(observationCall?.[1]?.[7]).toBe('fetched')
    expect(observationCall?.[1]?.[9]).toBe('sha256:test-profile-hash')

    const updateBusinessCall = queryable.query.mock.calls[2]
    expect(updateBusinessCall?.[0]).toContain('launch_status = \'blocked\'')
    expect(updateBusinessCall?.[0]).not.toMatch(/then\s+'launch_visible'/)
    expect(updateBusinessCall?.[0]).not.toMatch(/then\s+'catalog_visible'/)
    expect(updateBusinessCall?.[0]).not.toMatch(/then\s+'checkout_visible'/)
  })

  it('creates only a hidden discovery candidate for a newly fetched profile', async () => {
    const discoveryResponse = fetchedDiscoveryResponse({ domain: 'www.new-merchant.example' })
    const queryable = queryableFromResults([
      queryResult([]),
      queryResult([{ id: '202' }], 1),
      queryResult([], 1),
      queryResult([], 1),
      queryResult([], 1),
      queryResult([], 1)
    ])

    const result = await persistUcpDiscoveryObservation(queryable, {
      requestId: 'repo-new-discovery-request',
      correlationId: 'repo-new-discovery-correlation',
      discoveryResponse
    })

    expect(result).toMatchObject({
      observationId: '202',
      businessId: 'direct-ucp-new-merchant-example',
      createdBusiness: true,
      capabilitiesUpserted: 2,
      evidenceInserted: true
    })

    const insertBusinessCall = queryable.query.mock.calls[2]
    expect(insertBusinessCall?.[0]).toContain("'direct_ucp', 'candidate', 'discovery_only', 'profile_fetched'")
    expect(insertBusinessCall?.[0]).not.toContain('approved')
    expect(insertBusinessCall?.[0]).not.toContain('launch_visible')
    expect(insertBusinessCall?.[1]?.[0]).toBe('direct-ucp-new-merchant-example')
  })

  it('persists failed unknown discovery without creating matrix authority', async () => {
    const queryable = queryableFromResults([
      queryResult([]),
      queryResult([{ id: '303' }], 1)
    ])

    const result = await persistUcpDiscoveryObservation(queryable, {
      requestId: 'repo-failed-discovery-request',
      correlationId: 'repo-failed-discovery-correlation',
      discoveryResponse: failedDiscoveryResponse()
    })

    expect(result).toEqual({
      observationId: '303',
      createdBusiness: false,
      capabilitiesUpserted: 0,
      evidenceInserted: false
    })
    expect(queryable.query).toHaveBeenCalledTimes(2)
    expect(queryable.query.mock.calls[1]?.[1]?.[4]).toBeNull()
    expect(queryable.query.mock.calls[1]?.[1]?.[7]).toBe('not_found')
  })
})
