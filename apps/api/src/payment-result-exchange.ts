import { createHash } from 'node:crypto'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  UCP_STABLE_VERSION,
  type UcpPlatformProfile,
  UcpPaymentInstrumentSchema,
  validationErrorSummary,
  type PurchasePaymentActionResult,
  type UcpCheckout,
  type UcpPaymentHandlerDeclaration,
  type UcpPaymentInstrument,
  type UcpProfile
} from '@arro/contracts'
import { stableJsonStringify } from './stable-json.ts'
import {
  PortablePaymentError,
  exchangePortablePaymentResult,
  mppHandlerName,
  mppProtocolVersion,
  x402HandlerName,
  x402ProtocolVersion
} from './portable-payment.ts'
import {
  assertGooglePayHandlerIdentity,
  normalizeGooglePayUcpConfig
} from './google-pay-web.ts'
import {
  TrustedHostPaymentError,
  type TrustedHostPaymentExpectedBinding,
  type TrustedHostPaymentVerifier
} from './trusted-host-payment.ts'

const instrumentValidator = TypeCompiler.Compile(UcpPaymentInstrumentSchema)

export type PaymentResultExchangeErrorCode =
  | 'payment_result_missing'
  | 'payment_result_provider_unsupported'
  | 'payment_result_shape_invalid'
  | 'payment_result_raw_credentials_rejected'
  | 'payment_result_tokenizer_missing'
  | 'payment_result_tokenizer_auth_missing'
  | 'payment_result_tokenizer_declaration_invalid'
  | 'payment_result_tokenize_failed'
  | 'payment_result_reusable_token_rejected'
  | 'payment_result_scope_invalid'
  | 'payment_result_credential_expired'
  | 'payment_result_ap2_invalid'
  | 'payment_result_instrument_invalid'

export class PaymentResultExchangeError extends Error {
  readonly code: PaymentResultExchangeErrorCode
  readonly details?: unknown

  constructor(code: PaymentResultExchangeErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'PaymentResultExchangeError'
    this.code = code
    this.details = details
  }
}

export type PaymentCredentialProviderTokenizeInput = {
  provider: string
  handlerName: string
  handlerId: string
  handlerSpecification: string
  handlerSchema: string
  declaration: UcpPaymentHandlerDeclaration
  result: unknown
  checkout: UcpCheckout
  businessProfile: UcpProfile
  merchantOrigin: string
  checkoutSnapshotHash?: string
  paymentActionId?: string
}

export type PaymentCredentialProvider = {
  tokenize(input: PaymentCredentialProviderTokenizeInput): Promise<UcpPaymentInstrument>
}

export type TokenizerRequestAuth = {
  headers: Record<string, string>
}

export type TokenizerCredentialResolverInput = {
  merchantOrigin: string
  provider: string
  handlerName: string
  handlerId: string
  declarationId?: string
  declarationVersion: string
  handlerSpecification: string
  handlerSchema: string
  tokenizeEndpoint: string
  environment?: string
}

export interface TokenizerCredentialResolver {
  resolve(input: TokenizerCredentialResolverInput): Promise<TokenizerRequestAuth | undefined>
}

export type PaymentResultExchangeInput = {
  provider?: string | undefined
  expectedHandlerId?: string | undefined
  result?: PurchasePaymentActionResult | undefined
  checkout: UcpCheckout
  businessProfile: UcpProfile
  merchantOrigin?: string | undefined
  credentialProvider?: PaymentCredentialProvider | undefined
  handlerSpecs?: PaymentHandlerSpecConfig[] | undefined
  paymentActionPayload?: Record<string, unknown> | undefined
  checkoutSnapshotHash?: string | undefined
  paymentActionId?: string | undefined
  trustedHostPaymentVerifier?: TrustedHostPaymentVerifier | undefined
  trustedHostExpectedBinding?: TrustedHostPaymentExpectedBinding | undefined
}

export type PaymentResultExchangeOutput = {
  provider: string
  handlerName: string
  handlerId: string
  instrument: UcpPaymentInstrument
  ap2CheckoutMandate?: string
  resultFingerprint: string
}

type GooglePayPaymentActionResult = Extract<PurchasePaymentActionResult, { type: 'google_pay_payment_data' }>

export type HandlerCredentialLifecyclePolicy = {
  rejectReusable?: boolean
  requiresCheckoutScope?: boolean
  requiresMerchantOriginScope?: boolean
  requiresExpiry?: boolean
}

export type PaymentHandlerAdapterKind =
  | 'x402'
  | 'mpp'
  | 'processor_tokenizer'
  | 'google_pay'

export type PaymentHandlerSpecConfig = {
  adapterKind: PaymentHandlerAdapterKind
  handlerName: string
  platformHandlerId: string
  versions: string[]
  specification: string
  schema: string
  environment?: string
  actionOrigins?: string[]
  handlerConfig?: Record<string, unknown>
  availableInstruments?: UcpPaymentHandlerDeclaration['available_instruments']
  lifecyclePolicy: HandlerCredentialLifecyclePolicy
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const stringValue = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined

const lower = (value: string | undefined) => value?.trim().toLowerCase()

const stableHash = (value: unknown) =>
  `sha256:${createHash('sha256').update(stableJsonStringify(value), 'utf8').digest('hex')}`

const assertGooglePayResultPresentation = ({
  result,
  paymentActionPayload
}: {
  result: GooglePayPaymentActionResult
  paymentActionPayload: Record<string, unknown> | undefined
}) => {
  const payload = asRecord(paymentActionPayload)
  const kind = stringValue(payload.kind)
  const presentation = stringValue(payload.presentation)
  const expectedPresentations = result.source === 'native'
    ? ['host_native']
    : ['embedded_component', 'external_action']
  if (kind !== 'google_pay' || !presentation || !expectedPresentations.includes(presentation)) {
    throw new PaymentResultExchangeError(
      'payment_result_scope_invalid',
      `Google Pay ${result.source} result does not match the signed payment-action presentation.`,
      {
        source: result.source,
        presentation,
        expectedPresentations
      }
    )
  }

  const paymentRequest = asRecord(payload.paymentRequest)
  if (
    result.paymentData.apiVersion !== paymentRequest.apiVersion ||
    result.paymentData.apiVersionMinor !== paymentRequest.apiVersionMinor
  ) {
    throw new PaymentResultExchangeError(
      'payment_result_scope_invalid',
      'Google Pay result API version does not match the signed merchant payment request.'
    )
  }
  const allowedTokenizationTypes = new Set(
    (Array.isArray(paymentRequest.allowedPaymentMethods)
      ? paymentRequest.allowedPaymentMethods
      : []
    ).flatMap((method) => {
      const type = stringValue(asRecord(asRecord(method).tokenizationSpecification).type)
      return type ? [type] : []
    })
  )
  const resultTokenizationType = result.paymentData.paymentMethodData.tokenizationData.type
  if (!allowedTokenizationTypes.has(resultTokenizationType)) {
    throw new PaymentResultExchangeError(
      'payment_result_scope_invalid',
      'Google Pay result tokenization does not match the signed merchant payment request.',
      {
        resultTokenizationType,
        allowedTokenizationTypes: [...allowedTokenizationTypes]
      }
    )
  }
}

const assertNoRawCardFields = (value: unknown) => {
  const lowered = stableJsonStringify(value).toLowerCase()
  for (const key of ['"pan"', '"cvv"', '"cvc"', '"card_number"', '"cardnumber"', '"card-number"', '"number"']) {
    if (lowered.includes(key)) {
      throw new PaymentResultExchangeError(
        'payment_result_raw_credentials_rejected',
        'Payment provider result must not include raw card number, PAN, CVV, CVC, or equivalent payment secrets.'
      )
    }
  }
}

const handlerDeclarationFrom = ({
  handlerName,
  expectedHandlerId,
  businessProfile,
  checkout
}: {
  handlerName: string
  expectedHandlerId?: string | undefined
  businessProfile: UcpProfile
  checkout: UcpCheckout
}) => {
  const declaredHandlers = checkout.ucp.payment_handlers ?? businessProfile.ucp.payment_handlers ?? {}
  const declarations = declaredHandlers[handlerName] ?? []
  const exact = expectedHandlerId
    ? declarations.find((declaration) => declaration.id === expectedHandlerId)
    : declarations.length === 1
      ? declarations[0]
      : undefined
  if (exact?.id) {
    return {
      handlerName,
      handlerId: exact.id,
      handlerSpecification: stringValue(exact.spec) ?? '',
      handlerSchema: stringValue(exact.schema) ?? '',
      declaration: exact
    }
  }
  return undefined
}

export const tokenizerUrlFromDeclaration = (declaration: UcpPaymentHandlerDeclaration) => {
  const config = asRecord(declaration.config)
  const tokenizer = asRecord(config.tokenizer)
  const endpoints = asRecord(config.endpoints)
  return (
    stringValue(config.tokenize_url) ??
    stringValue(config.tokenizeUrl) ??
    stringValue(config.endpoint) ??
    stringValue(tokenizer.url) ??
    stringValue(tokenizer.tokenize_url) ??
    stringValue(endpoints.tokenize)
  )
}

const containsPublicTokenizerSecret = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsPublicTokenizerSecret)
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[-_]/g, '')
    if ([
      'authorization',
      'bearertoken',
      'bearer',
      'apikey',
      'secret',
      'tokenizebearertoken'
    ].includes(normalized)) {
      return true
    }
    if (containsPublicTokenizerSecret(entry)) return true
  }
  return false
}

const assertProcessorTokenizerDeclaration = (
  handlerName: string,
  handlerId: string,
  declaration: UcpPaymentHandlerDeclaration,
  checkout: UcpCheckout,
  handlerSpecs: PaymentHandlerSpecConfig[]
) => {
  if (handlerId !== declaration.id) {
    throw new PaymentResultExchangeError(
      'payment_result_provider_unsupported',
      'Payment action handler instance must exactly match the merchant-declared payment handler declaration id.',
      { handlerName, handlerId, declarationId: declaration.id }
    )
  }

  const spec = stringValue(declaration.spec) ?? ''
  const schema = stringValue(declaration.schema) ?? ''
  const matchedSpec = handlerSpecs.find((candidate) =>
    candidate.handlerName === handlerName &&
    candidate.adapterKind === 'processor_tokenizer' &&
    candidate.versions.includes(declaration.version) &&
    candidate.specification === spec &&
    candidate.schema === schema
  )
  if (!matchedSpec) {
    throw new PaymentResultExchangeError(
      'payment_result_tokenizer_declaration_invalid',
      'Payment handler declaration is not registered in Arro runtime handler specifications.',
      { handlerName, handlerId, spec, schema }
    )
  }
  if (checkout.ucp.version !== UCP_STABLE_VERSION) {
    throw new PaymentResultExchangeError(
      'payment_result_tokenizer_declaration_invalid',
      'Processor Tokenizer exchange requires the negotiated stable UCP checkout version.',
      { declarationVersion: declaration.version, checkoutVersion: checkout.ucp.version }
    )
  }
  if (!schema) {
    throw new PaymentResultExchangeError(
      'payment_result_tokenizer_declaration_invalid',
      'Processor Tokenizer handler must declare a schema.'
    )
  }
  if (!tokenizerUrlFromDeclaration(declaration)) {
    throw new PaymentResultExchangeError(
      'payment_result_tokenizer_missing',
      'Merchant payment handler did not declare a Processor Tokenizer /tokenize endpoint.',
      { handlerId }
    )
  }

  const credentialType = stringValue(asRecord(declaration.config).credential_type)
  if (!credentialType) {
    throw new PaymentResultExchangeError(
      'payment_result_tokenizer_declaration_invalid',
      'Processor Tokenizer handler must declare the exact handler-defined credential_type accepted by /tokenize.'
    )
  }

  const instrumentTypes = [...new Set(
    (declaration.available_instruments ?? [])
      .map((instrument) => stringValue(instrument.type))
      .filter((type): type is string => Boolean(type))
  )]
  if (instrumentTypes.length !== 1) {
    throw new PaymentResultExchangeError(
      'payment_result_tokenizer_declaration_invalid',
      'Processor Tokenizer execution requires exactly one unambiguous available instrument type.',
      { instrumentTypes }
    )
  }

  if (containsPublicTokenizerSecret(declaration.config)) {
    throw new PaymentResultExchangeError(
      'payment_result_tokenizer_declaration_invalid',
      'Processor Tokenizer declarations must not expose tokenizer auth credentials. Arro resolves /tokenize auth from runtime trusted configuration.'
    )
  }

  return matchedSpec
}

const credentialRecord = (instrument: UcpPaymentInstrument) => asRecord(instrument.credential)

export const paymentInstrumentCredentialExpired = (
  instrument: UcpPaymentInstrument,
  now = new Date()
) => {
  const credential = credentialRecord(instrument)
  const expiresAt = stringValue(credential.expires_at) ?? stringValue(credential.expiresAt)
  return Boolean(
    expiresAt &&
    (Number.isNaN(new Date(expiresAt).getTime()) || new Date(expiresAt).getTime() <= now.getTime())
  )
}

const assertNonReusableScopedInstrument = (
  instrument: UcpPaymentInstrument,
  checkout: UcpCheckout,
  merchantOrigin: string,
  lifecyclePolicy: HandlerCredentialLifecyclePolicy
) => {
  const credential = credentialRecord(instrument)
  if (lifecyclePolicy.rejectReusable !== false && (credential.reusable === true || credential.reusable === 'true')) {
    throw new PaymentResultExchangeError(
      'payment_result_reusable_token_rejected',
      'Processor Tokenizer returned a reusable credential. Arro accepts only checkout-scoped, non-reusable payment credentials.'
    )
  }

  const scope = asRecord(credential.scope)
  const checkoutId = stringValue(scope.checkout_id) ?? stringValue(scope.checkoutId) ?? stringValue(credential.checkout_id)
  if (lifecyclePolicy.requiresCheckoutScope !== false && checkoutId !== checkout.id) {
    throw new PaymentResultExchangeError(
      'payment_result_scope_invalid',
      'Processor Tokenizer returned a credential without exact current-checkout scope.',
      { checkoutId, expectedCheckoutId: checkout.id }
    )
  }

  const scopedMerchantOrigin =
    stringValue(scope.merchant_origin) ??
    stringValue(scope.merchantOrigin) ??
    stringValue(credential.merchant_origin) ??
    stringValue(credential.merchantOrigin)
  if (lifecyclePolicy.requiresMerchantOriginScope !== false && scopedMerchantOrigin !== merchantOrigin) {
    throw new PaymentResultExchangeError(
      'payment_result_scope_invalid',
      'Processor Tokenizer returned a credential without exact merchant-origin scope.',
      { merchantOrigin: scopedMerchantOrigin, expectedMerchantOrigin: merchantOrigin }
    )
  }

  const expiresAt = stringValue(credential.expires_at) ?? stringValue(credential.expiresAt)
  if (expiresAt && Number.isNaN(new Date(expiresAt).getTime())) {
    throw new PaymentResultExchangeError(
      'payment_result_scope_invalid',
      'Processor Tokenizer returned a credential with an invalid expiry timestamp.'
    )
  }
  if (
    lifecyclePolicy.requiresExpiry !== false &&
    (!expiresAt || paymentInstrumentCredentialExpired(instrument))
  ) {
    throw new PaymentResultExchangeError(
      'payment_result_credential_expired',
      'Processor Tokenizer returned an expired credential or omitted credential expiry.'
    )
  }
}

const googlePayInstrumentFromPaymentData = ({
  result,
  handlerId
}: {
  result: GooglePayPaymentActionResult
  handlerId: string
}): UcpPaymentInstrument => {
  const paymentData = result.paymentData
  const methodData = paymentData.paymentMethodData
  const info = asRecord(methodData.info)
  const tokenizationData = methodData.tokenizationData
  const brand = stringValue(info.cardNetwork)
  const lastDigits = stringValue(info.cardDetails)
  const billingAddress = asRecord(info.billingAddress)
  return {
    id: `gpay_${stableHash({
      handlerId,
      token: tokenizationData.token
    }).slice('sha256:'.length, 'sha256:'.length + 32)}`,
    handler_id: handlerId,
    type: 'card',
    display: {
      ...(brand ? { brand } : {}),
      ...(lastDigits ? { last_digits: lastDigits } : {}),
      ...(brand && lastDigits ? { description: `${brand} ending in ${lastDigits}` } : {})
    },
    ...(Object.keys(billingAddress).length > 0 ? { billing_address: billingAddress } : {}),
    credential: {
      type: tokenizationData.type,
      token: tokenizationData.token
    }
  } as UcpPaymentInstrument
}

const safeHeaders = (headers: Record<string, string>) => {
  const output: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (!/^[!#$%&'*+\-.^_`|~0-9a-zA-Z]+$/.test(name) || /[\r\n]/.test(value)) {
      throw new PaymentResultExchangeError(
        'payment_result_tokenizer_auth_missing',
        'Tokenizer credential resolver returned an unsafe HTTP header.'
      )
    }
    output[name] = value
  }
  return output
}

type TokenizerAuthConfig = {
  merchantOrigin: string
  provider: string
  handlerId?: string
  declarationId?: string
  tokenizeEndpoint?: string
  environment?: string
  headers?: Record<string, string>
  bearerToken?: string
  apiKey?: {
    header: string
    value: string
  }
}

const defaultLifecyclePolicy: Required<HandlerCredentialLifecyclePolicy> = {
  rejectReusable: true,
  requiresCheckoutScope: true,
  requiresMerchantOriginScope: true,
  requiresExpiry: true
}

export const minimumDirectPaymentPolicy = {
  exactHandlerInstance: true,
  exactCurrentCheckout: true,
  exactMerchant: true,
  userOrHostAuthorization: true,
  expirationOrProviderOneTimeState: true,
  replayProtection: true,
  consumeOnce: true,
  noReusableSecretPersistence: true
} as const

const supportedAdapterKinds: ReadonlySet<PaymentHandlerAdapterKind> = new Set([
  'x402',
  'mpp',
  'processor_tokenizer',
  'google_pay'
])

const assertHttpsUrl = (value: string, field: string) => {
  const url = new URL(value)
  if (url.protocol !== 'https:') {
    throw new Error(`${field} must be an HTTPS URL.`)
  }
  return url.href
}

const stringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((entry) => stringValue(entry) ? [stringValue(entry)!] : [])
    : []

const assertCanonicalAvailableInstrumentConstraints = (
  instruments: UcpPaymentHandlerDeclaration['available_instruments'],
  index: number
) => {
  for (const [instrumentIndex, instrument] of (instruments ?? []).entries()) {
    const constraints = asRecord(instrument.constraints)
    if (Object.hasOwn(constraints, 'brands')) {
      throw new Error(
        `UCP_PAYMENT_HANDLER_SPECS_JSON[${index}].availableInstruments[${instrumentIndex}].constraints must use the v2026-08-25 Constraint Expression shape (for example properties.brand.enum), not legacy brands.`
      )
    }
  }
}

const normalizeActionOrigins = (value: unknown, field: string) => {
  const origins = stringArray(value).map((entry, index) => {
    let url: URL
    try {
      url = new URL(entry)
    } catch {
      throw new Error(`${field}[${index}] must be a valid HTTPS origin.`)
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new Error(`${field}[${index}] must be an HTTPS origin without credentials.`)
    }
    if (url.pathname !== '/' || url.search || url.hash) {
      throw new Error(`${field}[${index}] must contain only an origin, without a path, query, or fragment.`)
    }
    return url.origin
  }).filter((origin, index, entries) => entries.indexOf(origin) === index)

  if (origins.length > 32) {
    throw new Error(`${field} must contain at most 32 unique origins.`)
  }
  return origins
}

const normalizeLifecyclePolicy = (value: unknown): HandlerCredentialLifecyclePolicy => {
  const record = asRecord(value)
  for (const key of [
    'rejectReusable',
    'requiresCheckoutScope',
    'requiresMerchantOriginScope',
    'requiresExpiry'
  ]) {
    if (record[key] === false) {
      throw new Error(`UCP payment handler lifecycle policy cannot set ${key} to false; direct-payment minimum safety is non-relaxable.`)
    }
  }

  return {
    rejectReusable: defaultLifecyclePolicy.rejectReusable,
    requiresCheckoutScope: defaultLifecyclePolicy.requiresCheckoutScope,
    requiresMerchantOriginScope: defaultLifecyclePolicy.requiresMerchantOriginScope,
    requiresExpiry: defaultLifecyclePolicy.requiresExpiry
  }
}

export const parsePaymentHandlerSpecConfig = (value: unknown): PaymentHandlerSpecConfig[] => {
  if (!value) return []
  const entries = Array.isArray(value)
    ? value
    : typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>).map(([handlerName, entry]) => ({
          handlerName,
          ...(entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {})
        }))
      : undefined
  if (!entries) throw new Error('UCP_PAYMENT_HANDLER_SPECS_JSON must be an array or object keyed by handler name.')

  return entries.map((entry, index) => {
    const record = asRecord(entry)
    const adapterKind = stringValue(record.adapterKind) ?? stringValue(record.adapter_kind)
    const handlerName = stringValue(record.handlerName) ?? stringValue(record.provider)
    const platformHandlerId =
      stringValue(record.platformHandlerId) ??
      stringValue(record.platform_handler_id) ??
      stringValue(record.handlerId) ??
      stringValue(record.id)
    const specification = stringValue(record.specification) ?? stringValue(record.spec)
    const schema = stringValue(record.schema)
    const environment = stringValue(record.environment)
    const actionOrigins = normalizeActionOrigins(
      record.actionOrigins ?? record.action_origins,
      `UCP_PAYMENT_HANDLER_SPECS_JSON[${index}].actionOrigins`
    )
    const handlerConfig = asRecord(record.handlerConfig ?? record.handler_config ?? record.config)
    if (!adapterKind || !supportedAdapterKinds.has(adapterKind as PaymentHandlerAdapterKind)) {
      throw new Error(`UCP_PAYMENT_HANDLER_SPECS_JSON[${index}] must include an explicit supported adapterKind.`)
    }
    if (!handlerName || !platformHandlerId || !specification || !schema) {
      throw new Error(`UCP_PAYMENT_HANDLER_SPECS_JSON[${index}] must include adapterKind, handlerName, platformHandlerId, specification, and schema.`)
    }
    if (containsPublicTokenizerSecret(record)) {
      throw new Error(`UCP_PAYMENT_HANDLER_SPECS_JSON[${index}] must not contain tokenizer auth credentials or private secrets.`)
    }
    const versions = stringArray(record.versions)
    const availableInstruments = Array.isArray(record.availableInstruments)
      ? record.availableInstruments as UcpPaymentHandlerDeclaration['available_instruments']
      : Array.isArray(record.available_instruments)
        ? record.available_instruments as UcpPaymentHandlerDeclaration['available_instruments']
        : undefined
    if (versions.length === 0) {
      throw new Error(
        `UCP_PAYMENT_HANDLER_SPECS_JSON[${index}] must declare explicit handler versions; payment-handler versions do not inherit the UCP core version.`
      )
    }
    const normalizedVersions = versions
    assertCanonicalAvailableInstrumentConstraints(availableInstruments, index)
    if (adapterKind === 'google_pay') {
      assertGooglePayHandlerIdentity({
        handlerName,
        versions: normalizedVersions,
        specification,
        schema
      })
      const merchantOrigin = stringValue(asRecord(handlerConfig.merchant_info).merchant_origin)
      normalizeGooglePayUcpConfig({
        config: handlerConfig,
        merchantOrigin: `https://${merchantOrigin ?? ''}`,
        ...(environment ? { expectedEnvironment: environment } : {})
      })
    }
    if (adapterKind === 'x402' || adapterKind === 'mpp') {
      const expectedName = adapterKind === 'x402' ? x402HandlerName : mppHandlerName
      const expectedProtocolVersion = adapterKind === 'x402' ? x402ProtocolVersion : mppProtocolVersion
      if (handlerName !== expectedName) {
        throw new Error(`UCP_PAYMENT_HANDLER_SPECS_JSON[${index}] ${adapterKind} handlerName must be ${expectedName}.`)
      }
      if (stringValue(handlerConfig.protocol_version) !== expectedProtocolVersion) {
        throw new Error(`UCP_PAYMENT_HANDLER_SPECS_JSON[${index}] ${adapterKind} protocol_version must be ${expectedProtocolVersion}.`)
      }
      if (stringArray(handlerConfig.methods ?? handlerConfig.schemes).length === 0) {
        throw new Error(`UCP_PAYMENT_HANDLER_SPECS_JSON[${index}] ${adapterKind} must declare at least one executable method or scheme.`)
      }
    }
    return {
      adapterKind: adapterKind as PaymentHandlerAdapterKind,
      handlerName,
      platformHandlerId,
      versions: normalizedVersions,
      specification: assertHttpsUrl(specification, `UCP_PAYMENT_HANDLER_SPECS_JSON[${index}].specification`),
      schema: assertHttpsUrl(schema, `UCP_PAYMENT_HANDLER_SPECS_JSON[${index}].schema`),
      ...(environment ? { environment } : {}),
      ...(actionOrigins.length > 0 ? { actionOrigins } : {}),
      ...(Object.keys(handlerConfig).length > 0 ? { handlerConfig } : {}),
      ...(availableInstruments ? { availableInstruments } : {}),
      lifecyclePolicy: normalizeLifecyclePolicy(record.lifecyclePolicy ?? record.lifecycle_policy)
    } satisfies PaymentHandlerSpecConfig
  })
}

export const parseTokenizerAuthConfig = (value: unknown): TokenizerAuthConfig[] => {
  if (!value) return []
  if (Array.isArray(value)) return value as TokenizerAuthConfig[]
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([merchantOrigin, entry]) => ({
      merchantOrigin,
      ...(entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {})
    })) as TokenizerAuthConfig[]
  }
  throw new Error('UCP_TOKENIZER_AUTH_JSON must be an object keyed by merchant origin or an array of exact tokenizer credential records.')
}

export const processorTokenizerPaymentHandlersFromSpecConfig = (
  configs: PaymentHandlerSpecConfig[]
): UcpPlatformProfile['ucp']['payment_handlers'] => {
  const paymentHandlers: UcpPlatformProfile['ucp']['payment_handlers'] = {}
  for (const config of configs.filter((entry) => entry.adapterKind === 'processor_tokenizer')) {
    paymentHandlers[config.handlerName] = [
      ...(paymentHandlers[config.handlerName] ?? []),
      {
        id: config.platformHandlerId,
        version: config.versions[0]!,
        spec: config.specification,
        schema: config.schema,
        ...(config.availableInstruments ? { available_instruments: config.availableInstruments } : {}),
        config: {
          ...(config.handlerConfig ?? {}),
          ...(config.environment ? { environment: config.environment } : {})
        }
      }
    ]
  }
  return paymentHandlers
}

export const paymentHandlersFromSpecConfig = (
  configs: PaymentHandlerSpecConfig[]
): UcpPlatformProfile['ucp']['payment_handlers'] => {
  const paymentHandlers: UcpPlatformProfile['ucp']['payment_handlers'] = {}
  for (const config of configs) {
    paymentHandlers[config.handlerName] = [
      ...(paymentHandlers[config.handlerName] ?? []),
      {
        id: config.platformHandlerId,
        version: config.versions[0]!,
        spec: config.specification,
        schema: config.schema,
        ...(config.availableInstruments ? { available_instruments: config.availableInstruments } : {}),
        config: {
          ...(config.handlerConfig ?? {}),
          ...(config.environment ? { environment: config.environment } : {})
        }
      }
    ]
  }
  return paymentHandlers
}

export const createTokenizerCredentialResolver = (
  configs: TokenizerAuthConfig[] = []
): TokenizerCredentialResolver => {
  const normalized = configs.map((config) => ({
    merchantOrigin: new URL(config.merchantOrigin).origin,
    provider: config.provider,
    handlerId: config.handlerId,
    declarationId: config.declarationId,
    tokenizeEndpoint: config.tokenizeEndpoint ? new URL(config.tokenizeEndpoint).href : undefined,
    environment: config.environment,
    headers: config.headers,
    bearerToken: config.bearerToken,
    apiKey: config.apiKey
  }))

  return {
    async resolve(input) {
      const endpoint = new URL(input.tokenizeEndpoint).href
      const match = normalized.find((candidate) =>
        candidate.merchantOrigin === new URL(input.merchantOrigin).origin &&
        candidate.provider === input.provider &&
        (!candidate.handlerId || candidate.handlerId === input.handlerId) &&
        (!candidate.declarationId || candidate.declarationId === input.declarationId) &&
        (!candidate.tokenizeEndpoint || candidate.tokenizeEndpoint === endpoint) &&
        (!candidate.environment || candidate.environment === input.environment)
      )
      if (!match) return undefined

      if (match.headers) return { headers: safeHeaders(match.headers) }
      if (match.bearerToken) return { headers: safeHeaders({ Authorization: `Bearer ${match.bearerToken}` }) }
      if (match.apiKey) return { headers: safeHeaders({ [match.apiKey.header]: match.apiKey.value }) }
      return undefined
    }
  }
}

export const createTokenizerCredentialResolverFromEnv = (
  env: NodeJS.ProcessEnv = process.env
): TokenizerCredentialResolver => {
  const raw = env.UCP_TOKENIZER_AUTH_JSON?.trim()
  if (!raw) return createTokenizerCredentialResolver()
  return createTokenizerCredentialResolver(parseTokenizerAuthConfig(JSON.parse(raw) as unknown))
}

export const createHttpPaymentCredentialProvider = ({
  fetch: fetcher = fetch,
  credentialResolver = createTokenizerCredentialResolver()
}: {
  fetch?: typeof fetch
  credentialResolver?: TokenizerCredentialResolver
} = {}): PaymentCredentialProvider => ({
  async tokenize(input) {
    const tokenizeUrl = tokenizerUrlFromDeclaration(input.declaration)
    if (!tokenizeUrl) {
      throw new PaymentResultExchangeError(
        'payment_result_tokenizer_missing',
        'Merchant payment handler did not declare a Processor Tokenizer /tokenize endpoint.',
        { handlerId: input.handlerId }
      )
    }
    const config = asRecord(input.declaration.config)
    const declarationId = stringValue(input.declaration.id)
    const environment = stringValue(config.environment)
    const resolvedAuth = await credentialResolver.resolve({
      merchantOrigin: input.merchantOrigin,
      provider: input.provider,
      handlerName: input.handlerName,
      handlerId: input.handlerId,
      ...(declarationId ? { declarationId } : {}),
      declarationVersion: input.declaration.version,
      handlerSpecification: input.handlerSpecification,
      handlerSchema: input.handlerSchema,
      tokenizeEndpoint: tokenizeUrl,
      ...(environment ? { environment } : {})
    })
    if (!resolvedAuth) {
      throw new PaymentResultExchangeError(
        'payment_result_tokenizer_auth_missing',
        'Runtime tokenizer credentials are required for this merchant, handler, and /tokenize endpoint.'
      )
    }

    const credentialType = stringValue(config.credential_type)
    if (!credentialType) {
      throw new PaymentResultExchangeError(
        'payment_result_tokenizer_declaration_invalid',
        'Processor Tokenizer handler did not declare the handler-defined credential_type accepted by /tokenize.'
      )
    }
    const credentialReference = asRecord(input.result)
    if (!stringValue(credentialReference.reference)) {
      throw new PaymentResultExchangeError(
        'payment_result_shape_invalid',
        'Processor Tokenizer result must contain an opaque credential reference.'
      )
    }
    const identityConfig = asRecord(config.identity)
    const identityAccessToken = stringValue(identityConfig.access_token)
    if (Object.keys(identityConfig).length > 0 && !identityAccessToken) {
      throw new PaymentResultExchangeError(
        'payment_result_tokenizer_declaration_invalid',
        'Processor Tokenizer identity must contain access_token when identity is configured.'
      )
    }

    const response = await fetcher(tokenizeUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...(input.paymentActionId
          ? { 'Idempotency-Key': `${input.paymentActionId}:tokenize` }
          : {}),
        ...safeHeaders(resolvedAuth.headers)
      },
      body: JSON.stringify({
        credential: {
          ...credentialReference,
          type: credentialType
        },
        binding: {
          type: 'dev.ucp.shopping.checkout',
          id: input.checkout.id,
          merchant_origin: input.merchantOrigin,
          ...(input.checkoutSnapshotHash
            ? { snapshot_hash: input.checkoutSnapshotHash }
            : {}),
          ...(input.paymentActionId ? { action_id: input.paymentActionId } : {})
        },
        ...(identityAccessToken
          ? { identity: { access_token: identityAccessToken } }
          : {})
      }),
      redirect: 'manual'
    })

    if (!response.ok) {
      throw new PaymentResultExchangeError(
        'payment_result_tokenize_failed',
        'Processor Tokenizer rejected or failed the provider result exchange.',
        { httpStatus: response.status }
      )
    }

    const body = asRecord(await response.json() as unknown)
    const token = stringValue(body.token)
    const instrumentType = [...new Set(
      (input.declaration.available_instruments ?? [])
        .map((instrument) => stringValue(instrument.type))
        .filter((type): type is string => Boolean(type))
    )]
    if (!token || instrumentType.length !== 1) {
      throw new PaymentResultExchangeError(
        'payment_result_instrument_invalid',
        'Processor Tokenizer response must contain token and resolve to exactly one declared instrument type.'
      )
    }

    return {
      id: `pi_${stableHash({ handlerId: input.handlerId, checkoutId: input.checkout.id, token }).slice(7, 39)}`,
      handler_id: input.handlerId,
      type: instrumentType[0]!,
      selected: true,
      credential: {
        type: 'token',
        token
      }
    }
  }
})

export const exchangePaymentProviderResult = async ({
  provider,
  expectedHandlerId,
  result,
  businessProfile,
  checkout,
  merchantOrigin,
  credentialProvider = createHttpPaymentCredentialProvider(),
  handlerSpecs = [],
  paymentActionPayload,
  checkoutSnapshotHash,
  paymentActionId,
  trustedHostPaymentVerifier,
  trustedHostExpectedBinding
}: PaymentResultExchangeInput): Promise<PaymentResultExchangeOutput> => {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new PaymentResultExchangeError(
      'payment_result_missing',
      'Payment provider result is required.'
    )
  }

  assertNoRawCardFields(result)

  const expectedProvider = lower(provider)
  if (result.type === 'x402_payment_payload' || result.type === 'mpp_payment_credential') {
    const adapterKind = result.type === 'x402_payment_payload' ? 'x402' : 'mpp'
    const handlerName = adapterKind === 'x402' ? 'dev.arro.payment.x402' : 'dev.arro.payment.mpp'
    if (expectedProvider && expectedProvider !== handlerName) {
      throw new PaymentResultExchangeError(
        'payment_result_scope_invalid',
        `${adapterKind} result provider does not match the signed payment-action binding.`
      )
    }
    const handler = handlerDeclarationFrom({
      handlerName,
      ...(expectedHandlerId ? { expectedHandlerId } : {}),
      businessProfile,
      checkout
    })
    const matchedSpec = handler && handlerSpecs.find((candidate) =>
      candidate.adapterKind === adapterKind &&
      candidate.handlerName === handlerName &&
      candidate.versions.includes(handler.declaration.version) &&
      candidate.specification === handler.handlerSpecification &&
      candidate.schema === handler.handlerSchema
    )
    if (!handler || !matchedSpec || !paymentActionPayload || !checkoutSnapshotHash || !merchantOrigin) {
      throw new PaymentResultExchangeError(
        'payment_result_provider_unsupported',
        `${adapterKind} requires an exact merchant handler declaration and signed Checkout action binding.`
      )
    }
    try {
      const exchanged = exchangePortablePaymentResult({
        result,
        actionPayload: paymentActionPayload,
        handlerId: handler.handlerId,
        checkout,
        checkoutSnapshotHash,
        merchantOrigin
      })
      return {
        provider: handlerName,
        handlerName,
        handlerId: handler.handlerId,
        instrument: exchanged.instrument,
        resultFingerprint: exchanged.fingerprint
      }
    } catch (error) {
      if (error instanceof PortablePaymentError) {
        throw new PaymentResultExchangeError(
          error.code === 'portable_payment_capability_mismatch'
            ? 'payment_result_scope_invalid'
            : 'payment_result_shape_invalid',
          error.message
        )
      }
      throw error
    }
  }

  if (result.type === 'google_pay_payment_data') {
    assertGooglePayResultPresentation({ result, paymentActionPayload })
    const googlePayProvider = 'com.google.pay'
    if (expectedProvider && expectedProvider !== googlePayProvider) {
      throw new PaymentResultExchangeError(
        'payment_result_scope_invalid',
        'Google Pay result provider does not match the signed payment-action provider binding.',
        {
          expectedProvider,
          actualProvider: googlePayProvider
        }
      )
    }
    const handler = handlerDeclarationFrom({
      handlerName: googlePayProvider,
      ...(expectedHandlerId ? { expectedHandlerId } : {}),
      businessProfile,
      checkout
    })
    if (!handler) {
      throw new PaymentResultExchangeError(
        'payment_result_provider_unsupported',
        'No merchant-declared Google Pay UCP payment handler can accept this Google Pay payment data.',
        { provider: googlePayProvider }
      )
    }
    const matchedSpec = handlerSpecs.find((candidate) =>
      candidate.adapterKind === 'google_pay' &&
      candidate.handlerName === googlePayProvider &&
      candidate.versions.includes(handler.declaration.version) &&
      candidate.specification === handler.handlerSpecification &&
      candidate.schema === handler.handlerSchema
    )
    if (!matchedSpec) {
      throw new PaymentResultExchangeError(
        'payment_result_provider_unsupported',
        'Google Pay payment data requires an enabled official Google Pay UCP adapter for the exact merchant handler declaration.',
        {
          handlerId: handler.handlerId,
          spec: handler.handlerSpecification,
          schema: handler.handlerSchema
        }
      )
    }
    assertGooglePayHandlerIdentity({
      handlerName: googlePayProvider,
      versions: [handler.declaration.version],
      specification: handler.handlerSpecification,
      schema: handler.handlerSchema
    })
    normalizeGooglePayUcpConfig({
      config: handler.declaration.config,
      merchantOrigin: merchantOrigin ?? '',
      ...(matchedSpec.environment ? { expectedEnvironment: matchedSpec.environment } : {})
    })
    const instrument = googlePayInstrumentFromPaymentData({
      result,
      handlerId: handler.handlerId
    })
    if (!instrumentValidator.Check(instrument)) {
      throw new PaymentResultExchangeError(
        'payment_result_instrument_invalid',
        'Google Pay payment data could not be converted into a valid UCP payment instrument.',
        validationErrorSummary(instrumentValidator, instrument)
      )
    }
    return {
      provider: googlePayProvider,
      handlerName: googlePayProvider,
      handlerId: handler.handlerId,
      instrument,
      resultFingerprint: stableHash({
        provider: googlePayProvider,
        handlerId: handler.handlerId,
        paymentData: result.paymentData
      })
    }
  }

  if (result.type === 'trusted_host_attestation') {
    if (!trustedHostPaymentVerifier || !trustedHostExpectedBinding) {
      throw new PaymentResultExchangeError(
        'payment_result_provider_unsupported',
        'Trusted host payment capability attestations require a configured trusted host verifier, exact action binding, and opaque-reference redeemer before they can produce a UCP payment instrument.'
      )
    }
    if (expectedProvider && expectedProvider !== lower(trustedHostExpectedBinding.provider)) {
      throw new PaymentResultExchangeError(
        'payment_result_scope_invalid',
        'Trusted host result provider does not match the signed payment-action provider binding.',
        {
          expectedProvider,
          actualProvider: trustedHostExpectedBinding.provider
        }
      )
    }
    const redeemed = await trustedHostPaymentVerifier.verifyAndRedeem({
      attestation: result.attestation,
      expected: trustedHostExpectedBinding
    }).catch((error: unknown) => {
      if (error instanceof TrustedHostPaymentError) {
        const code: PaymentResultExchangeErrorCode =
          error.code === 'trusted_host_not_configured'
            ? 'payment_result_provider_unsupported'
            : error.code === 'trusted_host_attestation_replayed_or_mismatched'
              ? 'payment_result_scope_invalid'
              : error.code === 'trusted_host_reference_redeem_failed'
                ? 'payment_result_tokenize_failed'
                : error.code === 'trusted_host_instrument_invalid'
                  ? 'payment_result_instrument_invalid'
                  : 'payment_result_shape_invalid'
        throw new PaymentResultExchangeError(code, error.message, error.details)
      }
      throw error
    })

    if (!instrumentValidator.Check(redeemed.instrument)) {
      throw new PaymentResultExchangeError(
        'payment_result_instrument_invalid',
        'Trusted host redemption could not be converted into a UCP payment instrument.',
        validationErrorSummary(instrumentValidator, redeemed.instrument)
      )
    }
    if (redeemed.instrument.handler_id !== trustedHostExpectedBinding.expectedHandlerId) {
      throw new PaymentResultExchangeError(
        'payment_result_scope_invalid',
        'Trusted host payment instrument handler_id must equal the selected merchant payment-handler declaration id.',
        {
          instrumentHandlerId: redeemed.instrument.handler_id,
          expectedHandlerId: trustedHostExpectedBinding.expectedHandlerId
        }
      )
    }
    assertNonReusableScopedInstrument(
      redeemed.instrument,
      checkout,
      trustedHostExpectedBinding.merchantOrigin,
      defaultLifecyclePolicy
    )

    return {
      provider: redeemed.provider,
      handlerName: redeemed.handlerName,
      handlerId: redeemed.handlerId,
      instrument: redeemed.instrument,
      ...(redeemed.ap2CheckoutMandate ? { ap2CheckoutMandate: redeemed.ap2CheckoutMandate } : {}),
      resultFingerprint: redeemed.attestationHash
    }
  }

  const normalized = (() => {
    if (result.type === 'processor_tokenizer_result') {
      return {
        provider: result.provider.trim(),
        credentialReference: result.credentialReference
      }
    }
    if (result.type === 'stripe_payment_intent') {
      if (
        asRecord(paymentActionPayload).kind !== 'stripe_payment_sheet' ||
        !provider?.trim() ||
        !merchantOrigin ||
        !checkoutSnapshotHash ||
        !paymentActionId
      ) {
        throw new PaymentResultExchangeError(
          'payment_result_scope_invalid',
          'Stripe PaymentIntent result requires its exact signed native-payment action binding.'
        )
      }
      return {
        provider: provider.trim(),
        credentialReference: {
          reference: result.paymentIntentId
        }
      }
    }
    throw new PaymentResultExchangeError(
      'payment_result_shape_invalid',
      'Payment action result must use a supported discriminated provider envelope.'
    )
  })()

  if (normalized.provider === 'ap2' || normalized.provider === 'ap2_mandate') {
    throw new PaymentResultExchangeError(
      'payment_result_ap2_invalid',
      'AP2 checkout mandate exchange is not enabled in this Arro runtime. Use a merchant-hosted checkout or a tokenized UCP payment instrument.'
    )
  }

  if (expectedProvider && expectedProvider !== lower(normalized.provider)) {
    throw new PaymentResultExchangeError(
      'payment_result_scope_invalid',
      'Payment action result provider does not match the signed payment-action provider binding.',
      {
        expectedProvider,
        actualProvider: normalized.provider
      }
    )
  }
  const handler = handlerDeclarationFrom({
    handlerName: normalized.provider,
    ...(expectedHandlerId ? { expectedHandlerId } : {}),
    businessProfile,
    checkout
  })
  if (!handler) {
    throw new PaymentResultExchangeError(
      'payment_result_provider_unsupported',
      'No merchant-declared UCP payment handler can tokenize this provider result.',
      { provider: normalized.provider }
    )
  }
  assertProcessorTokenizerDeclaration(
    normalized.provider,
    handler.handlerId,
    handler.declaration,
    checkout,
    handlerSpecs
  )

  const instrument = await credentialProvider.tokenize({
    provider: normalized.provider,
    handlerName: handler.handlerName,
    handlerId: handler.handlerId,
    handlerSpecification: handler.handlerSpecification,
    handlerSchema: handler.handlerSchema,
    declaration: handler.declaration,
    result: normalized.credentialReference,
    checkout,
    businessProfile,
    merchantOrigin: merchantOrigin ?? '',
    ...(checkoutSnapshotHash ? { checkoutSnapshotHash } : {}),
    ...(paymentActionId ? { paymentActionId } : {})
  })

  if (!instrumentValidator.Check(instrument)) {
    throw new PaymentResultExchangeError(
      'payment_result_instrument_invalid',
      'Processor Tokenizer result could not be converted into a UCP payment instrument.',
      validationErrorSummary(instrumentValidator, instrument)
    )
  }
  if (instrument.handler_id !== handler.handlerId) {
    throw new PaymentResultExchangeError(
      'payment_result_scope_invalid',
      'Payment instrument handler_id must equal the selected merchant payment-handler declaration id.',
      { instrumentHandlerId: instrument.handler_id, expectedHandlerId: handler.handlerId }
    )
  }
  const processorCredential = asRecord(instrument.credential)
  if (processorCredential.reusable === true || processorCredential.reusable === 'true') {
    throw new PaymentResultExchangeError(
      'payment_result_reusable_token_rejected',
      'Processor Tokenizer returned a reusable credential. Arro accepts only one-time checkout credentials.'
    )
  }
  if (
    processorCredential.type !== 'token' ||
    !stringValue(processorCredential.token) ||
    !(handler.declaration.available_instruments ?? []).some((entry) => entry.type === instrument.type)
  ) {
    throw new PaymentResultExchangeError(
      'payment_result_instrument_invalid',
      'Processor Tokenizer must return a one-time token instrument of the exact merchant-declared type.'
    )
  }

  return {
    provider: normalized.provider,
    handlerName: handler.handlerName,
    handlerId: handler.handlerId,
    instrument,
    resultFingerprint: stableHash({
    provider: normalized.provider,
    handlerId: handler.handlerId,
    credentialReference: normalized.credentialReference
  })
  }
}
