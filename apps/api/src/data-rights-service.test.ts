import { createHmac } from 'node:crypto'
import type { QueryResult, QueryResultRow } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { createPostgresDataRightsStore } from './data-rights-service.ts'
import { hashCommerceMemoryScopeRef } from './memory-proposal-service.ts'
import type { Queryable } from './target-business-repository.ts'

const hashPepper = 'data-rights-test-hash-pepper-32-chars'
const now = new Date('2026-07-02T12:00:00.000Z')
const externalSubjectRef = 'opaque-data-rights-subject'
const dataRightsSubjectHash = hashCommerceMemoryScopeRef(externalSubjectRef, hashPepper)
const agentSubjectHash = `sha256:${createHmac('sha256', hashPepper)
  .update(`subject:test-key:operator:${externalSubjectRef}`, 'utf8')
  .digest('hex')}`

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

const queryable = (...results: QueryResultRow[][]) => {
  let callIndex = 0

  return {
    query: vi.fn(async <Row extends QueryResultRow>() => {
      const rows = (results[callIndex++] ?? []) as Row[]
      return queryResult(rows)
    })
  } satisfies Queryable
}

const context = {
  requestId: 'data-rights-request',
  correlationId: 'data-rights-correlation',
  now
}

describe('data-rights service', () => {
  it('exports scoped UCP purchase rows without echoing raw external subject refs', async () => {
    const client = queryable(
      [
        {
          transaction_id: 'ucptx_1',
          merchant_origin: 'https://merchant.example',
          checkout_id: 'chk_1',
          cart_id: 'cart_1',
          last_checkout_status: 'ready_for_complete',
          cart_json: { id: 'cart_1' },
          checkout_json: { id: 'chk_1' },
          created_at: now,
          updated_at: now
        }
      ],
      [
        {
          payment_result_id: 'ucppr_1',
          transaction_id: 'ucptx_1',
          provider: 'com.google.pay',
          handler_id: 'com.google.pay',
          result_fingerprint: `sha256:${'a'.repeat(64)}`,
          instrument_json: { id: 'pi_1', credential: { redacted: true } },
          created_at: now
        }
      ],
      [
        {
          order_id: 'order_1',
          transaction_id: 'ucptx_1',
          merchant_origin: 'https://merchant.example',
          checkout_id: 'chk_1',
          order_permalink_url: 'https://merchant.example/orders/order_1',
          first_seen_at: now,
          last_seen_at: now
        }
      ],
      [],
      [
        {
          event_id: 'dre_export',
          action: 'export',
          status: 'completed',
          target_record_kind: 'subject_scope',
          target_record_id: null,
          correction_payload: null,
          result_summary: {},
          created_at: now
        }
      ]
    )
    const store = createPostgresDataRightsStore({ client, hashPepper })

    const result = await store.exportRecords({
      integrationId: 'agent:test-key:operator',
      externalSubjectRef
    }, context)

    expect(result.records.ucpCheckoutSessions).toHaveLength(1)
    expect(result.records.ucpPaymentResults).toHaveLength(1)
    expect(result.records.ucpOrders).toHaveLength(1)
    expect(JSON.stringify(result)).not.toContain(externalSubjectRef)
    expect(client.query.mock.calls[0]![1]).toEqual([
      'agent:test-key:operator',
      expect.arrayContaining([agentSubjectHash])
    ])
    expect(client.query.mock.calls[3]![1]).toEqual([
      'agent:test-key:operator',
      dataRightsSubjectHash
    ])
  })

  it('records corrections only for purchase or order targets in the scoped subject', async () => {
    const client = queryable(
      [{ count: 1 }],
      [
        {
          event_id: 'dre_correction',
          action: 'correction',
          status: 'completed',
          target_record_kind: 'purchase',
          target_record_id: 'ucptx_1',
          correction_payload: {
            field: 'checkout_status',
            statement: 'Corrected statement.'
          },
          result_summary: { correctionRecorded: true },
          created_at: now
        }
      ]
    )
    const store = createPostgresDataRightsStore({ client, hashPepper })

    const result = await store.recordCorrection({
      integrationId: 'agent:test-key:operator',
      externalSubjectRef,
      target: {
        kind: 'purchase',
        recordId: 'ucptx_1'
      },
      correction: {
        field: 'checkout_status',
        statement: 'Corrected statement.'
      }
    }, context)

    expect(result).toMatchObject({
      recorded: true,
      response: {
        state: 'correction_recorded',
        event: {
          action: 'correction',
          target: {
            kind: 'purchase',
            recordId: 'ucptx_1'
          }
        }
      }
    })
  })

  it('deletes current UCP purchase records and retains a scoped event ledger', async () => {
    const client = queryable(
      [{ payment_result_id: 'ucppr_1' }],
      [{ order_id: 'order_1' }],
      [{ transaction_id: 'ucptx_1' }],
      [
        {
          event_id: 'dre_delete',
          action: 'deletion',
          status: 'completed',
          target_record_kind: 'subject_scope',
          target_record_id: null,
          correction_payload: null,
          result_summary: {},
          created_at: now
        }
      ],
      [{ count: 1 }]
    )
    const store = createPostgresDataRightsStore({ client, hashPepper })

    const result = await store.deleteRecords({
      integrationId: 'agent:test-key:operator',
      externalSubjectRef
    }, context)

    expect(result.deleted).toEqual({
      ucpCheckoutSessionCount: 1,
      ucpPaymentResultCount: 1,
      ucpOrderCount: 1
    })
    expect(client.query.mock.calls[0]![0]).toContain('delete from ucp_payment_results')
    expect(client.query.mock.calls[1]![0]).toContain('delete from ucp_orders')
    expect(client.query.mock.calls[2]![0]).toContain('delete from ucp_checkout_sessions')
  })
})
