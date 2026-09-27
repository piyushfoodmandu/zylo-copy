import type { ComponentHealthCheck, HealthResponse } from '@arro/contracts'
import { apiVersion } from './config.ts'
import {
  checkApiKeyStoreReadiness,
  checkCommerceMemoryProposalReadiness,
  checkDiscoveryObservationsReadiness,
  checkConformanceReadiness,
  checkPostgresReadiness,
  checkRateLimiterReadiness,
  checkRedisReadiness,
  checkRequestAuditLogReadiness,
  checkSourceGovernanceReadiness,
  checkTargetBusinessMatrixReadiness
} from './dependency-readiness.ts'

export const readinessCheckCacheTtlMs = 1_000

export const createSingleFlightReadinessLoader = (
  loader: () => Promise<ComponentHealthCheck[]>,
  {
    ttlMs = readinessCheckCacheTtlMs,
    now = () => Date.now()
  }: {
    ttlMs?: number
    now?: () => number
  } = {}
) => {
  let cached: { checks: ComponentHealthCheck[]; expiresAt: number } | undefined
  let inFlight: Promise<ComponentHealthCheck[]> | undefined

  return async () => {
    const currentTime = now()
    if (cached && cached.expiresAt > currentTime) return cached.checks
    if (inFlight) return inFlight

    inFlight = loader()
      .then((checks) => {
        cached = { checks, expiresAt: now() + ttlMs }
        return checks
      })
      .finally(() => {
        inFlight = undefined
      })
    return inFlight
  }
}

const apiRuntimeCheck = (): ComponentHealthCheck => ({
  name: 'api-runtime',
  status: 'ok',
  required: true,
  message: `Node ${process.version} is running the API process.`
})

const loadReadinessChecks = async (): Promise<ComponentHealthCheck[]> => {
  try {
    const [postgres, redis, rateLimiter, targetBusinessMatrix, apiKeyStore, requestAuditLog, discoveryObservations, sourceGovernance, conformance, commerceMemoryProposals] = await Promise.all([
      checkPostgresReadiness(),
      checkRedisReadiness(),
      checkRateLimiterReadiness(),
      checkTargetBusinessMatrixReadiness(),
      checkApiKeyStoreReadiness(),
      checkRequestAuditLogReadiness(),
      checkDiscoveryObservationsReadiness(),
      checkSourceGovernanceReadiness(),
      checkConformanceReadiness(),
      checkCommerceMemoryProposalReadiness()
    ])

    return [
      apiRuntimeCheck(),
      postgres,
      targetBusinessMatrix,
      apiKeyStore,
      requestAuditLog,
      discoveryObservations,
      sourceGovernance,
      conformance,
      commerceMemoryProposals,
      redis,
      rateLimiter
    ]
  } catch {
    return [
      apiRuntimeCheck(),
      {
        name: 'readiness-evaluation',
        status: 'fail',
        required: true,
        message: 'Dependency readiness evaluation failed unexpectedly.'
      }
    ]
  }
}

export const buildReadinessChecks = createSingleFlightReadinessLoader(loadReadinessChecks)

export const healthStatusFromChecks = (
  checks: ComponentHealthCheck[]
): HealthResponse['status'] => {
  if (checks.some((check) => check.required && check.status === 'fail')) {
    return 'fail'
  }

  if (checks.some((check) => check.status === 'warn' || check.status === 'fail')) {
    return 'degraded'
  }

  return 'ok'
}

export const buildHealthResponse = ({
  requestId,
  correlationId,
  checks
}: {
  requestId: string
  correlationId: string
  checks: ComponentHealthCheck[]
}): HealthResponse => ({
  service: 'arro-api',
  status: healthStatusFromChecks(checks),
  version: apiVersion,
  runtime: process.version,
  requestId,
  correlationId,
  timestamp: new Date().toISOString(),
  checks
})
