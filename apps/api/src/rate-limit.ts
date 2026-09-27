import type { ApiError } from '@arro/contracts'
import type { AuthPrincipal } from './auth.ts'
import { config } from './config.ts'
import { getRuntimeRedisClient } from './redis.ts'

export type RateLimitFailureMode = 'open' | 'closed'

export type RateLimitPolicy = {
  routeGroup: string
  maxRequests: number
  windowSeconds: number
}

export type RateLimitAllowed = {
  allowed: true
  limit: number
  remaining: number
  resetAt: string
}

export type RateLimitRejected = {
  allowed: false
  status: 429 | 503
  reasonCode: 'rate_limit_exceeded' | 'rate_limit_unavailable'
  retryAfterSeconds: number
  limit: number
  remaining: number
  resetAt: string
  body: ApiError
}

export type RateLimitResult = RateLimitAllowed | RateLimitRejected

export type RedisRateLimitClient = {
  incr(key: string): Promise<number>
  expire(key: string, seconds: number): Promise<unknown>
}

export type ProtectedRateLimiter = (options: {
  request: Request
  requestId: string
  principal: AuthPrincipal
  policy: RateLimitPolicy
  now?: Date
}) => Promise<RateLimitResult>

export type PublicRateLimiter = (options: {
  request: Request
  requestId: string
  identityKey: string
  policy: RateLimitPolicy
  now?: Date
}) => Promise<RateLimitResult>

const apiError = (
  code: RateLimitRejected['reasonCode'],
  message: string,
  requestId: string
): ApiError => ({
  error: {
    code,
    message,
    requestId
  }
})

const bucketFor = (now: Date, windowSeconds: number) =>
  Math.floor(now.getTime() / (windowSeconds * 1000))

const resetAtFor = (bucket: number, windowSeconds: number) =>
  new Date((bucket + 1) * windowSeconds * 1000)

const rateLimitKey = ({
  routeGroup,
  principal,
  bucket
}: {
  routeGroup: string
  principal: AuthPrincipal
  bucket: number
}) => `arro:rate-limit:${routeGroup}:key:${principal.keyId}:${bucket}`

const publicRateLimitKey = ({
  routeGroup,
  identityKey,
  bucket
}: {
  routeGroup: string
  identityKey: string
  bucket: number
}) => `arro:rate-limit:${routeGroup}:public:${identityKey}:${bucket}`

const withRedisOperationTimeout = async <T>(
  label: string,
  operation: () => Promise<T>,
  timeoutMs: number
): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined

  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export const checkFixedWindowRateLimit = async ({
  client,
  policy,
  principal,
  requestId,
  now = new Date(),
  operationTimeoutMs = config.dependencyCheckTimeoutMs
}: {
  client: RedisRateLimitClient
  policy: RateLimitPolicy
  principal: AuthPrincipal
  requestId: string
  now?: Date
  operationTimeoutMs?: number
}): Promise<RateLimitResult> => {
  const bucket = bucketFor(now, policy.windowSeconds)
  const resetAt = resetAtFor(bucket, policy.windowSeconds)
  const key = rateLimitKey({ routeGroup: policy.routeGroup, principal, bucket })
  const count = await withRedisOperationTimeout(
    'Rate-limit counter increment',
    () => client.incr(key),
    operationTimeoutMs
  )

  if (count === 1) {
    await withRedisOperationTimeout(
      'Rate-limit counter expiry',
      () => client.expire(key, policy.windowSeconds * 2),
      operationTimeoutMs
    )
  }

  const remaining = Math.max(policy.maxRequests - count, 0)

  if (count <= policy.maxRequests) {
    return {
      allowed: true,
      limit: policy.maxRequests,
      remaining,
      resetAt: resetAt.toISOString()
    }
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((resetAt.getTime() - now.getTime()) / 1000)
  )

  return {
    allowed: false,
    status: 429,
    reasonCode: 'rate_limit_exceeded',
    retryAfterSeconds,
    limit: policy.maxRequests,
    remaining: 0,
    resetAt: resetAt.toISOString(),
    body: apiError(
      'rate_limit_exceeded',
      'Too many requests for this endpoint. Retry after the indicated interval.',
      requestId
    )
  }
}

export const createProtectedRateLimiter = ({
  enabled = config.rateLimitEnabled,
  failureMode = config.rateLimitFailureMode,
  getClient = getRuntimeRedisClient,
  operationTimeoutMs = config.dependencyCheckTimeoutMs
}: {
  enabled?: boolean
  failureMode?: RateLimitFailureMode
  getClient?: () => Promise<RedisRateLimitClient>
  operationTimeoutMs?: number
} = {}): ProtectedRateLimiter => async ({ requestId, principal, policy, now }) => {
  if (!enabled) {
    return {
      allowed: true,
      limit: policy.maxRequests,
      remaining: policy.maxRequests,
      resetAt: new Date((now ?? new Date()).getTime() + policy.windowSeconds * 1000).toISOString()
    }
  }

  try {
    const client = await withRedisOperationTimeout(
      'Rate-limit Redis connection',
      getClient,
      operationTimeoutMs
    )
    const result = await checkFixedWindowRateLimit({
      client,
      policy,
      principal,
      requestId,
      operationTimeoutMs,
      ...(now ? { now } : {})
    })
    return result
  } catch {
    if (failureMode === 'open') {
      return {
        allowed: true,
        limit: policy.maxRequests,
        remaining: policy.maxRequests,
        resetAt: new Date((now ?? new Date()).getTime() + policy.windowSeconds * 1000).toISOString()
      }
    }

    return {
      allowed: false,
      status: 503,
      reasonCode: 'rate_limit_unavailable',
      retryAfterSeconds: 30,
      limit: policy.maxRequests,
      remaining: 0,
      resetAt: new Date((now ?? new Date()).getTime() + 30_000).toISOString(),
      body: apiError(
        'rate_limit_unavailable',
        'Request quota enforcement is temporarily unavailable.',
        requestId
      )
    }
  }
}

export const createPublicRateLimiter = ({
  enabled = config.rateLimitEnabled,
  failureMode = config.rateLimitFailureMode,
  getClient = getRuntimeRedisClient,
  operationTimeoutMs = config.dependencyCheckTimeoutMs
}: {
  enabled?: boolean
  failureMode?: RateLimitFailureMode
  getClient?: () => Promise<RedisRateLimitClient>
  operationTimeoutMs?: number
} = {}): PublicRateLimiter => async ({ requestId, identityKey, policy, now }) => {
  if (!enabled) {
    return {
      allowed: true,
      limit: policy.maxRequests,
      remaining: policy.maxRequests,
      resetAt: new Date((now ?? new Date()).getTime() + policy.windowSeconds * 1000).toISOString()
    }
  }

  try {
    const currentTime = now ?? new Date()
    const bucket = bucketFor(currentTime, policy.windowSeconds)
    const resetAt = resetAtFor(bucket, policy.windowSeconds)
    const client = await withRedisOperationTimeout(
      'Rate-limit Redis connection',
      getClient,
      operationTimeoutMs
    )
    const key = publicRateLimitKey({ routeGroup: policy.routeGroup, identityKey, bucket })
    const count = await withRedisOperationTimeout(
      'Public rate-limit counter increment',
      () => client.incr(key),
      operationTimeoutMs
    )

    if (count === 1) {
      await withRedisOperationTimeout(
        'Public rate-limit counter expiry',
        () => client.expire(key, policy.windowSeconds * 2),
        operationTimeoutMs
      )
    }

    const remaining = Math.max(policy.maxRequests - count, 0)
    if (count <= policy.maxRequests) {
      return {
        allowed: true,
        limit: policy.maxRequests,
        remaining,
        resetAt: resetAt.toISOString()
      }
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((resetAt.getTime() - currentTime.getTime()) / 1000)
    )

    return {
      allowed: false,
      status: 429,
      reasonCode: 'rate_limit_exceeded',
      retryAfterSeconds,
      limit: policy.maxRequests,
      remaining: 0,
      resetAt: resetAt.toISOString(),
      body: apiError(
        'rate_limit_exceeded',
        'Too many requests for this endpoint. Retry after the indicated interval.',
        requestId
      )
    }
  } catch {
    if (failureMode === 'open') {
      return {
        allowed: true,
        limit: policy.maxRequests,
        remaining: policy.maxRequests,
        resetAt: new Date((now ?? new Date()).getTime() + policy.windowSeconds * 1000).toISOString()
      }
    }

    return {
      allowed: false,
      status: 503,
      reasonCode: 'rate_limit_unavailable',
      retryAfterSeconds: 30,
      limit: policy.maxRequests,
      remaining: 0,
      resetAt: new Date((now ?? new Date()).getTime() + 30_000).toISOString(),
      body: apiError(
        'rate_limit_unavailable',
        'Request quota enforcement is temporarily unavailable.',
        requestId
      )
    }
  }
}

export const ucpDiscoveryRateLimitPolicy = (): RateLimitPolicy => ({
  routeGroup: 'ucp_discovery',
  maxRequests: config.rateLimitUcpDiscoveryMax,
  windowSeconds: config.rateLimitWindowSeconds
})

export const agentSessionRateLimitPolicy = (): RateLimitPolicy => ({
  routeGroup: 'agent_session',
  maxRequests: config.rateLimitAgentSessionMax,
  windowSeconds: config.rateLimitWindowSeconds
})
