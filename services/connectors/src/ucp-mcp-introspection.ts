import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { PlainStatusMessage } from '@arro/contracts'
import {
  discardResponseBody,
  readJsonPayload
} from './http-response-body.ts'
import {
  createConnectorHttpFetcher,
  type ConnectorHttpFetcher,
  type ConnectorHttpResponse
} from './http-transport.ts'

type ResolverAddress = { address: string }
type Resolver = (hostname: string) => Promise<ResolverAddress[]>

type JsonRecord = Record<string, unknown>

export type UcpMcpToolSummary = {
  name: string
  description?: string
  inputSchema?: JsonRecord
}

export type UcpMcpToolIntrospectionStatus =
  | 'fetched'
  | 'blocked'
  | 'invalid_response'
  | 'error'

export type UcpMcpToolIntrospectionResult = {
  status: UcpMcpToolIntrospectionStatus
  endpointUrl: string
  fetchedAt: string
  latencyMs: number
  tools: UcpMcpToolSummary[]
  messages: PlainStatusMessage[]
}

export type UcpMcpToolIntrospectionOptions = {
  endpointUrl: string
  platformProfileUrl: string
  requestId: string
  now?: Date
  fetcher?: ConnectorHttpFetcher
  resolver?: Resolver
  timeoutMs?: number
  maxResponseBytes?: number
}

export type UcpMcpCatalogToolSupport = {
  searchCatalog: boolean
  lookupCatalog: boolean
  getProduct: boolean
}

export type UcpMcpCommerceToolSupport = UcpMcpCatalogToolSupport & {
  cart: {
    create: boolean
    get: boolean
    update: boolean
    cancel: boolean
  }
  checkout: {
    create: boolean
    get: boolean
    update: boolean
    complete: boolean
    cancel: boolean
  }
  order: {
    get: boolean
    list: boolean
  }
  discount: {
    apply: boolean
    validate: boolean
  }
  fulfillment: {
    getOptions: boolean
    update: boolean
  }
  identity: {
    link: boolean
    get: boolean
  }
  payment: {
    listMethods: boolean
    getMethods: boolean
    create: boolean
    authorize: boolean
    confirm: boolean
    handler: boolean
  }
}

const defaultTimeoutMs = 5_000
const defaultMaxResponseBytes = 256 * 1024
const mcpToolsJsonPayloadOptions = {
  invalidContentTypeMessage: 'ucp_mcp_tools_content_type_invalid',
  tooLargeMessage: 'ucp_mcp_tools_response_too_large'
}

const asRecord = (value: unknown): JsonRecord | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as JsonRecord
}

const asString = (value: unknown) => {
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
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

const normalizeHttpsUrl = (value: string, field: string) => {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new Error(`${field} must be a valid URL.`)
  }

  if (url.protocol !== 'https:') throw new Error(`${field} must use HTTPS.`)
  return url.toString()
}

const resolvePublicEndpoint = async (endpointUrl: string, resolver: Resolver) => {
  const hostname = new URL(endpointUrl).hostname
  const addresses = isIP(hostname) ? [{ address: hostname }] : await resolver(hostname)

  if (addresses.length === 0) throw new Error('The MCP endpoint did not resolve to an address.')
  const blockedAddress = addresses.find((entry) => isBlockedAddress(entry.address))
  if (blockedAddress) throw new Error('The MCP endpoint resolved to a private or otherwise blocked network address.')
}

const message = (
  severity: PlainStatusMessage['severity'],
  code: string,
  text: string,
  nextAction?: string
): PlainStatusMessage => ({
  severity,
  code,
  text,
  ...(nextAction ? { nextAction } : {})
})

const result = ({
  status,
  endpointUrl,
  startedAt,
  now,
  tools = [],
  messages
}: {
  status: UcpMcpToolIntrospectionStatus
  endpointUrl: string
  startedAt: number
  now: Date
  tools?: UcpMcpToolSummary[]
  messages: PlainStatusMessage[]
}): UcpMcpToolIntrospectionResult => ({
  status,
  endpointUrl,
  fetchedAt: now.toISOString(),
  latencyMs: Math.max(performance.now() - startedAt, 0),
  tools,
  messages
})

const firstArray = (...values: unknown[]) => {
  for (const value of values) {
    if (Array.isArray(value)) return value
  }

  return undefined
}

const toolFromRecord = (value: unknown): UcpMcpToolSummary | undefined => {
  const record = asRecord(value)
  const name = asString(record?.name)
  if (!record || !name) return undefined

  const description = asString(record.description)
  const inputSchema = asRecord(record.inputSchema) ?? asRecord(record.input_schema)

  return {
    name,
    ...(description ? { description } : {}),
    ...(inputSchema ? { inputSchema } : {})
  }
}

const toolsFromPayload = (payload: unknown) => {
  const root = asRecord(payload)
  const resultRecord = asRecord(root?.result)
  const structuredContent = asRecord(resultRecord?.structuredContent) ?? asRecord(resultRecord?.structured_content)
  const candidates = firstArray(
    root?.tools,
    resultRecord?.tools,
    structuredContent?.tools
  )

  if (!candidates) throw new Error('ucp_mcp_tools_missing')

  return candidates.flatMap((entry) => toolFromRecord(entry) ?? [])
}

const toolsListBody = ({ requestId, platformProfileUrl }: { requestId: string, platformProfileUrl: string }) => ({
  jsonrpc: '2.0',
  method: 'tools/list',
  id: requestId,
  params: {
    arguments: {
      meta: {
        'ucp-agent': {
          profile: platformProfileUrl
        }
      }
    }
  }
})

export const catalogToolSupportFromMcpTools = (
  tools: UcpMcpToolSummary[]
): UcpMcpCatalogToolSupport => {
  const names = new Set(tools.map((tool) => tool.name))

  return {
    searchCatalog: names.has('search_catalog'),
    lookupCatalog: names.has('lookup_catalog'),
    getProduct: names.has('get_product')
  }
}

const hasAnyTool = (names: Set<string>, candidates: string[]) =>
  candidates.some((candidate) => names.has(candidate))

export const commerceToolSupportFromMcpTools = (
  tools: UcpMcpToolSummary[]
): UcpMcpCommerceToolSupport => {
  const names = new Set(tools.map((tool) => tool.name))
  const catalog = catalogToolSupportFromMcpTools(tools)

  return {
    ...catalog,
    cart: {
      create: names.has('create_cart'),
      get: names.has('get_cart'),
      update: names.has('update_cart'),
      cancel: names.has('cancel_cart')
    },
    checkout: {
      create: names.has('create_checkout'),
      get: names.has('get_checkout'),
      update: names.has('update_checkout'),
      complete: names.has('complete_checkout'),
      cancel: names.has('cancel_checkout')
    },
    order: {
      get: hasAnyTool(names, ['get_order', 'lookup_order']),
      list: hasAnyTool(names, ['list_orders', 'search_orders'])
    },
    discount: {
      apply: hasAnyTool(names, ['apply_discount', 'apply_coupon']),
      validate: hasAnyTool(names, ['validate_discount', 'validate_coupon'])
    },
    fulfillment: {
      getOptions: hasAnyTool(names, ['get_fulfillment_options', 'list_fulfillment_options']),
      update: hasAnyTool(names, ['update_fulfillment', 'select_fulfillment_option'])
    },
    identity: {
      link: hasAnyTool(names, ['link_identity', 'create_identity_link']),
      get: hasAnyTool(names, ['get_identity', 'get_buyer_identity'])
    },
    payment: {
      listMethods: hasAnyTool(names, ['list_payment_methods', 'list_payment_handlers']),
      getMethods: hasAnyTool(names, ['get_payment_methods', 'get_payment_handlers']),
      create: hasAnyTool(names, ['create_payment', 'create_payment_intent']),
      authorize: hasAnyTool(names, ['authorize_payment', 'authorize_payment_handler']),
      confirm: hasAnyTool(names, ['confirm_payment', 'complete_payment']),
      handler: hasAnyTool(names, ['payment_handler', 'prepare_payment_handler', 'negotiate_payment_handler'])
    }
  }
}

export const introspectUcpMcpTools = async ({
  endpointUrl,
  platformProfileUrl,
  requestId,
  now = new Date(),
  fetcher = createConnectorHttpFetcher(),
  resolver = (hostname: string) => lookup(hostname, { all: true }),
  timeoutMs = defaultTimeoutMs,
  maxResponseBytes = defaultMaxResponseBytes
}: UcpMcpToolIntrospectionOptions): Promise<UcpMcpToolIntrospectionResult> => {
  const startedAt = performance.now()
  let normalizedEndpointUrl: string
  let normalizedPlatformProfileUrl: string

  try {
    normalizedEndpointUrl = normalizeHttpsUrl(endpointUrl, 'endpointUrl')
    normalizedPlatformProfileUrl = normalizeHttpsUrl(platformProfileUrl, 'platformProfileUrl')
    await resolvePublicEndpoint(normalizedEndpointUrl, resolver)
  } catch (error) {
    return result({
      status: 'blocked',
      endpointUrl,
      startedAt,
      now,
      messages: [message(
        'warning',
        'ucp_mcp_tools_endpoint_blocked',
        error instanceof Error ? error.message : 'The MCP endpoint was blocked before tools could be listed.',
        'Use a public HTTPS MCP endpoint and public platform profile URL.'
      )]
    })
  }

  let response: ConnectorHttpResponse

  try {
    response = await fetcher(normalizedEndpointUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'UCP-Agent': normalizedPlatformProfileUrl
      },
      body: JSON.stringify(toolsListBody({ requestId, platformProfileUrl: normalizedPlatformProfileUrl })),
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch {
    return result({
      status: 'error',
      endpointUrl: normalizedEndpointUrl,
      startedAt,
      now,
      messages: [message(
        'warning',
        'ucp_mcp_tools_request_failed',
        'The MCP tools/list request failed before tools could be read.',
        'Inspect endpoint reachability, rate limits, request signing, credentials, and platform profile access.'
      )]
    })
  }

  if (!response.ok) {
    discardResponseBody(response)
    return result({
      status: response.status === 404 ? 'invalid_response' : 'error',
      endpointUrl: normalizedEndpointUrl,
      startedAt,
      now,
      messages: [message(
        'warning',
        response.status === 404 ? 'ucp_mcp_tools_not_found' : 'ucp_mcp_tools_http_error',
        `The MCP tools/list endpoint returned HTTP ${response.status}.`,
        'Keep this source disconnected until MCP tools/list succeeds under official access rules.'
      )]
    })
  }

  let payload: unknown

  try {
    payload = await readJsonPayload(response, maxResponseBytes, mcpToolsJsonPayloadOptions)
  } catch {
    return result({
      status: 'invalid_response',
      endpointUrl: normalizedEndpointUrl,
      startedAt,
      now,
      messages: [message(
        'warning',
        'ucp_mcp_tools_response_invalid',
        'The MCP tools/list response was not valid bounded JSON.',
        'Inspect the MCP endpoint response before compiling a runtime adapter.'
      )]
    })
  }

  const errorRecord = asRecord(rootError(payload))
  if (errorRecord) {
    return result({
      status: 'error',
      endpointUrl: normalizedEndpointUrl,
      startedAt,
      now,
      messages: [message(
        'warning',
        'ucp_mcp_tools_json_rpc_error',
        asString(errorRecord.message) ?? 'The MCP tools/list response contained a JSON-RPC error.',
        'Inspect MCP auth, capability negotiation, request metadata, and access tier.'
      )]
    })
  }

  let tools: UcpMcpToolSummary[]

  try {
    tools = toolsFromPayload(payload)
  } catch {
    return result({
      status: 'invalid_response',
      endpointUrl: normalizedEndpointUrl,
      startedAt,
      now,
      messages: [message(
        'warning',
        'ucp_mcp_tools_missing',
        'The MCP tools/list response did not include a tools array.',
        'Do not compile this source into a runtime adapter until tool discovery is schema-valid.'
      )]
    })
  }

  return result({
    status: 'fetched',
    endpointUrl: normalizedEndpointUrl,
    startedAt,
    now,
    tools,
    messages: [message(
      'info',
      'ucp_mcp_tools_fetched',
      'MCP tools were listed successfully. Adapter approval is still unresolved.',
      'Run live catalog probes and source governance before exposing product results.'
    )]
  })
}

const rootError = (payload: unknown) => asRecord(payload)?.error
