import { randomUUID } from 'node:crypto'
import type { AgentInvocationContext } from '@arro/contracts'
import type {
  CommerceMemoryStoredProposal
} from './memory-proposal-service.ts'
import {
  hashCommerceMemoryScopeRef,
  minCommerceMemoryHashPepperLength
} from './memory-proposal-service.ts'
import { missingAgentHostCapabilities } from './agent-invocation.ts'
import type { Queryable } from './target-business-repository.ts'

export type CommerceMemoryProposalPolicyDecision = 'approved_for_commit' | 'denied'
export type CommerceMemoryProposalPolicyReviewerKind = 'system_policy'

export type CommerceMemoryProposalPolicyIssueCode =
  | 'agent_context_required'
  | 'agent_session_expired'
  | 'agent_session_expiry_required'
  | 'duplicate_review'
  | 'external_subject_ref_mismatch'
  | 'external_subject_ref_required'
  | 'external_task_ref_mismatch'
  | 'external_task_ref_required'
  | 'hash_pepper_required'
  | 'host_capability_required'
  | 'integration_mismatch'
  | 'mutation_reason_required'
  | 'receipt_provenance_required'
  | 'receipt_scope_mismatch'
  | 'receipt_scope_required'
  | 'source_label_mismatch'
  | 'source_provenance_required'
  | 'typed_migration_internal_only'
  | 'typed_migration_provenance_required'
  | 'typed_migration_user_authorization_required'
  | 'user_authorization_required'
  | 'write_scope_required'

export type CommerceMemoryProposalPolicyIssue = {
  code: CommerceMemoryProposalPolicyIssueCode
  message: string
  path?: string
}

export type CommerceMemoryProposalPolicyReview = {
  proposalId: string
  reviewerKind: CommerceMemoryProposalPolicyReviewerKind
  decision: CommerceMemoryProposalPolicyDecision
  reviewedAt: string
  issues: CommerceMemoryProposalPolicyIssue[]
}

export type StoreCommerceMemoryProposalPolicyReviewResult =
  | {
      stored: true
      reviewId: string
      review: CommerceMemoryProposalPolicyReview
    }
  | {
      stored: false
      review: CommerceMemoryProposalPolicyReview
      issues: CommerceMemoryProposalPolicyIssue[]
    }

type SourceLabelRef = {
  sourceId: string
  factType: string
}

type JsonObject = Record<string, unknown>

const sourceScopedRecordKinds = new Set([
  'accepted_alternative',
  'rejected_alternative',
  'saved_product_reference',
  'comparison_reference',
  'cart_handoff_reference',
  'checkout_completion_reference',
  'source_state_reference',
  'no_buy_warning',
  'stale_reference'
])

const receiptScopedRecordKinds = new Set([
  'checkout_completion_reference',
  'decision_receipt_reference',
  'no_buy_warning'
])

const isJsonObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isSourceLabelRef = (value: unknown): value is SourceLabelRef =>
  isJsonObject(value) &&
  typeof value.sourceId === 'string' &&
  typeof value.factType === 'string'

const maybeString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const sourceLabelsInValue = (value: unknown): SourceLabelRef[] => {
  if (Array.isArray(value)) return value.flatMap(sourceLabelsInValue)
  if (!isJsonObject(value)) return []

  const direct = isSourceLabelRef(value.sourceLabel) ? [value.sourceLabel] : []
  const nested = Object.entries(value)
    .filter(([key]) => key !== 'sourceLabel')
    .flatMap(([, nestedValue]) => sourceLabelsInValue(nestedValue))

  return [...direct, ...nested]
}

const receiptIdsInValue = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.flatMap(receiptIdsInValue)
  if (!isJsonObject(value)) return []

  const direct = maybeString(value.decisionReceiptId)
    ? [maybeString(value.decisionReceiptId)!]
    : []
  const nested = Object.entries(value)
    .filter(([key]) => key !== 'decisionReceiptId')
    .flatMap(([, nestedValue]) => receiptIdsInValue(nestedValue))

  return [...direct, ...nested]
}

const unique = (values: string[]) => [...new Set(values)]

const issue = (
  code: CommerceMemoryProposalPolicyIssueCode,
  message: string,
  path?: string
): CommerceMemoryProposalPolicyIssue => ({
  code,
  message,
  ...(path ? { path } : {})
})

const hashRef = (value: string | undefined, hashPepper: string | undefined) =>
  value && hashPepper && hashPepper.length >= minCommerceMemoryHashPepperLength
    ? hashCommerceMemoryScopeRef(value, hashPepper)
    : undefined

const reviewAgentContext = ({
  storedProposal,
  agentContext,
  hashPepper,
  now
}: {
  storedProposal: CommerceMemoryStoredProposal
  agentContext: AgentInvocationContext | undefined
  hashPepper: string | undefined
  now: Date
}) => {
  const issues: CommerceMemoryProposalPolicyIssue[] = []

  if (!hashPepper || hashPepper.length < minCommerceMemoryHashPepperLength) {
    issues.push(issue(
      'hash_pepper_required',
      'A production hash pepper is required to policy-review commerce memory proposals.',
      '/hashPepper'
    ))
  }

  if (!agentContext) {
    issues.push(issue(
      'agent_context_required',
      'Memory proposal policy review requires an agent invocation context.',
      '/agentContext'
    ))
    return issues
  }

  if (agentContext.requestedActionScope !== 'write:memory') {
    issues.push(issue(
      'write_scope_required',
      'Memory proposal policy review requires write:memory action scope.',
      '/agentContext/requestedActionScope'
    ))
  }

  const missingHostCapabilities = missingAgentHostCapabilities({
    agentContext,
    expectedScope: 'write:memory'
  })
  if (missingHostCapabilities.length > 0) {
    issues.push(issue(
      'host_capability_required',
      `Memory proposal policy review requires host trust-signal capabilities: ${missingHostCapabilities.join(', ')}.`,
      '/agentContext/hostCapabilities'
    ))
  }

  if (!agentContext.sessionExpiresAt) {
    issues.push(issue(
      'agent_session_expiry_required',
      'Memory proposal policy review requires a bounded agent session expiry.',
      '/agentContext/sessionExpiresAt'
    ))
  } else {
    const expiresAtMs = new Date(agentContext.sessionExpiresAt).getTime()
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
      issues.push(issue(
        'agent_session_expired',
        'Memory proposal policy review requires an active agent session.',
        '/agentContext/sessionExpiresAt'
      ))
    }
  }

  if (agentContext.integrationId !== storedProposal.proposal.scope.integrationId) {
    issues.push(issue(
      'integration_mismatch',
      'Agent integration does not match the stored memory proposal scope.',
      '/agentContext/integrationId'
    ))
  }

  if (!agentContext.externalSubjectRef) {
    issues.push(issue(
      'external_subject_ref_required',
      'Memory proposal policy review requires an external subject reference.',
      '/agentContext/externalSubjectRef'
    ))
  } else {
    const subjectHash = hashRef(agentContext.externalSubjectRef, hashPepper)
    if (
      subjectHash &&
      subjectHash !== storedProposal.proposal.scope.externalSubjectRefHash
    ) {
      issues.push(issue(
        'external_subject_ref_mismatch',
        'Agent subject reference does not match the stored memory proposal scope.',
        '/agentContext/externalSubjectRef'
      ))
    }
  }

  const storedTaskHash = storedProposal.proposal.scope.externalTaskRefHash
  if (storedTaskHash && !agentContext.externalTaskRef) {
    issues.push(issue(
      'external_task_ref_required',
      'Memory proposal policy review requires the scoped external task reference.',
      '/agentContext/externalTaskRef'
    ))
  } else if (storedTaskHash && agentContext.externalTaskRef) {
    const taskHash = hashRef(agentContext.externalTaskRef, hashPepper)
    if (taskHash && taskHash !== storedTaskHash) {
      issues.push(issue(
        'external_task_ref_mismatch',
        'Agent task reference does not match the stored memory proposal scope.',
        '/agentContext/externalTaskRef'
      ))
    }
  }

  return issues
}

const reviewSourceProvenance = (
  storedProposal: CommerceMemoryStoredProposal
) => {
  const proposal = storedProposal.proposal
  if (!sourceScopedRecordKinds.has(proposal.recordKind)) return []

  const issues: CommerceMemoryProposalPolicyIssue[] = []
  const valueSourceLabels = sourceLabelsInValue(proposal.value)
  const scopeSourceLabel = proposal.scope.sourceLabel

  if (valueSourceLabels.length === 0) {
    issues.push(issue(
      'source_provenance_required',
      'Source-scoped commerce memory proposals require source-labeled value evidence.',
      '/value'
    ))
  }

  if (proposal.recordKind !== 'comparison_reference' && !scopeSourceLabel) {
    issues.push(issue(
      'source_provenance_required',
      'Source-scoped commerce memory proposals require a scoped source label.',
      '/scope/sourceLabel'
    ))
  }

  if (!proposal.provenance.evidenceRef || !proposal.provenance.sourceRecordRef) {
    issues.push(issue(
      'source_provenance_required',
      'Source-scoped commerce memory proposals require evidenceRef and sourceRecordRef provenance.',
      '/provenance'
    ))
  }

  if (scopeSourceLabel && valueSourceLabels.length > 0) {
    const matchingValueLabel = valueSourceLabels.some((valueSourceLabel) =>
      valueSourceLabel.sourceId === scopeSourceLabel.sourceId &&
      valueSourceLabel.factType === scopeSourceLabel.factType
    )

    if (!matchingValueLabel) {
      issues.push(issue(
        'source_label_mismatch',
        'Memory proposal value source labels do not match the scoped source label.',
        '/scope/sourceLabel'
      ))
    }
  }

  return issues
}

const reviewReceiptProvenance = (
  storedProposal: CommerceMemoryStoredProposal
) => {
  const proposal = storedProposal.proposal
  const valueReceiptIds = unique(receiptIdsInValue(proposal.value))
  const scopeReceiptId = proposal.scope.decisionReceiptId
  const requiresReceipt = (
    proposal.retentionClass === 'receipt_bound' ||
    receiptScopedRecordKinds.has(proposal.recordKind) ||
    valueReceiptIds.length > 0
  )

  if (!requiresReceipt) return []

  const issues: CommerceMemoryProposalPolicyIssue[] = []

  if (!scopeReceiptId) {
    issues.push(issue(
      'receipt_scope_required',
      'Receipt-scoped commerce memory proposals require a scoped DecisionReceipt reference.',
      '/scope/decisionReceiptId'
    ))
  }

  if (valueReceiptIds.length === 0) {
    issues.push(issue(
      'receipt_provenance_required',
      'Receipt-scoped commerce memory proposals require receipt evidence in the typed value.',
      '/value'
    ))
  }

  if (!proposal.provenance.evidenceRef) {
    issues.push(issue(
      'receipt_provenance_required',
      'Receipt-scoped commerce memory proposals require evidenceRef provenance.',
      '/provenance/evidenceRef'
    ))
  }

  if (
    scopeReceiptId &&
    valueReceiptIds.length > 0 &&
    !valueReceiptIds.includes(scopeReceiptId)
  ) {
    issues.push(issue(
      'receipt_scope_mismatch',
      'Typed value receipt references do not match the scoped DecisionReceipt reference.',
      '/scope/decisionReceiptId'
    ))
  }

  return issues
}

const reviewTypedMigration = ({
  storedProposal,
  agentContext
}: {
  storedProposal: CommerceMemoryStoredProposal
  agentContext: AgentInvocationContext | undefined
}) => {
  const proposal = storedProposal.proposal
  if (proposal.provenance.kind !== 'typed_migration') return []

  const issues: CommerceMemoryProposalPolicyIssue[] = []

  if (agentContext?.surface !== 'internal') {
    issues.push(issue(
      'typed_migration_internal_only',
      'Typed memory migrations require an internal Arro migration surface in V1.',
      '/agentContext/surface'
    ))
  }

  if (
    !proposal.consent.userAuthorized ||
    proposal.consent.basis !== 'typed_migration_authorization'
  ) {
    issues.push(issue(
      'typed_migration_user_authorization_required',
      'Typed memory migrations require explicit typed migration authorization.',
      '/consent'
    ))
  }

  if (!proposal.provenance.adapterId || !proposal.provenance.sourceRecordRef) {
    issues.push(issue(
      'typed_migration_provenance_required',
      'Typed memory migrations require adapterId and sourceRecordRef provenance.',
      '/provenance'
    ))
  }

  return issues
}

const reviewProposalFields = (
  storedProposal: CommerceMemoryStoredProposal
) => {
  const proposal = storedProposal.proposal
  const issues: CommerceMemoryProposalPolicyIssue[] = []

  if (!proposal.consent.userAuthorized) {
    issues.push(issue(
      'user_authorization_required',
      'Commerce memory proposals require explicit user authorization before commit.',
      '/consent/userAuthorized'
    ))
  }

  if (!proposal.mutationReason.trim()) {
    issues.push(issue(
      'mutation_reason_required',
      'Commerce memory proposals require a bounded mutation reason before commit.',
      '/mutationReason'
    ))
  }

  return issues
}

export const reviewCommerceMemoryProposalPolicy = ({
  storedProposal,
  agentContext,
  hashPepper,
  now = new Date()
}: {
  storedProposal: CommerceMemoryStoredProposal
  agentContext?: AgentInvocationContext | undefined
  hashPepper?: string | undefined
  now?: Date
}): CommerceMemoryProposalPolicyReview => {
  const issues = [
    ...reviewAgentContext({ storedProposal, agentContext, hashPepper, now }),
    ...reviewProposalFields(storedProposal),
    ...reviewSourceProvenance(storedProposal),
    ...reviewReceiptProvenance(storedProposal),
    ...reviewTypedMigration({ storedProposal, agentContext })
  ]

  return {
    proposalId: storedProposal.proposalId,
    reviewerKind: 'system_policy',
    decision: issues.length === 0 ? 'approved_for_commit' : 'denied',
    reviewedAt: now.toISOString(),
    issues
  }
}

export const storeCommerceMemoryProposalPolicyReview = async ({
  client,
  storedProposal,
  agentContext,
  hashPepper,
  reviewId = randomUUID(),
  now = new Date()
}: {
  client: Queryable
  storedProposal: CommerceMemoryStoredProposal
  agentContext?: AgentInvocationContext | undefined
  hashPepper?: string | undefined
  reviewId?: string
  now?: Date
}): Promise<StoreCommerceMemoryProposalPolicyReviewResult> => {
  const review = reviewCommerceMemoryProposalPolicy({
    storedProposal,
    agentContext,
    hashPepper,
    now
  })
  const result = await client.query<{ review_id: string }>(
    `
      insert into commerce_memory_proposal_policy_reviews (
        review_id,
        proposal_id,
        reviewer_kind,
        decision,
        issues,
        agent_integration_id,
        agent_surface,
        requested_action_scope,
        external_subject_ref_hash,
        external_task_ref_hash,
        reviewed_at,
        created_at
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5::jsonb,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $11
      )
      on conflict (review_id) do nothing
      returning review_id
    `,
    [
      reviewId,
      review.proposalId,
      review.reviewerKind,
      review.decision,
      JSON.stringify(review.issues),
      agentContext?.integrationId ?? null,
      agentContext?.surface ?? null,
      agentContext?.requestedActionScope ?? null,
      hashRef(agentContext?.externalSubjectRef, hashPepper) ?? null,
      hashRef(agentContext?.externalTaskRef, hashPepper) ?? null,
      review.reviewedAt
    ]
  )

  if ((result.rowCount ?? 0) === 0) {
    return {
      stored: false,
      review,
      issues: [issue(
        'duplicate_review',
        'Commerce memory proposal policy review already exists.',
        '/reviewId'
      )]
    }
  }

  return {
    stored: true,
    reviewId,
    review
  }
}
