import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  verify as verifyBytes
} from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  deriveUcpEs256PublicJwk,
  signUcpHttpRequest,
  type UcpEs256PublicJwk
} from './http-message-signatures.ts'

type PrivateFixtureJwk = UcpEs256PublicJwk & {
  d: string
  key_ops?: string[]
  [key: string]: unknown
}

const createPrivateFixture = (kid = 'platform-2026'): PrivateFixtureJwk => {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const exported = privateKey.export({ format: 'jwk' })
  if (
    exported.kty !== 'EC' ||
    exported.crv !== 'P-256' ||
    typeof exported.x !== 'string' ||
    typeof exported.y !== 'string' ||
    typeof exported.d !== 'string'
  ) {
    throw new Error('test runtime did not export a P-256 private JWK')
  }
  return {
    kid,
    kty: 'EC',
    crv: 'P-256',
    x: exported.x,
    y: exported.y,
    d: exported.d,
    use: 'sig',
    alg: 'ES256'
  }
}

const extractSignatureBytes = (signatureHeader: string | undefined): Buffer => {
  const match = /^sig1=:([A-Za-z0-9+/]+={0,2}):$/.exec(signatureHeader ?? '')
  if (!match?.[1]) throw new Error('Signature header was not a sig1 byte sequence')
  return Buffer.from(match[1], 'base64')
}

const verifySignature = (
  signatureBase: string,
  signatureHeader: string | undefined,
  publicJwk: UcpEs256PublicJwk
): boolean => verifyBytes(
  'sha256',
  Buffer.from(signatureBase, 'utf8'),
  {
    key: createPublicKey({ key: publicJwk, format: 'jwk' }),
    dsaEncoding: 'ieee-p1363'
  },
  extractSignatureBytes(signatureHeader)
)

describe('UCP HTTP message signatures', () => {
  it('rejects lowercase methods that Fetch would normalize after signing', () => {
    const privateJwk = createPrivateFixture()
    expect(() => signUcpHttpRequest({
      privateJwk,
      method: 'post',
      url: 'https://merchant.example/checkout'
    })).toThrow(/method must be uppercase/)
  })
  it('derives a minimal public JWK without leaking private or unrelated fields', () => {
    const privateJwk = {
      ...createPrivateFixture('rotate-2026-08'),
      key_ops: ['sign'],
      ext: false,
      private_metadata: 'must-not-escape'
    }

    const publicJwk = deriveUcpEs256PublicJwk(privateJwk)

    expect(publicJwk).toEqual({
      kid: 'rotate-2026-08',
      kty: 'EC',
      crv: 'P-256',
      x: privateJwk.x,
      y: privateJwk.y,
      use: 'sig',
      alg: 'ES256'
    })
    expect(publicJwk).not.toHaveProperty('d')
    expect(publicJwk).not.toHaveProperty('key_ops')
    expect(publicJwk).not.toHaveProperty('private_metadata')
    expect(JSON.stringify(publicJwk)).not.toContain(privateJwk.d)
  })

  it('signs the stable UCP GET component set with a raw 64-byte ES256 signature', () => {
    const privateJwk = createPrivateFixture()
    const inputHeaders = {
      Accept: 'application/json',
      'UCP-Agent': 'profile="https://platform.example/.well-known/ucp"'
    }
    const signed = signUcpHttpRequest({
      privateJwk,
      method: 'GET',
      url: 'https://Merchant.Example:8443/checkout-sessions/chk%2F123',
      headers: inputHeaders
    })

    const signatureParameters = '('
      + '"@method" "@authority" "@path" "ucp-agent"'
      + ');keyid="platform-2026"'
    const expectedBase = [
      '"@method": GET',
      '"@authority": merchant.example:8443',
      '"@path": /checkout-sessions/chk%2F123',
      '"ucp-agent": profile="https://platform.example/.well-known/ucp"',
      `"@signature-params": ${signatureParameters}`
    ].join('\n')

    expect(signed.headers).toMatchObject(inputHeaders)
    expect(inputHeaders).toEqual({
      Accept: 'application/json',
      'UCP-Agent': 'profile="https://platform.example/.well-known/ucp"'
    })
    expect(signed.headers['Signature-Input']).toBe(`sig1=${signatureParameters}`)
    expect(extractSignatureBytes(signed.headers.Signature)).toHaveLength(64)
    expect(verifySignature(expectedBase, signed.headers.Signature, signed.publicJwk)).toBe(true)
    expect(signed.publicJwk).not.toHaveProperty('d')
  })

  it('binds the exact query, identity, idempotency key, raw body digest, and content type', () => {
    const privateJwk = createPrivateFixture('body-key')
    const body = Buffer.from('{\n  "quantity": 2, "item": "café"\n}\n', 'utf8')
    const signed = signUcpHttpRequest({
      privateJwk,
      method: 'POST',
      url: 'https://merchant.example/checkout-sessions?sku=a%2Fb&campaign=Summer+Sale',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'ucp-agent': 'profile="https://platform.example/profile"',
        'IDEMPOTENCY-KEY': '550e8400-e29b-41d4-a716-446655440000'
      },
      body
    })

    const digest = `sha-256=:${createHash('sha256').update(body).digest('base64')}:`
    const signatureParameters = '('
      + '"@method" "@authority" "@path" "@query" "ucp-agent" '
      + '"idempotency-key" "content-digest" "content-type"'
      + ');keyid="body-key"'
    const expectedBase = [
      '"@method": POST',
      '"@authority": merchant.example',
      '"@path": /checkout-sessions',
      '"@query": ?sku=a%2Fb&campaign=Summer+Sale',
      '"ucp-agent": profile="https://platform.example/profile"',
      '"idempotency-key": 550e8400-e29b-41d4-a716-446655440000',
      `"content-digest": ${digest}`,
      '"content-type": application/json; charset=utf-8',
      `"@signature-params": ${signatureParameters}`
    ].join('\n')

    expect(signed.headers['Content-Digest']).toBe(digest)
    expect(signed.headers['Signature-Input']).toBe(`sig1=${signatureParameters}`)
    expect(verifySignature(expectedBase, signed.headers.Signature, signed.publicJwk)).toBe(true)
    const alteredDigest = `sha-256=:${createHash('sha256').update(Buffer.from('{"quantity":3}')).digest('base64')}:`
    expect(verifySignature(expectedBase.replace(digest, alteredDigest), signed.headers.Signature, signed.publicJwk)).toBe(false)
  })

  it('treats a present zero-byte body as a signed body', () => {
    const privateJwk = createPrivateFixture('empty-body')
    const signed = signUcpHttpRequest({
      privateJwk,
      method: 'POST',
      url: new URL('https://merchant.example/checkout-sessions'),
      headers: { 'Content-Type': 'application/json' },
      body: new Uint8Array()
    })

    expect(signed.headers['Content-Digest']).toBe(
      'sha-256=:47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=:'
    )
    expect(signed.headers['Signature-Input']).toContain('"content-digest" "content-type"')
  })

  it('binds the transmitted uppercase method, omits an absent query, and escapes key IDs as structured strings', () => {
    const privateJwk = createPrivateFixture('key"\\2026')
    const signed = signUcpHttpRequest({
      privateJwk,
      method: 'GET',
      url: 'https://merchant.example?'
    })
    const signatureParameters = '('
      + '"@method" "@authority" "@path"'
      + ');keyid="key\\"\\\\2026"'
    const expectedBase = [
      '"@method": GET',
      '"@authority": merchant.example',
      '"@path": /',
      `"@signature-params": ${signatureParameters}`
    ].join('\n')

    expect(signed.headers['Signature-Input']).toBe(`sig1=${signatureParameters}`)
    expect(signed.headers['Signature-Input']).not.toContain('@query')
    expect(verifySignature(expectedBase, signed.headers.Signature, signed.publicJwk)).toBe(true)
  })

  it('applies RFC field-value OWS normalization without changing the caller input', () => {
    const privateJwk = createPrivateFixture('ows-key')
    const headers = {
      'UCP-Agent': ' \tprofile="https://platform.example/profile"\t ',
      'Idempotency-Key': '\t idem-123 \t'
    }
    const signed = signUcpHttpRequest({
      privateJwk,
      method: 'PATCH',
      url: 'https://merchant.example/resource',
      headers
    })
    const signatureParameters = '('
      + '"@method" "@authority" "@path" "ucp-agent" "idempotency-key"'
      + ');keyid="ows-key"'
    const expectedBase = [
      '"@method": PATCH',
      '"@authority": merchant.example',
      '"@path": /resource',
      '"ucp-agent": profile="https://platform.example/profile"',
      '"idempotency-key": idem-123',
      `"@signature-params": ${signatureParameters}`
    ].join('\n')

    expect(signed.headers['UCP-Agent']).toBe(headers['UCP-Agent'])
    expect(signed.headers['Idempotency-Key']).toBe(headers['Idempotency-Key'])
    expect(verifySignature(expectedBase, signed.headers.Signature, signed.publicJwk)).toBe(true)
  })

  it.each([
    ['not an object', null, 'JWK object'],
    ['wrong key type', { ...createPrivateFixture(), kty: 'RSA' }, 'kty'],
    ['wrong curve', { ...createPrivateFixture(), crv: 'P-384' }, 'crv'],
    ['wrong algorithm', { ...createPrivateFixture(), alg: 'ES384' }, 'alg'],
    ['wrong use', { ...createPrivateFixture(), use: 'enc' }, 'use'],
    ['missing kid', { ...createPrivateFixture(), kid: undefined }, 'kid'],
    ['non-ASCII kid', { ...createPrivateFixture(), kid: 'key-🔑' }, 'kid'],
    ['public key only', (() => {
      const { d: _d, ...publicOnly } = createPrivateFixture()
      return publicOnly
    })(), '.d'],
    ['padded private coordinate', { ...createPrivateFixture(), d: `${createPrivateFixture().d}=` }, '.d'],
    ['short private coordinate', { ...createPrivateFixture(), d: 'AA' }, '.d'],
    ['non-signing key operations', { ...createPrivateFixture(), key_ops: ['verify'] }, 'key_ops']
  ])('rejects %s', (_label, privateJwk, expectedMessage) => {
    expect(() => deriveUcpEs256PublicJwk(privateJwk)).toThrow(expectedMessage as string)
  })

  it('rejects public coordinates that do not correspond to the private scalar', () => {
    const first = createPrivateFixture()
    const second = createPrivateFixture()
    const mismatched = { ...first, x: second.x, y: second.y }

    expect(() => deriveUcpEs256PublicJwk(mismatched)).toThrow(/valid EC P-256|do not match/)
  })

  it('does not disclose private scalar material in validation failures', () => {
    const privateJwk = createPrivateFixture()
    const malformed = { ...privateJwk, x: 'invalid' }
    let message = ''
    try {
      deriveUcpEs256PublicJwk(malformed)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).not.toBe('')
    expect(message).not.toContain(privateJwk.d)
  })

  it.each([
    ['relative URL', { method: 'GET', url: '/relative' }, 'absolute HTTP'],
    ['non-HTTP URL', { method: 'GET', url: 'ftp://merchant.example/path' }, 'HTTP or HTTPS'],
    ['credentials in URL', { method: 'GET', url: 'https://user:pass@merchant.example/path' }, 'user information'],
    ['fragment in URL', { method: 'GET', url: 'https://merchant.example/path#section' }, 'fragment'],
    ['invalid method', { method: 'GET /path', url: 'https://merchant.example/path' }, 'method'],
    ['invalid header name', { method: 'GET', url: 'https://merchant.example', headers: { 'Bad Header': 'value' } }, 'field name'],
    ['duplicate header name', { method: 'GET', url: 'https://merchant.example', headers: { 'UCP-Agent': 'one', 'ucp-agent': 'two' } }, 'duplicate'],
    ['header injection', { method: 'GET', url: 'https://merchant.example', headers: { 'UCP-Agent': 'one\r\ntwo' } }, 'CR or LF'],
    ['caller-supplied digest', { method: 'GET', url: 'https://merchant.example', headers: { 'Content-Digest': 'sha-256=:fake=:' } }, 'generated by the signer'],
    ['caller-supplied signature input', { method: 'GET', url: 'https://merchant.example', headers: { 'Signature-Input': 'sig1=()' } }, 'generated by the signer'],
    ['caller-supplied signature', { method: 'GET', url: 'https://merchant.example', headers: { Signature: 'sig1=:fake=:' } }, 'generated by the signer']
  ])('rejects %s', (_label, request, expectedMessage) => {
    expect(() => signUcpHttpRequest({
      privateJwk: createPrivateFixture(),
      ...request
    })).toThrow(expectedMessage as string)
  })

  it('requires content type for every present body and rejects non-byte bodies', () => {
    const privateJwk = createPrivateFixture()
    expect(() => signUcpHttpRequest({
      privateJwk,
      method: 'POST',
      url: 'https://merchant.example/path',
      body: Buffer.from('{}')
    })).toThrow('Content-Type')

    expect(() => signUcpHttpRequest({
      privateJwk,
      method: 'POST',
      url: 'https://merchant.example/path',
      headers: { 'Content-Type': 'application/json' },
      body: '{}' as unknown as Uint8Array
    })).toThrow('Uint8Array')
  })
})
