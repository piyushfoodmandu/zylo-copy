import type {
  PlainStatusMessage,
  TargetBusinessConformanceCapabilityCoverage,
  TargetBusinessConformanceCheck,
  TargetBusinessConformanceFailureClassification,
  TargetBusinessConformanceListResponse,
  TargetBusinessConformanceRunMode,
  TargetBusinessConformanceRunResponse,
  TargetBusinessConformanceTriggerRequest,
  TargetBusinessRecord
} from '@arro/contracts'
import type { AuthPrincipal } from './auth.ts'
import { config } from './config.ts'
import { getRuntimeDatabasePool } from './database.ts'
import {
  listTargetBusinessConformanceRuns,
  recordTargetBusinessConformanceRun
} from './conformance-repository.ts'
import type { Queryable } from './target-business-repository.ts'

export type ConformanceRunOptions = {
  requestId: string
  correlationId: string
  principal: AuthPrincipal
  businessId: string
  request: TargetBusinessConformanceTriggerRequest
  now?: Date
}

export type ConformanceListOptions = {
  requestId: string
  correlationId: string
  businessId: string
  now?: Date
}

export type ConformanceOperations = {
  runConformance(options: ConformanceRunOptions): Promise<TargetBusinessConformanceRunResponse>
  listConformanceRuns(options: ConformanceListOptions): Promise<TargetBusinessConformanceListResponse>
}

type ConformanceHttpStatus = 404 | 409 | 422

export class ConformanceError extends Error {
  readonly status: ConformanceHttpStatus
  readonly code: string

  constructor(status: ConformanceHttpStatus, code: string, message: string) {
    super(message)
    this.name = 'ConformanceError'
    this.status = status
    this.code = code
  }
}

type ConformanceBusinessRow = {
  business_id: string
  domain: string
  profile_hash: string | null
}

type DiscoveryObservationRow = {
  id: string
  business_id: string | null
  domain: string
  discovery_status: 'fetched' | 'blocked' | 'not_found' | 'invalid_profile' | 'error'
  access_policy_state: TargetBusinessRecord['accessPolicyState']
  profile_hash: string | null
  capabilities: string[]
  services: unknown
  cache_summary: unknown
  fetched_at: Date | string
  created_at: Date | string
}

type CapabilityRow = {
  capability: string
  status: TargetBusinessRecord['capabilities'][number]['status']
}

const requiredCatalogCapabilities = ['dev.ucp.shopping.catalog.search']
const catalogServiceNamespaces = ['dev.ucp.shopping']

const conformanceMessages = (): PlainStatusMessage[] => [
  {
    severity: 'info',
    code: 'target_business_conformance',
    text: 'Conformance records protocol evidence for source governance. Passing conformance does not approve a source without an explicit admin transition.',
    nextAction: 'Use a current passing live conformance run when recording launch or catalog source authority.'
  }
]

const objectRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

const sanitizeMetadata = (metadata: Record<string, unknown> | undefined) => {
  if (!metadata) return {}

  const sanitized: Record<string, unknown> = {}
  const blockedKeyPattern = /(?:authorization|api[-_]?key|password|token|secret|payment|address|body|commission|payout|affiliate|settlement|margin)/i

  for (const [key, value] of Object.entries(metadata)) {
    if (blockedKeyPattern.test(key)) continue
    if (value === undefined) continue
    sanitized[key] = value
  }

  return sanitized
}

const isoDate = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid conformance date: ${value}`)
  return date.toISOString()
}

const check = (
  id: string,
  status: TargetBusinessConformanceCheck['status'],
  message: string,
  evidence?: Record<string, unknown>
): TargetBusinessConformanceCheck => ({
  id,
  status,
  message,
  ...(evidence && Object.keys(evidence).length > 0 ? { evidence } : {})
})

const stringArray = (value: unknown) => Array.isArray(value)
  ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
  : []

const servicesArray = (value: unknown) => Array.isArray(value)
  ? value.filter((service): service is Record<string, unknown> =>
      Boolean(service && typeof service === 'object' && !Array.isArray(service))
    )
  : []

const serviceNamespace = (service: Record<string, unknown>) =>
  typeof service.namespace === 'string' && service.namespace.trim().length > 0
    ? service.namespace.trim()
    : undefined

const normalizedHost = (url: URL) => url.hostname.toLowerCase()

const isPublicHttpsServiceUrl = (value: unknown) => {
  if (typeof value !== 'string' || value.trim().length === 0) return false

  try {
    const url = new URL(value)
    const host = normalizedHost(url)

    if (url.protocol !== 'https:') return false
    if (host === 'localhost' || host.endsWith('.local')) return false
    if (/^(?:10|127)\./.test(host)) return false
    if (/^172\.(?:1[6-9]|2\d|3[0-1])\./.test(host)) return false
    if (/^192\.168\./.test(host)) return false
    if (host === '0.0.0.0' || host === '::1') return false

    return true
  } catch {
    return false
  }
}

const cacheMaxAgeSeconds = (cacheSummary: unknown) => {
  const cache = objectRecord(cacheSummary)
  const value = cache.internallyCappedMaxAgeSeconds
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined
}

const failureClassificationByCheckId: Record<string, TargetBusinessConformanceFailureClassification> = {
  discovery_observation_present: 'discovery_missing',
  discovery_status_fetched: 'discovery_missing',
  profile_hash_present: 'profile_missing',
  profile_hash_matches_business: 'profile_hash_mismatch',
  catalog_capability_declared: 'capability_missing',
  target_business_capability_recorded: 'capability_missing',
  catalog_service_public_https: 'service_insecure',
  profile_cache_freshness: 'freshness_invalid'
}

const failureClassification = (
  checks: TargetBusinessConformanceCheck[]
): TargetBusinessConformanceFailureClassification => {
  const failed = checks.find((candidate) => candidate.status === 'failed')
  if (!failed) return 'none'

  return failureClassificationByCheckId[failed.id] ?? 'internal_error'
}

const readBusiness = async (
  client: Queryable,
  businessId: string
) => {
  const result = await client.query<ConformanceBusinessRow>(
    `
      select business_id, domain, profile_hash
      from target_businesses
      where business_id = $1
      limit 1
    `,
    [businessId]
  )

  return result.rows[0]
}

const readCapabilities = async (
  client: Queryable,
  businessId: string
) => {
  const result = await client.query<CapabilityRow>(
    `
      select capability, status
      from target_business_capabilities
      where business_id = $1
      order by capability asc, source asc
    `,
    [businessId]
  )

  return result.rows
}

const readDiscoveryObservation = async (
  client: Queryable,
  business: ConformanceBusinessRow,
  linkedDiscoveryObservationId?: string
) => {
  if (linkedDiscoveryObservationId) {
    const result = await client.query<DiscoveryObservationRow>(
      `
        select
          id::text,
          business_id,
          domain,
          discovery_status,
          access_policy_state,
          profile_hash,
          capabilities,
          services,
          cache_summary,
          fetched_at,
          created_at
        from target_business_discovery_observations
        where id = $1::bigint
          and (business_id = $2 or lower(domain) = lower($3))
        limit 1
      `,
      [linkedDiscoveryObservationId, business.business_id, business.domain]
    )

    const row = result.rows[0]
    if (!row) {
      throw new ConformanceError(
        422,
        'invalid_discovery_observation_link',
        'The linked discovery observation does not belong to this business.'
      )
    }

    return row
  }

  const result = await client.query<DiscoveryObservationRow>(
    `
      select
        id::text,
        business_id,
        domain,
        discovery_status,
        access_policy_state,
        profile_hash,
        capabilities,
        services,
        cache_summary,
        fetched_at,
        created_at
      from target_business_discovery_observations
      where (business_id = $1 or lower(domain) = lower($2))
        and discovery_status = 'fetched'
      order by created_at desc, id desc
      limit 1
    `,
    [business.business_id, business.domain]
  )

  return result.rows[0]
}

const buildCapabilityCoverage = (
  discovery: DiscoveryObservationRow | undefined
): TargetBusinessConformanceCapabilityCoverage => {
  const declared = [...new Set(discovery?.capabilities ?? [])].sort((left, right) => left.localeCompare(right))
  const missing = requiredCatalogCapabilities.filter((capability) => !declared.includes(capability))

  return {
    required: requiredCatalogCapabilities,
    declared,
    missing
  }
}

const buildChecks = ({
  business,
  discovery,
  capabilities,
  capabilityCoverage,
  now
}: {
  business: ConformanceBusinessRow
  discovery?: DiscoveryObservationRow
  capabilities: CapabilityRow[]
  capabilityCoverage: TargetBusinessConformanceCapabilityCoverage
  now: Date
}) => {
  const services = servicesArray(discovery?.services)
  const catalogServices = services.filter((service) => {
    const namespace = serviceNamespace(service)
    const capabilities = stringArray(service.capabilities)

    return (
      Boolean(namespace && catalogServiceNamespaces.includes(namespace)) ||
      requiredCatalogCapabilities.every((capability) => capabilities.includes(capability))
    )
  })
  const catalogServiceUrls = catalogServices
    .map((service) => service.url)
    .filter((url): url is string => typeof url === 'string')
  const cacheSeconds = cacheMaxAgeSeconds(discovery?.cache_summary)
  const fetchedAt = discovery ? new Date(discovery.fetched_at) : undefined
  const freshnessAgeMs = fetchedAt && !Number.isNaN(fetchedAt.getTime())
    ? now.getTime() - fetchedAt.getTime()
    : Number.POSITIVE_INFINITY
  const maxFreshnessAgeMs = config.conformanceMaxAgeDays * 24 * 60 * 60 * 1000
  const targetCapability = capabilities.find((capability) =>
    requiredCatalogCapabilities.includes(capability.capability)
  )

  return [
    check(
      'discovery_observation_present',
      discovery ? 'passed' : 'failed',
      discovery
        ? 'A UCP discovery observation is linked to the business.'
        : 'No fetched UCP discovery observation is linked to the business.'
    ),
    check(
      'discovery_status_fetched',
      discovery?.discovery_status === 'fetched' ? 'passed' : 'failed',
      discovery?.discovery_status === 'fetched'
        ? 'The linked discovery observation was fetched successfully.'
        : 'The linked discovery observation was not fetched successfully.',
      discovery ? { discoveryStatus: discovery.discovery_status } : {}
    ),
    check(
      'profile_hash_present',
      business.profile_hash && discovery?.profile_hash ? 'passed' : 'failed',
      business.profile_hash && discovery?.profile_hash
        ? 'The business and discovery observation both include a profile hash.'
        : 'The business and discovery observation must both include a profile hash.'
    ),
    check(
      'profile_hash_matches_business',
      business.profile_hash && discovery?.profile_hash && business.profile_hash === discovery.profile_hash
        ? 'passed'
        : 'failed',
      business.profile_hash && discovery?.profile_hash && business.profile_hash === discovery.profile_hash
        ? 'The discovery profile hash matches the current business profile hash.'
        : 'The discovery profile hash does not match the current business profile hash.'
    ),
    check(
      'catalog_capability_declared',
      capabilityCoverage.missing.length === 0 ? 'passed' : 'failed',
      capabilityCoverage.missing.length === 0
        ? 'The UCP profile declares the required catalog search capability.'
        : 'The UCP profile is missing required catalog search capability declarations.',
      { missingCapabilities: capabilityCoverage.missing }
    ),
    check(
      'target_business_capability_recorded',
      targetCapability && !['blocked', 'not_supported'].includes(targetCapability.status) ? 'passed' : 'failed',
      targetCapability && !['blocked', 'not_supported'].includes(targetCapability.status)
        ? 'The target-business matrix records a non-blocked catalog search capability.'
        : 'The target-business matrix must record a non-blocked catalog search capability.',
      targetCapability ? { status: targetCapability.status } : {}
    ),
    check(
      'catalog_service_public_https',
      catalogServices.length > 0 &&
        catalogServiceUrls.length > 0 &&
        catalogServiceUrls.every(isPublicHttpsServiceUrl)
        ? 'passed'
        : 'failed',
      catalogServices.length > 0 &&
        catalogServiceUrls.length > 0 &&
        catalogServiceUrls.every(isPublicHttpsServiceUrl)
        ? 'Catalog-capable services expose public HTTPS URLs.'
        : 'Catalog-capable services must expose public HTTPS URLs.'
    ),
    check(
      'profile_cache_freshness',
      cacheSeconds !== undefined && cacheSeconds >= 60 && freshnessAgeMs <= maxFreshnessAgeMs
        ? 'passed'
        : 'failed',
      cacheSeconds !== undefined && cacheSeconds >= 60 && freshnessAgeMs <= maxFreshnessAgeMs
        ? 'The discovery cache policy and observation age are acceptable for catalog conformance.'
        : 'The discovery cache policy or observation age is not acceptable for catalog conformance.',
      {
        cacheSeconds: cacheSeconds ?? null,
        maxAgeDays: config.conformanceMaxAgeDays
      }
    )
  ] satisfies TargetBusinessConformanceCheck[]
}

const conformanceExpiry = ({
  checks,
  discovery,
  now
}: {
  checks: TargetBusinessConformanceCheck[]
  discovery?: DiscoveryObservationRow
  now: Date
}) => {
  if (checks.some((candidate) => candidate.status === 'failed')) return undefined

  const cacheSeconds = cacheMaxAgeSeconds(discovery?.cache_summary) ?? config.conformanceMaxAgeDays * 24 * 60 * 60
  const maxSeconds = config.conformanceMaxAgeDays * 24 * 60 * 60
  return new Date(now.getTime() + Math.min(cacheSeconds, maxSeconds) * 1000)
}

const normalizeRunMode = (requested: TargetBusinessConformanceRunMode | undefined) => requested ?? 'live'

export const runTargetBusinessConformance = async (
  client: Queryable,
  options: ConformanceRunOptions
): Promise<TargetBusinessConformanceRunResponse> => {
  const now = options.now ?? new Date()
  const runMode = normalizeRunMode(options.request.runMode)

  if (runMode === 'fixture' && !config.conformanceFixtureModeEnabled) {
    throw new ConformanceError(
      422,
      'fixture_conformance_disabled',
      'Fixture conformance mode is disabled for this environment.'
    )
  }

  const business = await readBusiness(client, options.businessId)
  if (!business) {
    throw new ConformanceError(
      404,
      'target_business_not_found',
      'The requested target business was not found.'
    )
  }

  const [discovery, capabilities] = await Promise.all([
    readDiscoveryObservation(client, business, options.request.linkedDiscoveryObservationId),
    readCapabilities(client, business.business_id)
  ])
  const capabilityCoverage = buildCapabilityCoverage(discovery)
  const checks = buildChecks({
    business,
    ...(discovery ? { discovery } : {}),
    capabilities,
    capabilityCoverage,
    now
  })
  const checksFailed = checks.filter((candidate) => candidate.status === 'failed').length
  const checksPassed = checks.filter((candidate) => candidate.status === 'passed').length
  const completedAt = now
  const expiresAt = conformanceExpiry({
    checks,
    ...(discovery ? { discovery } : {}),
    now
  })
  const profileHash = business.profile_hash ?? discovery?.profile_hash ?? undefined
  const run = await recordTargetBusinessConformanceRun(client, {
    businessId: business.business_id,
    requestId: options.requestId,
    correlationId: options.correlationId,
    principal: options.principal,
    ...(discovery ? { linkedDiscoveryObservationId: discovery.id } : {}),
    runMode,
    runStatus: checksFailed === 0 ? 'passed' : 'failed',
    ...(profileHash ? { profileHash } : {}),
    checksPassed,
    checksFailed,
    checkDetails: checks,
    capabilityCoverage,
    failureClassification: failureClassification(checks),
    startedAt: now,
    completedAt,
    ...(expiresAt ? { expiresAt } : {}),
    ...(options.request.reviewerSummary ? { reviewerSummary: options.request.reviewerSummary } : {}),
    metadata: sanitizeMetadata(options.request.metadata)
  })

  return {
    requestId: options.requestId,
    correlationId: options.correlationId,
    generatedAt: now.toISOString(),
    run,
    messages: conformanceMessages()
  }
}

export const listBusinessConformanceRuns = async (
  client: Queryable,
  options: ConformanceListOptions
): Promise<TargetBusinessConformanceListResponse> => {
  const business = await readBusiness(client, options.businessId)
  if (!business) {
    throw new ConformanceError(
      404,
      'target_business_not_found',
      'The requested target business was not found.'
    )
  }

  const runs = await listTargetBusinessConformanceRuns(client, business.business_id)

  return {
    requestId: options.requestId,
    correlationId: options.correlationId,
    generatedAt: (options.now ?? new Date()).toISOString(),
    businessId: business.business_id,
    runs,
    messages: conformanceMessages()
  }
}

export const runRuntimeTargetBusinessConformance = async (
  options: ConformanceRunOptions,
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
    const result = await runTargetBusinessConformance(client, options)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

export const listRuntimeTargetBusinessConformanceRuns = async (
  options: ConformanceListOptions,
  databaseUrl = config.databaseUrl
) => listBusinessConformanceRuns(getRuntimeDatabasePool(databaseUrl), options)

export const runtimeConformanceOperations = (): ConformanceOperations => ({
  runConformance: (options) => runRuntimeTargetBusinessConformance(options),
  listConformanceRuns: (options) => listRuntimeTargetBusinessConformanceRuns(options)
})
