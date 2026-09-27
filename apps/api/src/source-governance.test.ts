import { describe, expect, it, vi } from 'vitest'
import type { QueryResult, QueryResultRow } from 'pg'
import {
  listAdminTargetBusinesses,
  SourceGovernanceError,
  transitionAdminTargetBusiness
} from './source-governance.ts'
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
      if (!result) throw new Error(`Unexpected source-governance query: ${sql}`)

      return result as QueryResult<Row>
    })
  } satisfies Queryable
}

const businessRow = ({
  businessId = 'allbirds-public-ucp-candidate',
  sourceType = 'direct_ucp',
  launchStatus = 'candidate',
  featureVisibility = 'hidden',
  accessPolicyState = 'profile_fetched',
  label = 'Connector candidate',
  reason = 'A public profile exists, but catalog calls are not approved yet.',
  nextAction = 'Complete approval before live results.'
}: {
  businessId?: string
  sourceType?: string
  launchStatus?: string
  featureVisibility?: string
  accessPolicyState?: string
  label?: string
  reason?: string
  nextAction?: string
} = {}) => ({
  business_id: businessId,
  domain: 'www.allbirds.com',
  display_name: 'Allbirds',
  source_type: sourceType,
  launch_status: launchStatus,
  feature_visibility: featureVisibility,
  access_policy_state: accessPolicyState,
  profile_url: 'https://www.allbirds.com/.well-known/ucp',
  profile_hash: null,
  last_discovered_at: '2026-05-30T00:00:00.000Z',
  next_review_at: '2026-06-30T00:00:00.000Z',
  user_facing_label: label,
  user_facing_reason: reason,
  user_facing_next_action: nextAction
})

const capabilityRows = [{
  business_id: 'allbirds-public-ucp-candidate',
  capability: 'dev.ucp.shopping.catalog.search',
  status: 'discovery_only',
  source: 'arro_discovery',
  notes: 'Observed in public UCP profile.'
}]

const evidenceRows = [{
  business_id: 'allbirds-public-ucp-candidate',
  kind: 'public_readiness_snapshot',
  source: 'repo memory: ucp-discovery.md',
  observed_at: '2026-05-30T00:00:00.000Z',
  expires_at: '2026-06-30T00:00:00.000Z',
  summary: 'Prior probe found public UCP profile.'
}]

const lockedBusinessRow = ({
  sourceType = 'direct_ucp',
  launchStatus = 'candidate',
  featureVisibility = 'hidden',
  accessPolicyState = 'profile_fetched',
  profileHash = 'sha256:source-governance-profile'
}: {
  sourceType?: string
  launchStatus?: string
  featureVisibility?: string
  accessPolicyState?: string
  profileHash?: string | null
} = {}) => ({
  business_id: 'allbirds-public-ucp-candidate',
  domain: 'www.allbirds.com',
  source_type: sourceType,
  launch_status: launchStatus,
  feature_visibility: featureVisibility,
  access_policy_state: accessPolicyState,
  profile_hash: profileHash
})

const transitionRow = ({
  nextLaunchStatus = 'blocked',
  nextFeatureVisibility = 'hidden',
  nextAccessPolicyState = 'profile_fetched',
  linkedConformanceRunId = null
}: {
  nextLaunchStatus?: string
  nextFeatureVisibility?: string
  nextAccessPolicyState?: string
  linkedConformanceRunId?: string | null
} = {}) => ({
  id: '55',
  business_id: 'allbirds-public-ucp-candidate',
  request_id: 'source-governance-request',
  correlation_id: 'source-governance-correlation',
  principal_key_id: 'admin-key',
  owner_principal: 'admin-test',
  previous_launch_status: 'candidate',
  next_launch_status: nextLaunchStatus,
  previous_feature_visibility: 'hidden',
  next_feature_visibility: nextFeatureVisibility,
  previous_access_policy_state: 'profile_fetched',
  next_access_policy_state: nextAccessPolicyState,
  reason_code: 'policy_block',
  reviewer_note: 'Policy review blocked source exposure.',
  linked_discovery_observation_id: null,
  linked_conformance_run_id: linkedConformanceRunId,
  override_applied: false,
  metadata: { verifier: 'source-governance-test' },
  created_at: '2026-05-31T00:00:00.000Z'
})

const conformanceRunRow = ({
  runStatus = 'passed',
  runMode = 'live',
  profileHash = 'sha256:source-governance-profile',
  expiresAt = '2026-06-01T00:00:00.000Z'
}: {
  runStatus?: string
  runMode?: string
  profileHash?: string | null
  expiresAt?: string | null
} = {}) => ({
  id: '77',
  business_id: 'allbirds-public-ucp-candidate',
  request_id: 'conformance-request',
  correlation_id: 'conformance-correlation',
  principal_key_id: 'admin-key',
  owner_principal: 'admin-test',
  linked_discovery_observation_id: '99',
  run_mode: runMode,
  run_status: runStatus,
  profile_hash: profileHash,
  checks_passed: 8,
  checks_failed: runStatus === 'passed' ? 0 : 1,
  check_details: [
    {
      id: 'profile_hash_matches_business',
      status: runStatus === 'passed' ? 'passed' : 'failed',
      message: 'Profile hash check.'
    }
  ],
  capability_coverage: {
    required: ['dev.ucp.shopping.catalog.search'],
    declared: ['dev.ucp.shopping.catalog.search'],
    missing: []
  },
  failure_classification: runStatus === 'passed' ? 'none' : 'profile_hash_mismatch',
  started_at: '2026-05-31T00:00:00.000Z',
  completed_at: '2026-05-31T00:00:00.000Z',
  expires_at: expiresAt,
  reviewer_summary: 'Source governance test conformance run.',
  metadata: { verifier: 'source-governance-test' },
  created_at: '2026-05-31T00:00:00.000Z'
})

const adminPrincipal = {
  keyId: 'admin-key',
  ownerPrincipal: 'admin-test',
  scopes: ['admin:*'],
  environment: 'test'
}

describe('source governance repository', () => {
  it('lists admin target businesses through schema-valid matrix records', async () => {
    const queryable = queryableFromResults([
      queryResult([businessRow(), businessRow({
        businessId: 'shopify-global-catalog-candidate',
        sourceType: 'managed_channel',
        launchStatus: 'outreach',
        accessPolicyState: 'partner_required'
      })]),
      queryResult(capabilityRows),
      queryResult(evidenceRows)
    ])

    const response = await listAdminTargetBusinesses(queryable, {
      requestId: 'admin-list-request',
      correlationId: 'admin-list-correlation',
      filters: {
        accessPolicyState: 'profile_fetched',
        domain: 'allbirds'
      },
      now: new Date('2026-05-31T00:00:00.000Z')
    })

    expect(response.records).toHaveLength(1)
    expect(response.records[0]?.businessId).toBe('allbirds-public-ucp-candidate')
    expect(response.filters).toEqual({
      domain: 'allbirds',
      accessPolicyState: 'profile_fetched'
    })
    expect(response.messages[0]?.code).toBe('admin_source_governance')
  })

  it('uses a row lock, updates safe states, and inserts an append-only transition row', async () => {
    const queryable = queryableFromResults([
      queryResult([lockedBusinessRow()]),
      queryResult([], 1),
      queryResult([transitionRow()], 1),
      queryResult([businessRow({
        launchStatus: 'blocked',
        label: 'Not connected',
        reason: 'An administrative block is recorded for this source.',
        nextAction: 'Complete admin review before retrying discovery, conformance, or source exposure.'
      })]),
      queryResult(capabilityRows),
      queryResult(evidenceRows)
    ])

    const response = await transitionAdminTargetBusiness(queryable, {
      requestId: 'source-governance-request',
      correlationId: 'source-governance-correlation',
      principal: adminPrincipal,
      businessId: 'allbirds-public-ucp-candidate',
      transition: {
        nextLaunchStatus: 'blocked',
        reasonCode: 'policy_block',
        reviewerNote: 'Policy review blocked source exposure.',
        metadata: {
          verifier: 'source-governance-test',
          apiKey: 'must-not-be-stored'
        }
      },
      now: new Date('2026-05-31T00:00:00.000Z')
    })

    expect(response.record.launchStatus).toBe('blocked')
    expect(response.record.featureVisibility).toBe('hidden')
    expect(response.record.accessPolicyState).toBe('profile_fetched')
    expect(response.transition).toMatchObject({
      id: '55',
      businessId: 'allbirds-public-ucp-candidate',
      previousLaunchStatus: 'candidate',
      nextLaunchStatus: 'blocked',
      previousFeatureVisibility: 'hidden',
      nextFeatureVisibility: 'hidden',
      previousAccessPolicyState: 'profile_fetched',
      nextAccessPolicyState: 'profile_fetched',
      reasonCode: 'policy_block',
      principalKeyId: 'admin-key',
      ownerPrincipal: 'admin-test'
    })

    const lockQuery = queryable.query.mock.calls[0]?.[0]
    const insertValues = queryable.query.mock.calls[2]?.[1]

    expect(lockQuery).toContain('for update')
    expect(queryable.query.mock.calls[1]?.[0]).toContain('update target_businesses')
    expect(queryable.query.mock.calls[2]?.[0]).toContain('insert into target_business_state_transitions')
    expect(JSON.stringify(insertValues)).not.toContain('must-not-be-stored')
  })

  it('rejects approval-style transitions without linked conformance authority', async () => {
    const queryable = queryableFromResults([
      queryResult([lockedBusinessRow()])
    ])

    await expect(transitionAdminTargetBusiness(queryable, {
      requestId: 'source-governance-request',
      correlationId: 'source-governance-correlation',
      principal: adminPrincipal,
      businessId: 'allbirds-public-ucp-candidate',
      transition: {
        nextLaunchStatus: 'launch_visible',
        reasonCode: 'conformance_required'
      }
    })).rejects.toMatchObject({
      status: 409,
      code: 'conformance_required'
    } satisfies Partial<SourceGovernanceError>)

    expect(queryable.query).toHaveBeenCalledTimes(1)
    expect(queryable.query.mock.calls[0]?.[0]).toContain('for update')
  })

  it('accepts catalog approval transitions with a current passing live conformance run', async () => {
    const queryable = queryableFromResults([
      queryResult([lockedBusinessRow()]),
      queryResult([conformanceRunRow()]),
      queryResult([], 1),
      queryResult([], 1),
      queryResult([transitionRow({
        nextLaunchStatus: 'launch_visible',
        nextFeatureVisibility: 'catalog_visible',
        nextAccessPolicyState: 'approved',
        linkedConformanceRunId: '77'
      })], 1),
      queryResult([businessRow({
        launchStatus: 'launch_visible',
        featureVisibility: 'catalog_visible',
        accessPolicyState: 'approved',
        label: 'Admin review recorded',
        reason: 'Source authority remains limited until conformance and explicit approval are complete.',
        nextAction: 'Keep discovery, conformance, and policy evidence current before launch exposure.'
      })]),
      queryResult(capabilityRows),
      queryResult(evidenceRows)
    ])

    const response = await transitionAdminTargetBusiness(queryable, {
      requestId: 'source-governance-request',
      correlationId: 'source-governance-correlation',
      principal: adminPrincipal,
      businessId: 'allbirds-public-ucp-candidate',
      transition: {
        nextLaunchStatus: 'launch_visible',
        nextFeatureVisibility: 'catalog_visible',
        nextAccessPolicyState: 'approved',
        reasonCode: 'conformance_required',
        linkedConformanceRunId: '77'
      },
      now: new Date('2026-05-31T00:00:00.000Z')
    })

    expect(response.record.launchStatus).toBe('launch_visible')
    expect(response.record.featureVisibility).toBe('catalog_visible')
    expect(response.record.accessPolicyState).toBe('approved')
    expect(response.transition.linkedConformanceRunId).toBe('77')
    expect(queryable.query.mock.calls[1]?.[0]).toContain('target_business_conformance_runs')
    expect(queryable.query.mock.calls[3]?.[0]).toContain('insert into target_business_capabilities')
    expect(queryable.query.mock.calls[3]?.[1]).toContain('dev.ucp.shopping.catalog.search')
    expect(queryable.query.mock.calls[3]?.[1]).toContain('Approved for catalog search by live conformance run 77; expires 2026-06-01T00:00:00.000Z.')

    const insertValues = queryable.query.mock.calls[4]?.[1]
    expect(insertValues).toContain('77')
  })

  it('rejects expired conformance runs for catalog approval transitions', async () => {
    const queryable = queryableFromResults([
      queryResult([lockedBusinessRow()]),
      queryResult([conformanceRunRow({ expiresAt: '2026-05-30T00:00:00.000Z' })])
    ])

    await expect(transitionAdminTargetBusiness(queryable, {
      requestId: 'source-governance-request',
      correlationId: 'source-governance-correlation',
      principal: adminPrincipal,
      businessId: 'allbirds-public-ucp-candidate',
      transition: {
        nextFeatureVisibility: 'catalog_visible',
        reasonCode: 'conformance_required',
        linkedConformanceRunId: '77'
      },
      now: new Date('2026-05-31T00:00:00.000Z')
    })).rejects.toMatchObject({
      status: 409,
      code: 'conformance_run_expired'
    } satisfies Partial<SourceGovernanceError>)

    expect(queryable.query).toHaveBeenCalledTimes(2)
  })

  it('keeps checkout visibility blocked even with catalog conformance evidence', async () => {
    const queryable = queryableFromResults([
      queryResult([lockedBusinessRow()])
    ])

    await expect(transitionAdminTargetBusiness(queryable, {
      requestId: 'source-governance-request',
      correlationId: 'source-governance-correlation',
      principal: adminPrincipal,
      businessId: 'allbirds-public-ucp-candidate',
      transition: {
        nextFeatureVisibility: 'checkout_visible',
        reasonCode: 'conformance_required',
        linkedConformanceRunId: '77'
      },
      now: new Date('2026-05-31T00:00:00.000Z')
    })).rejects.toMatchObject({
      status: 409,
      code: 'conformance_required'
    } satisfies Partial<SourceGovernanceError>)

    expect(queryable.query).toHaveBeenCalledTimes(1)
  })

  it('rejects linked discovery observations from another business', async () => {
    const queryable = queryableFromResults([
      queryResult([lockedBusinessRow()]),
      queryResult([])
    ])

    await expect(transitionAdminTargetBusiness(queryable, {
      requestId: 'source-governance-request',
      correlationId: 'source-governance-correlation',
      principal: adminPrincipal,
      businessId: 'allbirds-public-ucp-candidate',
      transition: {
        nextAccessPolicyState: 'denied',
        reasonCode: 'unsupported_source',
        linkedDiscoveryObservationId: '999'
      }
    })).rejects.toMatchObject({
      status: 422,
      code: 'invalid_discovery_observation_link'
    } satisfies Partial<SourceGovernanceError>)

    expect(queryable.query).toHaveBeenCalledTimes(2)
    expect(queryable.query.mock.calls[1]?.[0]).toContain('target_business_discovery_observations')
  })
})
