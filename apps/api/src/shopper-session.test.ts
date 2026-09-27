import { describe, expect, it } from 'vitest'
import { issueShopperSessionToken, validateShopperSessionToken } from './shopper-session.ts'

const secret = 'shopper-session-test-secret-with-at-least-32-characters'

describe('first-party shopper sessions', () => {
  it('issues a short-lived signed session and validates it', () => {
    const now = new Date('2026-08-18T12:00:00.000Z')
    const issued = issueShopperSessionToken({ signingSecret: secret, now, ttlSeconds: 900 })

    expect(issued.token).toMatch(/^arro_ss1\./)
    expect(validateShopperSessionToken({
      token: issued.token,
      signingSecret: secret,
      now: new Date('2026-08-18T12:10:00.000Z')
    })).toMatchObject({ sessionId: issued.claims.sessionId })
  })

  it('rejects tampering and expiry', () => {
    const now = new Date('2026-08-18T12:00:00.000Z')
    const issued = issueShopperSessionToken({ signingSecret: secret, now, ttlSeconds: 60 })

    expect(validateShopperSessionToken({
      token: `${issued.token}tampered`,
      signingSecret: secret,
      now
    })).toBeUndefined()
    expect(validateShopperSessionToken({
      token: issued.token,
      signingSecret: secret,
      now: new Date('2026-08-18T12:02:00.000Z')
    })).toBeUndefined()
  })

  it('can rotate a valid session token without changing shopper ownership', () => {
    const first = issueShopperSessionToken({
      signingSecret: secret,
      now: new Date('2026-08-18T12:00:00.000Z'),
      ttlSeconds: 900
    })
    const rotated = issueShopperSessionToken({
      signingSecret: secret,
      now: new Date('2026-08-18T12:10:00.000Z'),
      ttlSeconds: 900,
      sessionId: first.claims.sessionId
    })

    expect(rotated.claims.sessionId).toBe(first.claims.sessionId)
    expect(rotated.token).not.toBe(first.token)
  })

})
