import { randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import type { AutonomousPurchaseJob, AutonomousPurchaseJobCreateRequest } from '@arro/contracts'
import type { CommercePrincipal } from './commerce-principal.ts'
import type { PurchaseMandate } from './purchase-mandate.ts'
import type { Queryable } from './target-business-repository.ts'

export class AutonomousPurchaseJobError extends Error {
  readonly code:
    | 'autonomous_job_invalid'
    | 'autonomous_job_not_found'
    | 'autonomous_job_conflict'
    | 'autonomous_job_not_claimable'

  constructor(
    code:
      | 'autonomous_job_invalid'
      | 'autonomous_job_not_found'
      | 'autonomous_job_conflict'
      | 'autonomous_job_not_claimable',
    message: string
  ) {
    super(message)
    this.name = 'AutonomousPurchaseJobError'
    this.code = code
  }
}

type AutonomousJobRow = QueryResultRow & {
  job_id: string
  owner_key_id: string
  owner_principal_hash: string
  owner_id: string
  integration_id: string
  authorization_route: AutonomousPurchaseJob['authorizationRoute'] | null
  host_id: string | null
  agent_session_id: string | null
  mandate_id: string
  mandate_version: number
  status: AutonomousPurchaseJob['status']
  trigger_json: AutonomousPurchaseJob['trigger']
  lease_owner: string | null
  lease_expires_at: string | Date | null
  attempt_count: number
  next_attempt_at: string | Date | null
  purchase_id: string | null
  reservation_id: string | null
  last_safe_error_code: string | null
}

export type AutonomousPurchaseJobClaim = AutonomousPurchaseJob & {
  ownerKeyId: string
  ownerPrincipalHash: string
}

const iso = (value: string | Date | null | undefined) =>
  value ? (value instanceof Date ? value.toISOString() : new Date(value).toISOString()) : undefined

const rowToJob = (row: AutonomousJobRow): AutonomousPurchaseJob => ({
  jobId: row.job_id,
  ownerId: row.owner_id,
  integrationId: row.integration_id,
  ...(row.authorization_route ? { authorizationRoute: row.authorization_route } : {}),
  ...(row.host_id ? { hostId: row.host_id } : {}),
  ...(row.agent_session_id ? { agentSessionId: row.agent_session_id } : {}),
  mandateId: row.mandate_id,
  mandateVersion: row.mandate_version,
  status: row.status,
  trigger: row.trigger_json,
  ...(row.lease_owner ? { leaseOwner: row.lease_owner } : {}),
  ...(row.lease_expires_at ? { leaseExpiresAt: iso(row.lease_expires_at)! } : {}),
  attemptCount: row.attempt_count,
  ...(row.next_attempt_at ? { nextAttemptAt: iso(row.next_attempt_at)! } : {}),
  ...(row.purchase_id ? { purchaseId: row.purchase_id } : {}),
  ...(row.reservation_id ? { reservationId: row.reservation_id } : {}),
  ...(row.last_safe_error_code ? { lastSafeErrorCode: row.last_safe_error_code } : {})
})

const rowToClaim = (row: AutonomousJobRow): AutonomousPurchaseJobClaim => ({
  ...rowToJob(row),
  ownerKeyId: row.owner_key_id,
  ownerPrincipalHash: row.owner_principal_hash
})

const mandateOwnerIdFor = (principal: CommercePrincipal) =>
  `${principal.keyId}:${principal.ownerPrincipalHash}`

const nextAttemptForTrigger = (trigger: AutonomousPurchaseJobCreateRequest['trigger']) => {
  if (trigger.type === 'scheduled') {
    if (!trigger.executeAt || Number.isNaN(new Date(trigger.executeAt).getTime())) {
      throw new AutonomousPurchaseJobError(
        'autonomous_job_invalid',
        'Scheduled autonomous jobs require a valid executeAt timestamp.'
      )
    }
    return new Date(trigger.executeAt).toISOString()
  }
  if (trigger.type === 'immediate') return new Date().toISOString()
  return new Date(Date.now() + 5 * 60 * 1000).toISOString()
}

export type AutonomousPurchaseJobRepository = {
  create(input: {
    principal: CommercePrincipal
    mandate: PurchaseMandate
    trigger: AutonomousPurchaseJobCreateRequest['trigger']
    authorizationRoute: NonNullable<AutonomousPurchaseJob['authorizationRoute']>
    hostId: string
  }): Promise<AutonomousPurchaseJob>
  read(input: {
    principal: CommercePrincipal
    jobId: string
  }): Promise<AutonomousPurchaseJob | undefined>
  listForMandate(input: {
    principal: CommercePrincipal
    mandateId: string
  }): Promise<AutonomousPurchaseJob[]>
  claimNext(input: {
    leaseOwner: string
    leaseSeconds: number
  }): Promise<AutonomousPurchaseJobClaim | undefined>
  markExecuting(input: {
    jobId: string
    purchaseId: string
  }): Promise<AutonomousPurchaseJob>
  markWaitingForStepUp(input: {
    jobId: string
    safeErrorCode: string
    purchaseId?: string
  }): Promise<AutonomousPurchaseJob>
  resumeAfterStepUp(input: {
    principal: CommercePrincipal
    jobId: string
    purchaseId: string
  }): Promise<AutonomousPurchaseJob>
  markWaitingForCondition(input: {
    jobId: string
    safeErrorCode: string
    nextAttemptAt: string
  }): Promise<AutonomousPurchaseJob>
  markCheckoutPrepared(input: {
    jobId: string
    purchaseId: string
    reservationId?: string
  }): Promise<AutonomousPurchaseJob>
  markReconciliationRequired(input: {
    jobId: string
    safeErrorCode: string
    reservationId?: string
    nextAttemptAt?: string
  }): Promise<AutonomousPurchaseJob>
  renewLease(input: {
    jobId: string
    leaseOwner: string
    leaseSeconds: number
  }): Promise<AutonomousPurchaseJob>
  complete(input: {
    jobId: string
    purchaseId: string
    reservationId?: string
  }): Promise<AutonomousPurchaseJob>
  fail(input: {
    jobId: string
    safeErrorCode: string
    nextAttemptAt?: string
  }): Promise<AutonomousPurchaseJob>
  cancelForMandate(input: {
    principal: CommercePrincipal
    mandateId: string
  }): Promise<number>
  cancelJob(input: {
    principal: CommercePrincipal
    mandateId: string
    jobId: string
  }): Promise<AutonomousPurchaseJob>
}

export const createPostgresAutonomousPurchaseJobRepository = ({ client }: { client: Queryable }): AutonomousPurchaseJobRepository => ({
  async create({ principal, mandate, trigger, authorizationRoute, hostId }) {
    if (mandate.status !== 'active') {
      throw new AutonomousPurchaseJobError(
        'autonomous_job_invalid',
        'Autonomous purchase jobs require an active, provider-authorized mandate.'
      )
    }
    if (mandate.integrationId !== principal.integrationId || mandate.ownerId !== mandateOwnerIdFor(principal)) {
      throw new AutonomousPurchaseJobError(
        'autonomous_job_invalid',
        'Autonomous purchase job must be created by the mandate owner and integration.'
      )
    }
    const nextAttemptAt = nextAttemptForTrigger(trigger)
    const status: AutonomousPurchaseJob['status'] = trigger.type === 'condition'
      ? 'waiting_for_condition'
      : 'scheduled'
    const row = await client.query<AutonomousJobRow>(
      `
        insert into autonomous_purchase_jobs (
          job_id,
          owner_key_id,
          owner_principal_hash,
          owner_id,
          integration_id,
          authorization_route,
          host_id,
          agent_session_id,
          mandate_id,
          mandate_version,
          status,
          trigger_json,
          next_attempt_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
        returning *
      `,
      [
        `apj_${randomUUID()}`,
        principal.keyId,
        principal.ownerPrincipalHash,
        mandate.ownerId,
        principal.integrationId,
        authorizationRoute,
        hostId,
        principal.agentSessionId ?? null,
        mandate.mandateId,
        mandate.version,
        status,
        JSON.stringify(trigger),
        nextAttemptAt ?? null
      ]
    ).catch((error: unknown) => {
      if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === '23505') {
        throw new AutonomousPurchaseJobError(
          'autonomous_job_conflict',
          'An active autonomous purchase job already exists for this mandate version.'
        )
      }
      throw error
    })
    if (!row.rows[0]) throw new AutonomousPurchaseJobError('autonomous_job_invalid', 'Autonomous purchase job could not be created.')
    return rowToJob(row.rows[0])
  },

  async read({ principal, jobId }) {
    const row = await client.query<AutonomousJobRow>(
      `
        select *
        from autonomous_purchase_jobs
        where job_id = $1
          and owner_key_id = $2
          and owner_principal_hash = $3
        limit 1
      `,
      [jobId, principal.keyId, principal.ownerPrincipalHash]
    )
    return row.rows[0] ? rowToClaim(row.rows[0]) : undefined
  },

  async markExecuting({ jobId, purchaseId }) {
    const row = await client.query<AutonomousJobRow>(
      `
        update autonomous_purchase_jobs
        set status = 'executing',
            purchase_id = $2,
            updated_at = now()
        where job_id = $1
          and status in ('checkout_prepared', 'searching')
        returning *
      `,
      [jobId, purchaseId]
    )
    if (!row.rows[0]) throw new AutonomousPurchaseJobError('autonomous_job_not_found', 'Autonomous purchase job could not enter executing state.')
    return rowToJob(row.rows[0])
  },

  async markWaitingForStepUp({ jobId, safeErrorCode, purchaseId }) {
    const row = await client.query<AutonomousJobRow>(
      `
        update autonomous_purchase_jobs
        set status = 'waiting_for_step_up',
            purchase_id = coalesce($3, purchase_id),
            last_safe_error_code = $2,
            lease_owner = null,
            lease_expires_at = null,
            updated_at = now()
        where job_id = $1
          and status not in ('completed', 'cancelled', 'failed')
        returning *
      `,
      [jobId, safeErrorCode, purchaseId ?? null]
    )
    if (!row.rows[0]) throw new AutonomousPurchaseJobError('autonomous_job_not_found', 'Autonomous purchase job could not wait for step-up.')
    return rowToJob(row.rows[0])
  },

  async resumeAfterStepUp({ principal, jobId, purchaseId }) {
    const row = await client.query<AutonomousJobRow>(
      `
        update autonomous_purchase_jobs
        set status = 'scheduled',
            next_attempt_at = now(),
            last_safe_error_code = null,
            lease_owner = null,
            lease_expires_at = null,
            updated_at = now()
        where job_id = $1
          and purchase_id = $2
          and owner_key_id = $3
          and owner_principal_hash = $4
          and integration_id = $5
          and status = 'waiting_for_step_up'
        returning *
      `,
      [jobId, purchaseId, principal.keyId, principal.ownerPrincipalHash, principal.integrationId]
    )
    if (!row.rows[0]) {
      throw new AutonomousPurchaseJobError(
        'autonomous_job_not_claimable',
        'Autonomous purchase job is not waiting on this owner-scoped purchase step-up.'
      )
    }
    return rowToJob(row.rows[0])
  },

  async markWaitingForCondition({ jobId, safeErrorCode, nextAttemptAt }) {
    const row = await client.query<AutonomousJobRow>(
      `
        update autonomous_purchase_jobs
        set status = 'waiting_for_condition',
            next_attempt_at = $3::timestamptz,
            last_safe_error_code = $2,
            lease_owner = null,
            lease_expires_at = null,
            updated_at = now()
        where job_id = $1
          and status not in ('completed', 'cancelled', 'failed')
        returning *
      `,
      [jobId, safeErrorCode, nextAttemptAt]
    )
    if (!row.rows[0]) throw new AutonomousPurchaseJobError('autonomous_job_not_found', 'Autonomous purchase job could not wait for its condition.')
    return rowToJob(row.rows[0])
  },

  async listForMandate({ principal, mandateId }) {
    const rows = await client.query<AutonomousJobRow>(
      `
        select *
        from autonomous_purchase_jobs
        where mandate_id = $1
          and owner_key_id = $2
          and owner_principal_hash = $3
        order by created_at desc
        limit 100
      `,
      [mandateId, principal.keyId, principal.ownerPrincipalHash]
    )
    return rows.rows.map(rowToJob)
  },

  async claimNext({ leaseOwner, leaseSeconds }) {
    const row = await client.query<AutonomousJobRow>(
      `
        with candidate as (
          select job_id
          from autonomous_purchase_jobs
          where (
              (status = 'scheduled' and next_attempt_at <= now())
              or (status = 'waiting_for_condition' and next_attempt_at is not null and next_attempt_at <= now())
              or (status = 'reconciliation_required' and (next_attempt_at is null or next_attempt_at <= now()))
            )
            and (lease_expires_at is null or lease_expires_at <= now())
          order by created_at asc
          for update skip locked
          limit 1
        )
        update autonomous_purchase_jobs j
        set status = case
              when j.status = 'reconciliation_required' then 'reconciliation_required'
              else 'searching'
            end,
            lease_owner = $1,
            lease_expires_at = now() + ($2::text || ' seconds')::interval,
            attempt_count = attempt_count + 1,
            updated_at = now()
        from candidate
        where j.job_id = candidate.job_id
        returning j.*
      `,
      [leaseOwner, Math.max(1, leaseSeconds)]
    )
    return row.rows[0] ? rowToClaim(row.rows[0]) : undefined
  },

  async markCheckoutPrepared({ jobId, purchaseId, reservationId }) {
    const row = await client.query<AutonomousJobRow>(
      `
        update autonomous_purchase_jobs
        set status = 'checkout_prepared',
            purchase_id = $2,
            reservation_id = coalesce($3, reservation_id),
            updated_at = now()
        where job_id = $1
          and status in ('searching', 'scheduled', 'waiting_for_condition')
        returning *
      `,
      [jobId, purchaseId, reservationId ?? null]
    )
    if (!row.rows[0]) throw new AutonomousPurchaseJobError('autonomous_job_not_found', 'Autonomous purchase job could not be marked checkout_prepared.')
    return rowToJob(row.rows[0])
  },

  async markReconciliationRequired({ jobId, safeErrorCode, reservationId, nextAttemptAt }) {
    const row = await client.query<AutonomousJobRow>(
      `
        update autonomous_purchase_jobs
        set status = 'reconciliation_required',
            reservation_id = coalesce($3, reservation_id),
            last_safe_error_code = $2,
            next_attempt_at = coalesce($4::timestamptz, now() + interval '30 seconds'),
            lease_owner = null,
            lease_expires_at = null,
            updated_at = now()
        where job_id = $1
          and status not in ('completed', 'cancelled')
        returning *
      `,
      [jobId, safeErrorCode, reservationId ?? null, nextAttemptAt ?? null]
    )
    if (!row.rows[0]) throw new AutonomousPurchaseJobError('autonomous_job_not_found', 'Autonomous purchase job could not enter reconciliation.')
    return rowToJob(row.rows[0])
  },

  async renewLease({ jobId, leaseOwner, leaseSeconds }) {
    const row = await client.query<AutonomousJobRow>(
      `
        update autonomous_purchase_jobs
        set lease_expires_at = now() + ($3::text || ' seconds')::interval,
            updated_at = now()
        where job_id = $1
          and lease_owner = $2
          and lease_expires_at > now()
          and status in ('searching', 'checkout_prepared', 'executing', 'reconciliation_required')
        returning *
      `,
      [jobId, leaseOwner, Math.max(1, leaseSeconds)]
    )
    if (!row.rows[0]) throw new AutonomousPurchaseJobError('autonomous_job_not_claimable', 'Autonomous purchase job lease could not be renewed.')
    return rowToJob(row.rows[0])
  },

  async complete({ jobId, purchaseId, reservationId }) {
    const row = await client.query<AutonomousJobRow>(
      `
        update autonomous_purchase_jobs
        set status = 'completed',
            purchase_id = $2,
            reservation_id = coalesce($3, reservation_id),
            completed_at = now(),
            lease_owner = null,
            lease_expires_at = null,
            updated_at = now()
        where job_id = $1
          and status not in ('cancelled', 'failed')
        returning *
      `,
      [jobId, purchaseId, reservationId ?? null]
    )
    if (!row.rows[0]) throw new AutonomousPurchaseJobError('autonomous_job_not_found', 'Autonomous purchase job could not be completed.')
    return rowToJob(row.rows[0])
  },

  async fail({ jobId, safeErrorCode, nextAttemptAt }) {
    const row = await client.query<AutonomousJobRow>(
      `
        update autonomous_purchase_jobs
        set status = case when $3::timestamptz is null then 'failed' else 'scheduled' end,
            last_safe_error_code = $2,
            next_attempt_at = $3,
            failed_at = case when $3::timestamptz is null then now() else failed_at end,
            lease_owner = null,
            lease_expires_at = null,
            updated_at = now()
        where job_id = $1
          and status not in ('completed', 'cancelled')
        returning *
      `,
      [jobId, safeErrorCode, nextAttemptAt ?? null]
    )
    if (!row.rows[0]) throw new AutonomousPurchaseJobError('autonomous_job_not_found', 'Autonomous purchase job could not be failed or rescheduled.')
    return rowToJob(row.rows[0])
  },

  async cancelForMandate({ principal, mandateId }) {
    const row = await client.query<{ count: string }>(
      `
        with cancelled as (
          update autonomous_purchase_jobs
          set status = 'cancelled',
              cancelled_at = now(),
              lease_owner = null,
              lease_expires_at = null,
              updated_at = now()
          where mandate_id = $1
            and owner_key_id = $2
            and owner_principal_hash = $3
            and status in (
              'scheduled',
              'searching',
              'checkout_prepared',
              'waiting_for_condition',
              'waiting_for_step_up',
              'executing',
              'reconciliation_required'
            )
          returning job_id
        )
        select count(*)::text as count from cancelled
      `,
      [mandateId, principal.keyId, principal.ownerPrincipalHash]
    )
    return Number(row.rows[0]?.count ?? 0)
  },

  async cancelJob({ principal, mandateId, jobId }) {
    const row = await client.query<AutonomousJobRow>(
      `
        update autonomous_purchase_jobs
        set status = 'cancelled',
            cancelled_at = now(),
            lease_owner = null,
            lease_expires_at = null,
            updated_at = now()
        where job_id = $1
          and mandate_id = $2
          and owner_key_id = $3
          and owner_principal_hash = $4
          and status in (
            'scheduled',
            'searching',
            'checkout_prepared',
            'waiting_for_condition',
            'waiting_for_step_up',
            'executing',
            'reconciliation_required'
          )
        returning *
      `,
      [jobId, mandateId, principal.keyId, principal.ownerPrincipalHash]
    )
    if (!row.rows[0]) throw new AutonomousPurchaseJobError('autonomous_job_not_found', 'Autonomous purchase job could not be cancelled.')
    return rowToJob(row.rows[0])
  }
})
