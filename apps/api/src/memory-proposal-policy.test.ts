import type { QueryResult, QueryResultRow } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type { AgentInvocationContext } from '@arro/contracts'
import type { CommerceMemoryStoredProposal } from './memory-proposal-service.ts'
import { hashCommerceMemoryScopeRef } from './memory-proposal-service.ts'
import {
  reviewCommerceMemoryProposalPolicy,
  storeCommerceMemoryProposalPolicyReview
} from './memory-proposal-policy.ts'
import type { Queryable } from './target-business-repository.ts'

const timestamp = '2026-06-01T00:00:00.000Z'
const hashPepper = 'memory-policy-test-pepper-32-chars'
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

const agentContext = {
  integrationId: 'chatgpt-demo',
  surface: 'chatgpt',
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
} satisfies AgentInvocationContext

const storedSourceStateProposal = {
  proposalId: 'memory-policy-proposal-1',
  status: 'pending_policy_review',
  proposal: {
    proposalId: 'memory-policy-proposal-1',
    recordKind: 'source_state_reference',
    scope: {
      integrationId: 'chatgpt-demo',
      externalSubjectRefHash,
      externalTaskRefHash,
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
    retentionClass: 'user_controlled',
    promptExposureClass: 'summary_only',
    mutationReason: 'User explicitly asked Arro to remember this source state.',
    proposedAt: timestamp,
    value: {
      sourceId: 'approved-source-1',
      sourceName: 'Approved Source',
      bindingStatus: 'advisory',
      sourceLabel
    }
  },
  summary: {
    proposalId: 'memory-policy-proposal-1',
    status: 'pending_policy_review',
    recordKind: 'source_state_reference',
    queuedAt: timestamp,
    scope: {
      integrationId: 'chatgpt-demo',
      hasExternalSubjectRef: true,
      hasExternalTaskRef: true,
      hasArroUserId: false,
      hasDecisionReceiptId: false,
      hasSourceLabel: true
    },
    provenance: {
      kind: 'agent_proposed',
      hasEvidenceRef: true,
      hasAdapterId: false,
      hasSourceRecordRef: true
    },
    retentionClass: 'user_controlled',
    promptExposureClass: 'summary_only'
  }
} satisfies CommerceMemoryStoredProposal

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

const issueCodes = (
  review: ReturnType<typeof reviewCommerceMemoryProposalPolicy>
) => review.issues.map((issue) => issue.code)

describe('commerce memory proposal policy review', () => {
  it('stores approved policy reviews with hashed agent refs and no raw subject refs', async () => {
    const client = queryable([{ review_id: 'memory-policy-review-1' }])

    const result = await storeCommerceMemoryProposalPolicyReview({
      client,
      storedProposal: storedSourceStateProposal,
      agentContext,
      hashPepper,
      reviewId: 'memory-policy-review-1',
      now: new Date(timestamp)
    })

    expect(result).toMatchObject({
      stored: true,
      reviewId: 'memory-policy-review-1',
      review: {
        proposalId: 'memory-policy-proposal-1',
        decision: 'approved_for_commit',
        issues: []
      }
    })

    const [sql, values] = client.query.mock.calls[0]!
    expect(sql).toContain('insert into commerce_memory_proposal_policy_reviews')
    expect(sql).toContain('on conflict (review_id) do nothing')
    expect(values?.[8]).toBe(externalSubjectRefHash)
    expect(values?.[9]).toBe(externalTaskRefHash)
    expect(JSON.stringify(values)).not.toContain(externalSubjectRef)
    expect(JSON.stringify(values)).not.toContain(externalTaskRef)
  })

  it('denies proposals without matching write scope, active session, and scoped subject', () => {
    const review = reviewCommerceMemoryProposalPolicy({
      storedProposal: storedSourceStateProposal,
      agentContext: {
        ...agentContext,
        integrationId: 'claude-demo',
        requestedActionScope: 'read:search',
        externalSubjectRef: 'other-user-ref',
        sessionExpiresAt: '2026-05-31T23:59:59.000Z'
      },
      hashPepper,
      now: new Date(timestamp)
    })

    expect(review.decision).toBe('denied')
    expect(issueCodes(review)).toEqual(expect.arrayContaining([
      'write_scope_required',
      'agent_session_expired',
      'integration_mismatch',
      'external_subject_ref_mismatch'
    ]))
  })

  it('denies proposals when the host cannot preserve required memory trust signals', () => {
    const review = reviewCommerceMemoryProposalPolicy({
      storedProposal: storedSourceStateProposal,
      agentContext: {
        ...agentContext,
        hostCapabilities: [
          'source_labels',
          'freshness',
          'authority_limits'
        ] as const
      },
      hashPepper,
      now: new Date(timestamp)
    })

    expect(review.decision).toBe('denied')
    expect(issueCodes(review)).toContain('host_capability_required')
  })

  it('denies source-scoped proposals without scoped source provenance', () => {
    const { sourceLabel: _sourceLabel, ...scopeWithoutSourceLabel } =
      storedSourceStateProposal.proposal.scope
    const review = reviewCommerceMemoryProposalPolicy({
      storedProposal: {
        ...storedSourceStateProposal,
        proposal: {
          ...storedSourceStateProposal.proposal,
          scope: scopeWithoutSourceLabel,
          provenance: {
            kind: 'agent_proposed'
          }
        }
      },
      agentContext,
      hashPepper,
      now: new Date(timestamp)
    })

    expect(review.decision).toBe('denied')
    expect(issueCodes(review)).toContain('source_provenance_required')
  })

  it('denies receipt-scoped proposals whose typed value and scope disagree', () => {
    const review = reviewCommerceMemoryProposalPolicy({
      storedProposal: {
        ...storedSourceStateProposal,
        proposal: {
          ...storedSourceStateProposal.proposal,
          recordKind: 'no_buy_warning',
          scope: {
            ...storedSourceStateProposal.proposal.scope,
            decisionReceiptId: 'decision-receipt-1'
          },
          value: {
            warningCode: 'source_stale',
            plainReason: 'Source state changed before checkout preparation.',
            decisionReceiptId: 'decision-receipt-2',
            sourceLabel
          }
        },
        summary: {
          ...storedSourceStateProposal.summary,
          recordKind: 'no_buy_warning'
        }
      },
      agentContext,
      hashPepper,
      now: new Date(timestamp)
    })

    expect(review.decision).toBe('denied')
    expect(issueCodes(review)).toContain('receipt_scope_mismatch')
  })

  it('denies typed migrations from external agent surfaces', () => {
    const review = reviewCommerceMemoryProposalPolicy({
      storedProposal: {
        ...storedSourceStateProposal,
        proposal: {
          ...storedSourceStateProposal.proposal,
          recordKind: 'region',
          scope: {
            integrationId: 'chatgpt-demo',
            externalSubjectRefHash
          },
          provenance: {
            kind: 'typed_migration',
            adapterId: 'typed-memory-adapter',
            sourceRecordRef: 'typed-memory-record-1'
          },
          consent: {
            userAuthorized: true,
            basis: 'typed_migration_authorization',
            grantedAt: timestamp
          },
          value: {
            region: 'US'
          }
        },
        summary: {
          ...storedSourceStateProposal.summary,
          recordKind: 'region'
        }
      },
      agentContext,
      hashPepper,
      now: new Date(timestamp)
    })

    expect(review.decision).toBe('denied')
    expect(issueCodes(review)).toContain('typed_migration_internal_only')
  })
})
