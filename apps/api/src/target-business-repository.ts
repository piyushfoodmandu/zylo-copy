import type { QueryResult, QueryResultRow } from 'pg'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  TargetBusinessRecordSchema,
  validationErrorSummary,
  type UcpDiscoveryResponse,
  type TargetBusinessRecord
} from '@arro/contracts'
import { targetBusinessSeedRecords } from '@arro/connectors'
import type { AuthPrincipal } from './auth.ts'
import { getRuntimeDatabasePool } from './database.ts'

export type Queryable = {
  query<Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[]
  ): Promise<QueryResult<Row>>
}

type TargetBusinessRow = {
  business_id: string
  domain: string
  display_name: string
  source_type: TargetBusinessRecord['sourceType']
  launch_status: TargetBusinessRecord['launchStatus']
  feature_visibility: TargetBusinessRecord['featureVisibility']
  access_policy_state: TargetBusinessRecord['accessPolicyState']
  profile_url: string | null
  profile_hash: string | null
  last_discovered_at: Date | string | null
  next_review_at: Date | string | null
  user_facing_label: string
  user_facing_reason: string
  user_facing_next_action: string
}

type CapabilityRow = {
  business_id: string
  capability: string
  status: TargetBusinessRecord['capabilities'][number]['status']
  source: string
  notes: string | null
}

type EvidenceRow = {
  business_id: string
  kind: TargetBusinessRecord['evidence'][number]['kind']
  source: string
  observed_at: Date | string
  expires_at: Date | string | null
  summary: string
}

export type DiscoveryObservationPersistenceResult = {
  observationId: string
  businessId?: string
  createdBusiness: boolean
  capabilitiesUpserted: number
  evidenceInserted: boolean
}

export type PersistDiscoveryObservationOptions = {
  requestId: string
  correlationId: string
  principal?: AuthPrincipal
  discoveryResponse: UcpDiscoveryResponse
  now?: Date
}

type ExistingBusinessRow = {
  business_id: string
  source_type: TargetBusinessRecord['sourceType']
  launch_status: TargetBusinessRecord['launchStatus']
  feature_visibility: TargetBusinessRecord['featureVisibility']
  access_policy_state: TargetBusinessRecord['accessPolicyState']
}

type ObservationRow = {
  id: string
}

const recordValidator = TypeCompiler.Compile(TargetBusinessRecordSchema)
const runtimeEvidenceHistoryLimitPerBusiness = 32

const optionalString = (value: string | null) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const isoDate = (value: Date | string | null) => {
  if (!value) return undefined

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp from target-business repository: ${value}`)

  return date.toISOString()
}

const rowCount = (result: QueryResult) => result.rowCount ?? 0

const normalizeDomain = (domain: string) => domain.trim().toLowerCase()

const businessIdForDomain = (domain: string) =>
  `direct-ucp-${normalizeDomain(domain)
    .replace(/^www\./, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`

const displayNameForDomain = (domain: string) =>
  normalizeDomain(domain)
    .replace(/^www\./, '')
    .split('.')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || normalizeDomain(domain)

const discoveryEvidenceExpiresAt = (
  discoveryResponse: UcpDiscoveryResponse,
  now: Date
) => {
  const maxAgeSeconds = discoveryResponse.profile?.cache.internallyCappedMaxAgeSeconds
  const ttlSeconds = maxAgeSeconds && maxAgeSeconds > 0 ? maxAgeSeconds : 30 * 24 * 60 * 60

  return new Date(now.getTime() + ttlSeconds * 1000).toISOString()
}

const discoverySummary = (discoveryResponse: UcpDiscoveryResponse) => {
  if (discoveryResponse.status === 'fetched' && discoveryResponse.profile) {
    const capabilityCount = discoveryResponse.profile.capabilities.length
    const serviceCount = discoveryResponse.profile.services.length
    return `Fetched public UCP profile ${discoveryResponse.profile.profileHash} with ${capabilityCount} capabilities and ${serviceCount} services.`
  }

  const message = discoveryResponse.messages[0]?.text ?? 'Discovery did not fetch a usable UCP profile.'
  return `${discoveryResponse.status}: ${message}`
}

const compactDiscoverySource = (observationId: string, requestId: string) =>
  `target_business_discovery_observations:${observationId}; request:${requestId}`

const updateExistingBusinessForDiscovery = async ({
  client,
  businessId,
  discoveryResponse
}: {
  client: Queryable
  businessId: string
  discoveryResponse: UcpDiscoveryResponse
}) => {
  if (discoveryResponse.status !== 'fetched' || !discoveryResponse.profile) return

  await client.query(
    `
      update target_businesses
      set
        access_policy_state = case
          when launch_status = 'blocked' then access_policy_state
          when access_policy_state in ('approved', 'limited', 'denied', 'partner_required') then access_policy_state
          else 'profile_fetched'
        end,
        feature_visibility = case
          when launch_status = 'blocked' then feature_visibility
          when feature_visibility in ('catalog_visible', 'checkout_visible') then feature_visibility
          when feature_visibility = 'hidden' then 'discovery_only'
          else feature_visibility
        end,
        profile_url = $2,
        profile_hash = $3,
        last_discovered_at = $4,
        user_facing_label = case
          when launch_status = 'blocked' then user_facing_label
          when feature_visibility in ('catalog_visible', 'checkout_visible') then user_facing_label
          else 'Discovery recorded'
        end,
        user_facing_reason = case
          when launch_status = 'blocked' then user_facing_reason
          when feature_visibility in ('catalog_visible', 'checkout_visible') then user_facing_reason
          else 'A public UCP profile was observed, but source approval is still unresolved.'
        end,
        user_facing_next_action = case
          when launch_status = 'blocked' then user_facing_next_action
          when feature_visibility in ('catalog_visible', 'checkout_visible') then user_facing_next_action
          else 'Run conformance and complete admin approval before exposing live product results.'
        end,
        updated_at = now()
      where business_id = $1
    `,
    [
      businessId,
      discoveryResponse.profileUrl,
      discoveryResponse.profile.profileHash,
      discoveryResponse.fetchedAt
    ]
  )
}

const insertDiscoveryCandidate = async ({
  client,
  businessId,
  discoveryResponse
}: {
  client: Queryable
  businessId: string
  discoveryResponse: UcpDiscoveryResponse
}) => {
  if (discoveryResponse.status !== 'fetched' || !discoveryResponse.profile) return false

  const result = await client.query(
    `
      insert into target_businesses (
        business_id,
        domain,
        display_name,
        source_type,
        launch_status,
        feature_visibility,
        access_policy_state,
        profile_url,
        profile_hash,
        last_discovered_at,
        next_review_at,
        user_facing_label,
        user_facing_reason,
        user_facing_next_action
      ) values ($1, $2, $3, 'direct_ucp', 'candidate', 'discovery_only', 'profile_fetched', $4, $5, $6, $7, $8, $9, $10)
      on conflict (business_id) do nothing
    `,
    [
      businessId,
      discoveryResponse.domain,
      displayNameForDomain(discoveryResponse.domain),
      discoveryResponse.profileUrl,
      discoveryResponse.profile.profileHash,
      discoveryResponse.fetchedAt,
      discoveryEvidenceExpiresAt(discoveryResponse, new Date(discoveryResponse.fetchedAt)),
      'Discovery recorded',
      'A public UCP profile was observed, but source approval is still unresolved.',
      'Run conformance and complete admin approval before exposing live product results.'
    ]
  )

  return rowCount(result) > 0
}

const upsertDiscoveryCapabilities = async ({
  client,
  businessId,
  discoveryResponse
}: {
  client: Queryable
  businessId: string
  discoveryResponse: UcpDiscoveryResponse
}) => {
  if (discoveryResponse.status !== 'fetched' || !discoveryResponse.profile) return 0

  let upserted = 0

  for (const capability of discoveryResponse.profile.capabilities) {
    upserted += rowCount(await client.query(
      `
        insert into target_business_capabilities (
          business_id,
          capability,
          status,
          source,
          notes
        ) values ($1, $2, 'discovery_only', 'arro_discovery', $3)
        on conflict (business_id, capability, source) do update
        set
          status = case
            when target_business_capabilities.status in ('approved', 'blocked') then target_business_capabilities.status
            else excluded.status
          end,
          notes = excluded.notes,
          updated_at = now()
      `,
      [
        businessId,
        capability,
        `Observed in UCP profile ${discoveryResponse.profile.profileHash}. Approval is still required.`
      ]
    ))
  }

  return upserted
}

const insertDiscoveryEvidence = async ({
  client,
  businessId,
  observationId,
  options
}: {
  client: Queryable
  businessId: string
  observationId: string
  options: PersistDiscoveryObservationOptions
}) => {
  const { discoveryResponse } = options

  if (discoveryResponse.status !== 'fetched' || !discoveryResponse.profile) return false

  const result = await client.query(
    `
      insert into target_business_evidence (
        business_id,
        kind,
        source,
        observed_at,
        expires_at,
        summary
      )
      select $1, 'arro_discovery', $2, $3, $4, $5
      where not exists (
        select 1
        from target_business_evidence
        where business_id = $1
          and kind = 'arro_discovery'
          and source = $2
      )
    `,
    [
      businessId,
      compactDiscoverySource(observationId, options.requestId),
      discoveryResponse.fetchedAt,
      discoveryEvidenceExpiresAt(discoveryResponse, options.now ?? new Date()),
      discoverySummary(discoveryResponse)
    ]
  )

  return rowCount(result) > 0
}

const groupByBusinessId = <Row extends { business_id: string }>(rows: Row[]) => {
  const grouped = new Map<string, Row[]>()

  for (const row of rows) {
    const existing = grouped.get(row.business_id) ?? []
    existing.push(row)
    grouped.set(row.business_id, existing)
  }

  return grouped
}

const toCapabilityRecords = (rows: CapabilityRow[]) =>
  rows.map((row) => {
    const notes = optionalString(row.notes)

    return {
      capability: row.capability,
      status: row.status,
      source: row.source,
      ...(notes ? { notes } : {})
    }
  })

const toEvidenceRecords = (rows: EvidenceRow[]) =>
  rows.map((row) => {
    const expiresAt = isoDate(row.expires_at)

    return {
      kind: row.kind,
      source: row.source,
      observedAt: isoDate(row.observed_at)!,
      ...(expiresAt ? { expiresAt } : {}),
      summary: row.summary
    }
  })

const toTargetBusinessRecord = (
  row: TargetBusinessRow,
  capabilities: CapabilityRow[],
  evidence: EvidenceRow[]
): TargetBusinessRecord => {
  const profileUrl = optionalString(row.profile_url)
  const profileHash = optionalString(row.profile_hash)
  const lastDiscoveredAt = isoDate(row.last_discovered_at)
  const nextReviewAt = isoDate(row.next_review_at)
  const record = {
    businessId: row.business_id,
    domain: row.domain,
    displayName: row.display_name,
    sourceType: row.source_type,
    launchStatus: row.launch_status,
    featureVisibility: row.feature_visibility,
    accessPolicyState: row.access_policy_state,
    ...(profileUrl ? { profileUrl } : {}),
    ...(profileHash ? { profileHash } : {}),
    ...(lastDiscoveredAt ? { lastDiscoveredAt } : {}),
    ...(nextReviewAt ? { nextReviewAt } : {}),
    capabilities: toCapabilityRecords(capabilities),
    evidence: toEvidenceRecords(evidence),
    userFacingStatus: {
      label: row.user_facing_label,
      reason: row.user_facing_reason,
      nextAction: row.user_facing_next_action
    }
  }

  if (!recordValidator.Check(record)) {
    const errors = validationErrorSummary(recordValidator, record)
    throw new Error(`Invalid target-business record from Postgres (${row.business_id}): ${errors}`)
  }

  return record
}

export const readTargetBusinessRecords = async (
  client: Queryable
): Promise<TargetBusinessRecord[]> => {
  const businesses = await client.query<TargetBusinessRow>(`
      select
        business_id,
        domain,
        display_name,
        source_type,
        launch_status,
        feature_visibility,
        access_policy_state,
        profile_url,
        profile_hash,
        last_discovered_at,
        next_review_at,
        user_facing_label,
        user_facing_reason,
        user_facing_next_action
      from target_businesses
      order by business_id asc
    `)
  const capabilities = await client.query<CapabilityRow>(`
      select business_id, capability, status, source, notes
      from target_business_capabilities
      order by business_id asc, capability asc, source asc
    `)
  const evidence = await client.query<EvidenceRow>(
    `
      with bounded_evidence as (
        select
          recent.id,
          recent.business_id,
          recent.kind,
          recent.source,
          recent.observed_at,
          recent.expires_at,
          recent.summary
        from target_businesses business
        cross join lateral (
          select id, business_id, kind, source, observed_at, expires_at, summary
          from target_business_evidence
          where business_id = business.business_id
          order by observed_at desc, id desc
          limit $1
        ) recent

        union all

        select
          conformance.id,
          conformance.business_id,
          conformance.kind,
          conformance.source,
          conformance.observed_at,
          conformance.expires_at,
          conformance.summary
        from target_businesses business
        cross join lateral (
          select id, business_id, kind, source, observed_at, expires_at, summary
          from target_business_evidence
          where business_id = business.business_id
            and kind = 'arro_conformance'
            and expires_at > now()
          order by observed_at desc, id desc
          limit 1
        ) conformance
      ), deduplicated_evidence as (
        select distinct on (business_id, id)
          id, business_id, kind, source, observed_at, expires_at, summary
        from bounded_evidence
        order by business_id asc, id asc, observed_at desc
      )
      select business_id, kind, source, observed_at, expires_at, summary
      from deduplicated_evidence
      order by business_id asc, observed_at desc, id desc
    `,
    [runtimeEvidenceHistoryLimitPerBusiness]
  )
  const capabilitiesByBusinessId = groupByBusinessId(capabilities.rows)
  const evidenceByBusinessId = groupByBusinessId(evidence.rows)

  return businesses.rows.map((business) =>
    toTargetBusinessRecord(
      business,
      capabilitiesByBusinessId.get(business.business_id) ?? [],
      evidenceByBusinessId.get(business.business_id) ?? []
    )
  )
}

export const fetchTargetBusinessRecords = async (
  databaseUrl: string
): Promise<TargetBusinessRecord[]> => readTargetBusinessRecords(getRuntimeDatabasePool(databaseUrl))

export const persistUcpDiscoveryObservation = async (
  client: Queryable,
  options: PersistDiscoveryObservationOptions
): Promise<DiscoveryObservationPersistenceResult> => {
  const { discoveryResponse, principal } = options
  const domain = normalizeDomain(discoveryResponse.domain)
  const existingBusiness = await client.query<ExistingBusinessRow>(
    `
      select business_id, source_type, launch_status, feature_visibility, access_policy_state
      from target_businesses
      where lower(domain) = $1
      order by created_at asc
      limit 1
    `,
    [domain]
  )
  const firstExistingBusiness = existingBusiness.rows[0]
  const candidateBusinessId = firstExistingBusiness?.business_id ??
    (discoveryResponse.status === 'fetched' && discoveryResponse.profile
      ? businessIdForDomain(domain)
      : undefined)
  const profile = discoveryResponse.profile
  const observation = await client.query<ObservationRow>(
    `
      insert into target_business_discovery_observations (
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
        profile_shape,
        protocol_versions,
        supported_version_urls,
        capabilities,
        services,
        payment_handlers,
        signing_key_count,
        cache_summary,
        dns_summary,
        http_status,
        content_type,
        response_bytes,
        latency_ms,
        fetched_at,
        validated_at,
        messages
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17, $18::jsonb, $19::jsonb, $20, $21, $22, $23, $24, $25, $26::jsonb)
      returning id::text as id
    `,
    [
      options.requestId,
      options.correlationId,
      principal?.keyId ?? null,
      principal?.ownerPrincipal ?? null,
      candidateBusinessId ?? null,
      domain,
      discoveryResponse.profileUrl,
      discoveryResponse.status,
      discoveryResponse.accessPolicyState,
      profile?.profileHash ?? null,
      profile?.profileShape ?? null,
      profile?.protocolVersions ?? [],
      profile?.supportedVersionUrls ?? [],
      profile?.capabilities ?? [],
      profile?.services ?? [],
      profile?.paymentHandlers ?? [],
      profile?.signingKeyCount ?? null,
      profile?.cache ?? {},
      profile?.dns ?? {},
      discoveryResponse.httpStatus ?? null,
      discoveryResponse.evidence.contentType ?? null,
      discoveryResponse.evidence.responseBytes ?? null,
      discoveryResponse.evidence.latencyMs ?? null,
      discoveryResponse.fetchedAt,
      profile?.validatedAt ?? null,
      discoveryResponse.messages
    ]
  )
  const observationId = observation.rows[0]?.id
  if (!observationId) throw new Error('Failed to persist UCP discovery observation.')

  let businessId = firstExistingBusiness?.business_id
  let createdBusiness = false

  if (businessId) {
    await updateExistingBusinessForDiscovery({ client, businessId, discoveryResponse })
  } else if (candidateBusinessId) {
    createdBusiness = await insertDiscoveryCandidate({
      client,
      businessId: candidateBusinessId,
      discoveryResponse
    })
    if (createdBusiness) businessId = candidateBusinessId
  }

  const capabilitiesUpserted = businessId
    ? await upsertDiscoveryCapabilities({ client, businessId, discoveryResponse })
    : 0
  const evidenceInserted = businessId
    ? await insertDiscoveryEvidence({ client, businessId, observationId, options })
    : false

  return {
    observationId,
    ...(businessId ? { businessId } : {}),
    createdBusiness,
    capabilitiesUpserted,
    evidenceInserted
  }
}

export const persistRuntimeUcpDiscoveryObservation = async (
  options: PersistDiscoveryObservationOptions,
  databaseUrl?: string
): Promise<DiscoveryObservationPersistenceResult | undefined> => {
  if (!databaseUrl) return undefined

  const pool = getRuntimeDatabasePool(databaseUrl)
  const client = await pool.connect()

  try {
    await client.query('begin')
    const result = await persistUcpDiscoveryObservation(client, options)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}
