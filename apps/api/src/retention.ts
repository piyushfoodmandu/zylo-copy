import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { QueryResult, QueryResultRow } from 'pg'
import { config } from './config.ts'
import {
  closeRuntimeDatabasePools,
  getRuntimeDatabasePool
} from './database.ts'
import { logger } from './logger.ts'

type RetentionQueryable = {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ) => Promise<QueryResult<T>>
}

export type RetentionCleanupMode = 'dry-run' | 'apply'

export type RetentionPolicy = {
  requestAuditLogRetentionDays: number
  searchAuditLogRetentionDays: number
  purchaseSessionRetentionDays: number
  discoveryObservationRetentionDays: number
}

export type RetentionCleanupOptions = {
  mode?: RetentionCleanupMode
  now?: Date
  policy?: Partial<RetentionPolicy>
}

export type RuntimeRetentionCleanupOptions = RetentionCleanupOptions & {
  databaseUrl?: string
}

export type RetentionCleanupTable =
  | 'request_audit_log'
  | 'search_audit_logs'
  | 'product_detail_audit_logs'
  | 'commerce_memory_proposals'
  | 'ucp_checkout_sessions'
  | 'target_business_discovery_observations'
  | 'target_business_state_transitions'

export type RetentionCleanupTarget = {
  table: RetentionCleanupTable
  action: 'delete' | 'preserve_authority_history'
  retentionDays: number
  cutoff: string
  matchedRows: number
  affectedRows: number
  note: string
}

export type RetentionCleanupResult = {
  mode: RetentionCleanupMode
  generatedAt: string
  targets: RetentionCleanupTarget[]
}

const dayMs = 24 * 60 * 60 * 1000

export const retentionPolicyFromConfig = (): RetentionPolicy => ({
  requestAuditLogRetentionDays: config.requestAuditLogRetentionDays,
  searchAuditLogRetentionDays: config.searchAuditLogRetentionDays,
  purchaseSessionRetentionDays: config.purchaseSessionRetentionDays,
  discoveryObservationRetentionDays: config.discoveryObservationRetentionDays,
})

const cleanupPolicy = (policy: Partial<RetentionPolicy> = {}): RetentionPolicy => ({
  ...retentionPolicyFromConfig(),
  ...policy
})

const cutoffFor = (now: Date, retentionDays: number) =>
  new Date(now.getTime() - retentionDays * dayMs).toISOString()

const countRows = async (
  client: RetentionQueryable,
  sql: string,
  values: unknown[]
) => {
  const result = await client.query<{ count: string | number }>(
    sql,
    values
  )
  return Number(result.rows[0]?.count ?? 0)
}

const deleteRows = async (
  client: RetentionQueryable,
  sql: string,
  values: unknown[]
) => {
  const result = await client.query(
    sql,
    values
  )
  return result.rowCount ?? 0
}

const deleteTarget = async ({
  client,
  mode,
  table,
  retentionDays,
  cutoff,
  countSql,
  deleteSql,
  values,
  note
}: {
  client: RetentionQueryable
  mode: RetentionCleanupMode
  table: RetentionCleanupTable
  retentionDays: number
  cutoff: string
  countSql: string
  deleteSql: string
  values: unknown[]
  note: string
}): Promise<RetentionCleanupTarget> => {
  const affectedRows = mode === 'apply'
    ? await deleteRows(client, deleteSql, values)
    : 0
  // Apply mode would otherwise scan every expired range twice (COUNT, then
  // DELETE). PostgreSQL already reports the affected row count for DELETE, so
  // reserve the explicit COUNT for dry-run planning.
  const matchedRows = mode === 'apply'
    ? affectedRows
    : await countRows(client, countSql, values)
  return {
    table,
    action: 'delete',
    retentionDays,
    cutoff,
    matchedRows,
    affectedRows,
    note
  }
}

export const runRetentionCleanup = async (
  client: RetentionQueryable,
  options: RetentionCleanupOptions = {}
): Promise<RetentionCleanupResult> => {
  const mode = options.mode ?? 'dry-run'
  const now = options.now ?? new Date()
  const policy = cleanupPolicy(options.policy)
  const requestAuditCutoff = cutoffFor(now, policy.requestAuditLogRetentionDays)
  const searchAuditCutoff = cutoffFor(now, policy.searchAuditLogRetentionDays)
  const productDetailAuditCutoff = searchAuditCutoff
  const purchaseCutoff = cutoffFor(now, policy.purchaseSessionRetentionDays)
  const discoveryCutoff = cutoffFor(now, policy.discoveryObservationRetentionDays)
  const commerceMemoryExpiryCutoff = now.toISOString()

  const requestAudit = await deleteTarget({
    client,
    mode,
    table: 'request_audit_log',
    retentionDays: policy.requestAuditLogRetentionDays,
    cutoff: requestAuditCutoff,
    countSql: `
      select count(*) as count
      from request_audit_log
      where created_at < $1::timestamptz
    `,
    deleteSql: `
      delete from request_audit_log
      where created_at < $1::timestamptz
    `,
    values: [requestAuditCutoff],
    note: 'Deletes request audit rows older than the configured retention window.'
  })

  const searchAudit = await deleteTarget({
    client,
    mode,
    table: 'search_audit_logs',
    retentionDays: policy.searchAuditLogRetentionDays,
    cutoff: searchAuditCutoff,
    countSql: `
      select count(*) as count
      from search_audit_logs
      where created_at < $1::timestamptz
    `,
    deleteSql: `
      delete from search_audit_logs
      where created_at < $1::timestamptz
    `,
    values: [searchAuditCutoff],
    note: 'Deletes search audit rows older than the configured retention window.'
  })

  const productDetailAudit = await deleteTarget({
    client,
    mode,
    table: 'product_detail_audit_logs',
    retentionDays: policy.searchAuditLogRetentionDays,
    cutoff: productDetailAuditCutoff,
    countSql: `
      select count(*) as count
      from product_detail_audit_logs
      where created_at < $1::timestamptz
    `,
    deleteSql: `
      delete from product_detail_audit_logs
      where created_at < $1::timestamptz
    `,
    values: [productDetailAuditCutoff],
    note: 'Deletes product-detail audit rows older than the configured catalog-read audit retention window.'
  })

  const commerceMemory = await deleteTarget({
    client,
    mode,
    table: 'commerce_memory_proposals',
    retentionDays: 0,
    cutoff: commerceMemoryExpiryCutoff,
    countSql: `
      select count(*) as count
      from commerce_memory_proposals
      where expires_at is not null
        and expires_at <= $1::timestamptz
    `,
    deleteSql: `
      delete from commerce_memory_proposals
      where expires_at is not null
        and expires_at <= $1::timestamptz
    `,
    values: [commerceMemoryExpiryCutoff],
    note: 'Deletes expired typed commerce memory proposal roots; dependent policy reviews, records, stale marks, and refresh lineage cascade through database foreign keys.'
  })

  const ucpPurchases = await deleteTarget({
    client,
    mode,
    table: 'ucp_checkout_sessions',
    retentionDays: policy.purchaseSessionRetentionDays,
    cutoff: purchaseCutoff,
    countSql: `
      select count(*) as count
      from ucp_checkout_sessions
      where updated_at < $1::timestamptz
        and last_checkout_status in ('completed', 'canceled')
    `,
    deleteSql: `
      delete from ucp_checkout_sessions
      where updated_at < $1::timestamptz
        and last_checkout_status in ('completed', 'canceled')
    `,
    values: [purchaseCutoff],
    note: 'Deletes completed or canceled UCP purchase sessions after the configured purchase-session retention window; current FK cascades remove confirmations, operations, payment results, orders, embedded events, and AP2 replay claims.'
  })

  const discovery = await deleteTarget({
    client,
    mode,
    table: 'target_business_discovery_observations',
    retentionDays: policy.discoveryObservationRetentionDays,
    cutoff: discoveryCutoff,
    countSql: `
      select count(*) as count
      from target_business_discovery_observations observation
      where observation.created_at < $1::timestamptz
        and not exists (
          select 1
          from target_business_state_transitions transition
          where transition.linked_discovery_observation_id = observation.id
        )
    `,
    deleteSql: `
      delete from target_business_discovery_observations observation
      where observation.created_at < $1::timestamptz
        and not exists (
          select 1
          from target_business_state_transitions transition
          where transition.linked_discovery_observation_id = observation.id
        )
    `,
    values: [discoveryCutoff],
    note: 'Deletes old discovery observations only when they are not linked by source-governance transitions.'
  })

  return {
    mode,
    generatedAt: now.toISOString(),
    targets: [
      requestAudit,
      searchAudit,
      productDetailAudit,
      commerceMemory,
      ucpPurchases,
      discovery,
      {
        table: 'target_business_state_transitions',
        action: 'preserve_authority_history',
        retentionDays: 0,
        cutoff: now.toISOString(),
        matchedRows: 0,
        affectedRows: 0,
        note: 'Source-governance transitions are append-only authority history; routine cleanup intentionally neither scans nor mutates them.'
      }
    ]
  }
}

export const runRuntimeRetentionCleanup = async (
  options: RuntimeRetentionCleanupOptions = {}
) => {
  const pool = getRuntimeDatabasePool(options.databaseUrl)
  const client = await pool.connect()

  try {
    await client.query('begin')
    await client.query('select set_config($1, $2, true)', [
      'statement_timeout',
      String(config.postgresStatementTimeoutMs)
    ])
    const result = await runRetentionCleanup(client, options)
    await client.query('commit')
    return result
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : undefined

if (entrypoint === fileURLToPath(import.meta.url)) {
  const mode: RetentionCleanupMode = process.argv.includes('--apply') ? 'apply' : 'dry-run'
  try {
    const result = await runRuntimeRetentionCleanup({ mode })
    logger.info(
      {
        mode: result.mode,
        targets: result.targets.map((target) => ({
          table: target.table,
          matchedRows: target.matchedRows,
          affectedRows: target.affectedRows
        }))
      },
      'Retention cleanup completed'
    )
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await closeRuntimeDatabasePools()
  }
}
