import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildPlatformProfile,
  signingKeySetStartsWithExactKey,
  UCP_AP2_MANDATE_CAPABILITY
} from './platform-profile.ts'

const publicJwk = {
  kid: 'platform-profile-test',
  kty: 'EC',
  crv: 'P-256',
  x: '_rVPgdqCmGBO9Rg4YVk0TpD4NSUL7_2agZS9TZJ1zFs',
  y: 'bEQXnAqe3JkisNlOpRZ8fVxhClH9Z0UKHhiIaRyaOWc',
  alg: 'ES256',
  use: 'sig'
} as const

const generatedPublicJwk = (kid: string) => {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const exported = publicKey.export({ format: 'jwk' })
  if (
    exported.kty !== 'EC' || exported.crv !== 'P-256' ||
    typeof exported.x !== 'string' || typeof exported.y !== 'string'
  ) {
    throw new Error('test runtime did not export a P-256 public JWK')
  }
  return {
    kid,
    kty: 'EC',
    crv: 'P-256',
    x: exported.x,
    y: exported.y,
    alg: 'ES256',
    use: 'sig'
  } as const
}

describe('platform profile signing-key publication', () => {
  it('advertises client bindings without pretending Arro is a UCP business endpoint', () => {
    const profile = buildPlatformProfile({ transports: ['mcp', 'rest'] })

    expect(profile.ucp.services['dev.ucp.shopping']).toEqual([
      expect.objectContaining({ transport: 'mcp' }),
      expect.objectContaining({ transport: 'rest' })
    ])
    expect(profile.ucp.services['dev.ucp.shopping'].every(
      (service) => service.endpoint === undefined
    )).toBe(true)
  })

  it('publishes only the canonical v2026-08-25 keys field', () => {
    const profile = buildPlatformProfile({ signingKeys: [publicJwk] })

    expect(profile.keys).toEqual([publicJwk])
    expect(profile).not.toHaveProperty('signing_keys')
  })

  it('keeps the active signer first and detects reordered publication', () => {
    const retainedPublicJwk = generatedPublicJwk('retained-platform-profile-test')
    const profile = buildPlatformProfile({
      signingKeys: [publicJwk, retainedPublicJwk]
    })

    expect(profile.keys?.map((key) => key.kid)).toEqual([
      publicJwk.kid,
      retainedPublicJwk.kid
    ])
    expect(signingKeySetStartsWithExactKey(profile.keys, publicJwk)).toBe(true)
    expect(signingKeySetStartsWithExactKey(
      [retainedPublicJwk, publicJwk],
      publicJwk
    )).toBe(false)
    expect(signingKeySetStartsWithExactKey(undefined, publicJwk)).toBe(false)
  })

  it('publishes only implemented v2026-08-25 capabilities and canonical specification URLs', () => {
    const profile = buildPlatformProfile({ ap2Mandate: true })

    expect(profile.ucp.version).toBe('2026-08-25')
    expect(profile.ucp.capabilities['dev.ucp.shopping.fulfillment']?.[0]).toMatchObject({
      version: '2026-08-25',
      spec: 'https://ucp.dev/2026-08-25/specification/shopping/extensions/fulfillment',
      schema: 'https://ucp.dev/2026-08-25/schemas/shopping/fulfillment.json',
      extends: 'dev.ucp.shopping.checkout'
    })
    expect(profile.ucp.capabilities).not.toHaveProperty('dev.ucp.shopping.buyer_consent')
    expect(profile.ucp.capabilities).not.toHaveProperty('dev.ucp.shopping.discount')
    expect(profile.ucp.capabilities).not.toHaveProperty('dev.ucp.common.payment.authentication')
    expect(profile.ucp.capabilities['dev.ucp.shopping.checkout']?.[0]).toMatchObject({
      version: '2026-08-25',
      spec: 'https://ucp.dev/2026-08-25/specification/shopping/checkout',
      schema: 'https://ucp.dev/2026-08-25/schemas/shopping/checkout.json'
    })
    expect((profile.ucp.capabilities as Record<string, unknown>)[UCP_AP2_MANDATE_CAPABILITY]).toEqual([{
      version: '2026-08-25',
      spec: 'https://ucp.dev/2026-08-25/specification/payment/extensions/ap2-mandates',
      schema: 'https://ucp.dev/2026-08-25/schemas/common/payment_ap2_mandate.json',
      extends: 'dev.ucp.shopping.checkout',
      config: {
        vp_formats_supported: {
          'dc+sd-jwt': {}
        }
      }
    }])
  })

  it('rejects private, malformed, and duplicate signing keys', () => {
    expect(() => buildPlatformProfile({
      signingKeys: [{ ...publicJwk, d: 'must-never-publish' } as any]
    })).toThrow(/must be a public EC P-256 ES256 signature JWK/)
    expect(() => buildPlatformProfile({
      signingKeys: [{ ...publicJwk, x: 'invalid' }]
    })).toThrow(/must be a public EC P-256 ES256 signature JWK/)
    expect(() => buildPlatformProfile({
      signingKeys: [publicJwk, publicJwk]
    })).toThrow(/duplicate kid/)
  })
})
