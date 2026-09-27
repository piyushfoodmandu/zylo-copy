import type { QueryResult, QueryResultRow } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { hashCommerceMemoryScopeRef } from './memory-proposal-service.ts'
import {
  commitApprovedCommerceMemoryProposal,
  markCommerceMemoryRecordStale
} from './memory-record-service.ts'
import type { Queryable } from './target-business-repository.ts'

const timestamp = '2026-06-01T00:00:00.000Z'
const hashPepper = 'memory-record-test-pepper-32-chars'
const externalSubjectRefHash = hashCommerceMemoryScopeRef('opaque-user-ref-1', hashPepper)
const externalTaskRefHash = hashCommerceMemoryScopeRef('opaque-task-ref-1', hashPepper)

const sourceLabel = {
  sourceId: 'approved-source-1',
  sourceName: 'Approved Source',
  factType: 'connected_catalog_product',
  fetchedAt: timestamp,
  expiresAt: '2026-06-01T00:15:00.000Z',
  freshnessClass: 'advisory_catalog',
  bindingStatus: 'advisory'
} as const

const candidateRow = {
  proposal_id: 'memory-record-proposal-1',
  record_kind: 'source_state_reference',
  integration_id: 'chatgpt-demo',
  external_subject_ref_hash: externalSubjectRefHash,
  external_task_ref_hash: externalTaskRefHash,
  arro_user_id: null,
  decision_receipt_id: 'decision-receipt-1',
  source_id: 'approved-source-1',
  source_fact_type: 'connected_catalog_product',
  provenance_kind: 'agent_proposed',
  retention_class: 'user_controlled',
  prompt_exposure_class: 'summary_only',
  mutation_reason: 'User explicitly asked Arro to remember this source state.',
  expires_at: null,
  proposal_value: {
    sourceId: 'approved-source-1',
    sourceName: 'Approved Source',
    bindingStatus: 'advisory',
    sourceLabel
  },
  provenance: {
    kind: 'agent_proposed',
    evidenceRef: 'intent-record-1',
    sourceRecordRef: 'approved-source-1'
  },
  consent: {
    userAuthorized: true,
    basis: 'explicit_user_request',
    grantedAt: timestamp
  },
  source_label: sourceLabel,
  policy_review_id: 'memory-record-review-1',
  policy_review_decision: 'approved_for_commit',
  policy_review_issues: []
}

const recordRow = {
  record_id: 'memory-record-1',
  proposal_id: 'memory-record-proposal-1',
  policy_review_id: 'memory-record-review-1',
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
  record_id: 'memory-record-1',
  status: 'active',
  record_kind: 'source_state_reference',
  integration_id: 'chatgpt-demo',
  external_subject_ref_hash: externalSubjectRefHash,
  external_task_ref_hash: externalTaskRefHash,
  arro_user_id: null,
  decision_receipt_id: 'decision-receipt-1',
  source_id: 'approved-source-1',
  source_fact_type: 'connected_catalog_product',
  source_label: sourceLabel
}

const staleMarkRow = {
  stale_mark_id: 'memory-stale-mark-1',
  record_id: 'memory-record-1',
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

const issueCodes = (
  result: Awaited<ReturnType<typeof commitApprovedCommerceMemoryProposal>>
) => result.committed ? [] : result.issues.map((issue) => issue.code)

const staleIssueCodes = (
  result: Awaited<ReturnType<typeof markCommerceMemoryRecordStale>>
) => result.markedStale ? [] : result.issues.map((issue) => issue.code)

describe('commerce memory record commit', () => {
  it('commits approved proposals into durable memory records without raw external refs', async () => {
    const client = queryable([
      { rows: [candidateRow] },
      { rows: [recordRow] }
    ])

    const result = await commitApprovedCommerceMemoryProposal({
      client,
      proposalId: 'memory-record-proposal-1',
      policyReviewId: 'memory-record-review-1',
      recordId: 'memory-record-1',
      committedAt: new Date(timestamp)
    })

    expect(result).toMatchObject({
      committed: true,
      record: {
        recordId: 'memory-record-1',
        proposalId: 'memory-record-proposal-1',
        policyReviewId: 'memory-record-review-1',
        status: 'active',
        recordKind: 'source_state_reference',
        scope: {
          integrationId: 'chatgpt-demo',
          hasExternalSubjectRef: true,
          hasExternalTaskRef: true,
          hasDecisionReceiptId: true,
          hasSourceLabel: true
        }
      }
    })

    const [insertSql, insertValues] = client.query.mock.calls[1]!
    expect(insertSql).toContain('insert into commerce_memory_records')
    expect(insertSql).toContain('on conflict (proposal_id) do nothing')
    expect(insertValues?.[5]).toBe(externalSubjectRefHash)
    expect(insertValues?.[6]).toBe(externalTaskRefHash)
    expect(JSON.stringify(insertValues)).not.toContain('opaque-user-ref-1')
    expect(JSON.stringify(insertValues)).not.toContain('opaque-task-ref-1')
  })

  it('requires an approved policy review before commit', async () => {
    const client = queryable([
      {
        rows: [{
          ...candidateRow,
          policy_review_decision: 'denied',
          policy_review_issues: [{ code: 'write_scope_required' }]
        }]
      }
    ])

    const result = await commitApprovedCommerceMemoryProposal({
      client,
      proposalId: 'memory-record-proposal-1',
      policyReviewId: 'memory-record-review-denied',
      recordId: 'memory-record-1',
      committedAt: new Date(timestamp)
    })

    expect(result.committed).toBe(false)
    expect(issueCodes(result)).toEqual(['policy_review_not_approved'])
    expect(client.query).toHaveBeenCalledTimes(1)
  })

  it('requires the supplied policy review to belong to the proposal', async () => {
    const client = queryable([
      {
        rows: [{
          ...candidateRow,
          policy_review_id: null,
          policy_review_decision: null,
          policy_review_issues: null
        }]
      }
    ])

    const result = await commitApprovedCommerceMemoryProposal({
      client,
      proposalId: 'memory-record-proposal-1',
      policyReviewId: 'missing-review',
      recordId: 'memory-record-1',
      committedAt: new Date(timestamp)
    })

    expect(result.committed).toBe(false)
    expect(issueCodes(result)).toEqual(['policy_review_required'])
    expect(client.query).toHaveBeenCalledTimes(1)
  })

  it('rejects duplicate commits without updating the existing memory record', async () => {
    const client = queryable([
      { rows: [candidateRow] },
      { rows: [], rowCount: 0 }
    ])

    const result = await commitApprovedCommerceMemoryProposal({
      client,
      proposalId: 'memory-record-proposal-1',
      policyReviewId: 'memory-record-review-1',
      recordId: 'memory-record-1',
      committedAt: new Date(timestamp)
    })

    expect(result.committed).toBe(false)
    expect(issueCodes(result)).toEqual(['duplicate_commit'])

    const [insertSql] = client.query.mock.calls[1]!
    expect(insertSql).toContain('on conflict (proposal_id) do nothing')
    expect(insertSql).not.toContain('do update')
  })
})

describe('commerce memory stale marking', () => {
  it('marks scoped active reference records stale without raw external refs', async () => {
    const client = queryable([
      { rows: [staleCandidateRow] },
      { rows: [staleMarkRow] }
    ])

    const result = await markCommerceMemoryRecordStale({
      client,
      recordId: 'memory-record-1',
      scope: {
        integrationId: 'chatgpt-demo',
        externalSubjectRef: 'opaque-user-ref-1',
        externalTaskRef: 'opaque-task-ref-1'
      },
      hashPepper,
      staleMarkId: 'memory-stale-mark-1',
      refreshReasonCode: 'source_refresh_expired',
      markedStaleAt: new Date(timestamp)
    })

    expect(result).toMatchObject({
      markedStale: true,
      staleMark: {
        staleMarkId: 'memory-stale-mark-1',
        recordId: 'memory-record-1',
        status: 'stale',
        referenceRecordKind: 'source_state_reference',
        refreshReasonCode: 'source_refresh_expired',
        scope: {
          integrationId: 'chatgpt-demo',
          hasExternalSubjectRef: true,
          hasExternalTaskRef: true,
          hasDecisionReceiptId: true,
          hasSourceLabel: true
        }
      }
    })

    const [staleSql, staleValues] = client.query.mock.calls[1]!
    expect(staleSql).toContain('insert into commerce_memory_record_stale_marks')
    expect(staleSql).toContain("status = 'stale'")
    expect(staleSql).toContain('from commerce_memory_records r')
    expect(staleSql).toContain('on conflict (record_id) do nothing')
    expect(staleValues?.[6]).toBe(externalSubjectRefHash)
    expect(staleValues?.[7]).toBe(externalTaskRefHash)
    expect(JSON.stringify(staleValues)).not.toContain('opaque-user-ref-1')
    expect(JSON.stringify(staleValues)).not.toContain('opaque-task-ref-1')
  })

  it('requires the scoped task ref for task-bound records before stale marking', async () => {
    const client = queryable([{ rows: [staleCandidateRow] }])

    const result = await markCommerceMemoryRecordStale({
      client,
      recordId: 'memory-record-1',
      scope: {
        integrationId: 'chatgpt-demo',
        externalSubjectRef: 'opaque-user-ref-1'
      },
      hashPepper,
      staleMarkId: 'memory-stale-mark-1',
      refreshReasonCode: 'source_refresh_expired',
      markedStaleAt: new Date(timestamp)
    })

    expect(result.markedStale).toBe(false)
    expect(staleIssueCodes(result)).toEqual(['external_task_ref_required'])
    expect(client.query).toHaveBeenCalledTimes(1)
  })

  it('does not mark non-reference preference records stale', async () => {
    const client = queryable([
      {
        rows: [{
          ...staleCandidateRow,
          external_task_ref_hash: null,
          record_kind: 'region'
        }]
      }
    ])

    const result = await markCommerceMemoryRecordStale({
      client,
      recordId: 'memory-record-1',
      scope: {
        integrationId: 'chatgpt-demo',
        externalSubjectRef: 'opaque-user-ref-1'
      },
      hashPepper,
      staleMarkId: 'memory-stale-mark-1',
      refreshReasonCode: 'source_refresh_expired',
      markedStaleAt: new Date(timestamp)
    })

    expect(result.markedStale).toBe(false)
    expect(staleIssueCodes(result)).toEqual(['record_kind_not_stale_markable'])
    expect(client.query).toHaveBeenCalledTimes(1)
  })

  it('rejects duplicate stale marks without updating the record again', async () => {
    const client = queryable([
      { rows: [staleCandidateRow] },
      { rows: [], rowCount: 0 }
    ])

    const result = await markCommerceMemoryRecordStale({
      client,
      recordId: 'memory-record-1',
      scope: {
        integrationId: 'chatgpt-demo',
        externalSubjectRef: 'opaque-user-ref-1',
        externalTaskRef: 'opaque-task-ref-1'
      },
      hashPepper,
      staleMarkId: 'memory-stale-mark-1',
      refreshReasonCode: 'source_refresh_expired',
      markedStaleAt: new Date(timestamp)
    })

    expect(result.markedStale).toBe(false)
    expect(staleIssueCodes(result)).toEqual(['duplicate_stale_mark'])

    const [staleSql] = client.query.mock.calls[1]!
    expect(staleSql).toContain('on conflict (record_id) do nothing')
    expect(staleSql).not.toContain('do update')
  })

  it('does not mark records stale when the subject scope does not match', async () => {
    const client = queryable([{ rows: [staleCandidateRow] }])

    const result = await markCommerceMemoryRecordStale({
      client,
      recordId: 'memory-record-1',
      scope: {
        integrationId: 'chatgpt-demo',
        externalSubjectRef: 'different-user-ref',
        externalTaskRef: 'opaque-task-ref-1'
      },
      hashPepper,
      staleMarkId: 'memory-stale-mark-1',
      refreshReasonCode: 'source_refresh_expired',
      markedStaleAt: new Date(timestamp)
    })

    expect(result.markedStale).toBe(false)
    expect(staleIssueCodes(result)).toEqual(['external_subject_ref_mismatch'])
    expect(client.query).toHaveBeenCalledTimes(1)
  })
})
