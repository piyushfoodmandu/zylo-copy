import type { AnyElysia } from 'elysia'
import { ShopperAccountError, type ShopperAccounts } from '../shopper-account.ts'
import { IdentityTokenError, verifyIdentityToken, type IdentityProvider } from '../shopper-identity-token.ts'
import { issueShopperSessionToken, validateShopperSessionToken } from '../shopper-session.ts'

type Options = {
  accounts: ShopperAccounts | undefined
  signingSecret: string | undefined
  /** Client IDs Arro ships per provider. Empty means the provider is off. */
  identityAudiences?: Partial<Record<IdentityProvider, string[]>>
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const stringField = (value: unknown) => typeof value === 'string' ? value : ''

/**
 * Optional identity, not a gate.
 *
 * Arro shops fine without an account — the anonymous shopper session already
 * prepares and completes checkouts. Signing in binds that same session to an
 * account so a cart and a saved list can follow someone to another device, and
 * signing out unbinds it. Nothing else in the API starts requiring one.
 *
 * The session token itself is the existing signed shopper session. Binding is
 * recorded server-side, which is what makes sign-out a real revocation rather
 * than a client forgetting a value.
 */
export const registerShopperAccountRoutes = (
  app: AnyElysia,
  { accounts, signingSecret, identityAudiences = {} }: Options
) => {
  const unavailable = (requestId: string, set: { status?: number | string }) => {
    set.status = 503
    return {
      error: {
        code: 'shopper_accounts_unavailable',
        message: 'Arro accounts are not configured on this deployment.',
        requestId
      }
    }
  }

  const fail = (error: unknown, requestId: string, set: { status?: number | string }) => {
    if (error instanceof IdentityTokenError) {
      set.status = 401
      return { error: { code: 'identity_token_rejected', message: error.message, requestId } }
    }
    if (error instanceof ShopperAccountError) {
      set.status = error.status
      return { error: { code: error.code, message: error.message, requestId } }
    }
    set.status = 500
    return {
      error: { code: 'shopper_account_failed', message: 'The account request could not be completed.', requestId }
    }
  }

  const sessionFor = async (accountId: string) => {
    const { token, claims } = issueShopperSessionToken({ signingSecret: signingSecret! })
    await accounts!.bindSession({
      sessionId: claims.sessionId,
      accountId,
      expiresAt: claims.expiresAt
    })
    return { token, expiresAt: claims.expiresAt }
  }

  const claimsFrom = (request: Request) => {
    const token = request.headers.get('x-arro-shopper-session')?.trim()
    if (!token || !signingSecret) return undefined
    return validateShopperSessionToken({ token, signingSecret })
  }

  return app
    .post('/v1/shopper/account/register', async ({ body, requestId, set }) => {
      if (!accounts || !signingSecret) return unavailable(requestId, set)
      const input = asRecord(body)
      try {
        const account = await accounts.register({
          email: stringField(input.email),
          password: stringField(input.password),
          ...(stringField(input.displayName) ? { displayName: stringField(input.displayName) } : {})
        })
        set.headers['cache-control'] = 'no-store'
        return { account, session: await sessionFor(account.accountId) }
      } catch (error) {
        return fail(error, requestId, set)
      }
    })
    .post('/v1/shopper/account/login', async ({ body, requestId, set }) => {
      if (!accounts || !signingSecret) return unavailable(requestId, set)
      const input = asRecord(body)
      try {
        const account = await accounts.authenticate({
          email: stringField(input.email),
          password: stringField(input.password)
        })
        set.headers['cache-control'] = 'no-store'
        return { account, session: await sessionFor(account.accountId) }
      } catch (error) {
        return fail(error, requestId, set)
      }
    })
    /**
     * Federated sign-in. The client obtains an ID token from Google or Apple
     * and posts it here; Arro verifies it against the provider's signing keys
     * before it will believe a single claim in it.
     */
    .post('/v1/shopper/account/oauth', async ({ body, requestId, set }) => {
      if (!accounts || !signingSecret) return unavailable(requestId, set)
      const input = asRecord(body)
      const provider = stringField(input.provider)
      const idToken = stringField(input.idToken)
      if (provider !== 'google' && provider !== 'apple') {
        set.status = 422
        return { error: { code: 'identity_provider_unsupported', message: 'Unknown identity provider.', requestId } }
      }
      try {
        const identity = await verifyIdentityToken({
          provider,
          idToken,
          audiences: identityAudiences[provider] ?? []
        })
        const account = await accounts.signInWithIdentity(identity)
        set.headers['cache-control'] = 'no-store'
        return { account, session: await sessionFor(account.accountId) }
      } catch (error) {
        return fail(error, requestId, set)
      }
    })
    /** Which providers this deployment can actually offer. */
    .get('/v1/shopper/account/providers', ({ set }) => {
      set.headers['cache-control'] = 'public, max-age=300'
      return {
        password: Boolean(accounts && signingSecret),
        google: (identityAudiences.google ?? []).length > 0,
        apple: (identityAudiences.apple ?? []).length > 0
      }
    })
    .get('/v1/shopper/account', async ({ request, requestId, set }) => {
      if (!accounts || !signingSecret) return unavailable(requestId, set)
      const claims = claimsFrom(request)
      set.headers['cache-control'] = 'no-store'
      if (!claims) {
        set.status = 401
        return { error: { code: 'shopper_session_required', message: 'Sign in to read this account.', requestId } }
      }
      const account = await accounts.accountForSession(claims.sessionId)
      if (!account) {
        set.status = 404
        return { error: { code: 'account_not_found', message: 'This session is not signed in.', requestId } }
      }
      return { account }
    })
    .post('/v1/shopper/account/logout', async ({ request, requestId, set }) => {
      if (!accounts || !signingSecret) return unavailable(requestId, set)
      const claims = claimsFrom(request)
      if (claims) await accounts.revokeSession(claims.sessionId)
      set.headers['cache-control'] = 'no-store'
      set.status = 204
      return null
    })
}
