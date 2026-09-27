import {
  UCP_STABLE_VERSION,
  type UcpCapability,
  type UcpPlatformProfile
} from '@arro/contracts'
import { createPublicKey } from 'node:crypto'
import type { UcpEs256PublicJwk } from '@arro/ucp-client'

const ucpVersion = UCP_STABLE_VERSION
const ucpSpecBaseUrl = `https://ucp.dev/${ucpVersion}`
const ucpShoppingSchemaBaseUrl = `${ucpSpecBaseUrl}/schemas/shopping`
const ucpCommonSchemaBaseUrl = `${ucpSpecBaseUrl}/schemas/common`
const shopifyUcpSchemaBaseUrl = `https://shopify.dev/ucp/schemas/${ucpVersion}`

export const UCP_AP2_MANDATE_CAPABILITY = 'dev.ucp.common.payment.ap2_mandate'

const supportedCapabilities = [
  'dev.ucp.shopping.catalog.search',
  'dev.ucp.shopping.catalog.lookup',
  'dev.ucp.shopping.cart',
  'dev.ucp.shopping.checkout',
  'dev.ucp.shopping.fulfillment',
  'dev.ucp.shopping.order',
  UCP_AP2_MANDATE_CAPABILITY,
  'dev.shopify.catalog',
  'dev.shopify.catalog.global'
] as const

export type PlatformRuntimeCapabilityOptions = {
  catalog?: boolean
  cart?: boolean
  checkout?: boolean
  fulfillment?: boolean
  order?: boolean
  shopifyCatalog?: boolean
  ap2Mandate?: boolean
  signingKeys?: UcpEs256PublicJwk[]
  paymentHandlers?: UcpPlatformProfile['ucp']['payment_handlers']
  transports?: Array<'mcp' | 'rest' | 'embedded'>
}

type CapabilityDeclaration = {
  version: string
  spec: string
  schema: string
  extends?: UcpCapability | UcpCapability[]
  config?: Record<string, unknown>
}
type CapabilityMap = NonNullable<UcpPlatformProfile['ucp']['capabilities']>

export const signingKeySetStartsWithExactKey = (
  keys: unknown,
  expectedActiveKey: Record<string, unknown>
) => {
  if (!Array.isArray(keys) || keys.length === 0) return false
  const firstKey = keys[0]
  if (!firstKey || typeof firstKey !== 'object' || Array.isArray(firstKey)) return false

  const candidate = firstKey as Record<string, unknown>
  const expectedFields = Object.keys(expectedActiveKey)
  return Object.keys(candidate).length === expectedFields.length &&
    expectedFields.every((field) => candidate[field] === expectedActiveKey[field])
}

const capability = (declaration: Omit<CapabilityDeclaration, 'version'>) => ([{
  version: ucpVersion,
  ...declaration
}])

const defaultRuntimeCapabilities: Required<Omit<PlatformRuntimeCapabilityOptions, 'paymentHandlers' | 'transports' | 'signingKeys'>> & {
  transports: Array<'mcp' | 'rest' | 'embedded'>
} = {
  catalog: true,
  cart: true,
  checkout: true,
  fulfillment: true,
  order: true,
  shopifyCatalog: true,
  ap2Mandate: false,
  transports: ['mcp', 'rest']
}

const validatedSigningKeys = (keys: UcpEs256PublicJwk[] | undefined) => {
  if (!keys?.length) return []
  const seenKids = new Set<string>()
  return keys.map((key, index): UcpEs256PublicJwk => {
    if (
      !key || typeof key !== 'object' ||
      key.kty !== 'EC' || key.crv !== 'P-256' || key.alg !== 'ES256' || key.use !== 'sig' ||
      typeof key.kid !== 'string' || key.kid.length === 0 || !/^[\x20-\x7e]+$/.test(key.kid) ||
      typeof key.x !== 'string' || typeof key.y !== 'string' ||
      Buffer.from(key.x, 'base64url').byteLength !== 32 ||
      Buffer.from(key.y, 'base64url').byteLength !== 32 ||
      Buffer.from(key.x, 'base64url').toString('base64url') !== key.x ||
      Buffer.from(key.y, 'base64url').toString('base64url') !== key.y ||
      ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some((member) => member in key)
    ) {
      throw new TypeError(`signingKeys[${index}] must be a public EC P-256 ES256 signature JWK.`)
    }
    if (seenKids.has(key.kid)) throw new TypeError(`signingKeys contains duplicate kid ${key.kid}.`)
    seenKids.add(key.kid)
    const sanitized = {
      kid: key.kid,
      kty: 'EC',
      crv: 'P-256',
      x: key.x,
      y: key.y,
      use: 'sig',
      alg: 'ES256'
    } as const
    try {
      createPublicKey({ key: sanitized, format: 'jwk' })
    } catch {
      throw new TypeError(`signingKeys[${index}] is not a valid public EC P-256 key.`)
    }
    return sanitized
  })
}

export const buildPlatformProfile = (
  options: PlatformRuntimeCapabilityOptions = {}
): UcpPlatformProfile => {
  const runtime = {
    ...defaultRuntimeCapabilities,
    ...options,
    transports: options.transports ?? defaultRuntimeCapabilities.transports
  }
  // Keep this locally open so v2026-08-25 common capabilities can be emitted
  // even while callers consume the shared, generated platform-profile type.
  const capabilities: Record<string, CapabilityDeclaration[]> = {}
  const signingKeys = validatedSigningKeys(options.signingKeys)

  if (runtime.checkout) {
    capabilities['dev.ucp.shopping.checkout'] = capability({
      spec: `${ucpSpecBaseUrl}/specification/shopping/checkout`,
      schema: `${ucpShoppingSchemaBaseUrl}/checkout.json`
    })
  }
  if (runtime.checkout && runtime.fulfillment) {
    capabilities['dev.ucp.shopping.fulfillment'] = capability({
      spec: `${ucpSpecBaseUrl}/specification/shopping/extensions/fulfillment`,
      schema: `${ucpShoppingSchemaBaseUrl}/fulfillment.json`,
      extends: 'dev.ucp.shopping.checkout',
      config: { supports_multi_group: true }
    })
  }
  if (runtime.ap2Mandate && runtime.checkout) {
    capabilities[UCP_AP2_MANDATE_CAPABILITY] = capability({
      spec: `${ucpSpecBaseUrl}/specification/payment/extensions/ap2-mandates`,
      schema: `${ucpCommonSchemaBaseUrl}/payment_ap2_mandate.json`,
      extends: 'dev.ucp.shopping.checkout',
      config: {
        vp_formats_supported: {
          'dc+sd-jwt': {}
        }
      }
    })
  }
  if (runtime.cart) {
    capabilities['dev.ucp.shopping.cart'] = capability({
      spec: `${ucpSpecBaseUrl}/specification/shopping/cart`,
      schema: `${ucpShoppingSchemaBaseUrl}/cart.json`
    })
  }
  if (runtime.order) {
    capabilities['dev.ucp.shopping.order'] = capability({
      spec: `${ucpSpecBaseUrl}/specification/shopping/order`,
      schema: `${ucpShoppingSchemaBaseUrl}/order.json`
    })
  }
  if (runtime.catalog) {
    capabilities['dev.ucp.shopping.catalog.search'] = capability({
      spec: `${ucpSpecBaseUrl}/specification/shopping/catalog/search`,
      schema: `${ucpShoppingSchemaBaseUrl}/catalog_search.json`
    })
    capabilities['dev.ucp.shopping.catalog.lookup'] = capability({
      spec: `${ucpSpecBaseUrl}/specification/shopping/catalog/lookup`,
      schema: `${ucpShoppingSchemaBaseUrl}/catalog_lookup.json`
    })
  }
  if (runtime.shopifyCatalog && runtime.catalog) {
    capabilities['dev.shopify.catalog'] = capability({
      spec: 'https://shopify.dev/docs/agents/catalog/storefront-catalog',
      schema: `${shopifyUcpSchemaBaseUrl}/shopify_catalog.json`,
      extends: ['dev.ucp.shopping.catalog.lookup', 'dev.ucp.shopping.catalog.search']
    })
    capabilities['dev.shopify.catalog.global'] = capability({
      spec: 'https://shopify.dev/docs/agents/catalog/global-catalog',
      schema: `${shopifyUcpSchemaBaseUrl}/shopify_catalog_global.json`,
      extends: ['dev.ucp.shopping.catalog.lookup', 'dev.ucp.shopping.catalog.search']
    })
  }

  return {
    ucp: {
      version: ucpVersion,
      services: {
        'dev.ucp.shopping': runtime.transports.map((transport) => (
          {
            version: ucpVersion,
            spec: `${ucpSpecBaseUrl}/specification/overview`,
            transport,
            schema: transport === 'mcp'
              ? `${ucpSpecBaseUrl}/services/shopping/mcp.openrpc.json`
              : transport === 'rest'
                ? `${ucpSpecBaseUrl}/services/shopping/rest.openapi.json`
                : `${ucpSpecBaseUrl}/services/shopping/embedded.openrpc.json`
          }
        ))
      },
      capabilities: capabilities as unknown as CapabilityMap,
      payment_handlers: options.paymentHandlers ?? {}
    },
    ...(signingKeys.length
      ? {
          keys: signingKeys.map((key) => ({ ...key }))
        }
      : {})
  }
}

export const platformProfileCapabilityNames = supportedCapabilities
export const platformProfileVersion = ucpVersion
