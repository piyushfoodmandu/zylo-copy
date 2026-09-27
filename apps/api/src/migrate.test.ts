import { readFile } from 'node:fs/promises'
import type { QueryResult, QueryResultRow } from 'pg'
import { describe, expect, it } from 'vitest'
import {
  migrationValidationFailureMessages,
  validateAppliedMigrations,
  type Migration
} from './migrate.ts'

const migrationResult = <T extends QueryResultRow>(rows: T[]): QueryResult<T> => ({
  command: 'SELECT',
  rowCount: rows.length,
  oid: 0,
  fields: [],
  rows
})

class MemoryMigrationQueryable {
  constructor(
    private readonly tableExists: boolean,
    private readonly appliedRows: { name: string; checksum: string }[]
  ) {}

  async query<T extends QueryResultRow = QueryResultRow>(text: string): Promise<QueryResult<T>> {
    if (text.includes("to_regclass('public.schema_migrations')")) {
      return migrationResult([
        { table_name: this.tableExists ? 'schema_migrations' : null } as T
      ])
    }

    if (text.includes('select name, checksum from schema_migrations')) {
      return migrationResult(this.appliedRows as T[])
    }

    throw new Error(`Unexpected migration validation query: ${text}`)
  }
}

const migrations: Migration[] = [
  { name: '001_target_business_matrix.sql', sql: 'select 1', checksum: 'checksum-001' },
  { name: '002_api_keys.sql', sql: 'select 2', checksum: 'checksum-002' }
]

describe('migration validation', () => {
  it('reports every expected migration missing when the migration table is absent', async () => {
    const result = await validateAppliedMigrations(
      new MemoryMigrationQueryable(false, []),
      migrations
    )

    expect(result.ok).toBe(false)
    expect(result.applied).toEqual([])
    expect(result.missing).toEqual([
      '001_target_business_matrix.sql',
      '002_api_keys.sql'
    ])
    expect(migrationValidationFailureMessages(result)).toEqual([
      'missing migration 001_target_business_matrix.sql',
      'missing migration 002_api_keys.sql'
    ])
  })

  it('accepts an applied migration set with matching checksums', async () => {
    const result = await validateAppliedMigrations(
      new MemoryMigrationQueryable(true, [
        { name: '002_api_keys.sql', checksum: 'checksum-002' },
        { name: '001_target_business_matrix.sql', checksum: 'checksum-001' }
      ]),
      migrations
    )

    expect(result).toMatchObject({
      ok: true,
      missing: [],
      unexpected: [],
      checksumMismatches: []
    })
    expect(result.applied).toEqual([
      '001_target_business_matrix.sql',
      '002_api_keys.sql'
    ])
  })

  it('reports missing, unexpected, and checksum-mismatched migrations', async () => {
    const result = await validateAppliedMigrations(
      new MemoryMigrationQueryable(true, [
        { name: '001_target_business_matrix.sql', checksum: 'changed-checksum' },
        { name: '999_removed_experiment.sql', checksum: 'checksum-999' }
      ]),
      migrations
    )

    expect(result.ok).toBe(false)
    expect(result.missing).toEqual(['002_api_keys.sql'])
    expect(result.unexpected).toEqual(['999_removed_experiment.sql'])
    expect(result.checksumMismatches).toEqual([
      {
        name: '001_target_business_matrix.sql',
        expectedChecksum: 'checksum-001',
        appliedChecksum: 'changed-checksum'
      }
    ])
    expect(migrationValidationFailureMessages(result)).toEqual([
      'missing migration 002_api_keys.sql',
      'unexpected applied migration 999_removed_experiment.sql',
      'checksum mismatch for 001_target_business_matrix.sql'
    ])
  })

  it('keeps historical search-route migration immutable and evolves it in a later migration', async () => {
    const initialSearchAuditMigration = await readFile(
      new URL('../../../database/migrations/009_search_audit_logs.sql', import.meta.url),
      'utf8'
    )
    const canonicalSearchRouteMigration = await readFile(
      new URL('../../../database/migrations/051_canonical_search_audit_route.sql', import.meta.url),
      'utf8'
    )

    expect(initialSearchAuditMigration).toContain(
      "route in ('/v1/catalog/search', '/v1/search/universal')"
    )
    expect(canonicalSearchRouteMigration).toContain(
      "where route = '/v1/search/universal'"
    )
    expect(canonicalSearchRouteMigration).toContain(
      "check (route = '/v1/catalog/search')"
    )
  })

  it('keeps durable agent-surface constraints aligned for Hermes Agent', async () => {
    const migration = await readFile(
      new URL('../../../database/migrations/024_agent_surface_constraint_alignment.sql', import.meta.url),
      'utf8'
    )

    expect(migration).toContain('decision_receipts_surface_check')
    expect(migration).toContain('checkout_attempts_surface_check')
    expect(migration).toContain("'hermes_agent'")
    expect(migration).toContain("'read:sanity_check'")
    expect(migration).toContain("'write:complete_checkout'")
  })
})
