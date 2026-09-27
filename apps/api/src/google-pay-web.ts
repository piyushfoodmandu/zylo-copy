export const GOOGLE_PAY_HANDLER_NAME = 'com.google.pay'
export const GOOGLE_PAY_HANDLER_VERSION = '2026-01-23'
export const GOOGLE_PAY_HANDLER_SPEC = 'https://pay.google.com/gp/p/ucp/2026-01-23/'
export const GOOGLE_PAY_HANDLER_SCHEMA = 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json'

export type GooglePayWebConfig = {
  apiVersion: 2
  apiVersionMinor: 0
  environment: 'TEST' | 'PRODUCTION'
  merchantInfo: {
    merchantId: string
    merchantName?: string
  }
  allowedPaymentMethods: Array<{
    type: 'CARD'
    parameters: Record<string, unknown>
    tokenizationSpecification: {
      type: 'PAYMENT_GATEWAY' | 'DIRECT'
      parameters: Record<string, unknown>
    }
  }>
}

export class GooglePayWebConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GooglePayWebConfigError'
  }
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const stringValue = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined
const stringArray = (value: unknown) => Array.isArray(value)
  ? value.flatMap((entry) => stringValue(entry) ? [stringValue(entry)!] : [])
  : []

const GOOGLE_PAY_CARD_NETWORKS = new Set([
  'AMEX',
  'DISCOVER',
  'ELECTRON',
  'ELO',
  'ELO_DEBIT',
  'INTERAC',
  'JCB',
  'MAESTRO',
  'MASTERCARD',
  'VISA'
])

const hasOnlyKeys = (value: Record<string, unknown>, allowed: ReadonlySet<string>) =>
  Object.keys(value).every((key) => allowed.has(key))

const GOOGLE_PAY_CARD_PARAMETER_KEYS = new Set([
  'allowed_auth_methods',
  'allowed_card_networks',
  'allow_prepaid_cards',
  'allow_credit_cards',
  'assurance_details_required',
  'billing_address_required',
  'billing_address_parameters'
])

const GOOGLE_PAY_BILLING_PARAMETER_KEYS = new Set([
  'format',
  'phone_number_required'
])

const merchantHostname = (merchantOrigin: string) => {
  try {
    return new URL(merchantOrigin).hostname.toLowerCase()
  } catch {
    throw new GooglePayWebConfigError('Google Pay merchant origin must be an absolute HTTPS origin.')
  }
}

const optionalBoolean = (value: unknown) => typeof value === 'boolean' ? value : undefined

export const assertGooglePayHandlerIdentity = ({
  handlerName,
  versions,
  specification,
  schema
}: {
  handlerName: string
  versions: string[]
  specification: string
  schema: string
}) => {
  if (
    handlerName !== GOOGLE_PAY_HANDLER_NAME ||
    versions.length !== 1 ||
    versions[0] !== GOOGLE_PAY_HANDLER_VERSION ||
    specification !== GOOGLE_PAY_HANDLER_SPEC ||
    schema !== GOOGLE_PAY_HANDLER_SCHEMA
  ) {
    throw new GooglePayWebConfigError(
      'Google Pay must use the exact com.google.pay 2026-01-23 UCP handler specification and schema.'
    )
  }
}

export const normalizeGooglePayUcpConfig = ({
  config,
  merchantOrigin,
  expectedEnvironment
}: {
  config: unknown
  merchantOrigin: string
  expectedEnvironment?: string
}): GooglePayWebConfig => {
  const record = asRecord(config)
  if (record.api_version !== 2 || record.api_version_minor !== 0) {
    throw new GooglePayWebConfigError('Google Pay UCP config must declare api_version 2 and api_version_minor 0.')
  }
  const environment = stringValue(record.environment)
  if ((environment !== 'TEST' && environment !== 'PRODUCTION') || (expectedEnvironment && environment !== expectedEnvironment)) {
    throw new GooglePayWebConfigError('Google Pay UCP config environment must exactly match the enabled TEST or PRODUCTION route.')
  }
  const merchant = asRecord(record.merchant_info)
  const merchantId = stringValue(merchant.merchant_id)
  const merchantName = stringValue(merchant.merchant_name)
  const declaredOrigin = stringValue(merchant.merchant_origin)?.toLowerCase()
  if (!merchantId) {
    throw new GooglePayWebConfigError('Google Pay UCP config requires merchant_info.merchant_id.')
  }
  if (!/^[0-9a-zA-Z]+$/.test(merchantId)) {
    throw new GooglePayWebConfigError('Google Pay merchant_id must use the official alphanumeric handler format.')
  }
  if (declaredOrigin && (
    declaredOrigin.length > 253 ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(declaredOrigin)
  )) {
    throw new GooglePayWebConfigError('Google Pay merchant_origin must be a hostname, without a scheme, port, path, query, or fragment.')
  }
  if (declaredOrigin && declaredOrigin !== merchantHostname(merchantOrigin)) {
    throw new GooglePayWebConfigError('Google Pay merchant_origin does not match the active merchant Checkout origin.')
  }

  const methods = Array.isArray(record.allowed_payment_methods) ? record.allowed_payment_methods : []
  if (methods.length === 0) {
    throw new GooglePayWebConfigError('Google Pay UCP config requires at least one allowed_payment_methods entry.')
  }
  const allowedPaymentMethods = methods.map((entry, index) => {
    const method = asRecord(entry)
    if (method.type !== 'CARD') {
      throw new GooglePayWebConfigError(`Google Pay allowed_payment_methods[${index}] must use CARD.`)
    }
    const parameters = asRecord(method.parameters)
    const allowedAuthMethods = stringArray(parameters.allowed_auth_methods)
    const allowedCardNetworks = stringArray(parameters.allowed_card_networks)
    if (!hasOnlyKeys(parameters, GOOGLE_PAY_CARD_PARAMETER_KEYS)) {
      throw new GooglePayWebConfigError(`Google Pay allowed_payment_methods[${index}].parameters contains a field outside the official handler schema.`)
    }
    if (allowedAuthMethods.length === 0 || allowedAuthMethods.some((method) => method !== 'PAN_ONLY')) {
      throw new GooglePayWebConfigError(`Google Pay allowed_payment_methods[${index}] supports only PAN_ONLY in the 2026-01-23 UCP handler.`)
    }
    if (allowedCardNetworks.length === 0 || allowedCardNetworks.some((network) => !GOOGLE_PAY_CARD_NETWORKS.has(network))) {
      throw new GooglePayWebConfigError(`Google Pay allowed_payment_methods[${index}] contains an unsupported card network.`)
    }
    const tokenization = asRecord(method.tokenization_specification)
    const tokenizationType = stringValue(tokenization.type)
    const tokenizationParameters = asRecord(tokenization.parameters)
    if (tokenizationType !== 'PAYMENT_GATEWAY' && tokenizationType !== 'DIRECT') {
      throw new GooglePayWebConfigError(`Google Pay allowed_payment_methods[${index}] requires PAYMENT_GATEWAY or DIRECT tokenization.`)
    }
    const normalizedTokenizationType: 'PAYMENT_GATEWAY' | 'DIRECT' = tokenizationType
    const allowPrepaidCards = optionalBoolean(parameters.allow_prepaid_cards)
    const allowCreditCards = optionalBoolean(parameters.allow_credit_cards)
    const assuranceDetailsRequired = optionalBoolean(parameters.assurance_details_required)
    const billingAddressRequired = optionalBoolean(parameters.billing_address_required)
    const billing = asRecord(parameters.billing_address_parameters)
    const phoneNumberRequired = optionalBoolean(billing.phone_number_required)
    const billingFormat = stringValue(billing.format)
    if (!hasOnlyKeys(billing, GOOGLE_PAY_BILLING_PARAMETER_KEYS)) {
      throw new GooglePayWebConfigError(`Google Pay allowed_payment_methods[${index}].billing_address_parameters contains a field outside the official handler schema.`)
    }
    if (billingFormat && billingFormat !== 'MIN' && billingFormat !== 'FULL' && billingFormat !== 'FULL-ISO3166') {
      throw new GooglePayWebConfigError(`Google Pay allowed_payment_methods[${index}] contains an unsupported billing address format.`)
    }
    if (tokenizationType === 'PAYMENT_GATEWAY' && !stringValue(tokenizationParameters.gateway)) {
      throw new GooglePayWebConfigError(`Google Pay allowed_payment_methods[${index}] gateway tokenization requires gateway.`)
    }
    if (tokenizationType === 'DIRECT' && (
      stringValue(tokenizationParameters.protocolVersion) !== 'ECv2' ||
      !stringValue(tokenizationParameters.publicKey)
    )) {
      throw new GooglePayWebConfigError(`Google Pay allowed_payment_methods[${index}] direct tokenization requires ECv2 and publicKey.`)
    }
    return {
      type: 'CARD' as const,
      parameters: {
        allowedAuthMethods,
        allowedCardNetworks,
        ...(allowPrepaidCards !== undefined ? { allowPrepaidCards } : {}),
        ...(allowCreditCards !== undefined ? { allowCreditCards } : {}),
        ...(assuranceDetailsRequired !== undefined ? { assuranceDetailsRequired } : {}),
        ...(billingAddressRequired !== undefined ? { billingAddressRequired } : {}),
        ...(Object.keys(billing).length > 0
          ? {
              billingAddressParameters: {
                ...(billingFormat ? { format: billingFormat } : {}),
                ...(phoneNumberRequired !== undefined ? { phoneNumberRequired } : {})
              }
            }
          : {})
      },
      tokenizationSpecification: {
        type: normalizedTokenizationType,
        parameters: tokenizationParameters
      }
    }
  })

  return {
    apiVersion: 2,
    apiVersionMinor: 0,
    environment,
    merchantInfo: {
      merchantId,
      ...(merchantName ? { merchantName } : {})
    },
    allowedPaymentMethods
  }
}
