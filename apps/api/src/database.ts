import { Pool } from 'pg'
import { config } from './config.ts'
import { logger } from './logger.ts'

const runtimePools = new Map<string, Pool>()

export const createDatabasePool = (databaseUrl: string) =>
  new Pool({
    connectionString: databaseUrl,
    max: config.postgresPoolMax,
    idleTimeoutMillis: config.postgresPoolIdleTimeoutMs,
    connectionTimeoutMillis: config.dependencyCheckTimeoutMs,
    statement_timeout: config.postgresStatementTimeoutMs
  })

export const getRuntimeDatabasePool = (databaseUrl = config.databaseUrl) => {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required for runtime database access.')
  }

  const existingPool = runtimePools.get(databaseUrl)
  if (existingPool) return existingPool

  const pool = createDatabasePool(databaseUrl)
  pool.on('error', (error) => {
    logger.error({ error }, 'Unexpected Postgres pool error')
  })
  runtimePools.set(databaseUrl, pool)

  return pool
}

export const closeRuntimeDatabasePools = async () => {
  const pools = [...runtimePools.values()]
  runtimePools.clear()

  await Promise.all(pools.map((pool) => pool.end()))
}