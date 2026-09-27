import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client, type QueryResult, type QueryResultRow } from 'pg'
import { resolveDatabaseUrlFromEnv } from './runtime-secrets.ts'

export type Migration = {
  name: string
  sql: string
  checksum: string
}

type MigrationQueryable = {
  query: <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[]
  ) => Promise<QueryResult<T>>
}

export type MigrationChecksumMismatch = {
  name: string
  expectedChecksum: string
  appliedChecksum: string
}

export type MigrationValidationResult = {
  ok: boolean
  expected: string[]
  applied: string[]
  missing: string[]
  unexpected: string[]
  checksumMismatches: MigrationChecksumMismatch[]
}

const defaultMigrationsDirectory = fileURLToPath(
  new URL('../../../database/migrations', import.meta.url)
)

const configuredMigrationsDirectory = process.env.MIGRATIONS_DIR?.trim()
const migrationsDirectory = configuredMigrationsDirectory
  ? resolve(configuredMigrationsDirectory)
  : defaultMigrationsDirectory

const databaseUrlFromEnvironment = () => resolveDatabaseUrlFromEnv(process.env)

const databaseCheckTimeoutMs = () => {
  const parsed = Number.parseInt(process.env.DEPENDENCY_CHECK_TIMEOUT_MS ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1_500
}

const migrationTimeoutMs = () => {
  const configured = Number.parseInt(process.env.POSTGRES_STATEMENT_TIMEOUT_MS ?? '', 10)
  if (Number.isFinite(configured) && configured > 0) return configured
  return Math.max(30_000, databaseCheckTimeoutMs() * 20)
}

export const readMigrations = async (directory = migrationsDirectory): Promise<Migration[]> => {
  const names = (await readdir(directory))
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right))

  return Promise.all(
    names.map(async (name) => {
      const sql = await readFile(resolve(directory, name), 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')

      return { name, sql, checksum }
    })
  )
}

const ensureMigrationTable = async (client: Client) => {
  await client.query(`
    create table if not exists schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )
  `)
}

const appliedMigrationChecksums = async (client: MigrationQueryable) => {
  const result = await client.query<{ name: string; checksum: string }>(
    'select name, checksum from schema_migrations'
  )

  return new Map(result.rows.map((row) => [row.name, row.checksum]))
}

const schemaMigrationsTableExists = async (client: MigrationQueryable) => {
  const result = await client.query<{ table_name: string | null }>(
    "select to_regclass('public.schema_migrations')::text as table_name"
  )

  return Boolean(result.rows[0]?.table_name)
}

export const validateAppliedMigrations = async (
  client: MigrationQueryable,
  migrations?: Migration[]
): Promise<MigrationValidationResult> => {
  const expectedMigrations = migrations ?? await readMigrations()
  const expectedByName = new Map(
    expectedMigrations.map((migration) => [migration.name, migration])
  )
  const applied = await schemaMigrationsTableExists(client)
    ? await appliedMigrationChecksums(client)
    : new Map<string, string>()

  const expected = expectedMigrations.map((migration) => migration.name)
  const appliedNames = [...applied.keys()].sort((left, right) => left.localeCompare(right))
  const missing = expected.filter((name) => !applied.has(name))
  const unexpected = appliedNames.filter((name) => !expectedByName.has(name))
  const checksumMismatches = expectedMigrations.flatMap((migration) => {
    const appliedChecksum = applied.get(migration.name)
    if (!appliedChecksum || appliedChecksum === migration.checksum) return []

    return [{
      name: migration.name,
      expectedChecksum: migration.checksum,
      appliedChecksum
    }]
  })

  return {
    ok: missing.length === 0 && unexpected.length === 0 && checksumMismatches.length === 0,
    expected,
    applied: appliedNames,
    missing,
    unexpected,
    checksumMismatches
  }
}

export const migrationValidationFailureMessages = (
  result: MigrationValidationResult
) => [
  ...result.missing.map((name) => `missing migration ${name}`),
  ...result.unexpected.map((name) => `unexpected applied migration ${name}`),
  ...result.checksumMismatches.map(
    (mismatch) => `checksum mismatch for ${mismatch.name}`
  )
]

export const assertDatabaseMigrationsCurrent = async (
  databaseUrl = databaseUrlFromEnvironment()
) => {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to validate database migrations.')
  }

  const timeoutMs = databaseCheckTimeoutMs()
  const client = new Client({
    connectionString: databaseUrl,
    connectionTimeoutMillis: timeoutMs,
    statement_timeout: timeoutMs
  })

  await client.connect()

  try {
    const result = await validateAppliedMigrations(client)

    if (!result.ok) {
      throw new Error(
        `Database migrations are not current: ${migrationValidationFailureMessages(result).join('; ')}`
      )
    }

    return result
  } finally {
    await client.end()
  }
}

export const runMigrations = async (databaseUrl = databaseUrlFromEnvironment()) => {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to run database migrations.')
  }

  const migrations = await readMigrations()
  const timeoutMs = migrationTimeoutMs()
  const client = new Client({
    connectionString: databaseUrl,
    application_name: 'arro-migrations',
    connectionTimeoutMillis: Math.min(timeoutMs, 15_000),
    statement_timeout: timeoutMs,
    lock_timeout: timeoutMs
  })

  await client.connect()

  try {
    await client.query('begin')
    await client.query('select pg_advisory_xact_lock(984395201)')
    await ensureMigrationTable(client)

    const applied = await appliedMigrationChecksums(client)

    for (const migration of migrations) {
      const appliedChecksum = applied.get(migration.name)

      if (appliedChecksum === migration.checksum) continue

      if (appliedChecksum) {
        throw new Error(`Migration checksum changed after apply: ${migration.name}`)
      }

      await client.query(migration.sql)
      await client.query(
        'insert into schema_migrations (name, checksum) values ($1, $2)',
        [migration.name, migration.checksum]
      )
      console.info(`Applied database migration: ${migration.name}`)
    }

    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    await client.end()
  }
}

const entrypoint = process.argv[1] ? resolve(process.argv[1]) : undefined

if (entrypoint === fileURLToPath(import.meta.url)) {
  await runMigrations()
}
