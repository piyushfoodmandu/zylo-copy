import type { AnyElysia } from 'elysia'
import { issueShopperSessionToken, validateShopperSessionToken } from '../shopper-session.ts'

export const registerShopperSessionRoute = (
  app: AnyElysia,
  { signingSecret }: { signingSecret: string | undefined }
) =>
  app.post('/v1/shopper/session', ({ request, requestId, set }) => {
    if (!signingSecret || signingSecret.length < 32) {
      set.status = 503
      return {
        error: {
          code: 'shopper_session_unavailable',
          message: 'First-party checkout sessions are not configured.',
          requestId
        }
      }
    }

    const currentToken = request.headers.get('x-arro-shopper-session')?.trim()
    const currentClaims = currentToken
      ? validateShopperSessionToken({ token: currentToken, signingSecret })
      : undefined
    const { token, claims } = issueShopperSessionToken({
      signingSecret,
      ...(currentClaims ? { sessionId: currentClaims.sessionId } : {})
    })
    set.headers['cache-control'] = 'no-store'
    return {
      token,
      expiresAt: claims.expiresAt
    }
  })
