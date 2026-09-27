import { Type, type Static } from '@sinclair/typebox'
import {
  UcpPlatformCapabilityDeclarationSchema,
  UcpPlatformProfileSchema,
  UcpPlatformServiceDeclarationSchema,
  UcpReverseDomainNameSchema,
  UcpServiceTransportSchema
} from './ucp.ts'

export const UcpCapabilitySchema = Type.Union([
  Type.Literal('dev.ucp.shopping.catalog.search'),
  Type.Literal('dev.ucp.shopping.catalog.lookup'),
  Type.Literal('dev.ucp.shopping.cart'),
  Type.Literal('dev.ucp.shopping.checkout'),
  Type.Literal('dev.ucp.shopping.discount'),
  Type.Literal('dev.ucp.shopping.fulfillment'),
  Type.Literal('dev.ucp.shopping.order'),
  Type.Literal('dev.ucp.shopping.buyer_consent'),
  Type.Literal('dev.ucp.shopping.permalink'),
  Type.Literal('dev.ucp.common.identity_linking'),
  Type.Literal('dev.ucp.common.location.lookup'),
  Type.Literal('dev.ucp.common.location.search'),
  Type.Literal('dev.ucp.common.loyalty'),
  Type.Literal('dev.ucp.common.payment.ap2_mandate'),
  Type.Literal('dev.ucp.common.payment.authentication'),
  Type.Literal('dev.ucp.common.payment.split_payments'),
  Type.Literal('dev.ucp.common.payment.terms'),
  Type.Literal('dev.shopify.catalog'),
  Type.Literal('dev.shopify.catalog.global')
])

export const UcpTransportSchema = UcpServiceTransportSchema
export const UcpServiceSchema = UcpPlatformServiceDeclarationSchema
export const UcpCapabilityDeclarationSchema = UcpPlatformCapabilityDeclarationSchema
export const UcpCapabilityMapSchema = Type.Record(
  UcpReverseDomainNameSchema,
  Type.Array(UcpCapabilityDeclarationSchema)
)

export const ArroPlatformProfileSchema = UcpPlatformProfileSchema

export type UcpCapability = Static<typeof UcpCapabilitySchema>
export type ArroPlatformProfile = Static<typeof ArroPlatformProfileSchema>

export type UcpNamespaceAuthorityFailureCode =
  | 'schema_missing'
  | 'schema_url_invalid'
  | 'schema_url_not_https'
  | 'schema_url_has_credentials'
  | 'schema_url_host_invalid'
  | 'namespace_authority_mismatch'

export type UcpNamespaceAuthorityFailure = {
  namespace: string
  schema?: string
  code: UcpNamespaceAuthorityFailureCode
  message: string
}

export type UcpNamespaceAuthorityResult =
  | {
      ok: true
      namespace: string
      schema: string
      authorityPrefix: string
    }
  | {
      ok: false
      failure: UcpNamespaceAuthorityFailure
    }

export const reverseDnsAuthorityPrefixFromHostname = (hostname: string) =>
  hostname
    .toLowerCase()
    .split('.')
    .filter(Boolean)
    .reverse()
    .join('.')

const normalizedAuthorityHostname = (hostname: string) =>
  hostname.toLowerCase().replace(/\.$/, '')

const isIpLiteralHostname = (hostname: string) =>
  /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')

type StandardsUrlConstructor = new (input: string) => {
  protocol: string
  username: string
  password: string
  hostname: string
}

const standardsUrlConstructor = (globalThis as unknown as {
  URL: StandardsUrlConstructor
}).URL

const parseSchemaUrlAuthority = (schema: string) => {
  try {
    const url = new standardsUrlConstructor(schema)
    return {
      scheme: url.protocol.replace(/:$/, '').toLowerCase(),
      hasCredentials: Boolean(url.username || url.password),
      hostname: normalizedAuthorityHostname(url.hostname)
    }
  } catch {
    return undefined
  }
}

export const validateUcpNamespaceSchemaAuthority = (
  namespace: string,
  schema: string | undefined
): UcpNamespaceAuthorityResult => {
  if (!schema) {
    return {
      ok: false,
      failure: {
        namespace,
        code: 'schema_missing',
        message: `Namespace ${namespace} must declare an authority-bound schema URL.`
      }
    }
  }

  const parsed = parseSchemaUrlAuthority(schema)
  if (!parsed) {
    return {
      ok: false,
      failure: {
        namespace,
        schema,
        code: 'schema_url_invalid',
        message: `Namespace ${namespace} declares an invalid schema URL.`
      }
    }
  }

  if (parsed.hasCredentials) {
    return {
      ok: false,
      failure: {
        namespace,
        schema,
        code: 'schema_url_has_credentials',
        message: `Namespace ${namespace} schema URL must not include embedded credentials.`
      }
    }
  }

  if (!parsed.hostname) {
    return {
      ok: false,
      failure: {
        namespace,
        schema,
        code: 'schema_url_invalid',
        message: `Namespace ${namespace} declares an invalid schema URL.`
      }
    }
  }

  if (parsed.scheme !== 'https') {
    return {
      ok: false,
      failure: {
        namespace,
        schema,
        code: 'schema_url_not_https',
        message: `Namespace ${namespace} schema URL must use HTTPS.`
      }
    }
  }

  const labels = parsed.hostname.split('.').filter(Boolean)
  if (labels.length < 2 || isIpLiteralHostname(parsed.hostname)) {
    return {
      ok: false,
      failure: {
        namespace,
        schema,
        code: 'schema_url_host_invalid',
        message: `Namespace ${namespace} schema URL must use a multi-label domain name authority.`
      }
    }
  }

  const authorityPrefix = reverseDnsAuthorityPrefixFromHostname(parsed.hostname)
  if (namespace !== authorityPrefix && !namespace.startsWith(`${authorityPrefix}.`)) {
    return {
      ok: false,
      failure: {
        namespace,
        schema,
        code: 'namespace_authority_mismatch',
        message: `Namespace ${namespace} must be served from a schema host under ${authorityPrefix}.`
      }
    }
  }

  return {
    ok: true,
    namespace,
    schema,
    authorityPrefix
  }
}

export const collectUcpPlatformProfileAuthorityFailures = (
  profile: ArroPlatformProfile
): UcpNamespaceAuthorityFailure[] => {
  const failures: UcpNamespaceAuthorityFailure[] = []

  for (const [serviceNamespace, services] of Object.entries(profile.ucp.services) as Array<[string, Array<{ transport: string, schema?: string }>]>) {
    for (const service of services) {
      if (service.transport === 'a2a' && !service.schema) continue
      const result = validateUcpNamespaceSchemaAuthority(serviceNamespace, service.schema)
      if (result.ok === false) failures.push(result.failure)
    }
  }

  for (const [capabilityNamespace, declarations] of Object.entries(profile.ucp.capabilities ?? {}) as Array<[string, Array<{ schema?: string }>]>) {
    for (const declaration of declarations) {
      const result = validateUcpNamespaceSchemaAuthority(capabilityNamespace, declaration.schema)
      if (result.ok === false) failures.push(result.failure)
    }
  }

  for (const [handlerNamespace, declarations] of Object.entries(profile.ucp.payment_handlers) as Array<[string, Array<{ schema?: string }>]>) {
    for (const declaration of declarations) {
      const result = validateUcpNamespaceSchemaAuthority(handlerNamespace, declaration.schema)
      if (result.ok === false) failures.push(result.failure)
    }
  }

  return failures
}
