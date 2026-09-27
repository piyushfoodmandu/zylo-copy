import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  resolveUcpPlatformIdentity,
  UcpPlatformIdentityConfigError
} from './ucp-platform-identity.ts'

const privateJwk = (kid: string) => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  return {
    ...privateKey.export({ format: 'jwk' }),
    kid,
    alg: 'ES256',
    use: 'sig'
  }
}

const fixtureDirectory = mkdtempSync(join(tmpdir(), 'arro-identity-key-'))
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const fixtureFile = join(fixtureDirectory, 'private.jwk')
writeFileSync(fixtureFile, JSON.stringify(privateJwk('generated-file-test-key')), {
  mode: 0o600
})
afterAll(() => rmSync(fixtureDirectory, { recursive: true, force: true }))

describe('UCP platform identity configuration', () => {
  it('keeps identity opt-in outside production configuration validation', () => {
    expect(resolveUcpPlatformIdentity({})).toBeUndefined()
  })

  it('derives one sanitized active public key and retains public rotation keys', () => {
    const active = privateJwk('active-2026-08')
    const previousPrivate = privateJwk('previous-2026-07')
    const { d: _private, ...previous } = previousPrivate
    const identity = resolveUcpPlatformIdentity({
      privateJwkJson: JSON.stringify(active),
      additionalPublicJwksJson: JSON.stringify([previous])
    })

    expect(identity?.publicJwks.map((key) => key.kid)).toEqual([
      'active-2026-08',
      'previous-2026-07'
    ])
    expect(identity?.publicJwks.every((key) => !('d' in key))).toBe(true)
    expect(identity?.privateJwk.d).toBe(active.d)
  })

  it('loads a bounded private JWK file and rejects ambiguous private-key sources', () => {
    const identity = resolveUcpPlatformIdentity({ privateJwkFile: fixtureFile })
    expect(identity?.publicJwks).toHaveLength(1)
    expect(identity?.publicJwks[0]).not.toHaveProperty('d')

    expect(() => resolveUcpPlatformIdentity({
      privateJwkFile: fixtureFile,
      privateJwkJson: JSON.stringify(privateJwk('ambiguous'))
    })).toThrow(/Configure only one/)
    expect(() => resolveUcpPlatformIdentity({
      privateJwkFile: `${fixtureFile}.missing`
    })).toThrow(/readable non-empty private JWK file/)
  })

  it('resolves provisioned relative private-key paths from the repository root', () => {
    const relativeFixtureFile = relative(repoRoot, fixtureFile)
    const identity = resolveUcpPlatformIdentity({ privateJwkFile: relativeFixtureFile })
    expect(identity?.publicJwks[0]?.kid).toBe('generated-file-test-key')
  })

  it('rejects rotation ambiguity and any private material in the public set', () => {
    const active = privateJwk('active')
    const { d: _private, ...publicActive } = active

    expect(() => resolveUcpPlatformIdentity({
      privateJwkJson: JSON.stringify(active),
      additionalPublicJwksJson: JSON.stringify([{ ...publicActive, d: 'must-not-appear' }])
    })).toThrow(UcpPlatformIdentityConfigError)

    expect(resolveUcpPlatformIdentity({
      privateJwkJson: JSON.stringify(active),
      additionalPublicJwksJson: JSON.stringify([publicActive])
    })?.publicJwks).toHaveLength(1)

    const conflicting = privateJwk('active')
    const { d: _conflictingPrivate, ...conflictingPublic } = conflicting
    expect(() => resolveUcpPlatformIdentity({
      privateJwkJson: JSON.stringify(active),
      additionalPublicJwksJson: JSON.stringify([conflictingPublic])
    })).toThrow(/conflicting public key material/)

    expect(() => resolveUcpPlatformIdentity({
      additionalPublicJwksJson: JSON.stringify([publicActive])
    })).toThrow(/private JWK is required/)

    expect(() => resolveUcpPlatformIdentity({
      privateJwkJson: JSON.stringify(active),
      additionalPublicJwksJson: JSON.stringify([{ ...publicActive, kid: 'key-💥' }])
    })).toThrow(/EC P-256 ES256 signature JWK/)
  })

  it('rejects invalid JSON and non-P256 active keys without disclosing private values', () => {
    expect(() => resolveUcpPlatformIdentity({ privateJwkJson: '{' })).toThrow(/valid JSON/)
    const active = privateJwk('active')
    let message = ''
    try {
      resolveUcpPlatformIdentity({
        privateJwkJson: JSON.stringify({ ...active, crv: 'P-384' })
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('P-256')
    expect(message).not.toContain(String(active.d))
  })
})
