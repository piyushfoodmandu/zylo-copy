import { Elysia } from 'elysia'
import { node } from '@elysiajs/node'
import { buildApp } from './app.ts'
import { config, validateRuntimeConfig } from './config.ts'
import { closeRuntimeDatabasePools } from './database.ts'
import { logger } from './logger.ts'
import { assertDatabaseMigrationsCurrent } from './migrate.ts'
import { closeRuntimeRedisClients } from './redis.ts'
import { runtimeRequestLifecycle } from './request-lifecycle.ts'
import { closeRuntimeAutonomousPurchaseWorkers } from './autonomous-purchase-runtime.ts'

const configErrors = validateRuntimeConfig()

if (configErrors.length > 0) {
  logger.fatal({ errors: configErrors }, 'Invalid Arro API runtime configuration')
  process.exit(1)
}

if (config.startupMigrationValidationEnabled) {
  try {
    const result = await assertDatabaseMigrationsCurrent(config.databaseUrl)
    logger.info(
      {
        expectedMigrations: result.expected.length,
        appliedMigrations: result.applied.length
      },
      'Database migration preflight passed'
    )
  } catch (error) {
    logger.fatal({ error }, 'Database migration preflight failed')
    process.exit(1)
  }
}

const app = buildApp(new Elysia({ adapter: node() }))

type ServerHandle = {
  stop: (closeActiveConnections?: boolean) => unknown
}

let serverHandle: ServerHandle | undefined

app.listen(config.port, (server) => {
  serverHandle = server
})

let shuttingDown = false

const shutdown = async (signal: NodeJS.Signals) => {
  if (shuttingDown) return
  shuttingDown = true
  const hardShutdownTimeout = setTimeout(() => {
    logger.error({ signal }, 'Arro API shutdown hard deadline elapsed')
    process.exit(1)
  }, config.shutdownGracePeriodMs + 5_000)

  runtimeRequestLifecycle.startDraining()

  logger.info({
    signal,
    activeRequestCount: runtimeRequestLifecycle.activeRequestCount,
    shutdownGracePeriodMs: config.shutdownGracePeriodMs
  }, 'Arro API shutting down')

  try {
    const stopPromise = serverHandle
      ? Promise.resolve(serverHandle.stop()).catch((error) => {
          logger.error({ error, signal }, 'Arro API server stop failed')
        })
      : app.stop().catch((error) => {
          logger.error({ error, signal }, 'Arro API app stop failed')
        })

    const drainResult = await runtimeRequestLifecycle.waitForDrain(config.shutdownGracePeriodMs)

    logger.info({ signal, drainResult }, 'Arro API request drain finished')

    if (drainResult.outcome === 'completed') {
      await stopPromise
    }

    if (serverHandle) {
      serverHandle = undefined
    }
    await closeRuntimeAutonomousPurchaseWorkers()
    await closeRuntimeRedisClients()
    await closeRuntimeDatabasePools()
    clearTimeout(hardShutdownTimeout)
    logger.info({ signal }, 'Arro API shutdown complete')
    process.exit(0)
  } catch (error) {
    clearTimeout(hardShutdownTimeout)
    logger.error({ error, signal }, 'Arro API shutdown failed')
    process.exit(1)
  }
}

process.once('SIGTERM', () => {
  shutdown('SIGTERM').catch(() => process.exit(1))
})

process.once('SIGINT', () => {
  shutdown('SIGINT').catch(() => process.exit(1))
})

logger.info(
  {
    port: config.port,
    environment: config.environment,
    publicBaseUrl: config.publicBaseUrl
  },
  'Arro API listening'
)
