import { describe, expect, it, vi } from 'vitest'
import type { QueryResult, QueryResultRow } from 'pg'
import {
  authenticateApiRequest,
  compareApiKeyHash,
  createApiKey,
  createApiRequestAuthenticator,
  hasRequiredScope,
  hashApiKeySecret,
  parseApiKey,
  storeApiKey,
  validateApiKey
} from './auth.ts'
import type { Queryable } from './target-business-repository.ts'
import { issueShopperSessionToken } from './shopper-session.ts'

const pepper = 'test-api-key-pepper-with-at-least-32-characters'

const queryResult = <Row extends QueryResultRow>(rows: Row[], rowCount = rows.length) => ({
  command: 'SELECT',
  fields: [],
  oid: 0,
  rowCount,
  rows
}) satisfies QueryResult<Row>

const queryableFromResults = (results: QueryResult[]) => {
  const pendingResults = [...results]

  return {
    query: vi.fn(async <Row extends QueryResultRow>(sql: string, values?: unknown[]) => {
      const result = pendingResults.shift()
      if (!result) throw new Error(`Unexpected auth query: ${sql}`)

      return result as QueryResult<Row>
    })
  } satisfies Queryable
}

describe('API key authentication', () => {
  it('creates parseable high-entropy API keys without storing plaintext', () => {
    const apiKey = createApiKey({ ownerPrincipal: 'test-suite', scopes: ['discovery:write'] }, pepper)
    const parsed = parseApiKey(apiKey.plaintextKey)

    expect(parsed?.keyId).toBe(apiKey.keyId)
    expect(apiKey.keyHash).toHaveLength(64)
    expect(apiKey.keyHash).not.toContain(apiKey.plaintextKey)
    expect(compareApiKeyHash(apiKey.keyHash, hashApiKeySecret(parsed!.secret, pepper))).toBe(true)
  })

  it('validates active keys and updates last-used metadata', async () => {
    const now = new Date('2026-05-31T12:00:00.000Z')
    const apiKey = createApiKey({ ownerPrincipal: 'verifier', scopes: ['discovery:write'] }, pepper)
    const queryable = queryableFromResults([
      queryResult([
        {
          id: apiKey.keyId,
          key_hash: apiKey.keyHash,
          owner_principal: apiKey.ownerPrincipal,
          scopes: apiKey.scopes,
          environment: apiKey.environment,
          expires_at: null,
          revoked_at: null
        }
      ]),
      queryResult([], 1)
    ])

    const principal = await validateApiKey({
      plaintextKey: apiKey.plaintextKey,
      client: queryable,
      pepper,
      now
    })

    expect(principal).toMatchObject({
      keyId: apiKey.keyId,
      ownerPrincipal: 'verifier',
      scopes: ['discovery:write']
    })
    const [touchSql, touchValues] = queryable.query.mock.calls.at(-1)!
    expect(touchSql).toContain('update api_keys set last_used_at = $1, updated_at = $1 where id = $2')
    expect(touchValues).toEqual([now.toISOString(), apiKey.keyId])
  })

  it('rejects malformed, revoked, expired, and wrong-secret keys', async () => {
    const apiKey = createApiKey({ ownerPrincipal: 'verifier', scopes: ['discovery:write'] }, pepper)

    await expect(validateApiKey({
      plaintextKey: 'not-a-arro-key',
      client: queryableFromResults([]),
      pepper
    })).resolves.toBeUndefined()

    await expect(validateApiKey({
      plaintextKey: apiKey.plaintextKey,
      client: queryableFromResults([
        queryResult([
          {
            id: apiKey.keyId,
            key_hash: apiKey.keyHash,
            owner_principal: apiKey.ownerPrincipal,
            scopes: apiKey.scopes,
            environment: apiKey.environment,
            expires_at: null,
            revoked_at: '2026-05-31T00:00:00.000Z'
          }
        ])
      ]),
      pepper
    })).resolves.toBeUndefined()

    await expect(validateApiKey({
      plaintextKey: apiKey.plaintextKey,
      client: queryableFromResults([
        queryResult([
          {
            id: apiKey.keyId,
            key_hash: apiKey.keyHash,
            owner_principal: apiKey.ownerPrincipal,
            scopes: apiKey.scopes,
            environment: apiKey.environment,
            expires_at: '2026-05-30T00:00:00.000Z',
            revoked_at: null
          }
        ])
      ]),
      pepper,
      now: new Date('2026-05-31T00:00:00.000Z')
    })).resolves.toBeUndefined()

    await expect(validateApiKey({
      plaintextKey: apiKey.plaintextKey,
      client: queryableFromResults([
        queryResult([
          {
            id: apiKey.keyId,
            key_hash: hashApiKeySecret('0'.repeat(64), pepper),
            owner_principal: apiKey.ownerPrincipal,
            scopes: apiKey.scopes,
            environment: apiKey.environment,
            expires_at: null,
            revoked_at: null
          }
        ])
      ]),
      pepper
    })).resolves.toBeUndefined()
  })

  it('checks exact and wildcard scopes', () => {
    expect(hasRequiredScope(['discovery:write'], ['discovery:write'])).toBe(true)
    expect(hasRequiredScope(['discovery:*'], ['discovery:write'])).toBe(true)
    expect(hasRequiredScope(['admin:*'], ['discovery:write'])).toBe(true)
    expect(hasRequiredScope(['search:read'], ['discovery:write'])).toBe(false)
  })

  it('stores key metadata without plaintext material', async () => {
    const apiKey = createApiKey({
      ownerPrincipal: 'local-verifier',
      scopes: ['discovery:write'],
      metadata: { purpose: 'test' }
    }, pepper)
    const queryable = queryableFromResults([queryResult([], 1)])

    await storeApiKey(queryable, apiKey, new Date('2026-05-31T12:00:00.000Z'))

    const [, values] = queryable.query.mock.calls[0]!
    expect(values).toContain(apiKey.keyHash)
    expect(values).not.toContain(apiKey.plaintextKey)
    expect(values).toContainEqual({ purpose: 'test' })
  })

  it('accepts a short-lived first-party shopper session only for purchase scopes', async () => {
    const signingSecret = 'shopper-session-test-secret-with-at-least-32-chars'
    const { token } = issueShopperSessionToken({ signingSecret })
    const authenticate = createApiRequestAuthenticator(signingSecret)
    const request = new Request('http://localhost/v1/purchases/prepare', {
      headers: { 'x-arro-shopper-session': token }
    })

    const allowed = await authenticate({
      request,
      requestId: 'shopper-allowed',
      requiredScopes: ['write:purchase']
    })
    expect(allowed.ok).toBe(true)
    if (allowed.ok) {
      expect(allowed.principal.authType).toBe('shopper_session')
      expect(allowed.principal.scopes).toEqual(['read:purchase', 'write:purchase', 'write:complete_purchase'])
    }

    const denied = await authenticate({
      request,
      requestId: 'shopper-denied',
      requiredScopes: ['admin:*']
    })
    expect(denied).toMatchObject({ ok: false, status: 403, decision: 'insufficient_scope' })
  })

  it('does not let a first-party shopper token become a general purchase API credential', async () => {
    const signingSecret = 'shopper-route-scope-secret-with-at-least-32-chars'
    const { token } = issueShopperSessionToken({ signingSecret })
    const authenticate = createApiRequestAuthenticator(signingSecret)

    const result = await authenticate({
      request: new Request('http://localhost/v1/buyer-profile', {
        headers: { 'x-arro-shopper-session': token }
      }),
      requestId: 'shopper-route-denied',
      requiredScopes: ['read:purchase']
    })

    expect(result).toMatchObject({
      ok: false,
      status: 403,
      decision: 'insufficient_scope',
      body: { error: { code: 'shopper_route_not_allowed' } }
    })
  })

  it.each([
    ['PATCH', '/v1/purchases/ucptx_checkout/review', true],
    ['GET', '/v1/purchases/ucptx_checkout/review', false],
    ['POST', '/v1/purchases/ucptx_checkout/review', false],
    ['PATCH', '/v1/purchases/ucptx_checkout/review/extra', false]
  ])('scopes shopper review access to its actual route: %s %s', async (method, path, allowed) => {
    const signingSecret = 'shopper-review-route-secret-with-at-least-32-chars'
    const { token } = issueShopperSessionToken({ signingSecret })
    const result = await createApiRequestAuthenticator(signingSecret)({
      request: new Request(`http://localhost${path}`, { method, headers: { 'x-arro-shopper-session': token } }),
      requestId: 'review-route', requiredScopes: ['write:purchase']
    })
    expect(result.ok).toBe(allowed)
  })

  it('rejects shopper sessions signed with another secret', async () => {
    const { token } = issueShopperSessionToken({
      signingSecret: 'shopper-session-first-secret-with-at-least-32-chars'
    })
    const authenticate = createApiRequestAuthenticator('shopper-session-second-secret-with-at-least-32-chars')
    const result = await authenticate({
      request: new Request('http://localhost/v1/purchases/prepare', {
        headers: { 'x-arro-shopper-session': token }
      }),
      requestId: 'shopper-invalid',
      requiredScopes: ['write:purchase']
    })
    expect(result).toMatchObject({
      ok: false,
      status: 401,
      body: { error: { code: 'invalid_shopper_session' } }
    })
  })

  it('returns safe auth errors for missing keys before database access', async () => {
    const result = await authenticateApiRequest({
      request: new Request('http://localhost/v1/ucp/discover'),
      requestId: 'auth-missing',
      requiredScopes: ['discovery:write']
    })

    expect(result).toEqual({
      ok: false,
      decision: 'authentication_required',
      status: 401,
      body: {
        error: {
          code: 'authentication_required',
          message: 'An API key is required for this endpoint.',
          requestId: 'auth-missing'
        }
      }
    })
  })

  it('rejects malformed keys before dependency configuration checks', async () => {
    const result = await authenticateApiRequest({
      request: new Request('http://localhost/v1/ucp/discover', {
        headers: {
          'x-api-key': 'not-a-valid-arro-key'
        }
      }),
      requestId: 'auth-invalid',
      requiredScopes: ['discovery:write']
    })

    expect(result).toEqual({
      ok: false,
      decision: 'invalid_api_key',
      status: 401,
      body: {
        error: {
          code: 'invalid_api_key',
          message: 'The supplied API key is invalid or expired.',
          requestId: 'auth-invalid'
        }
      }
    })
  })

  it('keeps the validated principal on insufficient-scope rejections', async () => {
    const apiKey = createApiKey({ ownerPrincipal: 'verifier', scopes: ['search:read'] }, pepper)
    const queryable = queryableFromResults([
      queryResult([
        {
          id: apiKey.keyId,
          key_hash: apiKey.keyHash,
          owner_principal: apiKey.ownerPrincipal,
          scopes: apiKey.scopes,
          environment: apiKey.environment,
          expires_at: null,
          revoked_at: null
        }
      ]),
      queryResult([], 1)
    ])

    const principal = await validateApiKey({
      plaintextKey: apiKey.plaintextKey,
      client: queryable,
      pepper
    })

    expect(principal).toMatchObject({
      keyId: apiKey.keyId,
      scopes: ['search:read']
    })
    expect(hasRequiredScope(principal!.scopes, ['discovery:write'])).toBe(false)
  })
})
