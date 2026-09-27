import { randomUUID } from 'node:crypto'
import type {
  AgentInvocationContext,
  CommerceMemoryProposal,
  CommerceMemoryProposalValidationIssue,
  CommerceMemoryProposalValidationResult
} from '@arro/contracts'
import {
  type CommerceMemoryProposalPolicyIssue,
  storeCommerceMemoryProposalPolicyReview
} from './memory-proposal-policy.ts'
import {
  hashCommerceMemoryScopeRef,
  minCommerceMemoryHashPepperLength,
  readPendingCommerceMemoryProposal,
  storeValidatedCommerceMemoryProposal,
  type CommerceMemoryProposalStoreIssue
} from './memory-proposal-service.ts'
import {
  commitApprovedCommerceMemoryProposal,
  markCommerceMemoryRecordStale,
  staleMarkableCommerceMemoryRecordKinds,
  type CommerceMemoryCommitIssue,
  type CommerceMemoryRecordSummary,
  type CommerceMemoryStaleMarkIssue,
  type CommerceMemoryStaleMarkSummary,
  type StaleMarkableCommerceMemoryRecordKind
} from './memory-record-service.ts'
import type { Queryable } from './target-business-repository.ts'

type RefreshCandidateRow = {
  record_id: string
  status: 'active' | 'stale'
  record_kind: CommerceMemoryProposal['recordKind']
  integration_id: string
  external_subject_ref_hash: string
  external_task_ref_hash: string | null
  arro_user_id: string | null
  decision_receipt_id: string | null
  source_id: string | null
  source_fact_type: string | null
}

type RefreshRow = {
  refresh_id: string
  superseded_record_id: string
  replacement_record_id: string
  stale_mark_id: string
  replacement_proposal_id: string
  replacement_policy_review_id: string
  reference_record_kind: StaleMarkableCommerceMemoryRecordKind
  integration_id: string
  external_task_ref_hash: string | null
  arro_user_id: string | null
  decision_receipt_id: string | null
  source_id: string | null
  refresh_reason_code: string
  refreshed_at: Date | string
}

export type CommerceMemoryRefreshSummary = {
  refreshId: string
  supersededRecordId: string
  replacementRecordId: string
  staleMarkId: string
  replacementProposalId: string
  replacementPolicyReviewId: string
  referenceRecordKind: StaleMarkableCommerceMemoryRecordKind
  refreshedAt: string
  refreshReasonCode: string
  scope: {
    integrationId: string
    hasExternalSubjectRef: boolean
    hasExternalTaskRef: boolean
    hasArroUserId: boolean
    hasDecisionReceiptId: boolean
    hasSourceLabel: boolean
  }
  replacementRecord: CommerceMemoryRecordSummary
  staleMark: CommerceMemoryStaleMarkSummary
}

export type CommerceMemoryRefreshIssueCode =
  | 'decision_receipt_scope_mismatch'
  | 'external_subject_ref_mismatch'
  | 'external_task_ref_mismatch'
  | 'external_task_ref_required'
  | 'hash_pepper_required'
  | 'integration_mismatch'
  | 'record_already_stale'
  | 'record_kind_not_refreshable'
  | 'record_not_found'
  | 'refresh_already_recorded'
  | 'refresh_reason_required'
  | 'replacement_commit_failed'
  | 'replacement_policy_review_denied'
  | 'replacement_policy_review_not_stored'
  | 'replacement_proposal_not_readable'
  | 'replacement_proposal_rejected'
  | 'replacement_proposal_store_failed'
  | 'replacement_record_kind_mismatch'
  | 'source_scope_mismatch'
  | 'superseded_stale_mark_failed'
  | 'arro_user_scope_mismatch'
  | 'arro_user_scope_required'

export type CommerceMemoryRefreshIssue = {
  code: CommerceMemoryRefreshIssueCode
  message: string
  path?: string
  details?: string[]
}

export type RefreshCommerceMemoryRecordResult =
  | {
      refreshed: true
      refresh: CommerceMemoryRefreshSummary
    }
  | {
      refreshed: false
      issues: CommerceMemoryRefreshIssue[]
    }

const refreshableRecordKindSet = new Set<CommerceMemoryProposal['recordKind']>(
  staleMarkableCommerceMemoryRecordKinds
)

const issue = (
  code: CommerceMemoryRefreshIssueCode,
  message: string,
  path?: string,
  details?: string[]
): CommerceMemoryRefreshIssue => ({
  code,
  message,
  ...(path ? { path } : {}),
  ...(details && details.length > 0 ? { details } : {})
})

const toIso = (value: Date | string) => {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp from commerce memory refresh storage: ${value}`)
  }

  return date.toISOString()
}

const issueDetails = (
  issues: Array<
    | CommerceMemoryProposalValidationIssue
    | CommerceMemoryProposalStoreIssue
    | CommerceMemoryProposalPolicyIssue
    | CommerceMemoryCommitIssue
    | CommerceMemoryStaleMarkIssue
  >
) => issues.map((nestedIssue) =>
  nestedIssue.path
    ? `${nestedIssue.code}:${nestedIssue.path}`
    : nestedIssue.code
)

const rowToRefreshSummary = ({
  row,
  replacementRecord,
  staleMark
}: {
  row: RefreshRow
  replacementRecord: CommerceMemoryRecordSummary
  staleMark: CommerceMemoryStaleMarkSummary
}): CommerceMemoryRefreshSummary => ({
  refreshId: row.refresh_id,
  supersededRecordId: row.superseded_record_id,
  replacementRecordId: row.replacement_record_id,
  staleMarkId: row.stale_mark_id,
  replacementProposalId: row.replacement_proposal_id,
  replacementPolicyReviewId: row.replacement_policy_review_id,
  referenceRecordKind: row.reference_record_kind,
  refreshedAt: toIso(row.refreshed_at),
  refreshReasonCode: row.refresh_reason_code,
  scope: {
    integrationId: row.integration_id,
    hasExternalSubjectRef: true,
    hasExternalTaskRef: Boolean(row.external_task_ref_hash),
    hasArroUserId: Boolean(row.arro_user_id),
    hasDecisionReceiptId: Boolean(row.decision_receipt_id),
    hasSourceLabel: Boolean(row.source_id)
  },
  replacementRecord,
  staleMark
})

const readRefreshCandidate = async ({
  transactionClient,
  supersededRecordId
}: {
  transactionClient: Queryable
  supersededRecordId: string
}) => {
  const result = await transactionClient.query<RefreshCandidateRow>(
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
        source_fact_type
      from commerce_memory_records
      where record_id = $1
      for update
    `,
    [supersededRecordId]
  )

  return result.rows[0]
}

const validateReplacementCandidate = ({
  candidate,
  replacementProposal,
  hashPepper,
  refreshReasonCode
}: {
  candidate: RefreshCandidateRow
  replacementProposal: CommerceMemoryProposal
  hashPepper: string
  refreshReasonCode: string
}) => {
  const issues: CommerceMemoryRefreshIssue[] = []

  if (candidate.status !== 'active') {
    issues.push(issue(
      'record_already_stale',
      'Only active commerce memory records can be refreshed.',
      '/supersededRecordId'
    ))
  }

  if (!refreshableRecordKindSet.has(candidate.record_kind)) {
    issues.push(issue(
      'record_kind_not_refreshable',
      'Only product, source-state, handoff, completion, and receipt reference records can be refreshed.',
      '/supersededRecordId'
    ))
  }

  if (replacementProposal.recordKind !== candidate.record_kind) {
    issues.push(issue(
      'replacement_record_kind_mismatch',
      'Replacement memory proposal must use the same reference record kind as the superseded record.',
      '/replacementProposal/recordKind'
    ))
  }

  if (!refreshReasonCode.trim()) {
    issues.push(issue(
      'refresh_reason_required',
      'A bounded refresh reason code is required before replacing commerce memory.',
      '/refreshReasonCode'
    ))
  }

  if (replacementProposal.scope.integrationId !== candidate.integration_id) {
    issues.push(issue(
      'integration_mismatch',
      'Replacement memory proposal integration does not match the superseded record scope.',
      '/replacementProposal/scope/integrationId'
    ))
  }

  const replacementSubjectHash = hashCommerceMemoryScopeRef(
    replacementProposal.scope.externalSubjectRef,
    hashPepper
  )
  if (replacementSubjectHash !== candidate.external_subject_ref_hash) {
    issues.push(issue(
      'external_subject_ref_mismatch',
      'Replacement memory proposal subject scope does not match the superseded record.',
      '/replacementProposal/scope/externalSubjectRef'
    ))
  }

  const replacementTaskHash = replacementProposal.scope.externalTaskRef
    ? hashCommerceMemoryScopeRef(replacementProposal.scope.externalTaskRef, hashPepper)
    : null
  if (candidate.external_task_ref_hash && !replacementTaskHash) {
    issues.push(issue(
      'external_task_ref_required',
      'Replacement memory proposal must preserve the superseded task scope.',
      '/replacementProposal/scope/externalTaskRef'
    ))
  } else if (replacementTaskHash !== candidate.external_task_ref_hash) {
    issues.push(issue(
      'external_task_ref_mismatch',
      'Replacement memory proposal task scope does not match the superseded record.',
      '/replacementProposal/scope/externalTaskRef'
    ))
  }

  if (candidate.arro_user_id && !replacementProposal.scope.arroUserId) {
    issues.push(issue(
      'arro_user_scope_required',
      'Replacement memory proposal must preserve the superseded Arro user scope.',
      '/replacementProposal/scope/arroUserId'
    ))
  } else if ((replacementProposal.scope.arroUserId ?? null) !== candidate.arro_user_id) {
    issues.push(issue(
      'arro_user_scope_mismatch',
      'Replacement memory proposal Arro user scope does not match the superseded record.',
      '/replacementProposal/scope/arroUserId'
    ))
  }

  if ((replacementProposal.scope.decisionReceiptId ?? null) !== candidate.decision_receipt_id) {
    issues.push(issue(
      'decision_receipt_scope_mismatch',
      'Replacement memory proposal DecisionReceipt scope does not match the superseded record.',
      '/replacementProposal/scope/decisionReceiptId'
    ))
  }

  const replacementSource = replacementProposal.scope.sourceLabel
  if (
    candidate.source_id &&
    (
      !replacementSource ||
      replacementSource.sourceId !== candidate.source_id ||
      replacementSource.factType !== candidate.source_fact_type
    )
  ) {
    issues.push(issue(
      'source_scope_mismatch',
      'Replacement memory proposal source label does not match the superseded source scope.',
      '/replacementProposal/scope/sourceLabel'
    ))
  }

  return issues
}

const insertRefreshLedger = async ({
  transactionClient,
  refreshId,
  supersededRecordId,
  replacementRecordId,
  staleMarkId,
  refreshReasonCode,
  refreshedAt
}: {
  transactionClient: Queryable
  refreshId: string
  supersededRecordId: string
  replacementRecordId: string
  staleMarkId: string
  refreshReasonCode: string
  refreshedAt: Date
}) => {
  const refreshedAtIso = refreshedAt.toISOString()
  const result = await transactionClient.query<RefreshRow>(
    `
      insert into commerce_memory_record_refreshes (
        refresh_id,
        superseded_record_id,
        replacement_record_id,
        stale_mark_id,
        replacement_proposal_id,
        replacement_policy_review_id,
        reference_record_kind,
        integration_id,
        external_subject_ref_hash,
        external_task_ref_hash,
        arro_user_id,
        decision_receipt_id,
        source_id,
        source_fact_type,
        refresh_reason_code,
        refreshed_at,
        created_at
      )
      select
        $1,
        superseded.record_id,
        replacement.record_id,
        stale_mark.stale_mark_id,
        replacement.proposal_id,
        replacement.policy_review_id,
        superseded.record_kind,
        superseded.integration_id,
        superseded.external_subject_ref_hash,
        superseded.external_task_ref_hash,
        superseded.arro_user_id,
        superseded.decision_receipt_id,
        superseded.source_id,
        superseded.source_fact_type,
        $5,
        $6,
        $6
      from commerce_memory_records superseded
      join commerce_memory_records replacement
        on replacement.record_id = $3
       and replacement.status = 'active'
       and replacement.record_kind = superseded.record_kind
       and replacement.integration_id = superseded.integration_id
       and replacement.external_subject_ref_hash = superseded.external_subject_ref_hash
       and replacement.external_task_ref_hash is not distinct from superseded.external_task_ref_hash
       and replacement.arro_user_id is not distinct from superseded.arro_user_id
      join commerce_memory_record_stale_marks stale_mark
        on stale_mark.stale_mark_id = $4
       and stale_mark.record_id = superseded.record_id
      where superseded.record_id = $2
        and superseded.status = 'stale'
      on conflict (superseded_record_id) do nothing
      returning
        refresh_id,
        superseded_record_id,
        replacement_record_id,
        stale_mark_id,
        replacement_proposal_id,
        replacement_policy_review_id,
        reference_record_kind,
        integration_id,
        external_task_ref_hash,
        arro_user_id,
        decision_receipt_id,
        source_id,
        refresh_reason_code,
        refreshed_at
    `,
    [
      refreshId,
      supersededRecordId,
      replacementRecordId,
      staleMarkId,
      refreshReasonCode,
      refreshedAtIso
    ]
  )

  return result.rows[0]
}

export const refreshCommerceMemoryRecordWithReplacement = async ({
  transactionClient,
  supersededRecordId,
  replacementValidationResult,
  agentContext,
  hashPepper,
  refreshReasonCode,
  refreshId = randomUUID(),
  replacementPolicyReviewId = randomUUID(),
  replacementRecordId = randomUUID(),
  staleMarkId = randomUUID(),
  queuedAt = new Date(),
  reviewedAt = queuedAt,
  committedAt = reviewedAt,
  markedStaleAt = committedAt,
  refreshedAt = markedStaleAt
}: {
  transactionClient: Queryable
  supersededRecordId: string
  replacementValidationResult: CommerceMemoryProposalValidationResult
  agentContext: AgentInvocationContext
  hashPepper: string | undefined
  refreshReasonCode: string
  refreshId?: string
  replacementPolicyReviewId?: string
  replacementRecordId?: string
  staleMarkId?: string
  queuedAt?: Date
  reviewedAt?: Date
  committedAt?: Date
  markedStaleAt?: Date
  refreshedAt?: Date
}): Promise<RefreshCommerceMemoryRecordResult> => {
  if (!replacementValidationResult.accepted) {
    return {
      refreshed: false,
      issues: [issue(
        'replacement_proposal_rejected',
        'Replacement commerce memory proposal failed contract validation.',
        '/replacementProposal',
        issueDetails(replacementValidationResult.issues)
      )]
    }
  }

  if (!hashPepper || hashPepper.length < minCommerceMemoryHashPepperLength) {
    return {
      refreshed: false,
      issues: [issue(
        'hash_pepper_required',
        'A production hash pepper is required before replacing commerce memory.',
        '/hashPepper'
      )]
    }
  }

  const replacementProposal = replacementValidationResult.proposal

  await transactionClient.query('begin')

  const rollbackAndReturn = async (
    result: RefreshCommerceMemoryRecordResult
  ): Promise<RefreshCommerceMemoryRecordResult> => {
    await transactionClient.query('rollback')
    return result
  }

  try {
    const candidate = await readRefreshCandidate({
      transactionClient,
      supersededRecordId
    })
    if (!candidate) {
      return await rollbackAndReturn({
        refreshed: false,
        issues: [issue(
          'record_not_found',
          'Superseded commerce memory record was not found.',
          '/supersededRecordId'
        )]
      })
    }

    const candidateIssues = validateReplacementCandidate({
      candidate,
      replacementProposal,
      hashPepper,
      refreshReasonCode
    })
    if (candidateIssues.length > 0) {
      return await rollbackAndReturn({
        refreshed: false,
        issues: candidateIssues
      })
    }

    const storeResult = await storeValidatedCommerceMemoryProposal({
      client: transactionClient,
      validationResult: replacementValidationResult,
      hashPepper,
      queuedAt
    })
    if (!storeResult.stored) {
      return await rollbackAndReturn({
        refreshed: false,
        issues: [issue(
          'replacement_proposal_store_failed',
          'Replacement commerce memory proposal was not stored.',
          '/replacementProposal',
          issueDetails(storeResult.issues)
        )]
      })
    }

    const storedReplacementProposal = await readPendingCommerceMemoryProposal(
      transactionClient,
      replacementProposal.proposalId
    )
    if (!storedReplacementProposal) {
      return await rollbackAndReturn({
        refreshed: false,
        issues: [issue(
          'replacement_proposal_not_readable',
          'Stored replacement commerce memory proposal could not be read.',
          '/replacementProposal/proposalId'
        )]
      })
    }

    const policyReviewResult = await storeCommerceMemoryProposalPolicyReview({
      client: transactionClient,
      storedProposal: storedReplacementProposal,
      agentContext,
      hashPepper,
      reviewId: replacementPolicyReviewId,
      now: reviewedAt
    })
    if (!policyReviewResult.stored) {
      return await rollbackAndReturn({
        refreshed: false,
        issues: [issue(
          'replacement_policy_review_not_stored',
          'Replacement commerce memory policy review was not stored.',
          '/replacementPolicyReviewId',
          issueDetails(policyReviewResult.issues)
        )]
      })
    }
    if (policyReviewResult.review.decision !== 'approved_for_commit') {
      return await rollbackAndReturn({
        refreshed: false,
        issues: [issue(
          'replacement_policy_review_denied',
          'Replacement commerce memory proposal was not approved for commit.',
          '/replacementProposal',
          issueDetails(policyReviewResult.review.issues)
        )]
      })
    }

    const commitResult = await commitApprovedCommerceMemoryProposal({
      client: transactionClient,
      proposalId: replacementProposal.proposalId,
      policyReviewId: replacementPolicyReviewId,
      recordId: replacementRecordId,
      committedAt
    })
    if (!commitResult.committed) {
      return await rollbackAndReturn({
        refreshed: false,
        issues: [issue(
          'replacement_commit_failed',
          'Approved replacement commerce memory proposal was not committed.',
          '/replacementRecordId',
          issueDetails(commitResult.issues)
        )]
      })
    }

    const staleMarkResult = await markCommerceMemoryRecordStale({
      client: transactionClient,
      recordId: supersededRecordId,
      scope: {
        integrationId: replacementProposal.scope.integrationId,
        externalSubjectRef: replacementProposal.scope.externalSubjectRef,
        ...(replacementProposal.scope.externalTaskRef
          ? { externalTaskRef: replacementProposal.scope.externalTaskRef }
          : {}),
        ...(replacementProposal.scope.arroUserId
          ? { arroUserId: replacementProposal.scope.arroUserId }
          : {})
      },
      hashPepper,
      refreshReasonCode,
      staleMarkId,
      markedStaleAt
    })
    if (!staleMarkResult.markedStale) {
      return await rollbackAndReturn({
        refreshed: false,
        issues: [issue(
          'superseded_stale_mark_failed',
          'Superseded commerce memory record was not marked stale after replacement commit.',
          '/supersededRecordId',
          issueDetails(staleMarkResult.issues)
        )]
      })
    }

    const refreshRow = await insertRefreshLedger({
      transactionClient,
      refreshId,
      supersededRecordId,
      replacementRecordId,
      staleMarkId,
      refreshReasonCode,
      refreshedAt
    })
    if (!refreshRow) {
      return await rollbackAndReturn({
        refreshed: false,
        issues: [issue(
          'refresh_already_recorded',
          'Commerce memory refresh lineage was already recorded for this superseded record.',
          '/supersededRecordId'
        )]
      })
    }

    await transactionClient.query('commit')

    return {
      refreshed: true,
      refresh: rowToRefreshSummary({
        row: refreshRow,
        replacementRecord: commitResult.record,
        staleMark: staleMarkResult.staleMark
      })
    }
  } catch (error) {
    await transactionClient.query('rollback').catch(() => undefined)
    throw error
  }
}
