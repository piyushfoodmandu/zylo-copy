import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} from 'node:crypto'
import type { ApiError } from '@arro/contracts'
import { config } from './config.ts'
import { getRuntimeDatabasePool } from './database.ts'
import type { Queryable } from './target-business-repository.ts'
import { validateShopperSessionToken } from './shopper-session.ts'

export type AuthPrincipal = {
  keyId: string
  ownerPrincipal: string
  scopes: string[]
  environment: string
  expiresAt?: string
  authType?: 'api_key' | 'shopper_session'
}

export type AuthDecision =
  | 'allowed'
  | 'authentication_required'
  | 'invalid_api_key'
  | 'insufficient_scope'
  | 'authentication_unavailable'
  | 'rate_limited'

export type AuthFailureDecision = Exclude<AuthDecision, 'allowed' | 'rate_limited'>

export type AuthenticatedResult = {
  ok: true
  decision: 'allowed'
  principal: AuthPrincipal
}

export type AuthRejectedResult = {
  ok: false
  decision: AuthFailureDecision
  status: 401 | 403 | 503
  principal?: AuthPrincipal
  body: ApiError
}

export type AuthenticationResult = AuthenticatedResult | AuthRejectedResult

export type Authenticator = (options: {
  request: Request
  requestId: string
  requiredScopes: string[]
}) => Promise<AuthenticationResult>

type ApiKeyRow = {
  id: string
  key_hash: string
  owner_principal: string
  scopes: string[]
  environment: string
  expires_at: Date | string | null
  revoked_at: Date | string | null
}

export type CreateApiKeyOptions = {
  ownerPrincipal: string
  scopes: string[]
  environment?: string
  expiresAt?: Date
  metadata?: Record<string, unknown>
  now?: Date
}

export type CreatedApiKey = {
  keyId: string
  plaintextKey: string
  keyHash: string
  ownerPrincipal: string
  scopes: string[]
  environment: string
  expiresAt?: string
  metadata: Record<string, unknown>
}

const keyPrefix = 'arro'
const keyIdBytes = 12
const secretBytes = 32

const apiError = (
  code: string,
  message: string,
  requestId: string
): ApiError => ({
  error: {
    code,
    message,
    requestId
  }
})

const normalizeEnvironment = (environment: string) =>
  environment.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'development'

const normalizeScopes = (scopes: string[]) =>
  [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))]

const toIso = (value: Date | string | null) => {
  if (!value) return undefined

  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

const buildPlaintextKey = ({
  environment,
  keyId,
  secret
}: {
  environment: string
  keyId: string
  secret: string
}) => `${keyPrefix}_${environment}_${keyId}_${secret}`

export const parseApiKey = (value: string) => {
  const parts = value.trim().split('_')
  if (parts.length !== 4) return undefined

  const [prefix, environment, keyId, secret] = parts as [string, string, string, string]
  if (prefix !== keyPrefix) return undefined
  if (!/^[a-z0-9-]{2,32}$/.test(environment)) return undefined
  if (!/^[a-f0-9]{24}$/.test(keyId)) return undefined
  if (!/^[a-f0-9]{64}$/.test(secret)) return undefined

  return { environment, keyId, secret }
}

export const hashApiKeySecret = (secret: string, pepper: string) =>
  createHmac('sha256', pepper).update(secret, 'utf8').digest('hex')

export const compareApiKeyHash = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')

  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export const createApiKey = (
  options: CreateApiKeyOptions,
  pepper = config.apiKeyPepper
): CreatedApiKey => {
  if (!pepper) {
    throw new Error('API_KEY_PEPPER is required to create API keys.')
  }

  const scopes = normalizeScopes(options.scopes)
  if (scopes.length === 0) throw new Error('At least one API key scope is required.')

  const environment = normalizeEnvironment(options.environment ?? config.environment)
  const keyId = randomBytes(keyIdBytes).toString('hex')
  const secret = randomBytes(secretBytes).toString('hex')
  const plaintextKey = buildPlaintextKey({ environment, keyId, secret })
  const expiresAt = options.expiresAt?.toISOString()

  return {
    keyId,
    plaintextKey,
    keyHash: hashApiKeySecret(secret, pepper),
    ownerPrincipal: options.ownerPrincipal,
    scopes,
    environment,
    ...(expiresAt ? { expiresAt } : {}),
    metadata: options.metadata ?? {}
  }
}

export const storeApiKey = async (
  client: Queryable,
  apiKey: CreatedApiKey,
  now = new Date()
) => {
  await client.query(
    `
      insert into api_keys (
        id,
        key_hash,
        owner_principal,
        scopes,
        environment,
        metadata,
        created_at,
        expires_at
      ) values ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      apiKey.keyId,
      apiKey.keyHash,
      apiKey.ownerPrincipal,
      apiKey.scopes,
      apiKey.environment,
      apiKey.metadata,
      now.toISOString(),
      apiKey.expiresAt ?? null
    ]
  )
}

export const hasRequiredScope = (
  principalScopes: string[],
  requiredScopes: string[]
) =>
  requiredScopes.length === 0 ||
  principalScopes.includes('admin:*') ||
  requiredScopes.every((requiredScope) =>
    principalScopes.some((scope) =>
      scope === requiredScope ||
      scope.endsWith(':*') && requiredScope.startsWith(scope.slice(0, -1))
    )
  )

const extractApiKey = (request: Request) => {
  const apiKey = request.headers.get('x-api-key')?.trim()
  if (apiKey) return apiKey

  const authorization = request.headers.get('authorization')?.trim()
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization ?? '')
  return bearerMatch?.[1]?.trim()
}

export const validateApiKey = async ({
  plaintextKey,
  client,
  pepper,
  now = new Date()
}: {
  plaintextKey: string
  client: Queryable
  pepper: string
  now?: Date
}): Promise<AuthPrincipal | undefined> => {
  const parsed = parseApiKey(plaintextKey)
  if (!parsed) return undefined

  const result = await client.query<ApiKeyRow>(
    `
      select id, key_hash, owner_principal, scopes, environment, expires_at, revoked_at
      from api_keys
      where id = $1
      limit 1
    `,
    [parsed.keyId]
  )
  const row = result.rows[0]
  if (!row) return undefined
  if (row.environment !== parsed.environment) return undefined
  if (row.revoked_at) return undefined

  const expiresAt = toIso(row.expires_at)
  if (expiresAt && new Date(expiresAt).getTime() <= now.getTime()) return undefined

  const expectedHash = hashApiKeySecret(parsed.secret, pepper)
  if (!compareApiKeyHash(expectedHash, row.key_hash)) return undefined

  client.query(
    'update api_keys set last_used_at = $1, updated_at = $1 where id = $2',
    [
      now.toISOString(),
      row.id
    ]
  ).catch(() => undefined)

  return {
    keyId: row.id,
    ownerPrincipal: row.owner_principal,
    scopes: row.scopes,
    environment: row.environment,
    ...(expiresAt ? { expiresAt } : {})
  }
}

const shopperCheckoutRouteAllowed = (request: Request) => {
  const { pathname } = new URL(request.url)
  const method = request.method.toUpperCase()

  if (method === 'POST' && pathname === '/v1/purchases/prepare') return true
  if (/^\/v1\/purchases\/[^/]+$/.test(pathname)) return method === 'GET' || method === 'PATCH'
  if (/^\/v1\/purchases\/[^/]+\/review$/.test(pathname)) return method === 'PATCH'
  if (/^\/v1\/purchases\/[^/]+\/(payment-actions|confirm|cancel)$/.test(pathname)) return method === 'POST'

  return false
}

const authenticateApiRequestWithSecret = (
  shopperSessionSigningSecret: string | undefined
): Authenticator => async ({
  request,
  requestId,
  requiredScopes
}) => {
  const plaintextKey = extractApiKey(request)
  const shopperSessionToken = request.headers.get('x-arro-shopper-session')?.trim()

  if (!plaintextKey && shopperSessionToken) {
    if (!shopperSessionSigningSecret) {
      return {
        ok: false,
        decision: 'authentication_unavailable',
        status: 503,
        body: apiError('authentication_unavailable', 'First-party checkout authentication is not configured.', requestId)
      }
    }
    const claims = validateShopperSessionToken({
      token: shopperSessionToken,
      signingSecret: shopperSessionSigningSecret
    })
    if (!claims) {
      return {
        ok: false,
        decision: 'invalid_api_key',
        status: 401,
        body: apiError('invalid_shopper_session', 'The shopper session is invalid or expired.', requestId)
      }
    }
    const principal: AuthPrincipal = {
      keyId: claims.sessionId,
      ownerPrincipal: claims.sessionId,
      scopes: ['read:purchase', 'write:purchase', 'write:complete_purchase'],
      environment: config.environment,
      expiresAt: claims.expiresAt,
      authType: 'shopper_session'
    }
    if (!shopperCheckoutRouteAllowed(request)) {
      return {
        ok: false,
        decision: 'insufficient_scope',
        status: 403,
        principal,
        body: apiError('shopper_route_not_allowed', 'The shopper session is only valid for first-party checkout routes.', requestId)
      }
    }
    if (!hasRequiredScope(principal.scopes, requiredScopes)) {
      return {
        ok: false,
        decision: 'insufficient_scope',
        status: 403,
        principal,
        body: apiError('insufficient_scope', 'The shopper session is not authorized for this endpoint.', requestId)
      }
    }
    return { ok: true, decision: 'allowed', principal }
  }

  if (!plaintextKey) {
    return {
      ok: false,
      decision: 'authentication_required',
      status: 401,
      body: apiError('authentication_required', 'An API key is required for this endpoint.', requestId)
    }
  }

  if (!parseApiKey(plaintextKey)) {
    return {
      ok: false,
      decision: 'invalid_api_key',
      status: 401,
      body: apiError('invalid_api_key', 'The supplied API key is invalid or expired.', requestId)
    }
  }

  if (!config.databaseUrl || !config.apiKeyPepper) {
    return {
      ok: false,
      decision: 'authentication_unavailable',
      status: 503,
      body: apiError('authentication_unavailable', 'API key authentication is not configured.', requestId)
    }
  }

  const principal = await validateApiKey({
    plaintextKey,
    client: getRuntimeDatabasePool(config.databaseUrl),
    pepper: config.apiKeyPepper
  })

  if (!principal) {
    return {
      ok: false,
      decision: 'invalid_api_key',
      status: 401,
      body: apiError('invalid_api_key', 'The supplied API key is invalid or expired.', requestId)
    }
  }

  if (!hasRequiredScope(principal.scopes, requiredScopes)) {
    return {
      ok: false,
      decision: 'insufficient_scope',
      status: 403,
      principal,
      body: apiError('insufficient_scope', 'The API key is not authorized for this endpoint.', requestId)
    }
  }

  return { ok: true, decision: 'allowed', principal }
}


export const createApiRequestAuthenticator = (
  shopperSessionSigningSecret = config.agentSessionSigningSecret
): Authenticator => authenticateApiRequestWithSecret(shopperSessionSigningSecret)

export const authenticateApiRequest: Authenticator = createApiRequestAuthenticator()
