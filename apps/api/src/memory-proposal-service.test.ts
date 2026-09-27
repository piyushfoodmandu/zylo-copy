import type { QueryResult, QueryResultRow } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { validateCommerceMemoryProposal } from '@arro/contracts'
import {
  hashCommerceMemoryScopeRef,
  listPendingCommerceMemoryProposalSummaries,
  readPendingCommerceMemoryProposal,
  storeValidatedCommerceMemoryProposal
} from './memory-proposal-service.ts'
import type { Queryable } from './target-business-repository.ts'

const timestamp = '2026-06-01T00:00:00.000Z'
const hashPepper = 'memory-proposal-test-pepper-32-chars'

const sourceLabel = {
  sourceId: 'approved-source-1',
  sourceName: 'Approved Source',
  factType: 'approved_catalog_product',
  fetchedAt: timestamp,
  expiresAt: '2026-06-01T00:15:00.000Z',
  freshnessClass: 'advisory_catalog',
  bindingStatus: 'advisory'
}

const baseProposal = {
  proposalId: 'memory-proposal-store-1',
  scope: {
    integrationId: 'chatgpt-demo',
    externalSubjectRef: 'opaque-user-ref-1',
    externalTaskRef: 'opaque-task-ref-1'
  },
  provenance: {
    kind: 'user_explicit',
    evidenceRef: 'intent-record-1'
  },
  consent: {
    userAuthorized: true,
    basis: 'explicit_user_request',
    grantedAt: timestamp
  },
  retentionClass: 'user_controlled',
  promptExposureClass: 'summary_only',
  mutationReason: 'User explicitly asked Arro to remember this typed commerce state.',
  proposedAt: timestamp
}

const savedProductProposal = {
  ...baseProposal,
  recordKind: 'saved_product_reference',
  value: {
    product: {
      businessId: 'approved-source-1',
      businessName: 'Approved Source',
      productId: 'approved-product-1',
      variantId: 'approved-product-1-size-10',
      title: 'Approved Running Shoe',
      sourceLabel
    },
    reasonCode: 'user_saved',
    plainReason: 'Matches the requested budget and selected size.',
    decisionReceiptId: 'decision-receipt-1'
  }
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

const queryable = (rows: QueryResultRow[] = [], rowCount = rows.length) => ({
  query: vi.fn(async <Row extends QueryResultRow>() =>
    queryResult(rows as Row[], rowCount)
  )
}) satisfies Queryable

const issueCodes = (result: Awaited<ReturnType<typeof storeValidatedCommerceMemoryProposal>>) =>
  result.stored ? [] : result.issues.map((issue) => issue.code)

describe('commerce memory proposal storage', () => {
  it('stores accepted proposals durably with hashed external refs and bounded summary output', async () => {
    const client = queryable([
      { proposal_id: 'memory-proposal-store-1' }
    ])
    const result = await storeValidatedCommerceMemoryProposal({
      client,
      validationResult: validateCommerceMemoryProposal(savedProductProposal),
      hashPepper,
      queuedAt: new Date('2026-06-01T00:01:00.000Z')
    })

    expect(result).toMatchObject({
      stored: true,
      entry: {
        proposalId: 'memory-proposal-store-1',
        status: 'pending_policy_review',
        recordKind: 'saved_product_reference',
        scope: {
          integrationId: 'chatgpt-demo',
          hasExternalSubjectRef: true,
          hasExternalTaskRef: true
        },
        provenance: {
          kind: 'user_explicit',
          hasEvidenceRef: true
        },
        retentionClass: 'user_controlled',
        promptExposureClass: 'summary_only'
      }
    })

    const [sql, values] = client.query.mock.calls[0]!
    expect(sql).toContain('insert into commerce_memory_proposals')
    expect(sql).toContain('on conflict (proposal_id) do nothing')
    expect(values?.[3]).toBe(hashCommerceMemoryScopeRef('opaque-user-ref-1', hashPepper))
    expect(values?.[4]).toBe(hashCommerceMemoryScopeRef('opaque-task-ref-1', hashPepper))
    expect(values?.[17]).toEqual(savedProductProposal.value)
    expect(JSON.stringify(values)).not.toContain('opaque-user-ref-1')
    expect(JSON.stringify(values)).not.toContain('opaque-task-ref-1')

    const summaryText = JSON.stringify(result)
    expect(summaryText).not.toContain('Approved Running Shoe')
    expect(summaryText).not.toContain('Matches the requested budget')
  })

  it('rejects invalid validation results before touching durable storage', async () => {
    const client = queryable()
    const invalidProposal = {
      ...baseProposal,
      proposalId: 'memory-proposal-store-2',
      recordKind: 'region',
      value: {
        region: 'US'
      },
      rawTranscript: 'User: remember this whole conversation.',
      paymentMethodId: 'pm_hidden',
      paidPlacement: true
    }

    const result = await storeValidatedCommerceMemoryProposal({
      client,
      validationResult: validateCommerceMemoryProposal(invalidProposal),
      hashPepper,
      queuedAt: new Date('2026-06-01T00:01:00.000Z')
    })

    expect(result.stored).toBe(false)
    expect(issueCodes(result)).toEqual(expect.arrayContaining([
      'forbidden_field',
      'schema_invalid'
    ]))
    expect(client.query).not.toHaveBeenCalled()
  })

  it('rejects duplicate proposal IDs without updating the existing row', async () => {
    const client = queryable([], 0)

    const result = await storeValidatedCommerceMemoryProposal({
      client,
      validationResult: validateCommerceMemoryProposal(savedProductProposal),
      hashPepper,
      queuedAt: new Date('2026-06-01T00:01:00.000Z')
    })

    expect(result.stored).toBe(false)
    expect(issueCodes(result)).toEqual(['duplicate_proposal'])

    const [sql] = client.query.mock.calls[0]!
    expect(sql).toContain('on conflict (proposal_id) do nothing')
    expect(sql).not.toContain('do update')
  })

  it('requires a production-length hash pepper before storing accepted proposals', async () => {
    const client = queryable()

    const result = await storeValidatedCommerceMemoryProposal({
      client,
      validationResult: validateCommerceMemoryProposal(savedProductProposal),
      hashPepper: 'short',
      queuedAt: new Date('2026-06-01T00:01:00.000Z')
    })

    expect(result.stored).toBe(false)
    expect(issueCodes(result)).toEqual(['hash_pepper_required'])
    expect(client.query).not.toHaveBeenCalled()
  })

  it('reads stored pending proposals without restoring raw external refs', async () => {
    const subjectHash = hashCommerceMemoryScopeRef('opaque-user-ref-1', hashPepper)
    const taskHash = hashCommerceMemoryScopeRef('opaque-task-ref-1', hashPepper)
    const client = queryable([
      {
        proposal_id: 'memory-proposal-store-1',
        status: 'pending_policy_review',
        record_kind: 'saved_product_reference',
        integration_id: 'chatgpt-demo',
        external_subject_ref_hash: subjectHash,
        external_task_ref_hash: taskHash,
        arro_user_id: null,
        decision_receipt_id: null,
        source_id: null,
        source_fact_type: null,
        provenance_kind: 'user_explicit',
        retention_class: 'user_controlled',
        prompt_exposure_class: 'summary_only',
        consent_basis: 'explicit_user_request',
        consent_granted_at: timestamp,
        mutation_reason: savedProductProposal.mutationReason,
        proposed_at: timestamp,
        expires_at: null,
        proposal_value: savedProductProposal.value,
        provenance: savedProductProposal.provenance,
        consent: savedProductProposal.consent,
        source_label: null,
        created_at: '2026-06-01T00:01:00.000Z'
      }
    ])

    const stored = await readPendingCommerceMemoryProposal(
      client,
      'memory-proposal-store-1'
    )

    expect(stored?.proposal.scope).toMatchObject({
      integrationId: 'chatgpt-demo',
      externalSubjectRefHash: subjectHash,
      externalTaskRefHash: taskHash
    })
    expect(JSON.stringify(stored)).not.toContain('opaque-user-ref-1')
    expect(JSON.stringify(stored)).not.toContain('opaque-task-ref-1')
  })

  it('lists pending summaries by hashed integration subject scope', async () => {
    const subjectHash = hashCommerceMemoryScopeRef('opaque-user-ref-1', hashPepper)
    const client = queryable([])

    await listPendingCommerceMemoryProposalSummaries(client, {
      integrationId: 'chatgpt-demo',
      externalSubjectRef: 'opaque-user-ref-1',
      hashPepper,
      limit: 500
    })

    const [sql, values] = client.query.mock.calls[0]!
    expect(sql).toContain('from commerce_memory_proposals')
    expect(sql).toContain('external_subject_ref_hash = $2')
    expect(values).toEqual([
      'chatgpt-demo',
      subjectHash,
      100
    ])
  })
})
