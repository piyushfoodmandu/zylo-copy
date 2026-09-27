import { afterEach, describe, expect, it } from 'vitest'
import {
  closeRuntimeDatabasePools,
  createDatabasePool,
  getRuntimeDatabasePool
} from './database.ts'

describe('runtime database pool', () => {
  afterEach(async () => {
    await closeRuntimeDatabasePools()
  })

  it('reuses a bounded runtime pool per database URL', () => {
    const databaseUrl = 'postgresql://arro:secret@localhost:5433/arro'

    const firstPool = getRuntimeDatabasePool(databaseUrl)
    const secondPool = getRuntimeDatabasePool(databaseUrl)

    expect(secondPool).toBe(firstPool)
    expect(firstPool.options.max).toBeGreaterThan(0)
  })

  it('sets a runtime statement timeout on Postgres pools', async () => {
    const pool = createDatabasePool('postgresql://arro:secret@localhost:5433/arro')

    try {
      expect((pool.options as Record<string, unknown>).statement_timeout).toBe(30_000)
    } finally {
      await pool.end()
    }
  })

  it('keeps pools isolated for different database URLs', () => {
    const firstPool = getRuntimeDatabasePool('postgresql://arro:secret@localhost:5433/arro')
    const secondPool = getRuntimeDatabasePool('postgresql://arro:secret@localhost:5434/arro')

    expect(secondPool).not.toBe(firstPool)
  })

  it('fails explicitly when no runtime database URL is configured', () => {
    expect(() => getRuntimeDatabasePool(undefined)).toThrow(
      'DATABASE_URL is required for runtime database access.'
    )
  })

})
