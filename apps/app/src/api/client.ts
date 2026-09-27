import { Platform } from 'react-native'
import type {
  CatalogProductSummary,
  CompareResponse,
  ProductDetailResponse,
  SearchResponse
} from '../types/catalog'
import type {
  PurchasePaymentActionCreateRequest,
  PurchasePaymentActionResult,
  PurchasePaymentActionResultRequest,
  PurchasePaymentActionResponse,
  PurchaseReviewUpdateRequest,
  PurchaseResponse,
  ShopperSessionResponse,
  StripePaymentActionSession
} from '../types/purchase'
import { attributionPayload } from '../lib/affiliate'
import { majorToMinor } from '../lib/money'
import { deviceStorage } from '../lib/storage'
import {
  paymentClientCapabilities,
  type PaymentSurfaceMode
} from '../payments/capabilities'

const configuredApiBaseUrl = process.env.EXPO_PUBLIC_ARRO_API_URL?.trim()
const configuredInternalApiBaseUrl = process.env.ARRO_INTERNAL_API_URL?.trim()
const resolveApiBaseUrl = () => {
  if (!configuredApiBaseUrl) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('EXPO_PUBLIC_ARRO_API_URL is required for production web and native builds.')
    }
    return Platform.OS === 'web' ? 'http://localhost:3000' : ''
  }

  let url: URL
  try {
    url = new URL(configuredApiBaseUrl)
  } catch {
    throw new Error('EXPO_PUBLIC_ARRO_API_URL must be a valid absolute URL.')
  }
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('EXPO_PUBLIC_ARRO_API_URL must be an origin without credentials, a path, a query, or a fragment.')
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('EXPO_PUBLIC_ARRO_API_URL must use HTTPS in production.')
  }
  return url.origin
}

const API_BASE_URL = resolveApiBaseUrl()
const resolveInternalApiBaseUrl = () => {
  if (!configuredInternalApiBaseUrl) return undefined

  let url: URL
  try {
    url = new URL(configuredInternalApiBaseUrl)
  } catch {
    throw new Error('ARRO_INTERNAL_API_URL must be a valid absolute URL.')
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('ARRO_INTERNAL_API_URL must be an HTTP(S) origin without credentials, a path, a query, or a fragment.')
  }
  return url.origin
}

const INTERNAL_API_BASE_URL = resolveInternalApiBaseUrl()
const DEFAULT_CURRENCY = (process.env.EXPO_PUBLIC_ARRO_CURRENCY || 'USD').toUpperCase()
const CHANNEL = Platform.OS === 'web' ? 'web' : 'mobile'

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  signal?: AbortSignal
  headers?: Record<string, string>
}

export class ArroApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly retryAfterSeconds?: number) {
    super(message)
  }
}

const requireApiBaseUrl = () => {
  if (API_BASE_URL) return API_BASE_URL
  throw new ArroApiError(
    'EXPO_PUBLIC_ARRO_API_URL is required on native devices. Configure the API origin before starting the app.',
    0,
    'api_url_missing'
  )
}

const requestApiBaseUrl = () =>
  Platform.OS === 'web' && typeof window === 'undefined' && INTERNAL_API_BASE_URL
    ? INTERNAL_API_BASE_URL
    : requireApiBaseUrl()

/**
 * Expo only inlines EXPO_PUBLIC_* variables into browser/native bundles. This
 * unprefixed value exists solely in the Vercel SSR function and lets its catalog
 * fan-out avoid sharing a tiny public-client rate-limit bucket.
 */
const frontendServerHeaders = (): Record<string, string> => {
  if (Platform.OS !== 'web' || typeof window !== 'undefined') return {}
  const token = process.env.ARRO_FRONTEND_SERVER_TOKEN?.trim()
  return token ? { 'x-arro-frontend-server': token } : {}
}

const requestJson = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const method = options.method ?? (options.body === undefined ? 'GET' : 'POST')
  const response = await fetch(`${requestApiBaseUrl()}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...frontendServerHeaders(),
      ...options.headers
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    ...(options.signal ? { signal: options.signal } : {})
  })

  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) {
    const error = payload.error as { message?: string; code?: string; details?: { retryAfterSeconds?: number } } | undefined
    throw new ArroApiError(
      error?.message || `Arro API request failed (${response.status}).`,
      response.status,
      error?.code,
      error?.details?.retryAfterSeconds
    )
  }

  return payload as T
}

const postJson = <T>(path: string, body: unknown, signal?: AbortSignal) =>
  requestJson<T>(path, { method: 'POST', body, signal })

const shopperSessionStorageKey = 'arro.shopper-session.v1'
let shopperSession: ShopperSessionResponse | undefined
let shopperSessionRequest: Promise<ShopperSessionResponse> | undefined
let shopperSessionHydration: Promise<void> | undefined
let shopperSessionGeneration = 0

const shopperSessionRemainingMs = (session: ShopperSessionResponse | undefined) => {
  if (!session) return 0
  const expiresAt = new Date(session.expiresAt).getTime()
  return Boolean(session.token) && Number.isFinite(expiresAt) ? expiresAt - Date.now() : 0
}

const hasUsableShopperSession = (session: ShopperSessionResponse | undefined) => {
  // Rotate well before the 30-day server expiry while preserving the same
  // signed shopper identity. A dormant device still retains continuity for
  // the full server-side checkout-retention window.
  return shopperSessionRemainingMs(session) > 24 * 60 * 60 * 1000
}

const persistShopperSession = (session: ShopperSessionResponse | undefined) => {
  const operation = session
    ? deviceStorage.setItem(shopperSessionStorageKey, JSON.stringify(session))
    : deviceStorage.removeItem(shopperSessionStorageKey)
  void Promise.resolve(operation).catch(() => undefined)
}

/**
 * The checkout owner credential is device state, even for a guest. Hydration
 * is lazy so SSR never reads browser storage, and generation binding ensures a
 * slow storage read cannot overwrite a session adopted by a concurrent sign-in.
 */
const hydrateShopperSession = () => {
  if (shopperSessionHydration) return shopperSessionHydration
  if (Platform.OS === 'web' && typeof window === 'undefined') {
    shopperSessionHydration = Promise.resolve()
    return shopperSessionHydration
  }

  const generation = shopperSessionGeneration
  shopperSessionHydration = Promise.resolve(deviceStorage.getItem(shopperSessionStorageKey))
    .then((stored) => {
      if (!stored || generation !== shopperSessionGeneration) return
      try {
        const parsed = JSON.parse(stored) as ShopperSessionResponse
        if (shopperSessionRemainingMs(parsed) > 0) shopperSession = parsed
        else persistShopperSession(undefined)
      } catch {
        persistShopperSession(undefined)
      }
    })
    .catch(() => undefined)
  return shopperSessionHydration
}

/**
 * Signing in replaces the anonymous session with the account-bound one the API
 * just issued, so every later purchase call runs as that account rather than as
 * the device. Signing out drops it and the next call re-issues an anonymous one.
 */
export const adoptShopperSession = (session: ShopperSessionResponse | undefined) => {
  shopperSessionGeneration += 1
  shopperSession = session
  shopperSessionRequest = undefined
  persistShopperSession(session)
}

const getShopperSession = async () => {
  await hydrateShopperSession()
  if (hasUsableShopperSession(shopperSession)) return shopperSession!
  if (!shopperSessionRequest) {
    const currentToken = shopperSession?.token
    const generation = shopperSessionGeneration
    let request: Promise<ShopperSessionResponse>
    request = requestJson<ShopperSessionResponse>('/v1/shopper/session', {
      method: 'POST',
      body: {},
      ...(currentToken ? { headers: { 'x-arro-shopper-session': currentToken } } : {})
    }).then((session) => {
      if (generation === shopperSessionGeneration) {
        shopperSession = session
        persistShopperSession(session)
        return session
      }
      return hasUsableShopperSession(shopperSession) ? shopperSession! : session
    }).finally(() => {
      if (shopperSessionRequest === request) shopperSessionRequest = undefined
    })
    shopperSessionRequest = request
  }
  return shopperSessionRequest
}

const shopperRequest = async <T>(path: string, options: RequestOptions = {}) => {
  const session = await getShopperSession()
  try {
    return await requestJson<T>(path, {
      ...options,
      headers: {
        ...options.headers,
        'x-arro-shopper-session': session.token
      }
    })
  } catch (error) {
    if (!(error instanceof ArroApiError) || error.code !== 'invalid_shopper_session') throw error
    adoptShopperSession(undefined)
    const refreshed = await getShopperSession()
    return requestJson<T>(path, {
      ...options,
      headers: {
        ...options.headers,
        'x-arro-shopper-session': refreshed.token
      }
    })
  }
}

const catalogPostJson = <T>(path: string, body: unknown, signal?: AbortSignal) =>
  Platform.OS === 'web' && typeof window === 'undefined'
    ? postJson<T>(path, body, signal)
    : shopperRequest<T>(path, { method: 'POST', body, signal })

const createIdempotencyKey = (prefix: string) => {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
  return `${prefix}:${uuid}`
}

export const searchProducts = (
  query: string,
  options: {
    minPrice?: number
    maxPrice?: number
    priceCurrency?: string
    brands?: string[]
    sort?: 'relevance' | 'price_asc' | 'price_desc'
    cursor?: string
    /** Page size. Category rails ask for a handful; the grid asks for a page. */
    limit?: number
  },
  signal?: AbortSignal
) => {
  const intent: Record<string, unknown> = { sort: options.sort || 'relevance' }
  // Price bounds are source-side, so they must carry the currency the shopper is
  // actually looking at. Sending USD bounds against an AUD listing filters wrong.
  const currency = options.priceCurrency?.toUpperCase() || DEFAULT_CURRENCY
  if (options.brands?.length) intent.brands = options.brands
  if (typeof options.minPrice === 'number') {
    const amountMinor = majorToMinor(options.minPrice, currency)
    if (amountMinor !== undefined) intent.minPrice = { amountMinor, currency }
  }
  if (typeof options.maxPrice === 'number') {
    const amountMinor = majorToMinor(options.maxPrice, currency)
    if (amountMinor !== undefined) intent.maxPrice = { amountMinor, currency }
  }

  return catalogPostJson<SearchResponse>('/v1/catalog/search', {
    query,
    intent,
    context: { channel: CHANNEL, locale: 'en-US', currency: DEFAULT_CURRENCY },
    pagination: {
      limit: options.limit ?? 40,
      ...(options.cursor ? { cursor: options.cursor } : {})
    }
  }, signal)
}

/** `chosen: false` marks a value carried forward from the source's own defaults. */
export type ProductDetailSelection = { name: string; label: string; id?: string; chosen?: boolean }

export type ProductDetailQuery = Pick<CatalogProductSummary, 'businessId' | 'productId' | 'variantId'> & {
  selected?: ProductDetailSelection[]
  preferences?: string[]
}

const productDetailRequest = (
  product: ProductDetailQuery,
  withVariant: boolean,
  signal?: AbortSignal
) => catalogPostJson<ProductDetailResponse>('/v1/catalog/product', {
  businessId: product.businessId,
  productId: product.productId,
  ...(withVariant && product.variantId ? { variantId: product.variantId } : {}),
  ...(product.selected?.length ? { selected: product.selected } : {}),
  ...(product.preferences?.length ? { preferences: product.preferences } : {}),
  context: { channel: CHANNEL, locale: 'en-US', currency: DEFAULT_CURRENCY }
}, signal)

/**
 * Aggregated catalogs cluster one product across merchants, so the variant a
 * result carried is not always in the variant set the detail call answers with.
 * The source will not confirm that exact offer, so fall back to the product and
 * the offers it does confirm rather than showing the shopper nothing.
 */
export const getProductDetail = async (
  product: ProductDetailQuery,
  signal?: AbortSignal
): Promise<ProductDetailResponse & { variantUnconfirmed?: boolean }> => {
  const response = await productDetailRequest(product, true, signal)
  if (response.product || !product.variantId) return response

  const fallback = await productDetailRequest(product, false, signal)
  return fallback.product ? { ...fallback, variantUnconfirmed: true } : response
}

export const compareProducts = (products: CatalogProductSummary[], signal?: AbortSignal) =>
  catalogPostJson<CompareResponse>('/v1/product/compare', {
    products: products.map((product) => ({
      productId: product.productId,
      businessId: product.businessId,
      businessName: product.businessName,
      title: product.title,
      ...(product.brand ? { brand: product.brand } : {}),
      ...(product.description ? { description: product.description } : {}),
      categoryPath: product.categoryPath,
      ...(product.variantId ? { variantId: product.variantId } : {}),
      ...(product.price ? { price: product.price } : {}),
      availability: product.availability,
      condition: product.condition,
      ...(product.productUrl ? { productUrl: product.productUrl } : {}),
      ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
      ...(product.rating ? { rating: product.rating } : {}),
      ...(product.seller ? { seller: product.seller } : {}),
      ...(product.handoff ? { handoff: product.handoff } : {}),
      tags: [],
      sourceLabel: product.sourceLabel
    }))
  }, signal)

export type PurchaseOffer = Pick<
  CatalogProductSummary,
  'productId' | 'variantId' | 'title' | 'productUrl' | 'handoff' | 'seller' | 'businessName'
>

const hostnameOf = (value: string | undefined) => {
  if (!value) return undefined
  try {
    return new URL(value).hostname
  } catch {
    return undefined
  }
}

/** UCP's buyer block: contact details the shopper saved on this device. */
export type PurchaseBuyer = {
  email?: string
  first_name?: string
  last_name?: string
  phone_number?: string
}

export const preparePurchase = (offer: PurchaseOffer, buyer?: PurchaseBuyer) => {
  // A Shopify seller carries both an internal `*.myshopify.com` handle and the
  // storefront it actually trades on. Only the storefront serves the merchant's
  // UCP profile, so it is the identity checkout has to negotiate against; the
  // handle stays as the fallback and the seller travels with the offer so the
  // API can fall through its own merchant hints.
  const merchantDomain = hostnameOf(offer.seller?.url) ?? offer.seller?.domain
  const url = offer.handoff?.url || offer.productUrl || offer.seller?.url
  return shopperRequest<PurchaseResponse>('/v1/purchases/prepare', {
    method: 'POST',
    headers: { 'idempotency-key': createIdempotencyKey('prepare') },
    body: {
      ...(merchantDomain ? { merchantDomain } : {}),
      selectedOffer: {
        productId: offer.productId,
        ...(offer.variantId ? { variantId: offer.variantId } : {}),
        itemId: offer.variantId || offer.productId,
        title: offer.title,
        ...(url ? { url } : {}),
        ...(offer.seller ? { seller: offer.seller } : {}),
        quantity: 1
      },
      ...(buyer ? { buyer } : {}),
      ...(attributionPayload() ? { attribution: attributionPayload() } : {}),
      context: { channel: CHANNEL, locale: 'en-US', currency: DEFAULT_CURRENCY }
    }
  })
}

/**
 * One checkout, one merchant, many lines.
 *
 * The cart deliberately spans shops while a UCP checkout cannot: a merchant
 * Order is the only thing that completes a purchase, so a multi-shop cart
 * becomes one prepared checkout per shop. `checkout.line_items` is the contract
 * the purchase runtime already accepts for that; `selectedOffer` still travels
 * alongside it because merchant resolution reads its seller hints.
 */
export const prepareCartPurchase = (
  lines: Array<{ offer: PurchaseOffer; quantity: number; imageUrl?: string }>,
  buyer?: PurchaseBuyer
) => {
  const lead = lines[0]
  if (!lead) throw new ArroApiError('Checkout needs at least one item.', 0, 'ucp_invalid_request')
  const merchantDomain = hostnameOf(lead.offer.seller?.url) ?? lead.offer.seller?.domain
  const leadUrl = lead.offer.handoff?.url || lead.offer.productUrl || lead.offer.seller?.url

  return shopperRequest<PurchaseResponse>('/v1/purchases/prepare', {
    method: 'POST',
    headers: { 'idempotency-key': createIdempotencyKey('prepare') },
    body: {
      ...(merchantDomain ? { merchantDomain } : {}),
      selectedOffer: {
        productId: lead.offer.productId,
        ...(lead.offer.variantId ? { variantId: lead.offer.variantId } : {}),
        itemId: lead.offer.variantId || lead.offer.productId,
        title: lead.offer.title,
        ...(leadUrl ? { url: leadUrl } : {}),
        ...(lead.offer.seller ? { seller: lead.offer.seller } : {}),
        quantity: lead.quantity
      },
      checkout: {
        line_items: lines.map(({ offer, quantity, imageUrl }) => {
          const url = offer.handoff?.url || offer.productUrl
          return {
            item: {
              id: offer.variantId || offer.productId,
              title: offer.title,
              ...(url ? { url } : {}),
              ...(imageUrl ? { image_url: imageUrl } : {})
            },
            quantity
          }
        })
      },
      ...(buyer ? { buyer } : {}),
      ...(attributionPayload() ? { attribution: attributionPayload() } : {}),
      context: { channel: CHANNEL, locale: 'en-US', currency: DEFAULT_CURRENCY }
    }
  })
}

export const getPurchase = (purchaseId: string, signal?: AbortSignal) =>
  shopperRequest<PurchaseResponse>(`/v1/purchases/${encodeURIComponent(purchaseId)}`, { signal })

export type PurchaseReviewUpdate = Omit<
  PurchaseReviewUpdateRequest,
  'idempotencyKey'
>

/**
 * Updates only shopper-owned checkout review fields. The snapshot binds the
 * edit to the exact total and choices the shopper saw; a stale screen cannot
 * silently overwrite a newer merchant checkout.
 */
export const updatePurchaseReview = (
  purchaseId: string,
  review: PurchaseReviewUpdate
) => {
  const idempotencyKey = createIdempotencyKey('review')
  const body = {
    ...review,
    idempotencyKey
  } satisfies PurchaseReviewUpdateRequest

  return shopperRequest<PurchaseResponse>(
    `/v1/purchases/${encodeURIComponent(purchaseId)}/review`,
    {
      method: 'PATCH',
      headers: { 'idempotency-key': idempotencyKey },
      body
    }
  )
}

export type PurchasePaymentActionOptions = Omit<
  PurchasePaymentActionCreateRequest,
  'clientCapabilities' | 'idempotencyKey'
> & {
  /** Lets the UI explicitly request a fresh browser-capable fallback action. */
  surfaceMode?: PaymentSurfaceMode
}

export const createPurchasePaymentAction = (
  purchaseId: string,
  options: PurchasePaymentActionOptions = {}
) => {
  const { surfaceMode = 'native_preferred', ...request } = options
  return shopperRequest<PurchasePaymentActionResponse>(`/v1/purchases/${encodeURIComponent(purchaseId)}/payment-actions`, {
    method: 'POST',
    headers: { 'idempotency-key': createIdempotencyKey('payment') },
    body: {
      ...request,
      clientCapabilities: paymentClientCapabilities(surfaceMode)
    } satisfies PurchasePaymentActionCreateRequest
  })
}

export const submitPurchasePaymentActionResult = (
  signedActionToken: string,
  result: PurchasePaymentActionResult,
  idempotencyKey = createIdempotencyKey('payment-result')
) => {
  const body = { result, idempotencyKey } satisfies PurchasePaymentActionResultRequest
  return requestJson<PurchaseResponse>(
    `/v1/payment-actions/${encodeURIComponent(signedActionToken)}/result`,
    {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body
    }
  )
}

export const createPurchasePaymentActionSession = (signedActionToken: string) =>
  requestJson<StripePaymentActionSession>(
    `/v1/payment-actions/${encodeURIComponent(signedActionToken)}/session`,
    { method: 'POST' }
  )

export const confirmPurchase = (purchase: PurchaseResponse) =>
  shopperRequest<PurchaseResponse>(`/v1/purchases/${encodeURIComponent(purchase.purchaseId)}/confirm`, {
    method: 'POST',
    headers: { 'idempotency-key': createIdempotencyKey('confirm') },
    body: {
      approvalRef: createIdempotencyKey('shopper-approval'),
      ...(purchase.checkoutSnapshotHash ? { checkoutSnapshotHash: purchase.checkoutSnapshotHash } : {}),
      approvedAt: new Date().toISOString()
    }
  })

export const cancelPurchase = (purchaseId: string) =>
  shopperRequest<PurchaseResponse>(`/v1/purchases/${encodeURIComponent(purchaseId)}/cancel`, {
    method: 'POST',
    headers: { 'idempotency-key': createIdempotencyKey('cancel') },
    body: { reason: 'Canceled by shopper' }
  })

export type ShopperAccount = {
  accountId: string
  email: string
  displayName?: string
  createdAt: string
}

export type AccountSession = { account: ShopperAccount; session: ShopperSessionResponse }

const adopt = (response: AccountSession) => {
  adoptShopperSession(response.session)
  return response
}

export const registerAccount = async (input: { email: string; password: string }) =>
  adopt(await postJson<AccountSession>('/v1/shopper/account/register', input))

export const loginAccount = async (input: { email: string; password: string }) =>
  adopt(await postJson<AccountSession>('/v1/shopper/account/login', input))

export type AuthProviders = { password: boolean; google: boolean; apple: boolean }

/** What this deployment can actually offer. Never assume a provider is live. */
export const readAuthProviders = () =>
  requestJson<AuthProviders>('/v1/shopper/account/providers')

export const signInWithIdentity = async (provider: 'google' | 'apple', idToken: string) =>
  adopt(await postJson<AccountSession>('/v1/shopper/account/oauth', { provider, idToken }))

/** The account behind the current session, or undefined when signed out. */
export const readAccount = async (): Promise<ShopperAccount | undefined> => {
  await hydrateShopperSession()
  if (shopperSessionRemainingMs(shopperSession) <= 0) return undefined
  const session = await getShopperSession()
  try {
    const response = await requestJson<{ account: ShopperAccount }>('/v1/shopper/account', {
      headers: { 'x-arro-shopper-session': session.token }
    })
    return response.account
  } catch (error) {
    if (error instanceof ArroApiError && (error.status === 401 || error.status === 404)) return undefined
    throw error
  }
}

export const logoutAccount = async () => {
  await hydrateShopperSession()
  const token = shopperSession?.token
  adoptShopperSession(undefined)
  if (!token) return
  try {
    await requestJson('/v1/shopper/account/logout', {
      method: 'POST',
      body: {},
      headers: { 'x-arro-shopper-session': token }
    })
  } catch {
    // The token is already forgotten locally; a failed revocation call must not
    // leave someone looking signed in.
  }
}

export { API_BASE_URL }
