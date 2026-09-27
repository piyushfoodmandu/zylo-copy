import type {
  PlainStatusMessage,
  TargetBusinessAdminDetailResponse,
  TargetBusinessAdminFilters,
  TargetBusinessAdminListResponse,
  TargetBusinessAdminTransitionRequest,
  TargetBusinessAdminTransitionResponse,
  TargetBusinessConformanceRun,
  TargetBusinessRecord,
  TargetBusinessStateTransition
} from '@arro/contracts'
import type { AuthPrincipal } from './auth.ts'
import { config } from './config.ts'
import { validateLinkedConformanceRunForCatalogAuthority } from './conformance-repository.ts'
import { getRuntimeDatabasePool } from './database.ts'
import {
  readTargetBusinessRecords,
  type Queryable
} from './target-business-repository.ts'

export type SourceGovernanceListOptions = {
  requestId: string
  correlationId: string
  filters?: TargetBusinessAdminFilters
  now?: Date
}

export type SourceGovernanceDetailOptions = {
  requestId: string
  correlationId: string
  businessId: string
  now?: Date
}

export type SourceGovernanceTransitionOptions = {
  requestId: string
  correlationId: string
  principal: AuthPrincipal
  businessId: string
  transition: TargetBusinessAdminTransitionRequest
  now?: Date
}

export type SourceGovernanceOperations = {
  listBusinesses(options: SourceGovernanceListOptions): Promise<TargetBusinessAdminListResponse>
  getBusinessDetail(options: SourceGovernanceDetailOptions): Promise<TargetBusinessAdminDetailResponse>
  transitionBusiness(options: SourceGovernanceTransitionOptions): Promise<TargetBusinessAdminTransitionResponse>
}

type GovernanceHttpStatus = 404 | 409 | 422

export class SourceGovernanceError extends Error {
  readonly status: GovernanceHttpStatus
  readonly code: string

  constructor(status: GovernanceHttpStatus, code: string, message: string) {
    super(message)
    this.name = 'SourceGovernanceError'
    this.status = status
    this.code = code
  }
}

type TransitionRow = {
  id: string
  business_id: string
  request_id: string
  correlation_id: string
  principal_key_id: string | null
  owner_principal: string | null
  previous_launch_status: TargetBusinessRecord['launchStatus']
  next_launch_status: TargetBusinessRecord['launchStatus']
  previous_feature_visibility: TargetBusinessRecord['featureVisibility']
  next_feature_visibility: TargetBusinessRecord['featureVisibility']
  previous_access_policy_state: TargetBusinessRecord['accessPolicyState']
  next_access_policy_state: TargetBusinessRecord['accessPolicyState']
  reason_code: TargetBusinessStateTransition['reasonCode']
  reviewer_note: string | null
  linked_discovery_observation_id: string | null
  linked_conformance_run_id: string | null
  override_applied: boolean
  metadata: unknown
  created_at: Date | string
}

type DiscoveryObservationRow = {
  id: string
  request_id: string
  correlation_id: string
  principal_key_id: string | null
  owner_principal: string | null
  business_id: string | null
  domain: string
  profile_url: string
  discovery_status: 'fetched' | 'blocked' | 'not_found' | 'invalid_profile' | 'error'
  access_policy_state: TargetBusinessRecord['accessPolicyState']
  profile_hash: string | null
  fetched_at: Date | string
  created_at: Date | string
  messages: unknown
}

type DiscoveryObservationSummary = TargetBusinessAdminDetailResponse['recentDiscoveryObservations'][number]

type LockedBusinessRow = {
  business_id: string
  domain: string
  source_type: TargetBusinessRecord['sourceType']
  launch_status: TargetBusinessRecord['launchStatus']
  feature_visibility: TargetBusinessRecord['featureVisibility']
  access_policy_state: TargetBusinessRecord['accessPolicyState']
  profile_hash: string | null
}

const catalogSearchCapability = 'dev.ucp.shopping.catalog.search'

const governanceMessages = (): PlainStatusMessage[] => [
  {
    severity: 'info',
    code: 'admin_source_governance',
    text: 'Admin source governance views are operational controls and do not grant live source authority by themselves.',
    nextAction: 'Run conformance and record an explicit approval transition before exposing approved catalog sources.'
  }
]

const optionalString = (value: string | null) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const isoDate = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid source governance timestamp: ${value}`)
  return date.toISOString()
}

const objectRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

const messagesFromJson = (value: unknown): PlainStatusMessage[] =>
  Array.isArray(value)
    ? value.filter((message): message is PlainStatusMessage =>
        Boolean(
          message &&
          typeof message === 'object' &&
          typeof (message as PlainStatusMessage).severity === 'string' &&
          typeof (message as PlainStatusMessage).code === 'string' &&
          typeof (message as PlainStatusMessage).text === 'string'
        )
      )
    : []

const transitionFromRow = (row: TransitionRow): TargetBusinessStateTransition => {
  const principalKeyId = optionalString(row.principal_key_id)
  const ownerPrincipal = optionalString(row.owner_principal)
  const reviewerNote = optionalString(row.reviewer_note)
  const linkedDiscoveryObservationId = optionalString(row.linked_discovery_observation_id)
  const linkedConformanceRunId = optionalString(row.linked_conformance_run_id)

  return {
    id: row.id,
    businessId: row.business_id,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    ...(principalKeyId ? { principalKeyId } : {}),
    ...(ownerPrincipal ? { ownerPrincipal } : {}),
    previousLaunchStatus: row.previous_launch_status,
    nextLaunchStatus: row.next_launch_status,
    previousFeatureVisibility: row.previous_feature_visibility,
    nextFeatureVisibility: row.next_feature_visibility,
    previousAccessPolicyState: row.previous_access_policy_state,
    nextAccessPolicyState: row.next_access_policy_state,
    reasonCode: row.reason_code,
    ...(reviewerNote ? { reviewerNote } : {}),
    ...(linkedDiscoveryObservationId ? { linkedDiscoveryObservationId } : {}),
    ...(linkedConformanceRunId ? { linkedConformanceRunId } : {}),
    overrideApplied: row.override_applied,
    metadata: objectRecord(row.metadata),
    createdAt: isoDate(row.created_at)
  }
}

const observationFromRow = (row: DiscoveryObservationRow): DiscoveryObservationSummary => {
  const principalKeyId = optionalString(row.principal_key_id)
  const ownerPrincipal = optionalString(row.owner_principal)
  const businessId = optionalString(row.business_id)
  const profileHash = optionalString(row.profile_hash)

  return {
    id: row.id,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    ...(principalKeyId ? { principalKeyId } : {}),
    ...(ownerPrincipal ? { ownerPrincipal } : {}),
    ...(businessId ? { businessId } : {}),
    domain: row.domain,
    profileUrl: row.profile_url,
    discoveryStatus: row.discovery_status,
    accessPolicyState: row.access_policy_state,
    ...(profileHash ? { profileHash } : {}),
    fetchedAt: isoDate(row.fetched_at),
    createdAt: isoDate(row.created_at),
    messages: messagesFromJson(row.messages)
  }
}

const normalizeFilters = (filters: TargetBusinessAdminFilters = {}): TargetBusinessAdminFilters => {
  const domain = filters.domain?.trim().toLowerCase()

  return {
    ...(domain ? { domain } : {}),
    ...(filters.launchStatus ? { launchStatus: filters.launchStatus } : {}),
    ...(filters.featureVisibility ? { featureVisibility: filters.featureVisibility } : {}),
    ...(filters.accessPolicyState ? { accessPolicyState: filters.accessPolicyState } : {})
  }
}

const matchesFilters = (
  record: TargetBusinessRecord,
  filters: TargetBusinessAdminFilters
) => {
  if (filters.domain && !record.domain.toLowerCase().includes(filters.domain)) return false
  if (filters.launchStatus && record.launchStatus !== filters.launchStatus) return false
  if (filters.featureVisibility && record.featureVisibility !== filters.featureVisibility) return false
  if (filters.accessPolicyState && record.accessPolicyState !== filters.accessPolicyState) return false
  return true
}

const readTransitions = async (
  client: Queryable,
  businessId: string,
  limit = 25
): Promise<TargetBusinessStateTransition[]> => {
  const result = await client.query<TransitionRow>(
    `
      select
        id::text,
        business_id,
        request_id,
        correlation_id,
        principal_key_id,
        owner_principal,
        previous_launch_status,
        next_launch_status,
        previous_feature_visibility,
        next_feature_visibility,
        previous_access_policy_state,
        next_access_policy_state,
        reason_code,
        reviewer_note,
        linked_discovery_observation_id::text,
        linked_conformance_run_id::text,
        override_applied,
        metadata,
        created_at
      from target_business_state_transitions
      where business_id = $1
      order by created_at desc, id desc
      limit $2
    `,
    [businessId, limit]
  )

  return result.rows.map(transitionFromRow)
}

const readRecentDiscoveryObservations = async (
  client: Queryable,
  record: TargetBusinessRecord,
  limit = 10
) => {
  const result = await client.query<DiscoveryObservationRow>(
    `
      select
        id::text,
        request_id,
        correlation_id,
        principal_key_id,
        owner_principal,
        business_id,
        domain,
        profile_url,
        discovery_status,
        access_policy_state,
        profile_hash,
        fetched_at,
        created_at,
        messages
      from target_business_discovery_observations
      where business_id = $1 or lower(domain) = lower($2)
      order by created_at desc, id desc
      limit $3
    `,
    [record.businessId, record.domain, limit]
  )

  return result.rows.map(observationFromRow)
}

const userFacingStatusFor = ({
  launchStatus,
  accessPolicyState
}: {
  launchStatus: TargetBusinessRecord['launchStatus']
  accessPolicyState: TargetBusinessRecord['accessPolicyState']
}) => {
  if (launchStatus === 'blocked') {
    return {
      label: 'Not connected',
      reason: 'An administrative block is recorded for this source.',
      nextAction: 'Complete admin review before retrying discovery, conformance, or source exposure.'
    }
  }

  if (accessPolicyState === 'denied') {
    return {
      label: 'Not connected',
      reason: 'Source approval was denied during admin review.',
      nextAction: 'Use unsupported fallback behavior until a new approved source path exists.'
    }
  }

  if (accessPolicyState === 'partner_required') {
    return {
      label: 'Partner path required',
      reason: 'This source requires partnership, data-use, or access review before live use.',
      nextAction: 'Complete partner review and conformance before approving catalog exposure.'
    }
  }

  if (accessPolicyState === 'profile_fetched') {
    return {
      label: 'Discovery recorded',
      reason: 'A public UCP profile was observed, but source approval is still unresolved.',
      nextAction: 'Run conformance and complete admin approval before exposing live product results.'
    }
  }

  return {
    label: 'Admin review recorded',
    reason: 'Source authority remains limited until conformance and explicit approval are complete.',
    nextAction: 'Keep discovery, conformance, and policy evidence current before launch exposure.'
  }
}

const sanitizedTransitionMetadata = (metadata: Record<string, unknown> | undefined) => {
  if (!metadata) return {}

  const sanitized: Record<string, unknown> = {}
  const blockedKeyPattern = /(?:authorization|api[-_]?key|password|token|secret|payment|address|body)/i

  for (const [key, value] of Object.entries(metadata)) {
    if (blockedKeyPattern.test(key)) continue
    if (value === undefined) continue
    sanitized[key] = value
  }

  return sanitized
}

const assertLinkedDiscoveryObservation = async ({
  client,
  linkedDiscoveryObservationId,
  businessId,
  domain
}: {
  client: Queryable
  linkedDiscoveryObservationId?: string
  businessId: string
  domain: string
}) => {
  if (!linkedDiscoveryObservationId) return

  const result = await client.query<{ id: string }>(
    `
      select id::text
      from target_business_discovery_observations
      where id = $1::bigint
        and (business_id = $2 or lower(domain) = lower($3))
      limit 1
    `,
    [linkedDiscoveryObservationId, businessId, domain]
  )

  if (!result.rows[0]) {
    throw new SourceGovernanceError(
      422,
      'invalid_discovery_observation_link',
      'The linked discovery observation does not belong to this business.'
    )
  }
}

const assertSafeTransition = async ({
  client,
  current,
  nextLaunchStatus,
  nextFeatureVisibility,
  nextAccessPolicyState,
  linkedConformanceRunId,
  now
}: {
  client: Queryable
  current: LockedBusinessRow
  nextLaunchStatus: TargetBusinessRecord['launchStatus']
  nextFeatureVisibility: TargetBusinessRecord['featureVisibility']
  nextAccessPolicyState: TargetBusinessRecord['accessPolicyState']
  linkedConformanceRunId?: string
  now?: Date
}): Promise<{ conformanceRun?: TargetBusinessConformanceRun }> => {
  let conformanceRun: TargetBusinessConformanceRun | undefined
  const changed =
    current.launch_status !== nextLaunchStatus ||
    current.feature_visibility !== nextFeatureVisibility ||
    current.access_policy_state !== nextAccessPolicyState

  if (!changed) {
    throw new SourceGovernanceError(
      422,
      'no_state_change',
      'At least one source state field must change.'
    )
  }

  if (current.launch_status === 'blocked' && nextLaunchStatus !== 'blocked') {
    throw new SourceGovernanceError(
      409,
      'blocked_source_locked',
      'Blocked sources cannot be unblocked until conformance-backed approval transitions exist.'
    )
  }

  if (nextFeatureVisibility === 'checkout_visible') {
    throw new SourceGovernanceError(
      409,
      'conformance_required',
      'Checkout-visible source states require checkout-specific conformance that is not available yet.'
    )
  }

  if (
    nextLaunchStatus === 'launch_visible' ||
    nextFeatureVisibility === 'catalog_visible' ||
    nextAccessPolicyState === 'approved'
  ) {
    if (!linkedConformanceRunId) {
      throw new SourceGovernanceError(
        409,
        'conformance_required',
        'Launch-visible, catalog-visible, and approved source states require a linked current passing conformance run.'
      )
    }

    const validation = await validateLinkedConformanceRunForCatalogAuthority(client, {
      businessId: current.business_id,
      linkedConformanceRunId,
      ...(current.profile_hash ? { currentProfileHash: current.profile_hash } : {}),
      ...(now ? { now } : {})
    })

    if (!validation.ok) {
      throw new SourceGovernanceError(
        409,
        validation.code,
        validation.message
      )
    }

    conformanceRun = validation.run
  }

  if (linkedConformanceRunId && !(
    nextLaunchStatus === 'launch_visible' ||
    nextFeatureVisibility === 'catalog_visible' ||
    nextAccessPolicyState === 'approved'
  )) {
    throw new SourceGovernanceError(
      422,
      'unexpected_conformance_run_link',
      'Conformance run links are reserved for launch, catalog, or approved source transitions.'
    )
  }

  return conformanceRun ? { conformanceRun } : {}
}

const isCatalogAuthorityTransition = ({
  nextLaunchStatus,
  nextFeatureVisibility,
  nextAccessPolicyState
}: {
  nextLaunchStatus: TargetBusinessRecord['launchStatus']
  nextFeatureVisibility: TargetBusinessRecord['featureVisibility']
  nextAccessPolicyState: TargetBusinessRecord['accessPolicyState']
}) =>
  nextLaunchStatus === 'launch_visible' &&
  nextFeatureVisibility === 'catalog_visible' &&
  nextAccessPolicyState === 'approved'

const upsertConformanceCatalogCapability = async ({
  client,
  businessId,
  conformanceRun,
  now
}: {
  client: Queryable
  businessId: string
  conformanceRun: TargetBusinessConformanceRun
  now: Date
}) => {
  await client.query(
    `
      insert into target_business_capabilities (
        business_id,
        capability,
        status,
        source,
        notes,
        updated_at
      ) values ($1, $2, 'approved', 'arro_conformance', $3, $4)
      on conflict (business_id, capability, source) do update
      set
        status = 'approved',
        notes = excluded.notes,
        updated_at = excluded.updated_at
    `,
    [
      businessId,
      catalogSearchCapability,
      `Approved for catalog search by live conformance run ${conformanceRun.id}; expires ${conformanceRun.expiresAt}.`,
      now.toISOString()
    ]
  )
}

const readRecordById = async (client: Queryable, businessId: string) => {
  const records = await readTargetBusinessRecords(client)
  return records.find((record) => record.businessId === businessId)
}

export const listAdminTargetBusinesses = async (
  client: Queryable,
  options: SourceGovernanceListOptions
): Promise<TargetBusinessAdminListResponse> => {
  const filters = normalizeFilters(options.filters)
  const records = (await readTargetBusinessRecords(client)).filter((record) =>
    matchesFilters(record, filters)
  )

  return {
    requestId: options.requestId,
    correlationId: options.correlationId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    filters,
    records,
    messages: governanceMessages()
  }
}

export const readAdminTargetBusinessDetail = async (
  client: Queryable,
  options: SourceGovernanceDetailOptions
): Promise<TargetBusinessAdminDetailResponse> => {
  const record = await readRecordById(client, options.businessId)

  if (!record) {
    throw new SourceGovernanceError(
      404,
      'target_business_not_found',
      'The requested target business was not found.'
    )
  }

  const [recentDiscoveryObservations, transitions] = await Promise.all([
    readRecentDiscoveryObservations(client, record),
    readTransitions(client, record.businessId)
  ])

  return {
    requestId: options.requestId,
    correlationId: options.correlationId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    record,
    recentDiscoveryObservations,
    transitions,
    messages: governanceMessages()
  }
}

export const transitionAdminTargetBusiness = async (
  client: Queryable,
  options: SourceGovernanceTransitionOptions
): Promise<TargetBusinessAdminTransitionResponse> => {
  const currentResult = await client.query<LockedBusinessRow>(
    `
      select business_id, domain, source_type, launch_status, feature_visibility, access_policy_state, profile_hash
      from target_businesses
      where business_id = $1
      for update
    `,
    [options.businessId]
  )
  const current = currentResult.rows[0]

  if (!current) {
    throw new SourceGovernanceError(
      404,
      'target_business_not_found',
      'The requested target business was not found.'
    )
  }

  const nextLaunchStatus = options.transition.nextLaunchStatus ?? current.launch_status
  const nextFeatureVisibility = options.transition.nextFeatureVisibility ?? current.feature_visibility
  const nextAccessPolicyState = options.transition.nextAccessPolicyState ?? current.access_policy_state
  const transitionTime = options.now ?? new Date()

  const safeTransition = await assertSafeTransition({
    client,
    current,
    nextLaunchStatus,
    nextFeatureVisibility,
    nextAccessPolicyState,
    ...(options.transition.linkedConformanceRunId
      ? { linkedConformanceRunId: options.transition.linkedConformanceRunId }
      : {}),
    now: transitionTime
  })

  await assertLinkedDiscoveryObservation({
    client,
    ...(options.transition.linkedDiscoveryObservationId
      ? { linkedDiscoveryObservationId: options.transition.linkedDiscoveryObservationId }
      : {}),
    businessId: current.business_id,
    domain: current.domain
  })

  const userFacingStatus = userFacingStatusFor({
    launchStatus: nextLaunchStatus,
    accessPolicyState: nextAccessPolicyState
  })
  const metadata = sanitizedTransitionMetadata(options.transition.metadata)
  const reviewerNote = optionalString(options.transition.reviewerNote ?? null) ?? null

  await client.query(
    `
      update target_businesses
      set
        launch_status = $2,
        feature_visibility = $3,
        access_policy_state = $4,
        user_facing_label = $5,
        user_facing_reason = $6,
        user_facing_next_action = $7,
        updated_at = $8
      where business_id = $1
    `,
    [
      current.business_id,
      nextLaunchStatus,
      nextFeatureVisibility,
      nextAccessPolicyState,
      userFacingStatus.label,
      userFacingStatus.reason,
      userFacingStatus.nextAction,
      transitionTime.toISOString()
    ]
  )

  if (
    safeTransition.conformanceRun &&
    isCatalogAuthorityTransition({
      nextLaunchStatus,
      nextFeatureVisibility,
      nextAccessPolicyState
    })
  ) {
    await upsertConformanceCatalogCapability({
      client,
      businessId: current.business_id,
      conformanceRun: safeTransition.conformanceRun,
      now: transitionTime
    })
  }

  const transitionResult = await client.query<TransitionRow>(
    `
      insert into target_business_state_transitions (
        business_id,
        request_id,
        correlation_id,
        principal_key_id,
        owner_principal,
        previous_launch_status,
        next_launch_status,
        previous_feature_visibility,
        next_feature_visibility,
        previous_access_policy_state,
        next_access_policy_state,
        reason_code,
        reviewer_note,
        linked_discovery_observation_id,
        linked_conformance_run_id,
        override_applied,
        metadata,
        created_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::bigint, $15::bigint, false, $16::jsonb, $17)
      returning
        id::text,
        business_id,
        request_id,
        correlation_id,
        principal_key_id,
        owner_principal,
        previous_launch_status,
        next_launch_status,
        previous_feature_visibility,
        next_feature_visibility,
        previous_access_policy_state,
        next_access_policy_state,
        reason_code,
        reviewer_note,
        linked_discovery_observation_id::text,
        linked_conformance_run_id::text,
        override_applied,
        metadata,
        created_at
    `,
    [
      current.business_id,
      options.requestId,
      options.correlationId,
      options.principal.keyId,
      options.principal.ownerPrincipal,
      current.launch_status,
      nextLaunchStatus,
      current.feature_visibility,
      nextFeatureVisibility,
      current.access_policy_state,
      nextAccessPolicyState,
      options.transition.reasonCode,
      reviewerNote,
      options.transition.linkedDiscoveryObservationId ?? null,
      options.transition.linkedConformanceRunId ?? null,
      metadata,
      transitionTime.toISOString()
    ]
  )
  const transition = transitionResult.rows[0]

  if (!transition) throw new Error('Failed to record source governance transition.')

  const record = await readRecordById(client, current.business_id)
  if (!record) throw new Error('Failed to read transitioned target business record.')

  return {
    requestId: options.requestId,
    correlationId: options.correlationId,
    generatedAt: transitionTime.toISOString(),
    record,
    transition: transitionFromRow(transition),
    messages: governanceMessages()
  }
}

export const listRuntimeAdminTargetBusinesses = async (
  options: SourceGovernanceListOptions,
  databaseUrl = config.databaseUrl
) => listAdminTargetBusinesses(getRuntimeDatabasePool(databaseUrl), options)

export const readRuntimeAdminTargetBusinessDetail = async (
  options: SourceGovernanceDetailOptions,
  databaseUrl = config.databaseUrl
) => readAdminTargetBusinessDetail(getRuntimeDatabasePool(databaseUrl), options)

export const transitionRuntimeAdminTargetBusiness = async (
  options: SourceGovernanceTransitionOptions,
  databaseUrl = config.databaseUrl
) => {
  const pool = getRuntimeDatabasePool(databaseUrl)
  const client = await pool.connect()

  try {
    await client.query('begin')
    await client.query('select set_config($1, $2, true)', [
      'statement_timeout',
      String(config.requestTimeoutMs)
    ])
    const result = await transitionAdminTargetBusiness(client, options)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export const runtimeSourceGovernanceOperations = (): SourceGovernanceOperations => ({
  listBusinesses: (options) => listRuntimeAdminTargetBusinesses(options),
  getBusinessDetail: (options) => readRuntimeAdminTargetBusinessDetail(options),
  transitionBusiness: (options) => transitionRuntimeAdminTargetBusiness(options)
})
