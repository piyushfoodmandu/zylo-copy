import { describe, expect, it } from 'vitest'
import type { AuthPrincipal } from './auth.ts'
import {
  checkFixedWindowRateLimit,
  createProtectedRateLimiter,
  type RedisRateLimitClient
} from './rate-limit.ts'

class MemoryRedisRateLimitClient implements RedisRateLimitClient {
  readonly values = new Map<string, number>()
  readonly expirations = new Map<string, number>()

  async incr(key: string) {
    const nextValue = (this.values.get(key) ?? 0) + 1
    this.values.set(key, nextValue)
    return nextValue
  }

  async expire(key: string, seconds: number) {
    this.expirations.set(key, seconds)
    return true
  }
}

const principal: AuthPrincipal = {
  keyId: 'principal-key',
  ownerPrincipal: 'rate-limit-test',
  scopes: ['discovery:write'],
  environment: 'test'
}

const policy = {
  routeGroup: 'ucp_discovery',
  maxRequests: 2,
  windowSeconds: 60
}

describe('fixed-window rate limiting', () => {
  it('allows requests up to the policy limit and rejects the next request', async () => {
    const client = new MemoryRedisRateLimitClient()
    const now = new Date('2025-01-01T00:00:00.000Z')

    const first = await checkFixedWindowRateLimit({ client, policy, principal, requestId: 'req-1', now })
    const second = await checkFixedWindowRateLimit({ client, policy, principal, requestId: 'req-2', now })
    const third = await checkFixedWindowRateLimit({ client, policy, principal, requestId: 'req-3', now })

    expect(first).toMatchObject({ allowed: true, remaining: 1, limit: 2 })
    expect(second).toMatchObject({ allowed: true, remaining: 0, limit: 2 })
    expect(third).toMatchObject({
      allowed: false,
      status: 429,
      reasonCode: 'rate_limit_exceeded',
      retryAfterSeconds: 60
    })
    expect([...client.expirations.values()]).toEqual([120])
  })

  it('opens a new counter when the fixed window rolls over', async () => {
    const client = new MemoryRedisRateLimitClient()
    const firstWindow = new Date('2025-01-01T00:00:59.000Z')
    const secondWindow = new Date('2025-01-01T00:01:00.000Z')

    await checkFixedWindowRateLimit({ client, policy, principal, requestId: 'req-1', now: firstWindow })
    await checkFixedWindowRateLimit({ client, policy, principal, requestId: 'req-2', now: firstWindow })
    const rollover = await checkFixedWindowRateLimit({ client, policy, principal, requestId: 'req-3', now: secondWindow })

    expect(rollover).toMatchObject({ allowed: true, remaining: 1 })
    expect(client.values.size).toBe(2)
  })

  it('fails open only when configured to do so', async () => {
    const openLimiter = createProtectedRateLimiter({
      enabled: true,
      failureMode: 'open',
      getClient: async () => {
        throw new Error('redis unavailable')
      }
    })
    const closedLimiter = createProtectedRateLimiter({
      enabled: true,
      failureMode: 'closed',
      getClient: async () => {
        throw new Error('redis unavailable')
      }
    })

    const request = new Request('http://localhost/v1/ucp/discover')
    const openResult = await openLimiter({ request, requestId: 'req-open', principal, policy })
    const closedResult = await closedLimiter({ request, requestId: 'req-closed', principal, policy })

    expect(openResult.allowed).toBe(true)
    expect(closedResult).toMatchObject({
      allowed: false,
      status: 503,
      reasonCode: 'rate_limit_unavailable'
    })
  })
})