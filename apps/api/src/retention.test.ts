import type { QueryResult, QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'
import { runRetentionCleanup } from './retention.ts'

const queryResult = <T extends QueryResultRow>(
  rows: T[],
  rowCount = rows.length
): QueryResult<T> => ({
  command: 'SELECT',
  rowCount,
  oid: 0,
  fields: [],
  rows
})

class MemoryRetentionQueryable {
  readonly deletedTables: string[] = []

  constructor(
    private readonly counts: {
      requestAuditLog: number
      searchAuditLogs: number
      productDetailAuditLogs: number
      commerceMemoryProposals: number
      ucpCheckoutSessions: number
      discoveryObservations: number
    }
  ) {}

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<T>> {
    if (!values?.[0]) throw new Error('Retention queries should use a cutoff parameter.')

    if (text.includes('from request_audit_log') && text.includes('count(*)')) {
      return queryResult([{ count: this.counts.requestAuditLog } as T])
    }

    if (text.includes('delete from request_audit_log')) {
      this.deletedTables.push('request_audit_log')
      return queryResult([], this.counts.requestAuditLog)
    }

    if (text.includes('from search_audit_logs') && text.includes('count(*)')) {
      return queryResult([{ count: this.counts.searchAuditLogs } as T])
    }

    if (text.includes('delete from search_audit_logs')) {
      this.deletedTables.push('search_audit_logs')
      return queryResult([], this.counts.searchAuditLogs)
    }

    if (text.includes('from product_detail_audit_logs') && text.includes('count(*)')) {
      return queryResult([{ count: this.counts.productDetailAuditLogs } as T])
    }

    if (text.includes('delete from product_detail_audit_logs')) {
      this.deletedTables.push('product_detail_audit_logs')
      return queryResult([], this.counts.productDetailAuditLogs)
    }

    if (text.includes('from commerce_memory_proposals') && text.includes('count(*)')) {
      expect(text).toContain('expires_at is not null')
      expect(text).toContain('expires_at <= $1::timestamptz')
      return queryResult([{ count: this.counts.commerceMemoryProposals } as T])
    }

    if (text.includes('delete from commerce_memory_proposals')) {
      expect(text).toContain('expires_at is not null')
      expect(text).toContain('expires_at <= $1::timestamptz')
      this.deletedTables.push('commerce_memory_proposals')
      return queryResult([], this.counts.commerceMemoryProposals)
    }

    if (text.includes('from ucp_checkout_sessions') && text.includes('count(*)')) {
      expect(text).toContain("last_checkout_status in ('completed', 'canceled')")
      expect(text).toContain('updated_at < $1::timestamptz')
      return queryResult([{ count: this.counts.ucpCheckoutSessions } as T])
    }

    if (text.includes('delete from ucp_checkout_sessions')) {
      expect(text).toContain("last_checkout_status in ('completed', 'canceled')")
      expect(text).toContain('updated_at < $1::timestamptz')
      this.deletedTables.push('ucp_checkout_sessions')
      return queryResult([], this.counts.ucpCheckoutSessions)
    }

    if (text.includes('from target_business_discovery_observations') && text.includes('count(*)')) {
      expect(text).toContain('not exists')
      expect(text).toContain('target_business_state_transitions')
      return queryResult([{ count: this.counts.discoveryObservations } as T])
    }

    if (text.includes('delete from target_business_discovery_observations')) {
      expect(text).toContain('not exists')
      expect(text).toContain('target_business_state_transitions')
      this.deletedTables.push('target_business_discovery_observations')
      return queryResult([], this.counts.discoveryObservations)
    }


    throw new Error(`Unexpected retention query: ${text}`)
  }
}

describe('retention cleanup', () => {
  const now = new Date('2026-05-31T12:00:00.000Z')
  const policy = {
    requestAuditLogRetentionDays: 30,
    searchAuditLogRetentionDays: 14,
    purchaseSessionRetentionDays: 7,
    discoveryObservationRetentionDays: 60,
  }

  it('reports eligible rows without mutating data in dry-run mode', async () => {
    const queryable = new MemoryRetentionQueryable({
      requestAuditLog: 3,
      searchAuditLogs: 7,
      productDetailAuditLogs: 5,
      commerceMemoryProposals: 4,
      ucpCheckoutSessions: 8,
      discoveryObservations: 2,
    })

    const result = await runRetentionCleanup(queryable, { mode: 'dry-run', now, policy })

    expect(result.mode).toBe('dry-run')
    expect(result.generatedAt).toBe(now.toISOString())
    expect(queryable.deletedTables).toEqual([])
    expect(result.targets.map((target) => [target.table, target.matchedRows, target.affectedRows])).toEqual([
      ['request_audit_log', 3, 0],
      ['search_audit_logs', 7, 0],
      ['product_detail_audit_logs', 5, 0],
      ['commerce_memory_proposals', 4, 0],
      ['ucp_checkout_sessions', 8, 0],
      ['target_business_discovery_observations', 2, 0],
      ['target_business_state_transitions', 0, 0]
    ])
    expect(result.targets.find((target) => target.table === 'ucp_checkout_sessions')?.note)
      .toContain('current FK cascades')
  })

  it('deletes audit, terminal UCP purchase, and unlinked discovery rows while preserving source-governance transitions', async () => {
    const queryable = new MemoryRetentionQueryable({
      requestAuditLog: 4,
      searchAuditLogs: 7,
      productDetailAuditLogs: 5,
      commerceMemoryProposals: 3,
      ucpCheckoutSessions: 9,
      discoveryObservations: 5,
    })

    const result = await runRetentionCleanup(queryable, { mode: 'apply', now, policy })

    expect(queryable.deletedTables).toEqual([
      'request_audit_log',
      'search_audit_logs',
      'product_detail_audit_logs',
      'commerce_memory_proposals',
      'ucp_checkout_sessions',
      'target_business_discovery_observations'
    ])
    expect(result.targets.map((target) => [target.table, target.affectedRows])).toEqual([
      ['request_audit_log', 4],
      ['search_audit_logs', 7],
      ['product_detail_audit_logs', 5],
      ['commerce_memory_proposals', 3],
      ['ucp_checkout_sessions', 9],
      ['target_business_discovery_observations', 5],
      ['target_business_state_transitions', 0]
    ])
  })
})
