import type { UcpProfile } from './ucp.ts'

type JsonRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const privateJwkMembers = new Set([
  'd',
  'p',
  'q',
  'dp',
  'dq',
  'qi',
  'oth',
  'k'
])

export class UcpProfileSigningKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UcpProfileSigningKeyError'
  }
}

/**
 * Resolve the canonical root `keys` JWK Set from a v2026-08-25 profile.
 * Deprecated aliases are deliberately ignored; private material and malformed
 * known key types fail closed even when an unvalidated object reaches here.
 */
export const resolveUcpProfileSigningKeys = (
  profile: UcpProfile | unknown
): JsonRecord[] => {
  if (!isRecord(profile)) return []
  if (profile.keys === undefined) return []
  if (!Array.isArray(profile.keys) || profile.keys.some((entry) => !isRecord(entry))) {
    throw new UcpProfileSigningKeyError('keys must be an array of public JWK objects.')
  }

  const keys = (profile.keys as JsonRecord[]).map((key) => ({ ...key }))
  const seenKids = new Set<string>()
  for (const key of keys) {
    const privateMember = Object.keys(key).find((member) => privateJwkMembers.has(member))
    if (privateMember) {
      throw new UcpProfileSigningKeyError(
        `UCP profile key ${typeof key.kid === 'string' ? key.kid : '<unknown>'} exposes private JWK member ${privateMember}.`
      )
    }
    if (typeof key.kid !== 'string' || key.kid.trim().length === 0) {
      throw new UcpProfileSigningKeyError('Every UCP profile key must have a non-empty kid.')
    }
    if (typeof key.kty !== 'string' || key.kty.trim().length === 0) {
      throw new UcpProfileSigningKeyError(`UCP profile key ${key.kid} must have a non-empty kty.`)
    }
    if (
      key.kty === 'EC' &&
      !['crv', 'x', 'y'].every((member) => typeof key[member] === 'string')
    ) {
      throw new UcpProfileSigningKeyError(`UCP profile EC key ${key.kid} must include crv, x, and y.`)
    }
    if (
      key.kty === 'OKP' &&
      !['crv', 'x'].every((member) => typeof key[member] === 'string')
    ) {
      throw new UcpProfileSigningKeyError(`UCP profile OKP key ${key.kid} must include crv and x.`)
    }
    const expectedAlgorithm = key.crv === 'P-256'
      ? 'ES256'
      : key.crv === 'P-384'
        ? 'ES384'
        : key.crv === 'Ed25519'
          ? 'EdDSA'
          : undefined
    if (expectedAlgorithm && key.alg !== undefined && key.alg !== expectedAlgorithm) {
      throw new UcpProfileSigningKeyError(
        `UCP profile key ${key.kid} curve ${String(key.crv)} requires alg ${expectedAlgorithm}.`
      )
    }
    if (seenKids.has(key.kid)) {
      throw new UcpProfileSigningKeyError(`UCP profile publishes duplicate kid ${key.kid}.`)
    }
    seenKids.add(key.kid)
  }

  return keys
}
