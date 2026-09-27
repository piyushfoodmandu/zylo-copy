import {
  createCatalogAdapterDispatcher,
  createCatalogProductDetailAdapterDispatcher,
  createShopifyGlobalCatalogBroadMcpFetcher,
  createShopifyGlobalCatalogBroadMcpProductDetailFetcher,
  createShopifyGlobalCatalogMcpFetcher,
  createShopifyGlobalCatalogMcpProductDetailFetcher,
  createShopifyStorefrontGraphqlCatalogFetcher,
  createShopifyStorefrontMcpCatalogFetcher,
  createShopifyStorefrontMcpCatalogProductDetailFetcher,
  createUcpMcpCatalogFetcher,
  createUcpMcpCatalogProductDetailFetcher,
  createUcpRestCatalogFetcher,
  createUcpRestCatalogProductDetailFetcher,
  createUnavailableCatalogFetcher,
  createUnavailableCatalogProductDetailFetcher,
  type CatalogSource,
  type CatalogAdapterDescriptor,
  type ConnectorHttpFetcher,
  type CatalogProductDetailFetcher,
  type CatalogProductFetcher,
  type UcpRestCatalogRequestMode
} from '@arro/connectors'

type RuntimeCatalogAdapterKind =
  | 'ucp_rest'
  | 'ucp_mcp'
  | 'shopify_storefront_mcp'
  | 'shopify_global_catalog_mcp'
  | 'shopify_storefront_graphql'
type RuntimeCatalogAdapterRecord = Record<string, unknown>
type RuntimeCatalogAdapterDescriptor = CatalogAdapterDescriptor & {
  source: CatalogSource
}

export type RuntimeCatalogAdapterOptions = {
  platformProfileUrl?: string
  allowLocalPlatformProfileUrl?: boolean
  fetcher?: ConnectorHttpFetcher
}

export type RuntimeCatalogAdapterRegistry = {
  fetcher: CatalogProductFetcher
  detailFetcher: CatalogProductDetailFetcher
  connectedSources: CatalogSource[]
}

export class RuntimeCatalogAdapterConfigError extends Error {
  readonly code: 'runtime_catalog_adapter_config_invalid'

  constructor(message: string) {
    super(message)
    this.name = 'RuntimeCatalogAdapterConfigError'
    this.code = 'runtime_catalog_adapter_config_invalid'
  }
}

const asRecord = (value: unknown): RuntimeCatalogAdapterRecord | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as RuntimeCatalogAdapterRecord
}

const asString = (value: unknown) => {
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const asPositiveInteger = (value: unknown) => {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value !== 'string') return undefined

  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

const sourceTypes = new Set<CatalogSource['sourceType']>([
  'direct_ucp',
  'managed_channel',
  'approved_feed'
])

const asSourceType = (value: unknown, adapterIndex: number) => {
  if (value === undefined) return undefined
  const sourceType = asString(value)
  if (sourceType && sourceTypes.has(sourceType as CatalogSource['sourceType'])) {
    return sourceType as CatalogSource['sourceType']
  }

  throw new RuntimeCatalogAdapterConfigError(
    `CATALOG_ADAPTERS_JSON[${adapterIndex}].sourceType must be direct_ucp, managed_channel, or approved_feed.`
  )
}

const hostnameFromUrl = (value: string) => {
  try {
    return new URL(value).hostname
  } catch {
    return undefined
  }
}

const defaultShopifyGlobalCatalogDomain = 'catalog.shopify.com'

export const defaultCatalogAdapterDescriptors = [
  {
    kind: 'shopify_global_catalog_mcp',
    mode: 'broad_discovery',
    adapterId: 'shopify-global-catalog',
    businessId: 'shopify-global-catalog'
  }
] as const

export const defaultCatalogAdaptersJson = JSON.stringify(defaultCatalogAdapterDescriptors)

export const resolveCatalogAdaptersJson = (env: NodeJS.ProcessEnv = process.env) =>
  env.CATALOG_ADAPTERS_JSON?.trim() || defaultCatalogAdaptersJson

const requiredString = (
  record: RuntimeCatalogAdapterRecord,
  field: string,
  adapterIndex: number
) => {
  const value = asString(record[field])
  if (!value) {
    throw new RuntimeCatalogAdapterConfigError(
      `CATALOG_ADAPTERS_JSON[${adapterIndex}].${field} must be a non-empty string.`
    )
  }

  return value
}

const optionalHeaders = (
  record: RuntimeCatalogAdapterRecord,
  adapterIndex: number
) => {
  const headers = record.headers
  if (headers === undefined) return undefined

  const headerRecord = asRecord(headers)
  if (!headerRecord) {
    throw new RuntimeCatalogAdapterConfigError(
      `CATALOG_ADAPTERS_JSON[${adapterIndex}].headers must be an object of string headers.`
    )
  }

  const entries = Object.entries(headerRecord).map(([name, value]) => {
    const headerValue = asString(value)
    if (!headerValue) {
      throw new RuntimeCatalogAdapterConfigError(
        `CATALOG_ADAPTERS_JSON[${adapterIndex}].headers.${name} must be a non-empty string.`
      )
    }

    return [name, headerValue] as const
  })

  return Object.fromEntries(entries)
}

const secretFromEnv = ({
  env,
  envName,
  adapterIndex,
  field
}: {
  env: NodeJS.ProcessEnv
  envName: string
  adapterIndex: number
  field: string
}) => {
  const value = env[envName]?.trim()
  if (!value) {
    throw new RuntimeCatalogAdapterConfigError(
      `CATALOG_ADAPTERS_JSON[${adapterIndex}].${field} references ${envName}, but that secret is not configured.`
    )
  }

  return value
}

const authHeaderValue = (token: string, scheme: string | undefined) => {
  if (!scheme || scheme.toLowerCase() === 'bearer') return `Bearer ${token}`
  if (scheme.toLowerCase() === 'raw') return token

  throw new RuntimeCatalogAdapterConfigError('Catalog adapter authScheme must be bearer or raw.')
}

const platformProfileUrlForAdapter = (
  record: RuntimeCatalogAdapterRecord,
  adapterIndex: number,
  options: RuntimeCatalogAdapterOptions
) => {
  const platformProfileUrl = asString(record.platformProfileUrl) ?? options.platformProfileUrl
  if (!platformProfileUrl) {
    throw new RuntimeCatalogAdapterConfigError(
      `CATALOG_ADAPTERS_JSON[${adapterIndex}].platformProfileUrl must be configured for MCP adapters.`
    )
  }

  return platformProfileUrl
}

const optionalAuthHeader = ({
  record,
  adapterIndex,
  env
}: {
  record: RuntimeCatalogAdapterRecord
  adapterIndex: number
  env: NodeJS.ProcessEnv
}) => {
  const authTokenEnv = asString(record.authTokenEnv)
  if (!authTokenEnv) return undefined

  const authScheme = asString(record.authScheme)
  const authHeaderName = asString(record.authHeaderName) ?? 'Authorization'

  return {
    name: authHeaderName,
    value: authHeaderValue(secretFromEnv({ env, envName: authTokenEnv, adapterIndex, field: 'authTokenEnv' }), authScheme)
  }
}

const ucpRestRequestModeFromRecord = (
  record: RuntimeCatalogAdapterRecord,
  adapterIndex: number
): UcpRestCatalogRequestMode => {
  const mode = asString(record.mode) ?? 'arro_post'
  if (mode === 'arro_post' || mode === 'ucp_products_get') return mode

  throw new RuntimeCatalogAdapterConfigError(
    `CATALOG_ADAPTERS_JSON[${adapterIndex}].mode must be arro_post or ucp_products_get for UCP REST adapters.`
  )
}

const connectedSourceFromRecord = ({
  record,
  adapterIndex,
  businessId,
  defaultDomain,
  defaultDisplayName,
  defaultSourceType
}: {
  record: RuntimeCatalogAdapterRecord
  adapterIndex: number
  businessId: string
  defaultDomain: string | undefined
  defaultDisplayName?: string
  defaultSourceType: CatalogSource['sourceType']
}): CatalogSource => {
  const domain = asString(record.domain) ?? defaultDomain
  if (!domain) {
    throw new RuntimeCatalogAdapterConfigError(
      `CATALOG_ADAPTERS_JSON[${adapterIndex}].domain must be configured or derivable for connected source metadata.`
    )
  }

  const displayName = asString(record.displayName) ?? defaultDisplayName ?? businessId
  const sourceType = asSourceType(record.sourceType, adapterIndex) ?? defaultSourceType
  const profileUrl = asString(record.profileUrl)
  const profileHash = asString(record.profileHash)

  return {
    businessId,
    domain,
    displayName,
    sourceType,
    ...(profileUrl ? { profileUrl } : {}),
    ...(profileHash ? { profileHash } : {})
  }
}

const createUcpRestDescriptor = ({
  record,
  adapterIndex,
  env,
  options
}: {
  record: RuntimeCatalogAdapterRecord
  adapterIndex: number
  env: NodeJS.ProcessEnv
  options: RuntimeCatalogAdapterOptions
}): RuntimeCatalogAdapterDescriptor => {
  const adapterId = requiredString(record, 'adapterId', adapterIndex)
  const businessId = requiredString(record, 'businessId', adapterIndex)
  const endpointUrl = requiredString(record, 'endpointUrl', adapterIndex)
  const mode = ucpRestRequestModeFromRecord(record, adapterIndex)
  const headers = optionalHeaders(record, adapterIndex)
  const authHeader = optionalAuthHeader({ record, adapterIndex, env })
  const fetcher = options.fetcher
  const source = connectedSourceFromRecord({
    record,
    adapterIndex,
    businessId,
    defaultDomain: hostnameFromUrl(endpointUrl),
    defaultSourceType: 'direct_ucp'
  })
  return {
    adapterId,
    businessId,
    transport: 'rest',
    source,
    fetcher: createUcpRestCatalogFetcher({
      adapterId,
      endpointUrl,
      mode,
      ...(mode === 'ucp_products_get'
        ? {
            sourceLabelFactType: 'connected_catalog_product',
            fetchedMessageCode: 'ucp_rest_products_catalog_fetched',
            fetchedMessageText: 'Connected UCP REST products were fetched and validated.'
          }
        : {}),
      ...(headers ? { headers } : {}),
      ...(authHeader ? { authHeader } : {}),
      ...(fetcher ? { fetcher } : {})
    }),
    detailFetcher: createUcpRestCatalogProductDetailFetcher({
      adapterId,
      endpointUrl,
      mode,
      ...(mode === 'ucp_products_get'
        ? {
            sourceLabelFactType: 'connected_catalog_product_detail',
            fetchedMessageCode: 'ucp_rest_products_product_detail_fetched',
            fetchedMessageText: 'Connected UCP REST product detail was fetched and validated.'
          }
        : {}),
      ...(headers ? { headers } : {}),
      ...(authHeader ? { authHeader } : {}),
      ...(fetcher ? { fetcher } : {})
    })
  }
}

const createUcpMcpDescriptor = ({
  record,
  adapterIndex,
  env,
  options
}: {
  record: RuntimeCatalogAdapterRecord
  adapterIndex: number
  env: NodeJS.ProcessEnv
  options: RuntimeCatalogAdapterOptions
}): RuntimeCatalogAdapterDescriptor => {
  const adapterId = requiredString(record, 'adapterId', adapterIndex)
  const businessId = requiredString(record, 'businessId', adapterIndex)
  const endpointUrl = requiredString(record, 'endpointUrl', adapterIndex)
  const platformProfileUrl = platformProfileUrlForAdapter(record, adapterIndex, options)
  const allowLocalPlatformProfileUrl = options.allowLocalPlatformProfileUrl === true
  const headers = optionalHeaders(record, adapterIndex)
  const authHeader = optionalAuthHeader({ record, adapterIndex, env })
  const fetcher = options.fetcher
  const source = connectedSourceFromRecord({
    record,
    adapterIndex,
    businessId,
    defaultDomain: hostnameFromUrl(endpointUrl),
    defaultSourceType: 'direct_ucp'
  })

  return {
    adapterId,
    businessId,
    transport: 'mcp',
    source,
    fetcher: createUcpMcpCatalogFetcher({
      adapterId,
      endpointUrl,
      platformProfileUrl,
      ...(allowLocalPlatformProfileUrl ? { allowLocalPlatformProfileUrl } : {}),
      ...(headers ? { headers } : {}),
      ...(authHeader ? { authHeader } : {}),
      ...(fetcher ? { fetcher } : {})
    }),
    detailFetcher: createUcpMcpCatalogProductDetailFetcher({
      adapterId,
      endpointUrl,
      platformProfileUrl,
      ...(allowLocalPlatformProfileUrl ? { allowLocalPlatformProfileUrl } : {}),
      sourceLabelFactType: 'connected_catalog_product_detail',
      fetchedMessageCode: 'ucp_mcp_connected_product_detail_fetched',
      fetchedMessageText: 'Connected UCP MCP product detail was fetched and validated.',
      ...(headers ? { headers } : {}),
      ...(authHeader ? { authHeader } : {}),
      ...(fetcher ? { fetcher } : {})
    })
  }
}

const createShopifyStorefrontMcpDescriptor = ({
  record,
  adapterIndex,
  env,
  options
}: {
  record: RuntimeCatalogAdapterRecord
  adapterIndex: number
  env: NodeJS.ProcessEnv
  options: RuntimeCatalogAdapterOptions
}): RuntimeCatalogAdapterDescriptor => {
  const adapterId = requiredString(record, 'adapterId', adapterIndex)
  const businessId = requiredString(record, 'businessId', adapterIndex)
  const platformProfileUrl = platformProfileUrlForAdapter(record, adapterIndex, options)
  const allowLocalPlatformProfileUrl = options.allowLocalPlatformProfileUrl === true
  const shopDomain = asString(record.shopDomain)
  const endpointUrl = asString(record.endpointUrl)
  if (!shopDomain && !endpointUrl) {
    throw new RuntimeCatalogAdapterConfigError(
      `CATALOG_ADAPTERS_JSON[${adapterIndex}] must include shopDomain or endpointUrl for a Shopify Storefront MCP adapter.`
    )
  }

  const headers = optionalHeaders(record, adapterIndex)
  const authHeader = optionalAuthHeader({ record, adapterIndex, env })
  const fetcher = options.fetcher
  const source = connectedSourceFromRecord({
    record,
    adapterIndex,
    businessId,
    defaultDomain: shopDomain ?? (endpointUrl ? hostnameFromUrl(endpointUrl) : undefined),
    defaultSourceType: 'direct_ucp'
  })

  return {
    adapterId,
    businessId,
    transport: 'mcp',
    source,
    fetcher: createShopifyStorefrontMcpCatalogFetcher({
      adapterId,
      platformProfileUrl,
      ...(allowLocalPlatformProfileUrl ? { allowLocalPlatformProfileUrl } : {}),
      ...(shopDomain ? { shopDomain } : {}),
      ...(endpointUrl ? { endpointUrl } : {}),
      ...(headers ? { headers } : {}),
      ...(authHeader ? { authHeader } : {}),
      ...(fetcher ? { fetcher } : {})
    }),
    detailFetcher: createShopifyStorefrontMcpCatalogProductDetailFetcher({
      adapterId,
      platformProfileUrl,
      ...(allowLocalPlatformProfileUrl ? { allowLocalPlatformProfileUrl } : {}),
      ...(shopDomain ? { shopDomain } : {}),
      ...(endpointUrl ? { endpointUrl } : {}),
      ...(headers ? { headers } : {}),
      ...(authHeader ? { authHeader } : {}),
      ...(fetcher ? { fetcher } : {})
    })
  }
}

const createShopifyGlobalMcpDescriptor = ({
  record,
  adapterIndex,
  env,
  options
}: {
  record: RuntimeCatalogAdapterRecord
  adapterIndex: number
  env: NodeJS.ProcessEnv
  options: RuntimeCatalogAdapterOptions
}): RuntimeCatalogAdapterDescriptor => {
  const adapterId = requiredString(record, 'adapterId', adapterIndex)
  const businessId = requiredString(record, 'businessId', adapterIndex)
  const platformProfileUrl = platformProfileUrlForAdapter(record, adapterIndex, options)
  const allowLocalPlatformProfileUrl = options.allowLocalPlatformProfileUrl === true
  const endpointUrl = asString(record.endpointUrl)
  const mode = asString(record.mode) ?? 'seller_guarded'
  const headers = optionalHeaders(record, adapterIndex)
  const authHeader = optionalAuthHeader({ record, adapterIndex, env })
  const fetcher = options.fetcher

  if (mode !== 'seller_guarded' && mode !== 'broad_discovery') {
    throw new RuntimeCatalogAdapterConfigError(
      `CATALOG_ADAPTERS_JSON[${adapterIndex}].mode must be seller_guarded or broad_discovery for Shopify Global Catalog MCP adapters.`
    )
  }

  const source = connectedSourceFromRecord({
    record,
    adapterIndex,
    businessId,
    defaultDomain: mode === 'broad_discovery'
      ? hostnameFromUrl(endpointUrl ?? `https://${defaultShopifyGlobalCatalogDomain}/api/ucp/mcp`) ?? defaultShopifyGlobalCatalogDomain
      : undefined,
    defaultDisplayName: 'Shopify Global Catalog',
    defaultSourceType: 'managed_channel'
  })

  return {
    adapterId,
    businessId,
    transport: 'mcp',
    source,
    fetcher: mode === 'broad_discovery'
      ? createShopifyGlobalCatalogBroadMcpFetcher({
          adapterId,
          platformProfileUrl,
          ...(allowLocalPlatformProfileUrl ? { allowLocalPlatformProfileUrl } : {}),
          ...(endpointUrl ? { endpointUrl } : {}),
          ...(headers ? { headers } : {}),
          ...(authHeader ? { authHeader } : {}),
          ...(fetcher ? { fetcher } : {})
        })
      : createShopifyGlobalCatalogMcpFetcher({
          adapterId,
          platformProfileUrl,
          ...(allowLocalPlatformProfileUrl ? { allowLocalPlatformProfileUrl } : {}),
          ...(endpointUrl ? { endpointUrl } : {}),
          ...(headers ? { headers } : {}),
          ...(authHeader ? { authHeader } : {}),
          ...(fetcher ? { fetcher } : {})
        }),
    detailFetcher: mode === 'broad_discovery'
      ? createShopifyGlobalCatalogBroadMcpProductDetailFetcher({
          adapterId,
          platformProfileUrl,
          ...(allowLocalPlatformProfileUrl ? { allowLocalPlatformProfileUrl } : {}),
          ...(endpointUrl ? { endpointUrl } : {}),
          ...(headers ? { headers } : {}),
          ...(authHeader ? { authHeader } : {}),
          ...(fetcher ? { fetcher } : {})
        })
      : createShopifyGlobalCatalogMcpProductDetailFetcher({
          adapterId,
          platformProfileUrl,
          ...(allowLocalPlatformProfileUrl ? { allowLocalPlatformProfileUrl } : {}),
          ...(endpointUrl ? { endpointUrl } : {}),
          ...(headers ? { headers } : {}),
          ...(authHeader ? { authHeader } : {}),
          ...(fetcher ? { fetcher } : {})
        })
  }
}

const createShopifyGraphqlDescriptor = ({
  record,
  adapterIndex,
  env,
  options
}: {
  record: RuntimeCatalogAdapterRecord
  adapterIndex: number
  env: NodeJS.ProcessEnv
  options: RuntimeCatalogAdapterOptions
}): RuntimeCatalogAdapterDescriptor => {
  const adapterId = requiredString(record, 'adapterId', adapterIndex)
  const businessId = requiredString(record, 'businessId', adapterIndex)
  const storefrontAccessTokenEnv = requiredString(record, 'storefrontAccessTokenEnv', adapterIndex)
  const shopDomain = asString(record.shopDomain)
  const endpointUrl = asString(record.endpointUrl)
  const fetcher = options.fetcher
  if (!shopDomain && !endpointUrl) {
    throw new RuntimeCatalogAdapterConfigError(
      `CATALOG_ADAPTERS_JSON[${adapterIndex}] must include shopDomain or endpointUrl for a Shopify adapter.`
    )
  }

  const maxProducts = asPositiveInteger(record.maxProducts)
  const source = connectedSourceFromRecord({
    record,
    adapterIndex,
    businessId,
    defaultDomain: shopDomain ?? (endpointUrl ? hostnameFromUrl(endpointUrl) : undefined),
    defaultSourceType: 'direct_ucp'
  })

  return {
    adapterId,
    businessId,
    transport: 'rest',
    source,
    fetcher: createShopifyStorefrontGraphqlCatalogFetcher({
      adapterId,
      storefrontAccessToken: secretFromEnv({
        env,
        envName: storefrontAccessTokenEnv,
        adapterIndex,
        field: 'storefrontAccessTokenEnv'
      }),
      ...(shopDomain ? { shopDomain } : {}),
      ...(endpointUrl ? { endpointUrl } : {}),
      ...(maxProducts ? { maxProducts } : {}),
      ...(fetcher ? { fetcher } : {})
    })
  }
}

export const createRuntimeCatalogProductFetcher = (
  env: NodeJS.ProcessEnv = process.env,
  options: RuntimeCatalogAdapterOptions = {}
): CatalogProductFetcher => createRuntimeCatalogAdapterRegistry(env, options).fetcher

export const createRuntimeCatalogAdapterRegistry = (
  env: NodeJS.ProcessEnv = process.env,
  options: RuntimeCatalogAdapterOptions = {}
): RuntimeCatalogAdapterRegistry => {
  const rawConfig = resolveCatalogAdaptersJson(env)

  let parsed: unknown
  try {
    parsed = JSON.parse(rawConfig)
  } catch {
    throw new RuntimeCatalogAdapterConfigError('CATALOG_ADAPTERS_JSON must be valid JSON.')
  }

  if (!Array.isArray(parsed)) {
    throw new RuntimeCatalogAdapterConfigError('CATALOG_ADAPTERS_JSON must be an array of adapter descriptors.')
  }

  const descriptors = parsed.map((entry, adapterIndex) => {
    const record = asRecord(entry)
    if (!record) {
      throw new RuntimeCatalogAdapterConfigError(
        `CATALOG_ADAPTERS_JSON[${adapterIndex}] must be an object.`
      )
    }

    const kind = requiredString(record, 'kind', adapterIndex) as RuntimeCatalogAdapterKind
    if (kind === 'ucp_rest') return createUcpRestDescriptor({ record, adapterIndex, env, options })
    if (kind === 'ucp_mcp') return createUcpMcpDescriptor({ record, adapterIndex, env, options })
    if (kind === 'shopify_storefront_mcp') return createShopifyStorefrontMcpDescriptor({ record, adapterIndex, env, options })
    if (kind === 'shopify_global_catalog_mcp') return createShopifyGlobalMcpDescriptor({ record, adapterIndex, env, options })
    if (kind === 'shopify_storefront_graphql') return createShopifyGraphqlDescriptor({ record, adapterIndex, env, options })

    throw new RuntimeCatalogAdapterConfigError(
      `CATALOG_ADAPTERS_JSON[${adapterIndex}].kind must be ucp_rest, ucp_mcp, shopify_storefront_mcp, shopify_global_catalog_mcp, or shopify_storefront_graphql.`
    )
  })

  if (descriptors.length === 0) {
    return {
      fetcher: createUnavailableCatalogFetcher(),
      detailFetcher: createUnavailableCatalogProductDetailFetcher(),
      connectedSources: []
    }
  }

  return {
    fetcher: createCatalogAdapterDispatcher(descriptors),
    detailFetcher: createCatalogProductDetailAdapterDispatcher(descriptors),
    connectedSources: descriptors.map((descriptor) => descriptor.source)
  }
}
