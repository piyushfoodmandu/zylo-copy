import type {
  CatalogPreparedCart,
  CatalogProductDetail,
  CatalogProductDetailRequest,
  CatalogProductSearchInput,
  Money,
  PlainStatusMessage
} from '@arro/contracts'
import {
  isCatalogProductSearchInput,
  moneyFromDecimalString
} from '@arro/contracts'
import {
  CatalogProductValidationError,
  CatalogPreparedCartValidationError,
  validateCatalogProductDetailForSource,
  validateCatalogPreparedCartForSource,
  validateCatalogProductsForSource,
  type ApprovedCatalogSource,
  type CatalogCartPrepareFetcher,
  type CatalogCartPrepareFetchRequest,
  type CatalogCartPrepareFetchResult,
  type CatalogProductDetailFetcher,
  type CatalogProductDetailFetchRequest,
  type CatalogProductDetailFetchResult,
  type CatalogProductFetcher,
  type CatalogProductFetchRequest,
  type CatalogProductFetchResult,
  type CatalogProductFetchStatus
} from './catalog-fetcher.ts'
import {
  discardResponseBody,
  readJsonPayload
} from './http-response-body.ts'
import {
  createConnectorHttpFetcher,
  type ConnectorHttpFetcher,
  type ConnectorHttpResponse
} from './http-transport.ts'

type HeaderMap = Record<string, string>

export type CatalogAdapterAuthHeader = {
  name: string
  value: string
}

export type UcpRestCatalogRequestMode = 'arro_post' | 'ucp_products_get'

export type UcpRestCatalogFetcherOptions = {
  adapterId: string
  endpointUrl: string
  mode?: UcpRestCatalogRequestMode
  headers?: HeaderMap
  authHeader?: CatalogAdapterAuthHeader
  fetcher?: ConnectorHttpFetcher
  maxResponseBytes?: number
  sourceLabelFactType?: string
  fetchedMessageCode?: string
  fetchedMessageText?: string
}

export type UcpMcpCatalogFetcherOptions = {
  adapterId: string
  endpointUrl: string
  platformProfileUrl: string
  allowLocalPlatformProfileUrl?: boolean
  toolName?: 'search_catalog'
  headers?: HeaderMap
  authHeader?: CatalogAdapterAuthHeader
  fetcher?: ConnectorHttpFetcher
  maxResponseBytes?: number
  catalogView?: 'offer'
  requireSellerDomainMatch?: boolean
  requireSellerIdentity?: boolean
  sourceLabelFactType?: string
  fetchedMessageCode?: string
  fetchedMessageText?: string
}

export type UcpMcpCatalogProductDetailFetcherOptions = Omit<UcpMcpCatalogFetcherOptions, 'toolName' | 'catalogView' | 'fetchedMessageCode' | 'fetchedMessageText'> & {
  sourceLabelFactType?: string
  fetchedMessageCode?: string
  fetchedMessageText?: string
}

export type UcpMcpCartPrepareToolName = 'create_cart' | 'create_checkout'

export type UcpMcpCatalogCartPrepareFetcherOptions = Omit<UcpMcpCatalogFetcherOptions, 'toolName' | 'catalogView' | 'fetchedMessageCode' | 'fetchedMessageText' | 'sourceLabelFactType' | 'requireSellerDomainMatch' | 'requireSellerIdentity'> & {
  toolName?: UcpMcpCartPrepareToolName
  fetchedMessageCode?: string
  fetchedMessageText?: string
}

export type UcpRestCatalogProductDetailFetcherOptions = Omit<UcpRestCatalogFetcherOptions, 'mode' | 'fetchedMessageCode' | 'fetchedMessageText'> & {
  mode?: UcpRestCatalogRequestMode
  sourceLabelFactType?: string
  fetchedMessageCode?: string
  fetchedMessageText?: string
}

export type ShopifyStorefrontMcpCatalogFetcherOptions = {
  adapterId: string
  shopDomain?: string
  endpointUrl?: string
  platformProfileUrl: string
  allowLocalPlatformProfileUrl?: boolean
  headers?: HeaderMap
  authHeader?: CatalogAdapterAuthHeader
  fetcher?: ConnectorHttpFetcher
  maxResponseBytes?: number
}

export type ShopifyGlobalCatalogMcpFetcherOptions = {
  adapterId: string
  endpointUrl?: string
  platformProfileUrl: string
  allowLocalPlatformProfileUrl?: boolean
  headers?: HeaderMap
  authHeader?: CatalogAdapterAuthHeader
  fetcher?: ConnectorHttpFetcher
  maxResponseBytes?: number
}

export type ShopifyGlobalCatalogBroadMcpFetcherOptions = ShopifyGlobalCatalogMcpFetcherOptions

export type ShopifyStorefrontGraphqlCatalogFetcherOptions = {
  adapterId: string
  shopDomain?: string
  endpointUrl?: string
  storefrontAccessToken: string
  fetcher?: ConnectorHttpFetcher
  maxProducts?: number
  maxResponseBytes?: number
}

type ShopifyMoney = {
  amount?: string
  currencyCode?: string
}

const defaultMaxResponseBytes = 512 * 1024
const defaultShopifyMaxProducts = 20
const defaultShopifyGlobalCatalogMcpEndpoint = 'https://catalog.shopify.com/api/ucp/mcp'
const catalogJsonPayloadOptions = {
  invalidContentTypeMessage: 'approved_catalog_content_type_invalid',
  tooLargeMessage: 'approved_catalog_response_too_large'
}
const connectorCatalogFetchedMessage = {
  severity: 'info' as const,
  code: 'connector_catalog_fetched',
  text: 'Connector-backed catalog product facts were fetched and validated.'
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

const asString = (value: unknown) => {
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

const asIdString = (value: unknown) => {
  const stringValue = asString(value)
  if (stringValue) return stringValue
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return undefined
}

const asBoolean = (value: unknown) => typeof value === 'boolean' ? value : undefined

const asStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => asString(item) ?? [])
    : []

const asNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined

  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

const asInteger = (value: unknown) => {
  const parsed = asNumber(value)
  if (parsed === undefined || !Number.isInteger(parsed)) return undefined
  return parsed
}

const normalizeHttpsUrl = (value: string, adapterId: string) => {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new Error(`Catalog adapter ${adapterId} endpoint URL is invalid.`)
  }

  if (url.protocol !== 'https:') {
    throw new Error(`Catalog adapter ${adapterId} endpoint URL must use HTTPS.`)
  }

  return url.toString()
}

const localPlatformProfileHosts = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1'
])

const normalizePlatformProfileUrl = (
  value: string,
  adapterId: string,
  allowLocalPlatformProfileUrl = false
) => {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new Error(`Catalog adapter ${adapterId} platform profile URL is invalid.`)
  }

  const hostname = url.hostname.toLowerCase()
  const localProfileUrl = localPlatformProfileHosts.has(hostname) || hostname.endsWith('.local')
  if (url.protocol === 'https:' || (allowLocalPlatformProfileUrl && localProfileUrl)) {
    return url.toString()
  }

  throw new Error(`Catalog adapter ${adapterId} platform profile URL must use HTTPS.`)
}

const normalizeShopDomain = (value: string | undefined, adapterId: string) => {
  const trimmed = value?.trim().toLowerCase()
  if (!trimmed) throw new Error(`Shopify catalog adapter ${adapterId} requires a shopDomain or endpointUrl.`)

  if (trimmed.includes('://') || trimmed.includes('/')) {
    throw new Error(`Shopify catalog adapter ${adapterId} shopDomain must be a hostname.`)
  }

  return trimmed
}

const responseLatencyMs = (startedAt: number) => Math.max(Date.now() - startedAt, 0)

const statusMessage = (
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

const adapterFailure = ({
  request,
  startedAt,
  status,
  code,
  text,
  nextAction
}: {
  request: CatalogProductFetchRequest
  startedAt: number
  status: Exclude<CatalogProductFetchStatus, 'fetched'>
  code: string
  text: string
  nextAction: string
}): CatalogProductFetchResult => ({
  sourceId: request.source.businessId,
  sourceName: request.source.displayName,
  status,
  products: [],
  messages: [
    statusMessage(status === 'unavailable' ? 'info' : 'warning', code, text, nextAction)
  ],
  fetchedAt: (request.now ?? new Date()).toISOString(),
  latencyMs: responseLatencyMs(startedAt)
})

const adapterDetailFailure = ({
  request,
  startedAt,
  status,
  code,
  text,
  nextAction
}: {
  request: CatalogProductDetailFetchRequest
  startedAt: number
  status: Exclude<CatalogProductFetchStatus, 'fetched'>
  code: string
  text: string
  nextAction: string
}): CatalogProductDetailFetchResult => ({
  sourceId: request.source.businessId,
  sourceName: request.source.displayName,
  status,
  messages: [
    statusMessage(status === 'unavailable' ? 'info' : 'warning', code, text, nextAction)
  ],
  fetchedAt: (request.now ?? new Date()).toISOString(),
  latencyMs: responseLatencyMs(startedAt)
})

const adapterCartPrepareFailure = ({
  request,
  startedAt,
  status,
  code,
  text,
  nextAction
}: {
  request: CatalogCartPrepareFetchRequest
  startedAt: number
  status: Exclude<CatalogProductFetchStatus, 'fetched'>
  code: string
  text: string
  nextAction: string
}): CatalogCartPrepareFetchResult => ({
  sourceId: request.source.businessId,
  sourceName: request.source.displayName,
  status,
  messages: [
    statusMessage(status === 'unavailable' ? 'info' : 'warning', code, text, nextAction)
  ],
  fetchedAt: (request.now ?? new Date()).toISOString(),
  latencyMs: responseLatencyMs(startedAt)
})

const fetchedResult = ({
  request,
  startedAt,
  products,
  pagination,
  messages = [connectorCatalogFetchedMessage]
}: {
  request: CatalogProductFetchRequest
  startedAt: number
  products: CatalogProductSearchInput[]
  pagination?: CatalogProductFetchResult['pagination']
  messages?: PlainStatusMessage[]
}): CatalogProductFetchResult => ({
  sourceId: request.source.businessId,
  sourceName: request.source.displayName,
  status: 'fetched',
  products,
  ...(pagination ? { pagination } : {}),
  messages,
  fetchedAt: (request.now ?? new Date()).toISOString(),
  latencyMs: responseLatencyMs(startedAt)
})

const fetchedDetailResult = ({
  request,
  startedAt,
  product,
  messages
}: {
  request: CatalogProductDetailFetchRequest
  startedAt: number
  product: CatalogProductDetail
  messages: PlainStatusMessage[]
}): CatalogProductDetailFetchResult => ({
  sourceId: request.source.businessId,
  sourceName: request.source.displayName,
  status: 'fetched',
  product,
  messages,
  fetchedAt: (request.now ?? new Date()).toISOString(),
  latencyMs: responseLatencyMs(startedAt)
})

const fetchedCartPrepareResult = ({
  request,
  startedAt,
  cart,
  messages
}: {
  request: CatalogCartPrepareFetchRequest
  startedAt: number
  cart: CatalogPreparedCart
  messages: PlainStatusMessage[]
}): CatalogCartPrepareFetchResult => ({
  sourceId: request.source.businessId,
  sourceName: request.source.displayName,
  status: 'fetched',
  cart,
  messages,
  fetchedAt: (request.now ?? new Date()).toISOString(),
  latencyMs: responseLatencyMs(startedAt)
})

const productsFromUcpPayload = (payload: unknown) => {
  if (Array.isArray(payload)) return payload

  const record = asRecord(payload)
  const products = record?.products ?? record?.items
  if (Array.isArray(products)) return products

  throw new Error('connector_catalog_products_missing')
}

const validateProducts = (
  source: ApprovedCatalogSource,
  products: unknown[]
) => validateCatalogProductsForSource({ source, products })

const invalidResponseFailure = ({
  request,
  startedAt,
  code = 'connector_catalog_response_invalid'
}: {
  request: CatalogProductFetchRequest
  startedAt: number
  code?: string
}) => adapterFailure({
  request,
  startedAt,
  status: 'invalid_response',
  code,
  text: 'A connector-backed catalog adapter returned product facts that failed the API contract.',
  nextAction: 'Reject this source response and inspect adapter mapping before enabling these products.'
})

const invalidDetailResponseFailure = ({
  request,
  startedAt,
  code = 'catalog_product_detail_response_invalid'
}: {
  request: CatalogProductDetailFetchRequest
  startedAt: number
  code?: string
}) => adapterDetailFailure({
  request,
  startedAt,
  status: 'invalid_response',
  code,
  text: 'A catalog product detail adapter returned product facts that failed the API contract.',
  nextAction: 'Reject this product detail response and inspect adapter mapping before enabling product detail.'
})

const unconfirmedVariantFailure = ({
  request,
  startedAt
}: {
  request: CatalogProductDetailFetchRequest
  startedAt: number
}) => adapterDetailFailure({
  request,
  startedAt,
  status: 'unavailable',
  code: 'catalog_product_detail_variant_unconfirmed',
  text: 'The source did not confirm the requested variant for this product.',
  nextAction: 'Request product detail without the variant to see the offers the source does confirm.'
})

/**
 * A source that answers about a different variant set than the one the shopper
 * clicked is not returning malformed facts, so it must not be reported as a
 * broken adapter mapping. Aggregated catalogs legitimately cluster one product
 * across merchants and can answer detail from a different offer universe.
 */
const detailTransformFailure = ({
  request,
  startedAt,
  reason,
  code
}: {
  request: CatalogProductDetailFetchRequest
  startedAt: number
  reason: unknown
  code: string
}) => reason instanceof Error && reason.message === 'ucp_product_requested_variant_missing'
  ? unconfirmedVariantFailure({ request, startedAt })
  : invalidDetailResponseFailure({ request, startedAt, code })

const invalidCartPrepareResponseFailure = ({
  request,
  startedAt,
  code = 'catalog_cart_prepare_response_invalid'
}: {
  request: CatalogCartPrepareFetchRequest
  startedAt: number
  code?: string
}) => adapterCartPrepareFailure({
  request,
  startedAt,
  status: 'invalid_response',
  code,
  text: 'A cart adapter returned cart facts that failed the API contract.',
  nextAction: 'Reject this cart response and inspect adapter mapping before enabling cart preparation.'
})

export const createUcpRestCatalogFetcher = ({
  adapterId,
  endpointUrl,
  mode = 'arro_post',
  headers = {},
  authHeader,
  fetcher = createConnectorHttpFetcher(),
  maxResponseBytes = defaultMaxResponseBytes,
  sourceLabelFactType = 'approved_catalog_product',
  fetchedMessageCode = 'connector_catalog_fetched',
  fetchedMessageText = 'Connector-backed catalog product facts were fetched and validated.'
}: UcpRestCatalogFetcherOptions): CatalogProductFetcher => {
  const normalizedEndpointUrl = normalizeHttpsUrl(endpointUrl, adapterId)

  return async (request) => {
    const startedAt = Date.now()

    let response: ConnectorHttpResponse
    try {
      const requestHeaders = {
        accept: 'application/json',
        'arro-catalog-adapter-id': adapterId,
        ...headers,
        ...(authHeader ? { [authHeader.name]: authHeader.value } : {})
      }

      response = mode === 'ucp_products_get'
        ? await fetcher(ucpProductsGetUrl(normalizedEndpointUrl, request), {
            method: 'GET',
            headers: requestHeaders,
            ...(request.signal ? { signal: request.signal } : {})
          })
        : await fetcher(normalizedEndpointUrl, {
            method: 'POST',
            headers: {
              ...requestHeaders,
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              requestId: request.requestId,
              correlationId: request.correlationId,
              query: request.searchRequest.query,
              ...(request.searchRequest.filters ? { filters: request.searchRequest.filters } : {}),
              ...(request.searchRequest.context ? { context: request.searchRequest.context } : {}),
              ...(request.searchRequest.pagination ? { pagination: request.searchRequest.pagination } : {}),
              source: {
                businessId: request.source.businessId,
                domain: request.source.domain,
                ...(request.source.profileHash ? { profileHash: request.source.profileHash } : {}),
                ...(request.source.profileUrl ? { profileUrl: request.source.profileUrl } : {})
              }
            }),
            ...(request.signal ? { signal: request.signal } : {})
          })
    } catch {
      return adapterFailure({
        request,
        startedAt,
        status: 'error',
        code: 'connector_catalog_adapter_request_failed',
        text: 'A connector-backed catalog adapter request failed before product facts could be read.',
        nextAction: 'Inspect adapter connectivity and retry under connector rate limits.'
      })
    }

    if (!response.ok) {
      discardResponseBody(response)
      return adapterFailure({
        request,
        startedAt,
        status: response.status === 404 ? 'unavailable' : 'error',
        code: response.status === 404
          ? 'connector_catalog_source_unavailable'
          : 'connector_catalog_adapter_http_error',
        text: 'A connector-backed catalog adapter returned a non-success HTTP status.',
        nextAction: 'Keep this source out of ranking until the official catalog endpoint is healthy.'
      })
    }

    let payload: unknown
    try {
      payload = await readJsonPayload(response, maxResponseBytes, catalogJsonPayloadOptions)
    } catch {
      return invalidResponseFailure({ request, startedAt })
    }

    try {
      return fetchedResult({
        request,
        startedAt,
        products: mode === 'ucp_products_get'
          ? normalizeUcpRestProductsForSource({
              source: request.source,
              products: productsFromUcpPayload(payload),
              now: request.now ?? new Date(),
              sourceLabelFactType
            })
          : validateProducts(request.source, productsFromUcpPayload(payload)),
        messages: [statusMessage('info', fetchedMessageCode, fetchedMessageText)]
      })
    } catch (error) {
      return invalidResponseFailure({
        request,
        startedAt,
        code: error instanceof CatalogProductValidationError
          ? error.code
          : 'connector_catalog_response_invalid'
      })
    }
  }
}

const ucpProductsGetUrl = (endpointUrl: string, request: CatalogProductFetchRequest) => {
  const url = new URL(endpointUrl)
  const { query, filters, pagination } = request.searchRequest
  const limit = Math.min(Math.max(pagination?.limit ?? 20, 1), 50)

  url.searchParams.set('search', query)
  url.searchParams.set('query', query)
  url.searchParams.set('per_page', String(limit))
  url.searchParams.set('limit', String(limit))

  if (pagination?.cursor && /^\d+$/.test(pagination.cursor)) {
    url.searchParams.set('page', pagination.cursor)
  }

  const category = asString(filters?.category) ?? asString(filters?.category_id)
  if (category) url.searchParams.set('category', category)

  const minPrice = asNumber(filters?.min_price) ?? asNumber(filters?.price_min)
  if (minPrice !== undefined) url.searchParams.set('min_price', String(minPrice))

  const maxPrice = asNumber(filters?.max_price) ?? asNumber(filters?.price_max)
  if (maxPrice !== undefined) url.searchParams.set('max_price', String(maxPrice))

  const inStock = asBoolean(filters?.in_stock)
  if (inStock !== undefined) url.searchParams.set('in_stock', String(inStock))

  return url.toString()
}

const ucpProductDetailGetUrl = (endpointUrl: string, request: CatalogProductDetailFetchRequest) => {
  const url = new URL(endpointUrl)
  const { productId, variantId, context } = request.detailRequest

  url.searchParams.set('id', productId)
  url.searchParams.set('product_id', productId)
  if (variantId) url.searchParams.set('variant_id', variantId)
  if (context?.region) url.searchParams.set('region', context.region)
  if (context?.currency) url.searchParams.set('currency', context.currency)
  if (context?.locale) url.searchParams.set('locale', context.locale)

  return url.toString()
}

const productFromUcpPayload = (payload: unknown) => {
  const record = asRecord(payload)
  const product = asRecord(record?.product) ?? asRecord(record?.item)
  if (product) return product

  const products = Array.isArray(payload)
    ? payload
    : firstArray(record?.products, record?.items, record?.results)
  const firstProduct = asRecord(products?.[0])
  if (firstProduct) return firstProduct

  throw new Error('ucp_product_detail_missing')
}

export const createUcpRestCatalogProductDetailFetcher = ({
  adapterId,
  endpointUrl,
  mode = 'arro_post',
  headers = {},
  authHeader,
  fetcher = createConnectorHttpFetcher(),
  maxResponseBytes = defaultMaxResponseBytes,
  sourceLabelFactType = 'approved_catalog_product_detail',
  fetchedMessageCode = 'ucp_rest_product_detail_fetched',
  fetchedMessageText = 'UCP REST product detail facts were fetched and validated.'
}: UcpRestCatalogProductDetailFetcherOptions): CatalogProductDetailFetcher => {
  const normalizedEndpointUrl = normalizeHttpsUrl(endpointUrl, adapterId)

  return async (request) => {
    const startedAt = Date.now()

    let response: ConnectorHttpResponse
    try {
      const requestHeaders = {
        accept: 'application/json',
        'arro-catalog-adapter-id': adapterId,
        ...headers,
        ...(authHeader ? { [authHeader.name]: authHeader.value } : {})
      }

      response = mode === 'ucp_products_get'
        ? await fetcher(ucpProductDetailGetUrl(normalizedEndpointUrl, request), {
            method: 'GET',
            headers: requestHeaders,
            ...(request.signal ? { signal: request.signal } : {})
          })
        : await fetcher(normalizedEndpointUrl, {
            method: 'POST',
            headers: {
              ...requestHeaders,
              'content-type': 'application/json'
            },
            body: JSON.stringify({
              requestId: request.requestId,
              correlationId: request.correlationId,
              productId: request.detailRequest.productId,
              ...(request.detailRequest.variantId ? { variantId: request.detailRequest.variantId } : {}),
              ...(request.detailRequest.context ? { context: request.detailRequest.context } : {}),
              source: {
                businessId: request.source.businessId,
                domain: request.source.domain,
                ...(request.source.profileHash ? { profileHash: request.source.profileHash } : {}),
                ...(request.source.profileUrl ? { profileUrl: request.source.profileUrl } : {})
              }
            }),
            ...(request.signal ? { signal: request.signal } : {})
          })
    } catch {
      return adapterDetailFailure({
        request,
        startedAt,
        status: 'error',
        code: 'ucp_rest_product_detail_request_failed',
        text: 'The UCP REST product detail adapter request failed before product facts could be read.',
        nextAction: 'Inspect endpoint reachability, credentials where required, and connector rate limits.'
      })
    }

    if (!response.ok) {
      discardResponseBody(response)
      return adapterDetailFailure({
        request,
        startedAt,
        status: response.status === 404 ? 'unavailable' : 'error',
        code: response.status === 404
          ? 'ucp_rest_product_detail_unavailable'
          : 'ucp_rest_product_detail_http_error',
        text: 'The UCP REST product detail adapter returned a non-success HTTP status.',
        nextAction: 'Keep product detail unavailable until the official endpoint is healthy.'
      })
    }

    let payload: unknown
    try {
      payload = await readJsonPayload(response, maxResponseBytes, catalogJsonPayloadOptions)
    } catch {
      return invalidDetailResponseFailure({ request, startedAt })
    }

    try {
      const product = ucpProductToDetail({
        product: productFromUcpPayload(payload),
        source: request.source,
        now: request.now ?? new Date(),
        requireSellerDomainMatch: false,
        requireSellerIdentity: false,
        requireSafeUrlDomainMatch: true,
        sourceLabelFactType,
        preferredVariantId: request.detailRequest.variantId
      })

      return fetchedDetailResult({
        request,
        startedAt,
        product,
        messages: [statusMessage('info', fetchedMessageCode, fetchedMessageText)]
      })
    } catch (reason) {
      return detailTransformFailure({
        request,
        startedAt,
        reason,
        code: 'catalog_product_detail_response_invalid'
      })
    }
  }
}

const shopifyStorefrontQuery = `#graphql
query ArroCatalogSearch($query: String!, $first: Int!) {
  products(first: $first, query: $query) {
    edges {
      node {
        id
        handle
        title
        vendor
        description
        productType
        onlineStoreUrl
        tags
        featuredImage {
          url
          altText
        }
        priceRange {
          minVariantPrice {
            amount
            currencyCode
          }
        }
        variants(first: 1) {
          edges {
            node {
              id
              availableForSale
              price {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  }
}`

const endpointFromShopifyOptions = ({
  adapterId,
  endpointUrl,
  shopDomain
}: {
  adapterId: string
  endpointUrl: string | undefined
  shopDomain: string | undefined
}) => {
  if (endpointUrl) return normalizeHttpsUrl(endpointUrl, adapterId)

  const normalizedShopDomain = normalizeShopDomain(shopDomain, adapterId)
  return `https://${normalizedShopDomain}/api/2026-04/graphql.json`
}

const shopDomainFromEndpoint = (endpointUrl: string) => new URL(endpointUrl).hostname

const endpointFromShopifyMcpOptions = ({
  adapterId,
  endpointUrl,
  shopDomain
}: {
  adapterId: string
  endpointUrl: string | undefined
  shopDomain: string | undefined
}) => {
  if (endpointUrl) return normalizeHttpsUrl(endpointUrl, adapterId)

  const normalizedShopDomain = normalizeShopDomain(shopDomain, adapterId)
  return `https://${normalizedShopDomain}/api/ucp/mcp`
}

const normalizedDomain = (value: string) => {
  const trimmed = value.trim().toLowerCase()

  try {
    const url = trimmed.includes('://') ? new URL(trimmed) : new URL(`https://${trimmed}`)
    return url.hostname.replace(/^www\./, '')
  } catch {
    return trimmed.replace(/^www\./, '')
  }
}

const domainsMatch = (actual: string, expected: string) =>
  normalizedDomain(actual) === normalizedDomain(expected)

const hostnameFromHttpsUrl = (value: string | undefined) => {
  if (!value) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.hostname : undefined
  } catch {
    return undefined
  }
}

const safeHttpsUrl = (value: unknown) => {
  const candidate = asString(value)
  if (!candidate) return undefined

  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' ? url.toString() : undefined
  } catch {
    return undefined
  }
}

const assertSafeUrl = ({
  value,
  allowedDomains,
  requireSellerDomainMatch
}: {
  value: unknown
  allowedDomains: string[]
  requireSellerDomainMatch: boolean
}) => {
  const raw = asString(value)
  if (!raw) return undefined

  const url = safeHttpsUrl(raw)
  if (!url) throw new Error('ucp_product_unsafe_handoff_url')
  if (requireSellerDomainMatch && !allowedDomains.some((domain) => domainsMatch(url, domain))) {
    throw new Error('ucp_product_seller_mismatch')
  }

  return url
}

const sellerAuthorityDomains = (
  seller: CatalogProductSearchInput['seller'] | undefined,
  fallbackDomain: string | undefined
) => [
  seller?.domain,
  seller?.url ? hostnameFromHttpsUrl(seller.url) : undefined,
  fallbackDomain
].filter((domain): domain is string => Boolean(domain))

const nestedRecord = (record: Record<string, unknown> | undefined, ...keys: string[]) => {
  let current = record

  for (const key of keys) {
    current = asRecord(current?.[key])
    if (!current) return undefined
  }

  return current
}

const firstArray = (...values: unknown[]) => {
  for (const value of values) {
    if (Array.isArray(value)) return value
  }

  return undefined
}

const parseJsonTextPayloads = (content: unknown) => {
  if (!Array.isArray(content)) return []

  return content.flatMap((entry) => {
    const text = asString(asRecord(entry)?.text)
    if (!text) return []

    try {
      return [JSON.parse(text) as unknown]
    } catch {
      return []
    }
  })
}

const productsFromMcpPayload = (payload: unknown) => {
  const root = asRecord(payload)
  const result = asRecord(root?.result)
  const structuredContent = asRecord(result?.structuredContent) ?? asRecord(result?.structured_content)
  const resultData = asRecord(result?.data)
  const parsedContentPayloads = parseJsonTextPayloads(result?.content)

  const candidates = [
    payload,
    root,
    result,
    structuredContent,
    resultData,
    ...parsedContentPayloads
  ]

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate

    const record = asRecord(candidate)
    const catalog = asRecord(record?.catalog)
    const products = firstArray(
      record?.products,
      record?.items,
      record?.results,
      catalog?.products,
      catalog?.items,
      catalog?.results
    )

    if (products) return products
  }

  throw new Error('ucp_mcp_products_missing')
}

const paginationFromMcpPayload = (payload: unknown): CatalogProductFetchResult['pagination'] | undefined => {
  const root = asRecord(payload)
  const result = asRecord(root?.result)
  const structuredContent = asRecord(result?.structuredContent) ?? asRecord(result?.structured_content)
  const resultData = asRecord(result?.data)
  const parsedContentPayloads = parseJsonTextPayloads(result?.content)

  const candidates = [
    payload,
    root,
    result,
    structuredContent,
    resultData,
    ...parsedContentPayloads
  ]

  for (const candidate of candidates) {
    const record = asRecord(candidate)
    const catalog = asRecord(record?.catalog)
    const pagination = asRecord(record?.pagination) ?? asRecord(catalog?.pagination)
    if (!pagination) continue

    const cursor = asString(pagination.cursor)
    const rawHasNextPage = pagination.has_next_page ?? pagination.hasNextPage
    const hasNextPage = typeof rawHasNextPage === 'boolean'
      ? rawHasNextPage
      : Boolean(cursor)

    return {
      hasNextPage,
      ...(cursor ? { cursor } : {})
    }
  }

  return undefined
}

const productFromMcpPayload = (payload: unknown) => {
  const root = asRecord(payload)
  const result = asRecord(root?.result)
  const structuredContent = asRecord(result?.structuredContent) ?? asRecord(result?.structured_content)
  const resultData = asRecord(result?.data)
  const parsedContentPayloads = parseJsonTextPayloads(result?.content)

  const candidates = [
    payload,
    root,
    result,
    structuredContent,
    resultData,
    ...parsedContentPayloads
  ]

  for (const candidate of candidates) {
    const record = asRecord(candidate)
    const product = asRecord(record?.product) ?? asRecord(record?.item)
    if (product) return product

    const products = firstArray(record?.products, record?.items, record?.results)
    const firstProduct = asRecord(products?.[0])
    if (firstProduct) return firstProduct
  }

  throw new Error('ucp_mcp_product_missing')
}

const cartFromMcpPayload = (payload: unknown) => {
  const root = asRecord(payload)
  const result = asRecord(root?.result)
  const structuredContent = asRecord(result?.structuredContent) ?? asRecord(result?.structured_content)
  const resultData = asRecord(result?.data)
  const parsedContentPayloads = parseJsonTextPayloads(result?.content)

  const candidates = [
    payload,
    root,
    result,
    structuredContent,
    resultData,
    ...parsedContentPayloads
  ]

  for (const candidate of candidates) {
    const record = asRecord(candidate)
    const cart = asRecord(record?.cart) ??
      asRecord(record?.basket) ??
      asRecord(record?.checkout) ??
      asRecord(record?.checkout_session) ??
      asRecord(record?.checkoutSession)
    if (cart) return cart

    const carts = firstArray(record?.carts, record?.baskets, record?.checkouts, record?.checkout_sessions)
    const firstCart = asRecord(carts?.[0])
    if (firstCart) return firstCart

    const id = asIdString(record?.cartId) ??
      asIdString(record?.cart_id) ??
      asIdString(record?.checkoutId) ??
      asIdString(record?.checkout_id) ??
      asIdString(record?.id)
    const lines = firstArray(record?.items, record?.lines, record?.lineItems, record?.line_items)
    if (id && lines) return record
  }

  throw new Error('ucp_mcp_cart_missing')
}

const mcpErrorFromPayload = (payload: unknown) => asRecord(asRecord(payload)?.error)

const supportedCatalogAttributeNames = new Map([
  ['color', 'Color'],
  ['colour', 'Color'],
  ['size', 'Size'],
  ['target gender', 'Target gender'],
  ['gender', 'Target gender']
])

const zeroMinorUnitCurrencies = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF'
])

const toMinorUnits = (amount: number, currency: string) =>
  Math.round(amount * (zeroMinorUnitCurrencies.has(currency.toUpperCase()) ? 1 : 100))

const stringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((item) => asString(item) ?? [])
    : asString(value)
      ? [asString(value)!]
      : []

const cleanCatalogFilterString = (value: string) =>
  value.trim().replace(/\s+/g, ' ').slice(0, 120)

const cleanCatalogFilterValues = (value: unknown, maxItems: number) =>
  [...new Set(stringArray(value).flatMap((item) => {
    const cleaned = cleanCatalogFilterString(item)
    return cleaned.length > 0 ? [cleaned] : []
  }))].slice(0, maxItems)

const normalizedCountryCode = (value: unknown) => {
  const country = asString(value)?.trim().toUpperCase()
  return country && /^[A-Z]{2}$/.test(country) ? country : undefined
}

const shopifyShopIds = (value: unknown) =>
  cleanCatalogFilterValues(value, 100).filter((item) => /^gid:\/\/shopify\/Shop\/[A-Za-z0-9_-]+$/.test(item))

const catalogIntentSummaryFromRequest = (request: CatalogProductFetchRequest) => {
  const intent = request.searchRequest.intent
  if (!intent) return undefined
  if (intent.summary) return intent.summary

  const signals = [
    ...(intent.productTypes ?? []),
    ...(intent.categories ?? []),
    ...(intent.brands ?? []),
    ...(intent.requiredTerms ?? [])
  ]

  return signals.length > 0 ? signals.slice(0, 8).join(', ') : undefined
}

const catalogContextFromRequest = (request: CatalogProductFetchRequest) => {
  const context = request.searchRequest.context
  const intent = catalogIntentSummaryFromRequest(request)
  if (!context && !intent) return undefined

  return {
    ...(context?.region ? { address_country: context.region } : {}),
    ...(context?.locale ? { language: context.locale } : {}),
    ...(context?.currency ? { currency: context.currency } : {}),
    ...(context?.channel ? { channel: context.channel } : {}),
    ...(intent ? { intent } : {})
  }
}

const catalogContextFromDetailRequest = (request: CatalogProductDetailFetchRequest) => {
  const context = request.detailRequest.context
  if (!context) return undefined

  return {
    ...(context.region ? { address_country: context.region } : {}),
    ...(context.locale ? { language: context.locale } : {}),
    ...(context.currency ? { currency: context.currency } : {}),
    ...(context.channel ? { channel: context.channel } : {})
  }
}

const catalogContextFromCartPrepareRequest = (request: CatalogCartPrepareFetchRequest) => {
  const context = request.cartRequest.context
  if (!context) return undefined

  return {
    ...(context.region ? { address_country: context.region } : {}),
    ...(context.locale ? { language: context.locale } : {}),
    ...(context.currency ? { currency: context.currency } : {}),
    ...(context.channel ? { channel: context.channel } : {})
  }
}

const normalizedCatalogQueryText = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()

const catalogQueryFromRequest = (request: CatalogProductFetchRequest) => {
  const rawQuery = request.searchRequest.query.trim()
  const normalizedRawQuery = normalizedCatalogQueryText(rawQuery)
  const intent = request.searchRequest.intent
  if (!intent) return rawQuery

  const intentTerms = cleanCatalogFilterValues([
    ...(intent.productTypes ?? []),
    ...(intent.brands ?? []),
    ...(intent.requiredTerms ?? [])
  ], 8)
    .filter((term) => !normalizedRawQuery.includes(normalizedCatalogQueryText(term)))

  if (intentTerms.length === 0) return rawQuery

  return `${intentTerms.join(' ')} ${rawQuery}`.slice(0, 256).trim()
}

const catalogFiltersFromRequest = (request: CatalogProductFetchRequest) => {
  const rawFilters = request.searchRequest.filters ?? {}
  const intent = request.searchRequest.intent
  const filters: Record<string, unknown> = {}

  const available = rawFilters.available ?? rawFilters.in_stock
  if (typeof available === 'boolean') filters.available = available

  const condition = cleanCatalogFilterValues(rawFilters.condition, 8)
  if (condition.length > 0) filters.condition = condition

  const priceTier = cleanCatalogFilterValues(rawFilters.price_tier ?? rawFilters.priceTier, 5)
  if (priceTier.length > 0) filters.price_tier = priceTier

  const shopIds = shopifyShopIds(rawFilters.shop_ids ?? rawFilters.shopIds)
  if (shopIds.length > 0) filters.shop_ids = shopIds

  const currency = request.searchRequest.context?.currency ?? intent?.maxPrice?.currency ?? intent?.minPrice?.currency
  const rawMinPrice = Number(rawFilters.min_price ?? rawFilters.minPrice)
  const rawMaxPrice = Number(rawFilters.max_price ?? rawFilters.maxPrice)
  const price: Record<string, number> = {}
  if (currency && intent?.minPrice) price.min = intent.minPrice.amountMinor
  else if (currency && Number.isFinite(rawMinPrice) && rawMinPrice >= 0) price.min = toMinorUnits(rawMinPrice, currency)
  if (currency && intent?.maxPrice) price.max = intent.maxPrice.amountMinor
  else if (currency && Number.isFinite(rawMaxPrice) && rawMaxPrice >= 0) price.max = toMinorUnits(rawMaxPrice, currency)
  if (Object.keys(price).length > 0) filters.price = price

  const attributes = Object.entries(intent?.attributes ?? {}).flatMap(([name, value]) => {
    const normalizedName = supportedCatalogAttributeNames.get(name.trim().toLowerCase())
    if (!normalizedName) return []

    const values = cleanCatalogFilterValues(value, 12)
    return values.length > 0 ? [{ name: normalizedName, values }] : []
  })
  if (attributes.length > 0) filters.attributes = attributes

  const shipsTo = normalizedCountryCode(rawFilters.ships_to ?? rawFilters.shipsTo ?? request.searchRequest.context?.region)
  if (!filters.ships_to && shipsTo) {
    filters.ships_to = { country: shipsTo }
  }

  const shipsFrom = cleanCatalogFilterValues(rawFilters.ships_from ?? rawFilters.shipsFrom, 8)
    .flatMap((country) => {
      const normalized = normalizedCountryCode(country)
      return normalized ? [{ country: normalized }] : []
    })
  if (shipsFrom.length > 0) filters.ships_from = shipsFrom

  return Object.keys(filters).length > 0 ? filters : undefined
}

const mcpCatalogFromRequest = (request: CatalogProductFetchRequest, view?: 'offer') => {
  const context = catalogContextFromRequest(request)
  const filters = catalogFiltersFromRequest(request)

  return {
    query: catalogQueryFromRequest(request),
    ...(view ? { view } : {}),
    ...(filters ? { filters } : {}),
    ...(context ? { context } : {}),
    ...(request.searchRequest.pagination ? { pagination: request.searchRequest.pagination } : {})
  }
}

const mcpProductDetailFromRequest = (request: CatalogProductDetailFetchRequest) => {
  const context = catalogContextFromDetailRequest(request)
  const selected = request.detailRequest.variantId
    ? undefined
    : request.detailRequest.selected

  // UCP declares selected values as name/label pairs. Arro's own selection
  // carries an option ID and a provenance flag that the protocol does not
  // define, so those stay on this side of the boundary.
  const ucpSelected = selected?.map(({ name, label }) => ({ name, label }))

  return {
    // UCP get_product accepts either a product ID or an exact variant ID. A
    // variant ID fully determines the selection, so selected values are only
    // forwarded when resolving from the product itself.
    id: request.detailRequest.variantId ?? request.detailRequest.productId,
    ...(ucpSelected && ucpSelected.length > 0 ? { selected: ucpSelected } : {}),
    ...(request.detailRequest.preferences && request.detailRequest.preferences.length > 0
      ? { preferences: request.detailRequest.preferences }
      : {}),
    ...(context ? { context } : {})
  }
}

const mcpCartFromRequest = (request: CatalogCartPrepareFetchRequest) => ({
  items: request.cartRequest.items.map((item) => ({
    product_id: item.productId,
    productId: item.productId,
    ...(item.variantId ? { variant_id: item.variantId, variantId: item.variantId } : {}),
    quantity: item.quantity
  })),
  ...(catalogContextFromCartPrepareRequest(request) ? { context: catalogContextFromCartPrepareRequest(request) } : {}),
  ...(request.cartRequest.idempotencyKey ? { idempotency_key: request.cartRequest.idempotencyKey } : {})
})

const mcpIdValue = (value: string) => /^\d+$/.test(value) ? Number(value) : value

const mcpCheckoutLineItemsFromRequest = (request: CatalogCartPrepareFetchRequest) =>
  request.cartRequest.items.map((item) => ({
    product_id: mcpIdValue(item.productId),
    ...(item.variantId
      ? {
          variant_id: mcpIdValue(item.variantId),
          variation_id: mcpIdValue(item.variantId)
        }
      : {}),
    quantity: item.quantity
  }))

const mcpCheckoutFromRequest = (request: CatalogCartPrepareFetchRequest) => ({
  line_items: mcpCheckoutLineItemsFromRequest(request),
  ...(catalogContextFromCartPrepareRequest(request) ? { context: catalogContextFromCartPrepareRequest(request) } : {}),
  ...(request.cartRequest.idempotencyKey ? { idempotency_key: request.cartRequest.idempotencyKey } : {})
})

const mcpCartPrepareArgumentsFromRequest = ({
  request,
  toolName,
  platformProfileUrl
}: {
  request: CatalogCartPrepareFetchRequest
  toolName: UcpMcpCartPrepareToolName
  platformProfileUrl: string
}) => ({
  meta: {
    'ucp-agent': {
      profile: platformProfileUrl
    }
  },
  ...(toolName === 'create_checkout'
    ? mcpCheckoutFromRequest(request)
    : { cart: mcpCartFromRequest(request) })
})

const ucpMinorMoney = (value: unknown): Money | undefined => {
  const record = asRecord(value)
  if (!record) return undefined

  const currency = asString(record.currency) ?? asString(record.currencyCode)
  if (!currency) return undefined

  const minorAmount = typeof record.amount === 'number'
    ? record.amount
    : asNumber(record.amount_minor) ?? asNumber(record.amountMinor) ?? asNumber(record.min)
  if (
    minorAmount !== undefined &&
    Number.isInteger(minorAmount) &&
    minorAmount >= 0 &&
    Number.isSafeInteger(minorAmount)
  ) {
    return {
      amountMinor: minorAmount,
      currency: currency.toUpperCase()
    }
  }

  const legacyDecimalAmount = asString(record.amount)
  if (legacyDecimalAmount) return moneyFromDecimalString({ amount: legacyDecimalAmount, currency })

  return undefined
}

const moneyFromCartRecord = (record: Record<string, unknown>, ...keys: string[]) => {
  for (const key of keys) {
    const money = ucpMinorMoney(record[key])
    if (money) return money
  }

  return undefined
}

const normalizedMoneyKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '')

const moneyFromTotals = (record: Record<string, unknown>, ...keys: string[]) => {
  const totals = firstArray(record.totals, record.totalLines, record.total_lines)
  if (!totals) return undefined

  const normalizedKeys = new Set(keys.map(normalizedMoneyKey))
  for (const total of totals) {
    const totalRecord = asRecord(total)
    if (!totalRecord) continue

    const totalType = asString(totalRecord.type) ?? asString(totalRecord.kind) ?? asString(totalRecord.name)
    if (!totalType || !normalizedKeys.has(normalizedMoneyKey(totalType))) continue

    const money = ucpMinorMoney(totalRecord.value) ?? ucpMinorMoney(totalRecord)
    if (money) return money
  }

  return undefined
}

const moneyFromCommerceRecord = (record: Record<string, unknown>, ...keys: string[]) =>
  moneyFromCartRecord(record, ...keys) ?? moneyFromTotals(record, ...keys)

const cartLineItemsFromUcpCart = (cart: Record<string, unknown>): CatalogPreparedCart['items'] => {
  const lines = firstArray(cart.items, cart.lines, cart.lineItems, cart.line_items)
  if (!lines || lines.length === 0) throw new Error('ucp_cart_lines_missing')

  return lines.map((item) => {
    const line = asRecord(item)
    if (!line) throw new Error('ucp_cart_line_invalid')

    const lineItem = asRecord(line.item)
    const product = asRecord(line.product) ?? asRecord(line.merchandise) ?? lineItem
    const variant = asRecord(line.variant) ?? asRecord(line.merchandise)
    const productId = asIdString(line.productId) ??
      asIdString(line.product_id) ??
      asIdString(product?.id) ??
      asIdString(product?.productId) ??
      asIdString(product?.product_id)
    const variantId = asIdString(line.variantId) ??
      asIdString(line.variant_id) ??
      asIdString(line.variation_id) ??
      asIdString(variant?.id) ??
      asIdString(variant?.variantId) ??
      asIdString(variant?.variation_id)
    const quantity = asInteger(line.quantity)
    if (!productId || quantity === undefined || quantity < 1 || quantity > 99) {
      throw new Error('ucp_cart_line_required_fields_missing')
    }

    const lineId = asIdString(line.lineId) ?? asIdString(line.line_id) ?? asIdString(line.id)
    const title = asString(line.title) ?? asString(product?.title) ?? asString(product?.name)
    const unitPrice = moneyFromCommerceRecord(line, 'unitPrice', 'unit_price', 'price')
    const lineTotal = moneyFromCommerceRecord(line, 'lineTotal', 'line_total', 'totalPrice', 'total_price', 'total', 'subtotal')

    return {
      ...(lineId ? { lineId } : {}),
      productId,
      ...(variantId ? { variantId } : {}),
      ...(title ? { title } : {}),
      quantity,
      ...(unitPrice ? { unitPrice } : {}),
      ...(lineTotal ? { lineTotal } : {}),
      availability: availabilityFromUcpProduct(line)
    }
  })
}

const cartContainsRequestedItems = ({
  request,
  cartItems
}: {
  request: CatalogCartPrepareFetchRequest
  cartItems: CatalogPreparedCart['items']
}) => request.cartRequest.items.every((requested) => cartItems.some((item) => {
  if (requested.variantId) {
    return item.productId === requested.productId &&
      item.variantId === requested.variantId &&
      item.quantity === requested.quantity
  }
  return item.productId === requested.productId &&
    item.quantity === requested.quantity
})) && cartItems.length === request.cartRequest.items.length

const handoffFromUcpCart = (cart: Record<string, unknown>): CatalogPreparedCart['handoff'] => {
  const checkoutUrl = safeHttpsUrl(cart.checkoutUrl) ??
    safeHttpsUrl(cart.checkout_url) ??
    safeHttpsUrl(cart.continueUrl) ??
    safeHttpsUrl(cart.continue_url)
  if (checkoutUrl) return { type: 'checkout', url: checkoutUrl }

  const paymentInstruments = firstArray(
    cart.paymentInstruments,
    cart.payment_instruments,
    asRecord(cart.payment)?.instruments
  )
  for (const instrument of paymentInstruments ?? []) {
    const instrumentRecord = asRecord(instrument)
    const instrumentUrl = safeHttpsUrl(instrumentRecord?.continueUrl) ??
      safeHttpsUrl(instrumentRecord?.continue_url) ??
      safeHttpsUrl(instrumentRecord?.url)
    if (instrumentUrl) return { type: 'checkout', url: instrumentUrl }
  }

  const embeddedCheckoutUrl = safeHttpsUrl(cart.embeddedCheckoutUrl) ?? safeHttpsUrl(cart.embedded_checkout_url)
  if (embeddedCheckoutUrl) return { type: 'checkout', url: embeddedCheckoutUrl }

  const cartUrl = safeHttpsUrl(cart.cartUrl) ?? safeHttpsUrl(cart.cart_url) ?? safeHttpsUrl(cart.webUrl) ?? safeHttpsUrl(cart.web_url) ?? safeHttpsUrl(cart.url)
  if (cartUrl) return { type: 'cart', url: cartUrl }

  const sellerUrl = safeHttpsUrl(asRecord(cart.seller)?.url) ?? safeHttpsUrl(cart.sellerUrl) ?? safeHttpsUrl(cart.seller_url)
  if (sellerUrl) return { type: 'seller', url: sellerUrl }

  return undefined
}

const ucpCartToPreparedCart = ({
  cart,
  source,
  request,
  now
}: {
  cart: unknown
  source: ApprovedCatalogSource
  request: CatalogCartPrepareFetchRequest
  now: Date
}): CatalogPreparedCart => {
  if (isPreparedCartLike(cart)) {
    return validateCatalogPreparedCartForSource({
      source,
      cart,
      requestItems: request.cartRequest.items
    })
  }

  const record = asRecord(cart)
  if (!record) throw new Error('ucp_cart_invalid')

  const cartId = asIdString(record.cartId) ??
    asIdString(record.cart_id) ??
    asIdString(record.checkoutId) ??
    asIdString(record.checkout_id) ??
    asIdString(record.id)
  if (!cartId) throw new Error('ucp_cart_id_missing')

  const items = cartLineItemsFromUcpCart(record)
  if (!cartContainsRequestedItems({ request, cartItems: items })) throw new Error('ucp_cart_requested_items_missing')

  const fetchedAt = now.toISOString()
  const expiresAt = asString(record.expiresAt) ?? asString(record.expires_at)
  const handoff = handoffFromUcpCart(record)
  const preparedCart = {
    cartId,
    businessId: source.businessId,
    businessName: source.displayName,
    items,
    ...(moneyFromCommerceRecord(record, 'subtotal', 'estimatedSubtotal', 'estimated_subtotal') ? { subtotal: moneyFromCommerceRecord(record, 'subtotal', 'estimatedSubtotal', 'estimated_subtotal') } : {}),
    ...(moneyFromCommerceRecord(record, 'estimatedTax', 'estimated_tax', 'tax') ? { estimatedTax: moneyFromCommerceRecord(record, 'estimatedTax', 'estimated_tax', 'tax') } : {}),
    ...(moneyFromCommerceRecord(record, 'estimatedShipping', 'estimated_shipping', 'shipping', 'fulfillment') ? { estimatedShipping: moneyFromCommerceRecord(record, 'estimatedShipping', 'estimated_shipping', 'shipping', 'fulfillment') } : {}),
    ...(moneyFromCommerceRecord(record, 'estimatedTotal', 'estimated_total', 'total') ? { estimatedTotal: moneyFromCommerceRecord(record, 'estimatedTotal', 'estimated_total', 'total') } : {}),
    ...(handoff ? { handoff } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    warnings: [],
    sourceLabel: {
      sourceId: source.businessId,
      sourceName: source.displayName,
      factType: 'prepared_cart',
      fetchedAt,
      ...(expiresAt ? { expiresAt } : {}),
      freshnessClass: 'binding_commerce',
      bindingStatus: handoff ? 'requires_handoff' : 'binding'
    }
  }

  return validateCatalogPreparedCartForSource({
    source,
    cart: preparedCart,
    requestItems: request.cartRequest.items
  })
}

const isPreparedCartLike = (value: unknown): value is CatalogPreparedCart => {
  const record = asRecord(value)
  return Boolean(record?.cartId && record?.businessId && record?.sourceLabel)
}

const variantRecordId = (variant: Record<string, unknown>) =>
  asString(variant.id) ?? asString(variant.variantId) ?? asString(variant.variant_id)

const variantRecordsFromUcpProduct = (record: Record<string, unknown>) => {
  const variants = firstArray(record.variants, nestedRecord(record, 'variants')?.edges)
  if (!variants || variants.length === 0) return []

  return variants.flatMap((item) => {
    const first = asRecord(item)
    const variant = asRecord(first?.node) ?? first
    return variant ? [variant] : []
  })
}

const firstVariantRecord = (
  record: Record<string, unknown>,
  preferredVariantId?: string | undefined
) => {
  const variantRecords = variantRecordsFromUcpProduct(record)
  if (variantRecords.length === 0) return undefined

  if (preferredVariantId) {
    const preferred = variantRecords.find((variant) => variantRecordId(variant) === preferredVariantId)
    if (preferred) return preferred
  }

  return variantRecords[0]
}

const assertPreferredVariantIsConfirmed = (
  product: CatalogProductSearchInput | Record<string, unknown>,
  preferredVariantId?: string | undefined
) => {
  if (!preferredVariantId) return

  if (isCatalogProductSearchInput(product)) {
    if (product.variantId === preferredVariantId) return
    throw new Error('ucp_product_requested_variant_missing')
  }

  const recordVariantId = asString(product.variantId) ?? asString(product.variant_id)
  if (recordVariantId === preferredVariantId) return

  const hasRequestedVariant = variantRecordsFromUcpProduct(product)
    .some((variant) => variantRecordId(variant) === preferredVariantId)
  if (hasRequestedVariant) return

  throw new Error('ucp_product_requested_variant_missing')
}

const priceFromUcpProduct = (
  record: Record<string, unknown>,
  preferredVariantId?: string | undefined
) => {
  const variant = firstVariantRecord(record, preferredVariantId)
  const priceRange = asRecord(record.priceRange) ?? asRecord(record.price_range)

  if (preferredVariantId) {
    return ucpMinorMoney(variant?.price) ??
      ucpMinorMoney(record.price) ??
      ucpMinorMoney(priceRange?.min) ??
      ucpMinorMoney(priceRange)
  }

  return ucpMinorMoney(record.price) ??
    ucpMinorMoney(variant?.price) ??
    ucpMinorMoney(priceRange?.min) ??
    ucpMinorMoney(priceRange)
}

const explicitSellerRecordFromVariant = (
  record: Record<string, unknown>,
  preferredVariantId?: string | undefined
) => {
  if (!preferredVariantId) return undefined
  const variant = firstVariantRecord(record, preferredVariantId)
  return asRecord(variant?.seller) ?? asRecord(variant?.merchant) ?? asRecord(variant?.shop)
}

const sellerRecordFromUcpProduct = (
  record: Record<string, unknown>,
  preferredVariantId?: string | undefined
) => {
  const variant = firstVariantRecord(record, preferredVariantId)
  if (preferredVariantId) {
    return asRecord(variant?.seller) ??
      asRecord(variant?.merchant) ??
      asRecord(variant?.shop) ??
      asRecord(record.seller) ??
      asRecord(record.merchant) ??
      asRecord(record.shop)
  }

  return asRecord(record.seller) ??
    asRecord(variant?.seller) ??
    asRecord(record.merchant) ??
    asRecord(variant?.merchant) ??
    asRecord(record.shop) ??
    asRecord(variant?.shop)
}

const sellerDomainFromUcpProduct = (
  record: Record<string, unknown>,
  preferredVariantId?: string | undefined
) => {
  const explicitVariantSeller = explicitSellerRecordFromVariant(record, preferredVariantId)
  if (explicitVariantSeller) {
    return asString(explicitVariantSeller.domain) ??
      hostnameFromHttpsUrl(safeHttpsUrl(explicitVariantSeller.url))
  }

  return asString(sellerRecordFromUcpProduct(record, preferredVariantId)?.domain) ??
    asString(nestedRecord(record, 'merchant')?.domain) ??
    asString(nestedRecord(record, 'shop')?.domain) ??
    asString(record.sellerDomain) ??
    asString(record.seller_domain)
}

const sellerIdentityFromUcpProduct = (
  record: Record<string, unknown>,
  preferredVariantId?: string | undefined
) => {
  const explicitVariantSeller = explicitSellerRecordFromVariant(record, preferredVariantId)
  const seller = explicitVariantSeller ?? sellerRecordFromUcpProduct(record, preferredVariantId)
  const sellerUrl = safeHttpsUrl(seller?.url) ?? (explicitVariantSeller
    ? undefined
    : safeHttpsUrl(record.sellerUrl) ?? safeHttpsUrl(record.seller_url))
  const domain = asString(seller?.domain) ?? hostnameFromHttpsUrl(sellerUrl)
  if (!domain) return undefined
  const id = asString(seller?.id)
  const name = asString(seller?.name)

  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    domain,
    ...(sellerUrl ? { url: sellerUrl } : {})
  } satisfies NonNullable<CatalogProductSearchInput['seller']>
}

const comparableIdentityValue = (value: string | undefined) =>
  value?.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') || undefined

const sellerIdentityValues = (seller: CatalogProductSearchInput['seller'] | undefined) => [
  comparableIdentityValue(seller?.name),
  comparableIdentityValue(seller?.domain),
  comparableIdentityValue(seller?.url ? hostnameFromHttpsUrl(seller.url) : undefined)
].filter((value): value is string => Boolean(value))

const isSellerEquivalentProductBrand = (
  brand: string,
  seller: CatalogProductSearchInput['seller'] | undefined
) => {
  const candidate = comparableIdentityValue(brand)
  if (!candidate) return true
  return sellerIdentityValues(seller).includes(candidate)
}

const productBrandFromUcpProduct = (
  record: Record<string, unknown>,
  seller: CatalogProductSearchInput['seller'] | undefined
) => {
  const candidate = asString(record.brand) ??
    asString(record.productBrand) ??
    asString(record.product_brand) ??
    asString(record.manufacturer) ??
    asString(record.vendor)
  if (!candidate) return undefined
  return isSellerEquivalentProductBrand(candidate, seller) ? undefined : candidate
}

const catalogProductWithSellerSeparatedBrand = (
  product: CatalogProductSearchInput
): CatalogProductSearchInput => {
  if (!product.brand || !isSellerEquivalentProductBrand(product.brand, product.seller)) return product

  const rest: CatalogProductSearchInput = { ...product }
  delete rest.brand
  return rest
}

const descriptionTextFromUcpProduct = (value: unknown) => {
  const direct = asString(value)
  if (direct) return direct

  const record = asRecord(value)
  const plain = asString(record?.plain)
  if (plain) return plain

  const html = asString(record?.html)
  if (!html) return undefined

  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || undefined
}

const variantCheckoutUrlFromUcpProduct = (
  record: Record<string, unknown>,
  preferredVariantId?: string | undefined
) => {
  const variant = firstVariantRecord(record, preferredVariantId)
  return asString(variant?.checkout_url) ?? asString(variant?.checkoutUrl)
}

const handoffFromUcpProduct = ({
  productUrl,
  seller,
  variantCheckoutUrl
}: {
  productUrl: string | undefined
  seller: CatalogProductSearchInput['seller'] | undefined
  variantCheckoutUrl: string | undefined
}): CatalogProductSearchInput['handoff'] | undefined => {
  if (variantCheckoutUrl) return { type: 'variant_checkout', url: variantCheckoutUrl }
  if (productUrl) return { type: 'product', url: productUrl }
  if (seller?.url) return { type: 'seller', url: seller.url }
  return undefined
}

const categoryPathFromUcpProduct = (record: Record<string, unknown>) => {
  const categories = asStringArray(record.categoryPath).length > 0
    ? asStringArray(record.categoryPath)
    : categoryNames(record.categories)
  if (categories.length > 0) return categories

  const category = asString(record.category) ?? asString(record.productType) ?? asString(record.product_type)
  return category ? [category] : ['Catalog']
}

const categoryNames = (value: unknown) => {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    const direct = asString(item)
    if (direct) return [direct]

    const record = asRecord(item)
    return asString(record?.name) ?? asString(record?.title) ?? asString(record?.value) ?? []
  })
}

const mediaFromUcpProduct = (record: Record<string, unknown>) => {
  const media = firstArray(record.media, record.images, record.photos)
  if (!media) return []

  return media.flatMap((item) => {
    const directUrl = safeHttpsUrl(item)
    if (directUrl) return [{ type: 'image' as const, url: directUrl }]

    const mediaRecord = asRecord(item)
    const url = safeHttpsUrl(mediaRecord?.url) ?? safeHttpsUrl(mediaRecord?.src)
    if (!url) return []

    const rawType = asString(mediaRecord?.type)?.toLowerCase()
    const type = rawType === 'video'
      ? 'video'
      : rawType === 'image'
        ? 'image'
        : 'unknown'
    const alt = asString(mediaRecord?.alt) ?? asString(mediaRecord?.altText) ?? asString(mediaRecord?.alt_text)

    return [{ type, url, ...(alt ? { alt } : {}) }]
  })
}

const optionValuesFromUcpProduct = (value: unknown): CatalogProductDetail['options'][number]['values'] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const direct = asString(item)
    if (direct) return [{ label: direct }]

    const record = asRecord(item)
    const label = asString(record?.label) ?? asString(record?.value) ?? asString(record?.name)
    if (!label) return []

    const id = asString(record?.id) ?? asString(record?.value_id) ?? asString(record?.valueId)
    const available = asBoolean(record?.available)
    const exists = asBoolean(record?.exists)

    return [{
      label,
      ...(id ? { id } : {}),
      ...(available !== undefined ? { available } : {}),
      ...(exists !== undefined ? { exists } : {})
    }]
  })
}

const optionsFromUcpProduct = (record: Record<string, unknown>) => {
  const options = firstArray(record.options, record.productOptions, record.product_options)
  if (!options) return []

  return options.flatMap((item) => {
    const option = asRecord(item)
    const name = asString(option?.name) ?? asString(option?.label)
    const values = optionValuesFromUcpProduct(option?.values)
    if (!name || values.length === 0) return []

    return [{ name, values }]
  })
}

const selectedOptionsFromUcpValue = (value: unknown): CatalogProductDetail['selected'] => {
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => {
    const selected = asRecord(item)
    const selectedValue = asRecord(selected?.value)
    const name = asString(selected?.name) ?? asString(selected?.option)
    const label = asString(selected?.label) ??
      asString(selected?.value) ??
      asString(selectedValue?.label) ??
      asString(selectedValue?.value)
    if (!name || !label) return []

    const id = asString(selected?.id) ??
      asString(selected?.value_id) ??
      asString(selected?.valueId) ??
      asString(selectedValue?.id)

    return [{ name, label, ...(id ? { id } : {}) }]
  })
}

const selectedOptionsFromVariant = (variant: Record<string, unknown>) =>
  selectedOptionsFromUcpValue(firstArray(variant.selectedOptions, variant.selected_options, variant.options))

const variantUrlFromUcpProduct = (
  variant: Record<string, unknown>,
  allowedDomains: string[],
  requireSellerDomainMatch: boolean
) => assertSafeUrl({
  value: asString(variant.url) ?? asString(variant.productUrl) ?? asString(variant.product_url),
  allowedDomains,
  requireSellerDomainMatch
})

const variantsFromUcpProduct = ({
  record,
  fallbackAllowedSellerDomains,
  requireProductUrlDomainMatch,
  requireCheckoutUrlDomainMatch
}: {
  record: Record<string, unknown>
  fallbackAllowedSellerDomains: string[]
  requireProductUrlDomainMatch: boolean
  requireCheckoutUrlDomainMatch: boolean
}): CatalogProductDetail['variants'] => {
  const variants = firstArray(record.variants, nestedRecord(record, 'variants')?.edges)
  if (!variants) return []

  return variants.flatMap((item) => {
    const variant = asRecord(asRecord(item)?.node) ?? asRecord(item)
    if (!variant) return []

    const variantId = variantRecordId(variant)
    if (!variantId) return []

    const explicitSellerRecord = asRecord(variant.seller) ??
      asRecord(variant.merchant) ??
      asRecord(variant.shop)
    const seller = sellerIdentityFromUcpProduct(record, variantId)
    const explicitSellerDomain = asString(explicitSellerRecord?.domain) ??
      hostnameFromHttpsUrl(safeHttpsUrl(explicitSellerRecord?.url))
    const allowedSellerDomains = explicitSellerRecord
      ? sellerAuthorityDomains(seller, explicitSellerDomain)
      : [...fallbackAllowedSellerDomains]

    let productUrl: string | undefined
    let checkoutUrl: string | undefined
    try {
      productUrl = variantUrlFromUcpProduct(variant, allowedSellerDomains, requireProductUrlDomainMatch)
      checkoutUrl = assertSafeUrl({
        value: asString(variant.checkout_url) ?? asString(variant.checkoutUrl),
        allowedDomains: allowedSellerDomains,
        requireSellerDomainMatch: requireCheckoutUrlDomainMatch
      })
    } catch {
      return []
    }
    const title = asString(variant.title)
    const price = ucpMinorMoney(variant.price)
    const handoff = checkoutUrl
      ? { type: 'variant_checkout' as const, url: checkoutUrl }
      : productUrl
        ? { type: 'product' as const, url: productUrl }
        : seller?.url
          ? { type: 'seller' as const, url: seller.url }
          : undefined

    const variantDescription = descriptionTextFromUcpProduct(variant.description)

    return [{
      variantId,
      ...(title ? { title } : {}),
      ...(variantDescription ? { description: variantDescription } : {}),
      selectedOptions: selectedOptionsFromVariant(variant),
      ...(price ? { price } : {}),
      availability: availabilityFromUcpProduct({ ...record, variants: [variant] }, variantId),
      condition: conditionFromUcpProduct(variant.condition ?? record.condition),
      ...(seller ? { seller } : {}),
      ...(productUrl ? { productUrl } : {}),
      ...(handoff ? { handoff } : {})
    }]
  })
}

/**
 * Merchant-written selling points and attributes.
 *
 * Sources hand these over as loose metadata — an array of sentences under
 * `unique_selling_points` or `top_features`, and a newline-delimited
 * "Label: value" blob under `tech_specs`. Normalising here means one parser in
 * one place instead of every consumer guessing at a vendor shape, and it is the
 * difference between a product page with three rows and one with the shop's
 * actual specification table.
 */
const metadataLines = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const text = asString(entry)
      return text ? [text] : []
    })
  }
  const text = asString(value)
  return text ? text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : []
}

const highlightsFromUcpProduct = (record: Record<string, unknown>) => {
  const metadata = asRecord(record.metadata)
  if (!metadata) return undefined
  const lines = [
    ...metadataLines(metadata.top_features ?? metadata.topFeatures),
    ...metadataLines(metadata.unique_selling_points ?? metadata.uniqueSellingPoints)
  ]
    .map((line) => line.replace(/^[-•*]\s*/, '').trim())
    .filter((line) => line.length > 2 && line.length <= 400)

  const unique = [...new Set(lines)].slice(0, 24)
  return unique.length > 0 ? unique : undefined
}

const specificationsFromUcpProduct = (record: Record<string, unknown>) => {
  const metadata = asRecord(record.metadata)
  if (!metadata) return undefined

  const specs = metadataLines(metadata.tech_specs ?? metadata.techSpecs).flatMap((line) => {
    const separator = line.indexOf(':')
    // A line with no separator is prose, not an attribute, and forcing it into
    // a two-column table would produce a row with an empty label.
    if (separator <= 0 || separator > 120) return []
    const label = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    return label && value && value.length <= 600 ? [{ label, value }] : []
  })

  return specs.length > 0 ? specs.slice(0, 60) : undefined
}

const ratingFromUcpProduct = (record: Record<string, unknown>): CatalogProductSearchInput['rating'] => {
  const rating = asRecord(record.rating)
  if (!rating) return undefined
  const value = asNumber(rating.value)
  const scaleMax = asNumber(rating.scaleMax) ?? asNumber(rating.scale_max) ?? 5
  const count = asNumber(rating.count)
  if (value === undefined || count === undefined || !Number.isInteger(count) || value < 0 || scaleMax <= 0 || count < 0) return undefined
  return { value, scaleMax, count }
}

const conditionFromUcpProduct = (value: unknown): CatalogProductSearchInput['condition'] => {
  const normalized = (asString(value) ?? (Array.isArray(value) ? asString(value[0]) : undefined))?.toLowerCase()
  if (normalized === 'refurbished') return 'refurbished'
  if (normalized === 'open_box') return 'open_box'
  if (normalized === 'used' || normalized === 'secondhand') return 'used'
  if (normalized === 'unknown') return 'unknown'
  return 'new'
}

const availabilityFromUcpProduct = (
  record: Record<string, unknown>,
  preferredVariantId?: string | undefined
): CatalogProductSearchInput['availability'] => {
  const availabilityRecord = asRecord(record.availability)
  const rawAvailability = (
    asString(record.availability) ??
    asString(availabilityRecord?.status) ??
    asString(availabilityRecord?.state)
  )?.toLowerCase()
  if (rawAvailability === 'limited') return 'limited'
  if (rawAvailability === 'out_of_stock' || rawAvailability === 'unavailable') return 'out_of_stock'
  if (rawAvailability === 'unknown') return 'unknown'

  const variant = firstVariantRecord(record, preferredVariantId)
  const variantAvailability = asRecord(variant?.availability)
  const productAvailable = asBoolean(record.available) ??
    asBoolean(record.availableForSale) ??
    asBoolean(availabilityRecord?.available) ??
    asBoolean(availabilityRecord?.availableForSale)
  const variantAvailable = asBoolean(variant?.available) ??
    asBoolean(variant?.availableForSale) ??
    asBoolean(variantAvailability?.available) ??
    asBoolean(variantAvailability?.availableForSale)
  const available = preferredVariantId
    ? (variantAvailable ?? productAvailable)
    : (productAvailable ?? variantAvailable)
  if (available === false) return 'out_of_stock'
  if (available === true || rawAvailability === 'in_stock' || rawAvailability === 'available') return 'in_stock'
  return 'unknown'
}

const ucpProductToInput = ({
  product,
  source,
  now,
  requireSellerDomainMatch,
  requireSellerIdentity,
  requireSafeUrlDomainMatch,
  sourceLabelFactType,
  preferredVariantId
}: {
  product: unknown
  source: ApprovedCatalogSource
  now: Date
  requireSellerDomainMatch: boolean
  requireSellerIdentity: boolean
  requireSafeUrlDomainMatch: boolean
  sourceLabelFactType: string
  preferredVariantId?: string | undefined
}): CatalogProductSearchInput => {
  if (isCatalogProductSearchInput(product)) {
    assertPreferredVariantIsConfirmed(product, preferredVariantId)

    if (requireSellerDomainMatch && (!product.productUrl || !domainsMatch(product.productUrl, source.domain))) {
      throw new Error('ucp_product_seller_mismatch')
    }

    if (requireSafeUrlDomainMatch) {
      const urls = [product.productUrl, product.handoff?.url].filter((url): url is string => Boolean(url))
      if (urls.some((url) => !domainsMatch(url, source.domain))) {
        throw new Error('ucp_product_source_url_mismatch')
      }
    }

    if (requireSellerIdentity && !product.seller?.domain) {
      throw new Error('ucp_product_seller_identity_missing')
    }

    return catalogProductWithSellerSeparatedBrand(product)
  }

  const record = asRecord(product)
  if (!record) throw new Error('ucp_product_invalid')
  assertPreferredVariantIsConfirmed(record, preferredVariantId)

  const sellerDomain = sellerDomainFromUcpProduct(record, preferredVariantId)
  if (requireSellerDomainMatch && (!sellerDomain || !domainsMatch(sellerDomain, source.domain))) {
    throw new Error('ucp_product_seller_mismatch')
  }

  const seller = sellerIdentityFromUcpProduct(record, preferredVariantId)
  if (requireSellerIdentity && !seller) throw new Error('ucp_product_seller_identity_missing')

  const variant = firstVariantRecord(record, preferredVariantId)
  const productId = asString(record.productId) ?? asString(record.product_id) ?? asString(record.id)
  const title = asString(record.title) ?? asString(record.name)
  if (!productId || !title) throw new Error('ucp_product_required_fields_missing')

  const fetchedAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString()
  const brand = productBrandFromUcpProduct(record, seller)
  const description = descriptionTextFromUcpProduct(record.description) ?? asString(record.summary)
  const allowedSellerDomains = sellerAuthorityDomains(seller, sellerDomain ?? source.domain)
  const requireUrlDomainMatch = requireSellerDomainMatch || requireSellerIdentity || requireSafeUrlDomainMatch
  const recordProductUrl = asString(record.productUrl) ?? asString(record.product_url) ?? asString(record.url)
  const variantProductUrl = asString(variant?.url) ?? asString(variant?.productUrl) ?? asString(variant?.product_url)

  // Global Catalog search can return one UPID-clustered product with offers from
  // several merchants. The product-level URL is not authoritative for every
  // seller-bearing variant in that cluster. Prefer a variant URL when present;
  // otherwise keep the product URL only when it belongs to the selected seller.
  let productUrl: string | undefined
  if (preferredVariantId && !variantProductUrl && recordProductUrl) {
    const safeRecordProductUrl = assertSafeUrl({
      value: recordProductUrl,
      allowedDomains: allowedSellerDomains,
      requireSellerDomainMatch: false
    })
    productUrl = !requireUrlDomainMatch ||
      (safeRecordProductUrl !== undefined && allowedSellerDomains.some((domain) => domainsMatch(safeRecordProductUrl, domain)))
      ? safeRecordProductUrl
      : undefined
  } else {
    productUrl = assertSafeUrl({
      value: preferredVariantId
        ? (variantProductUrl ?? recordProductUrl)
        : (recordProductUrl ?? variantProductUrl),
      allowedDomains: allowedSellerDomains,
      requireSellerDomainMatch: requireUrlDomainMatch
    })
  }
  const variantCheckoutUrl = assertSafeUrl({
    value: variantCheckoutUrlFromUcpProduct(record, preferredVariantId),
    allowedDomains: allowedSellerDomains,
    // Seller identity and checkout authority are separate facts in UCP Global Catalog.
    // A Shopify-issued checkout URL may be hosted outside the merchant's primary/storefront
    // domains. Broad discovery therefore requires HTTPS, while merchant-scoped modes can
    // still require same-authority binding through requireSellerDomainMatch.
    requireSellerDomainMatch: requireSellerDomainMatch || requireSafeUrlDomainMatch
  })

  const recordVariantId = asString(record.variantId) ?? asString(record.variant_id)
  const selectedVariantId = variant ? variantRecordId(variant) : undefined
  const variantId = preferredVariantId
    ? (selectedVariantId ?? recordVariantId)
    : (recordVariantId ?? selectedVariantId)
  const price = priceFromUcpProduct(record, preferredVariantId)
  const imageUrl = mediaFromUcpProduct(record).find((media) => media.type !== 'video')?.url
  const rating = ratingFromUcpProduct(record)
  const handoff = handoffFromUcpProduct({ productUrl, seller, variantCheckoutUrl })

  return {
    productId,
    businessId: source.businessId,
    businessName: source.displayName,
    title,
    ...(brand ? { brand } : {}),
    ...(description ? { description } : {}),
    categoryPath: categoryPathFromUcpProduct(record),
    ...(variantId ? { variantId } : {}),
    ...(price ? { price } : {}),
    availability: availabilityFromUcpProduct(record, preferredVariantId),
    condition: conditionFromUcpProduct(variant?.condition ?? record.condition),
    ...(productUrl ? { productUrl } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(rating ? { rating } : {}),
    ...(seller ? { seller } : {}),
    ...(handoff ? { handoff } : {}),
    tags: asStringArray(record.tags).length > 0
      ? asStringArray(record.tags)
      : asStringArray(variant?.tags),
    sourceLabel: {
      sourceId: source.businessId,
      sourceName: source.displayName,
      factType: sourceLabelFactType,
      fetchedAt,
      expiresAt,
      freshnessClass: 'advisory_catalog',
      bindingStatus: 'advisory'
    }
  }
}

const ucpProductToDetail = ({
  product,
  source,
  now,
  requireSellerDomainMatch,
  requireSellerIdentity,
  requireSafeUrlDomainMatch,
  sourceLabelFactType,
  preferredVariantId
}: {
  product: unknown
  source: ApprovedCatalogSource
  now: Date
  requireSellerDomainMatch: boolean
  requireSellerIdentity: boolean
  requireSafeUrlDomainMatch: boolean
  sourceLabelFactType: string
  preferredVariantId?: string | undefined
}): CatalogProductDetail => {
  const summary = ucpProductToInput({
    product,
    source,
    now,
    requireSellerDomainMatch,
    requireSellerIdentity,
    requireSafeUrlDomainMatch,
    sourceLabelFactType,
    preferredVariantId
  })
  const record = asRecord(product)
  const sellerDomain = record ? sellerDomainFromUcpProduct(record, preferredVariantId) : undefined
  const seller = summary.seller
  const allowedSellerDomains = sellerAuthorityDomains(seller, sellerDomain ?? source.domain)
  const requireUrlDomainMatch = requireSellerDomainMatch || requireSellerIdentity || requireSafeUrlDomainMatch
  const detail = {
    productId: summary.productId,
    businessId: summary.businessId,
    businessName: summary.businessName,
    title: summary.title,
    ...(summary.brand ? { brand: summary.brand } : {}),
    ...(summary.description ? { description: summary.description } : {}),
    categoryPath: summary.categoryPath,
    ...(summary.variantId ? { variantId: summary.variantId } : {}),
    ...(summary.price ? { price: summary.price } : {}),
    availability: summary.availability,
    condition: summary.condition,
    ...(summary.productUrl ? { productUrl: summary.productUrl } : {}),
    ...(summary.imageUrl ? { imageUrl: summary.imageUrl } : {}),
    ...(summary.rating ? { rating: summary.rating } : {}),
    ...(seller ? { seller } : {}),
    ...(summary.handoff ? { handoff: summary.handoff } : {}),
    media: record ? mediaFromUcpProduct(record) : [],
    options: record ? optionsFromUcpProduct(record) : [],
    selected: record ? selectedOptionsFromUcpValue(record.selected) : [],
    variants: record
      ? variantsFromUcpProduct({
          record,
          fallbackAllowedSellerDomains: allowedSellerDomains,
          requireProductUrlDomainMatch: requireUrlDomainMatch,
          requireCheckoutUrlDomainMatch: requireSellerDomainMatch || requireSafeUrlDomainMatch
        })
      : [],
    ...(record && highlightsFromUcpProduct(record) ? { highlights: highlightsFromUcpProduct(record)! } : {}),
    ...(record && specificationsFromUcpProduct(record)
      ? { specifications: specificationsFromUcpProduct(record)! }
      : {}),
    warnings: [],
    sourceLabel: {
      ...summary.sourceLabel,
      factType: sourceLabelFactType
    }
  }

  return validateCatalogProductDetailForSource({ source, product: detail })
}

const normalizeUcpMcpProductForSource = ({
  product,
  source,
  now,
  requireSellerDomainMatch,
  requireSellerIdentity,
  sourceLabelFactType
}: {
  product: unknown
  source: ApprovedCatalogSource
  now: Date
  requireSellerDomainMatch: boolean
  requireSellerIdentity: boolean
  sourceLabelFactType: string
}) => {
  const record = asRecord(product)
  const sellerVariants = requireSellerIdentity && record
    ? variantRecordsFromUcpProduct(record).flatMap((variant) => {
        const variantId = variantRecordId(variant)
        if (!variantId) return []
        const seller = sellerIdentityFromUcpProduct(record, variantId)
        if (!seller) return []
        return [{ variantId, seller }]
      })
    : []
  const representativeSellerVariants = new Map<string, string>()
  for (const { variantId, seller } of sellerVariants) {
    const sellerKey = seller.id
      ? `id:${seller.id}`
      : `domain:${normalizedDomain(seller.domain)}`
    if (!representativeSellerVariants.has(sellerKey)) {
      representativeSellerVariants.set(sellerKey, variantId)
    }
  }

  // Shopify Global Catalog clusters search results by product identity and can return
  // offers from several merchants as seller-bearing variants. Preserve one search
  // result per merchant offer, but do not fan a single merchant's option matrix into
  // duplicate results for every color/size variant.
  const preferredVariantIds = representativeSellerVariants.size > 1
    ? [...representativeSellerVariants.values()]
    : [undefined]

  return preferredVariantIds.map((preferredVariantId) => ucpProductToInput({
    product,
    source,
    now,
    requireSellerDomainMatch,
    requireSellerIdentity,
    requireSafeUrlDomainMatch: false,
    sourceLabelFactType,
    ...(preferredVariantId ? { preferredVariantId } : {})
  }))
}

const normalizeUcpMcpProductsForSource = ({
  source,
  products,
  now,
  requireSellerDomainMatch,
  requireSellerIdentity,
  sourceLabelFactType
}: {
  source: ApprovedCatalogSource
  products: unknown[]
  now: Date
  requireSellerDomainMatch: boolean
  requireSellerIdentity: boolean
  sourceLabelFactType: string
}) => {
  const validProducts: CatalogProductSearchInput[] = []
  let droppedProducts = 0

  for (const product of products) {
    try {
      const normalizedProducts = normalizeUcpMcpProductForSource({
        product,
        source,
        now,
        requireSellerDomainMatch,
        requireSellerIdentity,
        sourceLabelFactType
      })
      validProducts.push(...validateProducts(source, normalizedProducts))
    } catch {
      droppedProducts += 1
    }
  }

  if (validProducts.length === 0) throw new Error('ucp_mcp_catalog_products_invalid')

  return {
    products: validProducts,
    droppedProducts
  }
}

const normalizeUcpRestProductsForSource = ({
  source,
  products,
  now,
  sourceLabelFactType
}: {
  source: ApprovedCatalogSource
  products: unknown[]
  now: Date
  sourceLabelFactType: string
}) => validateProducts(
  source,
  products.map((product) => ucpProductToInput({
    product,
    source,
    now,
    requireSellerDomainMatch: false,
    requireSellerIdentity: false,
    requireSafeUrlDomainMatch: true,
    sourceLabelFactType
  }))
)

export const createUcpMcpCatalogFetcher = ({
  adapterId,
  endpointUrl,
  platformProfileUrl,
  allowLocalPlatformProfileUrl,
  toolName = 'search_catalog',
  headers = {},
  authHeader,
  fetcher = createConnectorHttpFetcher(),
  maxResponseBytes = defaultMaxResponseBytes,
  catalogView,
  requireSellerDomainMatch = false,
  requireSellerIdentity = false,
  sourceLabelFactType = 'approved_catalog_product',
  fetchedMessageCode = 'ucp_mcp_catalog_fetched',
  fetchedMessageText = 'Approved UCP MCP catalog product facts were fetched and validated.'
}: UcpMcpCatalogFetcherOptions): CatalogProductFetcher => {
  const normalizedEndpointUrl = normalizeHttpsUrl(endpointUrl, adapterId)
  const normalizedPlatformProfileUrl = normalizePlatformProfileUrl(
    platformProfileUrl,
    adapterId,
    allowLocalPlatformProfileUrl
  )

  return async (request) => {
    const startedAt = Date.now()
    let response: ConnectorHttpResponse

    try {
      response = await fetcher(normalizedEndpointUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'arro-catalog-adapter-id': adapterId,
          ...headers,
          ...(authHeader ? { [authHeader.name]: authHeader.value } : {})
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          id: 'arro-catalog-search',
          params: {
            name: toolName,
            arguments: {
              meta: {
                'ucp-agent': {
                  profile: normalizedPlatformProfileUrl
                }
              },
              catalog: mcpCatalogFromRequest(request, catalogView)
            }
          }
        }),
        ...(request.signal ? { signal: request.signal } : {})
      })
    } catch {
      return adapterFailure({
        request,
        startedAt,
        status: 'error',
        code: 'ucp_mcp_catalog_request_failed',
        text: 'The UCP MCP catalog adapter request failed before product facts could be read.',
        nextAction: 'Inspect UCP MCP endpoint reachability, profile negotiation, credentials, and connector rate limits.'
      })
    }

    if (!response.ok) {
      discardResponseBody(response)
      return adapterFailure({
        request,
        startedAt,
        status: response.status === 404 ? 'unavailable' : 'error',
        code: response.status === 404
          ? 'ucp_mcp_catalog_unavailable'
          : 'ucp_mcp_catalog_http_error',
        text: 'The UCP MCP catalog adapter returned a non-success HTTP status.',
        nextAction: 'Keep this source out of ranking until UCP MCP negotiation and catalog access are healthy.'
      })
    }

    let payload: unknown
    try {
      payload = await readJsonPayload(response, maxResponseBytes, catalogJsonPayloadOptions)
      if (mcpErrorFromPayload(payload)) throw new Error('ucp_mcp_json_rpc_error')
    } catch {
      return invalidResponseFailure({
        request,
        startedAt,
        code: 'ucp_mcp_catalog_response_invalid'
      })
    }

    try {
      const normalizedProducts = normalizeUcpMcpProductsForSource({
        source: request.source,
        products: productsFromMcpPayload(payload),
        now: request.now ?? new Date(),
        requireSellerDomainMatch,
        requireSellerIdentity,
        sourceLabelFactType
      })
      const pagination = paginationFromMcpPayload(payload)
      return fetchedResult({
        request,
        startedAt,
        products: normalizedProducts.products,
        ...(pagination ? { pagination } : {}),
        messages: [
          statusMessage('info', fetchedMessageCode, fetchedMessageText),
          ...(normalizedProducts.droppedProducts > 0
            ? [
                statusMessage(
                  'warning',
                  'ucp_mcp_catalog_products_dropped',
                  'Some UCP MCP catalog products failed validation and were excluded.',
                  'Inspect upstream product shape and keep invalid products out of ranking.'
                )
              ]
            : [])
        ]
      })
    } catch (error) {
      return invalidResponseFailure({
        request,
        startedAt,
        code: error instanceof CatalogProductValidationError
          ? error.code
          : 'ucp_mcp_catalog_response_invalid'
      })
    }
  }
}

export const createUcpMcpCatalogProductDetailFetcher = ({
  adapterId,
  endpointUrl,
  platformProfileUrl,
  allowLocalPlatformProfileUrl,
  headers = {},
  authHeader,
  fetcher = createConnectorHttpFetcher(),
  maxResponseBytes = defaultMaxResponseBytes,
  requireSellerDomainMatch = false,
  requireSellerIdentity = false,
  sourceLabelFactType = 'approved_catalog_product_detail',
  fetchedMessageCode = 'ucp_mcp_product_detail_fetched',
  fetchedMessageText = 'UCP MCP product detail facts were fetched and validated.'
}: UcpMcpCatalogProductDetailFetcherOptions): CatalogProductDetailFetcher => {
  const normalizedEndpointUrl = normalizeHttpsUrl(endpointUrl, adapterId)
  const normalizedPlatformProfileUrl = normalizePlatformProfileUrl(
    platformProfileUrl,
    adapterId,
    allowLocalPlatformProfileUrl
  )

  return async (request) => {
    const startedAt = Date.now()
    let response: ConnectorHttpResponse

    try {
      response = await fetcher(normalizedEndpointUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'arro-catalog-adapter-id': adapterId,
          ...headers,
          ...(authHeader ? { [authHeader.name]: authHeader.value } : {})
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          id: 'arro-product-detail',
          params: {
            name: 'get_product',
            arguments: {
              meta: {
                'ucp-agent': {
                  profile: normalizedPlatformProfileUrl
                }
              },
              catalog: mcpProductDetailFromRequest(request)
            }
          }
        }),
        ...(request.signal ? { signal: request.signal } : {})
      })
    } catch {
      return adapterDetailFailure({
        request,
        startedAt,
        status: 'error',
        code: 'ucp_mcp_product_detail_request_failed',
        text: 'The UCP MCP product detail adapter request failed before product facts could be read.',
        nextAction: 'Inspect UCP MCP endpoint reachability, profile negotiation, credentials, and connector rate limits.'
      })
    }

    if (!response.ok) {
      discardResponseBody(response)
      return adapterDetailFailure({
        request,
        startedAt,
        status: response.status === 404 ? 'unavailable' : 'error',
        code: response.status === 404
          ? 'ucp_mcp_product_detail_unavailable'
          : 'ucp_mcp_product_detail_http_error',
        text: 'The UCP MCP product detail adapter returned a non-success HTTP status.',
        nextAction: 'Keep product detail unavailable until UCP MCP negotiation and detail access are healthy.'
      })
    }

    let payload: unknown
    try {
      payload = await readJsonPayload(response, maxResponseBytes, catalogJsonPayloadOptions)
      if (mcpErrorFromPayload(payload)) throw new Error('ucp_mcp_json_rpc_error')
    } catch {
      return invalidDetailResponseFailure({
        request,
        startedAt,
        code: 'ucp_mcp_product_detail_response_invalid'
      })
    }

    try {
      const product = ucpProductToDetail({
        product: productFromMcpPayload(payload),
        source: request.source,
        now: request.now ?? new Date(),
        requireSellerDomainMatch,
        requireSellerIdentity,
        requireSafeUrlDomainMatch: false,
        sourceLabelFactType,
        preferredVariantId: request.detailRequest.variantId
      })

      return fetchedDetailResult({
        request,
        startedAt,
        product,
        messages: [statusMessage('info', fetchedMessageCode, fetchedMessageText)]
      })
    } catch (reason) {
      return detailTransformFailure({
        request,
        startedAt,
        reason,
        code: 'ucp_mcp_product_detail_response_invalid'
      })
    }
  }
}

export const createUcpMcpCatalogCartPrepareFetcher = ({
  adapterId,
  endpointUrl,
  platformProfileUrl,
  allowLocalPlatformProfileUrl,
  toolName = 'create_cart',
  headers = {},
  authHeader,
  fetcher = createConnectorHttpFetcher(),
  maxResponseBytes = defaultMaxResponseBytes,
  fetchedMessageCode = 'ucp_mcp_cart_prepared',
  fetchedMessageText = 'UCP MCP cart facts were fetched and validated.'
}: UcpMcpCatalogCartPrepareFetcherOptions): CatalogCartPrepareFetcher => {
  const normalizedEndpointUrl = normalizeHttpsUrl(endpointUrl, adapterId)
  const normalizedPlatformProfileUrl = normalizePlatformProfileUrl(
    platformProfileUrl,
    adapterId,
    allowLocalPlatformProfileUrl
  )

  return async (request) => {
    const startedAt = Date.now()
    let response: ConnectorHttpResponse

    try {
      response = await fetcher(normalizedEndpointUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'arro-catalog-adapter-id': adapterId,
          ...headers,
          ...(authHeader ? { [authHeader.name]: authHeader.value } : {})
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/call',
          id: 'arro-cart-prepare',
          params: {
            name: toolName,
            arguments: mcpCartPrepareArgumentsFromRequest({
              request,
              toolName,
              platformProfileUrl: normalizedPlatformProfileUrl
            })
          }
        }),
        ...(request.signal ? { signal: request.signal } : {})
      })
    } catch {
      return adapterCartPrepareFailure({
        request,
        startedAt,
        status: 'error',
        code: 'ucp_mcp_cart_prepare_request_failed',
        text: 'The UCP MCP cart adapter request failed before cart facts could be read.',
        nextAction: 'Inspect UCP MCP endpoint reachability, cart capability negotiation, credentials, and connector rate limits.'
      })
    }

    if (!response.ok) {
      discardResponseBody(response)
      return adapterCartPrepareFailure({
        request,
        startedAt,
        status: response.status === 404 ? 'unavailable' : 'error',
        code: response.status === 404
          ? 'ucp_mcp_cart_prepare_unavailable'
          : 'ucp_mcp_cart_prepare_http_error',
        text: 'The UCP MCP cart adapter returned a non-success HTTP status.',
        nextAction: 'Keep cart preparation unavailable until UCP MCP negotiation and cart access are healthy.'
      })
    }

    let payload: unknown
    try {
      payload = await readJsonPayload(response, maxResponseBytes, catalogJsonPayloadOptions)
      if (mcpErrorFromPayload(payload)) throw new Error('ucp_mcp_json_rpc_error')
    } catch {
      return invalidCartPrepareResponseFailure({
        request,
        startedAt,
        code: 'ucp_mcp_cart_prepare_response_invalid'
      })
    }

    try {
      return fetchedCartPrepareResult({
        request,
        startedAt,
        cart: ucpCartToPreparedCart({
          cart: cartFromMcpPayload(payload),
          source: request.source,
          request,
          now: request.now ?? new Date()
        }),
        messages: [statusMessage('info', fetchedMessageCode, fetchedMessageText)]
      })
    } catch (error) {
      return invalidCartPrepareResponseFailure({
        request,
        startedAt,
        code: error instanceof CatalogPreparedCartValidationError
          ? error.code
          : 'ucp_mcp_cart_prepare_response_invalid'
      })
    }
  }
}

export const createShopifyStorefrontMcpCatalogFetcher = ({
  adapterId,
  shopDomain,
  endpointUrl,
  platformProfileUrl,
  allowLocalPlatformProfileUrl,
  headers,
  authHeader,
  fetcher,
  maxResponseBytes
}: ShopifyStorefrontMcpCatalogFetcherOptions): CatalogProductFetcher => createUcpMcpCatalogFetcher({
  adapterId,
  endpointUrl: endpointFromShopifyMcpOptions({ adapterId, endpointUrl, shopDomain }),
  platformProfileUrl,
  ...(allowLocalPlatformProfileUrl ? { allowLocalPlatformProfileUrl } : {}),
  ...(headers ? { headers } : {}),
  ...(authHeader ? { authHeader } : {}),
  ...(fetcher ? { fetcher } : {}),
  ...(maxResponseBytes ? { maxResponseBytes } : {}),
  fetchedMessageCode: 'shopify_storefront_mcp_catalog_fetched',
  fetchedMessageText: 'Approved Shopify Storefront UCP MCP product facts were fetched and validated.'
})

export const createShopifyStorefrontMcpCatalogProductDetailFetcher = ({
  adapterId,
  shopDomain,
  endpointUrl,
  platformProfileUrl,
  allowLocalPlatformProfileUrl,
  headers,
  authHeader,
  fetcher,
  maxResponseBytes
}: ShopifyStorefrontMcpCatalogFetcherOptions): CatalogProductDetailFetcher => createUcpMcpCatalogProductDetailFetcher({
  adapterId,
  endpointUrl: endpointFromShopifyMcpOptions({ adapterId, endpointUrl, shopDomain }),
  platformProfileUrl,
  ...(allowLocalPlatformProfileUrl ? { allowLocalPlatformProfileUrl } : {}),
  ...(headers ? { headers } : {}),
  ...(authHeader ? { authHeader } : {}),
  ...(fetcher ? { fetcher } : {}),
  ...(maxResponseBytes ? { maxResponseBytes } : {}),
  fetchedMessageCode: 'shopify_storefront_mcp_product_detail_fetched',
  fetchedMessageText: 'Shopify Storefront UCP MCP product detail facts were fetched and validated.'
})

export const createShopifyStorefrontMcpCatalogCartPrepareFetcher = ({
  adapterId,
  shopDomain,
  endpointUrl,
  platformProfileUrl,
  allowLocalPlatformProfileUrl,
  headers,
  authHeader,
  fetcher,
  maxResponseBytes
}: ShopifyStorefrontMcpCatalogFetcherOptions): CatalogCartPrepareFetcher => createUcpMcpCatalogCartPrepareFetcher({
  adapterId,
  endpointUrl: endpointFromShopifyMcpOptions({ adapterId, endpointUrl, shopDomain }),
  platformProfileUrl,
  ...(allowLocalPlatformProfileUrl ? { allowLocalPlatformProfileUrl } : {}),
  ...(headers ? { headers } : {}),
  ...(authHeader ? { authHeader } : {}),
  ...(fetcher ? { fetcher } : {}),
  ...(maxResponseBytes ? { maxResponseBytes } : {}),
  fetchedMessageCode: 'shopify_storefront_mcp_cart_prepared',
  fetchedMessageText: 'Shopify Storefront UCP MCP cart facts were fetched and validated.'
})

export const createShopifyGlobalCatalogMcpFetcher = ({
  adapterId,
  endpointUrl = defaultShopifyGlobalCatalogMcpEndpoint,
  platformProfileUrl,
  allowLocalPlatformProfileUrl,
  headers,
  authHeader,
  fetcher,
  maxResponseBytes
}: ShopifyGlobalCatalogMcpFetcherOptions): CatalogProductFetcher => createUcpMcpCatalogFetcher({
  adapterId,
  endpointUrl,
  platformProfileUrl,
  ...(allowLocalPlatformProfileUrl ? { allowLocalPlatformProfileUrl } : {}),
  ...(headers ? { headers } : {}),
  ...(authHeader ? { authHeader } : {}),
  ...(fetcher ? { fetcher } : {}),
  ...(maxResponseBytes ? { maxResponseBytes } : {}),
  requireSellerDomainMatch: true,
  fetchedMessageCode: 'shopify_global_catalog_mcp_fetched',
  fetchedMessageText: 'Approved Shopify Global Catalog UCP MCP product facts were fetched and validated for the approved seller.'
})

export const createShopifyGlobalCatalogMcpProductDetailFetcher = ({
  adapterId,
  endpointUrl = defaultShopifyGlobalCatalogMcpEndpoint,
  platformProfileUrl,
  allowLocalPlatformProfileUrl,
  headers,
  authHeader,
  fetcher,
  maxResponseBytes
}: ShopifyGlobalCatalogMcpFetcherOptions): CatalogProductDetailFetcher => createUcpMcpCatalogProductDetailFetcher({
  adapterId,
  endpointUrl,
  platformProfileUrl,
  ...(allowLocalPlatformProfileUrl ? { allowLocalPlatformProfileUrl } : {}),
  ...(headers ? { headers } : {}),
  ...(authHeader ? { authHeader } : {}),
  ...(fetcher ? { fetcher } : {}),
  ...(maxResponseBytes ? { maxResponseBytes } : {}),
  requireSellerDomainMatch: true,
  fetchedMessageCode: 'shopify_global_catalog_mcp_product_detail_fetched',
  fetchedMessageText: 'Shopify Global Catalog product detail facts were fetched and validated for the approved seller.'
})

export const createShopifyGlobalCatalogBroadMcpFetcher = ({
  adapterId,
  endpointUrl = defaultShopifyGlobalCatalogMcpEndpoint,
  platformProfileUrl,
  allowLocalPlatformProfileUrl,
  headers,
  authHeader,
  fetcher,
  maxResponseBytes
}: ShopifyGlobalCatalogBroadMcpFetcherOptions): CatalogProductFetcher => createUcpMcpCatalogFetcher({
  adapterId,
  endpointUrl,
  platformProfileUrl,
  ...(allowLocalPlatformProfileUrl ? { allowLocalPlatformProfileUrl } : {}),
  ...(headers ? { headers } : {}),
  ...(authHeader ? { authHeader } : {}),
  ...(fetcher ? { fetcher } : {}),
  ...(maxResponseBytes ? { maxResponseBytes } : {}),
  requireSellerIdentity: true,
  sourceLabelFactType: 'connected_catalog_product',
  catalogView: 'offer',
  fetchedMessageCode: 'shopify_global_catalog_broad_mcp_fetched',
  fetchedMessageText: 'Shopify Global Catalog product facts were fetched and validated with per-product seller identity.'
})

export const createShopifyGlobalCatalogBroadMcpProductDetailFetcher = ({
  adapterId,
  endpointUrl = defaultShopifyGlobalCatalogMcpEndpoint,
  platformProfileUrl,
  allowLocalPlatformProfileUrl,
  headers,
  authHeader,
  fetcher,
  maxResponseBytes
}: ShopifyGlobalCatalogBroadMcpFetcherOptions): CatalogProductDetailFetcher => createUcpMcpCatalogProductDetailFetcher({
  adapterId,
  endpointUrl,
  platformProfileUrl,
  ...(allowLocalPlatformProfileUrl ? { allowLocalPlatformProfileUrl } : {}),
  ...(headers ? { headers } : {}),
  ...(authHeader ? { authHeader } : {}),
  ...(fetcher ? { fetcher } : {}),
  ...(maxResponseBytes ? { maxResponseBytes } : {}),
  requireSellerIdentity: true,
  sourceLabelFactType: 'connected_catalog_product_detail',
  fetchedMessageCode: 'shopify_global_catalog_broad_mcp_product_detail_fetched',
  fetchedMessageText: 'Shopify Global Catalog product detail facts were fetched and validated with per-product seller identity.'
})

const moneyFromShopify = (value: ShopifyMoney | undefined): Money | undefined => {
  const currency = asString(value?.currencyCode)
  const amount = asString(value?.amount)
  if (!amount || !currency) return undefined

  return moneyFromDecimalString({ amount, currency })
}

const firstVariantNode = (node: Record<string, unknown>) => {
  const variants = asRecord(node.variants)
  const edges = Array.isArray(variants?.edges) ? variants.edges : []
  const firstEdge = asRecord(edges[0])
  return firstEdge ? asRecord(firstEdge.node) : undefined
}

const shopifyProductToInput = ({
  node,
  source,
  shopDomain,
  fetchedAt,
  expiresAt
}: {
  node: Record<string, unknown>
  source: ApprovedCatalogSource
  shopDomain: string
  fetchedAt: string
  expiresAt: string
}): CatalogProductSearchInput | undefined => {
  const productId = asString(node.id) ?? asString(node.handle)
  const title = asString(node.title)
  if (!productId || !title) return undefined

  const variant = firstVariantNode(node)
  const priceRange = asRecord(node.priceRange)
  const minVariantPrice = asRecord(priceRange?.minVariantPrice) as ShopifyMoney | undefined
  const variantPrice = asRecord(variant?.price) as ShopifyMoney | undefined
  const price = moneyFromShopify(variantPrice) ?? moneyFromShopify(minVariantPrice)
  const productType = asString(node.productType)
  const handle = asString(node.handle)
  const onlineStoreUrl = asString(node.onlineStoreUrl)
  const productUrl = onlineStoreUrl ?? (handle ? `https://${shopDomain}/products/${handle}` : undefined)
  const availableForSale = asBoolean(variant?.availableForSale)
  const brand = asString(node.vendor)
  const description = asString(node.description)
  const variantId = asString(variant?.id)
  const featuredImage = asRecord(node.featuredImage)
  const imageUrl = safeHttpsUrl(featuredImage?.url)

  return {
    productId,
    businessId: source.businessId,
    businessName: source.displayName,
    title,
    ...(brand ? { brand } : {}),
    ...(description ? { description } : {}),
    categoryPath: productType ? ['Shopify Catalog', productType] : ['Shopify Catalog'],
    ...(variantId ? { variantId } : {}),
    ...(price ? { price } : {}),
    availability: availableForSale === false ? 'out_of_stock' : availableForSale === true ? 'in_stock' : 'unknown',
    condition: 'new',
    ...(productUrl ? { productUrl } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    tags: asStringArray(node.tags),
    sourceLabel: {
      sourceId: source.businessId,
      sourceName: source.displayName,
      factType: 'approved_catalog_product',
      fetchedAt,
      expiresAt,
      freshnessClass: 'advisory_catalog',
      bindingStatus: 'advisory'
    }
  }
}

const shopifyProductsFromPayload = ({
  payload,
  source,
  shopDomain,
  now
}: {
  payload: unknown
  source: ApprovedCatalogSource
  shopDomain: string
  now: Date
}) => {
  const record = asRecord(payload)
  if (!record) throw new Error('shopify_payload_invalid')
  if (Array.isArray(record.errors) && record.errors.length > 0) throw new Error('shopify_graphql_errors')

  const data = asRecord(record.data)
  const products = asRecord(data?.products)
  const edges = Array.isArray(products?.edges) ? products.edges : undefined
  if (!edges) throw new Error('shopify_products_missing')

  const fetchedAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString()

  return edges.flatMap((edge) => {
    const node = asRecord(asRecord(edge)?.node)
    if (!node) return []

    const product = shopifyProductToInput({ node, source, shopDomain, fetchedAt, expiresAt })
    return product ? [product] : []
  })
}

export const createShopifyStorefrontGraphqlCatalogFetcher = ({
  adapterId,
  shopDomain,
  endpointUrl,
  storefrontAccessToken,
  fetcher = createConnectorHttpFetcher(),
  maxProducts = defaultShopifyMaxProducts,
  maxResponseBytes = defaultMaxResponseBytes
}: ShopifyStorefrontGraphqlCatalogFetcherOptions): CatalogProductFetcher => {
  const normalizedEndpointUrl = endpointFromShopifyOptions({ adapterId, endpointUrl, shopDomain })
  const normalizedShopDomain = shopDomain
    ? normalizeShopDomain(shopDomain, adapterId)
    : shopDomainFromEndpoint(normalizedEndpointUrl)
  const boundedMaxProducts = Math.min(Math.max(Math.trunc(maxProducts), 1), 50)

  return async (request) => {
    const startedAt = Date.now()
    let response: ConnectorHttpResponse

    try {
      response = await fetcher(normalizedEndpointUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-shopify-storefront-access-token': storefrontAccessToken,
          'arro-catalog-adapter-id': adapterId
        },
        body: JSON.stringify({
          query: shopifyStorefrontQuery,
          variables: {
            query: request.searchRequest.query,
            first: boundedMaxProducts
          }
        }),
        ...(request.signal ? { signal: request.signal } : {})
      })
    } catch {
      return adapterFailure({
        request,
        startedAt,
        status: 'error',
        code: 'shopify_storefront_graphql_request_failed',
        text: 'The legacy Shopify Storefront GraphQL catalog adapter request failed before product facts could be read.',
        nextAction: 'Inspect Storefront API credentials, endpoint reachability, and connector rate limits.'
      })
    }

    if (!response.ok) {
      discardResponseBody(response)
      return adapterFailure({
        request,
        startedAt,
        status: response.status === 404 ? 'unavailable' : 'error',
        code: response.status === 404
          ? 'shopify_storefront_graphql_unavailable'
          : 'shopify_storefront_graphql_http_error',
        text: 'The legacy Shopify Storefront GraphQL catalog adapter returned a non-success HTTP status.',
        nextAction: 'Keep this source out of ranking until the Storefront API credentials and endpoint are healthy.'
      })
    }

    let payload: unknown
    try {
      payload = await readJsonPayload(response, maxResponseBytes, catalogJsonPayloadOptions)
    } catch {
      return invalidResponseFailure({
        request,
        startedAt,
        code: 'shopify_storefront_graphql_response_invalid'
      })
    }

    try {
      const mappedProducts = shopifyProductsFromPayload({
        payload,
        source: request.source,
        shopDomain: normalizedShopDomain,
        now: request.now ?? new Date()
      })

      return fetchedResult({
        request,
        startedAt,
        products: validateProducts(request.source, mappedProducts),
        messages: [
          statusMessage(
            'info',
            'shopify_storefront_graphql_catalog_fetched',
            'Approved legacy Shopify Storefront GraphQL product facts were fetched and validated.'
          )
        ]
      })
    } catch (error) {
      return invalidResponseFailure({
        request,
        startedAt,
        code: error instanceof CatalogProductValidationError
          ? error.code
          : 'shopify_storefront_graphql_response_invalid'
      })
    }
  }
}
