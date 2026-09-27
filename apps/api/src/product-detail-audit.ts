import { createHash } from 'node:crypto'
import type {
  CatalogProductDetailRequest,
  CatalogProductDetailResponse
} from '@arro/contracts'
import type { CatalogSearchSourcePolicy } from '@arro/connectors'
import { sanitizeAuditMetadata } from './audit-log.ts'
import { config } from './config.ts'
import { getRuntimeDatabasePool } from './database.ts'
import { logger } from './logger.ts'
import type { Queryable } from './target-business-repository.ts'

export const productDetailCommercialIsolationVersion = 'product-detail-v1-no-commercial-inputs'
export const productDetailRefStorageMode = 'sha256_hash_only'

export type ProductDetailAuditRoute = '/v1/catalog/product'

export type ProductDetailAuditRecord = {
  requestId: string
  correlationId: string
  route: ProductDetailAuditRoute
  request: CatalogProductDetailRequest
  sourcePolicy: CatalogSearchSourcePolicy
  response: CatalogProductDetailResponse
  latencyMs: number
  metadata?: Record<string, unknown>
}

export type ProductDetailAuditWriteResult =
  | { recorded: true }
  | { recorded: false; reasonCode: 'database_unconfigured' | 'write_failed' }

export type ProductDetailAuditRecorder = (
  record: ProductDetailAuditRecord
) => Promise<ProductDetailAuditWriteResult>

const hashReference = (value: string) =>
  createHash('sha256').update(value).digest('hex')

const blockedProductDetailMetadataKeyPattern =
  /^(?:productTitle|productName|productDescription|productUrl|productPrice|variantTitle|variantName|variantUrl|variantPrice|title|description|price|url)$/i

const removeProductDetailCopyFields = (value: unknown): unknown => {
  if (value === null || value === undefined) return value
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(removeProductDetailCopyFields)
  if (typeof value !== 'object') return value

  const sanitized: Record<string, unknown> = {}
  for (const [key, nestedValue] of Object.entries(value)) {
    if (blockedProductDetailMetadataKeyPattern.test(key)) continue
    const nextValue = removeProductDetailCopyFields(nestedValue)
    if (nextValue !== undefined) sanitized[key] = nextValue
  }
  return sanitized
}

const sanitizeProductDetailAuditMetadata = (metadata: Record<string, unknown>) => {
  const sanitized = sanitizeAuditMetadata(metadata)
  const withoutProductCopy = removeProductDetailCopyFields(sanitized)
  return withoutProductCopy && typeof withoutProductCopy === 'object' && !Array.isArray(withoutProductCopy)
    ? withoutProductCopy as Record<string, unknown>
    : {}
}

export const insertProductDetailAuditLog = async (
  client: Queryable,
  record: ProductDetailAuditRecord
) => {
  const product = record.response.product

  await client.query(
    `
      insert into product_detail_audit_logs (
        request_id,
        correlation_id,
        route,
        business_id,
        product_id_hash,
        variant_id_hash,
        product_ref_storage_mode,
        source_mode,
        detail_state,
        allowed_business_ids,
        product_found,
        source_label_fact_type,
        media_count,
        variant_count,
        source_policy_message_code,
        payout_fields_accessed,
        commercial_fields_accessed,
        commercial_isolation_version,
        latency_ms,
        metadata
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[], $11, $12, $13, $14, $15, false, false, $16, $17, $18::jsonb)
    `,
    [
      record.requestId,
      record.correlationId,
      record.route,
      record.request.businessId,
      hashReference(record.request.productId),
      record.request.variantId ? hashReference(record.request.variantId) : null,
      productDetailRefStorageMode,
      record.response.sourceMode,
      record.response.state,
      record.sourcePolicy.allowedBusinessIds,
      Boolean(product),
      product?.sourceLabel.factType ?? null,
      product?.media.length ?? 0,
      product?.variants.length ?? 0,
      record.sourcePolicy.message.code,
      productDetailCommercialIsolationVersion,
      Math.max(Math.trunc(record.latencyMs), 0),
      sanitizeProductDetailAuditMetadata({
        ...record.metadata,
        productRefStorage: productDetailRefStorageMode
      })
    ]
  )
}

export const recordProductDetailAuditLog: ProductDetailAuditRecorder = async (record) => {
  if (!config.databaseUrl) return { recorded: false, reasonCode: 'database_unconfigured' }

  try {
    await insertProductDetailAuditLog(getRuntimeDatabasePool(config.databaseUrl), record)
    return { recorded: true }
  } catch (error) {
    logger.warn(
      {
        error,
        requestId: record.requestId,
        route: record.route,
        sourceMode: record.response.sourceMode,
        state: record.response.state
      },
      'Product detail audit log insert failed'
    )
    return { recorded: false, reasonCode: 'write_failed' }
  }
}
