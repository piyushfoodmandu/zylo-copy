import type { QueryResult, QueryResultRow } from 'pg'
import { validateCommerceMemoryProposal } from '@arro/contracts'
import { describe, expect, it, vi } from 'vitest'
import { hashCommerceMemoryScopeRef } from './memory-proposal-service.ts'
import { refreshCommerceMemoryRecordWithReplacement } from './memory-refresh-service.ts'
import type { Queryable } from './target-business-repository.ts'

const timestamp = '2026-06-01T00:00:00.000Z'
const hashPepper = 'memory-refresh-test-pepper-32-chars'
const externalSubjectRef = 'opaque-user-ref-1'
const externalTaskRef = 'opaque-task-ref-1'
const externalSubjectRefHash = hashCommerceMemoryScopeRef(externalSubjectRef, hashPepper)
const externalTaskRefHash = hashCommerceMemoryScopeRef(externalTaskRef, hashPepper)

const sourceLabel = {
  sourceId: 'approved-source-1',
  sourceName: 'Approved Source',
  factType: 'connected_catalog_product',
  fetchedAt: timestamp,
  expiresAt: '2026-06-01T00:15:00.000Z',
  freshnessClass: 'advisory_catalog',
  bindingStatus: 'advisory'
} as const

const replacementProposal = {
  proposalId: 'replacement-proposal-1',
  recordKind: 'source_state_reference',
  scope: {
    integrationId: 'chatgpt-demo',
    externalSubjectRef,
    externalTaskRef,
    decisionReceiptId: 'decision-receipt-1',
    sourceLabel
  },
  provenance: {
    kind: 'source_refresh',
    evidenceRef: 'refresh-evidence-1',
    adapterId: 'approved-source-1',
    sourceRecordRef: 'approved-source-1'
  },
  consent: {
    userAuthorized: true,
    basis: 'explicit_user_request',
    grantedAt: timestamp
  },
  retentionClass: 'user_controlled',
  promptExposureClass: 'summary_only',
  mutationReason: 'User asked Arro to refresh this source state.',
  proposedAt: timestamp,
  value: {
    sourceId: 'approved-source-1',
    sourceName: 'Approved Source',
    bindingStatus: 'advisory',
    sourceLabel
  }
} as const

const acceptedReplacement = validateCommerceMemoryProposal(replacementProposal)

const agentContext = {
  integrationId: 'chatgpt-demo',
  surface: 'direct_http',
  requestedActionScope: 'write:memory',
  externalSubjectRef,
  externalTaskRef,
  sessionExpiresAt: '2099-01-01T00:00:00.000Z',
  hostCapabilities: [
    'source_labels',
    'freshness',
    'caveats',
    'no_buy_warnings',
    'commercial_disclosures',
    'authority_limits',
    'allowed_next_actions',
    'user_confirmation',
    'purchase_state'
  ]
} as const

const supersededRecordRow = {
  record_id: 'superseded-record-1',
  status: 'active',
  record_kind: 'source_state_reference',
  integration_id: 'chatgpt-demo',
  external_subject_ref_hash: externalSubjectRefHash,
  external_task_ref_hash: externalTaskRefHash,
  arro_user_id: null,
  decision_receipt_id: 'decision-receipt-1',
  source_id: 'approved-source-1',
  source_fact_type: 'connected_catalog_product'
}

const storedReplacementProposalRow = {
  proposal_id: 'replacement-proposal-1',
  status: 'pending_policy_review',
  record_kind: 'source_state_reference',
  integration_id: 'chatgpt-demo',
  external_subject_ref_hash: externalSubjectRefHash,
  external_task_ref_hash: externalTaskRefHash,
  arro_user_id: null,
  decision_receipt_id: 'decision-receipt-1',
  source_id: 'approved-source-1',
  source_fact_type: 'connected_catalog_product',
  provenance_kind: 'source_refresh',
  retention_class: 'user_controlled',
  prompt_exposure_class: 'summary_only',
  consent_basis: 'explicit_user_request',
  consent_granted_at: timestamp,
  mutation_reason: 'User asked Arro to refresh this source state.',
  proposed_at: timestamp,
  expires_at: null,
  proposal_value: replacementProposal.value,
  provenance: replacementProposal.provenance,
  consent: replacementProposal.consent,
  source_label: sourceLabel,
  created_at: timestamp
}

const commitCandidateRow = {
  proposal_id: 'replacement-proposal-1',
  record_kind: 'source_state_reference',
  integration_id: 'chatgpt-demo',
  external_subject_ref_hash: externalSubjectRefHash,
  external_task_ref_hash: externalTaskRefHash,
  arro_user_id: null,
  decision_receipt_id: 'decision-receipt-1',
  source_id: 'approved-source-1',
  source_fact_type: 'connected_catalog_product',
  provenance_kind: 'source_refresh',
  retention_class: 'user_controlled',
  prompt_exposure_class: 'summary_only',
  mutation_reason: 'User asked Arro to refresh this source state.',
  expires_at: null,
  proposal_value: replacementProposal.value,
  provenance: replacementProposal.provenance,
  consent: replacementProposal.consent,
  source_label: sourceLabel,
  policy_review_id: 'replacement-review-1',
  policy_review_decision: 'approved_for_commit',
  policy_review_issues: []
}

const replacementRecordRow = {
  record_id: 'replacement-record-1',
  proposal_id: 'replacement-proposal-1',
  policy_review_id: 'replacement-review-1',
  status: 'active',
  record_kind: 'source_state_reference',
  integration_id: 'chatgpt-demo',
  external_task_ref_hash: externalTaskRefHash,
  arro_user_id: null,
  decision_receipt_id: 'decision-receipt-1',
  source_id: 'approved-source-1',
  source_label: sourceLabel,
  retention_class: 'user_controlled',
  prompt_exposure_class: 'summary_only',
  committed_at: timestamp
}

const staleCandidateRow = {
  ...supersededRecordRow,
  source_label: sourceLabel
}

const staleMarkRow = {
  stale_mark_id: 'stale-mark-1',
  record_id: 'superseded-record-1',
  status: 'stale',
  reference_record_kind: 'source_state_reference',
  integration_id: 'chatgpt-demo',
  external_task_ref_hash: externalTaskRefHash,
  arro_user_id: null,
  decision_receipt_id: 'decision-receipt-1',
  source_id: 'approved-source-1',
  source_label: sourceLabel,
  refresh_reason_code: 'source_refresh_expired',
  marked_stale_at: timestamp
}

const refreshRow = {
  refresh_id: 'refresh-1',
  superseded_record_id: 'superseded-record-1',
  replacement_record_id: 'replacement-record-1',
  stale_mark_id: 'stale-mark-1',
  replacement_proposal_id: 'replacement-proposal-1',
  replacement_policy_review_id: 'replacement-review-1',
  reference_record_kind: 'source_state_reference',
  integration_id: 'chatgpt-demo',
  external_task_ref_hash: externalTaskRefHash,
  arro_user_id: null,
  decision_receipt_id: 'decision-receipt-1',
  source_id: 'approved-source-1',
  refresh_reason_code: 'source_refresh_expired',
  refreshed_at: timestamp
}

const queryResult = <T extends QueryResultRow>(
  rows: T[],
  rowCount = rows.length
): QueryResult<T> => ({
  command: 'SELECT',
  fields: [],
  oid: 0,
  rowCount,
  rows
})

const queryable = (
  results: Array<{ rows: QueryResultRow[]; rowCount?: number }>
) => {
  let callIndex = 0

  return {
    query: vi.fn(async <Row extends QueryResultRow>() => {
      const result = results[callIndex++] ?? { rows: [] }
      return queryResult(result.rows as Row[], result.rowCount ?? result.rows.length)
    })
  } satisfies Queryable
}

const successResults = () => [
  { rows: [] },
  { rows: [supersededRecordRow] },
  { rows: [{ proposal_id: 'replacement-proposal-1' }] },
  { rows: [storedReplacementProposalRow] },
  { rows: [{ review_id: 'replacement-review-1' }] },
  { rows: [commitCandidateRow] },
  { rows: [replacementRecordRow] },
  { rows: [staleCandidateRow] },
  { rows: [staleMarkRow] },
  { rows: [refreshRow] },
  { rows: [] }
]

const refreshIssueCodes = (
  result: Awaited<ReturnType<typeof refreshCommerceMemoryRecordWithReplacement>>
) => result.refreshed ? [] : result.issues.map((issue) => issue.code)

describe('commerce memory refresh replacement', () => {
  it('stores an approved replacement, marks the superseded record stale, and writes refresh lineage', async () => {
    const transactionClient = queryable(successResults())

    const result = await refreshCommerceMemoryRecordWithReplacement({
      transactionClient,
      supersededRecordId: 'superseded-record-1',
      replacementValidationResult: acceptedReplacement,
      agentContext,
      hashPepper,
      refreshId: 'refresh-1',
      replacementPolicyReviewId: 'replacement-review-1',
      replacementRecordId: 'replacement-record-1',
      staleMarkId: 'stale-mark-1',
      refreshReasonCode: 'source_refresh_expired',
      queuedAt: new Date(timestamp),
      reviewedAt: new Date(timestamp),
      committedAt: new Date(timestamp),
      markedStaleAt: new Date(timestamp),
      refreshedAt: new Date(timestamp)
    })

    expect(result).toMatchObject({
      refreshed: true,
      refresh: {
        refreshId: 'refresh-1',
        supersededRecordId: 'superseded-record-1',
        replacementRecordId: 'replacement-record-1',
        staleMarkId: 'stale-mark-1',
        replacementProposalId: 'replacement-proposal-1',
        replacementPolicyReviewId: 'replacement-review-1',
        referenceRecordKind: 'source_state_reference',
        refreshReasonCode: 'source_refresh_expired'
      }
    })

    const sql = transactionClient.query.mock.calls.map(([statement]) => statement).join('\n')
    const values = JSON.stringify(transactionClient.query.mock.calls.map(([, queryValues]) => queryValues))
    expect(transactionClient.query.mock.calls[0]?.[0]).toBe('begin')
    expect(transactionClient.query.mock.calls.at(-1)?.[0]).toBe('commit')
    expect(sql).toContain('insert into commerce_memory_record_refreshes')
    expect(sql).toContain('insert into commerce_memory_records')
    expect(sql).toContain('insert into commerce_memory_record_stale_marks')
    expect(values).not.toContain(externalSubjectRef)
    expect(values).not.toContain(externalTaskRef)
  })

  it('rolls back before proposal storage when replacement scope does not match', async () => {
    const transactionClient = queryable([
      { rows: [] },
      { rows: [supersededRecordRow] },
      { rows: [] }
    ])
    const mismatchedReplacement = validateCommerceMemoryProposal({
      ...replacementProposal,
      scope: {
        ...replacementProposal.scope,
        externalSubjectRef: 'different-user-ref'
      }
    })

    const result = await refreshCommerceMemoryRecordWithReplacement({
      transactionClient,
      supersededRecordId: 'superseded-record-1',
      replacementValidationResult: mismatchedReplacement,
      agentContext,
      hashPepper,
      refreshReasonCode: 'source_refresh_expired'
    })

    expect(result.refreshed).toBe(false)
    expect(refreshIssueCodes(result)).toEqual(['external_subject_ref_mismatch'])

    const sql = transactionClient.query.mock.calls.map(([statement]) => statement).join('\n')
    expect(transactionClient.query.mock.calls.at(-1)?.[0]).toBe('rollback')
    expect(sql).not.toContain('insert into commerce_memory_proposals')
  })

  it('rolls back denied replacement policy reviews before commit or stale marking', async () => {
    const transactionClient = queryable([
      { rows: [] },
      { rows: [supersededRecordRow] },
      { rows: [{ proposal_id: 'replacement-proposal-1' }] },
      { rows: [storedReplacementProposalRow] },
      { rows: [{ review_id: 'replacement-review-1' }] },
      { rows: [] }
    ])

    const result = await refreshCommerceMemoryRecordWithReplacement({
      transactionClient,
      supersededRecordId: 'superseded-record-1',
      replacementValidationResult: acceptedReplacement,
      agentContext: {
        ...agentContext,
        requestedActionScope: 'read:search'
      },
      hashPepper,
      refreshReasonCode: 'source_refresh_expired',
      replacementPolicyReviewId: 'replacement-review-1'
    })

    expect(result.refreshed).toBe(false)
    expect(refreshIssueCodes(result)).toEqual(['replacement_policy_review_denied'])

    const sql = transactionClient.query.mock.calls.map(([statement]) => statement).join('\n')
    expect(transactionClient.query.mock.calls.at(-1)?.[0]).toBe('rollback')
    expect(sql).not.toContain('insert into commerce_memory_records')
    expect(sql).not.toContain('insert into commerce_memory_record_stale_marks')
  })

  it('rolls back replacement and stale mark when refresh lineage is already recorded', async () => {
    const transactionClient = queryable([
      ...successResults().slice(0, 9),
      { rows: [], rowCount: 0 },
      { rows: [] }
    ])

    const result = await refreshCommerceMemoryRecordWithReplacement({
      transactionClient,
      supersededRecordId: 'superseded-record-1',
      replacementValidationResult: acceptedReplacement,
      agentContext,
      hashPepper,
      refreshId: 'refresh-1',
      replacementPolicyReviewId: 'replacement-review-1',
      replacementRecordId: 'replacement-record-1',
      staleMarkId: 'stale-mark-1',
      refreshReasonCode: 'source_refresh_expired',
      queuedAt: new Date(timestamp),
      reviewedAt: new Date(timestamp),
      committedAt: new Date(timestamp),
      markedStaleAt: new Date(timestamp),
      refreshedAt: new Date(timestamp)
    })

    expect(result.refreshed).toBe(false)
    expect(refreshIssueCodes(result)).toEqual(['refresh_already_recorded'])
    expect(transactionClient.query.mock.calls.at(-1)?.[0]).toBe('rollback')
  })
})
