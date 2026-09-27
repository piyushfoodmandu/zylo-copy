import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type {
  UcpAccessPolicyState,
  UcpDiscoveredProfileSummary,
  UcpDiscoveryRequest,
  UcpDiscoveryResponse
} from '@arro/contracts'
import {
  UCP_STABLE_VERSION,
  resolveUcpProfileSigningKeys,
  validateUcpNamespaceSchemaAuthority
} from '@arro/contracts'
import {
  discardResponseBody,
  readLimitedBody
} from './http-response-body.ts'
import {
  createConnectorHttpFetcher,
  type ConnectorHttpFetcher,
  type ConnectorHttpResponse
} from './http-transport.ts'

type ResolverAddress = { address: string }
type Resolver = (hostname: string) => Promise<ResolverAddress[]>

export type DiscoverUcpProfileOptions = {
  requestId: string
  correlationId: string
  now?: Date
  fetcher?: ConnectorHttpFetcher
  resolver?: Resolver
  platformProfileUrl?: string
  timeoutMs?: number
  maxBytes?: number
  internalMaxCacheAgeSeconds?: number
}

const defaultTimeoutMs = 5_000
const defaultMaxBytes = 256 * 1024
const defaultInternalMaxCacheAgeSeconds = 3_600

const unique = (values: string[]) => [...new Set(values.filter(Boolean))]

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

const asString = (value: unknown) => {
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const headerValue = (value: string) => value.replace(/[\r\n"]/g, '')
const ucpAgentHeader = (profileUrl: string) => `profile="${headerValue(profileUrl)}"`

const registryKeys = (value: unknown): string[] => {
  const record = asRecord(value)
  if (record) return Object.keys(record)
  return []
}

const plainMessage = (
  severity: 'info' | 'warning' | 'error',
  code: string,
  text: string,
  nextAction?: string
) => ({
  severity,
  code,
  text,
  ...(nextAction ? { nextAction } : {})
})

const evidenceBase = () => ({
  httpsOnly: true as const,
  redirectsAllowed: false as const,
  privateNetworkBlocked: true as const
})

const buildProfileUrl = (domain: string) => {
  const normalizedDomain = domain.trim().toLowerCase()
  return {
    domain: normalizedDomain,
    profileUrl: `https://${normalizedDomain}/.well-known/ucp`
  }
}

const isBlockedIpv4 = (address: string) => {
  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true
  }

  const [first, second] = parts as [number, number, number, number]

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first === 169 && second === 254 ||
    first === 172 && second >= 16 && second <= 31 ||
    first === 192 && second === 168 ||
    first === 100 && second >= 64 && second <= 127 ||
    first >= 224
  )
}

const isBlockedIpv6 = (address: string) => {
  const normalized = address.toLowerCase()

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('ff')
  )
}

const isBlockedAddress = (address: string) => {
  const version = isIP(address)
  if (version === 4) return isBlockedIpv4(address)
  if (version === 6) return isBlockedIpv6(address)
  return true
}

const resolvePublicAddresses = async (domain: string, resolver: Resolver) => {
  const addresses = isIP(domain) ? [{ address: domain }] : await resolver(domain)

  if (addresses.length === 0) {
    throw new Error('The discovery target did not resolve to an address.')
  }

  const blockedAddress = addresses.find((entry) => isBlockedAddress(entry.address))
  if (blockedAddress) {
    throw new Error('The discovery target resolved to a private or otherwise blocked network address.')
  }

  return addresses.map((entry) => entry.address)
}

const parseMaxAge = (cacheControl: string | undefined) => {
  if (!cacheControl) return undefined

  const match = /(?:^|,\s*)max-age=(\d+)/i.exec(cacheControl)
  return match?.[1] ? Number(match[1]) : undefined
}

const profileRoot = (profile: unknown) => {
  const root = asRecord(profile)
  if (!root) return undefined

  const canonical = asRecord(root.ucp)
  if (!canonical) return undefined
  return {
    shape: 'canonical_ucp' as const,
    root: canonical
  }
}

const serviceRecords = (root: Record<string, unknown>) => {
  const services = root.services

  const serviceMap = asRecord(services)
  if (serviceMap) {
    return Object.entries(serviceMap).flatMap(([namespace, service]) => {
      if (Array.isArray(service)) {
        return service.flatMap((entry) => {
          const record = asRecord(entry)
          return record ? [{ namespace, record }] : []
        })
      }

      return []
    })
  }

  return []
}

const serviceSummary = ({
  namespace,
  record
}: {
  namespace?: string
  record: Record<string, unknown>
}) => {
  const declaredNamespace = asString(namespace)
  const id = asString(record.id)
  const url = asString(record.endpoint)

  return {
    ...(declaredNamespace ? { namespace: declaredNamespace } : {}),
    ...(id ? { id } : {}),
    transport: asString(record.transport) ?? 'unknown',
    ...(url ? { url } : {}),
    capabilities: []
  }
}

const supportedVersionUrls = (root: Record<string, unknown>) => {
  const supportedVersions = asRecord(root.supported_versions)
  if (!supportedVersions) return []

  return unique(Object.values(supportedVersions).flatMap((value) => asString(value) ?? [])).sort()
}

const protocolVersions = (root: Record<string, unknown>) => unique([
  asString(root.version),
  ...Object.keys(asRecord(root.supported_versions) ?? {})
].flatMap((value) => value ?? [])).sort()

const signingKeyCount = (profile: unknown) => {
  const root = asRecord(profile)
  if (!root || !Object.hasOwn(root, 'keys')) return 0
  try {
    return resolveUcpProfileSigningKeys({ keys: root.keys }).length
  } catch {
    return 0
  }
}

const versionPattern = /^\d{4}-\d{2}-\d{2}$/
const transports = new Set(['rest', 'mcp', 'a2a', 'embedded'])

const isAbsoluteHttpsUrl = (value: unknown) => {
  const raw = asString(value)
  if (!raw) return false
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

const registryIssue = (
  value: unknown,
  name: string,
  check: (namespace: string, declaration: Record<string, unknown>, path: string) => string | undefined
) => {
  const registry = asRecord(value)
  if (!registry) return `${name} must be a canonical registry object.`

  for (const [namespace, declarations] of Object.entries(registry)) {
    if (!Array.isArray(declarations)) return `${name}.${namespace} must be an array.`
    for (const [index, value] of declarations.entries()) {
      const declaration = asRecord(value)
      const path = `${name}.${namespace}[${index}]`
      if (!declaration) return `${path} must be an object.`
      const issue = check(namespace, declaration, path)
      if (issue) return issue
    }
  }

  return undefined
}

const exactBusinessProfileIssue = (
  profile: unknown,
  options: { leaf: boolean }
) => {
  const root = asRecord(profile)
  const ucp = asRecord(root?.ucp)
  if (!root || !ucp) return 'The document must contain the canonical root ucp object.'
  if (ucp.version !== UCP_STABLE_VERSION) {
    return `The selected profile must declare UCP ${UCP_STABLE_VERSION}.`
  }
  if (options.leaf && Object.hasOwn(ucp, 'supported_versions')) {
    return 'A supported_versions target must be a self-contained leaf without supported_versions.'
  }

  const serviceIssue = registryIssue(ucp.services, 'ucp.services', (namespace, declaration, path) => {
    const version = asString(declaration.version)
    const transport = asString(declaration.transport)
    if (!version || !versionPattern.test(version)) return `${path}.version must be a dated release.`
    if (!transport || !transports.has(transport)) return `${path}.transport is invalid.`
    if (transport !== 'embedded' && !isAbsoluteHttpsUrl(declaration.endpoint)) {
      return `${path}.endpoint must be an absolute HTTPS URL.`
    }
    if (declaration.spec !== undefined && !isAbsoluteHttpsUrl(declaration.spec)) {
      return `${path}.spec must be an absolute HTTPS URL.`
    }
    if (declaration.schema !== undefined &&
      (!isAbsoluteHttpsUrl(declaration.schema) ||
        !validateUcpNamespaceSchemaAuthority(namespace, asString(declaration.schema)).ok)) {
      return `${path}.schema must be an HTTPS URL bound to ${namespace}.`
    }
    if (namespace.startsWith('dev.ucp.') && version !== UCP_STABLE_VERSION) {
      return `${path}.version must match the selected UCP release.`
    }
    return undefined
  })
  if (serviceIssue) return serviceIssue

  if (ucp.capabilities !== undefined) {
    const capabilityIssue = registryIssue(
      ucp.capabilities,
      'ucp.capabilities',
      (namespace, declaration, path) => {
        const version = asString(declaration.version)
        if (!version || !versionPattern.test(version)) return `${path}.version must be a dated release.`
        const schema = asString(declaration.schema)
        if (!schema || !isAbsoluteHttpsUrl(schema) ||
          !validateUcpNamespaceSchemaAuthority(namespace, schema).ok) {
          return `${path}.schema must be a required HTTPS URL bound to ${namespace}.`
        }
        if (declaration.spec !== undefined && !isAbsoluteHttpsUrl(declaration.spec)) {
          return `${path}.spec must be an absolute HTTPS URL.`
        }
        if (namespace.startsWith('dev.ucp.') && version !== UCP_STABLE_VERSION) {
          return `${path}.version must match the selected UCP release.`
        }
        return undefined
      }
    )
    if (capabilityIssue) return capabilityIssue
  }

  const handlerIssue = registryIssue(
    ucp.payment_handlers,
    'ucp.payment_handlers',
    (namespace, declaration, path) => {
      if (!asString(declaration.id)) return `${path}.id is required.`
      const version = asString(declaration.version)
      if (!version || !versionPattern.test(version)) {
        return `${path}.version must be an explicit handler-owned dated release.`
      }
      if (declaration.spec !== undefined && !isAbsoluteHttpsUrl(declaration.spec)) {
        return `${path}.spec must be an absolute HTTPS URL.`
      }
      if (declaration.schema !== undefined) {
        const schema = asString(declaration.schema)
        if (!schema || !isAbsoluteHttpsUrl(schema) ||
          !validateUcpNamespaceSchemaAuthority(namespace, schema).ok) {
          return `${path}.schema must be an HTTPS URL bound to ${namespace}.`
        }
      }
      return undefined
    }
  )
  if (handlerIssue) return handlerIssue

  if (!options.leaf && ucp.supported_versions !== undefined) {
    const supportedVersions = asRecord(ucp.supported_versions)
    if (!supportedVersions) return 'ucp.supported_versions must be an object.'
    for (const [version, url] of Object.entries(supportedVersions)) {
      if (!versionPattern.test(version) || !isAbsoluteHttpsUrl(url)) {
        return `ucp.supported_versions.${version} must map a dated release to an absolute HTTPS URI.`
      }
    }
  }

  if (root.keys !== undefined) {
    try {
      resolveUcpProfileSigningKeys({ keys: root.keys })
    } catch (error) {
      return `keys must be a canonical public JWK set: ${error instanceof Error ? error.message : 'invalid keys'}`
    }
  }

  return undefined
}

const summarizeProfile = ({
  domain,
  profileUrl,
  rawBody,
  parsedProfile,
  cacheControl,
  checkedAddresses,
  validatedAt,
  internalMaxCacheAgeSeconds
}: {
  domain: string
  profileUrl: string
  rawBody: string
  parsedProfile: unknown
  cacheControl?: string
  checkedAddresses: string[]
  validatedAt: Date
  internalMaxCacheAgeSeconds: number
}): UcpDiscoveredProfileSummary | undefined => {
  const profile = profileRoot(parsedProfile)
  if (!profile) return undefined

  const services = serviceRecords(profile.root).map(serviceSummary)
  const capabilities = unique(registryKeys(profile.root.capabilities)).sort()
  const transports = unique(services.map((service) => service.transport)).sort()
  const maxAgeSeconds = parseMaxAge(cacheControl)

  return {
    domain,
    profileUrl,
    profileHash: `sha256:${createHash('sha256').update(rawBody).digest('hex')}`,
    profileShape: profile.shape,
    protocolVersions: protocolVersions(profile.root),
    supportedVersionUrls: supportedVersionUrls(profile.root),
    services,
    capabilities,
    paymentHandlers: unique(registryKeys(profile.root.payment_handlers)).sort(),
    signingKeyCount: signingKeyCount(parsedProfile),
    cache: {
      ...(cacheControl ? { cacheControl } : {}),
      ...(maxAgeSeconds !== undefined ? { maxAgeSeconds } : {}),
      internallyCappedMaxAgeSeconds: Math.min(maxAgeSeconds ?? internalMaxCacheAgeSeconds, internalMaxCacheAgeSeconds)
    },
    dns: {
      hostname: domain,
      checkedAddresses
    },
    validatedAt: validatedAt.toISOString()
  }
}

const classifyAccessState = (profile: UcpDiscoveredProfileSummary): UcpAccessPolicyState => {
  if (profile.services.length === 0 && profile.capabilities.length === 0) return 'error'
  return 'profile_fetched'
}

const failureResponse = ({
  request,
  options,
  domain,
  profileUrl,
  status,
  accessPolicyState,
  code,
  text,
  httpStatus,
  contentType,
  responseBytes,
  latencyMs,
  nextAction
}: {
  request: UcpDiscoveryRequest
  options: Required<Pick<DiscoverUcpProfileOptions, 'requestId' | 'correlationId'>> & { now: Date }
  domain?: string
  profileUrl?: string
  status: UcpDiscoveryResponse['status']
  accessPolicyState: UcpAccessPolicyState
  code: string
  text: string
  httpStatus?: number
  contentType?: string
  responseBytes?: number
  latencyMs?: number
  nextAction?: string
}): UcpDiscoveryResponse => {
  const fallback = buildProfileUrl(request.domain)

  return {
    requestId: options.requestId,
    correlationId: options.correlationId,
    status,
    accessPolicyState,
    domain: domain ?? fallback.domain,
    profileUrl: profileUrl ?? fallback.profileUrl,
    ...(httpStatus !== undefined ? { httpStatus } : {}),
    fetchedAt: options.now.toISOString(),
    evidence: {
      ...evidenceBase(),
      ...(contentType ? { contentType } : {}),
      ...(responseBytes !== undefined ? { responseBytes } : {}),
      ...(latencyMs !== undefined ? { latencyMs } : {})
    },
    messages: [plainMessage(status === 'error' ? 'error' : 'warning', code, text, nextAction)]
  }
}

export const discoverUcpProfile = async (
  request: UcpDiscoveryRequest,
  options: DiscoverUcpProfileOptions
): Promise<UcpDiscoveryResponse> => {
  const now = options.now ?? new Date()
  const requiredOptions = {
    requestId: options.requestId,
    correlationId: options.correlationId,
    now
  }
  const { domain, profileUrl } = buildProfileUrl(request.domain)
  const resolver = options.resolver ?? ((hostname: string) => lookup(hostname, { all: true }))
  const fetcher = options.fetcher ?? createConnectorHttpFetcher()
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs
  const maxBytes = options.maxBytes ?? defaultMaxBytes
  const internalMaxCacheAgeSeconds = options.internalMaxCacheAgeSeconds ?? defaultInternalMaxCacheAgeSeconds
  let checkedAddresses: string[]

  try {
    checkedAddresses = await resolvePublicAddresses(domain, resolver)
  } catch (error) {
    return failureResponse({
      request,
      options: requiredOptions,
      domain,
      profileUrl,
      status: 'blocked',
      accessPolicyState: 'unknown',
      code: 'discovery_target_blocked',
      text: error instanceof Error ? error.message : 'The UCP discovery target was blocked.',
      nextAction: 'Use a public HTTPS business domain for UCP discovery.'
    })
  }

  const startedAt = performance.now()
  let response: ConnectorHttpResponse

  try {
    response = await fetcher(profileUrl, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(options.platformProfileUrl ? { 'UCP-Agent': ucpAgentHeader(options.platformProfileUrl) } : {})
      },
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    return failureResponse({
      request,
      options: requiredOptions,
      domain,
      profileUrl,
      status: 'error',
      accessPolicyState: 'error',
      code: 'profile_fetch_failed',
      text: error instanceof Error ? error.message : 'The UCP profile could not be fetched.',
      latencyMs: performance.now() - startedAt,
      nextAction: 'Retry under connector rate limits or review business access evidence.'
    })
  }

  const latencyMs = performance.now() - startedAt
  const contentType = response.headers.get('content-type') ?? undefined

  if (response.status >= 300 && response.status < 400) {
    discardResponseBody(response)
    return failureResponse({
      request,
      options: requiredOptions,
      domain,
      profileUrl,
      status: 'blocked',
      accessPolicyState: 'unknown',
      code: 'profile_redirect_blocked',
      text: 'UCP discovery does not follow redirects.',
      httpStatus: response.status,
      ...(contentType ? { contentType } : {}),
      latencyMs,
      nextAction: 'Publish a non-redirecting HTTPS /.well-known/ucp profile.'
    })
  }

  if (response.status === 404) {
    discardResponseBody(response)
    return failureResponse({
      request,
      options: requiredOptions,
      domain,
      profileUrl,
      status: 'not_found',
      accessPolicyState: 'unknown',
      code: 'profile_not_found',
      text: 'No public UCP profile was found at this business domain.',
      httpStatus: response.status,
      ...(contentType ? { contentType } : {}),
      latencyMs,
      nextAction: 'Keep this business in unsupported fallback until official connector evidence exists.'
    })
  }

  if (!response.ok) {
    discardResponseBody(response)
    return failureResponse({
      request,
      options: requiredOptions,
      domain,
      profileUrl,
      status: 'error',
      accessPolicyState: response.status === 429 ? 'rate_limited' : 'error',
      code: 'profile_fetch_error',
      text: `The UCP profile returned HTTP ${response.status}.`,
      httpStatus: response.status,
      ...(contentType ? { contentType } : {}),
      latencyMs,
      nextAction: 'Retry under connector rate limits or review business access state.'
    })
  }

  if (!contentType?.toLowerCase().includes('json')) {
    discardResponseBody(response)
    return failureResponse({
      request,
      options: requiredOptions,
      domain,
      profileUrl,
      status: 'invalid_profile',
      accessPolicyState: 'error',
      code: 'profile_content_type_invalid',
      text: 'The UCP profile response was not JSON.',
      httpStatus: response.status,
      ...(contentType ? { contentType } : {}),
      latencyMs,
      nextAction: 'Publish a JSON UCP profile before connector approval.'
    })
  }

  let rawBody: string

  try {
    rawBody = await readLimitedBody(response, maxBytes, {
      tooLargeMessage: `The UCP profile response exceeded ${maxBytes} bytes.`
    })
  } catch (error) {
    return failureResponse({
      request,
      options: requiredOptions,
      domain,
      profileUrl,
      status: 'invalid_profile',
      accessPolicyState: 'error',
      code: 'profile_body_invalid',
      text: error instanceof Error ? error.message : 'The UCP profile body could not be read safely.',
      httpStatus: response.status,
      ...(contentType ? { contentType } : {}),
      latencyMs,
      nextAction: 'Reduce profile size and publish valid JSON.'
    })
  }

  let parsedProfile: unknown

  try {
    parsedProfile = JSON.parse(rawBody)
  } catch {
    return failureResponse({
      request,
      options: requiredOptions,
      domain,
      profileUrl,
      status: 'invalid_profile',
      accessPolicyState: 'error',
      code: 'profile_json_invalid',
      text: 'The UCP profile response body was not valid JSON.',
      httpStatus: response.status,
      ...(contentType ? { contentType } : {}),
      responseBytes: Buffer.byteLength(rawBody),
      latencyMs,
      nextAction: 'Publish valid UCP profile JSON before connector approval.'
    })
  }

  let selectedProfileUrl = profileUrl
  let selectedRawBody = rawBody
  let selectedProfile = parsedProfile
  let selectedResponse = response
  let selectedContentType: string | undefined = contentType
  let selectedCheckedAddresses = checkedAddresses
  let selectedLatencyMs = latencyMs
  let selectedFromLeaf = false

  const currentRoot = asRecord(parsedProfile)
  const currentUcp = asRecord(currentRoot?.ucp)
  const currentVersion = asString(currentUcp?.version)
  if (!currentRoot || !currentUcp || !currentVersion || !versionPattern.test(currentVersion)) {
    return failureResponse({
      request,
      options: requiredOptions,
      domain,
      profileUrl,
      status: 'invalid_profile',
      accessPolicyState: 'error',
      code: 'profile_shape_invalid',
      text: 'The discovery document must use the canonical ucp.version profile shape.',
      httpStatus: response.status,
      ...(contentType ? { contentType } : {}),
      responseBytes: Buffer.byteLength(rawBody),
      latencyMs,
      nextAction: `Publish a canonical UCP ${UCP_STABLE_VERSION} business profile.`
    })
  }

  if (currentVersion !== UCP_STABLE_VERSION) {
    const supportedVersions = asRecord(currentUcp.supported_versions)
    const mappedLeaf = asString(supportedVersions?.[UCP_STABLE_VERSION])
    if (!mappedLeaf) {
      return failureResponse({
        request,
        options: requiredOptions,
        domain,
        profileUrl,
        status: 'invalid_profile',
        accessPolicyState: 'error',
        code: 'profile_version_incompatible',
        text: `The business does not publish a UCP ${UCP_STABLE_VERSION} profile.`,
        httpStatus: response.status,
        ...(contentType ? { contentType } : {}),
        responseBytes: Buffer.byteLength(rawBody),
        latencyMs,
        nextAction: `Add supported_versions.${UCP_STABLE_VERSION} with a complete leaf profile URI.`
      })
    }

    let leafUrl: URL
    try {
      leafUrl = new URL(mappedLeaf)
      if (leafUrl.protocol !== 'https:' || leafUrl.username || leafUrl.password) throw new Error('invalid')
    } catch {
      return failureResponse({
        request,
        options: requiredOptions,
        domain,
        profileUrl,
        status: 'invalid_profile',
        accessPolicyState: 'error',
        code: 'profile_leaf_url_invalid',
        text: `supported_versions.${UCP_STABLE_VERSION} must be an absolute HTTPS URI without credentials.`,
        httpStatus: response.status,
        latencyMs,
        nextAction: 'Publish a valid version-specific profile URI.'
      })
    }

    try {
      selectedCheckedAddresses = await resolvePublicAddresses(leafUrl.hostname, resolver)
    } catch (error) {
      return failureResponse({
        request,
        options: requiredOptions,
        domain,
        profileUrl: leafUrl.href,
        status: 'blocked',
        accessPolicyState: 'unknown',
        code: 'profile_leaf_target_blocked',
        text: error instanceof Error ? error.message : 'The UCP leaf target was blocked.',
        latencyMs,
        nextAction: 'Host the version-specific profile on a public HTTPS origin.'
      })
    }

    const leafStartedAt = performance.now()
    try {
      selectedResponse = await fetcher(leafUrl.href, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...(options.platformProfileUrl ? { 'UCP-Agent': ucpAgentHeader(options.platformProfileUrl) } : {})
        },
        signal: AbortSignal.timeout(timeoutMs)
      })
    } catch (error) {
      return failureResponse({
        request,
        options: requiredOptions,
        domain,
        profileUrl: leafUrl.href,
        status: 'error',
        accessPolicyState: 'error',
        code: 'profile_leaf_fetch_failed',
        text: error instanceof Error ? error.message : 'The UCP leaf profile could not be fetched.',
        latencyMs: performance.now() - leafStartedAt,
        nextAction: 'Publish an available, non-redirecting UCP version leaf.'
      })
    }

    selectedLatencyMs = performance.now() - leafStartedAt
    selectedContentType = selectedResponse.headers.get('content-type') ?? undefined
    if (selectedResponse.status >= 300 && selectedResponse.status < 400) {
      discardResponseBody(selectedResponse)
      return failureResponse({
        request,
        options: requiredOptions,
        domain,
        profileUrl: leafUrl.href,
        status: 'blocked',
        accessPolicyState: 'unknown',
        code: 'profile_leaf_redirect_blocked',
        text: 'UCP version-specific profile discovery does not follow redirects.',
        httpStatus: selectedResponse.status,
        ...(selectedContentType ? { contentType: selectedContentType } : {}),
        latencyMs: selectedLatencyMs,
        nextAction: 'Publish the leaf profile directly at its advertised HTTPS URI.'
      })
    }
    if (!selectedResponse.ok || !selectedContentType?.toLowerCase().includes('json')) {
      discardResponseBody(selectedResponse)
      return failureResponse({
        request,
        options: requiredOptions,
        domain,
        profileUrl: leafUrl.href,
        status: 'invalid_profile',
        accessPolicyState: 'error',
        code: 'profile_leaf_response_invalid',
        text: `The UCP version leaf returned ${selectedResponse.status} without a JSON success response.`,
        httpStatus: selectedResponse.status,
        ...(selectedContentType ? { contentType: selectedContentType } : {}),
        latencyMs: selectedLatencyMs,
        nextAction: 'Publish a JSON UCP version leaf with an HTTP success status.'
      })
    }

    try {
      selectedRawBody = await readLimitedBody(selectedResponse, maxBytes, {
        tooLargeMessage: `The UCP leaf profile exceeded ${maxBytes} bytes.`
      })
      selectedProfile = JSON.parse(selectedRawBody)
    } catch (error) {
      return failureResponse({
        request,
        options: requiredOptions,
        domain,
        profileUrl: leafUrl.href,
        status: 'invalid_profile',
        accessPolicyState: 'error',
        code: 'profile_leaf_body_invalid',
        text: error instanceof Error ? error.message : 'The UCP leaf profile body was invalid.',
        httpStatus: selectedResponse.status,
        ...(selectedContentType ? { contentType: selectedContentType } : {}),
        latencyMs: selectedLatencyMs,
        nextAction: 'Publish a bounded, valid JSON UCP version leaf.'
      })
    }

    selectedProfileUrl = leafUrl.href
    selectedFromLeaf = true
  }

  const exactProfileIssue = exactBusinessProfileIssue(selectedProfile, { leaf: selectedFromLeaf })
  if (exactProfileIssue) {
    return failureResponse({
      request,
      options: requiredOptions,
      domain,
      profileUrl: selectedProfileUrl,
      status: 'invalid_profile',
      accessPolicyState: 'error',
      code: selectedFromLeaf ? 'profile_leaf_invalid' : 'profile_shape_invalid',
      text: exactProfileIssue,
      httpStatus: selectedResponse.status,
      ...(selectedContentType ? { contentType: selectedContentType } : {}),
      responseBytes: Buffer.byteLength(selectedRawBody),
      latencyMs: selectedLatencyMs,
      nextAction: `Publish a complete canonical UCP ${UCP_STABLE_VERSION} business profile.`
    })
  }

  const cacheControl = selectedResponse.headers.get('cache-control') ?? undefined
  const profile = summarizeProfile({
    domain,
    profileUrl: selectedProfileUrl,
    rawBody: selectedRawBody,
    parsedProfile: selectedProfile,
    ...(cacheControl ? { cacheControl } : {}),
    checkedAddresses: selectedCheckedAddresses,
    validatedAt: now,
    internalMaxCacheAgeSeconds
  })

  if (!profile) {
    return failureResponse({
      request,
      options: requiredOptions,
      domain,
      profileUrl,
      status: 'invalid_profile',
      accessPolicyState: 'error',
      code: 'profile_shape_invalid',
      text: 'The UCP profile did not contain a valid object shape.',
      httpStatus: response.status,
      ...(contentType ? { contentType } : {}),
      responseBytes: Buffer.byteLength(rawBody),
      latencyMs,
      nextAction: 'Publish a schema-valid business UCP profile.'
    })
  }

  const accessPolicyState = classifyAccessState(profile)

  return {
    requestId: options.requestId,
    correlationId: options.correlationId,
    status: accessPolicyState === 'error' ? 'invalid_profile' : 'fetched',
    accessPolicyState,
    domain,
    profileUrl: selectedProfileUrl,
    httpStatus: selectedResponse.status,
    fetchedAt: now.toISOString(),
    evidence: {
      ...evidenceBase(),
      ...(selectedContentType ? { contentType: selectedContentType } : {}),
      responseBytes: Buffer.byteLength(selectedRawBody),
      latencyMs: selectedLatencyMs
    },
    profile,
    messages: [
      plainMessage(
        accessPolicyState === 'error' ? 'warning' : 'info',
        accessPolicyState === 'error' ? 'profile_incomplete' : 'profile_fetched',
        accessPolicyState === 'error'
          ? 'The UCP profile was fetched but did not declare usable services or capabilities.'
          : 'The UCP profile was fetched and summarized. Connector approval is still unresolved.',
        accessPolicyState === 'error'
          ? 'Review the business profile schema before using it for connector work.'
          : 'Record approval, auth, data-use terms, and capability scope before enabling product or commerce actions.'
      )
    ]
  }
}
