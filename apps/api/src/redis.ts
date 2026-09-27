import { createClient } from 'redis'
import { config } from './config.ts'
import { logger } from './logger.ts'

const reconnectStrategy = (retries: number) => {
  const backoffMs = Math.min(Math.max(retries, 1) * 100, 5_000)
  const jitterMs = Math.floor(Math.random() * Math.min(backoffMs, 250))
  return backoffMs + jitterMs
}

const createRuntimeRedisClient = (redisUrl: string) => {
  const client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout: config.dependencyCheckTimeoutMs,
      reconnectStrategy
    }
  })

  client.on('error', (error) => {
    logger.warn({ error }, 'Runtime Redis client error')
  })

  return client
}

export type RuntimeRedisClient = ReturnType<typeof createRuntimeRedisClient>

const runtimeRedisClients = new Map<string, RuntimeRedisClient>()

export const getRuntimeRedisClient = async (redisUrl = config.redisUrl) => {
  if (!redisUrl) {
    throw new Error('REDIS_URL is required for runtime Redis access.')
  }

  const existingClient = runtimeRedisClients.get(redisUrl)
  if (existingClient) {
    if (!existingClient.isOpen) await existingClient.connect()
    return existingClient
  }

  const client = createRuntimeRedisClient(redisUrl)
  runtimeRedisClients.set(redisUrl, client)
  await client.connect()
  return client
}

export const pingRuntimeRedis = async (redisUrl = config.redisUrl) => {
  const client = await getRuntimeRedisClient(redisUrl)
  return client.ping()
}

export const closeRuntimeRedisClients = async () => {
  const clients = [...runtimeRedisClients.values()]
  runtimeRedisClients.clear()

  await Promise.all(
    clients.map(async (client) => {
      if (!client.isOpen) return
      await client.quit().catch(() => client.disconnect())
    })
  )
}
