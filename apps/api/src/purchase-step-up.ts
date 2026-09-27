import { createHash, randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import type { PurchaseResponse } from '@arro/contracts'
import type { CommercePrincipal } from './commerce-principal.ts'
import type { Queryable } from './target-business-repository.ts'

export type PurchaseStepUpDecision = 'approve' | 'reject' | 'challenge_satisfied'
type PurchaseItemSummary = PurchaseResponse['items'][number]

export type PurchaseStepUpAction = {
  actionId: string
  purchaseId: string
  jobId: string
  mandateId: string
  mandateVersion: number
  merchantOrigin: string
  checkoutId: string
  checkoutSnapshotHash: string
  amountMinor: string
  currency: string
  items: PurchaseItemSummary[]
  reasonCode: string
  requestedAction: string
  status: 'pending' | 'approved' | 'rejected' | 'challenge_satisfied' | 'expired' | 'invalidated' | 'consumed'
  expiresAt: string
  display: {
    title: string
    merchantOrigin: string
    amountMinor: string
    currency: string
    items: PurchaseItemSummary[]
    reasonCode: string
    decisions: Array<'approve' | 'reject' | 'challenge_satisfied'>
    expiresAt: string
  }
  decisionRef?: string
  providerChallengeRef?: string
}

type StepUpRow = QueryResultRow & {
  step_up_action_id: string
  purchase_id: string
  job_id: string
  mandate_id: string
  mandate_version: number
  merchant_origin: string
  checkout_id: string
  checkout_snapshot_hash: string
  amount_minor: string
  currency: string
  items_json: PurchaseItemSummary[]
  display_json: PurchaseStepUpAction['display']
  reason_code: string
  requested_action: string
  status: PurchaseStepUpAction['status']
  expires_at: string | Date
  decision_ref: string | null
  provider_challenge_ref: string | null
}

const iso = (value: string | Date) => value instanceof Date ? value.toISOString() : new Date(value).toISOString()

const rowToAction = (row: StepUpRow): PurchaseStepUpAction => ({
  actionId: row.step_up_action_id,
  purchaseId: row.purchase_id,
  jobId: row.job_id,
  mandateId: row.mandate_id,
  mandateVersion: row.mandate_version,
  merchantOrigin: row.merchant_origin,
  checkoutId: row.checkout_id,
  checkoutSnapshotHash: row.checkout_snapshot_hash,
  amountMinor: row.amount_minor,
  currency: row.currency,
  items: row.items_json,
  reasonCode: row.reason_code,
  requestedAction: row.requested_action,
  status: row.status,
  expiresAt: iso(row.expires_at),
  display: row.display_json,
  ...(row.decision_ref ? { decisionRef: row.decision_ref } : {}),
  ...(row.provider_challenge_ref ? { providerChallengeRef: row.provider_challenge_ref } : {})
})

const ownerIdFor = (principal: CommercePrincipal) => `${principal.keyId}:${principal.ownerPrincipalHash}`

export class PurchaseStepUpError extends Error {
  readonly code:
    | 'step_up_not_found'
    | 'step_up_invalid'
    | 'step_up_expired'
    | 'step_up_replayed'

  constructor(code: PurchaseStepUpError['code'], message: string) {
    super(message)
    this.name = 'PurchaseStepUpError'
    this.code = code
  }
}

export type PurchaseStepUpRepository = {
  create(input: {
    principal: CommercePrincipal
    purchaseId: string
    jobId: string
    mandateId: string
    mandateVersion: number
    merchantOrigin: string
    checkoutId: string
    checkoutSnapshotHash: string
    amountMinor: string
    currency: string
    items: PurchaseItemSummary[]
    reasonCode: string
    requestedAction: string
    expiresAt: string
  }): Promise<PurchaseStepUpAction>
  read(input: {
    principal: CommercePrincipal
    purchaseId: string
    actionId: string
  }): Promise<PurchaseStepUpAction | undefined>
  readPendingForJob(input: {
    jobId: string
    purchaseId: string
    mandateId: string
    mandateVersion: number
  }): Promise<PurchaseStepUpAction | undefined>
  decide(input: {
    principal: CommercePrincipal
    purchaseId: string
    actionId: string
    decision: PurchaseStepUpDecision
    decisionRef: string
    providerChallengeRef?: string
  }): Promise<PurchaseStepUpAction>
  consumeApproved(input: {
    jobId: string
    purchaseId: string
    mandateId: string
    mandateVersion: number
    checkoutSnapshotHash: string
  }): Promise<PurchaseStepUpAction | undefined>
  invalidateForPurchase(input: {
    purchaseId: string
    reason: string
  }): Promise<number>
}

const sha256 = (value: string) => `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`

export const createPostgresPurchaseStepUpRepository = ({ client }: { client: Queryable }): PurchaseStepUpRepository => ({
  async create(input) {
    const actionId = `psu_${randomUUID()}`
    const display: PurchaseStepUpAction['display'] = {
      title: 'Purchase needs your approval',
      merchantOrigin: input.merchantOrigin,
      amountMinor: input.amountMinor,
      currency: input.currency,
      items: input.items,
      reasonCode: input.reasonCode,
      decisions: input.reasonCode === 'provider_challenge_required'
        ? ['challenge_satisfied', 'reject']
        : ['approve', 'reject'],
      expiresAt: input.expiresAt
    }
    await client.query(
      `
        update purchase_step_up_actions
        set status = 'invalidated',
            invalidated_at = now(),
            updated_at = now()
        where purchase_id = $1
          and mandate_id = $2
          and mandate_version = $3
          and status = 'pending'
          and (checkout_snapshot_hash <> $4 or reason_code <> $5)
      `,
      [input.purchaseId, input.mandateId, input.mandateVersion, input.checkoutSnapshotHash, input.reasonCode]
    )
    const inserted = await client.query<StepUpRow>(
      `
        insert into purchase_step_up_actions (
          step_up_action_id,
          owner_key_id,
          owner_principal_hash,
          integration_id,
          purchase_id,
          job_id,
          mandate_id,
          mandate_version,
          merchant_origin,
          checkout_id,
          checkout_snapshot_hash,
          amount_minor,
          currency,
          items_json,
          display_json,
          reason_code,
          requested_action,
          nonce_hash,
          expires_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14::jsonb, $15::jsonb, $16, $17, $18, $19::timestamptz
        )
        on conflict (purchase_id, mandate_id, mandate_version) where status = 'pending'
        do update set updated_at = now()
        returning *
      `,
      [
        actionId,
        input.principal.keyId,
        input.principal.ownerPrincipalHash,
        input.principal.integrationId,
        input.purchaseId,
        input.jobId,
        input.mandateId,
        input.mandateVersion,
        input.merchantOrigin,
        input.checkoutId,
        input.checkoutSnapshotHash,
        input.amountMinor,
        input.currency,
        JSON.stringify(input.items),
        JSON.stringify(display),
        input.reasonCode,
        input.requestedAction,
        sha256(actionId),
        input.expiresAt
      ]
    )
    if (!inserted.rows[0]) throw new PurchaseStepUpError('step_up_invalid', 'Step-up action could not be created.')
    return rowToAction(inserted.rows[0])
  },

  async read({ principal, purchaseId, actionId }) {
    const result = await client.query<StepUpRow>(
      `
        select *
        from purchase_step_up_actions
        where step_up_action_id = $1
          and purchase_id = $2
          and owner_key_id = $3
          and owner_principal_hash = $4
          and integration_id = $5
        limit 1
      `,
      [actionId, purchaseId, principal.keyId, principal.ownerPrincipalHash, principal.integrationId]
    )
    return result.rows[0] ? rowToAction(result.rows[0]) : undefined
  },

  async readPendingForJob(input) {
    const result = await client.query<StepUpRow>(
      `
        select *
        from purchase_step_up_actions
        where job_id = $1
          and purchase_id = $2
          and mandate_id = $3
          and mandate_version = $4
          and status in ('pending', 'approved', 'challenge_satisfied')
        order by created_at desc
        limit 1
      `,
      [input.jobId, input.purchaseId, input.mandateId, input.mandateVersion]
    )
    return result.rows[0] ? rowToAction(result.rows[0]) : undefined
  },

  async decide(input) {
    const nextStatus = input.decision === 'approve'
      ? 'approved'
      : input.decision === 'reject'
        ? 'rejected'
        : 'challenge_satisfied'
    const result = await client.query<StepUpRow>(
      `
        update purchase_step_up_actions
        set status = case when expires_at <= now() then 'expired' else $6 end,
            decision_ref = case when expires_at > now() then $7 else decision_ref end,
            provider_challenge_ref = case when expires_at > now() then $8 else provider_challenge_ref end,
            decided_at = case when expires_at > now() then now() else decided_at end,
            updated_at = now()
        where step_up_action_id = $1
          and purchase_id = $2
          and owner_key_id = $3
          and owner_principal_hash = $4
          and integration_id = $5
          and status = 'pending'
        returning *
      `,
      [
        input.actionId,
        input.purchaseId,
        input.principal.keyId,
        input.principal.ownerPrincipalHash,
        input.principal.integrationId,
        nextStatus,
        input.decisionRef,
        input.providerChallengeRef ?? null
      ]
    )
    const row = result.rows[0]
    if (!row) throw new PurchaseStepUpError('step_up_replayed', 'Step-up action is missing, expired, or already decided.')
    const action = rowToAction(row)
    if (action.status === 'expired') throw new PurchaseStepUpError('step_up_expired', 'Step-up action has expired.')
    return action
  },

  async consumeApproved(input) {
    const result = await client.query<StepUpRow>(
      `
        update purchase_step_up_actions
        set status = 'consumed',
            updated_at = now()
        where job_id = $1
          and purchase_id = $2
          and mandate_id = $3
          and mandate_version = $4
          and checkout_snapshot_hash = $5
          and status in ('approved', 'challenge_satisfied', 'consumed')
          and expires_at > now()
        returning *
      `,
      [input.jobId, input.purchaseId, input.mandateId, input.mandateVersion, input.checkoutSnapshotHash]
    )
    return result.rows[0] ? rowToAction(result.rows[0]) : undefined
  },

  async invalidateForPurchase({ purchaseId, reason }) {
    const result = await client.query(
      `
        update purchase_step_up_actions
        set status = 'invalidated',
            decision_ref = coalesce(decision_ref, $2),
            invalidated_at = now(),
            updated_at = now()
        where purchase_id = $1
          and status in ('pending', 'approved', 'challenge_satisfied')
      `,
      [purchaseId, `invalidated:${reason}`]
    )
    return result.rowCount ?? 0
  }
})
