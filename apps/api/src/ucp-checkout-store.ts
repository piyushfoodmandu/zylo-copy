import { createHash, randomUUID } from 'node:crypto'
import type { QueryResult, QueryResultRow } from 'pg'
import type {
  UcpCart,
  UcpCheckout,
  UcpCheckoutConfirmation,
  UcpOrder,
  UcpPaymentInstrument,
  UcpProfile
} from '@arro/contracts'
import type { UcpNegotiation } from '@arro/ucp-client'
import type { CommercePrincipal } from './commerce-principal.ts'
import { stableJsonStringify } from './stable-json.ts'
import type { Queryable } from './target-business-repository.ts'

export type UcpCheckoutSessionRecord = {
  transactionId: string
  integrationId: string
  ownerKeyId?: string
  ownerPrincipalHash?: string
  externalSubjectRefHash?: string
  externalTaskRefHash?: string
  agentSessionId?: string
  merchantProfileUrl: string
  merchantOrigin: string
  ucpVersion: string
  cartId?: string
  cartSnapshotHash?: string
  cart?: UcpCart
  checkoutId: string
  selectedPaymentHandlerId?: string
  idempotencyKeyHash: string
  requestFingerprint: string
  lastCheckoutStatus: UcpCheckout['status']
  checkoutSnapshotHash: string
  checkout: UcpCheckout
  businessProfile: UcpProfile
  negotiation: UcpNegotiation
  orderId?: string
  orderPermalinkUrl?: string
  createdAt: string
  updatedAt: string
}

export type UcpCheckoutSessionCreate = Omit<UcpCheckoutSessionRecord, 'createdAt' | 'updatedAt'>

export type UcpCheckoutSessionCreateResult =
  | {
      stored: true
      session: UcpCheckoutSessionRecord
    }
  | {
      stored: false
      replay: true
      session: UcpCheckoutSessionRecord
    }
  | {
      stored: false
      conflict: true
      message: string
    }

export type UcpCheckoutOperationRecord = {
  transactionId: string
  operation: string
  idempotencyKeyHash: string
  request: unknown
  response?: unknown
  status: 'started' | 'retryable' | 'unknown_outcome' | 'succeeded' | 'failed'
  retryAfterSeconds?: number
}

export type UcpPaymentResultRecord = {
  paymentResultId: string
  transactionId: string
  provider: string
  handlerId: string
  checkoutSnapshotHash: string
  idempotencyKeyHash: string
  resultFingerprint: string
  instrument: UcpPaymentInstrument
  providerResult: unknown
  revokedAt?: string
  revocationReason?: UcpPaymentResultRevocationReason
  createdAt: string
}

export type UcpPaymentResultRevocationReason =
  | 'checkout_changed'
  | 'purchase_canceled'
  | 'purchase_completed'
  | 'snapshot_mismatch'

export type UcpPaymentActionStatus =
  | 'pending_user_approval'
  | 'approved'
  | 'credential_ready'
  | 'consumed'
  | 'failed'
  | 'revoked'
  | 'expired'

export type UcpPaymentActionRecord = {
  actionId: string
  transactionId: string
  integrationId: string
  ownerKeyId?: string
  ownerPrincipalHash?: string
  externalSubjectRefHash?: string
  externalTaskRefHash?: string
  agentSessionId?: string
  merchantOrigin: string
  checkoutId: string
  checkoutSnapshotHash: string
  handlerId: string
  handlerName: string
  handlerVersion?: string
  handlerSpecification?: string
  handlerSchema?: string
  provider: string
  capabilityId?: string
  connectorHostId?: string
  authorizationMode?: string
  mandateId?: string
  mandateVersion?: number
  route?: string
  presentation?: string
  providerSessionId?: string
  providerReferenceId?: string
  providerEventId?: string
  actionType: 'x402' | 'mpp' | 'host_supplied' | 'google_pay' | 'processor_tokenizer'
  status: UcpPaymentActionStatus
  amount?: number
  currency?: string
  tokenNonceHash: string
  actionPayload: Record<string, unknown>
  resultFingerprint?: string
  paymentResultId?: string
  expiresAt: string
  approvedAt?: string
  credentialReadyAt?: string
  failedAt?: string
  consumedAt?: string
  revokedAt?: string
  createdAt: string
  updatedAt: string
}

export type UcpPaymentActionCreate = Omit<UcpPaymentActionRecord, 'createdAt' | 'updatedAt'>

export type UcpPaymentResultCreateResult =
  | {
      stored: true
      paymentResult: UcpPaymentResultRecord
    }
  | {
      stored: false
      replay: true
      paymentResult: UcpPaymentResultRecord
    }
  | {
      stored: false
      conflict: true
      message: string
    }

export type UcpOrderWebhookRecord = {
  merchantOrigin: string
  webhookId: string
  webhookTimestamp: string
  ucpAgent: string
  contentDigest: string
  signatureInput: string
  signature: string
  order: UcpOrder
  signatureVerified: boolean
}

export type UcpCheckoutStore = {
  createSession(input: UcpCheckoutSessionCreate): Promise<UcpCheckoutSessionCreateResult>
  readSession(transactionId: string): Promise<UcpCheckoutSessionRecord | undefined>
  readSessionForPrincipal(
    transactionId: string,
    principal: CommercePrincipal
  ): Promise<UcpCheckoutSessionRecord | undefined>
  readSessionByCheckout(input: {
    merchantOrigin: string
    checkoutId: string
  }): Promise<UcpCheckoutSessionRecord | undefined>
  updateCheckout(input: {
    transactionId: string
    checkout: UcpCheckout
  }): Promise<UcpCheckoutSessionRecord>
  updateCart(input: {
    transactionId: string
    cart: UcpCart
  }): Promise<UcpCheckoutSessionRecord>
  recordConfirmation(input: {
    transactionId: string
    confirmation: UcpCheckoutConfirmation
    approvalPayload: unknown
  }): Promise<UcpCheckoutConfirmation>
  readConfirmation(transactionId: string): Promise<UcpCheckoutConfirmation | undefined>
  recordOperation(input: UcpCheckoutOperationRecord): Promise<void>
  readOperation?(input: {
    transactionId: string
    operation: string
    idempotencyKeyHash: string
  }): Promise<UcpCheckoutOperationRecord | undefined>
  hasCompletedCheckoutOperation?(transactionId: string): Promise<boolean>
  recordPaymentResult(
    input: Omit<UcpPaymentResultRecord, 'createdAt' | 'revokedAt' | 'revocationReason'>
  ): Promise<UcpPaymentResultCreateResult>
  readLatestPaymentResult(
    transactionId: string,
    checkoutSnapshotHash?: string
  ): Promise<UcpPaymentResultRecord | undefined>
  revokePaymentResults(input: {
    transactionId: string
    reason: UcpPaymentResultRevocationReason
    checkoutSnapshotHash?: string
  }): Promise<UcpPaymentResultRecord[]>
  createPaymentAction(input: UcpPaymentActionCreate): Promise<UcpPaymentActionRecord>
  readPaymentAction(actionId: string): Promise<UcpPaymentActionRecord | undefined>
  bindPaymentActionProviderReference?(input: {
    actionId: string
    providerReferenceId: string
  }): Promise<UcpPaymentActionRecord | undefined>
  markPaymentActionApproved(input: {
    actionId: string
  }): Promise<UcpPaymentActionRecord | undefined>
  markPaymentActionCredentialReady(input: {
    actionId: string
    paymentResultId: string
    resultFingerprint: string
  }): Promise<UcpPaymentActionRecord | undefined>
  consumePaymentAction(input: {
    transactionId: string
    paymentResultId: string
  }): Promise<UcpPaymentActionRecord | undefined>
  revokeSiblingPaymentActions(input: {
    transactionId: string
    consumedActionId?: string
    reason: 'checkout_changed' | 'purchase_canceled' | 'purchase_completed'
  }): Promise<number>
  markPaymentActionFailed(input: {
    actionId: string
    resultFingerprint?: string
  }): Promise<UcpPaymentActionRecord | undefined>
  revokePendingPaymentActions(input: {
    transactionId: string
    reason: 'checkout_changed' | 'purchase_canceled' | 'purchase_completed'
    checkoutSnapshotHash?: string
  }): Promise<number>
  claimAp2Mandate(input: {
    mandateHash: string
    mandateId?: string
    transactionId: string
    checkoutId: string
    expiresAt: string
  }): Promise<'claimed' | 'recovered' | 'replay'>
  recordAp2Authority(input: {
    authorityId: string
    transactionId: string
    ownerKeyId?: string
    ownerPrincipalHash?: string
    integrationId: string
    agentSessionId?: string
    canonicalMandateId?: string
    canonicalMandateVersion?: number
    merchantOrigin: string
    checkoutId: string
    checkoutSnapshotHash: string
    amountMinor: number
    currency: string
    authorityMode: 'human_present' | 'human_not_present'
    checkoutMandateId: string
    paymentMandateId: string
    checkoutReceiptReference: string
    paymentReceiptReference: string
    agentKeyThumbprint?: string
    expiresAt: string
  }): Promise<void>
  invalidateAp2Authorities(input: {
    transactionId: string
    reason: 'checkout_changed' | 'purchase_canceled' | 'mandate_changed' | 'mandate_revoked'
    checkoutSnapshotHash?: string
  }): Promise<number>
  consumeAp2Authorities(input: { transactionId: string }): Promise<number>
  readAp2AuthorityForReceipt(input: {
    transactionId: string
    kind: 'checkout' | 'payment'
    reference: string
  }): Promise<{ authorityId: string } | undefined>
  recordAp2ProtocolReceipt(input: {
    receiptId: string
    authorityId: string
    kind: 'checkout' | 'payment'
    status: 'Success' | 'Error'
    issuer: string
    reference: string
    orderId?: string
    paymentId?: string
    pspConfirmationId?: string
    networkConfirmationId?: string
    receiptJwt: string
    issuedAt: string
  }): Promise<'recorded' | 'recovered' | 'conflict'>
  recordEmbeddedCheckoutMessage(input: {
    transactionId: string
    embeddedSessionId: string
    messageType: string
    origin: string
    payload: unknown
  }): Promise<void>
  recordOrder(input: {
    transactionId: string
    merchantOrigin: string
    order: UcpOrder
  }): Promise<UcpOrder>
  readOrder(orderId: string, merchantOrigin: string): Promise<UcpOrder | undefined>
  readOrderForPrincipal(orderId: string, transactionId: string, principal: CommercePrincipal): Promise<UcpOrder | undefined>
  recordOrderWebhook(input: UcpOrderWebhookRecord): Promise<UcpOrder>
}

const hash = (value: string) =>
  `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`

export const ucpStableHash = (value: unknown) => hash(stableJsonStringify(value))

/**
 * Merchant continuation credentials and rolling session expiry can change on
 * every read. Retain them in the stored checkout, but do not mistake their
 * rotation for a change to the order the shopper reviewed. All remaining
 * fields, including identity, status, prices, fulfillment and payment, bind the
 * snapshot. Merchant/provider expiry checks remain independent of this hash.
 */
export const ucpCheckoutSnapshotHash = (checkout: UcpCheckout) => {
  const { continue_url: _continueUrl, expires_at: _expiresAt, ...reviewed } = checkout
  return ucpStableHash(reviewed)
}

const iso = (value: string | Date | undefined) =>
  value ? (value instanceof Date ? value.toISOString() : new Date(value).toISOString()) : new Date().toISOString()

const originFromProfileUrl = (value: string) => new URL(value).origin

const redactedKeys = new Set([
  'token',
  'value',
  'pan',
  'cvv',
  'cvc',
  'card_number',
  'cardNumber',
  'authorization',
  'signature',
  'checkout_mandate',
  'payment_mandate',
  'checkoutMandate',
  'paymentMandate'
])

export const redactUcpPayload = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map(redactUcpPayload) as T
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  if ('credential' in record && record.credential && typeof record.credential === 'object') {
    const credential = record.credential as Record<string, unknown>
    const safeRedactedCredential = credential.redacted === true
      ? {
          type: typeof credential.type === 'string' ? credential.type : 'redacted',
          redacted: true,
          ...(typeof credential.reference === 'string' ? { reference: credential.reference } : {}),
          ...(typeof credential.expires_at === 'string' ? { expires_at: credential.expires_at } : {}),
          ...(typeof credential.expiresAt === 'string' ? { expiresAt: credential.expiresAt } : {}),
          ...(credential.scope && typeof credential.scope === 'object' && !Array.isArray(credential.scope)
            ? { scope: redactUcpPayload(credential.scope) }
            : {})
        }
      : {
          type: typeof credential.type === 'string'
            ? credential.type
            : 'redacted',
          redacted: true
        }
    return {
      ...Object.fromEntries(
        Object.entries(record)
          .filter(([key]) => key !== 'credential')
          .map(([key, entryValue]) => [key, redactUcpPayload(entryValue)])
      ),
      credential: safeRedactedCredential
    } as T
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, entryValue]) => [
      key,
      redactedKeys.has(key) ? '[redacted]' : redactUcpPayload(entryValue)
    ])
  ) as T
}

type SessionRow = {
  transaction_id: string
  integration_id: string
  owner_key_id: string | null
  owner_principal_hash: string | null
  external_subject_ref_hash: string | null
  external_task_ref_hash: string | null
  agent_session_id: string | null
  merchant_profile_url: string
  merchant_origin: string
  ucp_version: string
  cart_id: string | null
  cart_snapshot_hash: string | null
  cart_json: UcpCart | null
  checkout_id: string
  selected_payment_handler_id: string | null
  idempotency_key_hash: string
  request_fingerprint: string | null
  last_checkout_status: UcpCheckout['status']
  checkout_snapshot_hash: string | null
  checkout_json: UcpCheckout
  business_profile_json: UcpProfile | null
  negotiation_json: UcpNegotiation | null
  order_id: string | null
  order_permalink_url: string | null
  created_at: string | Date
  updated_at: string | Date
}

type PaymentResultRow = {
  payment_result_id: string
  transaction_id: string
  provider: string
  handler_id: string
  checkout_snapshot_hash: string
  idempotency_key_hash: string
  result_fingerprint: string
  instrument_json: UcpPaymentInstrument
  provider_result_json: unknown
  revoked_at: string | Date | null
  revocation_reason: UcpPaymentResultRevocationReason | null
  created_at: string | Date
}

type CheckoutOperationRow = {
  transaction_id: string
  operation: string
  idempotency_key_hash: string
  request_json: unknown
  response_json: unknown | null
  status: UcpCheckoutOperationRecord['status']
  retry_after_seconds: number | null
}

type PaymentActionRow = {
  action_id: string
  transaction_id: string
  integration_id: string
  owner_key_id: string | null
  owner_principal_hash: string | null
  external_subject_ref_hash: string | null
  external_task_ref_hash: string | null
  agent_session_id: string | null
  merchant_origin: string
  checkout_id: string
  checkout_snapshot_hash: string
  handler_id: string
  handler_name: string
  handler_version: string | null
  handler_specification: string | null
  handler_schema: string | null
  provider: string
  capability_id: string | null
  connector_host_id: string | null
  authorization_mode: string | null
  mandate_id: string | null
  mandate_version: number | null
  route: string | null
  presentation: string | null
  provider_session_id: string | null
  provider_reference_id: string | null
  provider_event_id: string | null
  action_type: UcpPaymentActionRecord['actionType']
  status: UcpPaymentActionStatus
  amount: number | null
  currency: string | null
  token_nonce_hash: string
  action_payload_json: Record<string, unknown>
  result_fingerprint: string | null
  payment_result_id: string | null
  expires_at: string | Date
  approved_at: string | Date | null
  credential_ready_at: string | Date | null
  failed_at: string | Date | null
  consumed_at: string | Date | null
  revoked_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

const queryOne = async <T extends QueryResultRow>(
  client: Queryable,
  text: string,
  values: unknown[]
) => {
  const result = await client.query<T>(text, values)
  return result.rows[0]
}

const rowToSession = (row: SessionRow): UcpCheckoutSessionRecord => ({
  transactionId: row.transaction_id,
  integrationId: row.integration_id,
  ...(row.owner_key_id ? { ownerKeyId: row.owner_key_id } : {}),
  ...(row.owner_principal_hash ? { ownerPrincipalHash: row.owner_principal_hash } : {}),
  ...(row.external_subject_ref_hash ? { externalSubjectRefHash: row.external_subject_ref_hash } : {}),
  ...(row.external_task_ref_hash ? { externalTaskRefHash: row.external_task_ref_hash } : {}),
  ...(row.agent_session_id ? { agentSessionId: row.agent_session_id } : {}),
  merchantProfileUrl: row.merchant_profile_url,
  merchantOrigin: row.merchant_origin,
  ucpVersion: row.ucp_version,
  ...(row.cart_id ? { cartId: row.cart_id } : {}),
  ...(row.cart_snapshot_hash ? { cartSnapshotHash: row.cart_snapshot_hash } : {}),
  ...(row.cart_json ? { cart: row.cart_json } : {}),
  checkoutId: row.checkout_id,
  ...(row.selected_payment_handler_id ? { selectedPaymentHandlerId: row.selected_payment_handler_id } : {}),
  idempotencyKeyHash: row.idempotency_key_hash,
  requestFingerprint: row.request_fingerprint ?? '',
  lastCheckoutStatus: row.last_checkout_status,
  checkoutSnapshotHash: row.checkout_snapshot_hash ?? ucpCheckoutSnapshotHash(row.checkout_json),
  checkout: row.checkout_json,
  businessProfile: row.business_profile_json ?? { ucp: { version: row.ucp_version, services: {}, capabilities: {}, payment_handlers: {} } },
  negotiation: row.negotiation_json ?? {
    version: row.ucp_version,
    transport: 'rest',
    serviceNamespace: 'dev.ucp.shopping',
    service: { version: row.ucp_version, transport: 'rest', endpoint: row.merchant_origin },
    endpoint: row.merchant_origin,
    capabilities: {},
    paymentHandlers: {},
    businessProfile: row.business_profile_json ?? { ucp: { version: row.ucp_version, services: {}, capabilities: {}, payment_handlers: {} } }
  },
  ...(row.order_id ? { orderId: row.order_id } : {}),
  ...(row.order_permalink_url ? { orderPermalinkUrl: row.order_permalink_url } : {}),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
})

const rowToPaymentResult = (row: PaymentResultRow): UcpPaymentResultRecord => ({
  paymentResultId: row.payment_result_id,
  transactionId: row.transaction_id,
  provider: row.provider,
  handlerId: row.handler_id,
  checkoutSnapshotHash: row.checkout_snapshot_hash,
  idempotencyKeyHash: row.idempotency_key_hash,
  resultFingerprint: row.result_fingerprint,
  instrument: row.instrument_json,
  providerResult: row.provider_result_json,
  ...(row.revoked_at ? { revokedAt: iso(row.revoked_at) } : {}),
  ...(row.revocation_reason ? { revocationReason: row.revocation_reason } : {}),
  createdAt: iso(row.created_at)
})

const rowToOperation = (row: CheckoutOperationRow): UcpCheckoutOperationRecord => ({
  transactionId: row.transaction_id,
  operation: row.operation,
  idempotencyKeyHash: row.idempotency_key_hash,
  request: row.request_json,
  ...(row.response_json !== null ? { response: row.response_json } : {}),
  status: row.status,
  ...(row.retry_after_seconds !== null ? { retryAfterSeconds: row.retry_after_seconds } : {})
})

const rowToPaymentAction = (row: PaymentActionRow): UcpPaymentActionRecord => ({
  actionId: row.action_id,
  transactionId: row.transaction_id,
  integrationId: row.integration_id,
  ...(row.owner_key_id ? { ownerKeyId: row.owner_key_id } : {}),
  ...(row.owner_principal_hash ? { ownerPrincipalHash: row.owner_principal_hash } : {}),
  ...(row.external_subject_ref_hash ? { externalSubjectRefHash: row.external_subject_ref_hash } : {}),
  ...(row.external_task_ref_hash ? { externalTaskRefHash: row.external_task_ref_hash } : {}),
  ...(row.agent_session_id ? { agentSessionId: row.agent_session_id } : {}),
  merchantOrigin: row.merchant_origin,
  checkoutId: row.checkout_id,
  checkoutSnapshotHash: row.checkout_snapshot_hash,
  handlerId: row.handler_id,
  handlerName: row.handler_name,
  ...(row.handler_version ? { handlerVersion: row.handler_version } : {}),
  ...(row.handler_specification ? { handlerSpecification: row.handler_specification } : {}),
  ...(row.handler_schema ? { handlerSchema: row.handler_schema } : {}),
  provider: row.provider,
  ...(row.capability_id ? { capabilityId: row.capability_id } : {}),
  ...(row.connector_host_id ? { connectorHostId: row.connector_host_id } : {}),
  ...(row.authorization_mode ? { authorizationMode: row.authorization_mode } : {}),
  ...(row.mandate_id ? { mandateId: row.mandate_id } : {}),
  ...(row.mandate_version !== null ? { mandateVersion: row.mandate_version } : {}),
  ...(row.route ? { route: row.route } : {}),
  ...(row.presentation ? { presentation: row.presentation } : {}),
  ...(row.provider_session_id ? { providerSessionId: row.provider_session_id } : {}),
  ...(row.provider_reference_id ? { providerReferenceId: row.provider_reference_id } : {}),
  ...(row.provider_event_id ? { providerEventId: row.provider_event_id } : {}),
  actionType: row.action_type,
  status: row.status,
  ...(row.amount !== null ? { amount: row.amount } : {}),
  ...(row.currency ? { currency: row.currency } : {}),
  tokenNonceHash: row.token_nonce_hash,
  actionPayload: row.action_payload_json,
  ...(row.result_fingerprint ? { resultFingerprint: row.result_fingerprint } : {}),
  ...(row.payment_result_id ? { paymentResultId: row.payment_result_id } : {}),
  expiresAt: iso(row.expires_at),
  ...(row.approved_at ? { approvedAt: iso(row.approved_at) } : {}),
  ...(row.credential_ready_at ? { credentialReadyAt: iso(row.credential_ready_at) } : {}),
  ...(row.failed_at ? { failedAt: iso(row.failed_at) } : {}),
  ...(row.consumed_at ? { consumedAt: iso(row.consumed_at) } : {}),
  ...(row.revoked_at ? { revokedAt: iso(row.revoked_at) } : {}),
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at)
})

export const createPostgresUcpCheckoutStore = ({ client }: { client: Queryable }): UcpCheckoutStore => ({
  async createSession(input) {
    const inserted = await queryOne<SessionRow>(
      client,
      `
        insert into ucp_checkout_sessions (
          transaction_id,
          integration_id,
          owner_key_id,
          owner_principal_hash,
          external_subject_ref_hash,
          external_task_ref_hash,
          agent_session_id,
          merchant_profile_url,
          merchant_origin,
          ucp_version,
          cart_id,
          cart_snapshot_hash,
          cart_json,
          checkout_id,
          selected_payment_handler_id,
          idempotency_key_hash,
          request_fingerprint,
          last_checkout_status,
          checkout_snapshot_hash,
          checkout_json,
          business_profile_json,
          negotiation_json,
          order_id,
          order_permalink_url
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17, $18, $19, $20::jsonb, $21::jsonb, $22::jsonb, $23, $24)
        on conflict (integration_id, idempotency_key_hash) do nothing
        returning *
      `,
      [
        input.transactionId,
        input.integrationId,
        input.ownerKeyId ?? null,
        input.ownerPrincipalHash ?? null,
        input.externalSubjectRefHash ?? null,
        input.externalTaskRefHash ?? null,
        input.agentSessionId ?? null,
        input.merchantProfileUrl,
        input.merchantOrigin,
        input.ucpVersion,
        input.cartId ?? null,
        input.cartSnapshotHash ?? null,
        input.cart ? JSON.stringify(redactUcpPayload(input.cart)) : null,
        input.checkoutId,
        input.selectedPaymentHandlerId ?? null,
        input.idempotencyKeyHash,
        input.requestFingerprint,
        input.lastCheckoutStatus,
        input.checkoutSnapshotHash,
        JSON.stringify(redactUcpPayload(input.checkout)),
        JSON.stringify(input.businessProfile),
        JSON.stringify(input.negotiation),
        input.orderId ?? null,
        input.orderPermalinkUrl ?? null
      ]
    )

    if (inserted) return { stored: true, session: rowToSession(inserted) }

    const existing = await queryOne<SessionRow>(
      client,
      `
        select *
        from ucp_checkout_sessions
        where integration_id = $1 and idempotency_key_hash = $2
        limit 1
      `,
      [input.integrationId, input.idempotencyKeyHash]
    )

    if (!existing) {
      return {
        stored: false,
        conflict: true,
        message: 'UCP checkout idempotency insert conflicted but no replay row was available.'
      }
    }

    if (existing.request_fingerprint && existing.request_fingerprint !== input.requestFingerprint) {
      return {
        stored: false,
        conflict: true,
        message: 'UCP checkout idempotency key was reused with different request parameters.'
      }
    }

    return {
      stored: false,
      replay: true,
      session: rowToSession(existing)
    }
  },

  async readSession(transactionId) {
    const row = await queryOne<SessionRow>(
      client,
      'select * from ucp_checkout_sessions where transaction_id = $1 limit 1',
      [transactionId]
    )
    return row ? rowToSession(row) : undefined
  },

  async readSessionForPrincipal(transactionId, principal) {
    const row = await queryOne<SessionRow>(
      client,
      `
        select *
        from ucp_checkout_sessions
        where transaction_id = $1
          and owner_key_id = $2
          and owner_principal_hash = $3
          and integration_id = $4
          and external_subject_ref_hash is not distinct from $5
          and external_task_ref_hash is not distinct from $6
        limit 1
      `,
      [
        transactionId,
        principal.keyId,
        principal.ownerPrincipalHash,
        principal.integrationId,
        principal.externalSubjectRefHash ?? null,
        principal.externalTaskRefHash ?? null
      ]
    )
    return row ? rowToSession(row) : undefined
  },

  async readSessionByCheckout(input) {
    const row = await queryOne<SessionRow>(
      client,
      `
        select *
        from ucp_checkout_sessions
        where merchant_origin = $1 and checkout_id = $2
        limit 1
      `,
      [input.merchantOrigin, input.checkoutId]
    )
    return row ? rowToSession(row) : undefined
  },

  async updateCheckout(input) {
    const checkoutSnapshotHash = ucpCheckoutSnapshotHash(input.checkout)
    const row = await queryOne<SessionRow>(
      client,
      `
        update ucp_checkout_sessions
        set checkout_json = $2::jsonb,
            checkout_id = $3,
            selected_payment_handler_id = case
              when checkout_snapshot_hash is distinct from $5 then null
              else selected_payment_handler_id
            end,
            last_checkout_status = $4,
            checkout_snapshot_hash = $5,
            order_id = $6,
            order_permalink_url = $7,
            updated_at = now()
        where transaction_id = $1
        returning *
      `,
      [
        input.transactionId,
        JSON.stringify(redactUcpPayload(input.checkout)),
        input.checkout.id,
        input.checkout.status,
        checkoutSnapshotHash,
        input.checkout.order?.id ?? null,
        input.checkout.order?.permalink_url ?? null
      ]
    )

    if (!row) throw new Error('ucp_checkout_session_not_found')
    return rowToSession(row)
  },

  async updateCart(input) {
    const cartSnapshotHash = ucpStableHash(input.cart)
    const row = await queryOne<SessionRow>(
      client,
      `
        update ucp_checkout_sessions
        set cart_json = $2::jsonb,
            cart_id = $3,
            cart_snapshot_hash = $4,
            updated_at = now()
        where transaction_id = $1
        returning *
      `,
      [
        input.transactionId,
        JSON.stringify(redactUcpPayload(input.cart)),
        input.cart.id,
        cartSnapshotHash
      ]
    )

    if (!row) throw new Error('ucp_checkout_session_not_found')
    return rowToSession(row)
  },

  async recordConfirmation(input) {
    await client.query(
      `
        insert into ucp_checkout_confirmations (
          transaction_id,
          checkout_id,
          checkout_snapshot_hash,
          total_amount,
          currency,
          approval_ref,
          approval_payload
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb)
        on conflict (transaction_id) do update
        set checkout_id = excluded.checkout_id,
            checkout_snapshot_hash = excluded.checkout_snapshot_hash,
            total_amount = excluded.total_amount,
            currency = excluded.currency,
            approval_ref = excluded.approval_ref,
            approval_payload = excluded.approval_payload,
            approved_at = now()
      `,
      [
        input.transactionId,
        input.confirmation.checkoutId,
        input.confirmation.checkoutSnapshotHash,
        input.confirmation.totalAmount ?? null,
        input.confirmation.currency ?? null,
        input.confirmation.approvalRef,
        JSON.stringify(redactUcpPayload(input.approvalPayload))
      ]
    )
    return input.confirmation
  },

  async readConfirmation(transactionId) {
    const row = await queryOne<{
      checkout_id: string
      checkout_snapshot_hash: string
      total_amount: number | null
      currency: string | null
      approval_ref: string
      approved_at: string | Date
    }>(
      client,
      'select * from ucp_checkout_confirmations where transaction_id = $1 limit 1',
      [transactionId]
    )

    if (!row) return undefined
    return {
      checkoutId: row.checkout_id,
      checkoutSnapshotHash: row.checkout_snapshot_hash,
      ...(row.total_amount !== null ? { totalAmount: row.total_amount } : {}),
      ...(row.currency ? { currency: row.currency } : {}),
      approvedAt: iso(row.approved_at),
      approvalRef: row.approval_ref
    }
  },

  async recordOperation(input) {
    await client.query(
      `
        insert into ucp_checkout_operations (
          operation_id,
          transaction_id,
          operation,
          idempotency_key_hash,
          request_json,
          response_json,
          status,
          retry_after_seconds,
          completed_at
        )
        values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, now())
        on conflict (transaction_id, operation, idempotency_key_hash) do update
        set response_json = excluded.response_json,
            status = excluded.status,
            retry_after_seconds = excluded.retry_after_seconds,
            completed_at = now()
      `,
      [
        `ucpop_${randomUUID()}`,
        input.transactionId,
        input.operation,
        input.idempotencyKeyHash,
        JSON.stringify(redactUcpPayload(input.request)),
        input.response === undefined ? null : JSON.stringify(redactUcpPayload(input.response)),
        input.status,
        input.retryAfterSeconds ?? null
      ]
    )
  },

  async readOperation(input) {
    const row = await queryOne<CheckoutOperationRow>(
      client,
      `
        select transaction_id, operation, idempotency_key_hash, request_json,
          response_json, status, retry_after_seconds
        from ucp_checkout_operations
        where transaction_id = $1
          and operation = $2
          and idempotency_key_hash = $3
        limit 1
      `,
      [input.transactionId, input.operation, input.idempotencyKeyHash]
    )
    return row ? rowToOperation(row) : undefined
  },

  async hasCompletedCheckoutOperation(transactionId) {
    const row = await queryOne<{ completed: boolean }>(
      client,
      `
        select exists (
          select 1
          from ucp_checkout_operations
          where transaction_id = $1
            and operation = 'complete_checkout'
            and status in ('succeeded', 'unknown_outcome')
            and coalesce(response_json #>> '{checkout,status}', response_json ->> 'status') = 'completed'
        ) as completed
      `,
      [transactionId]
    )
    return row?.completed === true
  },

  async recordPaymentResult(input) {
    const inserted = await queryOne<PaymentResultRow>(
      client,
      `
        with current_checkout as (
          select transaction_id
          from ucp_checkout_sessions
          where transaction_id = $2
            and checkout_snapshot_hash = $5
            and last_checkout_status in ('incomplete', 'ready_for_complete')
          for update
        ), inserted as (
          insert into ucp_payment_results (
            payment_result_id,
            transaction_id,
            provider,
            handler_id,
            checkout_snapshot_hash,
            idempotency_key_hash,
            result_fingerprint,
            instrument_json,
            provider_result_json
          )
          select $1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb
          from current_checkout
          on conflict (transaction_id, idempotency_key_hash) do nothing
          returning *
        ), selected_handler as (
          update ucp_checkout_sessions
          set selected_payment_handler_id = $4,
              updated_at = now()
          where transaction_id = $2
            and exists (select 1 from inserted)
          returning transaction_id
        )
        select inserted.*
        from inserted
        join selected_handler using (transaction_id)
      `,
      [
        input.paymentResultId,
        input.transactionId,
        input.provider,
        input.handlerId,
        input.checkoutSnapshotHash,
        input.idempotencyKeyHash,
        input.resultFingerprint,
        JSON.stringify(redactUcpPayload(input.instrument)),
        JSON.stringify(redactUcpPayload(input.providerResult))
      ]
    )

    if (inserted) return { stored: true, paymentResult: rowToPaymentResult(inserted) }

    const existing = await queryOne<PaymentResultRow>(
      client,
      `
        select payment_result.*
        from ucp_payment_results as payment_result
        join ucp_checkout_sessions as checkout_session
          on checkout_session.transaction_id = payment_result.transaction_id
        where payment_result.transaction_id = $1
          and payment_result.idempotency_key_hash = $2
          and payment_result.checkout_snapshot_hash = $3
          and payment_result.revoked_at is null
          and checkout_session.checkout_snapshot_hash = $3
          and checkout_session.last_checkout_status in ('incomplete', 'ready_for_complete')
        limit 1
      `,
      [input.transactionId, input.idempotencyKeyHash, input.checkoutSnapshotHash]
    )
    if (!existing) {
      return {
        stored: false,
        conflict: true,
        message: 'Payment-result authority does not match the current active checkout snapshot.'
      }
    }

    if (
      existing.result_fingerprint !== input.resultFingerprint ||
      existing.checkout_snapshot_hash !== input.checkoutSnapshotHash ||
      existing.revoked_at !== null
    ) {
      return {
        stored: false,
        conflict: true,
        message: existing.checkout_snapshot_hash !== input.checkoutSnapshotHash || existing.revoked_at !== null
          ? 'Payment-result authority no longer matches the current checkout snapshot.'
          : 'Payment-result idempotency key was reused with different provider result parameters.'
      }
    }

    return {
      stored: false,
      replay: true,
      paymentResult: rowToPaymentResult(existing)
    }
  },

  async readLatestPaymentResult(transactionId, checkoutSnapshotHash) {
    const row = await queryOne<PaymentResultRow>(
      client,
      `
        select *
        from ucp_payment_results
        where transaction_id = $1
          and (
            $2::text is null
            or (
              checkout_snapshot_hash = $2
              and revoked_at is null
            )
          )
        order by created_at desc
        limit 1
      `,
      [transactionId, checkoutSnapshotHash ?? null]
    )
    return row ? rowToPaymentResult(row) : undefined
  },

  async revokePaymentResults(input) {
    const result = await client.query<PaymentResultRow>(
      `
        update ucp_payment_results
        set revoked_at = now(),
            revocation_reason = $2
        where transaction_id = $1
          and revoked_at is null
          and ($3::text is null or checkout_snapshot_hash = $3)
        returning *
      `,
      [input.transactionId, input.reason, input.checkoutSnapshotHash ?? null]
    )
    return result.rows.map(rowToPaymentResult)
  },

  async createPaymentAction(input) {
    const row = await queryOne<PaymentActionRow>(
      client,
      `
        with current_checkout as (
          select transaction_id
          from ucp_checkout_sessions
          where transaction_id = $2
            and checkout_id = $10
            and checkout_snapshot_hash = $11
            and last_checkout_status in ('incomplete', 'ready_for_complete')
          for update
        )
        insert into ucp_payment_actions (
          action_id,
          transaction_id,
          integration_id,
          owner_key_id,
          owner_principal_hash,
          external_subject_ref_hash,
          external_task_ref_hash,
          agent_session_id,
          merchant_origin,
          checkout_id,
          checkout_snapshot_hash,
          handler_id,
          handler_name,
          handler_version,
          handler_specification,
          handler_schema,
          provider,
          capability_id,
          connector_host_id,
          authorization_mode,
          mandate_id,
          mandate_version,
          route,
          presentation,
          provider_session_id,
          provider_reference_id,
          provider_event_id,
          action_type,
          status,
          amount,
          currency,
          token_nonce_hash,
          action_payload_json,
          result_fingerprint,
          payment_result_id,
          expires_at,
          consumed_at,
          revoked_at
        )
        select
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12,
          $13,
          $14,
          $15,
          $16,
          $17,
          $18,
          $19,
          $20,
          $21,
          $22,
          $23,
          $24,
          $25,
          $26,
          $27,
          $28,
          $29,
          $30,
          $31,
          $32,
          $33::jsonb,
          $34,
          $35,
          $36::timestamptz,
          $37::timestamptz,
          $38::timestamptz
        from current_checkout
        on conflict (action_id) do update
        set updated_at = ucp_payment_actions.updated_at
        where ucp_payment_actions.transaction_id = excluded.transaction_id
          and ucp_payment_actions.integration_id = excluded.integration_id
          and ucp_payment_actions.checkout_id = excluded.checkout_id
          and ucp_payment_actions.checkout_snapshot_hash = excluded.checkout_snapshot_hash
          and ucp_payment_actions.handler_id = excluded.handler_id
          and ucp_payment_actions.handler_name = excluded.handler_name
          and ucp_payment_actions.provider = excluded.provider
          and ucp_payment_actions.action_type = excluded.action_type
          and ucp_payment_actions.token_nonce_hash = excluded.token_nonce_hash
        returning *
      `,
      [
        input.actionId,
        input.transactionId,
        input.integrationId,
        input.ownerKeyId ?? null,
        input.ownerPrincipalHash ?? null,
        input.externalSubjectRefHash ?? null,
        input.externalTaskRefHash ?? null,
        input.agentSessionId ?? null,
        input.merchantOrigin,
        input.checkoutId,
        input.checkoutSnapshotHash,
        input.handlerId,
        input.handlerName,
        input.handlerVersion ?? null,
        input.handlerSpecification ?? null,
        input.handlerSchema ?? null,
        input.provider,
        input.capabilityId ?? null,
        input.connectorHostId ?? null,
        input.authorizationMode ?? null,
        input.mandateId ?? null,
        input.mandateVersion ?? null,
        input.route ?? null,
        input.presentation ?? null,
        input.providerSessionId ?? null,
        input.providerReferenceId ?? null,
        input.providerEventId ?? null,
        input.actionType,
        input.status,
        input.amount ?? null,
        input.currency ?? null,
        input.tokenNonceHash,
        JSON.stringify(redactUcpPayload(input.actionPayload)),
        input.resultFingerprint ?? null,
        input.paymentResultId ?? null,
        input.expiresAt,
        input.consumedAt ?? null,
        input.revokedAt ?? null
      ]
    )
    if (!row) throw new Error('ucp_payment_action_checkout_not_active')
    return rowToPaymentAction(row)
  },

  async markPaymentActionApproved(input) {
    const row = await queryOne<PaymentActionRow>(
      client,
      `
        update ucp_payment_actions
        set status = 'approved',
            approved_at = now(),
            updated_at = now()
        where action_id = $1
          and status = 'pending_user_approval'
          and expires_at > now()
        returning *
      `,
      [input.actionId]
    )
    return row ? rowToPaymentAction(row) : undefined
  },

  async readPaymentAction(actionId) {
    const row = await queryOne<PaymentActionRow>(
      client,
      'select * from ucp_payment_actions where action_id = $1 limit 1',
      [actionId]
    )
    return row ? rowToPaymentAction(row) : undefined
  },

  async bindPaymentActionProviderReference(input) {
    const row = await queryOne<PaymentActionRow>(
      client,
      `
        update ucp_payment_actions
        set provider_reference_id = $2,
            updated_at = now()
        where action_id = $1
          and status = 'pending_user_approval'
          and expires_at > now()
          and (provider_reference_id is null or provider_reference_id = $2)
        returning *
      `,
      [input.actionId, input.providerReferenceId]
    ).catch((error: unknown) => {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '23505'
      ) return undefined
      throw error
    })
    return row ? rowToPaymentAction(row) : undefined
  },

  async markPaymentActionCredentialReady(input) {
    const row = await queryOne<PaymentActionRow>(
      client,
      `
        update ucp_payment_actions
        set status = 'credential_ready',
            payment_result_id = $2,
            result_fingerprint = $3,
            credential_ready_at = now(),
            updated_at = now()
        where action_id = $1
          and status = 'approved'
          and expires_at > now()
        returning *
      `,
      [input.actionId, input.paymentResultId, input.resultFingerprint]
    )
    return row ? rowToPaymentAction(row) : undefined
  },

  async consumePaymentAction(input) {
    const row = await queryOne<PaymentActionRow>(
      client,
      `
        update ucp_payment_actions
        set status = 'consumed',
            consumed_at = now(),
            updated_at = now()
        where transaction_id = $1
          and payment_result_id = $2
          and status = 'credential_ready'
        returning *
      `,
      [input.transactionId, input.paymentResultId]
    )
    return row ? rowToPaymentAction(row) : undefined
  },

  async revokeSiblingPaymentActions(input) {
    const result = await client.query(
      `
        update ucp_payment_actions
        set status = 'revoked',
            revoked_at = now(),
            updated_at = now(),
            action_payload_json = jsonb_set(
              coalesce(action_payload_json, '{}'::jsonb),
              '{revoked_reason}',
              to_jsonb($3::text),
              true
            )
        where transaction_id = $1
          and status in ('pending_user_approval', 'approved', 'credential_ready')
          and ($2::text is null or action_id <> $2)
      `,
      [input.transactionId, input.consumedActionId ?? null, input.reason]
    )
    return result.rowCount ?? 0
  },

  async markPaymentActionFailed(input) {
    const row = await queryOne<PaymentActionRow>(
      client,
      `
        update ucp_payment_actions
        set status = case when expires_at <= now() then 'expired' else 'failed' end,
            result_fingerprint = coalesce($2, result_fingerprint),
            failed_at = now(),
            updated_at = now()
        where action_id = $1
          and status in ('pending_user_approval', 'approved', 'credential_ready')
        returning *
      `,
      [input.actionId, input.resultFingerprint ?? null]
    )
    return row ? rowToPaymentAction(row) : undefined
  },

  async revokePendingPaymentActions(input) {
    const result = await client.query(
      `
        update ucp_payment_actions
        set status = 'revoked',
            revoked_at = now(),
            updated_at = now(),
            action_payload_json = jsonb_set(
              coalesce(action_payload_json, '{}'::jsonb),
              '{revoked_reason}',
              to_jsonb($2::text),
              true
            )
        where transaction_id = $1
          and status in ('pending_user_approval', 'approved', 'credential_ready')
          and ($3::text is null or checkout_snapshot_hash = $3)
      `,
      [input.transactionId, input.reason, input.checkoutSnapshotHash ?? null]
    )
    return result.rowCount ?? 0
  },

  async claimAp2Mandate(input) {
    const inserted = await queryOne<{ mandate_hash: string }>(
      client,
      `
        insert into ucp_ap2_mandate_replay (
          mandate_hash,
          mandate_id,
          transaction_id,
          checkout_id,
          expires_at
        )
        values ($1, $2, $3, $4, $5::timestamptz)
        on conflict (mandate_hash) do nothing
        returning mandate_hash
      `,
      [
        input.mandateHash,
        input.mandateId ?? null,
        input.transactionId,
        input.checkoutId,
        input.expiresAt
      ]
    )
    if (inserted) return 'claimed'
    const existing = await queryOne<{
      transaction_id: string
      checkout_id: string
    }>(
      client,
      `
        select transaction_id, checkout_id
        from ucp_ap2_mandate_replay
        where mandate_hash = $1
        limit 1
      `,
      [input.mandateHash]
    )
    return existing?.transaction_id === input.transactionId && existing.checkout_id === input.checkoutId
      ? 'recovered'
      : 'replay'
  },

  async recordAp2Authority(input) {
    await client.query(
      `
        insert into ap2_verified_authorities (
          authority_id,
          transaction_id,
          owner_key_id,
          owner_principal_hash,
          integration_id,
          agent_session_id,
          canonical_mandate_id,
          canonical_mandate_version,
          merchant_origin,
          checkout_id,
          checkout_snapshot_hash,
          amount_minor,
          currency,
          authority_mode,
          checkout_mandate_id,
          payment_mandate_id,
          checkout_receipt_reference,
          payment_receipt_reference,
          agent_key_thumbprint,
          expires_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::timestamptz
        )
        on conflict (authority_id) do update
        set updated_at = now()
        where ap2_verified_authorities.transaction_id = excluded.transaction_id
          and ap2_verified_authorities.checkout_id = excluded.checkout_id
          and ap2_verified_authorities.checkout_snapshot_hash = excluded.checkout_snapshot_hash
      `,
      [
        input.authorityId,
        input.transactionId,
        input.ownerKeyId ?? null,
        input.ownerPrincipalHash ?? null,
        input.integrationId,
        input.agentSessionId ?? null,
        input.canonicalMandateId ?? null,
        input.canonicalMandateVersion ?? null,
        input.merchantOrigin,
        input.checkoutId,
        input.checkoutSnapshotHash,
        input.amountMinor,
        input.currency,
        input.authorityMode,
        input.checkoutMandateId,
        input.paymentMandateId,
        input.checkoutReceiptReference,
        input.paymentReceiptReference,
        input.agentKeyThumbprint ?? null,
        input.expiresAt
      ]
    )
  },

  async invalidateAp2Authorities(input) {
    const result = await client.query(
      `
        update ap2_verified_authorities
        set status = 'invalidated',
            invalidation_reason = $2,
            invalidated_at = now()
        where transaction_id = $1
          and status = 'active'
          and ($3::text is null or checkout_snapshot_hash = $3)
      `,
      [input.transactionId, input.reason, input.checkoutSnapshotHash ?? null]
    )
    return result.rowCount ?? 0
  },

  async consumeAp2Authorities(input) {
    const result = await client.query(
      `
        update ap2_verified_authorities
        set status = 'consumed',
            consumed_at = now(),
            updated_at = now()
        where transaction_id = $1
          and status = 'active'
      `,
      [input.transactionId]
    )
    return result.rowCount ?? 0
  },

  async readAp2AuthorityForReceipt(input) {
    const referenceColumn = input.kind === 'checkout'
      ? 'checkout_receipt_reference'
      : 'payment_receipt_reference'
    const row = await queryOne<{ authority_id: string }>(
      client,
      `
        select authority_id
        from ap2_verified_authorities
        where transaction_id = $1
          and ${referenceColumn} = $2
          and status in ('active', 'consumed')
          and expires_at > now()
        limit 1
      `,
      [input.transactionId, input.reference]
    )
    return row ? { authorityId: row.authority_id } : undefined
  },

  async recordAp2ProtocolReceipt(input) {
    const inserted = await queryOne<{ receipt_id: string }>(
      client,
      `
        insert into ap2_protocol_receipts (
          receipt_id,
          authority_id,
          receipt_kind,
          status,
          issuer,
          reference,
          order_id,
          payment_id,
          psp_confirmation_id,
          network_confirmation_id,
          receipt_jwt,
          issued_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz)
        on conflict (receipt_kind, reference) do nothing
        returning receipt_id
      `,
      [
        input.receiptId,
        input.authorityId,
        input.kind,
        input.status,
        input.issuer,
        input.reference,
        input.orderId ?? null,
        input.paymentId ?? null,
        input.pspConfirmationId ?? null,
        input.networkConfirmationId ?? null,
        input.receiptJwt,
        input.issuedAt
      ]
    )
    if (inserted) return 'recorded'
    const existing = await queryOne<{
      authority_id: string
      receipt_jwt: string
    }>(
      client,
      `
        select authority_id, receipt_jwt
        from ap2_protocol_receipts
        where receipt_kind = $1
          and reference = $2
        limit 1
      `,
      [input.kind, input.reference]
    )
    return existing?.authority_id === input.authorityId && existing.receipt_jwt === input.receiptJwt
      ? 'recovered'
      : 'conflict'
  },

  async recordEmbeddedCheckoutMessage(input) {
    await client.query(
      `
        insert into ucp_embedded_checkout_events (
          embedded_event_id,
          transaction_id,
          embedded_session_id,
          message_type,
          origin,
          payload_json
        )
        values ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        `ucpembed_${randomUUID()}`,
        input.transactionId,
        input.embeddedSessionId,
        input.messageType,
        input.origin,
        JSON.stringify(redactUcpPayload(input.payload))
      ]
    )
  },

  async recordOrder(input) {
    const row = await queryOne<{ order_json: UcpOrder }>(
      client,
      `
        insert into ucp_orders (
          order_record_id,
          transaction_id,
          owner_key_id,
          owner_principal_hash,
          merchant_origin,
          checkout_id,
          order_id,
          order_permalink_url,
          ucp_version,
          order_json
        )
        select
          $1,
          $2,
          session.owner_key_id,
          session.owner_principal_hash,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8::jsonb
        from ucp_checkout_sessions session
        where session.transaction_id = $2
        on conflict (merchant_origin, order_id) do update
        set transaction_id = excluded.transaction_id,
            checkout_id = excluded.checkout_id,
            ucp_version = excluded.ucp_version,
            order_json = excluded.order_json,
            order_permalink_url = excluded.order_permalink_url,
            owner_key_id = coalesce(excluded.owner_key_id, ucp_orders.owner_key_id),
            owner_principal_hash = coalesce(excluded.owner_principal_hash, ucp_orders.owner_principal_hash),
            last_seen_at = now()
        returning order_json
      `,
      [
        `ucporder_${randomUUID()}`,
        input.transactionId,
        input.merchantOrigin,
        input.order.checkout_id,
        input.order.id,
        input.order.permalink_url,
        input.order.ucp.version,
        JSON.stringify(redactUcpPayload(input.order))
      ]
    )
    if (!row) {
      throw new Error(`Cannot persist UCP Order ${input.order.id}: checkout session ${input.transactionId} does not exist.`)
    }
    return row.order_json
  },

  async readOrder(orderId, merchantOrigin) {
    const row = await queryOne<{ order_json: UcpOrder }>(
      client,
      'select order_json from ucp_orders where merchant_origin = $1 and order_id = $2 limit 1',
      [merchantOrigin, orderId]
    )
    return row?.order_json
  },

  async readOrderForPrincipal(orderId, transactionId, principal) {
    const row = await queryOne<{ order_json: UcpOrder }>(
      client,
      `
        select o.order_json
        from ucp_orders o
        join ucp_checkout_sessions s on s.transaction_id = o.transaction_id
        where o.order_id = $1
          and o.transaction_id = $2
          and s.owner_key_id = $3
          and s.owner_principal_hash = $4
          and s.integration_id = $5
          and s.external_subject_ref_hash is not distinct from $6
          and s.external_task_ref_hash is not distinct from $7
        limit 1
      `,
      [
        orderId,
        transactionId,
        principal.keyId,
        principal.ownerPrincipalHash,
        principal.integrationId,
        principal.externalSubjectRefHash ?? null,
        principal.externalTaskRefHash ?? null
      ]
    )
    return row?.order_json
  },

  async recordOrderWebhook(input) {
    const dedupeHash = ucpStableHash({
      webhookId: input.webhookId,
      orderId: input.order.id,
      checkoutId: input.order.checkout_id,
      body: input.order
    })
    await client.query(
      `
        insert into ucp_order_webhook_events (
          webhook_event_id,
          merchant_origin,
          event_type,
          checkout_id,
          order_id,
          event_json,
          order_json,
          webhook_id,
          webhook_timestamp,
          ucp_agent,
          content_digest,
          signature_input,
          signature,
          signature_verified,
          dedupe_hash,
          processed_at
        )
        values ($1, $2, 'order_state', $3, $4, $5::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, now())
        on conflict (merchant_origin, dedupe_hash) do nothing
      `,
      [
        `ucpwh_${randomUUID()}`,
        input.merchantOrigin,
        input.order.checkout_id,
        input.order.id,
        JSON.stringify(redactUcpPayload(input.order)),
        input.webhookId,
        input.webhookTimestamp,
        input.ucpAgent,
        input.contentDigest,
        input.signatureInput,
        input.signature,
        input.signatureVerified,
        dedupeHash
      ]
    )

    const session = await queryOne<{ transaction_id: string }>(
      client,
      `
        select transaction_id
        from ucp_checkout_sessions
        where merchant_origin = $1 and checkout_id = $2
        limit 1
      `,
      [input.merchantOrigin, input.order.checkout_id]
    )

    if (session) {
      await this.recordOrder({
        transactionId: session.transaction_id,
        merchantOrigin: input.merchantOrigin,
        order: input.order
      })
    }

    return input.order
  }
})
