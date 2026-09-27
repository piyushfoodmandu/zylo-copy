import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  TargetBusinessConformanceRunSchema,
  validationErrorSummary,
  type TargetBusinessConformanceCapabilityCoverage,
  type TargetBusinessConformanceCheck,
  type TargetBusinessConformanceFailureClassification,
  type TargetBusinessConformanceRun,
  type TargetBusinessConformanceRunMode,
  type TargetBusinessConformanceRunStatus
} from '@arro/contracts'
import type { AuthPrincipal } from './auth.ts'
import type { Queryable } from './target-business-repository.ts'

export type RecordTargetBusinessConformanceRunOptions = {
  businessId: string
  requestId: string
  correlationId: string
  principal?: AuthPrincipal
  linkedDiscoveryObservationId?: string
  runMode: TargetBusinessConformanceRunMode
  runStatus: TargetBusinessConformanceRunStatus
  profileHash?: string
  checksPassed: number
  checksFailed: number
  checkDetails: TargetBusinessConformanceCheck[]
  capabilityCoverage: TargetBusinessConformanceCapabilityCoverage
  failureClassification: TargetBusinessConformanceFailureClassification
  startedAt: Date
  completedAt?: Date
  expiresAt?: Date
  reviewerSummary?: string
  metadata?: Record<string, unknown>
}

export type LinkedConformanceValidation =
  | {
      ok: true
      run: TargetBusinessConformanceRun
    }
  | {
      ok: false
      code: 'conformance_run_not_found' | 'conformance_run_wrong_business' | 'conformance_run_not_passed' | 'conformance_run_not_live' | 'conformance_run_expired' | 'conformance_profile_mismatch'
      message: string
    }

type ConformanceRunRow = {
  id: string
  business_id: string
  request_id: string
  correlation_id: string
  principal_key_id: string | null
  owner_principal: string | null
  linked_discovery_observation_id: string | null
  run_mode: TargetBusinessConformanceRunMode
  run_status: TargetBusinessConformanceRunStatus
  profile_hash: string | null
  checks_passed: number
  checks_failed: number
  check_details: unknown
  capability_coverage: unknown
  failure_classification: TargetBusinessConformanceFailureClassification | null
  started_at: Date | string
  completed_at: Date | string | null
  expires_at: Date | string | null
  reviewer_summary: string | null
  metadata: unknown
  created_at: Date | string
}

const runValidator = TypeCompiler.Compile(TargetBusinessConformanceRunSchema)

const optionalString = (value: string | null) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const isoDate = (value: Date | string | null) => {
  if (!value) return undefined

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid conformance timestamp: ${value}`)

  return date.toISOString()
}

const objectRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

const checkDetails = (value: unknown): TargetBusinessConformanceCheck[] =>
  Array.isArray(value)
    ? value.filter((check): check is TargetBusinessConformanceCheck =>
        Boolean(
          check &&
          typeof check === 'object' &&
          typeof (check as TargetBusinessConformanceCheck).id === 'string' &&
          typeof (check as TargetBusinessConformanceCheck).status === 'string' &&
          typeof (check as TargetBusinessConformanceCheck).message === 'string'
        )
      )
    : []

const capabilityCoverage = (value: unknown): TargetBusinessConformanceCapabilityCoverage => {
  const record = objectRecord(value)
  const stringArray = (field: unknown) => Array.isArray(field)
    ? field.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : []

  return {
    required: stringArray(record.required),
    declared: stringArray(record.declared),
    missing: stringArray(record.missing)
  }
}

export const conformanceRunFromRow = (row: ConformanceRunRow): TargetBusinessConformanceRun => {
  const principalKeyId = optionalString(row.principal_key_id)
  const ownerPrincipal = optionalString(row.owner_principal)
  const linkedDiscoveryObservationId = optionalString(row.linked_discovery_observation_id)
  const profileHash = optionalString(row.profile_hash)
  const completedAt = isoDate(row.completed_at)
  const expiresAt = isoDate(row.expires_at)
  const reviewerSummary = optionalString(row.reviewer_summary)
  const run = {
    id: row.id,
    businessId: row.business_id,
    requestId: row.request_id,
    correlationId: row.correlation_id,
    ...(principalKeyId ? { principalKeyId } : {}),
    ...(ownerPrincipal ? { ownerPrincipal } : {}),
    ...(linkedDiscoveryObservationId ? { linkedDiscoveryObservationId } : {}),
    runMode: row.run_mode,
    runStatus: row.run_status,
    ...(profileHash ? { profileHash } : {}),
    checksPassed: Number(row.checks_passed),
    checksFailed: Number(row.checks_failed),
    checkDetails: checkDetails(row.check_details),
    capabilityCoverage: capabilityCoverage(row.capability_coverage),
    failureClassification: row.failure_classification ?? 'internal_error',
    startedAt: isoDate(row.started_at)!,
    ...(completedAt ? { completedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(reviewerSummary ? { reviewerSummary } : {}),
    metadata: objectRecord(row.metadata),
    createdAt: isoDate(row.created_at)!
  }

  if (!runValidator.Check(run)) {
    const errors = validationErrorSummary(runValidator, run)
    throw new Error(`Invalid target-business conformance run from Postgres (${row.id}): ${errors}`)
  }

  return run
}

const rowSelect = `
  id::text,
  business_id,
  request_id,
  correlation_id,
  principal_key_id,
  owner_principal,
  linked_discovery_observation_id::text,
  run_mode,
  run_status,
  profile_hash,
  checks_passed,
  checks_failed,
  check_details,
  capability_coverage,
  failure_classification,
  started_at,
  completed_at,
  expires_at,
  reviewer_summary,
  metadata,
  created_at
`

const insertConformanceEvidence = async (
  client: Queryable,
  run: TargetBusinessConformanceRun
) => {
  if (run.runStatus !== 'passed' || !run.expiresAt) return false

  const source = `target_business_conformance_runs:${run.id}; request:${run.requestId}`
  const summary = `Conformance passed for profile ${run.profileHash ?? 'unknown'} with ${run.checksPassed} passing checks.`
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
      select $1, 'arro_conformance', $2, $3, $4, $5
      where not exists (
        select 1
        from target_business_evidence
        where business_id = $1
          and kind = 'arro_conformance'
          and source = $2
      )
    `,
    [
      run.businessId,
      source,
      run.completedAt ?? run.createdAt,
      run.expiresAt,
      summary
    ]
  )

  return (result.rowCount ?? 0) > 0
}

export const recordTargetBusinessConformanceRun = async (
  client: Queryable,
  options: RecordTargetBusinessConformanceRunOptions
) => {
  const result = await client.query<ConformanceRunRow>(
    `
      insert into target_business_conformance_runs (
        business_id,
        request_id,
        correlation_id,
        principal_key_id,
        owner_principal,
        linked_discovery_observation_id,
        run_mode,
        run_status,
        profile_hash,
        checks_passed,
        checks_failed,
        check_details,
        capability_coverage,
        failure_classification,
        started_at,
        completed_at,
        expires_at,
        reviewer_summary,
        metadata
      ) values ($1, $2, $3, $4, $5, $6::bigint, $7, $8, $9, $10, $11, $12::jsonb, $13::jsonb, $14, $15, $16, $17, $18, $19::jsonb)
      returning ${rowSelect}
    `,
    [
      options.businessId,
      options.requestId,
      options.correlationId,
      options.principal?.keyId ?? null,
      options.principal?.ownerPrincipal ?? null,
      options.linkedDiscoveryObservationId ?? null,
      options.runMode,
      options.runStatus,
      options.profileHash ?? null,
      options.checksPassed,
      options.checksFailed,
      options.checkDetails,
      options.capabilityCoverage,
      options.failureClassification,
      options.startedAt.toISOString(),
      options.completedAt?.toISOString() ?? null,
      options.expiresAt?.toISOString() ?? null,
      options.reviewerSummary ?? null,
      options.metadata ?? {}
    ]
  )
  const row = result.rows[0]
  if (!row) throw new Error('Failed to record target-business conformance run.')

  const run = conformanceRunFromRow(row)
  await insertConformanceEvidence(client, run)
  return run
}

export const listTargetBusinessConformanceRuns = async (
  client: Queryable,
  businessId: string,
  limit = 25
): Promise<TargetBusinessConformanceRun[]> => {
  const result = await client.query<ConformanceRunRow>(
    `
      select ${rowSelect}
      from target_business_conformance_runs
      where business_id = $1
      order by created_at desc, id desc
      limit $2
    `,
    [businessId, limit]
  )

  return result.rows.map(conformanceRunFromRow)
}

export const readTargetBusinessConformanceRun = async (
  client: Queryable,
  conformanceRunId: string
) => {
  const result = await client.query<ConformanceRunRow>(
    `
      select ${rowSelect}
      from target_business_conformance_runs
      where id = $1::bigint
      limit 1
    `,
    [conformanceRunId]
  )
  const row = result.rows[0]
  return row ? conformanceRunFromRow(row) : undefined
}

export const validateLinkedConformanceRunForCatalogAuthority = async (
  client: Queryable,
  options: {
    businessId: string
    linkedConformanceRunId?: string
    currentProfileHash?: string
    now?: Date
  }
): Promise<LinkedConformanceValidation> => {
  if (!options.linkedConformanceRunId) {
    return {
      ok: false,
      code: 'conformance_run_not_found',
      message: 'A linked current passing conformance run is required for this source transition.'
    }
  }

  const run = await readTargetBusinessConformanceRun(client, options.linkedConformanceRunId)
  if (!run) {
    return {
      ok: false,
      code: 'conformance_run_not_found',
      message: 'The linked conformance run was not found.'
    }
  }

  if (run.businessId !== options.businessId) {
    return {
      ok: false,
      code: 'conformance_run_wrong_business',
      message: 'The linked conformance run does not belong to this business.'
    }
  }

  if (run.runStatus !== 'passed') {
    return {
      ok: false,
      code: 'conformance_run_not_passed',
      message: 'The linked conformance run has not passed.'
    }
  }

  if (run.runMode !== 'live') {
    return {
      ok: false,
      code: 'conformance_run_not_live',
      message: 'Fixture conformance runs cannot grant launch or catalog source authority.'
    }
  }

  const expiresAt = run.expiresAt ? new Date(run.expiresAt) : undefined
  if (!expiresAt || expiresAt.getTime() <= (options.now ?? new Date()).getTime()) {
    return {
      ok: false,
      code: 'conformance_run_expired',
      message: 'The linked conformance run is expired or has no expiry.'
    }
  }

  if (!options.currentProfileHash || !run.profileHash || run.profileHash !== options.currentProfileHash) {
    return {
      ok: false,
      code: 'conformance_profile_mismatch',
      message: 'The linked conformance run does not match the current business profile hash.'
    }
  }

  return { ok: true, run }
}
