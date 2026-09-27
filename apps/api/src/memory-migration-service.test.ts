import type { QueryResult, QueryResultRow } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { hashCommerceMemoryScopeRef } from './memory-proposal-service.ts'
import { storeCommerceMemoryMigrationImport } from './memory-migration-service.ts'
import type { Queryable } from './target-business-repository.ts'

const timestamp = '2026-06-01T00:00:00.000Z'
const hashPepper = 'memory-migration-test-pepper-32-chars'
const externalSubjectRef = 'opaque-user-ref-1'
const externalTaskRef = 'opaque-task-ref-1'
const sourceRecordRef = 'external-memory-record-1'

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

class MemoryMigrationQueryable implements Queryable {
  readonly query = vi.fn(async <Row extends QueryResultRow>(
    text: string,
    values?: unknown[]
  ): Promise<QueryResult<Row>> => {
    this.calls.push({ text, values })

    if (['begin', 'commit', 'rollback'].includes(text)) {
      return queryResult([], 0)
    }

    if (text.includes('from commerce_memory_migration_imports')) {
      return queryResult(
        this.duplicateImport ? [{ import_id: 'existing-import' } as Row] : [],
        this.duplicateImport ? 1 : 0
      )
    }

    if (text.includes('insert into commerce_memory_proposals')) {
      return queryResult(
        this.proposalInsertRowCount > 0
          ? [{ proposal_id: 'memory-proposal-migration-1' } as Row]
          : [],
        this.proposalInsertRowCount
      )
    }

    if (text.includes('insert into commerce_memory_migration_imports')) {
      return queryResult(
        this.importInsertRowCount > 0
          ? [{ import_id: 'memory-migration-import-1' } as Row]
          : [],
        this.importInsertRowCount
      )
    }

    throw new Error(`Unexpected query: ${text}`)
  })

  readonly calls: Array<{ text: string; values?: unknown[] }> = []

  constructor(
    private readonly options: {
      duplicateImport?: boolean
      proposalInsertRowCount?: number
      importInsertRowCount?: number
    } = {}
  ) {}

  private get duplicateImport() {
    return this.options.duplicateImport ?? false
  }

  private get proposalInsertRowCount() {
    return this.options.proposalInsertRowCount ?? 1
  }

  private get importInsertRowCount() {
    return this.options.importInsertRowCount ?? 1
  }
}

const migrationImport = {
  importId: 'memory-migration-import-1',
  adapter: {
    adapterId: 'external-memory-adapter-1',
    sourceKind: 'external_memory_provider',
    sourceSystem: 'Example Memory',
    sourceRecordRef
  },
  importedAt: timestamp,
  proposal: {
    proposalId: 'memory-proposal-migration-1',
    scope: {
      integrationId: 'chatgpt-demo',
      externalSubjectRef,
      externalTaskRef
    },
    provenance: {
      kind: 'typed_migration',
      adapterId: 'external-memory-adapter-1',
      sourceRecordRef
    },
    consent: {
      userAuthorized: true,
      basis: 'typed_migration_authorization',
      grantedAt: timestamp
    },
    retentionClass: 'user_controlled',
    promptExposureClass: 'summary_only',
    mutationReason: 'User authorized migration of typed commerce memory from an external provider.',
    proposedAt: timestamp,
    recordKind: 'currency',
    value: {
      currency: 'USD'
    }
  }
} as const

const issueCodes = (result: Awaited<ReturnType<typeof storeCommerceMemoryMigrationImport>>) =>
  result.imported ? [] : result.issues.map((issue) => issue.code)

describe('commerce memory migration import service', () => {
  it('queues valid typed migration imports through durable proposal storage and sanitized import metadata', async () => {
    const client = new MemoryMigrationQueryable()
    const result = await storeCommerceMemoryMigrationImport({
      transactionClient: client,
      migrationImport,
      hashPepper,
      recordedAt: new Date('2026-06-01T00:01:00.000Z')
    })

    expect(result).toMatchObject({
      imported: true,
      entry: {
        importId: 'memory-migration-import-1',
        proposalId: 'memory-proposal-migration-1',
        importStatus: 'queued_for_policy_review',
        adapter: {
          adapterId: 'external-memory-adapter-1',
          sourceKind: 'external_memory_provider',
          sourceSystem: 'Example Memory'
        },
        recordKind: 'currency',
        scope: {
          integrationId: 'chatgpt-demo',
          hasExternalSubjectRef: true,
          hasExternalTaskRef: true
        }
      }
    })

    const proposalInsert = client.calls.find((call) =>
      call.text.includes('insert into commerce_memory_proposals')
    )
    const importInsert = client.calls.find((call) =>
      call.text.includes('insert into commerce_memory_migration_imports')
    )
    expect(proposalInsert?.values?.[3]).toBe(
      hashCommerceMemoryScopeRef(externalSubjectRef, hashPepper)
    )
    expect(proposalInsert?.values?.[4]).toBe(
      hashCommerceMemoryScopeRef(externalTaskRef, hashPepper)
    )
    expect(importInsert?.values?.[1]).toBe('queued_for_policy_review')
    expect(importInsert?.values?.[7]).toBe(
      hashCommerceMemoryScopeRef(sourceRecordRef, hashPepper)
    )
    expect(importInsert?.values?.[9]).toBe(
      hashCommerceMemoryScopeRef(externalSubjectRef, hashPepper)
    )
    expect(importInsert?.values?.[10]).toBe(
      hashCommerceMemoryScopeRef(externalTaskRef, hashPepper)
    )

    const serializedResult = JSON.stringify(result)
    const serializedWrites = JSON.stringify(client.calls.map((call) => call.values))
    expect(client.calls[0]?.text).toBe('begin')
    expect(client.calls.at(-1)?.text).toBe('commit')
    expect(serializedResult).not.toContain(sourceRecordRef)
    expect(serializedWrites).not.toContain(externalSubjectRef)
    expect(serializedWrites).not.toContain(externalTaskRef)
    expect(serializedWrites).not.toContain(sourceRecordRef)
  })

  it('rejects invalid external memory imports before touching durable storage', async () => {
    const client = new MemoryMigrationQueryable()
    const result = await storeCommerceMemoryMigrationImport({
      transactionClient: client,
      migrationImport: {
        ...migrationImport,
        proposal: {
          ...migrationImport.proposal,
          value: {
            currency: 'USD',
            rawAudio: 'base64-audio-should-not-enter-memory'
          }
        }
      },
      hashPepper
    })

    expect(result.imported).toBe(false)
    expect(issueCodes(result)).toEqual(expect.arrayContaining([
      'forbidden_field',
      'schema_invalid'
    ]))
    expect(client.query).not.toHaveBeenCalled()
  })

  it('rejects duplicate migration imports before queuing another proposal', async () => {
    const client = new MemoryMigrationQueryable({ duplicateImport: true })
    const result = await storeCommerceMemoryMigrationImport({
      transactionClient: client,
      migrationImport,
      hashPepper
    })

    expect(result.imported).toBe(false)
    expect(issueCodes(result)).toEqual(['duplicate_import'])
    expect(client.calls).toHaveLength(3)
    expect(client.calls[0]?.text).toBe('begin')
    expect(client.calls[1]?.text).toContain('from commerce_memory_migration_imports')
    expect(client.calls.at(-1)?.text).toBe('rollback')
  })

  it('records rejected import metadata when proposal queueing fails', async () => {
    const client = new MemoryMigrationQueryable({ proposalInsertRowCount: 0 })
    const result = await storeCommerceMemoryMigrationImport({
      transactionClient: client,
      migrationImport,
      hashPepper,
      recordedAt: new Date('2026-06-01T00:01:00.000Z')
    })

    expect(result.imported).toBe(false)
    expect(issueCodes(result)).toEqual(['duplicate_proposal'])

    const importInsert = client.calls.find((call) =>
      call.text.includes('insert into commerce_memory_migration_imports')
    )
    expect(importInsert?.values?.[1]).toBe('rejected')
    expect(importInsert?.values?.[3]).toBeNull()
    expect(JSON.parse(importInsert?.values?.[15] as string)).toEqual([
      expect.objectContaining({ code: 'duplicate_proposal' })
    ])
    expect(client.calls[0]?.text).toBe('begin')
    expect(client.calls.at(-1)?.text).toBe('commit')
  })

  it('rolls back when import metadata is not recorded after queuing a proposal', async () => {
    const client = new MemoryMigrationQueryable({ importInsertRowCount: 0 })
    const result = await storeCommerceMemoryMigrationImport({
      transactionClient: client,
      migrationImport,
      hashPepper
    })

    expect(result.imported).toBe(false)
    expect(issueCodes(result)).toEqual(['import_record_not_stored'])
    expect(client.calls[0]?.text).toBe('begin')
    expect(client.calls.at(-1)?.text).toBe('rollback')
  })
})
