import { createHash, randomUUID } from 'node:crypto'
import {
  createUcpHttpMessageSigner,
  deriveUcpEs256PublicJwk
} from './http-message-signatures.ts'
export * from './http-message-signatures.ts'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  UCP_STABLE_VERSION,
  UcpCartCancelRequestSchema,
  UcpCartCreateRequestSchema,
  UcpCartOperationResponseSchema,
  UcpCartSchema,
  UcpCartUpdateRequestSchema,
  UcpCheckoutCancelRequestSchema,
  UcpCheckoutCompleteRequestSchema,
  UcpCheckoutCreateRequestSchema,
  UcpCheckoutOperationResponseSchema,
  UcpCheckoutSchema,
  UcpCheckoutUpdateRequestSchema,
  UcpBusinessProfileSchema,
  UcpErrorResponseSchema,
  UcpOrderSchema,
  UcpOrderWebhookEventSchema,
  UcpPlatformProfileSchema,
  isUcpIdempotencyKey,
  resolveUcpProfileSigningKeys,
  validateUcpNamespaceSchemaAuthority,
  type UcpCartCancelRequest,
  type UcpCart,
  type UcpCartCreateRequest,
  type UcpCartOperationResponse,
  type UcpCartUpdateRequest,
  type UcpBusinessProfile,
  type UcpCheckout,
  type UcpCheckoutCancelRequest,
  type UcpCheckoutCompleteRequest,
  type UcpCheckoutCreateRequest,
  type UcpCheckoutOperationResponse,
  type UcpCheckoutUpdateRequest,
  type UcpErrorResponse,
  type UcpOrder,
  type UcpOrderWebhookEvent,
  type UcpPaymentHandlerDeclaration,
  type UcpPlatformProfile,
  type UcpProtocolCapabilityDeclaration,
  type UcpProtocolServiceDeclaration,
  type UcpServiceTransport
} from '@arro/contracts'

export type UcpFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

/**
 * Arro intentionally implements one released UCP snapshot. Profiles for other
 * core releases are usable only as discovery indexes that point at this exact
 * leaf; they are never negotiated or merged into it.
 */
export const UCP_CLIENT_PROTOCOL_VERSION: '2026-08-25' = UCP_STABLE_VERSION

export type UcpAuthConfig =
  | { type: 'none' }
  | { type: 'bearer'; token: string }
  | { type: 'api_key'; header: string; value: string }
  | { type: 'basic'; username: string; password: string }

export type UcpClientOptions = {
  fetch?: UcpFetch
  platformProfileUrl: string
  platformProfile: UcpPlatformProfile
  timeoutMs?: number
  maxResponseBytes?: number
  allowHttpForLocalTesting?: boolean
  /** Dedicated P-256 private JWK matching the public keys in the platform profile. */
  signingPrivateJwk?: unknown
}

export type UcpNegotiation = {
  version: string
  transport: UcpServiceTransport
  serviceNamespace: string
  service: UcpProtocolServiceDeclaration
  endpoint: string
  capabilities: Record<string, UcpProtocolCapabilityDeclaration[]>
  paymentHandlers: Record<string, UcpPaymentHandlerDeclaration[]>
  businessProfile: UcpBusinessProfile
}

export type UcpOperationInput<TBody = unknown> = {
  negotiation: UcpNegotiation
  body?: TBody
  checkoutId?: string
  orderId?: string
  idempotencyKey?: string
  auth?: UcpAuthConfig
  signal?: AbortSignal
}

export type CreateCheckoutInput = UcpOperationInput<UcpCheckoutCreateRequest>
export type CreateCartInput = UcpOperationInput<UcpCartCreateRequest>
export type GetCartInput = UcpOperationInput
export type UpdateCartInput = UcpOperationInput<UcpCartUpdateRequest> & { cartId: string }
export type CancelCartInput = UcpOperationInput<UcpCartCancelRequest> & { cartId: string }
export type GetCheckoutInput = UcpOperationInput
export type UpdateCheckoutInput = UcpOperationInput<UcpCheckoutUpdateRequest> & { checkoutId: string }
export type CompleteCheckoutInput = UcpOperationInput<UcpCheckoutCompleteRequest> & { checkoutId: string }
export type CancelCheckoutInput = UcpOperationInput<UcpCheckoutCancelRequest> & { checkoutId: string }
export type GetOrderInput = UcpOperationInput & { orderId: string }

export interface UcpClient {
  discover(profileUrlOrMerchantOrigin: string, options?: { signal?: AbortSignal }): Promise<UcpBusinessProfile>
  negotiate(platformProfile: UcpPlatformProfile, businessProfile: UcpBusinessProfile): Promise<UcpNegotiation>
  createCart(input: CreateCartInput): Promise<UcpCartOperationResponse>
  getCart(input: GetCartInput & { cartId: string }): Promise<UcpCartOperationResponse>
  updateCart(input: UpdateCartInput): Promise<UcpCartOperationResponse>
  cancelCart(input: CancelCartInput): Promise<UcpCartOperationResponse>
  createCheckout(input: CreateCheckoutInput): Promise<UcpCheckoutOperationResponse>
  getCheckout(input: GetCheckoutInput & { checkoutId: string }): Promise<UcpCheckoutOperationResponse>
  updateCheckout(input: UpdateCheckoutInput): Promise<UcpCheckoutOperationResponse>
  completeCheckout(input: CompleteCheckoutInput): Promise<UcpCheckoutOperationResponse>
  cancelCheckout(input: CancelCheckoutInput): Promise<UcpCheckoutOperationResponse>
  getOrder(input: GetOrderInput): Promise<UcpOrder>
}

export type UcpProtocolErrorDetails = {
  code: string
  httpStatus?: number
  retryAfterSeconds?: number
  messages?: UcpErrorResponse['messages']
  continueUrl?: string
}

export class UcpProtocolError extends Error {
  readonly details: UcpProtocolErrorDetails

  constructor(message: string, details: UcpProtocolErrorDetails) {
    super(message)
    this.name = 'UcpProtocolError'
    this.details = details
  }
}

export type UcpPaymentHandlerSupport =
  | {
      supported: true
      handlerName: string
      identity: UcpPaymentHandlerIdentity
      declaration: UcpPaymentHandlerDeclaration
      executionMode: 'client' | 'relay' | 'merchant_hosted'
      actionOrigins?: string[]
      reason: string
    }
  | {
      supported: false
      handlerName: string
      identity?: UcpPaymentHandlerIdentity
      declaration: UcpPaymentHandlerDeclaration
      reason: string
    }

export type UcpPaymentHandlerIdentity = {
  handlerName: string
  handlerInstanceId: string
  version: string
  specification: string
  schema: string
}

export type UcpPaymentHandlerAdapter = {
  adapterKind: 'x402' | 'mpp' | 'processor_tokenizer' | 'google_pay'
  handlerName: string
  executionMode: 'client' | 'relay' | 'merchant_hosted'
  actionOrigins?: readonly string[]
  supports(declaration: UcpPaymentHandlerDeclaration): boolean
  acquireInstrument?: (input: {
    declaration: UcpPaymentHandlerDeclaration
    checkout: UcpCheckout
    signal?: AbortSignal
  }) => Promise<unknown>
}

export type ProcessorTokenizerPaymentHandlerAdapterOptions = {
  handlerName: string
  specificationUrl: string
  schemaUrl: string
  supportedVersions: readonly string[]
  environment: 'TEST' | 'PRODUCTION'
  platformId: string
  actionOrigins?: readonly string[]
  acquireInstrument?: UcpPaymentHandlerAdapter['acquireInstrument']
}

export type GooglePayPaymentHandlerAdapterOptions = {
  specificationUrl?: string
  schemaUrl?: string
  supportedVersions?: readonly string[]
  environment: 'TEST' | 'PRODUCTION'
  actionOrigins?: readonly string[]
  acquireInstrument?: UcpPaymentHandlerAdapter['acquireInstrument']
}

export type UcpPaymentHandlerRegistry = {
  adapters: UcpPaymentHandlerAdapter[]
  resolve(input: {
    businessProfile: UcpBusinessProfile
    negotiatedPaymentHandlers?: Record<string, UcpPaymentHandlerDeclaration[]>
    checkout?: UcpCheckout
    continueUrl?: string
  }): UcpPaymentHandlerSupport[]
}

const cartCreateValidator = TypeCompiler.Compile(UcpCartCreateRequestSchema)
const businessProfileValidator = TypeCompiler.Compile(UcpBusinessProfileSchema)
const platformProfileValidator = TypeCompiler.Compile(UcpPlatformProfileSchema)
const cartUpdateValidator = TypeCompiler.Compile(UcpCartUpdateRequestSchema)
const cartCancelValidator = TypeCompiler.Compile(UcpCartCancelRequestSchema)
const cartValidator = TypeCompiler.Compile(UcpCartSchema)
const cartOperationResponseValidator = TypeCompiler.Compile(UcpCartOperationResponseSchema)
const checkoutCreateValidator = TypeCompiler.Compile(UcpCheckoutCreateRequestSchema)
const checkoutUpdateValidator = TypeCompiler.Compile(UcpCheckoutUpdateRequestSchema)
const checkoutCompleteValidator = TypeCompiler.Compile(UcpCheckoutCompleteRequestSchema)
const checkoutCancelValidator = TypeCompiler.Compile(UcpCheckoutCancelRequestSchema)
const checkoutValidator = TypeCompiler.Compile(UcpCheckoutSchema)
const checkoutOperationResponseValidator = TypeCompiler.Compile(UcpCheckoutOperationResponseSchema)
const errorResponseValidator = TypeCompiler.Compile(UcpErrorResponseSchema)
const orderValidator = TypeCompiler.Compile(UcpOrderSchema)
const orderWebhookEventValidator = TypeCompiler.Compile(UcpOrderWebhookEventSchema)

const validators = {
  createCart: cartCreateValidator,
  updateCart: cartUpdateValidator,
  cancelCart: cartCancelValidator,
  create: checkoutCreateValidator,
  update: checkoutUpdateValidator,
  complete: checkoutCompleteValidator,
  cancel: checkoutCancelValidator
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isUcpCheckout = (value: unknown): value is UcpCheckout =>
  isRecord(value) && typeof value['id'] === 'string' && typeof value['status'] === 'string'

// A UCP Cart is identified by its id and line items. Response status lives in
// the `ucp` metadata object rather than on the Cart, so requiring a top-level
// `status` here rejected conforming merchant carts and turned a successful cart
// into an unattributable business error.
export const isUcpCart = (value: unknown): value is UcpCart =>
  isRecord(value) && typeof value['id'] === 'string' && Array.isArray(value['line_items'])

export const isUcpErrorResponse = (value: unknown): value is UcpErrorResponse =>
  errorResponseValidator.Check(value)

const firstValidationError = (errors: Iterable<{ path: string; message: string }>) => {
  for (const error of errors) {
    return `${error.path || '/'} ${error.message}`.trim()
  }
  return 'schema validation failed'
}

const assertValid = <T>(validator: { Check(value: unknown): boolean; Errors(value: unknown): Iterable<{ path: string; message: string }> }, value: unknown, code: string): T => {
  if (validator.Check(value)) return value as T

  throw new UcpProtocolError(`UCP ${code} validation failed`, {
    code,
    messages: [
      {
        type: 'error',
        code,
        content: firstValidationError(validator.Errors(value)),
        severity: 'unrecoverable'
      }
    ]
  })
}

const withTimeout = (signal: AbortSignal | undefined, timeoutMs: number) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('ucp_request_timeout')), timeoutMs)
  const abort = () => controller.abort(signal?.reason)

  signal?.addEventListener('abort', abort, { once: true })

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }
}

const retryAfterSeconds = (value: string | null) => {
  if (!value) return undefined
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric >= 0) return numeric
  const dateMs = Date.parse(value)
  if (!Number.isFinite(dateMs)) return undefined
  return Math.max(0, Math.ceil((dateMs - Date.now()) / 1000))
}

const normalizeProfileUrl = (
  profileUrlOrMerchantOrigin: string,
  allowHttpForLocalTesting: boolean,
  appendWellKnownPath: boolean
) => {
  const raw = profileUrlOrMerchantOrigin.trim()
  const url = raw.startsWith('http://') || raw.startsWith('https://')
    ? new URL(raw)
    : new URL(`https://${raw}`)

  if (url.protocol !== 'https:' && !(allowHttpForLocalTesting && url.hostname === 'localhost')) {
    throw new UcpProtocolError('UCP discovery requires HTTPS merchant profiles.', {
      code: 'ucp_profile_url_not_https'
    })
  }

  if (url.username || url.password) {
    throw new UcpProtocolError('UCP discovery profile URLs must not contain credentials.', {
      code: 'ucp_profile_url_has_credentials'
    })
  }

  if (appendWellKnownPath && (!url.pathname || url.pathname === '/')) {
    url.pathname = '/.well-known/ucp'
  }

  return url
}

type ProfileRole = 'platform' | 'business'
type CanonicalProfileForRole<TRole extends ProfileRole> = TRole extends 'platform'
  ? UcpPlatformProfile
  : UcpBusinessProfile

const protocolVersionPattern = /^\d{4}-\d{2}-\d{2}$/
const canonicalTransports = new Set<UcpServiceTransport>(['rest', 'mcp', 'a2a', 'embedded'])

const profileValidationFailure = (code: string, message: string): never => {
  throw new UcpProtocolError(message, {
    code,
    messages: [{
      type: 'error',
      code,
      content: message,
      severity: 'unrecoverable'
    }]
  })
}

const requireProfileRecord = (
  value: unknown,
  path: string,
  code: string
): Record<string, unknown> => {
  if (!isRecord(value)) return profileValidationFailure(code, `${path} must be an object.`)
  return value
}

const requireProfileString = (
  value: unknown,
  path: string,
  code: string
): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return profileValidationFailure(code, `${path} must be a non-empty string.`)
  }
  return value
}

const requireDatedVersion = (value: unknown, path: string, code: string) => {
  const version = requireProfileString(value, path, code)
  if (!protocolVersionPattern.test(version)) {
    profileValidationFailure(code, `${path} must be a released YYYY-MM-DD version.`)
  }
  return version
}

const requireHttpsUrl = (value: unknown, path: string, code: string) => {
  const raw = requireProfileString(value, path, code)
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid')
  } catch {
    profileValidationFailure(code, `${path} must be an absolute HTTPS URL without credentials.`)
  }
  return raw
}

const registryDeclarations = (
  registry: unknown,
  path: string,
  code: string
): Array<{ name: string; declaration: Record<string, unknown>; path: string }> => {
  const record = requireProfileRecord(registry, path, code)
  return Object.entries(record).flatMap(([name, declarations]) => {
    if (!Array.isArray(declarations)) {
      return profileValidationFailure(code, `${path}.${name} must be an array.`)
    }
    return declarations.map((declaration, index) => ({
      name,
      declaration: requireProfileRecord(declaration, `${path}.${name}[${index}]`, code),
      path: `${path}.${name}[${index}]`
    }))
  })
}

/**
 * UCP release entries that do not match the selected profile version are not
 * part of the active profile. The publication contract says to reject that
 * entry and continue with the remaining declarations; rejecting the entire
 * merchant profile would make one stale transport binding disable a valid,
 * current checkout transport.
 */
const compatibleCoreRegistry = <TDeclaration extends { version: string }>(
  registry: Record<string, TDeclaration[]> | undefined,
  version: string
) => registry
  ? Object.fromEntries(Object.entries(registry).flatMap(([name, declarations]) => {
      const compatible = name.startsWith('dev.ucp.')
        ? declarations.filter((declaration) => declaration.version === version)
        : declarations
      return compatible.length > 0 ? [[name, compatible]] : []
    })) as Record<string, TDeclaration[]>
  : undefined

const selectCompatibleCoreEntries = <TProfile extends UcpPlatformProfile | UcpBusinessProfile>(
  profile: TProfile,
  version: string
): TProfile => {
  // Platform and business declarations have different required fields, but
  // compatibility selection only depends on their shared version property.
  // Keep that small concern structural and preserve the concrete profile type
  // at the boundary.
  const services = profile.ucp.services as Record<string, Array<{ version: string }>>
  const capabilities = profile.ucp.capabilities as
    | Record<string, Array<{ version: string }>>
    | undefined

  return {
    ...profile,
    ucp: {
      ...profile.ucp,
      services: compatibleCoreRegistry(services, version)!,
      ...(capabilities
        ? { capabilities: compatibleCoreRegistry(capabilities, version) }
        : {})
    }
  } as TProfile
}

const assertCanonicalProfile = <TRole extends ProfileRole>(
  value: unknown,
  role: TRole,
  options: { leaf?: boolean } = {}
): CanonicalProfileForRole<TRole> => {
  const code = role === 'platform' ? 'ucp_platform_profile_invalid' : 'ucp_business_profile_invalid'
  const profile = requireProfileRecord(value, 'profile', code)
  const ucp = requireProfileRecord(profile.ucp, 'profile.ucp', code)
  const version = requireDatedVersion(ucp.version, 'profile.ucp.version', code)

  if (version !== UCP_CLIENT_PROTOCOL_VERSION) {
    profileValidationFailure(
      'ucp_version_incompatible',
      `Arro implements UCP ${UCP_CLIENT_PROTOCOL_VERSION}; selected profile declares ${version}.`
    )
  }
  if (options.leaf && Object.hasOwn(ucp, 'supported_versions')) {
    profileValidationFailure(
      'ucp_leaf_profile_invalid',
      'A supported_versions target must be a self-contained leaf and must not declare supported_versions.'
    )
  }

  const schemaValidated = role === 'platform'
    ? assertValid<UcpPlatformProfile>(platformProfileValidator, value, code)
    : assertValid<UcpBusinessProfile>(businessProfileValidator, value, code)
  const canonical = selectCompatibleCoreEntries(schemaValidated, version)

  const services = registryDeclarations(canonical.ucp.services, 'profile.ucp.services', code)
  const capabilities = canonical.ucp.capabilities === undefined
    ? []
    : registryDeclarations(canonical.ucp.capabilities, 'profile.ucp.capabilities', code)
  const paymentHandlers = registryDeclarations(
    canonical.ucp.payment_handlers,
    'profile.ucp.payment_handlers',
    code
  )

  for (const { name, declaration, path } of services) {
    requireDatedVersion(declaration.version, `${path}.version`, code)
    const transport = requireProfileString(declaration.transport, `${path}.transport`, code)
    if (!canonicalTransports.has(transport as UcpServiceTransport)) {
      profileValidationFailure(code, `${path}.transport is not a UCP 2026-08-25 transport.`)
    }

    if (role === 'platform') {
      requireHttpsUrl(declaration.spec, `${path}.spec`, code)
      if (transport !== 'a2a') requireHttpsUrl(declaration.schema, `${path}.schema`, code)
    } else if (transport !== 'embedded') {
      requireHttpsUrl(declaration.endpoint, `${path}.endpoint`, code)
    }
    if (declaration.spec !== undefined) requireHttpsUrl(declaration.spec, `${path}.spec`, code)
    if (declaration.schema !== undefined) requireHttpsUrl(declaration.schema, `${path}.schema`, code)

  }

  for (const { name, declaration, path } of capabilities) {
    requireDatedVersion(declaration.version, `${path}.version`, code)
    if (role === 'platform') requireHttpsUrl(declaration.spec, `${path}.spec`, code)
    requireHttpsUrl(declaration.schema, `${path}.schema`, code)
  }

  for (const { name, declaration, path } of paymentHandlers) {
    requireProfileString(declaration.id, `${path}.id`, code)
    requireDatedVersion(declaration.version, `${path}.version`, code)
    if (role === 'platform') {
      requireHttpsUrl(declaration.spec, `${path}.spec`, code)
      requireHttpsUrl(declaration.schema, `${path}.schema`, code)
    } else if (declaration.schema !== undefined) {
      requireHttpsUrl(declaration.schema, `${path}.schema`, code)
    }
    if (declaration.spec !== undefined) requireHttpsUrl(declaration.spec, `${path}.spec`, code)
  }

  const businessProfile = role === 'business'
    ? canonical as UcpBusinessProfile
    : undefined
  if (businessProfile?.ucp.supported_versions !== undefined) {
    const supportedVersions = requireProfileRecord(
      businessProfile.ucp.supported_versions,
      'profile.ucp.supported_versions',
      code
    )
    for (const [supportedVersion, leafUrl] of Object.entries(supportedVersions)) {
      requireDatedVersion(supportedVersion, 'profile.ucp.supported_versions key', code)
      requireHttpsUrl(leafUrl, `profile.ucp.supported_versions.${supportedVersion}`, code)
    }
  }

  if (canonical.keys !== undefined) {
    try {
      // Pass only the released canonical location. Legacy aliases are unknown
      // fields under the open profile schema and never become key authority.
      resolveUcpProfileSigningKeys({ keys: canonical.keys })
    } catch (error) {
      profileValidationFailure(
        code,
        `profile.keys is not a valid public JWK set: ${error instanceof Error ? error.message : 'invalid key set'}`
      )
    }
  }

  return canonical as CanonicalProfileForRole<TRole>
}

const serviceEndpoint = (service: UcpProtocolServiceDeclaration) => {
  return service.endpoint
}

const profileCapabilityDeclarations = (
  profile: UcpPlatformProfile | UcpBusinessProfile
): Record<string, UcpProtocolCapabilityDeclaration[]> =>
  profile.ucp.capabilities ?? {}

const highestSharedVersion = <T extends { version: string }>(
  platformDeclarations: readonly T[],
  businessDeclarations: readonly T[]
) => {
  const platformVersions = new Set(platformDeclarations.map((declaration) => declaration.version))
  return businessDeclarations
    .map((declaration) => declaration.version)
    .filter((version) => platformVersions.has(version))
    .sort()
    .at(-1)
}

const mergeCapabilityDeclaration = (
  platform: UcpProtocolCapabilityDeclaration,
  business: UcpProtocolCapabilityDeclaration
): UcpProtocolCapabilityDeclaration => ({
  ...business,
  ...(business.spec ? {} : platform.spec ? { spec: platform.spec } : {})
})

const hasValidAuthorityBinding = (namespace: string, schema: string | undefined) =>
  Boolean(schema && validateUcpNamespaceSchemaAuthority(namespace, schema).ok)

const versionSatisfies = (
  version: string,
  constraint: { min: string; max?: string | undefined }
) => version >= constraint.min && (!constraint.max || version <= constraint.max)

const requirementsSatisfied = (
  declaration: UcpProtocolCapabilityDeclaration,
  active: Record<string, UcpProtocolCapabilityDeclaration[]>
) => {
  const protocolConstraint = declaration.requires?.protocol
  if (protocolConstraint && !versionSatisfies(UCP_CLIENT_PROTOCOL_VERSION, protocolConstraint)) {
    return false
  }

  return Object.entries(declaration.requires?.capabilities ?? {}).every(([name, constraint]) => {
    const selected = active[name]?.[0]
    return Boolean(selected && versionSatisfies(selected.version, constraint))
  })
}

const capabilityIntersection = (
  platform: UcpPlatformProfile,
  business: UcpBusinessProfile
) => {
  const platformCapabilities = profileCapabilityDeclarations(platform)
  const businessCapabilities = profileCapabilityDeclarations(business)
  const active: Record<string, UcpProtocolCapabilityDeclaration[]> = {}

  for (const [name, businessDeclarations] of Object.entries(businessCapabilities)) {
    const platformDeclarations = platformCapabilities[name]
    if (!platformDeclarations) continue

    const selectedVersion = highestSharedVersion(platformDeclarations, businessDeclarations)
    if (!selectedVersion) continue
    const platformDeclaration = platformDeclarations.find((declaration) => declaration.version === selectedVersion)
    if (!platformDeclaration) continue

    const matched = businessDeclarations
      .filter((declaration) => declaration.version === selectedVersion)
      .map((declaration) => mergeCapabilityDeclaration(platformDeclaration, declaration))
      .filter((declaration) => hasValidAuthorityBinding(name, declaration.schema))
    if (matched.length > 0) active[name] = matched
  }

  let changed = true
  while (changed) {
    changed = false
    for (const [name, declarations] of Object.entries(active)) {
      const retained = declarations.filter((declaration) => {
        const extensionParents = typeof declaration.extends === 'string'
          ? [declaration.extends]
          : declaration.extends ?? []
        const hasActiveExtensionParent = extensionParents.length === 0 ||
          extensionParents.some((parent) => Boolean(active[parent]))
        return hasActiveExtensionParent && requirementsSatisfied(declaration, active)
      })
      if (retained.length === 0) {
        delete active[name]
        changed = true
      }
    }
  }

  return active
}

const mergePaymentHandlerDeclaration = (
  platform: UcpPaymentHandlerDeclaration,
  business: UcpPaymentHandlerDeclaration
): UcpPaymentHandlerDeclaration => ({
  ...business,
  ...(business.spec ? {} : platform.spec ? { spec: platform.spec } : {}),
  ...(business.schema ? {} : platform.schema ? { schema: platform.schema } : {})
})

const paymentHandlerIntersection = (
  platform: UcpPlatformProfile,
  business: UcpBusinessProfile
) => {
  const platformHandlers: Record<string, UcpPaymentHandlerDeclaration[]> = platform.ucp.payment_handlers ?? {}
  const businessHandlers: Record<string, UcpPaymentHandlerDeclaration[]> = business.ucp.payment_handlers ?? {}
  const active: Record<string, UcpPaymentHandlerDeclaration[]> = {}

  for (const [name, businessDeclarations] of Object.entries(businessHandlers)) {
    const platformDeclarations = platformHandlers[name]
    if (!platformDeclarations) continue

    const selectedVersion = highestSharedVersion(platformDeclarations, businessDeclarations)
    if (!selectedVersion) continue
    const platformDeclaration = platformDeclarations.find((declaration) => declaration.version === selectedVersion)
    if (!platformDeclaration) continue

    const matched = businessDeclarations
      .filter((declaration) => declaration.version === selectedVersion)
      .map((declaration) => mergePaymentHandlerDeclaration(platformDeclaration, declaration))
      .filter((declaration) => hasValidAuthorityBinding(name, declaration.schema))
    if (matched.length > 0) active[name] = matched
  }

  return active
}

const negotiatedServiceEntries = (platform: UcpPlatformProfile, business: UcpBusinessProfile) =>
  (Object.entries(business.ucp.services) as Array<[string, UcpProtocolServiceDeclaration[]]>).flatMap(([namespace, businessServices]) => {
    const platformServices = platform.ucp.services[namespace] ?? []
    return businessServices.flatMap((businessService) => {
      const platformService = platformServices.find((candidate) =>
        candidate.transport === businessService.transport &&
        candidate.version === businessService.version
      )
      if (!platformService) return []

      const service: UcpProtocolServiceDeclaration = {
        ...businessService,
        ...(businessService.spec ? {} : platformService.spec ? { spec: platformService.spec } : {}),
        ...(businessService.schema ? {} : platformService.schema ? { schema: platformService.schema } : {})
      }
      if ((service.transport === 'rest' || service.transport === 'mcp' || service.transport === 'embedded') &&
        !hasValidAuthorityBinding(namespace, service.schema)) {
        return []
      }
      return [{ namespace, service }]
    })
  })

const encodePathSegment = (value: string) => encodeURIComponent(value)

const mergeSignals = (signal: AbortSignal | undefined, timeoutMs: number) => withTimeout(signal, timeoutMs)

const stateChangingRestMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const assertStateChangingIdempotencyKey = (
  method: string,
  idempotencyKey: string | undefined
) => {
  if (!stateChangingRestMethods.has(method.toUpperCase())) return
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length === 0) {
    throw new UcpProtocolError(
      `UCP ${method} requests require a non-empty idempotency key.`,
      { code: 'ucp_idempotency_key_required' }
    )
  }
  if (!isUcpIdempotencyKey(idempotencyKey)) {
    throw new UcpProtocolError(
      `UCP ${method} idempotency keys must carry at least 128 bits of entropy and use 22-255 HTTP-safe characters.`,
      { code: 'ucp_idempotency_key_invalid' }
    )
  }
}

const authHeaders = (auth: UcpAuthConfig | undefined) => {
  if (!auth || auth.type === 'none') return {}
  if (auth.type === 'bearer') return { authorization: `Bearer ${auth.token}` }
  if (auth.type === 'api_key') return { [auth.header]: auth.value }

  return {
    authorization: `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`
  }
}

const headerValue = (value: string) => value.replace(/[\r\n"]/g, '')

const paymentHandlerIdentity = (
  handlerName: string,
  declaration: UcpPaymentHandlerDeclaration
): UcpPaymentHandlerIdentity | undefined => {
  const handlerInstanceId = typeof declaration.id === 'string' && declaration.id.trim()
    ? declaration.id.trim()
    : undefined
  const specification = typeof declaration.spec === 'string' && declaration.spec.trim()
    ? declaration.spec.trim()
    : undefined
  const schema = typeof declaration.schema === 'string' && declaration.schema.trim()
    ? declaration.schema.trim()
    : undefined
  if (!handlerInstanceId || !declaration.version || !specification || !schema) return undefined
  return {
    handlerName,
    handlerInstanceId,
    version: declaration.version,
    specification,
    schema
  }
}

export const createProcessorTokenizerPaymentHandlerAdapter = ({
  handlerName,
  specificationUrl,
  schemaUrl,
  supportedVersions,
  environment,
  platformId,
  actionOrigins,
  acquireInstrument
}: ProcessorTokenizerPaymentHandlerAdapterOptions): UcpPaymentHandlerAdapter => {
  if (supportedVersions.length === 0 || supportedVersions.some((version) => !protocolVersionPattern.test(version))) {
    throw new TypeError('Processor-tokenizer payment handlers require an explicit, non-empty list of dated handler versions.')
  }

  return {
    adapterKind: 'processor_tokenizer',
    handlerName,
    executionMode: 'client',
    ...(actionOrigins?.length ? { actionOrigins: [...actionOrigins] } : {}),
    supports(declaration) {
      const config = isRecord(declaration.config) ? declaration.config : {}
      const declarationEnvironment = typeof config.environment === 'string'
        ? config.environment.toUpperCase()
        : undefined
      const spec = typeof declaration.spec === 'string' ? declaration.spec : ''
      const schema = typeof declaration.schema === 'string' ? declaration.schema : ''
      return (
        Boolean(declaration.id) &&
        supportedVersions.includes(declaration.version) &&
        spec === specificationUrl &&
        schema === schemaUrl &&
        (!declarationEnvironment || declarationEnvironment === environment) &&
        Boolean(platformId)
      )
    },
    async acquireInstrument(input) {
      if (acquireInstrument) return acquireInstrument(input)

      const config = isRecord(input.declaration.config) ? input.declaration.config : {}
      return {
        type: 'client_action',
        handlerName,
        action: 'launch_payment_handler',
        environment,
        platformId,
        merchant: isRecord(config.merchant_info) ? config.merchant_info : undefined,
        checkoutId: input.checkout.id,
        amount: input.checkout.totals.find((total) => total.type === 'total'),
        currency: input.checkout.currency,
        credentialBoundary: 'Provider returns a tokenized UCP payment instrument. Arro must not collect raw PAN, CVV, card number, wallet secret, or private payment credential fields.'
      }
    }
  }
}

export const createGooglePayPaymentHandlerAdapter = ({
  specificationUrl = 'https://pay.google.com/gp/p/ucp/2026-01-23/',
  schemaUrl = 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json',
  supportedVersions = ['2026-01-23'],
  environment,
  actionOrigins,
  acquireInstrument
}: GooglePayPaymentHandlerAdapterOptions): UcpPaymentHandlerAdapter => ({
  adapterKind: 'google_pay',
  handlerName: 'com.google.pay',
  executionMode: 'client',
  ...(actionOrigins?.length ? { actionOrigins: [...actionOrigins] } : {}),
  supports(declaration) {
    const config = isRecord(declaration.config) ? declaration.config : {}
    const declarationEnvironment = typeof config.environment === 'string'
      ? config.environment.toUpperCase()
      : undefined
    return (
      Boolean(declaration.id) &&
      supportedVersions.includes(declaration.version) &&
      declaration.spec === specificationUrl &&
      declaration.schema === schemaUrl &&
      declarationEnvironment === environment &&
      config.api_version === 2 &&
      config.api_version_minor === 0 &&
      Array.isArray(config.allowed_payment_methods)
    )
  },
  async acquireInstrument(input) {
    if (acquireInstrument) return acquireInstrument(input)

    const config = isRecord(input.declaration.config) ? input.declaration.config : {}
    return {
      type: 'client_action',
      handlerName: 'com.google.pay',
      action: 'request_google_pay_payment_data',
      environment,
      paymentRequest: config,
      checkoutId: input.checkout.id,
      amount: input.checkout.totals.find((total) => total.type === 'total'),
      currency: input.checkout.currency,
      credentialBoundary: 'Google Pay returns UCP paymentData/payment instrument details. Arro must not collect raw PAN, CVV, card number, wallet secret, or private payment credential fields.'
    }
  }
})

const ucpHeaders = ({
  platformProfileUrl,
  auth,
  idempotencyKey,
  requestId
}: {
  platformProfileUrl: string
  auth?: UcpAuthConfig | undefined
  idempotencyKey?: string | undefined
  requestId?: string | undefined
}) => ({
  Accept: 'application/json',
  'Content-Type': 'application/json',
  'UCP-Agent': `profile="${headerValue(platformProfileUrl)}"`,
  'Request-Id': requestId ?? randomUUID(),
  ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  ...authHeaders(auth)
})

const mcpMeta = ({
  platformProfileUrl,
  idempotencyKey
}: {
  platformProfileUrl: string
  idempotencyKey?: string | undefined
}) => ({
  'ucp-agent': {
    profile: platformProfileUrl
  },
  ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {})
})

/**
 * MCP tool schemas used by Shopify require UUID-shaped mutation keys, while
 * Arro's public API deliberately accepts a wider high-entropy key alphabet.
 * Derive a stable RFC 9562 custom UUID so an Arro retry maps to the same
 * merchant operation without coupling the public contract to one transport.
 */
const mcpMutationIdempotencyKey = (toolName: string, value: string) => {
  const bytes = createHash('sha256').update(`${toolName}\0${value}`, 'utf8').digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x80
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const operationBodyFromEnvelope = (value: unknown): unknown => {
  if (!isRecord(value)) return value
  if (isRecord(value.checkout)) return value.checkout
  if (isRecord(value.cart)) return value.cart
  if (isRecord(value.order)) return value.order
  if (isRecord(value.response)) return value.response
  return value
}

const bodyFromJsonRpcResult = (body: unknown): unknown => {
  if (!isRecord(body)) return body
  if (isRecord(body.error)) {
    throw new UcpProtocolError(
      typeof body.error.message === 'string' ? body.error.message : 'The merchant could not process this operation.',
      { code: body.error.code === -32602 ? 'ucp_mcp_invalid_params' : 'ucp_mcp_error' }
    )
  }
  const result = body.result
  if (!isRecord(result)) return body
  const structuredContent = result.structuredContent
  if (isRecord(structuredContent)) {
    return operationBodyFromEnvelope(structuredContent)
  }

  const content = result.content
  if (Array.isArray(content)) {
    const jsonText = content.find((item) =>
      isRecord(item) &&
      item.type === 'text' &&
      typeof item.text === 'string' &&
      item.text.trim().startsWith('{')
    )
    if (isRecord(jsonText) && typeof jsonText.text === 'string') {
      return operationBodyFromEnvelope(JSON.parse(jsonText.text))
    }
  }

  return operationBodyFromEnvelope(result)
}

export const createPaymentHandlerRegistry = (
  adapters: UcpPaymentHandlerAdapter[] = []
): UcpPaymentHandlerRegistry => ({
  adapters,
  resolve({ businessProfile, negotiatedPaymentHandlers, checkout, continueUrl }) {
    const profileHandlers: Record<string, UcpPaymentHandlerDeclaration[]> = negotiatedPaymentHandlers ?? businessProfile.ucp.payment_handlers ?? {}
    const responseHandlers: Record<string, UcpPaymentHandlerDeclaration[]> | undefined = checkout?.ucp.payment_handlers
    const declaredHandlers = responseHandlers
      ? Object.fromEntries(Object.entries(responseHandlers).map(([handlerName, declarations]) => {
          const profileDeclarations = profileHandlers[handlerName] ?? []
          return [handlerName, declarations.map((declaration) => {
            const profileDeclaration = profileDeclarations.find((candidate) =>
              candidate.version === declaration.version &&
              (!declaration.id || !candidate.id || candidate.id === declaration.id)
            )
            return profileDeclaration
              ? mergePaymentHandlerDeclaration(profileDeclaration, declaration)
              : declaration
          })]
        }))
      : profileHandlers
    const supports = (Object.entries(declaredHandlers) as Array<[string, UcpPaymentHandlerDeclaration[]]>).flatMap(([handlerName, declarations]) =>
      declarations.map((declaration) => {
        const adapter = adapters.find((candidate) =>
          candidate.handlerName === handlerName && candidate.supports(declaration)
        )

        if (!adapter) {
          const identity = paymentHandlerIdentity(handlerName, declaration)
          return {
            supported: false,
            handlerName,
            ...(identity ? { identity } : {}),
            declaration,
            reason: 'No Arro client or relay adapter is registered for this merchant-advertised UCP payment handler.'
          } satisfies UcpPaymentHandlerSupport
        }

        const identity = paymentHandlerIdentity(handlerName, declaration)
        if (!identity) {
          return {
            supported: false,
            handlerName,
            declaration,
            reason: 'Merchant-advertised UCP payment handler is missing required id, spec, or schema identity fields.'
          } satisfies UcpPaymentHandlerSupport
        }

        return {
          supported: true,
          handlerName,
          identity,
          declaration,
          executionMode: adapter.executionMode,
          ...(adapter.actionOrigins?.length ? { actionOrigins: [...adapter.actionOrigins] } : {}),
          reason: `Merchant-advertised ${handlerName} declaration ${identity.handlerInstanceId} is supported through ${adapter.executionMode} execution.`
        } satisfies UcpPaymentHandlerSupport
      })
    )

    if (continueUrl ?? checkout?.continue_url) {
      // This is an Arro fallback adapter, not a UCP core component. Its version
      // is intentionally owned here and must never be inferred from ucp.version.
      const merchantHostedContinuationVersion = '2026-09-01'
      supports.push({
        supported: true,
        handlerName: 'merchant_hosted_continuation',
        identity: {
          handlerName: 'merchant_hosted_continuation',
          handlerInstanceId: 'merchant_hosted_continuation',
          version: merchantHostedContinuationVersion,
          specification: 'merchant_hosted_continuation',
          schema: 'merchant_hosted_continuation'
        },
        declaration: {
          id: 'merchant_hosted_continuation',
          version: merchantHostedContinuationVersion,
          available_instruments: [{ type: 'merchant_hosted' }]
        },
        executionMode: 'merchant_hosted',
        reason: 'Merchant-hosted checkout continuation is available; Arro can hand off without handling payment credentials.'
      })
    }

    return supports
  }
})

export const createUcpClient = (options: UcpClientOptions): UcpClient => {
  const fetcher = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 15_000
  const maxResponseBytes = options.maxResponseBytes ?? 1_000_000
  let signRequest: ReturnType<typeof createUcpHttpMessageSigner> | undefined
  if (options.signingPrivateJwk !== undefined) {
    const signingPublicJwk = deriveUcpEs256PublicJwk(options.signingPrivateJwk)
    let publishedKeys: Array<Record<string, unknown>>
    try {
      publishedKeys = resolveUcpProfileSigningKeys({ keys: options.platformProfile.keys })
    } catch (error) {
      throw new TypeError(
        `platformProfile.keys is invalid: ${error instanceof Error ? error.message : 'invalid public JWK set'}`
      )
    }
    const signingPublicFields = Object.keys(signingPublicJwk)
    const signerIsPublished = publishedKeys.some((key) =>
      Object.keys(key).length === signingPublicFields.length &&
      signingPublicFields.every((field) => key[field] === signingPublicJwk[field as keyof typeof signingPublicJwk])
    )
    if (!signerIsPublished) {
      throw new TypeError(
        `signingPrivateJwk public key ${signingPublicJwk.kid} is not published exactly in platformProfile`
      )
    }
    signRequest = createUcpHttpMessageSigner(options.signingPrivateJwk)
  }

  const readJson = async (response: Response) => {
    const retryAfter = retryAfterSeconds(response.headers.get('retry-after'))
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.toLowerCase().includes('application/json')) {
      throw new UcpProtocolError('UCP endpoint returned a non-JSON response.', {
        code: 'ucp_non_json_response',
        httpStatus: response.status,
        ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {})
      })
    }

    const text = await response.text()
    if (text.length > maxResponseBytes) {
      throw new UcpProtocolError('UCP endpoint response exceeded the configured size limit.', {
        code: 'ucp_response_too_large',
        httpStatus: response.status,
        ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {})
      })
    }

    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new UcpProtocolError('UCP endpoint returned invalid JSON.', {
        code: 'ucp_json_invalid',
        httpStatus: response.status,
        ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {})
      })
    }
    if (!response.ok) {
      const messages = errorResponseValidator.Check(json)
        ? (json as UcpErrorResponse).messages
        : undefined
      throw new UcpProtocolError('UCP endpoint returned an HTTP error.', {
        code: 'ucp_http_error',
        httpStatus: response.status,
        ...(retryAfter !== undefined ? { retryAfterSeconds: retryAfter } : {}),
        ...(messages ? { messages } : {})
      })
    }

    return json
  }

  const fetchProfileDocument = async (url: URL, signal?: AbortSignal) => {
    const timeout = mergeSignals(signal, timeoutMs)
    try {
      const response = await fetcher(url, {
        headers: {
          Accept: 'application/json',
          'UCP-Agent': `profile="${headerValue(options.platformProfileUrl)}"`,
          'Request-Id': randomUUID()
        },
        redirect: 'manual',
        signal: timeout.signal
      })
      return await readJson(response)
    } finally {
      timeout.cleanup()
    }
  }

  const businessProfileIndex = (value: unknown) => {
    const code = 'ucp_business_profile_invalid'
    const profile = requireProfileRecord(value, 'profile', code)
    const ucp = requireProfileRecord(profile.ucp, 'profile.ucp', code)
    const version = requireDatedVersion(ucp.version, 'profile.ucp.version', code)
    const supportedVersions = ucp.supported_versions === undefined
      ? {}
      : requireProfileRecord(ucp.supported_versions, 'profile.ucp.supported_versions', code)
    return { profile, ucp, version, supportedVersions }
  }

  const resolveBusinessProfile = async (
    candidate: unknown,
    signal?: AbortSignal
  ): Promise<UcpBusinessProfile> => {
    const index = businessProfileIndex(candidate)
    if (index.version === UCP_CLIENT_PROTOCOL_VERSION) {
      return assertCanonicalProfile(candidate, 'business')
    }

    const mappedLeaf = index.supportedVersions[UCP_CLIENT_PROTOCOL_VERSION]
    if (typeof mappedLeaf !== 'string' || mappedLeaf.trim().length === 0) {
      throw new UcpProtocolError(
        `The merchant does not publish a UCP ${UCP_CLIENT_PROTOCOL_VERSION} profile.`,
        { code: 'ucp_version_incompatible' }
      )
    }

    const leafUrl = normalizeProfileUrl(
      mappedLeaf,
      options.allowHttpForLocalTesting === true,
      false
    )
    const leaf = await fetchProfileDocument(leafUrl, signal)
    return assertCanonicalProfile(leaf, 'business', { leaf: true })
  }

  const restRequest = async <TResponse>({
    negotiation,
    path,
    method,
    body,
    idempotencyKey,
    auth,
    signal,
    validator,
    code
  }: {
    negotiation: UcpNegotiation
    path: string
    method: string
    body?: unknown
    idempotencyKey?: string | undefined
    auth?: UcpAuthConfig | undefined
    signal?: AbortSignal | undefined
    validator: typeof cartValidator | typeof cartOperationResponseValidator | typeof checkoutValidator | typeof checkoutOperationResponseValidator | typeof orderValidator
    code: string
  }): Promise<TResponse> => {
    const endpoint = new URL(negotiation.endpoint)
    const url = new URL(path.replace(/^\//, ''), endpoint.href.endsWith('/') ? endpoint.href : `${endpoint.href}/`)
    const timeout = mergeSignals(signal, timeoutMs)
    const serializedBody = body !== undefined ? JSON.stringify(body) : undefined
    const unsignedHeaders = ucpHeaders({
      platformProfileUrl: options.platformProfileUrl,
      auth,
      idempotencyKey
    })
    // An explicit transport credential selects that authentication mode. Do
    // not attach a second signature scheme: a verifier may reject a malformed
    // or unsupported signature before it considers a valid bearer/API key, and
    // `type: none` is how a merchant-specific resolver deliberately selects an
    // advertised anonymous tier.
    const headers = signRequest && auth === undefined
      ? signRequest({
          method,
          url,
          headers: unsignedHeaders,
          ...(serializedBody !== undefined ? { body: Buffer.from(serializedBody, 'utf8') } : {})
        }).headers
      : unsignedHeaders

    try {
      const response = await fetcher(url, {
        method,
        headers,
        ...(serializedBody !== undefined ? { body: serializedBody } : {}),
        redirect: 'manual',
        signal: timeout.signal
      })
      const json = await readJson(response)
      return assertValid<TResponse>(validator, json, code)
    } finally {
      timeout.cleanup()
    }
  }

  const mcpRequest = async <TResponse>({
    negotiation,
    toolName,
    argumentsValue,
    idempotencyKey,
    auth,
    signal,
    validator,
    code
  }: {
    negotiation: UcpNegotiation
    toolName: string
    argumentsValue: unknown
    idempotencyKey?: string | undefined
    auth?: UcpAuthConfig | undefined
    signal?: AbortSignal | undefined
    validator: typeof cartValidator | typeof cartOperationResponseValidator | typeof checkoutValidator | typeof checkoutOperationResponseValidator | typeof orderValidator
    code: string
  }): Promise<TResponse> => {
    const timeout = mergeSignals(signal, timeoutMs)
    const serializedBody = JSON.stringify({
      jsonrpc: '2.0',
      id: `arro-ucp-${toolName}`,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: argumentsValue
      }
    })
    const unsignedHeaders = ucpHeaders({
      platformProfileUrl: options.platformProfileUrl,
      auth,
      idempotencyKey
    })
    const headers = signRequest && auth === undefined
      ? signRequest({
          method: 'POST',
          url: negotiation.endpoint,
          headers: unsignedHeaders,
          body: Buffer.from(serializedBody, 'utf8')
        }).headers
      : unsignedHeaders
    const response = await fetcher(negotiation.endpoint, {
      method: 'POST',
      headers,
      body: serializedBody,
      redirect: 'manual',
      signal: timeout.signal
    })

    try {
      const json = bodyFromJsonRpcResult(await readJson(response))
      return assertValid<TResponse>(validator, json, code)
    } finally {
      timeout.cleanup()
    }
  }

  const checkoutOperation = async <TBody, TResponse>({
    input,
    restPath,
    method,
    mcpTool,
    bodyValidator,
    responseValidator,
    code
  }: {
    input: UcpOperationInput<TBody>
    restPath: string
    method: string
    mcpTool: string
    bodyValidator?: typeof cartCreateValidator | typeof cartUpdateValidator | typeof cartCancelValidator | typeof checkoutCreateValidator | typeof checkoutUpdateValidator | typeof checkoutCompleteValidator | typeof checkoutCancelValidator
    responseValidator: typeof cartValidator | typeof cartOperationResponseValidator | typeof checkoutValidator | typeof checkoutOperationResponseValidator | typeof orderValidator
    code: string
  }): Promise<TResponse> => {
    assertStateChangingIdempotencyKey(method, input.idempotencyKey)
    if (bodyValidator && input.body !== undefined) {
      assertValid<TBody>(bodyValidator, input.body, `${code}_request`)
    }

    if (input.negotiation.transport === 'rest') {
      return restRequest<TResponse>({
        negotiation: input.negotiation,
        path: restPath,
        method,
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
        ...(input.auth !== undefined ? { auth: input.auth } : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
        validator: responseValidator,
        code: `${code}_response`
      })
    }

    if (input.negotiation.transport === 'mcp') {
      const outboundIdempotencyKey = input.idempotencyKey === undefined
        ? undefined
        : mcpMutationIdempotencyKey(mcpTool, input.idempotencyKey)
      const meta = mcpMeta({
        platformProfileUrl: options.platformProfileUrl,
        ...(outboundIdempotencyKey !== undefined ? { idempotencyKey: outboundIdempotencyKey } : {})
      })
      const mcpArguments = (() => {
        if (mcpTool === 'create_checkout') {
          const checkout: Record<string, unknown> = isRecord(input.body) ? input.body : {}
          const cartId = checkout.cart_id
          return {
            meta,
            ...(typeof cartId === 'string' && cartId.length > 0 ? { cart_id: cartId } : {}),
            // Shopify's currently deployed 2026-08-25 tool schema still
            // accepts the UCP request object (including cart_id) here, while
            // its current documentation also advertises a top-level cart_id.
            // Sending the same reference in both locations is unambiguous and
            // works across the live binding transition.
            checkout
          }
        }

        if (mcpTool === 'create_cart') {
          return {
            meta,
            cart: input.body ?? {}
          }
        }

        if (mcpTool === 'get_cart') {
          return {
            meta,
            id: (input as { cartId?: string }).cartId
          }
        }

        if (mcpTool === 'get_checkout') {
          return {
            meta,
            id: input.checkoutId
          }
        }

        if (mcpTool === 'get_order') {
          return {
            meta,
            id: input.orderId
          }
        }

        return {
          meta,
          id: (input as { cartId?: string }).cartId ?? input.checkoutId,
          ...(input.body !== undefined
            ? mcpTool.endsWith('_cart')
              ? { cart: input.body }
              : { checkout: input.body }
            : {})
        }
      })()

      return mcpRequest<TResponse>({
        negotiation: input.negotiation,
        toolName: mcpTool,
        argumentsValue: mcpArguments,
        ...(outboundIdempotencyKey !== undefined ? { idempotencyKey: outboundIdempotencyKey } : {}),
        ...(input.auth !== undefined ? { auth: input.auth } : {}),
        ...(input.signal !== undefined ? { signal: input.signal } : {}),
        validator: responseValidator,
        code: `${code}_response`
      })
    }

    throw new UcpProtocolError(`UCP ${input.negotiation.transport} transport is not implemented for checkout operations.`, {
      code: 'ucp_transport_not_implemented'
    })
  }

  return {
    async discover(profileUrlOrMerchantOrigin, requestOptions = {}) {
      const url = normalizeProfileUrl(
        profileUrlOrMerchantOrigin,
        options.allowHttpForLocalTesting === true,
        true
      )
      const currentProfile = await fetchProfileDocument(url, requestOptions.signal)
      return resolveBusinessProfile(currentProfile, requestOptions.signal)
    },

    async negotiate(platformProfile, businessProfile) {
      const selectedPlatformProfile = assertCanonicalProfile(platformProfile, 'platform')
      const selectedBusinessProfile = await resolveBusinessProfile(businessProfile)
      const version = UCP_CLIENT_PROTOCOL_VERSION

      const capabilities = capabilityIntersection(selectedPlatformProfile, selectedBusinessProfile)
      if (!capabilities['dev.ucp.shopping.checkout'] && !capabilities['dev.ucp.shopping.cart']) {
        throw new UcpProtocolError('The merchant profile does not negotiate cart or checkout capability with Arro.', {
          code: 'ucp_checkout_capability_missing'
        })
      }

      const serviceEntry = negotiatedServiceEntries(selectedPlatformProfile, selectedBusinessProfile)
        .filter(({ service }) =>
          (service.transport === 'rest' || service.transport === 'mcp') &&
          Boolean(serviceEndpoint(service))
        )
        .sort((left, right) => Number(right.service.transport === 'rest') - Number(left.service.transport === 'rest'))[0]

      if (!serviceEntry) {
        throw new UcpProtocolError('No shared REST or MCP UCP service endpoint is available.', {
          code: 'ucp_service_unavailable'
        })
      }

      const endpoint = serviceEndpoint(serviceEntry.service)!
      const endpointUrl = new URL(endpoint)
      if (endpointUrl.protocol !== 'https:' && !(options.allowHttpForLocalTesting && endpointUrl.hostname === 'localhost')) {
        throw new UcpProtocolError('Negotiated UCP service endpoint must use HTTPS.', {
          code: 'ucp_endpoint_not_https'
        })
      }

      return {
        version,
        transport: serviceEntry.service.transport,
        serviceNamespace: serviceEntry.namespace,
        service: serviceEntry.service,
        endpoint,
        capabilities,
        paymentHandlers: paymentHandlerIntersection(selectedPlatformProfile, selectedBusinessProfile),
        businessProfile: selectedBusinessProfile
      }
    },

    createCart(input) {
      return checkoutOperation<UcpCartCreateRequest, UcpCartOperationResponse>({
        input,
        restPath: '/carts',
        method: 'POST',
        mcpTool: 'create_cart',
        bodyValidator: validators.createCart,
        responseValidator: cartOperationResponseValidator,
        code: 'create_cart'
      })
    },

    getCart(input) {
      return checkoutOperation<unknown, UcpCartOperationResponse>({
        input,
        restPath: `/carts/${encodePathSegment(input.cartId)}`,
        method: 'GET',
        mcpTool: 'get_cart',
        responseValidator: cartOperationResponseValidator,
        code: 'get_cart'
      })
    },

    updateCart(input) {
      return checkoutOperation<UcpCartUpdateRequest, UcpCartOperationResponse>({
        input,
        restPath: `/carts/${encodePathSegment(input.cartId)}`,
        method: 'PUT',
        mcpTool: 'update_cart',
        bodyValidator: validators.updateCart,
        responseValidator: cartOperationResponseValidator,
        code: 'update_cart'
      })
    },

    cancelCart(input) {
      return checkoutOperation<UcpCartCancelRequest, UcpCartOperationResponse>({
        input,
        restPath: `/carts/${encodePathSegment(input.cartId)}/cancel`,
        method: 'POST',
        mcpTool: 'cancel_cart',
        bodyValidator: validators.cancelCart,
        responseValidator: cartOperationResponseValidator,
        code: 'cancel_cart'
      })
    },

    createCheckout(input) {
      return checkoutOperation<UcpCheckoutCreateRequest, UcpCheckoutOperationResponse>({
        input,
        restPath: '/checkout-sessions',
        method: 'POST',
        mcpTool: 'create_checkout',
        bodyValidator: validators.create,
        responseValidator: checkoutOperationResponseValidator,
        code: 'create_checkout'
      })
    },

    getCheckout(input) {
      return checkoutOperation<unknown, UcpCheckoutOperationResponse>({
        input,
        restPath: `/checkout-sessions/${encodePathSegment(input.checkoutId)}`,
        method: 'GET',
        mcpTool: 'get_checkout',
        responseValidator: checkoutOperationResponseValidator,
        code: 'get_checkout'
      })
    },

    updateCheckout(input) {
      return checkoutOperation<UcpCheckoutUpdateRequest, UcpCheckoutOperationResponse>({
        input,
        restPath: `/checkout-sessions/${encodePathSegment(input.checkoutId)}`,
        method: 'PUT',
        mcpTool: 'update_checkout',
        bodyValidator: validators.update,
        responseValidator: checkoutOperationResponseValidator,
        code: 'update_checkout'
      })
    },

    completeCheckout(input) {
      return checkoutOperation<UcpCheckoutCompleteRequest, UcpCheckoutOperationResponse>({
        input,
        restPath: `/checkout-sessions/${encodePathSegment(input.checkoutId)}/complete`,
        method: 'POST',
        mcpTool: 'complete_checkout',
        bodyValidator: validators.complete,
        responseValidator: checkoutOperationResponseValidator,
        code: 'complete_checkout'
      })
    },

    cancelCheckout(input) {
      return checkoutOperation<UcpCheckoutCancelRequest, UcpCheckoutOperationResponse>({
        input,
        restPath: `/checkout-sessions/${encodePathSegment(input.checkoutId)}/cancel`,
        method: 'POST',
        mcpTool: 'cancel_checkout',
        bodyValidator: validators.cancel,
        responseValidator: checkoutOperationResponseValidator,
        code: 'cancel_checkout'
      })
    },

    getOrder(input) {
      return checkoutOperation<unknown, UcpOrder>({
        input,
        restPath: `/orders/${encodePathSegment(input.orderId)}`,
        method: 'GET',
        mcpTool: 'get_order',
        responseValidator: orderValidator,
        code: 'get_order'
      })
    }
  }
}

export const assertUcpOrderWebhookEvent = (event: unknown): UcpOrderWebhookEvent =>
  assertValid<UcpOrderWebhookEvent>(orderWebhookEventValidator, event, 'order_webhook_event')
