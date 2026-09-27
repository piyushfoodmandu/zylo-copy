import { createHmac, randomUUID } from 'node:crypto'
import type {
  DataRightsCorrectionRequest,
  DataRightsCorrectionResponse,
  DataRightsDeletionRequest,
  DataRightsDeletionResponse,
  DataRightsEvent,
  DataRightsEventAction,
  DataRightsEventStatus,
  DataRightsExportRecordKind,
  DataRightsExportRequest,
  DataRightsExportResponse,
  DataRightsUcpCheckoutSessionExport,
  DataRightsUcpOrderExport,
  DataRightsUcpPaymentResultExport
} from '@arro/contracts'
import {
  hashCommerceMemoryScopeRef,
  minCommerceMemoryHashPepperLength
} from './memory-proposal-service.ts'
import type { Queryable } from './target-business-repository.ts'

export type DataRightsIssueCode =
  | 'data_rights_store_unavailable'
  | 'external_subject_ref_required'
  | 'hash_pepper_required'
  | 'data_rights_target_record_required'
  | 'data_rights_target_not_found'

export type DataRightsIssue = {
  code: DataRightsIssueCode
  message: string
  status: 403 | 404 | 422 | 503
  path?: string
}

export type DataRightsStore = {
  exportRecords: (
    request: DataRightsExportRequest,
    context: DataRightsContext
  ) => Promise<DataRightsExportResponse>
  accessRecords: (
    request: DataRightsExportRequest,
    context: DataRightsContext
  ) => Promise<DataRightsExportResponse>
  recordCorrection: (
    request: DataRightsCorrectionRequest,
    context: DataRightsContext
  ) => Promise<DataRightsCorrectionResult>
  deleteRecords: (
    request: DataRightsDeletionRequest,
    context: DataRightsContext
  ) => Promise<DataRightsDeletionResponse>
}

export type DataRightsCorrectionResult =
  | {
      recorded: true
      response: DataRightsCorrectionResponse
    }
  | {
      recorded: false
      issues: DataRightsIssue[]
    }

export type DataRightsContext = {
  requestId: string
  correlationId: string
  now?: Date
}

type UcpCheckoutSessionRow = {
  transaction_id: string
  merchant_origin: string
  checkout_id: string
  cart_id: string | null
  last_checkout_status: string
  cart_json: unknown | null
  checkout_json: unknown | null
  created_at: Date | string
  updated_at: Date | string
}

type UcpPaymentResultRow = {
  payment_result_id: string
  transaction_id: string
  provider: string
  handler_id: string
  result_fingerprint: string
  instrument_json: {
    id?: unknown
    credential?: unknown
  }
  created_at: Date | string
}

type UcpOrderRow = {
  order_id: string
  transaction_id: string
  merchant_origin: string
  checkout_id: string
  order_permalink_url: string | null
  first_seen_at: Date | string
  last_seen_at: Date | string
}

type DataRightsEventRow = {
  event_id: string
  action: DataRightsEventAction
  status: DataRightsEventStatus
  target_record_kind: DataRightsEvent['target']['kind']
  target_record_id: string | null
  correction_payload: DataRightsEvent['correction'] | null
  result_summary: Record<string, unknown>
  created_at: Date | string
}

const generatedEventId = () => `dre_${randomUUID()}`

const toIso = (value: Date | string | null | undefined) => {
  if (!value) return undefined

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp from data-rights storage: ${value}`)
  }

  return date.toISOString()
}

const issue = (
  code: DataRightsIssueCode,
  message: string,
  status: DataRightsIssue['status'],
  path?: string
): DataRightsIssue => ({
  code,
  message,
  status,
  ...(path ? { path } : {})
})

const hmacSha256 = (value: string, hashPepper: string) =>
  createHmac('sha256', hashPepper).update(value, 'utf8').digest('hex')

const subjectHashes = ({
  integrationId,
  externalSubjectRef,
  hashPepper
}: {
  integrationId: string
  externalSubjectRef: string
  hashPepper: string
}) => {
  const dataRightsEventHash = hashCommerceMemoryScopeRef(externalSubjectRef, hashPepper)
  const ucpExternalSubjectHashes = new Set<string>()
  const agentIntegration = /^agent:(?<keyId>[^:]+):(?<agentIntegrationId>.+)$/.exec(integrationId)?.groups
  if (agentIntegration?.keyId && agentIntegration.agentIntegrationId) {
    ucpExternalSubjectHashes.add(
      `sha256:${hmacSha256(
        `subject:${agentIntegration.keyId}:${agentIntegration.agentIntegrationId}:${externalSubjectRef}`,
        hashPepper
      )}`
    )
  }
  ucpExternalSubjectHashes.add(`sha256:${hmacSha256(externalSubjectRef, hashPepper)}`)
  ucpExternalSubjectHashes.add(dataRightsEventHash)

  return {
    dataRightsEventHash,
    ucpExternalSubjectHashes: [...ucpExternalSubjectHashes]
  }
}

const validateScope = ({
  externalSubjectRef,
  hashPepper
}: {
  externalSubjectRef: string | undefined
  hashPepper: string | undefined
}) => {
  if (!externalSubjectRef) {
    return issue(
      'external_subject_ref_required',
      'Data-rights requests require an opaque external subject reference for scoped lookup.',
      403,
      '/externalSubjectRef'
    )
  }

  if (!hashPepper || hashPepper.length < minCommerceMemoryHashPepperLength) {
    return issue(
      'hash_pepper_required',
      'A production hash pepper with at least 32 characters is required for data-rights handling.',
      503,
      '/hashPepper'
    )
  }

  return undefined
}

const includedExportKinds = (include: DataRightsExportRecordKind[] | undefined) =>
  new Set<DataRightsExportRecordKind>(
    include ?? [
      'ucp_checkout_sessions',
      'ucp_payment_results',
      'ucp_orders',
      'data_rights_events'
    ]
  )

const rowToCheckoutSession = (row: UcpCheckoutSessionRow): DataRightsUcpCheckoutSessionExport => ({
  purchaseId: row.transaction_id,
  createdAt: toIso(row.created_at)!,
  updatedAt: toIso(row.updated_at)!,
  merchantOrigin: row.merchant_origin,
  checkoutId: row.checkout_id,
  ...(row.cart_id ? { cartId: row.cart_id } : {}),
  state: row.last_checkout_status,
  hasCartSnapshot: Boolean(row.cart_json),
  hasCheckoutSnapshot: Boolean(row.checkout_json),
  hasPaymentResult: false,
  hasOrder: false
})

const rowToPaymentResult = (row: UcpPaymentResultRow): DataRightsUcpPaymentResultExport => {
  const instrument = row.instrument_json && typeof row.instrument_json === 'object'
    ? row.instrument_json
    : {}
  return {
    paymentResultId: row.payment_result_id,
    purchaseId: row.transaction_id,
    provider: row.provider,
    handlerId: row.handler_id,
    resultFingerprint: row.result_fingerprint,
    ...(typeof instrument.id === 'string' ? { instrumentId: instrument.id } : {}),
    credentialRedacted: Boolean(instrument.credential),
    createdAt: toIso(row.created_at)!
  }
}

const rowToOrder = (row: UcpOrderRow): DataRightsUcpOrderExport => ({
  orderId: row.order_id,
  purchaseId: row.transaction_id,
  checkoutId: row.checkout_id,
  merchantOrigin: row.merchant_origin,
  ...(row.order_permalink_url ? { orderPermalinkUrl: row.order_permalink_url } : {}),
  firstSeenAt: toIso(row.first_seen_at)!,
  lastSeenAt: toIso(row.last_seen_at)!
})

const rowToEvent = (row: DataRightsEventRow): DataRightsEvent => ({
  eventId: row.event_id,
  action: row.action,
  status: row.status,
  target: {
    kind: row.target_record_kind,
    ...(row.target_record_id ? { recordId: row.target_record_id } : {})
  },
  createdAt: toIso(row.created_at)!,
  ...(row.correction_payload ? { correction: row.correction_payload } : {}),
  resultSummary: row.result_summary
})

const countRows = async (
  client: Queryable,
  text: string,
  values: unknown[]
) => {
  const result = await client.query<{ count: string | number }>(text, values)
  return Number(result.rows[0]?.count ?? 0)
}

const insertEvent = async ({
  client,
  context,
  integrationId,
  externalSubjectRefHash,
  action,
  status,
  target,
  correction,
  resultSummary
}: {
  client: Queryable
  context: Required<DataRightsContext>
  integrationId: string
  externalSubjectRefHash: string
  action: DataRightsEventAction
  status: DataRightsEventStatus
  target: DataRightsEvent['target']
  correction?: DataRightsEvent['correction']
  resultSummary: Record<string, unknown>
}) => {
  const eventId = generatedEventId()
  const result = await client.query<DataRightsEventRow>(
    `
      insert into data_rights_events (
        event_id,
        request_id,
        correlation_id,
        integration_id,
        external_subject_ref_hash,
        action,
        status,
        target_record_kind,
        target_record_id,
        correction_payload,
        result_summary,
        created_at,
        updated_at
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10::jsonb,
        $11::jsonb,
        $12,
        $12
      )
      returning event_id, action, status, target_record_kind, target_record_id, correction_payload, result_summary, created_at
    `,
    [
      eventId,
      context.requestId,
      context.correlationId,
      integrationId,
      externalSubjectRefHash,
      action,
      status,
      target.kind,
      target.recordId ?? null,
      correction ?? null,
      resultSummary,
      context.now.toISOString()
    ]
  )

  return rowToEvent(result.rows[0]!)
}

const readCheckoutSessions = async ({
  client,
  integrationId,
  externalSubjectRefHashes
}: {
  client: Queryable
  integrationId: string
  externalSubjectRefHashes: string[]
}) => {
  const result = await client.query<UcpCheckoutSessionRow>(
    `
      select
        transaction_id,
        merchant_origin,
        checkout_id,
        cart_id,
        last_checkout_status,
        cart_json,
        checkout_json,
        created_at,
        updated_at
      from ucp_checkout_sessions
      where integration_id = $1
        and external_subject_ref_hash = any($2::text[])
      order by created_at desc
      limit 100
    `,
    [integrationId, externalSubjectRefHashes]
  )

  return result.rows.map(rowToCheckoutSession)
}

const readPaymentResults = async ({
  client,
  integrationId,
  externalSubjectRefHashes
}: {
  client: Queryable
  integrationId: string
  externalSubjectRefHashes: string[]
}) => {
  const result = await client.query<UcpPaymentResultRow>(
    `
      select
        payment_result_id,
        p.transaction_id,
        provider,
        handler_id,
        result_fingerprint,
        instrument_json,
        p.created_at
      from ucp_payment_results p
      join ucp_checkout_sessions s on s.transaction_id = p.transaction_id
      where s.integration_id = $1
        and s.external_subject_ref_hash = any($2::text[])
      order by p.created_at desc
      limit 100
    `,
    [integrationId, externalSubjectRefHashes]
  )

  return result.rows.map(rowToPaymentResult)
}

const readOrders = async ({
  client,
  integrationId,
  externalSubjectRefHashes
}: {
  client: Queryable
  integrationId: string
  externalSubjectRefHashes: string[]
}) => {
  const result = await client.query<UcpOrderRow>(
    `
      select
        o.order_id,
        o.transaction_id,
        o.merchant_origin,
        o.checkout_id,
        o.order_permalink_url,
        o.first_seen_at,
        o.last_seen_at
      from ucp_orders o
      join ucp_checkout_sessions s on s.transaction_id = o.transaction_id
      where s.integration_id = $1
        and s.external_subject_ref_hash = any($2::text[])
      order by o.last_seen_at desc
      limit 100
    `,
    [integrationId, externalSubjectRefHashes]
  )

  return result.rows.map(rowToOrder)
}

const readDataRightsEvents = async ({
  client,
  integrationId,
  externalSubjectRefHash
}: {
  client: Queryable
  integrationId: string
  externalSubjectRefHash: string
}) => {
  const result = await client.query<DataRightsEventRow>(
    `
      select event_id, action, status, target_record_kind, target_record_id, correction_payload, result_summary, created_at
      from data_rights_events
      where integration_id = $1
        and external_subject_ref_hash = $2
      order by created_at desc
      limit 100
    `,
    [integrationId, externalSubjectRefHash]
  )

  return result.rows.map(rowToEvent)
}

const exportRecords = async ({
  client,
  request,
  context,
  hashPepper,
  action
}: {
  client: Queryable
  request: DataRightsExportRequest
  context: Required<DataRightsContext>
  hashPepper: string
  action: 'access' | 'export'
}): Promise<DataRightsExportResponse> => {
  const hashes = subjectHashes({
    integrationId: request.integrationId,
    externalSubjectRef: request.externalSubjectRef,
    hashPepper
  })
  const include = includedExportKinds(request.include)
  const ucpCheckoutSessions = include.has('ucp_checkout_sessions')
    ? await readCheckoutSessions({
      client,
      integrationId: request.integrationId,
      externalSubjectRefHashes: hashes.ucpExternalSubjectHashes
    })
    : []
  const ucpPaymentResults = include.has('ucp_payment_results')
    ? await readPaymentResults({
      client,
      integrationId: request.integrationId,
      externalSubjectRefHashes: hashes.ucpExternalSubjectHashes
    })
    : []
  const ucpOrders = include.has('ucp_orders')
    ? await readOrders({
      client,
      integrationId: request.integrationId,
      externalSubjectRefHashes: hashes.ucpExternalSubjectHashes
    })
    : []
  const dataRightsEvents = include.has('data_rights_events')
    ? await readDataRightsEvents({
      client,
      integrationId: request.integrationId,
      externalSubjectRefHash: hashes.dataRightsEventHash
    })
    : []

  await insertEvent({
    client,
    context,
    integrationId: request.integrationId,
    externalSubjectRefHash: hashes.dataRightsEventHash,
    action,
    status: 'completed',
    target: { kind: 'subject_scope' },
    resultSummary: {
      ucpCheckoutSessionCount: ucpCheckoutSessions.length,
      ucpPaymentResultCount: ucpPaymentResults.length,
      ucpOrderCount: ucpOrders.length,
      dataRightsEventCount: dataRightsEvents.length
    }
  })

  return {
    requestId: context.requestId,
    correlationId: context.correlationId,
    state: action === 'access' ? 'access_ready' : 'export_ready',
    scope: {
      integrationId: request.integrationId,
      hasExternalSubjectRef: true
    },
    records: {
      ucpCheckoutSessions,
      ucpPaymentResults,
      ucpOrders,
      dataRightsEvents
    },
    summary: {
      generatedAt: context.now.toISOString(),
      ucpCheckoutSessionCount: ucpCheckoutSessions.length,
      ucpPaymentResultCount: ucpPaymentResults.length,
      ucpOrderCount: ucpOrders.length,
      dataRightsEventCount: dataRightsEvents.length,
      messages: [
        {
          severity: 'info',
          code: 'data_rights_scope_hashed',
          text: 'Records were selected by integration ID and hashed external subject reference; the raw external subject reference is not echoed.'
        }
      ]
    }
  }
}

const targetExists = async ({
  client,
  request,
  externalSubjectRefHashes
}: {
  client: Queryable
  request: DataRightsCorrectionRequest
  externalSubjectRefHashes: string[]
}) => {
  if (request.target.kind === 'subject_scope') return true
  if (!request.target.recordId) return false

  if (request.target.kind === 'purchase') {
    const count = await countRows(
      client,
      `
        select count(*) as count
        from ucp_checkout_sessions
        where transaction_id = $1
          and integration_id = $2
          and external_subject_ref_hash = any($3::text[])
      `,
      [request.target.recordId, request.integrationId, externalSubjectRefHashes]
    )
    return count > 0
  }

  const count = await countRows(
    client,
    `
      select count(*) as count
      from ucp_orders o
      join ucp_checkout_sessions s on s.transaction_id = o.transaction_id
      where o.order_id = $1
        and s.integration_id = $2
        and s.external_subject_ref_hash = any($3::text[])
    `,
    [request.target.recordId, request.integrationId, externalSubjectRefHashes]
  )
  return count > 0
}

const completeContext = (context: DataRightsContext): Required<DataRightsContext> => ({
  ...context,
  now: context.now ?? new Date()
})

export const createPostgresDataRightsStore = ({
  client,
  hashPepper
}: {
  client: Queryable
  hashPepper: string | undefined
}): DataRightsStore => ({
  exportRecords: async (request, context) => {
    const scopeIssue = validateScope({
      externalSubjectRef: request.externalSubjectRef,
      hashPepper
    })
    if (scopeIssue) throw new DataRightsStoreError(scopeIssue)

    return exportRecords({
      client,
      request,
      context: completeContext(context),
      hashPepper: hashPepper!,
      action: 'export'
    })
  },
  accessRecords: async (request, context) => {
    const scopeIssue = validateScope({
      externalSubjectRef: request.externalSubjectRef,
      hashPepper
    })
    if (scopeIssue) throw new DataRightsStoreError(scopeIssue)

    return exportRecords({
      client,
      request,
      context: completeContext(context),
      hashPepper: hashPepper!,
      action: 'access'
    })
  },
  recordCorrection: async (request, context) => {
    const scopeIssue = validateScope({
      externalSubjectRef: request.externalSubjectRef,
      hashPepper
    })
    if (scopeIssue) return { recorded: false, issues: [scopeIssue] }
    if (request.target.kind !== 'subject_scope' && !request.target.recordId) {
      return {
        recorded: false,
        issues: [
          issue(
            'data_rights_target_record_required',
            'A target record ID is required when correcting a purchase or order.',
            422,
            '/target/recordId'
          )
        ]
      }
    }

    const completedContext = completeContext(context)
    const hashes = subjectHashes({
      integrationId: request.integrationId,
      externalSubjectRef: request.externalSubjectRef,
      hashPepper: hashPepper!
    })
    const found = await targetExists({
      client,
      request,
      externalSubjectRefHashes: hashes.ucpExternalSubjectHashes
    })
    if (!found) {
      return {
        recorded: false,
        issues: [
          issue(
            'data_rights_target_not_found',
            'The correction target was not found for this integration and external subject scope.',
            404,
            '/target'
          )
        ]
      }
    }

    const correction = {
      field: request.correction.field,
      statement: request.correction.statement
    }
    const event = await insertEvent({
      client,
      context: completedContext,
      integrationId: request.integrationId,
      externalSubjectRefHash: hashes.dataRightsEventHash,
      action: 'correction',
      status: 'completed',
      target: request.target,
      correction,
      resultSummary: {
        correctionRecorded: true,
        correctionMode: 'append_only'
      }
    })

    return {
      recorded: true,
      response: {
        requestId: context.requestId,
        correlationId: context.correlationId,
        state: 'correction_recorded',
        event
      }
    }
  },
  deleteRecords: async (request, context) => {
    const scopeIssue = validateScope({
      externalSubjectRef: request.externalSubjectRef,
      hashPepper
    })
    if (scopeIssue) throw new DataRightsStoreError(scopeIssue)

    const completedContext = completeContext(context)
    const hashes = subjectHashes({
      integrationId: request.integrationId,
      externalSubjectRef: request.externalSubjectRef,
      hashPepper: hashPepper!
    })
    const requestedKinds = new Set(request.recordKinds ?? [
      'ucp_payment_results',
      'ucp_orders',
      'ucp_checkout_sessions'
    ])

    const deletedPaymentResults = requestedKinds.has('ucp_payment_results')
      ? await client.query<{ payment_result_id: string }>(
        `
          delete from ucp_payment_results p
          using ucp_checkout_sessions s
          where s.transaction_id = p.transaction_id
            and s.integration_id = $1
            and s.external_subject_ref_hash = any($2::text[])
          returning p.payment_result_id
        `,
        [request.integrationId, hashes.ucpExternalSubjectHashes]
      )
      : { rows: [] }
    const deletedOrders = requestedKinds.has('ucp_orders')
      ? await client.query<{ order_id: string }>(
        `
          delete from ucp_orders o
          using ucp_checkout_sessions s
          where s.transaction_id = o.transaction_id
            and s.integration_id = $1
            and s.external_subject_ref_hash = any($2::text[])
          returning o.order_id
        `,
        [request.integrationId, hashes.ucpExternalSubjectHashes]
      )
      : { rows: [] }
    const deletedCheckoutSessions = requestedKinds.has('ucp_checkout_sessions')
      ? await client.query<{ transaction_id: string }>(
        `
          delete from ucp_checkout_sessions
          where integration_id = $1
            and external_subject_ref_hash = any($2::text[])
          returning transaction_id
        `,
        [request.integrationId, hashes.ucpExternalSubjectHashes]
      )
      : { rows: [] }

    const event = await insertEvent({
      client,
      context: completedContext,
      integrationId: request.integrationId,
      externalSubjectRefHash: hashes.dataRightsEventHash,
      action: 'deletion',
      status: 'completed',
      target: { kind: 'subject_scope' },
      resultSummary: {
        reason: request.reason ?? 'user_request',
        deletedUcpCheckoutSessionCount: deletedCheckoutSessions.rows.length,
        deletedUcpPaymentResultCount: deletedPaymentResults.rows.length,
        deletedUcpOrderCount: deletedOrders.rows.length,
        retainedDataRightsEvent: true,
        retainedRequestAuditLog: true
      }
    })
    const retainedDataRightsEvents = await countRows(
      client,
      `
        select count(*) as count
        from data_rights_events
        where integration_id = $1
          and external_subject_ref_hash = $2
      `,
      [request.integrationId, hashes.dataRightsEventHash]
    )

    return {
      requestId: context.requestId,
      correlationId: context.correlationId,
      state: 'deletion_completed',
      deleted: {
        ucpCheckoutSessionCount: deletedCheckoutSessions.rows.length,
        ucpPaymentResultCount: deletedPaymentResults.rows.length,
        ucpOrderCount: deletedOrders.rows.length
      },
      retained: {
        dataRightsEventCount: retainedDataRightsEvents,
        sourceGovernanceHistory: 'not_in_scope',
        requestAuditLog: 'retained_by_policy'
      },
      event
    }
  }
})

export class DataRightsStoreError extends Error {
  readonly issue: DataRightsIssue

  constructor(issue: DataRightsIssue) {
    super(issue.message)
    this.name = 'DataRightsStoreError'
    this.issue = issue
  }
}
