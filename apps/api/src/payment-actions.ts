import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type {
  AgentPaymentPresentationSurface,
  PortablePaymentCapability,
  PurchasePaymentActionResponse,
  PurchasePaymentPreference,
  UcpCheckout
} from '@arro/contracts'
import type { CommercePrincipal } from './commerce-principal.ts'
import { stableJsonStringify } from './stable-json.ts'
import type {
  UcpCheckoutSessionRecord,
  UcpPaymentActionRecord
} from './ucp-checkout-store.ts'
import { googlePayTransactionInfoFromCheckout } from './google-pay-transaction.ts'
import { normalizeGooglePayUcpConfig } from './google-pay-web.ts'
import { stripeNativeProcessorConfigFromValue } from './stripe-native-payment.ts'

export type PaymentActionTokenPayload = {
  v: 1
  actionId: string
  transactionId: string
  integrationId: string
  ownerKeyId?: string
  ownerPrincipalHash?: string
  externalSubjectRefHash?: string
  externalTaskRefHash?: string
  agentSessionId?: string
  merchantOrigin: string
  checkoutId: string
  checkoutSnapshotHash: string
  handlerId: string
  handlerName: string
  handlerVersion?: string
  handlerSpecification?: string
  handlerSchema?: string
  provider: string
  capabilityId?: string
  amount?: number
  currency?: string
  expiresAt: string
  nonce: string
}

export class PaymentActionTokenError extends Error {
  readonly code:
    | 'payment_action_secret_required'
    | 'payment_action_token_invalid'
    | 'payment_action_token_expired'

  constructor(code: PaymentActionTokenError['code'], message: string) {
    super(message)
    this.name = 'PaymentActionTokenError'
    this.code = code
  }
}

export const paymentActionTokenPrefix = 'arro_pa1_'
export const paymentActionIdPrefix = 'arro_pa_'

export const paymentActionAmount = (checkout: UcpCheckout) =>
  checkout.totals.find((entry) => entry.type === 'total')?.amount

const base64url = (value: Buffer | string) =>
  Buffer.from(value).toString('base64url')

const fromBase64url = (value: string) =>
  Buffer.from(value, 'base64url').toString('utf8')

export const paymentActionNonceHash = (nonce: string) =>
  `sha256:${createHash('sha256').update(nonce, 'utf8').digest('hex')}`

const signatureFor = (encodedPayload: string, secret: string) =>
  createHmac('sha256', secret).update(encodedPayload, 'utf8').digest('base64url')

export const signPaymentActionToken = (
  payload: PaymentActionTokenPayload,
  secret: string | undefined
) => {
  if (!secret) {
    throw new PaymentActionTokenError(
      'payment_action_secret_required',
      'PAYMENT_ACTION_SIGNING_SECRET is required before Arro can issue payment actions.'
    )
  }
  const encodedPayload = base64url(stableJsonStringify(payload))
  return `${paymentActionTokenPrefix}${encodedPayload}.${signatureFor(encodedPayload, secret)}`
}

export const verifyPaymentActionToken = (
  token: string,
  secret: string | undefined,
  now = new Date()
): PaymentActionTokenPayload => {
  if (!secret) {
    throw new PaymentActionTokenError(
      'payment_action_secret_required',
      'PAYMENT_ACTION_SIGNING_SECRET is required before Arro can verify payment actions.'
    )
  }
  const normalized = token.trim()
  if (!normalized.startsWith(paymentActionTokenPrefix)) {
    throw new PaymentActionTokenError('payment_action_token_invalid', 'Payment action token is malformed.')
  }
  const [encodedPayload, signature] = normalized.slice(paymentActionTokenPrefix.length).split('.')
  if (!encodedPayload || !signature) {
    throw new PaymentActionTokenError('payment_action_token_invalid', 'Payment action token is malformed.')
  }
  const expected = signatureFor(encodedPayload, secret)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new PaymentActionTokenError('payment_action_token_invalid', 'Payment action token signature is invalid.')
  }
  const payload = JSON.parse(fromBase64url(encodedPayload)) as PaymentActionTokenPayload
  if (payload.v !== 1 || !payload.actionId || !payload.transactionId || !payload.nonce) {
    throw new PaymentActionTokenError('payment_action_token_invalid', 'Payment action token payload is invalid.')
  }
  if (new Date(payload.expiresAt).getTime() <= now.getTime()) {
    throw new PaymentActionTokenError('payment_action_token_expired', 'Payment action token has expired.')
  }
  return payload
}

export const principalFromPaymentActionPayload = (
  payload: PaymentActionTokenPayload
): CommercePrincipal => ({
  keyId: payload.ownerKeyId ?? 'payment-action-token',
  ownerPrincipal: `payment-action:${payload.actionId}`,
  ownerPrincipalHash: payload.ownerPrincipalHash ?? paymentActionNonceHash(payload.actionId),
  integrationId: payload.integrationId,
  ...(payload.externalSubjectRefHash ? { externalSubjectRefHash: payload.externalSubjectRefHash } : {}),
  ...(payload.externalTaskRefHash ? { externalTaskRefHash: payload.externalTaskRefHash } : {}),
  ...(payload.agentSessionId ? { agentSessionId: payload.agentSessionId } : {})
})

export const assertPaymentActionTokenMatchesRecord = (
  payload: PaymentActionTokenPayload,
  action: UcpPaymentActionRecord
) => {
  const expectedNonceHash = paymentActionNonceHash(payload.nonce)
  const mismatched =
    payload.actionId !== action.actionId ||
    payload.transactionId !== action.transactionId ||
    payload.integrationId !== action.integrationId ||
    payload.merchantOrigin !== action.merchantOrigin ||
    payload.checkoutId !== action.checkoutId ||
    payload.checkoutSnapshotHash !== action.checkoutSnapshotHash ||
    payload.handlerId !== action.handlerId ||
    payload.handlerName !== action.handlerName ||
    (action.handlerVersion ? payload.handlerVersion !== action.handlerVersion : false) ||
    (action.handlerSpecification ? payload.handlerSpecification !== action.handlerSpecification : false) ||
    (action.handlerSchema ? payload.handlerSchema !== action.handlerSchema : false) ||
    payload.provider !== action.provider ||
    expectedNonceHash !== action.tokenNonceHash

  if (mismatched) {
    throw new PaymentActionTokenError(
      'payment_action_token_invalid',
      'Payment action token no longer matches the stored action binding.'
    )
  }
}

const displayFromPreference = (preference: PurchasePaymentPreference | undefined) =>
  preference?.capabilityId
    ? { label: preference.capabilityId }
    : undefined

export const paymentActionPayloadForRoute = ({
  actionType,
  checkout,
  handlerId,
  handlerName,
  handlerVersion,
  handlerSpecification,
  handlerSchema,
  handlerConfig,
  provider,
  presentation,
  preference,
  returnUrl,
  merchantOrigin,
  portableChallenge
}: {
  actionType: UcpPaymentActionRecord['actionType']
  checkout: UcpCheckout
  handlerId: string
  handlerName: string
  handlerVersion?: string
  handlerSpecification?: string
  handlerSchema?: string
  handlerConfig?: Record<string, unknown>
  provider: string
  presentation?: AgentPaymentPresentationSurface
  preference?: PurchasePaymentPreference
  returnUrl?: string
  merchantOrigin: string
  portableChallenge?: {
    protocol: 'x402' | 'mpp'
    version: string
    challengeUrl: string
    expiresAt: string
    challenge: Record<string, unknown>
    capability: PortablePaymentCapability
  }
}): Record<string, unknown> => {
  const amount = paymentActionAmount(checkout)
  if (actionType === 'x402' || actionType === 'mpp') {
    if (!portableChallenge || portableChallenge.protocol !== actionType) {
      throw new Error(`Portable ${actionType} payment action requires an exact merchant challenge.`)
    }
    return {
      kind: 'portable_payment_action',
      protocol: portableChallenge.protocol,
      version: portableChallenge.version,
      provider,
      checkoutId: checkout.id,
      amount,
      currency: checkout.currency,
      challengeUrl: portableChallenge.challengeUrl,
      expiresAt: portableChallenge.expiresAt,
      challenge: portableChallenge.challenge,
      capability: portableChallenge.capability,
      credentialHeader: actionType === 'x402' ? 'PAYMENT-SIGNATURE' : 'Authorization: Payment',
      instruction: actionType === 'x402'
        ? 'Create one x402 v2 PaymentPayload for an accepted merchant requirement and submit it to this signed action. Arro does not sign, settle, or custody wallet funds.'
        : 'Create one MPP Payment authorization credential that echoes the exact challenge and submit it to this signed action. Arro does not log or persist the bearer credential in Postgres.'
    }
  }
  if (actionType === 'google_pay') {
    const paymentRequest = normalizeGooglePayUcpConfig({
      config: handlerConfig,
      merchantOrigin
    })
    const transactionInfo = googlePayTransactionInfoFromCheckout(checkout)
    if (!transactionInfo) {
      throw new Error('Google Pay action requires a safe total in the Checkout currency.')
    }
    const countryCode = transactionInfo.countryCode
    return {
      kind: 'google_pay',
      merchantOrigin,
      handlerId,
      handlerName,
      ...(handlerVersion ? { handlerVersion } : {}),
      ...(handlerSpecification ? { handlerSpecification } : {}),
      ...(handlerSchema ? { handlerSchema } : {}),
      provider,
      ...(presentation ? { presentation } : {}),
      checkoutId: checkout.id,
      amount,
      currency: checkout.currency,
      ...(countryCode ? { countryCode } : {}),
      returnUrl,
      paymentRequest: {
        ...paymentRequest,
        transactionInfo
      },
      instruction: presentation === 'host_native'
        ? 'Approve this exact merchant Checkout with the native Google Pay sheet. Submit the returned checkout-scoped payment data to this signed action; Arro never stores reusable payment credentials in Postgres.'
        : 'Approve this exact merchant Checkout with Google Pay. The signed action uses the merchant-declared com.google.pay configuration; Arro vaults the checkout-scoped result and never stores reusable payment credentials in Postgres.'
    }
  }

  if (actionType === 'host_supplied') {
    return {
      kind: 'host_supplied_payment_capability',
      provider,
      handlerId,
      handlerName,
      ...(handlerVersion ? { handlerVersion } : {}),
      ...(handlerSpecification ? { handlerSpecification } : {}),
      ...(handlerSchema ? { handlerSchema } : {}),
      ...(presentation ? { presentation } : {}),
      checkoutId: checkout.id,
      amount,
      currency: checkout.currency,
      display: displayFromPreference(preference),
      instruction: 'Trusted host must return a signed, merchant-bound opaque capability. Raw payment credentials are rejected.'
    }
  }

  const {
    environment: processorEnvironment,
    gateway: processorGateway,
    credentialType: processorCredentialType,
    merchantInfo,
    sessionUrl: nativeSessionUrl
  } = stripeNativeProcessorConfigFromValue(handlerConfig)
  if (
    actionType === 'processor_tokenizer' &&
    presentation === 'host_native' &&
    processorGateway === 'stripe' &&
    processorEnvironment === 'PRODUCTION' &&
    processorCredentialType === 'stripe_payment_intent' &&
    nativeSessionUrl
  ) {
    return {
      kind: 'stripe_payment_sheet',
      provider,
      handlerId,
      handlerName,
      ...(handlerVersion ? { handlerVersion } : {}),
      ...(handlerSpecification ? { handlerSpecification } : {}),
      ...(handlerSchema ? { handlerSchema } : {}),
      presentation,
      checkoutId: checkout.id,
      amount,
      currency: checkout.currency,
      merchant: merchantInfo,
      paymentMethodTypes: ['card'],
      allowedCardBrands: ['visa', 'mastercard'],
      captureMethod: 'manual',
      instruction: 'Open the native Stripe PaymentSheet for this exact merchant Checkout. The signed action-session endpoint returns a live, short-lived client secret; submit only its PaymentIntent id after native confirmation.'
    }
  }

  return {
    kind: 'processor_tokenizer_action',
    provider,
    handlerId,
    handlerName,
    ...(handlerVersion ? { handlerVersion } : {}),
    ...(handlerSpecification ? { handlerSpecification } : {}),
    ...(handlerSchema ? { handlerSchema } : {}),
    ...(presentation ? { presentation } : {}),
    checkoutId: checkout.id,
    amount,
    currency: checkout.currency,
    instruction: 'Provider-controlled client action must return an opaque result for the exact active handler. Arro will tokenize and vault it server-side.'
  }
}

export const createPaymentActionTokenPayload = ({
  actionId,
  session,
  handlerId,
  handlerName,
  handlerVersion,
  handlerSpecification,
  handlerSchema,
  provider,
  capabilityId,
  expiresAt,
  nonce
}: {
  actionId: string
  session: UcpCheckoutSessionRecord
  handlerId: string
  handlerName: string
  handlerVersion?: string
  handlerSpecification?: string
  handlerSchema?: string
  provider: string
  capabilityId?: string
  expiresAt: string
  nonce?: string
}): PaymentActionTokenPayload => {
  const amount = paymentActionAmount(session.checkout)
  return {
    v: 1,
    actionId,
    transactionId: session.transactionId,
    integrationId: session.integrationId,
    ...(session.ownerKeyId ? { ownerKeyId: session.ownerKeyId } : {}),
    ...(session.ownerPrincipalHash ? { ownerPrincipalHash: session.ownerPrincipalHash } : {}),
    ...(session.externalSubjectRefHash ? { externalSubjectRefHash: session.externalSubjectRefHash } : {}),
    ...(session.externalTaskRefHash ? { externalTaskRefHash: session.externalTaskRefHash } : {}),
    ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}),
    merchantOrigin: session.merchantOrigin,
    checkoutId: session.checkoutId,
    checkoutSnapshotHash: session.checkoutSnapshotHash,
    handlerId,
    handlerName,
    ...(handlerVersion ? { handlerVersion } : {}),
    ...(handlerSpecification ? { handlerSpecification } : {}),
    ...(handlerSchema ? { handlerSchema } : {}),
    provider,
    ...(capabilityId ? { capabilityId } : {}),
    ...(amount !== undefined ? { amount } : {}),
    currency: session.checkout.currency,
    expiresAt,
    nonce: nonce ?? randomBytes(24).toString('base64url')
  }
}

export const paymentActionResponseFromRecord = ({
  action,
  token,
  publicBaseUrl
}: {
  action: UcpPaymentActionRecord
  token?: string
  publicBaseUrl: string
}): PurchasePaymentActionResponse => {
  const presentation = action.presentation
  if (
    presentation !== 'host_native' &&
    presentation !== 'embedded_component' &&
    presentation !== 'external_action' &&
    presentation !== 'merchant_hosted'
  ) {
    throw new Error('Stored payment action is missing a recognized presentation binding.')
  }

  return {
    actionId: action.actionId,
    purchaseId: action.transactionId,
    status: action.status,
    actionType: action.actionType,
    provider: action.provider,
    handlerId: action.handlerId,
    handlerName: action.handlerName,
    ...(action.handlerVersion ? { handlerVersion: action.handlerVersion } : {}),
    ...(action.handlerSpecification ? { handlerSpecification: action.handlerSpecification } : {}),
    ...(action.handlerSchema ? { handlerSchema: action.handlerSchema } : {}),
    ...(action.capabilityId ? { capabilityId: action.capabilityId } : {}),
    presentation,
    merchantOrigin: action.merchantOrigin,
    checkoutId: action.checkoutId,
    checkoutSnapshotHash: action.checkoutSnapshotHash,
    ...(action.amount !== undefined ? { amount: action.amount } : {}),
    ...(action.currency ? { currency: action.currency } : {}),
    expiresAt: action.expiresAt,
    ...(token ? { actionToken: token } : {}),
    ...(token && presentation !== 'host_native'
      ? { actionUrl: `${publicBaseUrl}/v1/payment-actions/${token}` }
      : {}),
    action: action.actionPayload,
    message: action.status === 'pending_user_approval'
      ? 'Approve this payment action once. Arro will not store reusable credentials and merchant checkout/order state remains the completion truth.'
      : action.status === 'credential_ready'
        ? 'Payment credential is ready for this checkout. Arro has not completed the purchase until confirm_purchase returns a merchant Order.'
        : `Payment action is ${action.status}.`
  }
}
