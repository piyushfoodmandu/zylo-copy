import { createHash } from 'node:crypto'
import type { CatalogSearchResponse } from '@arro/contracts'
import type { CatalogSearchSourcePolicy } from '@arro/connectors'
import { sanitizeAuditMetadata } from './audit-log.ts'
import { config } from './config.ts'
import { getRuntimeDatabasePool } from './database.ts'
import { logger } from './logger.ts'
import type { Queryable } from './target-business-repository.ts'

export const searchCommercialIsolationVersion = 'search-v1-no-commercial-inputs'
export const searchAuditQueryStorageMode = 'sha256_hash_only'

export type SearchAuditRoute = '/v1/catalog/search'

export type SearchAuditRecord = {
  requestId: string
  correlationId: string
  route: SearchAuditRoute
  normalizedQuery: string
  sourcePolicy: CatalogSearchSourcePolicy
  response: CatalogSearchResponse
  latencyMs: number
  metadata?: Record<string, unknown>
}

export type SearchAuditWriteResult =
  | { recorded: true }
  | { recorded: false; reasonCode: 'database_unconfigured' | 'write_failed' }

export type SearchAuditRecorder = (record: SearchAuditRecord) => Promise<SearchAuditWriteResult>

const hashQuery = (normalizedQuery: string) =>
  createHash('sha256').update(normalizedQuery).digest('hex')

export const insertSearchAuditLog = async (
  client: Queryable,
  record: SearchAuditRecord
) => {
  await client.query(
    `
      insert into search_audit_logs (
        request_id,
        correlation_id,
        route,
        query_hash,
        query_normalized,
        source_mode,
        search_state,
        allowed_business_ids,
        result_count,
        source_policy_message_code,
        payout_fields_accessed,
        commercial_fields_accessed,
        commercial_isolation_version,
        latency_ms,
        metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, false, false, $11, $12, $13::jsonb)
    `,
    [
      record.requestId,
      record.correlationId,
      record.route,
      hashQuery(record.normalizedQuery),
      null,
      record.response.sourceMode,
      record.response.state,
      record.sourcePolicy.allowedBusinessIds,
      record.response.items.length,
      record.sourcePolicy.message.code,
      searchCommercialIsolationVersion,
      Math.max(Math.trunc(record.latencyMs), 0),
      sanitizeAuditMetadata({
        ...record.metadata,
        queryStorage: searchAuditQueryStorageMode
      })
    ]
  )
}

export const recordSearchAuditLog: SearchAuditRecorder = async (record) => {
  if (!config.databaseUrl) return { recorded: false, reasonCode: 'database_unconfigured' }

  try {
    await insertSearchAuditLog(getRuntimeDatabasePool(config.databaseUrl), record)
    return { recorded: true }
  } catch (error) {
    logger.warn(
      {
        error,
        requestId: record.requestId,
        route: record.route,
        sourceMode: record.response.sourceMode
      },
      'Search audit log insert failed'
    )
    return { recorded: false, reasonCode: 'write_failed' }
  }
}
