import type {
  PurchasePaymentActionResponse,
  PurchasePaymentActionResult
} from '../types/purchase'

type JsonObject = Record<string, unknown>

export type MerchantGooglePayPaymentRequest = JsonObject & {
  apiVersion: number
  apiVersionMinor: number
  /** Handler environment is validated by Arro but is not a PaymentDataRequest field. */
  environment: 'TEST' | 'PRODUCTION'
  allowedPaymentMethods: JsonObject[]
  merchantInfo: JsonObject & {
    merchantName?: string
  }
  transactionInfo: JsonObject & {
    totalPriceStatus: 'FINAL'
    totalPrice: string
    currencyCode: string
    countryCode?: string
  }
}

export type NativeGooglePayPresentation =
  | { status: 'approved'; paymentData: unknown }
  | { status: 'canceled' }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; message: string }

export type NativeGooglePayPreparation =
  | {
      status: 'ready'
      /** Presents the exact PaymentRequest instance that passed preflight. */
      present(): Promise<NativeGooglePayPresentation>
    }
  | { status: 'unavailable'; reason: string }

export type NativeGooglePayAdapter = {
  environment: 'TEST' | 'PRODUCTION'
  /** Checks wallet readiness without presenting any payment UI. */
  prepare(request: MerchantGooglePayPaymentRequest): Promise<NativeGooglePayPreparation>
}

type GooglePayResult = Extract<PurchasePaymentActionResult, { type: 'google_pay_payment_data' }>

type PaymentRequestLike = {
  canMakePayment(): Promise<boolean>
  show(): Promise<unknown>
}

export type GooglePayPaymentRequestConstructor = new (
  methodData: Array<{
    supportedMethods: 'google_pay'
    data: Omit<MerchantGooglePayPaymentRequest, 'environment'>
  }>,
  details: {
    total: {
      label: string
      amount: { currency: string; value: string }
    }
  }
) => PaymentRequestLike

const asRecord = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : undefined

const nonEmptyString = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value : undefined

const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((entry) => nonEmptyString(entry))

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

const currencyFractionDigits = (currency: string) => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency
    }).resolvedOptions().maximumFractionDigits
  } catch {
    return undefined
  }
}

const decimalToMinor = (value: string, currency: string) => {
  if (!/^\d+(?:\.\d+)?$/.test(value)) return undefined
  const fractionDigits = currencyFractionDigits(currency)
  if (fractionDigits === undefined) return undefined
  const [major = '0', fraction = ''] = value.split('.')
  if (fraction.length > fractionDigits) return undefined
  const digits = `${major}${fraction.padEnd(fractionDigits, '0')}`.replace(/^0+(?=\d)/, '')
  const amount = Number.parseInt(digits || '0', 10)
  return Number.isSafeInteger(amount) ? amount : undefined
}

const validPaymentMethod = (value: unknown) => {
  const method = asRecord(value)
  const parameters = asRecord(method?.parameters)
  const allowedAuthMethods = parameters?.allowedAuthMethods
  const allowedCardNetworks = parameters?.allowedCardNetworks
  const tokenization = asRecord(method?.tokenizationSpecification)
  const tokenizationParameters = asRecord(tokenization?.parameters)
  const tokenizationType = tokenization?.type

  if (
    method?.type !== 'CARD' ||
    !stringArray(allowedAuthMethods) ||
    allowedAuthMethods.some((method) => method !== 'PAN_ONLY') ||
    !stringArray(allowedCardNetworks) ||
    allowedCardNetworks.some((network) => !GOOGLE_PAY_CARD_NETWORKS.has(network)) ||
    tokenizationType !== 'PAYMENT_GATEWAY' ||
    !tokenizationParameters
  ) {
    return false
  }

  // The official React Native module's generated Android request contract is
  // gateway-tokenization only. DIRECT requests therefore downscope to the
  // merchant rather than crossing the native boundary through an unsafe cast.
  return Boolean(
    nonEmptyString(tokenizationParameters.gateway) &&
    nonEmptyString(tokenizationParameters.gatewayMerchantId)
  )
}

export type GooglePayActionRequest =
  | { ok: true; request: MerchantGooglePayPaymentRequest }
  | { ok: false; reason: string }

/**
 * Accept only the complete Google Pay request delivered by the merchant-bound
 * payment action. Nothing here invents a gateway, card network, country or
 * total: missing or contradictory fields make native presentation unavailable.
 */
export const googlePayRequestFromAction = (
  action: PurchasePaymentActionResponse,
  expectedEnvironment: NativeGooglePayAdapter['environment']
): GooglePayActionRequest => {
  const payload = asRecord(action.action)
  const request = asRecord(payload?.paymentRequest)
  const merchantInfo = asRecord(request?.merchantInfo)
  const transactionInfo = asRecord(request?.transactionInfo)
  const currencyCode = nonEmptyString(transactionInfo?.currencyCode)
  const countryCode = nonEmptyString(transactionInfo?.countryCode)
  const totalPrice = nonEmptyString(transactionInfo?.totalPrice)
  const environment = request?.environment
  const actionAmount = action.amount

  if (
    payload?.kind !== 'google_pay' ||
    (payload.presentation !== undefined && payload.presentation !== action.presentation)
  ) {
    return { ok: false, reason: 'The Google Pay payload does not match this payment action.' }
  }
  if (
    !request ||
    request.apiVersion !== 2 ||
    request.apiVersionMinor !== 0 ||
    (environment !== 'TEST' && environment !== 'PRODUCTION') ||
    environment !== expectedEnvironment
  ) {
    return { ok: false, reason: 'The merchant Google Pay request does not match this app build environment.' }
  }
  if (!merchantInfo || !nonEmptyString(merchantInfo.merchantId)) {
    return { ok: false, reason: 'The merchant did not provide its Google Pay merchant ID.' }
  }
  if (
    !Array.isArray(request.allowedPaymentMethods) ||
    request.allowedPaymentMethods.length === 0 ||
    !request.allowedPaymentMethods.every(validPaymentMethod)
  ) {
    return { ok: false, reason: 'The merchant did not provide executable Google Pay payment methods.' }
  }
  if (
    !transactionInfo ||
    transactionInfo.totalPriceStatus !== 'FINAL' ||
    !totalPrice ||
    !currencyCode ||
    !/^[A-Z]{3}$/.test(currencyCode) ||
    (countryCode !== undefined && !/^[A-Z]{2}$/.test(countryCode))
  ) {
    return { ok: false, reason: 'The merchant did not provide a valid final total and currency for Google Pay.' }
  }
  if (
    typeof actionAmount !== 'number' ||
    !Number.isSafeInteger(actionAmount) ||
    actionAmount < 0 ||
    action.currency !== currencyCode ||
    decimalToMinor(totalPrice, currencyCode) !== actionAmount
  ) {
    return { ok: false, reason: 'The Google Pay total does not match this signed payment action.' }
  }

  // Clone so mutation cannot alter the signed action retained in app state.
  // The adapter removes `environment` only at the final Android SDK boundary.
  return {
    ok: true,
    request: JSON.parse(JSON.stringify(request)) as MerchantGooglePayPaymentRequest
  }
}

const jsonValue = (value: unknown): boolean => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return true
  }
  if (Array.isArray(value)) return value.every(jsonValue)
  const record = asRecord(value)
  return record ? Object.values(record).every(jsonValue) : false
}

export type GooglePayResultParse =
  | { ok: true; result: GooglePayResult }
  | { ok: false; reason: string }

/**
 * Convert the native SDK response into the deliberately narrow public result
 * contract. The checkout-scoped token is forwarded once; unexpected native
 * fields never cross the API boundary.
 */
export const googlePayResultFromPaymentData = (paymentData: unknown): GooglePayResultParse => {
  const data = asRecord(paymentData)
  const method = asRecord(data?.paymentMethodData)
  const tokenization = asRecord(method?.tokenizationData)
  const tokenizationType = tokenization?.type
  const token = nonEmptyString(tokenization?.token)

  if (
    !data ||
    data.apiVersion !== 2 ||
    data.apiVersionMinor !== 0 ||
    method?.type !== 'CARD' ||
    (tokenizationType !== 'PAYMENT_GATEWAY' && tokenizationType !== 'DIRECT') ||
    !token
  ) {
    return { ok: false, reason: 'Google Pay returned incomplete payment data.' }
  }

  const info = asRecord(method.info)
  const cardNetwork = nonEmptyString(info?.cardNetwork)
  const cardDetails = nonEmptyString(info?.cardDetails)
  const normalizedInfo = info
    ? {
        ...(cardNetwork ? { cardNetwork } : {}),
        ...(cardDetails ? { cardDetails } : {}),
        ...(asRecord(info.assuranceDetails) && jsonValue(info.assuranceDetails)
          ? { assuranceDetails: info.assuranceDetails }
          : {}),
        ...(asRecord(info.billingAddress) && jsonValue(info.billingAddress)
          ? { billingAddress: info.billingAddress }
          : {})
      }
    : undefined
  const shippingAddress = asRecord(data.shippingAddress)
  const email = nonEmptyString(data.email)
  const description = nonEmptyString(method.description)

  return {
    ok: true,
    result: {
      type: 'google_pay_payment_data',
      source: 'native',
      paymentData: {
        apiVersion: data.apiVersion as number,
        apiVersionMinor: data.apiVersionMinor as number,
        paymentMethodData: {
          type: 'CARD',
          ...(description ? { description } : {}),
          ...(normalizedInfo ? { info: normalizedInfo } : {}),
          tokenizationData: {
            type: tokenizationType,
            token
          }
        },
        ...(email ? { email } : {}),
        ...(shippingAddress && jsonValue(shippingAddress) ? { shippingAddress } : {})
      }
    } as GooglePayResult
  }
}

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.trim() ? error.message : fallback

const isCancellationError = (error: unknown) => {
  const record = asRecord(error)
  const code = nonEmptyString(record?.code)?.toUpperCase()
  return code === 'CANCELED' || code === 'CANCELLED' || code === 'USER_CANCELED' || code === 'USER_CANCELLED'
}

/** Creates the adapter around Google's official W3C PaymentRequest facade. */
export const createNativeGooglePayAdapter = (
  PaymentRequest: GooglePayPaymentRequestConstructor,
  environment: NativeGooglePayAdapter['environment']
): NativeGooglePayAdapter => ({
  environment,
  async prepare(request) {
    if (request.environment !== environment) {
      return {
        status: 'unavailable',
        reason: 'The merchant Google Pay environment does not match this app build.'
      }
    }
    let paymentRequest: PaymentRequestLike
    try {
      // Defense in depth for direct adapter callers: Google Pay's Android
      // PaymentDataRequest does not contain the handler-level environment.
      const { environment: _environment, ...nativeRequest } = request
      paymentRequest = new PaymentRequest(
        [{ supportedMethods: 'google_pay', data: nativeRequest }],
        {
          total: {
            label: request.merchantInfo.merchantName || 'Merchant',
            amount: {
              currency: request.transactionInfo.currencyCode,
              value: request.transactionInfo.totalPrice
            }
          }
        }
      )
    } catch (error) {
      return {
        status: 'unavailable',
        reason: errorMessage(error, 'Google Pay could not be initialized on this device.')
      }
    }

    try {
      if (!await paymentRequest.canMakePayment()) {
        return { status: 'unavailable', reason: 'Google Pay is not ready on this device.' }
      }
    } catch (error) {
      return {
        status: 'unavailable',
        reason: errorMessage(error, 'Google Pay readiness could not be determined.')
      }
    }

    return {
      status: 'ready',
      async present() {
        try {
          // The native module intentionally resolves `null` when the user closes
          // the sheet even though its published declaration says otherwise.
          const paymentData = await paymentRequest.show()
          return paymentData === null || paymentData === undefined
            ? { status: 'canceled' }
            : { status: 'approved', paymentData }
        } catch (error) {
          if (isCancellationError(error)) return { status: 'canceled' }
          return {
            status: 'failed',
            message: errorMessage(error, 'Google Pay could not finish this payment step.')
          }
        }
      }
    }
  }
})
