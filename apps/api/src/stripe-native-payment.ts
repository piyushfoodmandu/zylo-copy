import type {
  StripePaymentActionSession,
  UcpCheckout,
  UcpPaymentHandlerDeclaration
} from '@arro/contracts'
import type {
  TokenizerCredentialResolver
} from './payment-result-exchange.ts'
import type { UcpPaymentActionRecord } from './ucp-checkout-store.ts'

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const stringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((entry) => stringValue(entry) ? [stringValue(entry)!] : [])
    : []

const paymentTotal = (checkout: UcpCheckout) =>
  checkout.totals.find((entry) => entry.type === 'total')

export const stripeNativeProcessorConfigFromValue = (value: unknown) => {
  const config = asRecord(value)
  const stripe = asRecord(config.stripe)
  const endpoints = asRecord(config.endpoints)
  return {
    environment: stringValue(config.environment)?.toUpperCase(),
    gateway: stringValue(config.gateway)?.toLowerCase(),
    credentialType: stringValue(config.credential_type),
    merchantInfo: asRecord(config.merchant_info),
    sessionUrl:
      stringValue(config.native_session_url) ??
      stringValue(config.nativeSessionUrl) ??
      stringValue(stripe.native_session_url) ??
      stringValue(stripe.nativeSessionUrl) ??
      stringValue(endpoints.native_session) ??
      stringValue(endpoints.nativeSession)
  }
}

export const stripeNativeSessionUrlFromDeclaration = (
  declaration: UcpPaymentHandlerDeclaration
) => stripeNativeProcessorConfigFromValue(declaration.config).sessionUrl

export const isStripeNativeProcessorHandler = (
  declaration: UcpPaymentHandlerDeclaration
) => {
  const { environment, gateway, credentialType, sessionUrl } =
    stripeNativeProcessorConfigFromValue(declaration.config)
  if (
    gateway !== 'stripe' ||
    environment !== 'PRODUCTION' ||
    credentialType !== 'stripe_payment_intent' ||
    !sessionUrl
  ) return false

  try {
    const url = new URL(sessionUrl)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

export class StripeNativePaymentError extends Error {
  readonly code:
    | 'stripe_native_handler_invalid'
    | 'stripe_native_auth_missing'
    | 'stripe_native_session_failed'
    | 'stripe_native_session_invalid'

  constructor(code: StripeNativePaymentError['code'], message: string) {
    super(message)
    this.name = 'StripeNativePaymentError'
    this.code = code
  }
}

export type StripeNativePaymentSessionInput = {
  action: UcpPaymentActionRecord
  checkout: UcpCheckout
  declaration: UcpPaymentHandlerDeclaration
}

export interface StripeNativePaymentSessionClient {
  create(input: StripeNativePaymentSessionInput): Promise<StripePaymentActionSession>
}

const responseValue = (
  body: Record<string, unknown>,
  snakeCase: string,
  camelCase: string
) => body[snakeCase] ?? body[camelCase]

const assertLiveSession = ({
  body,
  action,
  checkout
}: {
  body: Record<string, unknown>
  action: UcpPaymentActionRecord
  checkout: UcpCheckout
}): StripePaymentActionSession => {
  const total = paymentTotal(checkout)
  const provider = stringValue(body.provider)?.toLowerCase()
  const publishableKey = stringValue(responseValue(body, 'publishable_key', 'publishableKey'))
  const paymentIntentClientSecret = stringValue(
    responseValue(body, 'payment_intent_client_secret', 'paymentIntentClientSecret')
  )
  const paymentIntentId = stringValue(
    responseValue(body, 'payment_intent_id', 'paymentIntentId')
  )
  const stripeAccountId = stringValue(responseValue(body, 'stripe_account_id', 'stripeAccountId'))
  const merchantDisplayName = stringValue(
    responseValue(body, 'merchant_display_name', 'merchantDisplayName')
  )
  const merchantCountryCode = stringValue(
    responseValue(body, 'merchant_country_code', 'merchantCountryCode')
  )?.toUpperCase()
  const currency = stringValue(body.currency)?.toUpperCase()
  const amount = Number(body.amount)
  const captureMethod = stringValue(responseValue(body, 'capture_method', 'captureMethod'))
  const paymentMethodTypes = stringArray(
    responseValue(body, 'payment_method_types', 'paymentMethodTypes')
  )
  const expiresAt = stringValue(responseValue(body, 'expires_at', 'expiresAt'))
  const livemode = body.livemode

  const expiry = expiresAt ? Date.parse(expiresAt) : Number.NaN
  const actionExpiry = Date.parse(action.expiresAt)
  if (
    provider !== 'stripe' ||
    livemode !== true ||
    !publishableKey?.startsWith('pk_live_') ||
    !paymentIntentClientSecret ||
    !paymentIntentId ||
    !/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId) ||
    !paymentIntentClientSecret.startsWith(`${paymentIntentId}_secret_`) ||
    (stripeAccountId !== undefined && !/^acct_[A-Za-z0-9_]+$/.test(stripeAccountId)) ||
    !merchantDisplayName ||
    !merchantCountryCode ||
    !/^[A-Z]{2}$/.test(merchantCountryCode) ||
    !currency ||
    currency !== checkout.currency.toUpperCase() ||
    !total ||
    !Number.isInteger(amount) ||
    amount !== total.amount ||
    amount <= 0 ||
    captureMethod !== 'manual' ||
    paymentMethodTypes.length !== 1 ||
    paymentMethodTypes[0] !== 'card' ||
    !expiresAt ||
    !Number.isFinite(expiry) ||
    expiry <= Date.now() ||
    expiry > actionExpiry
  ) {
    throw new StripeNativePaymentError(
      'stripe_native_session_invalid',
      'Merchant returned an invalid live Stripe PaymentSheet session for this checkout.'
    )
  }

  return {
    provider: 'stripe',
    livemode: true,
    publishableKey,
    paymentIntentClientSecret,
    paymentIntentId,
    ...(stripeAccountId ? { stripeAccountId } : {}),
    merchantDisplayName,
    merchantCountryCode,
    currency,
    amount,
    captureMethod: 'manual',
    paymentMethodTypes: ['card'],
    allowedCardBrands: ['visa', 'mastercard'],
    expiresAt
  }
}

export const createHttpStripeNativePaymentSessionClient = ({
  fetch: fetcher = fetch,
  credentialResolver
}: {
  fetch?: typeof fetch
  credentialResolver: TokenizerCredentialResolver
}): StripeNativePaymentSessionClient => ({
  async create({ action, checkout, declaration }) {
    if (!isStripeNativeProcessorHandler(declaration)) {
      throw new StripeNativePaymentError(
        'stripe_native_handler_invalid',
        'Merchant did not declare a production Stripe native-payment session contract.'
      )
    }
    const sessionUrl = stripeNativeSessionUrlFromDeclaration(declaration)!
    const { merchantInfo } = stripeNativeProcessorConfigFromValue(declaration.config)
    const auth = await credentialResolver.resolve({
      merchantOrigin: action.merchantOrigin,
      provider: action.provider,
      handlerName: action.handlerName,
      handlerId: action.handlerId,
      ...(declaration.id ? { declarationId: declaration.id } : {}),
      declarationVersion: declaration.version,
      handlerSpecification: action.handlerSpecification ?? declaration.spec ?? '',
      handlerSchema: action.handlerSchema ?? declaration.schema ?? '',
      tokenizeEndpoint: sessionUrl,
      environment: 'PRODUCTION'
    })
    if (!auth) {
      throw new StripeNativePaymentError(
        'stripe_native_auth_missing',
        'Runtime credentials are missing for this merchant Stripe session endpoint.'
      )
    }

    const total = paymentTotal(checkout)
    if (!total || total.amount <= 0) {
      throw new StripeNativePaymentError(
        'stripe_native_handler_invalid',
        'Stripe native payment requires a positive final checkout total.'
      )
    }
    const response = await fetcher(sessionUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Idempotency-Key': `${action.actionId}:stripe-session`,
        ...auth.headers
      },
      body: JSON.stringify({
        provider: 'stripe',
        environment: 'PRODUCTION',
        binding: {
          type: 'dev.ucp.shopping.checkout',
          id: checkout.id,
          snapshot_hash: action.checkoutSnapshotHash,
          action_id: action.actionId,
          merchant_origin: action.merchantOrigin
        },
        amount: total.amount,
        currency: checkout.currency,
        capture_method: 'manual',
        payment_method_types: ['card'],
        allowed_card_brands: ['visa', 'mastercard'],
        expires_at: action.expiresAt,
        return_url: 'arro://checkout',
        merchant: merchantInfo
      })
    }).catch(() => {
      throw new StripeNativePaymentError(
        'stripe_native_session_failed',
        'Merchant could not create a live Stripe payment session.'
      )
    })
    if (!response.ok) {
      throw new StripeNativePaymentError(
        'stripe_native_session_failed',
        'Merchant could not create a live Stripe payment session.'
      )
    }
    const body = await response.json().catch(() => {
      throw new StripeNativePaymentError(
        'stripe_native_session_invalid',
        'Merchant returned an invalid live Stripe PaymentSheet session for this checkout.'
      )
    })
    return assertLiveSession({ body: asRecord(body), action, checkout })
  }
})
