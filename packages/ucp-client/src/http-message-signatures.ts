import {
  createECDH,
  createHash,
  createPrivateKey,
  sign as signBytes,
  type KeyObject
} from 'node:crypto'

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/
const HTTP_TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const STRUCTURED_FIELD_STRING_PATTERN = /^[\x20-\x7e]+$/
const GENERATED_HEADER_NAMES = new Set([
  'content-digest',
  'signature',
  'signature-input'
])

const SIGNATURE_LABEL = 'sig1'

export type UcpEs256PublicJwk = {
  kid: string
  kty: 'EC'
  crv: 'P-256'
  x: string
  y: string
  use: 'sig'
  alg: 'ES256'
}

export type UcpHttpRequestSigningInput = {
  privateJwk: unknown
  method: string
  url: string | URL
  headers?: Readonly<Record<string, string>>
  body?: Uint8Array
}

export type UcpSignedHttpRequest = {
  headers: Record<string, string>
  publicJwk: UcpEs256PublicJwk
}

export type UcpHttpMessageSigner = (
  input: Omit<UcpHttpRequestSigningInput, 'privateJwk'>
) => UcpSignedHttpRequest

type ValidatedPrivateJwk = {
  privateKey: KeyObject
  publicJwk: UcpEs256PublicJwk
}

type NormalizedHeaders = {
  output: Record<string, string>
  values: Map<string, string>
}

const requireRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('privateJwk must be a JWK object')
  }
  return value as Record<string, unknown>
}

const requireExactField = <T extends string>(
  jwk: Record<string, unknown>,
  field: string,
  expected: T
): T => {
  if (jwk[field] !== expected) {
    throw new TypeError(`privateJwk.${field} must be ${expected}`)
  }
  return expected
}

const requireCoordinate = (
  jwk: Record<string, unknown>,
  field: 'x' | 'y' | 'd'
): string => {
  const value = jwk[field]
  if (
    typeof value !== 'string' ||
    !BASE64URL_PATTERN.test(value) ||
    Buffer.from(value, 'base64url').byteLength !== 32 ||
    Buffer.from(value, 'base64url').toString('base64url') !== value
  ) {
    throw new TypeError(`privateJwk.${field} must be an unpadded base64url-encoded 32-byte value`)
  }
  return value
}

const requireKid = (jwk: Record<string, unknown>): string => {
  const kid = jwk.kid
  if (
    typeof kid !== 'string' ||
    kid.length === 0 ||
    !STRUCTURED_FIELD_STRING_PATTERN.test(kid)
  ) {
    throw new TypeError('privateJwk.kid must be a non-empty printable ASCII string')
  }
  return kid
}

const validateKeyOperations = (jwk: Record<string, unknown>): void => {
  if (jwk.key_ops === undefined) return
  if (
    !Array.isArray(jwk.key_ops) ||
    !jwk.key_ops.every((operation) => typeof operation === 'string') ||
    !jwk.key_ops.includes('sign')
  ) {
    throw new TypeError('privateJwk.key_ops must include sign when present')
  }
}

const validatePrivateJwk = (input: unknown): ValidatedPrivateJwk => {
  const jwk = requireRecord(input)
  const kid = requireKid(jwk)
  const kty = requireExactField(jwk, 'kty', 'EC')
  const crv = requireExactField(jwk, 'crv', 'P-256')
  const alg = requireExactField(jwk, 'alg', 'ES256')
  const use = requireExactField(jwk, 'use', 'sig')
  const x = requireCoordinate(jwk, 'x')
  const y = requireCoordinate(jwk, 'y')
  const d = requireCoordinate(jwk, 'd')
  validateKeyOperations(jwk)

  let privateKey: KeyObject
  try {
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(Buffer.from(d, 'base64url'))
    const derivedPublicPoint = ecdh.getPublicKey(undefined, 'uncompressed')
    const derivedX = derivedPublicPoint.subarray(1, 33).toString('base64url')
    const derivedY = derivedPublicPoint.subarray(33, 65).toString('base64url')
    if (derivedX !== x || derivedY !== y) {
      throw new TypeError('privateJwk public coordinates do not match its private key material')
    }

    privateKey = createPrivateKey({
      key: { kty, crv, x, y, d },
      format: 'jwk'
    })
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message === 'privateJwk public coordinates do not match its private key material'
    ) {
      throw error
    }
    throw new TypeError('privateJwk is not a valid EC P-256 private key')
  }

  return {
    privateKey,
    publicJwk: { kid, kty, crv, x, y, use, alg }
  }
}

const escapeStructuredFieldString = (value: string): string =>
  value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')

const normalizeHeaders = (
  input: Readonly<Record<string, string>> | undefined
): NormalizedHeaders => {
  if (input === undefined) return { output: {}, values: new Map() }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('headers must be a record of HTTP field names to string values')
  }

  const output: Record<string, string> = Object.create(null) as Record<string, string>
  const values = new Map<string, string>()
  for (const [name, value] of Object.entries(input)) {
    if (!HTTP_TOKEN_PATTERN.test(name)) {
      throw new TypeError('headers contains an invalid HTTP field name')
    }
    if (typeof value !== 'string') {
      throw new TypeError(`headers.${name} must be a string`)
    }
    if (value.includes('\r') || value.includes('\n')) {
      throw new TypeError(`headers.${name} must not contain CR or LF characters`)
    }

    const normalizedName = name.toLowerCase()
    if (values.has(normalizedName)) {
      throw new TypeError(`headers contains duplicate field name ${normalizedName}`)
    }
    if (GENERATED_HEADER_NAMES.has(normalizedName)) {
      throw new TypeError(`${name} is generated by the signer and must not be supplied`)
    }

    output[name] = value
    values.set(normalizedName, value.replace(/^[\t ]+|[\t ]+$/g, ''))
  }
  return { output, values }
}

const parseTargetUrl = (input: string | URL): URL => {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new TypeError('url must be an absolute HTTP or HTTPS URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new TypeError('url must use the HTTP or HTTPS scheme')
  }
  if (url.username !== '' || url.password !== '') {
    throw new TypeError('url must not contain user information')
  }
  if (url.hash !== '') {
    throw new TypeError('url must not contain a fragment')
  }
  return url
}

const requireMethod = (method: string): string => {
  if (typeof method !== 'string' || !HTTP_TOKEN_PATTERN.test(method)) {
    throw new TypeError('method must be a valid case-sensitive HTTP method token')
  }
  if (method !== method.toUpperCase()) {
    throw new TypeError('method must be uppercase so the signed value matches Fetch transmission')
  }
  return method
}

const signatureComponentLine = (name: string, value: string): string =>
  `"${name}": ${value}`

export const deriveUcpEs256PublicJwk = (privateJwk: unknown): UcpEs256PublicJwk =>
  validatePrivateJwk(privateJwk).publicJwk

const signWithValidatedKey = (
  { privateKey, publicJwk }: ValidatedPrivateJwk,
  input: Omit<UcpHttpRequestSigningInput, 'privateJwk'>
): UcpSignedHttpRequest => {
  const method = requireMethod(input.method)
  const url = parseTargetUrl(input.url)
  const normalizedHeaders = normalizeHeaders(input.headers)

  if (input.body !== undefined && !(input.body instanceof Uint8Array)) {
    throw new TypeError('body must be a Uint8Array containing the exact HTTP body bytes')
  }

  const components: string[] = ['@method', '@authority', '@path']
  const componentLines: string[] = [
    signatureComponentLine('@method', method),
    signatureComponentLine('@authority', url.host),
    signatureComponentLine('@path', url.pathname || '/')
  ]

  if (url.search !== '') {
    components.push('@query')
    componentLines.push(signatureComponentLine('@query', url.search))
  }

  for (const name of ['ucp-agent', 'idempotency-key'] as const) {
    const value = normalizedHeaders.values.get(name)
    if (value !== undefined) {
      components.push(name)
      componentLines.push(signatureComponentLine(name, value))
    }
  }

  if (input.body !== undefined) {
    const contentType = normalizedHeaders.values.get('content-type')
    if (contentType === undefined || contentType.length === 0) {
      throw new TypeError('a non-empty Content-Type header is required when body is present')
    }
    const contentDigest = `sha-256=:${createHash('sha256').update(input.body).digest('base64')}:`
    normalizedHeaders.output['Content-Digest'] = contentDigest
    components.push('content-digest', 'content-type')
    componentLines.push(
      signatureComponentLine('content-digest', contentDigest),
      signatureComponentLine('content-type', contentType)
    )
  }

  const serializedComponents = components.map((name) => `"${name}"`).join(' ')
  const signatureParameters = `(${serializedComponents});keyid="${escapeStructuredFieldString(publicJwk.kid)}"`
  const signatureInput = `${SIGNATURE_LABEL}=${signatureParameters}`
  const signatureBase = [
    ...componentLines,
    signatureComponentLine('@signature-params', signatureParameters)
  ].join('\n')
  const signature = signBytes('sha256', Buffer.from(signatureBase, 'utf8'), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363'
  })
  if (signature.byteLength !== 64) {
    throw new Error('ES256 signer returned an invalid signature length')
  }

  normalizedHeaders.output['Signature-Input'] = signatureInput
  normalizedHeaders.output.Signature = `${SIGNATURE_LABEL}=:${signature.toString('base64')}:`

  return {
    headers: normalizedHeaders.output,
    publicJwk
  }
}

/** Validate and import a deployment key once, then reuse it for request signing. */
export const createUcpHttpMessageSigner = (
  privateJwk: unknown
): UcpHttpMessageSigner => {
  const validatedKey = validatePrivateJwk(privateJwk)
  return (input) => signWithValidatedKey(validatedKey, input)
}

export const signUcpHttpRequest = (
  input: UcpHttpRequestSigningInput
): UcpSignedHttpRequest => {
  const { privateJwk, ...request } = input
  return signWithValidatedKey(validatePrivateJwk(privateJwk), request)
}
