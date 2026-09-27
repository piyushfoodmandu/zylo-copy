import { createPublicKey } from 'node:crypto'
import {
  deriveUcpEs256PublicJwk,
  type UcpEs256PublicJwk
} from '@arro/ucp-client'
import { readRuntimeSecretFile } from './runtime-secrets.ts'

export type UcpPlatformIdentity = {
  privateJwk: Record<string, unknown>
  publicJwks: UcpEs256PublicJwk[]
}

export type UcpPlatformIdentityConfig = {
  privateJwkJson?: string | undefined
  privateJwkFile?: string | undefined
  additionalPublicJwksJson?: string | undefined
}

export class UcpPlatformIdentityConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UcpPlatformIdentityConfigError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const parseJson = (value: string, field: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    throw new UcpPlatformIdentityConfigError(`${field} must contain valid JSON.`)
  }
}

const publicKeyFromUnknown = (value: unknown, index: number): UcpEs256PublicJwk => {
  if (!isRecord(value)) {
    throw new UcpPlatformIdentityConfigError(
      `UCP_PLATFORM_ADDITIONAL_PUBLIC_JWKS_JSON[${index}] must be a public JWK object.`
    )
  }
  for (const privateMember of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k']) {
    if (privateMember in value) {
      throw new UcpPlatformIdentityConfigError(
        `UCP_PLATFORM_ADDITIONAL_PUBLIC_JWKS_JSON[${index}] must not contain private JWK member ${privateMember}.`
      )
    }
  }
  if (
    typeof value.kid !== 'string' || value.kid.length === 0 ||
    !/^[\x20-\x7e]+$/.test(value.kid) ||
    value.kty !== 'EC' || value.crv !== 'P-256' ||
    value.alg !== 'ES256' || value.use !== 'sig' ||
    typeof value.x !== 'string' || typeof value.y !== 'string'
  ) {
    throw new UcpPlatformIdentityConfigError(
      `UCP_PLATFORM_ADDITIONAL_PUBLIC_JWKS_JSON[${index}] must be an EC P-256 ES256 signature JWK with kid, x, and y.`
    )
  }
  if (
    Buffer.from(value.x, 'base64url').byteLength !== 32 ||
    Buffer.from(value.y, 'base64url').byteLength !== 32 ||
    Buffer.from(value.x, 'base64url').toString('base64url') !== value.x ||
    Buffer.from(value.y, 'base64url').toString('base64url') !== value.y
  ) {
    throw new UcpPlatformIdentityConfigError(
      `UCP_PLATFORM_ADDITIONAL_PUBLIC_JWKS_JSON[${index}] has invalid P-256 coordinates.`
    )
  }

  const publicJwk: UcpEs256PublicJwk = {
    kid: value.kid,
    kty: 'EC',
    crv: 'P-256',
    x: value.x,
    y: value.y,
    use: 'sig',
    alg: 'ES256'
  }
  try {
    createPublicKey({ key: publicJwk, format: 'jwk' })
  } catch {
    throw new UcpPlatformIdentityConfigError(
      `UCP_PLATFORM_ADDITIONAL_PUBLIC_JWKS_JSON[${index}] is not a valid EC P-256 public key.`
    )
  }
  return publicJwk
}

export const resolveUcpPlatformIdentity = (
  config: UcpPlatformIdentityConfig
): UcpPlatformIdentity | undefined => {
  const inlinePrivateJwkJson = config.privateJwkJson?.trim()
  const privateJwkFile = config.privateJwkFile?.trim()
  const additionalPublicJwksJson = config.additionalPublicJwksJson?.trim()

  if (inlinePrivateJwkJson && privateJwkFile) {
    throw new UcpPlatformIdentityConfigError(
      'Configure only one of UCP_PLATFORM_SIGNING_PRIVATE_JWK_JSON or UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE.'
    )
  }

  let privateJwkJson = inlinePrivateJwkJson
  if (privateJwkFile) {
    try {
      privateJwkJson = readRuntimeSecretFile(
        privateJwkFile,
        'UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE',
        16_384
      )
    } catch {
      throw new UcpPlatformIdentityConfigError(
        'UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE must point to a readable non-empty private JWK file no larger than 16 KiB.'
      )
    }
  }

  if (!privateJwkJson) {
    if (additionalPublicJwksJson) {
      throw new UcpPlatformIdentityConfigError(
        'A UCP platform signing private JWK is required when additional public rotation keys are configured.'
      )
    }
    return undefined
  }

  const privateSource = privateJwkFile
    ? 'UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE contents'
    : 'UCP_PLATFORM_SIGNING_PRIVATE_JWK_JSON'
  const privateJwk = parseJson(privateJwkJson, privateSource)
  if (!isRecord(privateJwk)) {
    throw new UcpPlatformIdentityConfigError(
      `${privateSource} must contain one private JWK object.`
    )
  }

  let activePublicJwk: UcpEs256PublicJwk
  try {
    activePublicJwk = deriveUcpEs256PublicJwk(privateJwk)
  } catch (error) {
    throw new UcpPlatformIdentityConfigError(
      `${privateSource} is invalid: ${error instanceof Error ? error.message : 'invalid P-256 private JWK'}`
    )
  }

  const additionalValue = additionalPublicJwksJson
    ? parseJson(additionalPublicJwksJson, 'UCP_PLATFORM_ADDITIONAL_PUBLIC_JWKS_JSON')
    : []
  if (!Array.isArray(additionalValue)) {
    throw new UcpPlatformIdentityConfigError(
      'UCP_PLATFORM_ADDITIONAL_PUBLIC_JWKS_JSON must contain an array of public JWK objects.'
    )
  }
  const additional = additionalValue.map(publicKeyFromUnknown)
  const candidates = [activePublicJwk, ...additional]
  const publicJwks: UcpEs256PublicJwk[] = []
  const seenKids = new Map<string, string>()
  const seenMaterial = new Set<string>()
  for (const key of candidates) {
    const material = `${key.kty}:${key.crv}:${key.x}:${key.y}:${key.alg}:${key.use}`
    const existingMaterial = seenKids.get(key.kid)
    if (existingMaterial !== undefined) {
      if (existingMaterial === material) continue
      throw new UcpPlatformIdentityConfigError(`UCP platform signing keys assign kid ${key.kid} to conflicting public key material.`)
    }
    seenKids.set(key.kid, material)
    if (seenMaterial.has(material)) {
      throw new UcpPlatformIdentityConfigError('UCP platform signing keys repeat the same public key material under different key IDs.')
    }
    seenMaterial.add(material)
    publicJwks.push(key)
  }

  return {
    privateJwk: { ...privateJwk },
    publicJwks
  }
}
