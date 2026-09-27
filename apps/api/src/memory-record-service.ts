import { randomUUID } from 'node:crypto'
import type { CommerceMemoryProposal } from '@arro/contracts'
import {
  hashCommerceMemoryScopeRef,
  minCommerceMemoryHashPepperLength
} from './memory-proposal-service.ts'
import type { Queryable } from './target-business-repository.ts'

export type CommerceMemoryRecordStatus = 'active' | 'stale'
export type StaleMarkableCommerceMemoryRecordKind = Extract<
  CommerceMemoryProposal['recordKind'],
  | 'saved_product_reference'
  | 'comparison_reference'
  | 'cart_handoff_reference'
  | 'checkout_completion_reference'
  | 'decision_receipt_reference'
  | 'source_state_reference'
>

export type CommerceMemoryRecordSummary = {
  recordId: string
  proposalId: string
  policyReviewId: string
  status: CommerceMemoryRecordStatus
  recordKind: CommerceMemoryProposal['recordKind']
  committedAt: string
  scope: {
    integrationId: string
    hasExternalSubjectRef: boolean
    hasExternalTaskRef: boolean
    hasArroUserId: boolean
    hasDecisionReceiptId: boolean
    hasSourceLabel: boolean
  }
  retentionClass: CommerceMemoryProposal['retentionClass']
  promptExposureClass: CommerceMemoryProposal['promptExposureClass']
}

export type CommerceMemoryCommitIssueCode =
  | 'duplicate_commit'
  | 'policy_review_has_issues'
  | 'policy_review_not_approved'
  | 'policy_review_required'
  | 'proposal_not_found'

export type CommerceMemoryCommitIssue = {
  code: CommerceMemoryCommitIssueCode
  message: string
  path?: string
}

export type CommitCommerceMemoryProposalResult =
  | {
      committed: true
      record: CommerceMemoryRecordSummary
    }
  | {
      committed: false
      issues: CommerceMemoryCommitIssue[]
    }

export type CommerceMemoryRecordScopeInput = {
  integrationId: string
  externalSubjectRef: string
  externalTaskRef?: string
  arroUserId?: string
}

export type CommerceMemoryStaleMarkSummary = {
  staleMarkId: string
  recordId: string
  status: Extract<CommerceMemoryRecordStatus, 'stale'>
  referenceRecordKind: StaleMarkableCommerceMemoryRecordKind
  markedStaleAt: string
  refreshReasonCode: string
  scope: {
    integrationId: string
    hasExternalSubjectRef: boolean
    hasExternalTaskRef: boolean
    hasArroUserId: boolean
    hasDecisionReceiptId: boolean
    hasSourceLabel: boolean
  }
}

export type CommerceMemoryStaleMarkIssueCode =
  | 'duplicate_stale_mark'
  | 'external_subject_ref_mismatch'
  | 'external_subject_ref_required'
  | 'external_task_ref_mismatch'
  | 'external_task_ref_required'
  | 'hash_pepper_required'
  | 'integration_mismatch'
  | 'record_already_stale'
  | 'record_kind_not_stale_markable'
  | 'record_not_found'
  | 'refresh_reason_required'
  | 'arro_user_scope_mismatch'
  | 'arro_user_scope_required'

export type CommerceMemoryStaleMarkIssue = {
  code: CommerceMemoryStaleMarkIssueCode
  message: string
  path?: string
}

export type MarkCommerceMemoryRecordStaleResult =
  | {
      markedStale: true
      staleMark: CommerceMemoryStaleMarkSummary
    }
  | {
      markedStale: false
      issues: CommerceMemoryStaleMarkIssue[]
    }

type CommitCandidateRow = {
  proposal_id: string
  record_kind: CommerceMemoryProposal['recordKind']
  integration_id: string
  external_subject_ref_hash: string
  external_task_ref_hash: string | null
  arro_user_id: string | null
  decision_receipt_id: string | null
  source_id: string | null
  source_fact_type: string | null
  provenance_kind: CommerceMemoryProposal['provenance']['kind']
  retention_class: CommerceMemoryProposal['retentionClass']
  prompt_exposure_class: CommerceMemoryProposal['promptExposureClass']
  mutation_reason: string
  expires_at: Date | string | null
  proposal_value: CommerceMemoryProposal['value']
  provenance: CommerceMemoryProposal['provenance']
  consent: CommerceMemoryProposal['consent']
  source_label: CommerceMemoryProposal['scope']['sourceLabel'] | null
  policy_review_id: string | null
  policy_review_decision: 'approved_for_commit' | 'denied' | null
  policy_review_issues: unknown
}

type RecordRow = {
  record_id: string
  proposal_id: string
  policy_review_id: string
  status: CommerceMemoryRecordStatus
  record_kind: CommerceMemoryProposal['recordKind']
  integration_id: string
  external_task_ref_hash: string | null
  arro_user_id: string | null
  decision_receipt_id: string | null
  source_id: string | null
  source_label: CommerceMemoryProposal['scope']['sourceLabel'] | null
  retention_class: CommerceMemoryProposal['retentionClass']
  prompt_exposure_class: CommerceMemoryProposal['promptExposureClass']
  committed_at: Date | string
}

type StaleCandidateRow = {
  record_id: string
  status: CommerceMemoryRecordStatus
  record_kind: CommerceMemoryProposal['recordKind']
  integration_id: string
  external_subject_ref_hash: string
  external_task_ref_hash: string | null
  arro_user_id: string | null
  decision_receipt_id: string | null
  source_id: string | null
  source_fact_type: string | null
  source_label: CommerceMemoryProposal['scope']['sourceLabel'] | null
}

type StaleMarkRow = {
  stale_mark_id: string
  record_id: string
  status: Extract<CommerceMemoryRecordStatus, 'stale'>
  reference_record_kind: StaleMarkableCommerceMemoryRecordKind
  integration_id: string
  external_task_ref_hash: string | null
  arro_user_id: string | null
  decision_receipt_id: string | null
  source_id: string | null
  source_label: CommerceMemoryProposal['scope']['sourceLabel'] | null
  refresh_reason_code: string
  marked_stale_at: Date | string
}

export const staleMarkableCommerceMemoryRecordKinds = [
  'saved_product_reference',
  'comparison_reference',
  'cart_handoff_reference',
  'checkout_completion_reference',
  'decision_receipt_reference',
  'source_state_reference'
] as const

const staleMarkableRecordKindSet = new Set<CommerceMemoryProposal['recordKind']>(
  staleMarkableCommerceMemoryRecordKinds
)

const commitIssue = (
  code: CommerceMemoryCommitIssueCode,
  message: string,
  path?: string
): CommerceMemoryCommitIssue => ({
  code,
  message,
  ...(path ? { path } : {})
})

const staleIssue = (
  code: CommerceMemoryStaleMarkIssueCode,
  message: string,
  path?: string
): CommerceMemoryStaleMarkIssue => ({
  code,
  message,
  ...(path ? { path } : {})
})

const toIso = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp from commerce memory record storage: ${value}`)
  }

  return date.toISOString()
}

const candidatePolicyReviewIssues = (value: unknown) =>
  Array.isArray(value) ? value : []

const rowToSummary = (row: RecordRow): CommerceMemoryRecordSummary => ({
  recordId: row.record_id,
  proposalId: row.proposal_id,
  policyReviewId: row.policy_review_id,
  status: row.status,
  recordKind: row.record_kind,
  committedAt: toIso(row.committed_at),
  scope: {
    integrationId: row.integration_id,
    hasExternalSubjectRef: true,
    hasExternalTaskRef: Boolean(row.external_task_ref_hash),
    hasArroUserId: Boolean(row.arro_user_id),
    hasDecisionReceiptId: Boolean(row.decision_receipt_id),
    hasSourceLabel: Boolean(row.source_id || row.source_label)
  },
  retentionClass: row.retention_class,
  promptExposureClass: row.prompt_exposure_class
})

const rowToStaleMarkSummary = (row: StaleMarkRow): CommerceMemoryStaleMarkSummary => ({
  staleMarkId: row.stale_mark_id,
  recordId: row.record_id,
  status: row.status,
  referenceRecordKind: row.reference_record_kind,
  markedStaleAt: toIso(row.marked_stale_at),
  refreshReasonCode: row.refresh_reason_code,
  scope: {
    integrationId: row.integration_id,
    hasExternalSubjectRef: true,
    hasExternalTaskRef: Boolean(row.external_task_ref_hash),
    hasArroUserId: Boolean(row.arro_user_id),
    hasDecisionReceiptId: Boolean(row.decision_receipt_id),
    hasSourceLabel: Boolean(row.source_id || row.source_label)
  }
})

const readCommitCandidate = async ({
  client,
  proposalId,
  policyReviewId
}: {
  client: Queryable
  proposalId: string
  policyReviewId: string
}) => {
  const result = await client.query<CommitCandidateRow>(
    `
      select
        p.proposal_id,
        p.record_kind,
        p.integration_id,
        p.external_subject_ref_hash,
        p.external_task_ref_hash,
        p.arro_user_id,
        p.decision_receipt_id,
        p.source_id,
        p.source_fact_type,
        p.provenance_kind,
        p.retention_class,
        p.prompt_exposure_class,
        p.mutation_reason,
        p.expires_at,
        p.proposal_value,
        p.provenance,
        p.consent,
        p.source_label,
        r.review_id as policy_review_id,
        r.decision as policy_review_decision,
        r.issues as policy_review_issues
      from commerce_memory_proposals p
      left join commerce_memory_proposal_policy_reviews r
        on r.proposal_id = p.proposal_id
       and r.review_id = $2
      where p.proposal_id = $1
        and p.status = 'pending_policy_review'
      limit 1
    `,
    [proposalId, policyReviewId]
  )

  return result.rows[0]
}

export const commitApprovedCommerceMemoryProposal = async ({
  client,
  proposalId,
  policyReviewId,
  recordId = randomUUID(),
  committedAt = new Date()
}: {
  client: Queryable
  proposalId: string
  policyReviewId: string
  recordId?: string
  committedAt?: Date
}): Promise<CommitCommerceMemoryProposalResult> => {
  const candidate = await readCommitCandidate({
    client,
    proposalId,
    policyReviewId
  })

  if (!candidate) {
    return {
      committed: false,
      issues: [commitIssue(
        'proposal_not_found',
        'Pending commerce memory proposal was not found.',
        '/proposalId'
      )]
    }
  }

  if (!candidate.policy_review_id) {
    return {
      committed: false,
      issues: [commitIssue(
        'policy_review_required',
        'Approved commerce memory policy review is required before commit.',
        '/policyReviewId'
      )]
    }
  }

  if (candidate.policy_review_decision !== 'approved_for_commit') {
    return {
      committed: false,
      issues: [commitIssue(
        'policy_review_not_approved',
        'Commerce memory policy review did not approve this proposal for commit.',
        '/policyReviewId'
      )]
    }
  }

  if (candidatePolicyReviewIssues(candidate.policy_review_issues).length > 0) {
    return {
      committed: false,
      issues: [commitIssue(
        'policy_review_has_issues',
        'Approved commerce memory policy review must not contain unresolved issues.',
        '/policyReviewId'
      )]
    }
  }

  const committedAtIso = committedAt.toISOString()
  const result = await client.query<RecordRow>(
    `
      insert into commerce_memory_records (
        record_id,
        proposal_id,
        policy_review_id,
        policy_review_decision,
        status,
        record_kind,
        integration_id,
        external_subject_ref_hash,
        external_task_ref_hash,
        arro_user_id,
        decision_receipt_id,
        source_id,
        source_fact_type,
        provenance_kind,
        retention_class,
        prompt_exposure_class,
        mutation_reason,
        committed_at,
        expires_at,
        record_value,
        provenance,
        consent,
        source_label,
        created_at,
        updated_at
      ) values (
        $1,
        $2,
        $3,
        'approved_for_commit',
        'active',
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
        $18::jsonb,
        $19::jsonb,
        $20::jsonb,
        $21::jsonb,
        $16,
        $16
      )
      on conflict (proposal_id) do nothing
      returning
        record_id,
        proposal_id,
        policy_review_id,
        status,
        record_kind,
        integration_id,
        external_task_ref_hash,
        arro_user_id,
        decision_receipt_id,
        source_id,
        source_label,
        retention_class,
        prompt_exposure_class,
        committed_at
    `,
    [
      recordId,
      candidate.proposal_id,
      candidate.policy_review_id,
      candidate.record_kind,
      candidate.integration_id,
      candidate.external_subject_ref_hash,
      candidate.external_task_ref_hash,
      candidate.arro_user_id,
      candidate.decision_receipt_id,
      candidate.source_id,
      candidate.source_fact_type,
      candidate.provenance_kind,
      candidate.retention_class,
      candidate.prompt_exposure_class,
      candidate.mutation_reason,
      committedAtIso,
      candidate.expires_at,
      candidate.proposal_value,
      candidate.provenance,
      candidate.consent,
      candidate.source_label ?? null
    ]
  )

  const row = result.rows[0]
  if (!row) {
    return {
      committed: false,
      issues: [commitIssue(
        'duplicate_commit',
        'Commerce memory proposal has already been committed.',
        '/proposalId'
      )]
    }
  }

  return {
    committed: true,
    record: rowToSummary(row)
  }
}

const readStaleCandidate = async ({
  client,
  recordId
}: {
  client: Queryable
  recordId: string
}) => {
  const result = await client.query<StaleCandidateRow>(
    `
      select
        record_id,
        status,
        record_kind,
        integration_id,
        external_subject_ref_hash,
        external_task_ref_hash,
        arro_user_id,
        decision_receipt_id,
        source_id,
        source_fact_type,
        source_label
      from commerce_memory_records
      where record_id = $1
      limit 1
    `,
    [recordId]
  )

  return result.rows[0]
}

const validateStaleCandidate = ({
  candidate,
  scope,
  hashPepper,
  refreshReasonCode
}: {
  candidate: StaleCandidateRow
  scope: CommerceMemoryRecordScopeInput
  hashPepper: string
  refreshReasonCode: string
}) => {
  const issues: CommerceMemoryStaleMarkIssue[] = []

  if (candidate.status !== 'active') {
    issues.push(staleIssue(
      'record_already_stale',
      'Commerce memory record is no longer active.',
      '/recordId'
    ))
  }

  if (!staleMarkableRecordKindSet.has(candidate.record_kind)) {
    issues.push(staleIssue(
      'record_kind_not_stale_markable',
      'Only product, source-state, handoff, completion, and receipt reference records can be marked stale.',
      '/recordId'
    ))
  }

  if (candidate.integration_id !== scope.integrationId) {
    issues.push(staleIssue(
      'integration_mismatch',
      'Memory record scope does not match the integration requesting stale marking.',
      '/scope/integrationId'
    ))
  }

  const subjectHash = hashCommerceMemoryScopeRef(scope.externalSubjectRef, hashPepper)
  if (candidate.external_subject_ref_hash !== subjectHash) {
    issues.push(staleIssue(
      'external_subject_ref_mismatch',
      'Memory record subject scope does not match the stale-mark request.',
      '/scope/externalSubjectRef'
    ))
  }

  if (candidate.external_task_ref_hash && !scope.externalTaskRef) {
    issues.push(staleIssue(
      'external_task_ref_required',
      'Memory record task scope is required before stale marking.',
      '/scope/externalTaskRef'
    ))
  } else if (candidate.external_task_ref_hash && scope.externalTaskRef) {
    const taskHash = hashCommerceMemoryScopeRef(scope.externalTaskRef, hashPepper)
    if (candidate.external_task_ref_hash !== taskHash) {
      issues.push(staleIssue(
        'external_task_ref_mismatch',
        'Memory record task scope does not match the stale-mark request.',
        '/scope/externalTaskRef'
      ))
    }
  }

  if (candidate.arro_user_id && !scope.arroUserId) {
    issues.push(staleIssue(
      'arro_user_scope_required',
      'User-scoped memory record requires the Arro user scope before stale marking.',
      '/scope/arroUserId'
    ))
  } else if (candidate.arro_user_id && scope.arroUserId !== candidate.arro_user_id) {
    issues.push(staleIssue(
      'arro_user_scope_mismatch',
      'Memory record Arro user scope does not match the stale-mark request.',
      '/scope/arroUserId'
    ))
  }

  if (!refreshReasonCode.trim()) {
    issues.push(staleIssue(
      'refresh_reason_required',
      'A bounded refresh reason code is required before marking memory stale.',
      '/refreshReasonCode'
    ))
  }

  return issues
}

export const markCommerceMemoryRecordStale = async ({
  client,
  recordId,
  scope,
  hashPepper,
  refreshReasonCode,
  staleMarkId = randomUUID(),
  markedStaleAt = new Date()
}: {
  client: Queryable
  recordId: string
  scope: CommerceMemoryRecordScopeInput
  hashPepper: string | undefined
  refreshReasonCode: string
  staleMarkId?: string
  markedStaleAt?: Date
}): Promise<MarkCommerceMemoryRecordStaleResult> => {
  if (!hashPepper || hashPepper.length < minCommerceMemoryHashPepperLength) {
    return {
      markedStale: false,
      issues: [staleIssue(
        'hash_pepper_required',
        'A production hash pepper is required before marking commerce memory stale.',
        '/hashPepper'
      )]
    }
  }

  if (!scope.externalSubjectRef.trim()) {
    return {
      markedStale: false,
      issues: [staleIssue(
        'external_subject_ref_required',
        'External subject reference is required before marking commerce memory stale.',
        '/scope/externalSubjectRef'
      )]
    }
  }

  const candidate = await readStaleCandidate({ client, recordId })
  if (!candidate) {
    return {
      markedStale: false,
      issues: [staleIssue(
        'record_not_found',
        'Commerce memory record was not found.',
        '/recordId'
      )]
    }
  }

  const normalizedReasonCode = refreshReasonCode.trim()
  const validationIssues = validateStaleCandidate({
    candidate,
    scope,
    hashPepper,
    refreshReasonCode: normalizedReasonCode
  })
  if (validationIssues.length > 0) {
    return {
      markedStale: false,
      issues: validationIssues
    }
  }

  const markedStaleAtIso = markedStaleAt.toISOString()
  const staleValue = {
    referenceType: candidate.record_kind,
    referenceId: candidate.record_id,
    markedStaleAt: markedStaleAtIso,
    refreshReasonCode: normalizedReasonCode,
    ...(candidate.source_label ? { sourceLabel: candidate.source_label } : {})
  }
  const result = await client.query<StaleMarkRow>(
    `
      with inserted_stale_mark as (
        insert into commerce_memory_record_stale_marks (
          stale_mark_id,
          record_id,
          reference_record_kind,
          integration_id,
          external_subject_ref_hash,
          external_task_ref_hash,
          arro_user_id,
          decision_receipt_id,
          source_id,
          source_fact_type,
          refresh_reason_code,
          marked_stale_at,
          stale_value,
          source_label,
          created_at,
          updated_at
        )
        select
          $1,
          r.record_id,
          r.record_kind,
          r.integration_id,
          r.external_subject_ref_hash,
          r.external_task_ref_hash,
          r.arro_user_id,
          r.decision_receipt_id,
          r.source_id,
          r.source_fact_type,
          $3,
          $4,
          $5::jsonb,
          r.source_label,
          $4,
          $4
        from commerce_memory_records r
        where r.record_id = $2
          and r.status = 'active'
          and r.integration_id = $6
          and r.external_subject_ref_hash = $7
          and r.external_task_ref_hash is not distinct from $8::text
          and r.arro_user_id is not distinct from $9::text
          and r.record_kind = any($10::text[])
        on conflict (record_id) do nothing
        returning
          stale_mark_id,
          record_id,
          reference_record_kind,
          integration_id,
          external_task_ref_hash,
          arro_user_id,
          decision_receipt_id,
          source_id,
          source_label,
          refresh_reason_code,
          marked_stale_at
      ),
      updated_record as (
        update commerce_memory_records r
        set
          status = 'stale',
          updated_at = inserted_stale_mark.marked_stale_at
        from inserted_stale_mark
        where r.record_id = inserted_stale_mark.record_id
          and r.status = 'active'
        returning r.record_id, r.status
      )
      select
        inserted_stale_mark.stale_mark_id,
        inserted_stale_mark.record_id,
        updated_record.status,
        inserted_stale_mark.reference_record_kind,
        inserted_stale_mark.integration_id,
        inserted_stale_mark.external_task_ref_hash,
        inserted_stale_mark.arro_user_id,
        inserted_stale_mark.decision_receipt_id,
        inserted_stale_mark.source_id,
        inserted_stale_mark.source_label,
        inserted_stale_mark.refresh_reason_code,
        inserted_stale_mark.marked_stale_at
      from inserted_stale_mark
      join updated_record on updated_record.record_id = inserted_stale_mark.record_id
    `,
    [
      staleMarkId,
      candidate.record_id,
      normalizedReasonCode,
      markedStaleAtIso,
      staleValue,
      candidate.integration_id,
      candidate.external_subject_ref_hash,
      candidate.external_task_ref_hash,
      candidate.arro_user_id,
      [...staleMarkableCommerceMemoryRecordKinds]
    ]
  )

  const row = result.rows[0]
  if (!row) {
    return {
      markedStale: false,
      issues: [staleIssue(
        'duplicate_stale_mark',
        'Commerce memory record already has a stale mark.',
        '/recordId'
      )]
    }
  }

  return {
    markedStale: true,
    staleMark: rowToStaleMarkSummary(row)
  }
}
