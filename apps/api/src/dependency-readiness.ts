import { Client } from 'pg'
import { createClient } from 'redis'
import type { ComponentHealthCheck } from '@arro/contracts'
import { config, isProduction } from './config.ts'
import { pingRuntimeRedis } from './redis.ts'

const dependencyRequired = () => isProduction

const missingDependencyCheck = (
  name: string,
  message: string
): ComponentHealthCheck => ({
  name,
  status: dependencyRequired() ? 'fail' : 'warn',
  required: dependencyRequired(),
  message
})

const failedDependencyCheck = (
  name: string,
  message: string
): ComponentHealthCheck => ({
  name,
  status: dependencyRequired() ? 'fail' : 'warn',
  required: dependencyRequired(),
  message
})

const withTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined

  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export const checkPostgresReadiness = async (): Promise<ComponentHealthCheck> => {
  if (!config.databaseUrl) {
    return missingDependencyCheck(
      'postgres',
      'DATABASE_URL is not configured; persistence-backed routes cannot be available in production.'
    )
  }

  const client = new Client({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.dependencyCheckTimeoutMs,
    statement_timeout: config.dependencyCheckTimeoutMs
  })

  try {
    await withTimeout(
      client.connect(),
      config.dependencyCheckTimeoutMs,
      'Postgres connect'
    )
    await withTimeout(
      client.query('select 1'),
      config.dependencyCheckTimeoutMs,
      'Postgres readiness query'
    )

    return {
      name: 'postgres',
      status: 'ok',
      required: dependencyRequired(),
      message: 'Postgres responded to SELECT 1.'
    }
  } catch {
    return failedDependencyCheck(
      'postgres',
      'Postgres readiness check failed.'
    )
  } finally {
    await client.end().catch(() => undefined)
  }
}

export const checkRedisReadiness = async (): Promise<ComponentHealthCheck> => {
  if (!config.redisUrl) {
    return missingDependencyCheck(
      'redis',
      'REDIS_URL is not configured; cache, rate-limit, and request coalescing systems cannot be available in production.'
    )
  }

  const client = createClient({
    url: config.redisUrl,
    socket: {
      connectTimeout: config.dependencyCheckTimeoutMs,
      reconnectStrategy: false
    }
  })

  client.on('error', () => undefined)

  try {
    await withTimeout(
      client.connect(),
      config.dependencyCheckTimeoutMs,
      'Redis connect'
    )
    const pong = await withTimeout(
      client.ping(),
      config.dependencyCheckTimeoutMs,
      'Redis readiness ping'
    )

    return {
      name: 'redis',
      status: pong === 'PONG' ? 'ok' : 'warn',
      required: dependencyRequired(),
      message: pong === 'PONG'
        ? 'Redis responded to PING.'
        : 'Redis responded, but did not return PONG.'
    }
  } catch {
    return failedDependencyCheck(
      'redis',
      'Redis readiness check failed.'
    )
  } finally {
    if (client.isOpen) {
      await client.quit().catch(() => client.disconnect())
    }
  }
}

export const checkTargetBusinessMatrixReadiness = async (): Promise<ComponentHealthCheck> => {
  if (!config.databaseUrl) {
    return {
      name: 'target-business-matrix',
      status: 'skipped',
      required: false,
      message: 'DATABASE_URL is not configured; target-business matrix schema readiness was skipped.'
    }
  }

  const client = new Client({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.dependencyCheckTimeoutMs,
    statement_timeout: config.dependencyCheckTimeoutMs
  })

  try {
    await withTimeout(
      client.connect(),
      config.dependencyCheckTimeoutMs,
      'Postgres connect for target-business matrix readiness'
    )
    const result = await withTimeout(
      client.query<{ table_name: string | null }>(
        "select to_regclass('public.target_businesses')::text as table_name"
      ),
      config.dependencyCheckTimeoutMs,
      'Target-business matrix readiness query'
    )

    if (!result.rows[0]?.table_name) {
      return failedDependencyCheck(
        'target-business-matrix',
        'Target-business matrix schema is missing. Run npm run db:migrate.'
      )
    }

    return {
      name: 'target-business-matrix',
      status: 'ok',
      required: dependencyRequired(),
      message: 'Target-business matrix schema is ready.'
    }
  } catch {
    return failedDependencyCheck(
      'target-business-matrix',
      'Target-business matrix readiness check failed. Run npm run db:migrate.'
    )
  } finally {
    await client.end().catch(() => undefined)
  }
}

export const checkApiKeyStoreReadiness = async (): Promise<ComponentHealthCheck> => {
  if (!config.databaseUrl) {
    return {
      name: 'api-key-store',
      status: 'skipped',
      required: false,
      message: 'DATABASE_URL is not configured; API key store schema readiness was skipped.'
    }
  }

  const client = new Client({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.dependencyCheckTimeoutMs,
    statement_timeout: config.dependencyCheckTimeoutMs
  })

  try {
    await withTimeout(
      client.connect(),
      config.dependencyCheckTimeoutMs,
      'Postgres connect for API key store readiness'
    )
    await withTimeout(
      client.query('select 1 from api_keys limit 1'),
      config.dependencyCheckTimeoutMs,
      'API key store readiness query'
    )

    return {
      name: 'api-key-store',
      status: 'ok',
      required: dependencyRequired(),
      message: 'API key store schema is ready.'
    }
  } catch {
    return failedDependencyCheck(
      'api-key-store',
      'API key store readiness check failed. Run npm run db:migrate.'
    )
  } finally {
    await client.end().catch(() => undefined)
  }
}

export const checkRequestAuditLogReadiness = async (): Promise<ComponentHealthCheck> => {
  if (!config.databaseUrl) {
    return {
      name: 'request-audit-log',
      status: 'skipped',
      required: false,
      message: 'DATABASE_URL is not configured; request audit log schema readiness was skipped.'
    }
  }

  const client = new Client({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.dependencyCheckTimeoutMs,
    statement_timeout: config.dependencyCheckTimeoutMs
  })

  try {
    await withTimeout(
      client.connect(),
      config.dependencyCheckTimeoutMs,
      'Postgres connect for request audit log readiness'
    )
    await withTimeout(
      client.query('select 1 from request_audit_log limit 1'),
      config.dependencyCheckTimeoutMs,
      'Request audit log readiness query'
    )

    return {
      name: 'request-audit-log',
      status: 'ok',
      required: dependencyRequired(),
      message: 'Request audit log schema is ready.'
    }
  } catch {
    return failedDependencyCheck(
      'request-audit-log',
      'Request audit log readiness check failed. Run npm run db:migrate.'
    )
  } finally {
    await client.end().catch(() => undefined)
  }
}

export const checkDiscoveryObservationsReadiness = async (): Promise<ComponentHealthCheck> => {
  if (!config.databaseUrl) {
    return {
      name: 'discovery-observations',
      status: 'skipped',
      required: false,
      message: 'DATABASE_URL is not configured; discovery observation schema readiness was skipped.'
    }
  }

  const client = new Client({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.dependencyCheckTimeoutMs,
    statement_timeout: config.dependencyCheckTimeoutMs
  })

  try {
    await withTimeout(
      client.connect(),
      config.dependencyCheckTimeoutMs,
      'Postgres connect for discovery observations readiness'
    )
    await withTimeout(
      client.query('select 1 from target_business_discovery_observations limit 1'),
      config.dependencyCheckTimeoutMs,
      'Discovery observations readiness query'
    )

    return {
      name: 'discovery-observations',
      status: 'ok',
      required: dependencyRequired(),
      message: 'Discovery observation schema is ready.'
    }
  } catch {
    return failedDependencyCheck(
      'discovery-observations',
      'Discovery observation schema readiness check failed. Run npm run db:migrate.'
    )
  } finally {
    await client.end().catch(() => undefined)
  }
}

export const checkSourceGovernanceReadiness = async (): Promise<ComponentHealthCheck> => {
  if (!config.databaseUrl) {
    return {
      name: 'source-governance',
      status: 'skipped',
      required: false,
      message: 'DATABASE_URL is not configured; source governance schema readiness was skipped.'
    }
  }

  const client = new Client({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.dependencyCheckTimeoutMs,
    statement_timeout: config.dependencyCheckTimeoutMs
  })

  try {
    await withTimeout(
      client.connect(),
      config.dependencyCheckTimeoutMs,
      'Postgres connect for source governance readiness'
    )
    await withTimeout(
      client.query('select 1 from target_business_state_transitions limit 1'),
      config.dependencyCheckTimeoutMs,
      'Source governance readiness query'
    )

    return {
      name: 'source-governance',
      status: 'ok',
      required: dependencyRequired(),
      message: 'Source governance transition ledger schema is ready.'
    }
  } catch {
    return failedDependencyCheck(
      'source-governance',
      'Source governance readiness check failed. Run npm run db:migrate.'
    )
  } finally {
    await client.end().catch(() => undefined)
  }
}

export const checkConformanceReadiness = async (): Promise<ComponentHealthCheck> => {
  if (!config.databaseUrl) {
    return {
      name: 'target-business-conformance',
      status: 'skipped',
      required: false,
      message: 'DATABASE_URL is not configured; conformance schema readiness was skipped.'
    }
  }

  const client = new Client({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.dependencyCheckTimeoutMs,
    statement_timeout: config.dependencyCheckTimeoutMs
  })

  try {
    await withTimeout(
      client.connect(),
      config.dependencyCheckTimeoutMs,
      'Postgres connect for conformance readiness'
    )
    await withTimeout(
      client.query('select 1 from target_business_conformance_runs limit 1'),
      config.dependencyCheckTimeoutMs,
      'Conformance readiness query'
    )

    return {
      name: 'target-business-conformance',
      status: 'ok',
      required: dependencyRequired(),
      message: 'Target-business conformance schema is ready.'
    }
  } catch {
    return failedDependencyCheck(
      'target-business-conformance',
      'Target-business conformance readiness check failed. Run npm run db:migrate.'
    )
  } finally {
    await client.end().catch(() => undefined)
  }
}

export const checkCommerceMemoryProposalReadiness = async (): Promise<ComponentHealthCheck> => {
  if (!config.databaseUrl) {
    return {
      name: 'commerce-memory-proposals',
      status: 'skipped',
      required: false,
      message: 'DATABASE_URL is not configured; commerce memory proposal schema readiness was skipped.'
    }
  }

  const client = new Client({
    connectionString: config.databaseUrl,
    connectionTimeoutMillis: config.dependencyCheckTimeoutMs,
    statement_timeout: config.dependencyCheckTimeoutMs
  })

  try {
    await withTimeout(
      client.connect(),
      config.dependencyCheckTimeoutMs,
      'Postgres connect for commerce memory proposal readiness'
    )
    await withTimeout(
      client.query('select 1 from commerce_memory_proposals limit 1'),
      config.dependencyCheckTimeoutMs,
      'Commerce memory proposal readiness query'
    )
    await withTimeout(
      client.query('select 1 from commerce_memory_proposal_policy_reviews limit 1'),
      config.dependencyCheckTimeoutMs,
      'Commerce memory proposal policy review readiness query'
    )
    await withTimeout(
      client.query('select 1 from commerce_memory_records limit 1'),
      config.dependencyCheckTimeoutMs,
      'Commerce memory record readiness query'
    )
    await withTimeout(
      client.query('select 1 from commerce_memory_record_stale_marks limit 1'),
      config.dependencyCheckTimeoutMs,
      'Commerce memory stale mark readiness query'
    )
    await withTimeout(
      client.query('select 1 from commerce_memory_record_refreshes limit 1'),
      config.dependencyCheckTimeoutMs,
      'Commerce memory refresh readiness query'
    )
    await withTimeout(
      client.query('select 1 from commerce_memory_migration_imports limit 1'),
      config.dependencyCheckTimeoutMs,
      'Commerce memory migration import readiness query'
    )

    return {
      name: 'commerce-memory-proposals',
      status: 'ok',
      required: dependencyRequired(),
      message: 'Commerce memory proposal, policy review, committed record, stale-mark, refresh, and migration import schemas are ready.'
    }
  } catch {
    return failedDependencyCheck(
      'commerce-memory-proposals',
      'Commerce memory proposal readiness check failed. Run npm run db:migrate.'
    )
  } finally {
    await client.end().catch(() => undefined)
  }
}

export const checkRateLimiterReadiness = async (): Promise<ComponentHealthCheck> => {
  if (!config.rateLimitEnabled) {
    return {
      name: 'rate-limiter',
      status: 'skipped',
      required: false,
      message: 'Rate limiting is disabled by configuration.'
    }
  }

  if (!config.redisUrl) {
    return missingDependencyCheck(
      'rate-limiter',
      'REDIS_URL is not configured; rate limiting cannot be enforced.'
    )
  }

  try {
    const pong = await withTimeout(
      pingRuntimeRedis(config.redisUrl),
      config.dependencyCheckTimeoutMs,
      'Rate limiter Redis ping'
    )

    return {
      name: 'rate-limiter',
      status: pong === 'PONG' ? 'ok' : 'warn',
      required: dependencyRequired(),
      message: pong === 'PONG'
        ? 'Runtime Redis rate limiter is ready.'
        : 'Runtime Redis rate limiter responded, but did not return PONG.'
    }
  } catch {
    return failedDependencyCheck(
      'rate-limiter',
      'Runtime Redis rate limiter readiness check failed.'
    )
  }
}
