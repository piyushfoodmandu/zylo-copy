import type {
  CatalogCartPrepareRequest,
  CatalogPreparedCart,
  CatalogProductDetail,
  CatalogProductDetailRequest,
  CatalogProductSearchInput,
  CatalogSearchRequest,
  PlainStatusMessage,
  TargetBusinessRecord
} from '@arro/contracts'
import {
  catalogPreparedCartErrorSummary,
  catalogProductDetailErrorSummary,
  catalogProductSearchInputErrorSummary,
  isCatalogPreparedCart,
  isCatalogProductDetail,
  isCatalogProductSearchInput
} from '@arro/contracts'
import {
  cartPrepareVisibleRecords,
  catalogVisibleRecords
} from './target-business-matrix.ts'

export type CatalogSource = {
  businessId: string
  domain: string
  displayName: string
  sourceType: TargetBusinessRecord['sourceType']
  profileUrl?: string
  profileHash?: string
  cartPreparationEvidence?: CartPreparationEvidence
  allowedHandoffAuthorities?: string[]
}

export type ApprovedCatalogSource = CatalogSource

export type CartPreparationEvidence = {
  capability: 'dev.ucp.shopping.cart' | 'dev.ucp.shopping.checkout'
  toolName: 'create_cart' | 'create_checkout'
  profileHash: string
  profileVersion: string
  checkedAt: string
  expiresAt: string
  allowedHandoffAuthorities: string[]
}

export type CatalogProductFetchStatus =
  | 'fetched'
  | 'unavailable'
  | 'timeout'
  | 'invalid_response'
  | 'error'

export type CatalogProductFetchRequest = {
  requestId: string
  correlationId: string
  source: CatalogSource
  searchRequest: CatalogSearchRequest
  timeoutMs: number
  signal?: AbortSignal
  now?: Date
}

export type CatalogProductFetchResult = {
  sourceId: string
  sourceName: string
  status: CatalogProductFetchStatus
  products: CatalogProductSearchInput[]
  pagination?: {
    cursor?: string
    hasNextPage: boolean
  }
  messages: PlainStatusMessage[]
  fetchedAt: string
  latencyMs: number
  /** Internal serving-path evidence; never changes product freshness labels. */
  cacheLayer?: 'memory' | 'projection' | 'coalesced'
}

export type CatalogProductFetcher = (
  request: CatalogProductFetchRequest
) => Promise<CatalogProductFetchResult>

export type CatalogProductDetailFetchRequest = {
  requestId: string
  correlationId: string
  source: CatalogSource
  detailRequest: CatalogProductDetailRequest
  timeoutMs: number
  signal?: AbortSignal
  now?: Date
}

export type CatalogProductDetailFetchResult = {
  sourceId: string
  sourceName: string
  status: CatalogProductFetchStatus
  product?: CatalogProductDetail
  messages: PlainStatusMessage[]
  fetchedAt: string
  latencyMs: number
  /** Internal serving-path evidence; never changes product freshness labels. */
  cacheLayer?: 'memory' | 'projection' | 'coalesced'
}

export type CatalogProductDetailFetcher = (
  request: CatalogProductDetailFetchRequest
) => Promise<CatalogProductDetailFetchResult>

export type CatalogCartPrepareFetchRequest = {
  requestId: string
  correlationId: string
  source: CatalogSource
  cartRequest: CatalogCartPrepareRequest
  timeoutMs: number
  signal?: AbortSignal
  now?: Date
}

export type CatalogCartPrepareFetchResult = {
  sourceId: string
  sourceName: string
  status: CatalogProductFetchStatus
  cart?: CatalogPreparedCart
  messages: PlainStatusMessage[]
  fetchedAt: string
  latencyMs: number
}

export type CatalogCartPrepareFetcher = (
  request: CatalogCartPrepareFetchRequest
) => Promise<CatalogCartPrepareFetchResult>

type FetchGuard = {
  signal: AbortSignal
  guardPromise: Promise<CatalogProductFetchResult>
  cleanup: () => void
}

type DetailFetchGuard = {
  signal: AbortSignal
  guardPromise: Promise<CatalogProductDetailFetchResult>
  cleanup: () => void
}

type CartPrepareFetchGuard = {
  signal: AbortSignal
  guardPromise: Promise<CatalogCartPrepareFetchResult>
  cleanup: () => void
}

export class CatalogProductValidationError extends Error {
  readonly code: 'invalid_catalog_product' | 'product_source_mismatch'

  constructor(
    code: CatalogProductValidationError['code'],
    message: string
  ) {
    super(message)
    this.name = 'CatalogProductValidationError'
    this.code = code
  }
}

export class CatalogProductDetailValidationError extends Error {
  readonly code: 'invalid_catalog_product_detail' | 'product_source_mismatch'

  constructor(
    code: CatalogProductDetailValidationError['code'],
    message: string
  ) {
    super(message)
    this.name = 'CatalogProductDetailValidationError'
    this.code = code
  }
}

export class CatalogPreparedCartValidationError extends Error {
  readonly code: 'invalid_catalog_cart' | 'cart_source_mismatch' | 'cart_handoff_authority_mismatch'

  constructor(
    code: CatalogPreparedCartValidationError['code'],
    message: string
  ) {
    super(message)
    this.name = 'CatalogPreparedCartValidationError'
    this.code = code
  }
}

const fetchLatencyMs = (startedAt: number) => Math.max(Date.now() - startedAt, 0)

const catalogFetchFailure = ({
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
    {
      severity: status === 'unavailable' ? 'info' : 'warning',
      code,
      text,
      nextAction
    }
  ],
  fetchedAt: (request.now ?? new Date()).toISOString(),
  latencyMs: fetchLatencyMs(startedAt)
})

const catalogProductDetailFetchFailure = ({
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
    {
      severity: status === 'unavailable' ? 'info' : 'warning',
      code,
      text,
      nextAction
    }
  ],
  fetchedAt: (request.now ?? new Date()).toISOString(),
  latencyMs: fetchLatencyMs(startedAt)
})

const catalogCartPrepareFetchFailure = ({
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
    {
      severity: status === 'unavailable' ? 'info' : 'warning',
      code,
      text,
      nextAction
    }
  ],
  fetchedAt: (request.now ?? new Date()).toISOString(),
  latencyMs: fetchLatencyMs(startedAt)
})

const createCatalogFetchGuard = (
  request: CatalogProductFetchRequest,
  startedAt: number
): FetchGuard => {
  const controller = new AbortController()
  const timeoutMs = Math.max(request.timeoutMs, 1)
  let timeout: NodeJS.Timeout | undefined
  let abortListener: (() => void) | undefined
  let settled = false
  let resolveGuard!: (result: CatalogProductFetchResult) => void

  const guardPromise = new Promise<CatalogProductFetchResult>((resolve) => {
    resolveGuard = resolve
  })

  const finish = (result: CatalogProductFetchResult) => {
    if (settled) return
    settled = true
    if (timeout) clearTimeout(timeout)
    if (abortListener) request.signal?.removeEventListener('abort', abortListener)
    resolveGuard(result)
  }

  timeout = setTimeout(() => {
    controller.abort(new Error(`Connector-backed catalog fetch timed out after ${timeoutMs}ms.`))
    finish(catalogFetchFailure({
      request,
      startedAt,
      status: 'timeout',
      code: 'connector_catalog_fetch_timeout',
      text: 'A connector-backed catalog source exceeded the connector timeout budget.',
      nextAction: 'Keep this source out of ranking for the request and inspect adapter latency before enabling broader traffic.'
    }))
  }, timeoutMs)

  if (request.signal) {
    abortListener = () => {
      controller.abort(request.signal?.reason)
      finish(catalogFetchFailure({
        request,
        startedAt,
        status: 'error',
        code: 'connector_catalog_fetch_aborted',
        text: 'A connector-backed catalog source fetch was canceled before completion.',
        nextAction: 'Retry only after the calling request or shutdown drain allows connector work to continue.'
      }))
    }
    request.signal.addEventListener('abort', abortListener, { once: true })
  }

  return {
    signal: controller.signal,
    guardPromise,
    cleanup: () => {
      settled = true
      if (timeout) clearTimeout(timeout)
      if (abortListener) request.signal?.removeEventListener('abort', abortListener)
    }
  }
}

const createCatalogProductDetailFetchGuard = (
  request: CatalogProductDetailFetchRequest,
  startedAt: number
): DetailFetchGuard => {
  const controller = new AbortController()
  const timeoutMs = Math.max(request.timeoutMs, 1)
  let timeout: NodeJS.Timeout | undefined
  let abortListener: (() => void) | undefined
  let settled = false
  let resolveGuard!: (result: CatalogProductDetailFetchResult) => void

  const guardPromise = new Promise<CatalogProductDetailFetchResult>((resolve) => {
    resolveGuard = resolve
  })

  const finish = (result: CatalogProductDetailFetchResult) => {
    if (settled) return
    settled = true
    if (timeout) clearTimeout(timeout)
    if (abortListener) request.signal?.removeEventListener('abort', abortListener)
    resolveGuard(result)
  }

  timeout = setTimeout(() => {
    controller.abort(new Error(`Catalog product detail fetch timed out after ${timeoutMs}ms.`))
    finish(catalogProductDetailFetchFailure({
      request,
      startedAt,
      status: 'timeout',
      code: 'catalog_product_detail_fetch_timeout',
      text: 'A catalog product detail source exceeded the connector timeout budget.',
      nextAction: 'Keep product detail unavailable for this source until adapter latency is healthy.'
    }))
  }, timeoutMs)

  if (request.signal) {
    abortListener = () => {
      controller.abort(request.signal?.reason)
      finish(catalogProductDetailFetchFailure({
        request,
        startedAt,
        status: 'error',
        code: 'catalog_product_detail_fetch_aborted',
        text: 'A catalog product detail fetch was canceled before completion.',
        nextAction: 'Retry only after the calling request or shutdown drain allows connector work to continue.'
      }))
    }
    request.signal.addEventListener('abort', abortListener, { once: true })
  }

  return {
    signal: controller.signal,
    guardPromise,
    cleanup: () => {
      settled = true
      if (timeout) clearTimeout(timeout)
      if (abortListener) request.signal?.removeEventListener('abort', abortListener)
    }
  }
}

const createCatalogCartPrepareFetchGuard = (
  request: CatalogCartPrepareFetchRequest,
  startedAt: number
): CartPrepareFetchGuard => {
  const controller = new AbortController()
  const timeoutMs = Math.max(request.timeoutMs, 1)
  let timeout: NodeJS.Timeout | undefined
  let abortListener: (() => void) | undefined
  let settled = false
  let resolveGuard!: (result: CatalogCartPrepareFetchResult) => void

  const guardPromise = new Promise<CatalogCartPrepareFetchResult>((resolve) => {
    resolveGuard = resolve
  })

  const finish = (result: CatalogCartPrepareFetchResult) => {
    if (settled) return
    settled = true
    if (timeout) clearTimeout(timeout)
    if (abortListener) request.signal?.removeEventListener('abort', abortListener)
    resolveGuard(result)
  }

  timeout = setTimeout(() => {
    controller.abort(new Error(`Catalog cart prepare timed out after ${timeoutMs}ms.`))
    finish(catalogCartPrepareFetchFailure({
      request,
      startedAt,
      status: 'timeout',
      code: 'catalog_cart_prepare_timeout',
      text: 'A cart source exceeded the connector timeout budget.',
      nextAction: 'Keep cart preparation unavailable for this source until adapter latency is healthy.'
    }))
  }, timeoutMs)

  if (request.signal) {
    abortListener = () => {
      controller.abort(request.signal?.reason)
      finish(catalogCartPrepareFetchFailure({
        request,
        startedAt,
        status: 'error',
        code: 'catalog_cart_prepare_aborted',
        text: 'A cart prepare request was canceled before completion.',
        nextAction: 'Retry only after the calling request or shutdown drain allows connector work to continue.'
      }))
    }
    request.signal.addEventListener('abort', abortListener, { once: true })
  }

  return {
    signal: controller.signal,
    guardPromise,
    cleanup: () => {
      settled = true
      if (timeout) clearTimeout(timeout)
      if (abortListener) request.signal?.removeEventListener('abort', abortListener)
    }
  }
}

export const createTimeoutEnforcedCatalogFetcher = (
  fetcher: CatalogProductFetcher
): CatalogProductFetcher => async (request) => {
  const startedAt = Date.now()

  if (request.signal?.aborted) {
    return catalogFetchFailure({
      request,
      startedAt,
      status: 'error',
      code: 'connector_catalog_fetch_aborted',
      text: 'A connector-backed catalog source fetch was canceled before it started.',
      nextAction: 'Retry only after the calling request or shutdown drain allows connector work to continue.'
    })
  }

  const guard = createCatalogFetchGuard(request, startedAt)
  const fetchPromise = fetcher({
    ...request,
    signal: guard.signal
  })
  fetchPromise.catch(() => undefined)

  try {
    return await Promise.race([
      fetchPromise,
      guard.guardPromise
    ])
  } catch {
    return catalogFetchFailure({
      request,
      startedAt,
      status: 'error',
      code: 'connector_catalog_fetch_failed',
      text: 'A connector-backed catalog source adapter failed before returning validated product facts.',
      nextAction: 'Inspect the source adapter and keep the result unavailable until product facts validate.'
    })
  } finally {
    guard.cleanup()
  }
}

export const createTimeoutEnforcedCatalogProductDetailFetcher = (
  fetcher: CatalogProductDetailFetcher
): CatalogProductDetailFetcher => async (request) => {
  const startedAt = Date.now()

  if (request.signal?.aborted) {
    return catalogProductDetailFetchFailure({
      request,
      startedAt,
      status: 'error',
      code: 'catalog_product_detail_fetch_aborted',
      text: 'A catalog product detail fetch was canceled before it started.',
      nextAction: 'Retry only after the calling request or shutdown drain allows connector work to continue.'
    })
  }

  const guard = createCatalogProductDetailFetchGuard(request, startedAt)
  const fetchPromise = fetcher({
    ...request,
    signal: guard.signal
  })
  fetchPromise.catch(() => undefined)

  try {
    return await Promise.race([
      fetchPromise,
      guard.guardPromise
    ])
  } catch {
    return catalogProductDetailFetchFailure({
      request,
      startedAt,
      status: 'error',
      code: 'catalog_product_detail_fetch_failed',
      text: 'A catalog product detail source failed before returning validated product facts.',
      nextAction: 'Inspect the source adapter and keep product detail unavailable until facts validate.'
    })
  } finally {
    guard.cleanup()
  }
}

export const createTimeoutEnforcedCatalogCartPrepareFetcher = (
  fetcher: CatalogCartPrepareFetcher
): CatalogCartPrepareFetcher => async (request) => {
  const startedAt = Date.now()

  if (request.signal?.aborted) {
    return catalogCartPrepareFetchFailure({
      request,
      startedAt,
      status: 'error',
      code: 'catalog_cart_prepare_aborted',
      text: 'A cart prepare request was canceled before it started.',
      nextAction: 'Retry only after the calling request or shutdown drain allows connector work to continue.'
    })
  }

  const guard = createCatalogCartPrepareFetchGuard(request, startedAt)
  const fetchPromise = fetcher({
    ...request,
    signal: guard.signal
  })
  fetchPromise.catch(() => undefined)

  try {
    return await Promise.race([
      fetchPromise,
      guard.guardPromise
    ])
  } catch {
    return catalogCartPrepareFetchFailure({
      request,
      startedAt,
      status: 'error',
      code: 'catalog_cart_prepare_failed',
      text: 'A cart source failed before returning validated cart facts.',
      nextAction: 'Inspect the source adapter and keep cart preparation unavailable until cart facts validate.'
    })
  } finally {
    guard.cleanup()
  }
}

export const approvedCatalogSourcesForPolicy = ({
  records,
  allowedBusinessIds,
  now = new Date()
}: {
  records: TargetBusinessRecord[]
  allowedBusinessIds: string[]
  now?: Date
}): ApprovedCatalogSource[] => {
  const allowed = new Set(allowedBusinessIds)

  return catalogVisibleRecords(records, now)
    .filter((record) => allowed.has(record.businessId))
    .map((record) => ({
      businessId: record.businessId,
      domain: record.domain,
      displayName: record.displayName,
      sourceType: record.sourceType,
      ...(record.profileUrl ? { profileUrl: record.profileUrl } : {}),
      ...(record.profileHash ? { profileHash: record.profileHash } : {})
    }))
}

export const approvedCartPrepareSourcesForPolicy = ({
  records,
  allowedBusinessIds,
  now = new Date()
}: {
  records: TargetBusinessRecord[]
  allowedBusinessIds: string[]
  now?: Date
}): ApprovedCatalogSource[] => {
  const allowed = new Set(allowedBusinessIds)

  return cartPrepareVisibleRecords(records, now)
    .filter((record) => allowed.has(record.businessId))
    .map((record) => ({
      businessId: record.businessId,
      domain: record.domain,
      displayName: record.displayName,
      sourceType: record.sourceType,
      ...(record.profileUrl ? { profileUrl: record.profileUrl } : {}),
      ...(record.profileHash ? { profileHash: record.profileHash } : {})
    }))
}

const normalizedDomain = (value: string) => {
  try {
    const url = value.includes('://') ? new URL(value) : new URL(`https://${value}`)
    return url.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return value.toLowerCase().replace(/^www\./, '')
  }
}

const validAuthorityHost = (authority: string) => {
  try {
    const url = authority.includes('://') ? new URL(authority) : new URL(`https://${authority}`)
    if (url.username || url.password) return undefined
    if (url.protocol !== 'https:') return undefined
    if (url.port && url.port !== '443') return undefined
    return normalizedDomain(url.hostname)
  } catch {
    return undefined
  }
}

const urlMatchesAuthority = (value: string, authorities: string[]) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    if (url.port && url.port !== '443') return false
    const normalizedAuthorities = authorities.flatMap((authority) => validAuthorityHost(authority) ?? [])
    return normalizedAuthorities.includes(normalizedDomain(url.hostname))
  } catch {
    return false
  }
}

const preparedCartItemMultiset = (
  items: readonly { productId: string; variantId?: string; quantity: number }[]
) => {
  const quantities = new Map<string, number>()
  for (const item of items) {
    const key = `${item.productId}\u0000${item.variantId ?? ''}`
    quantities.set(key, (quantities.get(key) ?? 0) + item.quantity)
  }

  return quantities
}

const cartItemsMatchRequest = (
  requestItems: CatalogCartPrepareRequest['items'] | undefined,
  cartItems: CatalogPreparedCart['items']
) => {
  if (!requestItems) return true

  const requested = preparedCartItemMultiset(requestItems)
  const returned = preparedCartItemMultiset(cartItems)
  if (requested.size !== returned.size) return false

  for (const [key, quantity] of requested.entries()) {
    if (returned.get(key) !== quantity) return false
  }

  return true
}

export const validateCatalogProductsForSource = ({
  source,
  products
}: {
  source: CatalogSource
  products: unknown[]
}): CatalogProductSearchInput[] =>
  products.map((product, index) => {
    if (!isCatalogProductSearchInput(product)) {
      throw new CatalogProductValidationError(
        'invalid_catalog_product',
        `Invalid connector-backed catalog product at index ${index}: ${catalogProductSearchInputErrorSummary(product)}`
      )
    }

    if (product.businessId !== source.businessId || product.sourceLabel.sourceId !== source.businessId) {
      throw new CatalogProductValidationError(
        'product_source_mismatch',
        `Connector-backed catalog product ${product.productId} does not belong to source ${source.businessId}.`
      )
    }

    return product
  })

export const validateCatalogProductDetailForSource = ({
  source,
  product
}: {
  source: CatalogSource
  product: unknown
}): CatalogProductDetail => {
  if (!isCatalogProductDetail(product)) {
    throw new CatalogProductDetailValidationError(
      'invalid_catalog_product_detail',
      `Invalid catalog product detail: ${catalogProductDetailErrorSummary(product)}`
    )
  }

  if (product.businessId !== source.businessId || product.sourceLabel.sourceId !== source.businessId) {
    throw new CatalogProductDetailValidationError(
      'product_source_mismatch',
      `Catalog product detail ${product.productId} does not belong to source ${source.businessId}.`
    )
  }

  return product
}

export const validateCatalogPreparedCartForSource = ({
  source,
  cart,
  requestItems
}: {
  source: CatalogSource
  cart: unknown
  requestItems?: CatalogCartPrepareRequest['items']
}): CatalogPreparedCart => {
  if (!isCatalogPreparedCart(cart)) {
    throw new CatalogPreparedCartValidationError(
      'invalid_catalog_cart',
      `Invalid prepared cart: ${catalogPreparedCartErrorSummary(cart)}`
    )
  }

  if (cart.businessId !== source.businessId || cart.sourceLabel.sourceId !== source.businessId) {
    throw new CatalogPreparedCartValidationError(
      'cart_source_mismatch',
      `Prepared cart ${cart.cartId} does not belong to source ${source.businessId}.`
    )
  }

  if (!cartItemsMatchRequest(requestItems, cart.items)) {
    throw new CatalogPreparedCartValidationError(
      'invalid_catalog_cart',
      `Prepared cart ${cart.cartId} does not preserve the exact requested product, variant, and quantity multiset.`
    )
  }

  if (cart.handoff?.url) {
    const authorities = source.allowedHandoffAuthorities ?? []
    if (!urlMatchesAuthority(cart.handoff.url, authorities)) {
      throw new CatalogPreparedCartValidationError(
        'cart_handoff_authority_mismatch',
        `Prepared cart ${cart.cartId} handoff URL does not match source ${source.businessId}.`
      )
    }
  }

  return cart
}

export const createUnavailableCatalogFetcher = (
  code = 'connector_catalog_fetcher_not_configured'
): CatalogProductFetcher => async ({ source, now }) => {
  const fetchedAt = now ?? new Date()

  return {
    sourceId: source.businessId,
    sourceName: source.displayName,
    status: 'unavailable',
    products: [],
    messages: [
      {
        severity: 'info',
        code,
        text: 'No connector-backed catalog fetcher is configured for this source yet.',
        nextAction: 'Connect a UCP endpoint or official catalog adapter before enabling live products.'
      }
    ],
    fetchedAt: fetchedAt.toISOString(),
    latencyMs: 0
  }
}

export const createUnavailableCatalogProductDetailFetcher = (
  code = 'catalog_product_detail_fetcher_not_configured'
): CatalogProductDetailFetcher => async ({ source, now }) => {
  const fetchedAt = now ?? new Date()

  return {
    sourceId: source.businessId,
    sourceName: source.displayName,
    status: 'unavailable',
    messages: [
      {
        severity: 'info',
        code,
        text: 'No catalog product detail fetcher is configured for this source yet.',
        nextAction: 'Connect an official UCP or public connector detail adapter before enabling product detail.'
      }
    ],
    fetchedAt: fetchedAt.toISOString(),
    latencyMs: 0
  }
}

export const createUnavailableCatalogCartPrepareFetcher = (
  code = 'catalog_cart_prepare_fetcher_not_configured'
): CatalogCartPrepareFetcher => async ({ source, now }) => {
  const fetchedAt = now ?? new Date()

  return {
    sourceId: source.businessId,
    sourceName: source.displayName,
    status: 'unavailable',
    messages: [
      {
        severity: 'info',
        code,
        text: 'No authoritative cart adapter is configured for this source yet.',
        nextAction: 'Connect a UCP cart-capable adapter before enabling cart preparation.'
      }
    ],
    fetchedAt: fetchedAt.toISOString(),
    latencyMs: 0
  }
}
