import { createPublicKey, createVerify } from 'node:crypto'

/**
 * Verifies a Google or Apple ID token against the provider's published signing
 * keys.
 *
 * The client never gets to tell Arro who it is. It hands over a token the
 * provider signed, and this checks the signature against that provider's JWKS,
 * the issuer, the audience (Arro's own client ID) and the expiry. Skipping any
 * one of those turns "sign in with Google" into "claim to be anyone".
 */

export type IdentityProvider = 'google' | 'apple'

export type VerifiedIdentity = {
  provider: IdentityProvider
  subject: string
  email?: string
  emailVerified: boolean
  name?: string
}

export class IdentityTokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityTokenError'
  }
}

const providerConfig: Record<IdentityProvider, { issuers: string[]; jwks: string }> = {
  google: {
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    jwks: 'https://www.googleapis.com/oauth2/v3/certs'
  },
  apple: {
    issuers: ['https://appleid.apple.com'],
    jwks: 'https://appleid.apple.com/auth/keys'
  }
}

type Jwk = { kid: string; kty: string; n: string; e: string; alg?: string }

// Provider keys rotate on the order of days, so a short cache removes a network
// round trip from every sign-in without pinning a retired key.
const jwksCacheTtlMs = 10 * 60 * 1000
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>()

const fetchJwks = async (url: string): Promise<Jwk[]> => {
  const cached = jwksCache.get(url)
  if (cached && Date.now() - cached.fetchedAt < jwksCacheTtlMs) return cached.keys

  const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new IdentityTokenError('The identity provider did not return its signing keys.')
  const body = await response.json() as { keys?: Jwk[] }
  const keys = body.keys ?? []
  if (keys.length === 0) throw new IdentityTokenError('The identity provider returned no signing keys.')
  jwksCache.set(url, { keys, fetchedAt: Date.now() })
  return keys
}

const decodeSegment = (segment: string) => {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    throw new IdentityTokenError('The identity token is malformed.')
  }
}

const publicKeyFrom = (jwk: Jwk) => createPublicKey({ key: jwk as unknown as object, format: 'jwk' })

const stringClaim = (claims: Record<string, unknown>, key: string) =>
  typeof claims[key] === 'string' ? claims[key] as string : undefined

export const verifyIdentityToken = async ({
  provider,
  idToken,
  audiences,
  now = Date.now()
}: {
  provider: IdentityProvider
  idToken: string
  /** Every client ID Arro ships for this provider: web, iOS, Android. */
  audiences: string[]
  now?: number
}): Promise<VerifiedIdentity> => {
  if (audiences.length === 0) {
    throw new IdentityTokenError(`Sign in with ${provider} is not configured on this deployment.`)
  }

  const [headerSegment, payloadSegment, signature, extra] = idToken.trim().split('.')
  if (!headerSegment || !payloadSegment || !signature || extra !== undefined) {
    throw new IdentityTokenError('The identity token is malformed.')
  }

  const header = decodeSegment(headerSegment)
  if (header.alg !== 'RS256') throw new IdentityTokenError('Unsupported identity token algorithm.')

  const config = providerConfig[provider]
  const keys = await fetchJwks(config.jwks)
  const jwk = keys.find((key) => key.kid === header.kid)
  if (!jwk) throw new IdentityTokenError('The identity token was signed with an unknown key.')

  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${headerSegment}.${payloadSegment}`)
  verifier.end()
  if (!verifier.verify(publicKeyFrom(jwk), Buffer.from(signature, 'base64url'))) {
    throw new IdentityTokenError('The identity token signature did not verify.')
  }

  const claims = decodeSegment(payloadSegment)
  const issuer = stringClaim(claims, 'iss')
  if (!issuer || !config.issuers.includes(issuer)) {
    throw new IdentityTokenError('The identity token came from an unexpected issuer.')
  }

  const audience = claims.aud
  const audienceValues = Array.isArray(audience) ? audience.filter((value): value is string => typeof value === 'string')
    : typeof audience === 'string' ? [audience] : []
  if (!audienceValues.some((value) => audiences.includes(value))) {
    throw new IdentityTokenError('The identity token was issued for a different application.')
  }

  const expiry = typeof claims.exp === 'number' ? claims.exp * 1000 : 0
  if (!expiry || expiry <= now) throw new IdentityTokenError('The identity token has expired.')

  const subject = stringClaim(claims, 'sub')
  if (!subject) throw new IdentityTokenError('The identity token carries no subject.')

  // Apple sends `email_verified` as a string on some flows; Google as a boolean.
  const verifiedClaim = claims.email_verified
  const emailVerified = verifiedClaim === true || verifiedClaim === 'true'
  const email = stringClaim(claims, 'email')

  return {
    provider,
    subject,
    ...(email ? { email } : {}),
    emailVerified,
    ...(stringClaim(claims, 'name') ? { name: stringClaim(claims, 'name')! } : {})
  }
}
