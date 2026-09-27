import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

const tokenPrefix = 'arro_ss1'
// Anonymous checkout ownership must survive a browser refresh, an app restart,
// and an ordinary multi-day purchase journey. The credential is scoped to the
// random shopper principal and can access only that principal's purchases.
const defaultTtlSeconds = 30 * 24 * 60 * 60
const maxTtlSeconds = defaultTtlSeconds

export type ShopperSessionClaims = {
  version: 1
  sessionId: string
  issuedAt: string
  expiresAt: string
}

const signatureFor = (payload: string, secret: string) =>
  createHmac('sha256', secret)
    .update(`arro-shopper-session/v1\n${payload}`, 'utf8')
    .digest('base64url')

const safeEqual = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export const issueShopperSessionToken = ({
  signingSecret,
  ttlSeconds = defaultTtlSeconds,
  now = new Date(),
  sessionId = `shopper_${randomUUID()}`
}: {
  signingSecret: string
  ttlSeconds?: number
  now?: Date
  sessionId?: string
}) => {
  if (signingSecret.length < 32) throw new Error('Shopper session signing secret must contain at least 32 characters.')
  const boundedTtlSeconds = Math.min(Math.max(Math.floor(ttlSeconds), 60), maxTtlSeconds)
  const claims: ShopperSessionClaims = {
    version: 1,
    sessionId,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + boundedTtlSeconds * 1000).toISOString()
  }
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  return {
    token: `${tokenPrefix}.${payload}.${signatureFor(payload, signingSecret)}`,
    claims
  }
}

export const validateShopperSessionToken = ({
  token,
  signingSecret,
  now = new Date()
}: {
  token: string
  signingSecret: string
  now?: Date
}): ShopperSessionClaims | undefined => {
  const [prefix, payload, signature, extra] = token.trim().split('.')
  if (prefix !== tokenPrefix || !payload || !signature || extra) return undefined
  if (signingSecret.length < 32) return undefined
  if (!safeEqual(signature, signatureFor(payload, signingSecret))) return undefined

  let value: unknown
  try {
    value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const claims = value as Partial<ShopperSessionClaims>
  if (
    claims.version !== 1 ||
    typeof claims.sessionId !== 'string' ||
    !/^shopper_[0-9a-f-]{36}$/i.test(claims.sessionId) ||
    typeof claims.issuedAt !== 'string' ||
    typeof claims.expiresAt !== 'string'
  ) return undefined

  const issuedAt = new Date(claims.issuedAt).getTime()
  const expiresAt = new Date(claims.expiresAt).getTime()
  const nowMs = now.getTime()
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) return undefined
  if (issuedAt > nowMs + 60_000 || expiresAt <= nowMs || expiresAt <= issuedAt) return undefined
  if (expiresAt - issuedAt > maxTtlSeconds * 1000) return undefined

  return claims as ShopperSessionClaims
}
