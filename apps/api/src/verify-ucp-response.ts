import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  collectUcpPlatformProfileAuthorityFailures,
  resolveUcpProfileSigningKeys,
  validationErrorSummary,
  type ArroPlatformProfile,
  ArroPlatformProfileSchema
} from '@arro/contracts'
import {
  createConnectorHttpFetcher,
  type ConnectorHttpResponse
} from '@arro/connectors'
import {
  platformProfileCapabilityNames,
  platformProfileVersion,
  signingKeySetStartsWithExactKey,
  UCP_AP2_MANDATE_CAPABILITY
} from './platform-profile.ts'
import { config } from './config.ts'
import { resolveUcpPlatformIdentity } from './ucp-platform-identity.ts'

const validator = TypeCompiler.Compile(ArroPlatformProfileSchema)
const baseUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:3000'
const requirePublicHttps = process.env.VERIFY_UCP_REQUIRE_PUBLIC_HTTPS === 'true'
const requireAp2 = process.env.AP2_RUNTIME_ENABLED === 'true' || process.env.VERIFY_UCP_REQUIRE_AP2 === 'true'
const requireEmbedded = process.env.EMBEDDED_CHECKOUT_RUNTIME_ENABLED === 'true' || process.env.VERIFY_UCP_REQUIRE_EMBEDDED === 'true'
const requireSigningKeys = process.env.VERIFY_UCP_REQUIRE_SIGNING_KEYS === 'true'
const requireActiveSigner = process.env.VERIFY_UCP_REQUIRE_ACTIVE_SIGNER === 'true'
const nonLaunchHosts = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1'])

const requiredCapabilities = platformProfileCapabilityNames.filter((capability) =>
  capability !== UCP_AP2_MANDATE_CAPABILITY || requireAp2
)
const prohibitedCapabilities = [
  'dev.ucp.shopping.buyer_consent',
  'dev.ucp.shopping.discount',
  'dev.ucp.common.payment.authentication'
] as const

const failures: string[] = []
let expectedActiveSigningKey: Record<string, unknown> | undefined

if (requireActiveSigner) {
  try {
    expectedActiveSigningKey = resolveUcpPlatformIdentity({
      privateJwkJson: config.ucpPlatformSigningPrivateJwkJson,
      privateJwkFile: config.ucpPlatformSigningPrivateJwkFile,
      additionalPublicJwksJson: config.ucpPlatformAdditionalPublicJwksJson
    })?.publicJwks[0]
    if (!expectedActiveSigningKey) {
      failures.push('Production verification requires a configured active UCP signer.')
    }
  } catch {
    failures.push('Production verification could not resolve the configured active UCP signer.')
  }
}

const assert = (condition: boolean, message: string) => {
  if (!condition) failures.push(message)
}

const publicHttpsBaseUrl = (value: string) => {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase()
    return url.protocol === 'https:' && !nonLaunchHosts.has(hostname) && !hostname.endsWith('.local')
  } catch {
    return false
  }
}

const parseMaxAge = (cacheControl: string) => {
  const match = /(?:^|,\s*)max-age=(\d+)/i.exec(cacheControl)
  return match?.[1] ? Number(match[1]) : Number.NaN
}

let endpoint: URL | undefined
try {
  endpoint = new URL('/.well-known/ucp', baseUrl)
} catch {
  failures.push(`PUBLIC_BASE_URL is invalid: ${baseUrl}`)
}

if (requirePublicHttps && !publicHttpsBaseUrl(baseUrl)) {
  failures.push('PUBLIC_BASE_URL must be a public HTTPS origin for production profile verification.')
}

let maxAge = Number.NaN
let profile: unknown
const fetchProfile = createConnectorHttpFetcher()

if (endpoint && failures.length === 0) {
  let response: ConnectorHttpResponse | undefined

  try {
    response = await fetchProfile(endpoint, {
      headers: {
        accept: 'application/json'
      }
    })
  } catch (error) {
    failures.push(
      error instanceof Error
        ? `Failed to fetch UCP profile: ${error.message}`
        : 'Failed to fetch UCP profile.'
    )
  }

  if (response) {
    assert(response.status === 200, `Expected HTTP 200, received ${response.status}.`)
    assert(!response.headers.get('location'), 'UCP profile response must not include a Location header.')

    const contentType = response.headers.get('content-type') ?? ''
    assert(
      contentType.includes('application/json'),
      `Expected application/json content type, received ${contentType || 'none'}.`
    )

    const cacheControl = response.headers.get('cache-control') ?? ''
    maxAge = parseMaxAge(cacheControl)
    assert(cacheControl.toLowerCase().includes('public'), 'Cache-Control must include public.')
    assert(Number.isFinite(maxAge) && maxAge >= 60, 'Cache-Control max-age must be at least 60 seconds.')

    const rawBody = await response.body.text();

    try {
      profile = JSON.parse(rawBody)
    } catch (error) {
      failures.push(error instanceof Error ? error.message : 'UCP profile body is not valid JSON.')
    }
  }
}

if (profile && !validator.Check(profile)) {
  const schemaErrors = validationErrorSummary(validator, profile)
  failures.push(`UCP profile does not match Arro platform profile contract: ${schemaErrors}`)
}

if (profile && validator.Check(profile)) {
  const typedProfile = profile as ArroPlatformProfile
  const authorityFailures = collectUcpPlatformProfileAuthorityFailures(typedProfile)
  for (const failure of authorityFailures) {
    failures.push(`${failure.code}: ${failure.message}`)
  }

  const serviceEntries = typedProfile.ucp.services['dev.ucp.shopping'] ?? []
  const mcpService = serviceEntries.find((service) => service.transport === 'mcp')
  const restService = serviceEntries.find((service) => service.transport === 'rest')
  const embeddedService = serviceEntries.find((service) => service.transport === 'embedded')

  assert(typedProfile.ucp.version === platformProfileVersion, 'Unexpected UCP protocol version.')
  assert(serviceEntries.length >= 2, 'Expected UCP shopping service entries for MCP and REST support.')
  assert(
    serviceEntries.every((service) => service.endpoint === undefined),
    'Arro publishes a platform profile, so shopping service entries must not advertise business transport endpoints.'
  )
  assert(mcpService?.version === platformProfileVersion, 'UCP MCP shopping service version must match the profile version.')
  assert(restService?.version === platformProfileVersion, 'UCP REST shopping service version must match the profile version.')
  assert(
    mcpService?.spec === `https://ucp.dev/${platformProfileVersion}/specification/overview` &&
      restService?.spec === `https://ucp.dev/${platformProfileVersion}/specification/overview`,
    'UCP shopping services must reference the official protocol overview.'
  )
  assert(
    mcpService?.schema === `https://ucp.dev/${platformProfileVersion}/services/shopping/mcp.openrpc.json`,
    'UCP shopping service must reference the official MCP OpenRPC schema.'
  )
  assert(
    restService?.schema === `https://ucp.dev/${platformProfileVersion}/services/shopping/rest.openapi.json`,
    'UCP shopping service must reference the official REST OpenAPI schema.'
  )
  if (requireEmbedded) {
    assert(embeddedService?.version === platformProfileVersion, 'Enabled Embedded Checkout transport must be advertised at the profile version.')
  }
  if (!requireEmbedded && embeddedService) {
    assert(embeddedService.version === platformProfileVersion, 'Advertised Embedded Checkout transport must match the profile version.')
  }

  const advertisedCapabilities = typedProfile.ucp.capabilities as Record<string, Array<{ version: string }> | undefined>
  for (const capability of requiredCapabilities) {
    const declarations = advertisedCapabilities[capability]
    assert(Array.isArray(declarations) && declarations.length > 0, `Missing declared capability ${capability}.`)
    assert(
      declarations?.some((declaration) => declaration.version === platformProfileVersion) === true,
      `Capability ${capability} must include version ${platformProfileVersion}.`
    )
  }
  for (const capability of prohibitedCapabilities) {
    assert(!Object.hasOwn(advertisedCapabilities, capability), `Unimplemented capability ${capability} must not be advertised.`)
  }
  for (const [capability, declarations] of Object.entries(typedProfile.ucp.capabilities ?? {})) {
    assert(
      declarations?.some((declaration) => declaration.version === platformProfileVersion) === true,
      `Advertised capability ${capability} must include version ${platformProfileVersion}.`
    )
  }

  let signingKeys: Array<Record<string, unknown>> = []
  try {
    signingKeys = resolveUcpProfileSigningKeys(typedProfile)
  } catch (error) {
    failures.push(error instanceof Error ? error.message : 'UCP profile signing keys are invalid.')
  }
  if (requireSigningKeys) {
    assert(signingKeys.length > 0, 'Production UCP platform profile must publish at least one signing key.')
    assert(Array.isArray(typedProfile.keys), 'Production profile must publish canonical root keys.')
    assert(!Object.hasOwn(typedProfile, 'signing_keys'), 'UCP v2026-08-25 profile must not publish legacy signing_keys.')
  }
  for (const key of signingKeys) {
    assert(
      key.kty === 'EC' && key.crv === 'P-256' && key.alg === 'ES256' && key.use === 'sig',
      `Signing key ${String(key.kid)} must be a public EC P-256 ES256 signature key.`
    )
    assert(typeof key.x === 'string' && typeof key.y === 'string', `Signing key ${String(key.kid)} must include public x and y coordinates.`)
    assert(!('d' in key), `Signing key ${String(key.kid)} must not expose private key material.`)
  }
  if (expectedActiveSigningKey) {
    assert(
      signingKeySetStartsWithExactKey(typedProfile.keys, expectedActiveSigningKey),
      `Live UCP profile root keys[0] must be the exact configured active signing key ${String(expectedActiveSigningKey.kid)}.`
    )
  }
}

if (failures.length > 0) {
  console.error(`UCP verification failed for ${endpoint?.toString() ?? baseUrl}`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  const typedProfile = profile as ArroPlatformProfile
  const capabilityCount = Object.keys(typedProfile.ucp.capabilities ?? {}).length
  const transports = (typedProfile.ucp.services['dev.ucp.shopping'] ?? []).map((service) => service.transport).join('/')
  const paymentHandlerCount = Object.keys(typedProfile.ucp.payment_handlers).length
  console.log(`UCP verification passed for ${endpoint!.toString()}`)
  const signingKeyCount = resolveUcpProfileSigningKeys(typedProfile).length
  console.log(`Validated ${capabilityCount} advertised capabilities, ${transports} client bindings, ${paymentHandlerCount} payment handler namespaces, ${signingKeyCount} signing keys, cache max-age ${maxAge}s, and platform-profile shape.`)
}
