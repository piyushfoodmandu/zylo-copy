import { describe, expect, it } from 'vitest'
import {
  resolveUcpProfileSigningKeys,
  UcpProfileSigningKeyError
} from './ucp-profile-keys.ts'

const publicKey = {
  kid: 'platform-2026-08',
  kty: 'EC',
  crv: 'P-256',
  alg: 'ES256',
  use: 'sig',
  x: 'x-coordinate',
  y: 'y-coordinate'
}

describe('UCP profile signing-key resolution', () => {
  it('resolves only the canonical root keys field', () => {
    expect(resolveUcpProfileSigningKeys({
      ucp: { version: '2026-08-25' },
      keys: [publicKey]
    })).toEqual([publicKey])

    expect(resolveUcpProfileSigningKeys({
      ucp: { version: '2026-08-25', signing_keys: [publicKey] },
      signing_keys: [publicKey]
    })).toEqual([])
  })

  it('rejects duplicate kids, leaked private material, and malformed known key types', () => {
    expect(() => resolveUcpProfileSigningKeys({
      keys: [publicKey, { ...publicKey }]
    })).toThrow(/duplicate kid/)

    expect(() => resolveUcpProfileSigningKeys({
      keys: [{ ...publicKey, d: 'private-scalar' }]
    })).toThrow(/private JWK member d/)

    expect(() => resolveUcpProfileSigningKeys({
      keys: [{ kid: 'broken-ec', kty: 'EC', crv: 'P-256', x: 'x' }]
    })).toThrow(UcpProfileSigningKeyError)

    expect(() => resolveUcpProfileSigningKeys({
      keys: [{ ...publicKey, alg: 'ES384' }]
    })).toThrow(/requires alg ES256/)
  })
})
