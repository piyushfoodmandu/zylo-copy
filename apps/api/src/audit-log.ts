import type { AuthDecision, AuthPrincipal } from './auth.ts'
import { config } from './config.ts'
import { getRuntimeDatabasePool } from './database.ts'
import { logger } from './logger.ts'
import type { Queryable } from './target-business-repository.ts'

type AuditMetadata = Record<string, unknown>

export type RequestAuditRecord = {
  requestId: string
  correlationId: string
  principal?: AuthPrincipal
  method: string
  path: string
  routeGroup: string
  statusCode: number
  decision: AuthDecision
  reasonCode: string
  requiredScopes: string[]
  latencyMs: number
  metadata?: AuditMetadata
}

export type AuditRecorder = (record: RequestAuditRecord) => Promise<void>

const blockedMetadataKeyPattern = /(?:authorization|api[-_]?key|password|token|secret|payment|address|body)/i

const sanitizeMetadataValue = (value: unknown): unknown => {
  if (value === null || value === undefined) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(sanitizeMetadataValue)
  if (typeof value !== 'object') return String(value)

  const sanitized: AuditMetadata = {}

  for (const [key, nestedValue] of Object.entries(value)) {
    if (blockedMetadataKeyPattern.test(key)) continue
    const sanitizedValue = sanitizeMetadataValue(nestedValue)
    if (sanitizedValue !== undefined) sanitized[key] = sanitizedValue
  }

  return sanitized
}

export const sanitizeAuditMetadata = (metadata: AuditMetadata = {}): AuditMetadata => {
  const sanitized = sanitizeMetadataValue(metadata)
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? sanitized as AuditMetadata
    : {}
}

export const requestPath = (request: Request) => {
  try {
    return new URL(request.url).pathname
  } catch {
    return '/unknown'
  }
}

export const insertRequestAuditLog = async (
  client: Queryable,
  record: RequestAuditRecord
) => {
  await client.query(
    `
      insert into request_audit_log (
        request_id,
        correlation_id,
        principal_key_id,
        owner_principal,
        http_method,
        http_path,
        route_group,
        http_status_code,
        decision,
        reason_code,
        required_scopes,
        latency_ms,
        metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `,
    [
      record.requestId,
      record.correlationId,
      record.principal?.keyId ?? null,
      record.principal?.ownerPrincipal ?? null,
      record.method,
      record.path,
      record.routeGroup,
      record.statusCode,
      record.decision,
      record.reasonCode,
      record.requiredScopes,
      record.latencyMs,
      sanitizeAuditMetadata(record.metadata)
    ]
  )
}

export const recordRequestAuditLog: AuditRecorder = async (record) => {
  if (!config.databaseUrl) return

  try {
    await insertRequestAuditLog(getRuntimeDatabasePool(config.databaseUrl), record)
  } catch (error) {
    logger.warn(
      {
        error,
        requestId: record.requestId,
        routeGroup: record.routeGroup,
        decision: record.decision
      },
      'Request audit log insert failed'
    )
  }
}
