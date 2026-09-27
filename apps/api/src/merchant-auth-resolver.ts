import type { UcpAuthConfig, UcpNegotiation } from '@arro/ucp-client'
import type { UcpProfile } from '@arro/contracts'

export type MerchantAuthOperation =
  | 'create_cart'
  | 'get_cart'
  | 'update_cart'
  | 'cancel_cart'
  | 'create_checkout'
  | 'get_checkout'
  | 'update_checkout'
  | 'complete_checkout'
  | 'cancel_checkout'
  | 'get_order'

export type MerchantAuthResolveInput = {
  merchantOrigin: string
  merchantProfileUrl: string
  businessProfile: UcpProfile
  negotiation: UcpNegotiation
  operation: MerchantAuthOperation
}

export interface MerchantAuthResolver {
  resolve(input: MerchantAuthResolveInput): Promise<UcpAuthConfig | undefined>
}

export type MerchantAuthConfigByOrigin = Record<string, UcpAuthConfig>

export type MerchantAuthResolverRuntimeOptions = {
  fetch?: typeof fetch
  nowMs?: () => number
  tokenTimeoutMs?: number
}

const localhostNames = new Set(['localhost', '127.0.0.1', '::1'])

const cleanString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const parseOrigin = (value: string) => {
  const url = new URL(value)
  if (url.username || url.password) {
    throw new Error('merchant_auth_origin_must_not_include_credentials')
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localhostNames.has(url.hostname))) {
    throw new Error('merchant_auth_origin_must_be_https')
  }
  return url.origin
}

const assertHeaderSafe = (value: string, field: string) => {
  if (/[\r\n]/.test(value)) {
    throw new Error(`merchant_auth_${field}_contains_control_characters`)
  }
}

export const validateMerchantAuthConfig = (value: unknown): UcpAuthConfig => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('merchant_auth_config_invalid')
  }

  const record = value as Record<string, unknown>
  const type = cleanString(record.type)
  if (type === 'none') return { type: 'none' }

  if (type === 'bearer') {
    const token = cleanString(record.token)
    if (!token) throw new Error('merchant_auth_bearer_token_required')
    assertHeaderSafe(token, 'bearer_token')
    return { type, token }
  }

  if (type === 'api_key') {
    const header = cleanString(record.header)
    const authValue = cleanString(record.value)
    if (!header || !authValue) throw new Error('merchant_auth_api_key_required')
    assertHeaderSafe(header, 'api_key_header')
    assertHeaderSafe(authValue, 'api_key_value')
    if (!/^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+$/.test(header)) {
      throw new Error('merchant_auth_api_key_header_invalid')
    }
    return { type, header, value: authValue }
  }

  if (type === 'basic') {
    const username = cleanString(record.username)
    const password = cleanString(record.password)
    if (!username || !password) throw new Error('merchant_auth_basic_credentials_required')
    assertHeaderSafe(username, 'basic_username')
    assertHeaderSafe(password, 'basic_password')
    return { type, username, password }
  }

  throw new Error('merchant_auth_type_unsupported')
}

export const createMerchantAuthResolver = (
  credentialsByOrigin: MerchantAuthConfigByOrigin = {}
): MerchantAuthResolver => {
  const normalized = new Map(
    Object.entries(credentialsByOrigin).map(([origin, auth]) => [
      parseOrigin(origin),
      validateMerchantAuthConfig(auth)
    ])
  )

  return {
    async resolve(input) {
      const origin = parseOrigin(input.merchantOrigin)
      return normalized.get(origin)
    }
  }
}

export const createMerchantAuthResolverFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
  {
    fetch: fetcher = fetch,
    nowMs = Date.now,
    tokenTimeoutMs = 10_000
  }: MerchantAuthResolverRuntimeOptions = {}
): MerchantAuthResolver => {
  const raw = env.UCP_MERCHANT_AUTH_JSON?.trim()
  let configured: MerchantAuthConfigByOrigin = {}
  if (raw) {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('UCP_MERCHANT_AUTH_JSON must be an object keyed by merchant origin.')
    }
    configured = parsed as MerchantAuthConfigByOrigin
  }
  const configuredResolver = createMerchantAuthResolver(configured)

  const shopifyClientId = cleanString(env.SHOPIFY_AGENT_CLIENT_ID)
  const shopifyClientSecret = cleanString(env.SHOPIFY_AGENT_CLIENT_SECRET)
  if (Boolean(shopifyClientId) !== Boolean(shopifyClientSecret)) {
    throw new Error('SHOPIFY_AGENT_CLIENT_ID and SHOPIFY_AGENT_CLIENT_SECRET must be configured together.')
  }

  let token: { value: string; refreshAtMs: number; expiresAtMs: number } | undefined
  let pending: Promise<string> | undefined
  const acquireShopifyToken = async () => {
    if (!shopifyClientId || !shopifyClientSecret) {
      throw new Error('shopify_agent_credentials_unavailable')
    }
    const response = await fetcher('https://api.shopify.com/auth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: shopifyClientId,
        client_secret: shopifyClientSecret,
        grant_type: 'client_credentials'
      }),
      signal: AbortSignal.timeout(tokenTimeoutMs)
    })
    if (!response.ok) throw new Error('shopify_agent_authentication_failed')
    const parsed = await response.json() as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('shopify_agent_authentication_response_invalid')
    }
    const body = parsed as Record<string, unknown>
    const value = cleanString(body.access_token)
    const expiresIn = Number(body.expires_in)
    if (!value || !Number.isSafeInteger(expiresIn) || expiresIn <= 0) {
      throw new Error('shopify_agent_authentication_response_invalid')
    }
    const issuedAtMs = nowMs()
    const lifetimeMs = expiresIn * 1_000
    token = {
      value,
      expiresAtMs: issuedAtMs + lifetimeMs,
      refreshAtMs: issuedAtMs + Math.max(lifetimeMs - Math.min(60_000, lifetimeMs / 10), 0)
    }
    return value
  }

  const shopifyToken = async () => {
    const currentTimeMs = nowMs()
    if (token && token.refreshAtMs > currentTimeMs) return token.value
    pending ??= acquireShopifyToken().finally(() => {
      pending = undefined
    })
    try {
      return await pending
    } catch (error) {
      // A still-valid token is safer than dropping a checkout during a brief
      // auth-service interruption. Never use it beyond the provider's expiry.
      if (token && token.expiresAtMs > nowMs()) return token.value
      throw error
    }
  }

  return {
    async resolve(input) {
      const explicit = await configuredResolver.resolve(input)
      if (explicit) return explicit
      if (input.negotiation.transport !== 'mcp') return undefined
      const endpoint = new URL(input.negotiation.endpoint)
      const hostname = endpoint.hostname.toLowerCase()
      if (hostname !== 'myshopify.com' && !hostname.endsWith('.myshopify.com')) return undefined

      // Shopify exposes a real production anonymous tier for catalog, cart,
      // and checkout construction. Selecting it explicitly prevents Arro's
      // generic UCP signer from being mixed into that request. When platform
      // credentials are configured, use the higher token tier for every
      // operation and let Shopify's granted scopes decide completion/order
      // authority.
      return shopifyClientId && shopifyClientSecret
        ? { type: 'bearer', token: await shopifyToken() }
        : { type: 'none' }
    }
  }
}
