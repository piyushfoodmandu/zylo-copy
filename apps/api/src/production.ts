import { config, validateRuntimeConfig } from './config.ts'
import { logger } from './logger.ts'
import { runMigrations } from './migrate.ts'
import { runRuntimeRetentionCleanup } from './retention.ts'

const configErrors = validateRuntimeConfig()
if (configErrors.length > 0) {
  logger.fatal({ errors: configErrors }, 'Invalid Arro API runtime configuration')
  process.exit(1)
}

try {
  await runMigrations(config.databaseUrl)
  logger.info('Database migrations applied')
} catch (error) {
  logger.fatal({ error }, 'Database migration failed')
  process.exit(1)
}

// Start listening only after this release's schema is authoritative. The
// migration runner holds a PostgreSQL advisory lock, so simultaneous instance
// starts serialize instead of racing the same migration.
await import('./server.ts')

// Retention is runtime behavior, not a command an operator has to remember.
// Run once after the service is accepting traffic and then every six hours;
// the cleanup queries are idempotent and each run owns a short transaction.
let retentionRunning = false
const cleanExpiredRuntimeData = async () => {
  if (retentionRunning) return
  retentionRunning = true
  try {
    const result = await runRuntimeRetentionCleanup({ mode: 'apply' })
    logger.info({
      affectedRows: result.targets.reduce((total, target) => total + target.affectedRows, 0)
    }, 'Expired runtime data removed')
  } catch (error) {
    logger.error({ error }, 'Runtime retention cleanup failed')
  } finally {
    retentionRunning = false
  }
}

void cleanExpiredRuntimeData()
const retentionTimer = setInterval(() => void cleanExpiredRuntimeData(), 6 * 60 * 60 * 1000)
retentionTimer.unref()
