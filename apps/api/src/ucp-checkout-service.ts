import { createHash, createHmac, createPublicKey, createVerify, randomUUID, timingSafeEqual } from 'node:crypto'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  UcpCartCreateRequestSchema,
  UcpCartCancelRequestSchema,
  UcpCheckoutCompleteRequestSchema,
  UcpCheckoutCreateRequestSchema,
  UcpCheckoutUpdateRequestSchema,
  UcpOrderSchema,
  resolveUcpProfileSigningKeys,
  embeddedCheckoutPresentation,
  validationErrorSummary,
  type PurchasePaymentActionResult,
  type PurchasePaymentActionResponse,
  type PurchasePaymentPreference,
  type StripePaymentActionSession,
  type UcpPlatformProfile,
  type AgentExecutionDownscope,
  type AgentHostCapabilities,
  type PortablePaymentCapability,
  type PurchaseClientCapabilities,
  type TrustedAgentHostContext,
  type UcpCart,
  type UcpCartCreateRequest,
  type UcpCartCancelRequest,
  type UcpCheckout,
  type UcpCheckoutCompleteRequest,
  type UcpCheckoutCreateRequest,
  type UcpCheckoutUpdateRequest,
  type UcpOrder,
  type UcpPaymentInstrument,
  type UcpProfile
} from '@arro/contracts'
import {
  createPaymentHandlerRegistry,
  isUcpCart,
  isUcpCheckout,
  isUcpErrorResponse,
  type UcpClient,
  type UcpPaymentHandlerRegistry,
  type UcpAuthConfig,
  type UcpProtocolError
} from '@arro/ucp-client'
import {
  redactUcpPayload,
  ucpStableHash,
  ucpCheckoutSnapshotHash,
  type UcpCheckoutSessionRecord,
  type UcpCheckoutStore
} from './ucp-checkout-store.ts'
import type { CommercePrincipal } from './commerce-principal.ts'
import {
  createMerchantAuthResolver,
  type MerchantAuthOperation,
  type MerchantAuthResolver
} from './merchant-auth-resolver.ts'
import {
  PaymentResultExchangeError,
  createHttpPaymentCredentialProvider,
  type PaymentHandlerSpecConfig,
  type PaymentCredentialProvider,
  exchangePaymentProviderResult,
  paymentInstrumentCredentialExpired
} from './payment-result-exchange.ts'
import type {
  PaymentCredentialVault,
  PaymentCredentialVaultReference,
  PaymentExecutionAuthority
} from './payment-credential-vault.ts'
import type { TrustedHostPaymentVerifier } from './trusted-host-payment.ts'
import {
  PaymentActionTokenError,
  assertPaymentActionTokenMatchesRecord,
  createPaymentActionTokenPayload,
  paymentActionIdPrefix,
  paymentActionAmount,
  paymentActionNonceHash,
  paymentActionPayloadForRoute,
  paymentActionResponseFromRecord,
  principalFromPaymentActionPayload,
  signPaymentActionToken,
  verifyPaymentActionToken
} from './payment-actions.ts'
import {
  createUserPaymentCapabilityProviderRegistry,
  resolvePaymentRoute
} from './payment-route-resolver.ts'
import {
  applyAgentExecutionDownscope,
  type AgentHostRegistry
} from './agent-host-registry.ts'
import {
  Ap2MandateError,
  type Ap2TrustedIssuer,
  verifyAp2Mandate
} from './ap2-mandate.ts'
import {
  Ap2ReceiptError,
  verifyAndRecordAp2Receipt
} from './ap2-receipt.ts'
import {
  EmbeddedCheckoutProtocolError,
  createEmbeddedCheckoutSession,
  embeddedCheckoutInitParams,
  handleEmbeddedCheckoutJsonRpc,
  type EmbeddedCheckoutSession
} from './embedded-checkout.ts'
import { stableJsonStringify } from './stable-json.ts'
import {
  PortablePaymentError,
  createHttpPortablePaymentChallengeClient,
  type PortablePaymentChallengeClient
} from './portable-payment.ts'
import { UCP_AP2_MANDATE_CAPABILITY } from './platform-profile.ts'
import {
  StripeNativePaymentError,
  type StripeNativePaymentSessionClient
} from './stripe-native-payment.ts'

const createCheckoutValidator = TypeCompiler.Compile(UcpCheckoutCreateRequestSchema)
const createCartValidator = TypeCompiler.Compile(UcpCartCreateRequestSchema)
const cancelCartValidator = TypeCompiler.Compile(UcpCartCancelRequestSchema)
const updateCheckoutValidator = TypeCompiler.Compile(UcpCheckoutUpdateRequestSchema)
const completeCheckoutValidator = TypeCompiler.Compile(UcpCheckoutCompleteRequestSchema)
const orderValidator = TypeCompiler.Compile(UcpOrderSchema)

export type UcpCheckoutServiceErrorCode =
  | 'ucp_runtime_store_required'
  | 'ucp_invalid_request'
  | 'ucp_review_rejected'
  | 'ucp_transaction_not_found'
  | 'ucp_idempotency_key_required'
  | 'ucp_idempotency_conflict'
  | 'ucp_checkout_confirmation_required'
  | 'ucp_checkout_confirmation_mismatch'
  | 'ucp_checkout_completion_in_progress'
  | 'ucp_raw_payment_credentials_rejected'
  | 'ucp_payment_result_invalid'
  | 'ucp_payment_action_invalid'
  | 'ucp_payment_action_unavailable'
  | 'ucp_payment_action_expired'
  | 'ucp_payment_action_replayed'
  | 'ucp_payment_credential_vault_required'
  | 'ucp_embedded_checkout_unavailable'
  | 'ucp_embedded_checkout_invalid'
  | 'ucp_webhook_signature_verifier_required'
  | 'ucp_webhook_signature_invalid'
  | 'ucp_webhook_digest_invalid'
  | 'ucp_webhook_timestamp_invalid'
  | 'ucp_webhook_order_not_bound'
  | 'ucp_protocol_error'
  | 'ucp_merchant_rate_limited'

export class UcpCheckoutServiceError extends Error {
  readonly code: UcpCheckoutServiceErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: UcpCheckoutServiceErrorCode, message: string, status: number, details?: unknown) {
    super(message)
    this.name = 'UcpCheckoutServiceError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export type CreateUcpCheckoutServiceOptions = {
  client: UcpClient
  store?: UcpCheckoutStore
  platformProfile: UcpPlatformProfile
  platformProfileUrl: string
  hashPepper?: string
  paymentHandlerRegistry?: UcpPaymentHandlerRegistry
  paymentHandlerSpecs?: PaymentHandlerSpecConfig[]
  merchantAuthResolver?: MerchantAuthResolver
  paymentCredentialProvider?: PaymentCredentialProvider
  paymentCredentialVault?: PaymentCredentialVault
  stripeNativePaymentSessionClient?: StripeNativePaymentSessionClient
  paymentCredentialTtlSeconds?: number
  paymentActionSigningSecret?: string | undefined
  trustedHostPaymentVerifier?: TrustedHostPaymentVerifier | undefined
  portablePaymentChallengeClient?: PortablePaymentChallengeClient | undefined
  ap2TrustedIssuers?: Ap2TrustedIssuer[]
  agentHostRegistry?: AgentHostRegistry
  publicBaseUrl?: string | undefined
}

export type UcpCreateCheckoutRequest = {
  merchantProfileUrl: string
  businessProfile?: UcpProfile
  principal: CommercePrincipal
  idempotencyKey: string
  checkout: unknown
  cart?: unknown
}

export type UcpUpdateCheckoutRequest = {
  checkout: unknown
  principal: CommercePrincipal
  idempotencyKey?: string
  /** Stable caller-owned input used to distinguish safe replays from key reuse. */
  idempotencyFingerprint?: unknown
  expectedCheckoutSnapshotHash?: string
}

export type UcpConfirmCheckoutRequest = {
  approvalRef: string
  principal: CommercePrincipal
  checkoutSnapshotHash: string
  approvedAt?: string
}

export type UcpCompleteCheckoutRequest = {
  principal: CommercePrincipal
  idempotencyKey: string
  checkout: unknown
  ap2Authority?: {
    canonicalMandateId: string
    canonicalMandateVersion: number
    expectedOpenCheckoutReference: string
    expectedOpenPaymentReference: string
    totalAmountMinor: string
    totalUses: number
  }
}

export type UcpRecordPaymentResultRequest = {
  principal: CommercePrincipal
  idempotencyKey: string
  provider?: string
  expectedHandlerId?: string
  expectedActionId?: string
  checkoutSnapshotHash?: string
  capabilityId?: string
  paymentActionNonceHash?: string
  paymentActionPayload?: Record<string, unknown>
  paymentActionExpiresAt?: string
  result?: PurchasePaymentActionResult
}

export type UcpCreatePaymentActionRequest = {
  principal: CommercePrincipal
  portableCapabilities?: PortablePaymentCapability[]
  clientCapabilities?: PurchaseClientCapabilities
  preference?: PurchasePaymentPreference
  executionDownscope?: AgentExecutionDownscope
  hostCapabilities?: AgentHostCapabilities
  trustedHostContext?: TrustedAgentHostContext
  returnUrl?: string
  idempotencyKey?: string
}

export type UcpCreatePaymentActionSessionRequest = {
  actionToken: string
}

export type UcpRecordPaymentActionResultRequest = {
  actionToken: string
  result: PurchasePaymentActionResult
  idempotencyKey: string
}

export type UcpCancelCheckoutRequest = {
  principal: CommercePrincipal
  reason?: string
  idempotencyKey?: string
}

export type UcpCreateEmbeddedCheckoutSessionRequest = {
  principal: CommercePrincipal
  allowedOrigin: string
}

export type UcpHandleEmbeddedCheckoutMessageRequest = {
  principal: CommercePrincipal
  transactionId?: string
  sessionToken: string
  origin: string
  message: unknown
}

type EmbeddedCheckoutSessionTokenPayload = {
  v: 1
  session: EmbeddedCheckoutSession
  integrationId: string
  ownerKeyId?: string
  ownerPrincipalHash?: string
  externalSubjectRefHash?: string
  externalTaskRefHash?: string
  agentSessionId?: string
  checkoutSnapshotHash: string
  expiresAt: string
}

type UcpResponse = {
  transactionId: string
  cart?: UcpCart
  checkout: UcpCheckout
  session: Omit<UcpCheckoutSessionRecord, 'checkout' | 'businessProfile' | 'negotiation'>
  paymentCompletedByArro: boolean
  primaryAction: {
    action: string
    label: string
    url?: string
  }
}

type UcpBusinessErrorResponse = {
  transactionId?: string
  checkout?: UcpCheckout
  session?: Omit<UcpCheckoutSessionRecord, 'checkout' | 'businessProfile' | 'negotiation'>
  ucpError: unknown
  paymentCompletedByArro: false
  primaryAction: {
    action: string
    label: string
    url?: string
  }
}

const requireStore = (store: UcpCheckoutStore | undefined): UcpCheckoutStore => {
  if (store) return store
  throw new UcpCheckoutServiceError(
    'ucp_runtime_store_required',
    'UCP checkout runtime persistence is required before checkout state can be created, confirmed, completed, or reconciled.',
    503
  )
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const stringValue = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined

const originOf = (value: string | undefined) => {
  if (!value) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}
const integerValue = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined

const base64Url = (value: string | Buffer) =>
  Buffer.from(value).toString('base64url')

const embeddedSessionSignature = (encodedPayload: string, secret: string) =>
  createHmac('sha256', secret).update(encodedPayload, 'utf8').digest('base64url')

const embeddedCheckoutTokenPrefix = 'arro_ec1_'

const signEmbeddedCheckoutSessionToken = (
  payload: EmbeddedCheckoutSessionTokenPayload,
  secret: string | undefined
) => {
  if (!secret) {
    throw new UcpCheckoutServiceError(
      'ucp_embedded_checkout_unavailable',
      'PAYMENT_ACTION_SIGNING_SECRET is required before Arro can issue Embedded Checkout session tokens.',
      503
    )
  }
  const encodedPayload = base64Url(stableJsonStringify(payload))
  return `${embeddedCheckoutTokenPrefix}${encodedPayload}.${embeddedSessionSignature(encodedPayload, secret)}`
}

const verifyEmbeddedCheckoutSessionToken = (
  token: string,
  secret: string | undefined,
  now = new Date()
): EmbeddedCheckoutSessionTokenPayload => {
  if (!secret) {
    throw new UcpCheckoutServiceError(
      'ucp_embedded_checkout_unavailable',
      'PAYMENT_ACTION_SIGNING_SECRET is required before Arro can verify Embedded Checkout session tokens.',
      503
    )
  }
  const normalized = token.trim()
  if (!normalized.startsWith(embeddedCheckoutTokenPrefix)) {
    throw new UcpCheckoutServiceError(
      'ucp_embedded_checkout_invalid',
      'Embedded Checkout session token is malformed.',
      422
    )
  }
  const [encodedPayload, signature] = normalized.slice(embeddedCheckoutTokenPrefix.length).split('.')
  if (!encodedPayload || !signature) {
    throw new UcpCheckoutServiceError(
      'ucp_embedded_checkout_invalid',
      'Embedded Checkout session token is malformed.',
      422
    )
  }
  const expected = embeddedSessionSignature(encodedPayload, secret)
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(signature)
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new UcpCheckoutServiceError(
      'ucp_embedded_checkout_invalid',
      'Embedded Checkout session token signature is invalid.',
      422
    )
  }
  let payload: EmbeddedCheckoutSessionTokenPayload
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as EmbeddedCheckoutSessionTokenPayload
  } catch {
    throw new UcpCheckoutServiceError(
      'ucp_embedded_checkout_invalid',
      'Embedded Checkout session token payload is invalid.',
      422
    )
  }
  if (payload.v !== 1 || !payload.session?.sessionId || !payload.session?.channelId || !payload.expiresAt) {
    throw new UcpCheckoutServiceError(
      'ucp_embedded_checkout_invalid',
      'Embedded Checkout session token payload is invalid.',
      422
    )
  }
  if (new Date(payload.expiresAt).getTime() <= now.getTime()) {
    throw new UcpCheckoutServiceError(
      'ucp_embedded_checkout_invalid',
      'Embedded Checkout session token has expired.',
      410
    )
  }
  return payload
}

const hashScoped = (value: string, pepper: string | undefined) =>
  `sha256:${createHmac('sha256', pepper ?? 'arro-ucp-local-hash-pepper').update(value, 'utf8').digest('hex')}`

const fingerprint = (value: unknown) =>
  `sha256:${createHash('sha256').update(stableJsonStringify(value), 'utf8').digest('hex')}`

const linkHref = (links: unknown, rels: Set<string>) =>
  Array.isArray(links)
    ? links.map(asRecord).find((link) => {
        const rel = stringValue(link.rel)?.toLowerCase().replace(/_/g, '-')
        return rel ? rels.has(rel) : false
      })
    : undefined

const hasEmbeddedCheckoutService = (session: UcpCheckoutSessionRecord) =>
  Boolean(embeddedCheckoutPresentation(session.checkout))

const assertEmbeddedTokenMatchesSession = (
  payload: EmbeddedCheckoutSessionTokenPayload,
  session: UcpCheckoutSessionRecord
) => {
  const mismatched =
    payload.session.transactionId !== session.transactionId ||
    payload.session.checkoutId !== session.checkoutId ||
    payload.session.merchantOrigin !== session.merchantOrigin ||
    payload.integrationId !== session.integrationId ||
    (session.ownerKeyId ? payload.ownerKeyId !== session.ownerKeyId : false) ||
    (session.ownerPrincipalHash ? payload.ownerPrincipalHash !== session.ownerPrincipalHash : false) ||
    (session.externalSubjectRefHash ? payload.externalSubjectRefHash !== session.externalSubjectRefHash : false) ||
    (session.externalTaskRefHash ? payload.externalTaskRefHash !== session.externalTaskRefHash : false) ||
    (session.agentSessionId ? payload.agentSessionId !== session.agentSessionId : false)

  if (mismatched) {
    throw new UcpCheckoutServiceError(
      'ucp_embedded_checkout_invalid',
      'Embedded Checkout session token no longer matches the current purchase and checkout state.',
      409
    )
  }
}

const checkoutPrimaryAction = (checkout: UcpCheckout) => {
  if (checkout.status === 'completed') {
    return {
      action: 'order_created',
      label: 'Order created by merchant',
      ...(checkout.order?.permalink_url ? { url: checkout.order.permalink_url } : {})
    }
  }

  const outstandingAction = (Object.entries(checkout.actions ?? {}) as Array<[string, Array<{ id: string }>]>)
    .find(([, instances]) => instances.length > 0)
  if (outstandingAction) {
    return {
      action: 'complete_ucp_action',
      label: 'Complete merchant checkout action',
      actionType: outstandingAction[0],
      actionId: outstandingAction[1][0]?.id
    }
  }

  if (checkout.continue_url) {
    return {
      action: 'continue_on_merchant',
      label: 'Continue on merchant checkout',
      url: checkout.continue_url
    }
  }

  if (checkout.status === 'ready_for_complete') {
    return {
      action: 'confirm_then_complete',
      label: 'Confirm checkout before completion'
    }
  }

  return {
    action: 'review_checkout_state',
    label: 'Review checkout state'
  }
}

const hasCapability = (capabilities: Record<string, unknown>, name: string) =>
  Array.isArray(capabilities[name]) && (capabilities[name] as unknown[]).length > 0

const checkoutCreateHasSource = (checkout: UcpCheckoutCreateRequest) =>
  Boolean(
    stringValue(asRecord(checkout).cart_id) ||
    (Array.isArray(checkout.line_items) && checkout.line_items.length > 0)
  )

/**
 * Line items come back from the cart the merchant just built, so they are the
 * merchant's own view of what is being bought. They travel with `cart_id`
 * because merchants differ on which one `create_checkout` requires, and a
 * checkout request carrying only the cart reference is rejected outright by
 * merchants that expect the items restated.
 */
const checkoutLineItemsFromCart = (cart: UcpCart): UcpCheckoutCreateRequest['line_items'] => {
  const lineItems = cart.line_items.flatMap((lineItem) => {
    const itemId = lineItem.item?.id
    if (!itemId) return []
    return [{
      item: {
        id: itemId,
        ...(lineItem.item.title ? { title: lineItem.item.title } : {}),
        ...(lineItem.item.url ? { url: lineItem.item.url } : {})
      },
      quantity: lineItem.quantity
    }]
  })

  return lineItems.length > 0 ? lineItems : undefined
}

const checkoutFromCart = (
  checkoutRequest: UcpCheckoutCreateRequest,
  cart: UcpCart
): UcpCheckoutCreateRequest => {
  const {
    line_items: requestedLineItems,
    cart_id: _cartId,
    ...checkoutContext
  } = checkoutRequest
  const lineItems = checkoutLineItemsFromCart(cart) ?? requestedLineItems

  return {
    ...checkoutContext,
    cart_id: cart.id,
    ...(lineItems ? { line_items: lineItems } : {})
  }
}

const sessionPublicView = (session: UcpCheckoutSessionRecord): UcpResponse['session'] => {
  const {
    checkout: _checkout,
    cart: _cart,
    businessProfile: _businessProfile,
    negotiation: _negotiation,
    ownerKeyId: _ownerKeyId,
    ownerPrincipalHash: _ownerPrincipalHash,
    externalSubjectRefHash: _externalSubjectRefHash,
    externalTaskRefHash: _externalTaskRefHash,
    agentSessionId: _agentSessionId,
    ...publicSession
  } = session
  return publicSession
}

const responseFromSession = (
  session: UcpCheckoutSessionRecord,
  profileUrl?: string,
  paymentCompletedByArro = false
): UcpResponse => ({
  transactionId: session.transactionId,
  ...(session.cart ? { cart: redactUcpPayload(session.cart) } : {}),
  checkout: redactUcpPayload(session.checkout),
  session: sessionPublicView(session),
  paymentCompletedByArro: session.checkout.status === 'completed' && paymentCompletedByArro,
  primaryAction: checkoutPrimaryAction(session.checkout)
})

const validateBody = <T>(
  validator: {
    Check(value: unknown): boolean
    Errors(value: unknown): Iterable<{ path: string; message: string }>
  },
  body: unknown,
  code: string
): T => {
  if (validator.Check(body)) return body as T
  throw new UcpCheckoutServiceError(
    'ucp_invalid_request',
    `${code} does not match the UCP contract.`,
    422,
    validationErrorSummary(validator, body)
  )
}

const assertNoRawPaymentCredentials = (body: unknown) => {
  const lowered = stableJsonStringify(body).toLowerCase()
  for (const key of ['"pan"', '"cvv"', '"cvc"', '"card_number"', '"cardnumber"', '"card-number"']) {
    if (lowered.includes(key)) {
      throw new UcpCheckoutServiceError(
        'ucp_raw_payment_credentials_rejected',
        'Arro does not accept raw card numbers, PAN, CVV, or equivalent payment secrets. Submit only an externally tokenized UCP payment instrument.',
        422
      )
    }
  }
}

const assertCheckoutNotCompleting = (
  checkout: UcpCheckout,
  operation: 'update_checkout' | 'complete_checkout'
) => {
  if (checkout.status !== 'complete_in_progress') return
  throw new UcpCheckoutServiceError(
    'ucp_checkout_completion_in_progress',
    `Cannot start ${operation} while Checkout completion is already in progress. Reconcile with Get Checkout instead.`,
    409,
    {
      checkoutId: checkout.id,
      checkoutStatus: checkout.status,
      permittedOperation: 'get_checkout'
    }
  )
}

const assertCheckoutAcceptsPaymentAuthority = (
  checkout: UcpCheckout,
  code: 'ucp_payment_action_unavailable' | 'ucp_payment_result_invalid'
) => {
  if (checkout.status === 'incomplete' || checkout.status === 'ready_for_complete') return
  throw new UcpCheckoutServiceError(
    code,
    checkout.status === 'complete_in_progress'
      ? 'Checkout completion is already in progress. Reconcile the existing checkout instead of acquiring another payment credential.'
      : `Checkout cannot accept a payment credential while it is ${checkout.status.replaceAll('_', ' ')}.`,
    409,
    {
      checkoutId: checkout.id,
      checkoutStatus: checkout.status,
      permittedOperation: checkout.status === 'complete_in_progress' ? 'get_checkout' : undefined
    }
  )
}

const assertCheckoutReadyForComplete = (checkout: UcpCheckout) => {
  if (checkout.status === 'ready_for_complete') return
  throw new UcpCheckoutServiceError(
    checkout.status === 'complete_in_progress'
      ? 'ucp_checkout_completion_in_progress'
      : 'ucp_checkout_confirmation_required',
    checkout.status === 'complete_in_progress'
      ? 'Checkout completion is already in progress. Reconcile it with Get Checkout.'
      : 'The merchant Checkout is not ready for completion. Resolve its required buyer and fulfillment inputs before using payment authority.',
    409,
    {
      checkoutId: checkout.id,
      checkoutStatus: checkout.status,
      permittedOperation: 'get_checkout'
    }
  )
}

const assertCheckoutCompletionAuthority = async ({
  body,
  session,
  store,
  ap2TrustedIssuers,
  ap2Authority
}: {
  body: UcpCheckoutCompleteRequest
  session: UcpCheckoutSessionRecord
  store: UcpCheckoutStore
  ap2TrustedIssuers: Ap2TrustedIssuer[]
  ap2Authority?: UcpCompleteCheckoutRequest['ap2Authority']
}) => {
  const paymentInstruments = body.payment?.instruments ?? []
  const ap2 = asRecord(body.ap2)
  const checkoutMandate = stringValue(ap2.checkout_mandate)
  const ap2Negotiated = Object.hasOwn(
    session.negotiation.capabilities,
    UCP_AP2_MANDATE_CAPABILITY
  )
  if (ap2Negotiated && !checkoutMandate) {
    throw new UcpCheckoutServiceError(
      'ucp_invalid_request',
      'This Checkout negotiated AP2 and is security-locked. complete_checkout requires ap2.checkout_mandate.',
      422,
      { code: 'mandate_required' }
    )
  }
  if (!ap2Negotiated && checkoutMandate) {
    throw new UcpCheckoutServiceError(
      'ucp_invalid_request',
      `AP2 mandate authority is accepted only when ${UCP_AP2_MANDATE_CAPABILITY} was negotiated for this Checkout.`,
      422,
      { code: 'mandate_scope_mismatch' }
    )
  }
  if (checkoutMandate) {
    const paymentMandates = paymentInstruments.flatMap((instrument) => {
      const token = stringValue(asRecord(instrument.credential).token)
      if (!token) return []
      try {
        const composite = asRecord(JSON.parse(token) as unknown)
        const paymentMandate = stringValue(composite.payment_mandate) ?? stringValue(composite.paymentMandate)
        return paymentMandate ? [paymentMandate] : []
      } catch {
        return token.includes('~') && token.includes('.') ? [token] : []
      }
    })
    if (paymentMandates.length !== 1) {
      throw new UcpCheckoutServiceError(
        'ucp_invalid_request',
        'AP2 completion requires exactly one Payment Mandate in the selected payment instrument credential token.',
        422,
        { code: 'mandate_required', mandate: 'payment' }
      )
    }
    try {
      const checkoutContext = asRecord(session.checkout.context)
      await verifyAp2Mandate({
        checkoutMandate,
        paymentMandate: paymentMandates[0]!,
        paymentInstrument: paymentInstruments[0]!,
        checkout: session.checkout,
        businessProfile: session.businessProfile,
        merchantOrigin: session.merchantOrigin,
        transactionId: session.transactionId,
        checkoutId: session.checkoutId,
        checkoutSnapshotHash: session.checkoutSnapshotHash,
        trustedIssuers: ap2TrustedIssuers,
        store,
        ...(ap2Authority
          ? {
              mandateContext: {
                totalAmountMinor: ap2Authority.totalAmountMinor,
                totalUses: ap2Authority.totalUses,
                expectedOpenCheckoutReference: ap2Authority.expectedOpenCheckoutReference,
                expectedOpenPaymentReference: ap2Authority.expectedOpenPaymentReference
              }
            }
          : {}),
        authorityContext: {
          ...(session.ownerKeyId ? { ownerKeyId: session.ownerKeyId } : {}),
          ...(session.ownerPrincipalHash ? { ownerPrincipalHash: session.ownerPrincipalHash } : {}),
          integrationId: session.integrationId,
          ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}),
          ...(ap2Authority
            ? {
                canonicalMandateId: ap2Authority.canonicalMandateId,
                canonicalMandateVersion: ap2Authority.canonicalMandateVersion
              }
            : {
                ...(stringValue(checkoutContext.mandateId) ? { canonicalMandateId: stringValue(checkoutContext.mandateId)! } : {}),
                ...(integerValue(checkoutContext.mandateVersion) !== undefined ? { canonicalMandateVersion: integerValue(checkoutContext.mandateVersion)! } : {})
              })
        }
      })
    } catch (error) {
      if (error instanceof Ap2MandateError) {
        throw new UcpCheckoutServiceError(
          'ucp_invalid_request',
          error.message,
          error.code === 'ap2_mandate_replay' ? 409 : 422,
          {
            code: error.code,
            details: error.details
          }
        )
      }
      throw error
    }
  }
  if (paymentInstruments.length === 0) {
    throw new UcpCheckoutServiceError(
      'ucp_invalid_request',
      'complete_checkout requires a tokenized UCP payment instrument.',
      422
    )
  }
  for (const instrument of paymentInstruments) {
    if (paymentInstrumentCredentialExpired(instrument)) {
      throw new UcpCheckoutServiceError(
        'ucp_payment_result_invalid',
        'Payment credential has expired. Reacquire a fresh provider result before completing checkout.',
        409,
        {
          code: 'payment_result_credential_expired'
        }
      )
    }
  }
}

const credentialRecord = (instrument: UcpPaymentInstrument) => asRecord(instrument.credential)

const vaultBackedPaymentInstrument = (
  instrument: UcpPaymentInstrument,
  vaultReference: PaymentCredentialVaultReference
): UcpPaymentInstrument => {
  const credential = credentialRecord(instrument)
  const scope = asRecord(credential.scope)
  return {
    ...redactUcpPayload(instrument),
    credential: {
      type: stringValue(credential.type) ?? instrument.type,
      redacted: true,
      reference: vaultReference.reference,
      expires_at: vaultReference.expiresAt,
      ...(Object.keys(scope).length > 0 ? { scope: redactUcpPayload(scope) } : {})
    } as NonNullable<UcpPaymentInstrument['credential']>
  }
}

const vaultReferenceFromInstrument = (instrument: UcpPaymentInstrument) =>
  stringValue(credentialRecord(instrument).reference)

const asProtocolDetails = (error: unknown) => {
  const typed = error as Partial<UcpProtocolError>
  return typed && typeof typed === 'object' && 'details' in typed ? typed.details : undefined
}

const wrapProtocolError = (error: unknown): never => {
  const details = asProtocolDetails(error)
  if (details?.httpStatus === 429) {
    throw new UcpCheckoutServiceError(
      'ucp_merchant_rate_limited',
      'This shop is temporarily limiting checkout updates. Wait before trying again, or continue with the shop.',
      429,
      details
    )
  }
  throw new UcpCheckoutServiceError(
    'ucp_protocol_error',
    error instanceof Error ? error.message : 'UCP merchant protocol operation failed.',
    502,
    details
  )
}

const wrapReviewProtocolError = (error: unknown): never => {
  if (asProtocolDetails(error)?.code === 'ucp_mcp_invalid_params') {
    throw new UcpCheckoutServiceError(
      'ucp_review_rejected',
      'The shop could not accept these details. Check the contact and delivery fields and try again.',
      422
    )
  }
  return wrapProtocolError(error)
}

const originFromProfileUrl = (value: string) => new URL(value).origin

const orderIdFromCheckout = (checkout: UcpCheckout) => checkout.order?.id

const orderUrlFromCheckout = (checkout: UcpCheckout) => checkout.order?.permalink_url

const errorPrimaryAction = (error: unknown) => {
  if (isUcpErrorResponse(error) && error.continue_url) {
    return {
      action: 'continue_on_merchant',
      label: 'Continue on merchant',
      url: error.continue_url
    }
  }

  return {
    action: 'review_checkout_state',
    label: 'Review merchant checkout response'
  }
}

const responseFromBusinessError = (
  error: unknown,
  session?: UcpCheckoutSessionRecord
): UcpBusinessErrorResponse => ({
  ...(session ? { transactionId: session.transactionId } : {}),
  ...(session ? { checkout: redactUcpPayload(session.checkout) } : {}),
  ...(session ? { session: sessionPublicView(session) } : {}),
  ucpError: redactUcpPayload(error),
  paymentCompletedByArro: false,
  primaryAction: errorPrimaryAction(error)
})

const digestMatches = (contentDigest: string, rawBody: string) => {
  const expected = createHash('sha256').update(rawBody, 'utf8').digest('base64')
  return contentDigest.includes(`sha-256=:${expected}:`) || contentDigest.includes(`sha-256=${expected}`)
}

const webhookFreshnessMs = 5 * 60 * 1000

const parseSignatureInput = (value: string) => {
  const match = /^([a-zA-Z0-9_-]+)=\(([^)]*)\)(.*)$/.exec(value.trim())
  if (!match?.[1] || match[2] === undefined || match[3] === undefined) return undefined

  const components = [...match[2].matchAll(/"([^"]+)"/g)].map((componentMatch) => componentMatch[1]!.toLowerCase())
  const paramsText = match[3]
  const keyId = /(?:^|;)keyid="([^"]+)"/.exec(paramsText)?.[1]
  const created = Number(/(?:^|;)created=([0-9]+)/.exec(paramsText)?.[1])
  const expiresMatch = /(?:^|;)expires=([0-9]+)/.exec(paramsText)
  const expires = expiresMatch?.[1] ? Number(expiresMatch[1]) : undefined

  return {
    label: match[1],
    components,
    paramsText,
    signatureParams: `(${components.map((component) => `"${component}"`).join(' ')})${paramsText}`,
    keyId,
    created: Number.isFinite(created) ? created : undefined,
    expires: Number.isFinite(expires) ? expires : undefined
  }
}

const signatureBytes = (signature: string, label: string) => {
  const pattern = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=:(?<signature>[^:]+):`)
  const encoded = pattern.exec(signature)?.groups?.signature
  return encoded ? Buffer.from(encoded, 'base64') : undefined
}

const rawEcdsaToDer = (signature: Buffer) => {
  if (signature.length !== 64) return signature
  const integer = (bytes: Buffer) => {
    let value = bytes
    while (value.length > 1 && value[0] === 0) value = value.subarray(1)
    if ((value[0]! & 0x80) !== 0) value = Buffer.concat([Buffer.from([0]), value])
    return Buffer.concat([Buffer.from([0x02, value.length]), value])
  }
  const r = integer(signature.subarray(0, 32))
  const s = integer(signature.subarray(32))
  const body = Buffer.concat([r, s])
  return Buffer.concat([Buffer.from([0x30, body.length]), body])
}

const signingKeyId = (key: Record<string, unknown>) =>
  stringValue(key.kid) ?? stringValue(key.keyid) ?? stringValue(key.id)

const componentValue = ({
  component,
  headers,
  method,
  path
}: {
  component: string
  headers: Record<string, string>
  method: string
  path: string
}) => {
  if (component === '@method') return method.toUpperCase()
  if (component === '@path') return path
  return headers[component]
}

const verifyHttpMessageSignature = ({
  businessProfile,
  headers,
  method,
  path,
  now
}: {
  businessProfile: UcpProfile
  headers: Record<string, string>
  method: string
  path: string
  now: Date
}) => {
  const signatureInput = headers['signature-input']
  const signature = headers.signature
  if (!signatureInput || !signature) return false

  const parsed = parseSignatureInput(signatureInput)
  if (!parsed?.keyId || !parsed.created || parsed.components.length === 0) return false
  const nowSeconds = Math.floor(now.getTime() / 1000)
  if (Math.abs(nowSeconds - parsed.created) * 1000 > webhookFreshnessMs) return false
  if (parsed.expires !== undefined && parsed.expires < nowSeconds) return false

  let signingKeys: Array<Record<string, unknown>>
  try {
    signingKeys = resolveUcpProfileSigningKeys(businessProfile)
  } catch {
    return false
  }
  const signingKey = signingKeys.find((key) =>
    isRecord(key) && signingKeyId(key) === parsed.keyId
  )
  if (!signingKey || !isRecord(signingKey)) return false

  const lines: string[] = []
  for (const component of parsed.components) {
    const value = componentValue({ component, headers, method, path })
    if (value === undefined) return false
    lines.push(`"${component}": ${value}`)
  }
  lines.push(`"@signature-params": ${parsed.signatureParams}`)

  const signatureBuffer = signatureBytes(signature, parsed.label)
  if (!signatureBuffer) return false

  try {
    const key = createPublicKey({ key: signingKey, format: 'jwk' })
    const verify = createVerify('sha256')
    verify.update(lines.join('\n'))
    verify.end()
    if (verify.verify(key, signatureBuffer)) return true

    const rawVerify = createVerify('sha256')
    rawVerify.update(lines.join('\n'))
    rawVerify.end()
    return rawVerify.verify(key, rawEcdsaToDer(signatureBuffer))
  } catch {
    return false
  }
}

export const createUcpCheckoutService = ({
  client,
  store,
  platformProfile,
  platformProfileUrl,
  hashPepper,
  paymentHandlerRegistry = createPaymentHandlerRegistry(),
  paymentHandlerSpecs = [],
  merchantAuthResolver = createMerchantAuthResolver(),
  paymentCredentialProvider = createHttpPaymentCredentialProvider(),
  paymentCredentialVault,
  stripeNativePaymentSessionClient,
  paymentCredentialTtlSeconds = 900,
  paymentActionSigningSecret,
  trustedHostPaymentVerifier,
  portablePaymentChallengeClient = createHttpPortablePaymentChallengeClient(),
  ap2TrustedIssuers = [],
  agentHostRegistry,
  publicBaseUrl = platformProfileUrl ? new URL(platformProfileUrl).origin : 'http://localhost:3000'
}: CreateUcpCheckoutServiceOptions) => {
  const readSession = async (transactionId: string, principal: CommercePrincipal) => {
    const runtimeStore = requireStore(store)
    const session = await runtimeStore.readSessionForPrincipal(transactionId, principal)
    if (!session) {
      throw new UcpCheckoutServiceError(
        'ucp_transaction_not_found',
        'UCP checkout transaction was not found.',
        404
      )
    }
    return session
  }

  const revokeStoredPaymentAuthorities = async (
    transactionId: string,
    reason: 'checkout_changed' | 'purchase_canceled' | 'purchase_completed' | 'snapshot_mismatch',
    checkoutSnapshotHash?: string
  ) => {
    const revoked = await requireStore(store).revokePaymentResults({
      transactionId,
      reason,
      ...(checkoutSnapshotHash ? { checkoutSnapshotHash } : {})
    })
    if (!paymentCredentialVault) return revoked
    await Promise.all(
      revoked.flatMap((paymentResult) => {
        const reference = vaultReferenceFromInstrument(paymentResult.instrument)
        return reference ? [paymentCredentialVault.revoke(reference)] : []
      })
    )
    return revoked
  }

  const revokeChangedCheckoutAuthority = async (
    transactionId: string,
    reason: 'checkout_changed' | 'purchase_canceled' | 'snapshot_mismatch',
    checkoutSnapshotHash: string
  ) => {
    const actionReason = reason === 'snapshot_mismatch' ? 'checkout_changed' : reason
    await Promise.all([
      requireStore(store).revokePendingPaymentActions({
        transactionId,
        reason: actionReason,
        checkoutSnapshotHash
      }),
      requireStore(store).invalidateAp2Authorities({
        transactionId,
        reason: actionReason,
        checkoutSnapshotHash
      }),
      revokeStoredPaymentAuthorities(transactionId, reason, checkoutSnapshotHash)
    ])
  }

  const updateStoredCheckout = async (
    transactionId: string,
    checkout: UcpCheckout,
    previousSession?: UcpCheckoutSessionRecord,
    completedByArro = false
  ) => {
    const runtimeStore = requireStore(store)
    const previous = previousSession ?? await runtimeStore.readSession(transactionId)
    const updated = await runtimeStore.updateCheckout({
      transactionId,
      checkout
    })
    const snapshotChanged = previous !== undefined &&
      previous.checkoutSnapshotHash !== updated.checkoutSnapshotHash

    if (updated.checkout.status === 'completed') {
      const paymentResult = completedByArro && previous
        ? await runtimeStore.readLatestPaymentResult(
            transactionId,
            previous.checkoutSnapshotHash
          )
        : undefined
      const consumedAction = paymentResult
        ? await runtimeStore.consumePaymentAction({
            transactionId,
            paymentResultId: paymentResult.paymentResultId
          })
        : undefined
      await Promise.all([
        runtimeStore.revokeSiblingPaymentActions({
          transactionId,
          ...(consumedAction ? { consumedActionId: consumedAction.actionId } : {}),
          reason: 'purchase_completed'
        }),
        completedByArro
          ? runtimeStore.consumeAp2Authorities({ transactionId })
          : runtimeStore.invalidateAp2Authorities({
              transactionId,
              reason: 'checkout_changed'
            }),
        revokeStoredPaymentAuthorities(transactionId, 'purchase_completed')
      ])
    } else if (updated.checkout.status === 'canceled') {
      await revokeStoredPaymentAuthorities(transactionId, 'purchase_canceled')
      await Promise.all([
        runtimeStore.revokePendingPaymentActions({ transactionId, reason: 'purchase_canceled' }),
        runtimeStore.invalidateAp2Authorities({ transactionId, reason: 'purchase_canceled' })
      ])
    } else if (previous && snapshotChanged) {
      await revokeChangedCheckoutAuthority(
        transactionId,
        'checkout_changed',
        previous.checkoutSnapshotHash
      )
    }

    return updated
  }

  const updateStoredCart = async (
    transactionId: string,
    cart: UcpCart
  ) =>
    requireStore(store).updateCart({
      transactionId,
      cart
    })

  const authFor = async ({
    merchantOrigin,
    merchantProfileUrl,
    businessProfile,
    negotiation,
    operation
  }: {
    merchantOrigin: string
    merchantProfileUrl: string
    businessProfile: UcpProfile
    negotiation: UcpCheckoutSessionRecord['negotiation']
    operation: MerchantAuthOperation
  }): Promise<UcpAuthConfig | undefined> =>
    merchantAuthResolver.resolve({
      merchantOrigin,
      merchantProfileUrl,
      businessProfile,
      negotiation,
      operation
    })

  const authForSession = (session: UcpCheckoutSessionRecord, operation: MerchantAuthOperation) =>
    authFor({
      merchantOrigin: session.merchantOrigin,
      merchantProfileUrl: session.merchantProfileUrl,
      businessProfile: session.businessProfile,
      negotiation: session.negotiation,
      operation
    })

  const paymentActionError = (error: unknown): never => {
    if (error instanceof PaymentActionTokenError) {
      const status = error.code === 'payment_action_token_expired' ? 410 : 422
      throw new UcpCheckoutServiceError(
        error.code === 'payment_action_token_expired'
          ? 'ucp_payment_action_expired'
          : 'ucp_payment_action_invalid',
        error.message,
        status
      )
    }
    throw error
  }

  const trustedHostContextForPaymentAction = async (request: UcpCreatePaymentActionRequest) => {
    const trustedHostContext = request.trustedHostContext ??
      await agentHostRegistry?.resolve({ principal: request.principal })
    return trustedHostContext
      ? applyAgentExecutionDownscope(trustedHostContext, request.executionDownscope)
      : undefined
  }

  const choosePaymentRoute = async (
    session: UcpCheckoutSessionRecord,
    request: UcpCreatePaymentActionRequest
  ) => {
    const trustedHostContext = await trustedHostContextForPaymentAction(request)
    const hostCapabilities = request.hostCapabilities ?? trustedHostContext?.capabilities
    const clientCapabilities = request.principal.integrationId === 'first-party:arro-shopper'
      ? request.clientCapabilities
      : undefined
    const supports = paymentHandlerRegistry.resolve({
      businessProfile: session.businessProfile,
      negotiatedPaymentHandlers: session.negotiation.paymentHandlers,
      checkout: session.checkout
    })
    const capabilities = createUserPaymentCapabilityProviderRegistry().listCapabilities({
      checkout: session.checkout,
      supports,
      handlerSpecs: paymentHandlerSpecs,
      ...(request.portableCapabilities ? { portableCapabilities: request.portableCapabilities } : {}),
      ...(clientCapabilities ? { clientCapabilities } : {}),
      hostCapabilities,
      trustedHostContext,
      componentOrigin: publicBaseUrl ? new URL(publicBaseUrl).origin : undefined,
      returnUrl: request.returnUrl ?? request.executionDownscope?.returnUrl
    })
    const route = resolvePaymentRoute({
      capabilities,
      preference: request.preference
    })
    if (!route.available) {
      throw new UcpCheckoutServiceError(
        'ucp_payment_action_unavailable',
        'No executable payment capability intersects this merchant Checkout. Continue on the merchant checkout instead.',
        409,
        {
          reason: route.reason,
          ...(route.requestedMode ? { requestedMode: route.requestedMode } : {}),
          primaryAction: checkoutPrimaryAction(session.checkout)
        }
      )
    }

    return {
      selected: {
        supported: true as const,
        handlerName: route.capability.handlerName,
        identity: route.capability.identity,
        declaration: route.capability.declaration,
        executionMode: route.presentation === 'host_native' ? 'client' as const : 'relay' as const,
        reason: route.capability.reason
      },
      actionType: route.actionType,
      capability: route.capability,
      presentation: route.presentation,
      trustedHostContext
    } as const
  }

  const recordPaymentProviderResult = async (
    transactionId: string,
    request: UcpRecordPaymentResultRequest
  ) => {
    const session = await readSession(transactionId, request.principal)
    assertCheckoutAcceptsPaymentAuthority(session.checkout, 'ucp_payment_result_invalid')
    const checkoutSnapshotHash = request.checkoutSnapshotHash ?? session.checkoutSnapshotHash
    if (checkoutSnapshotHash !== session.checkoutSnapshotHash) {
      await revokeChangedCheckoutAuthority(transactionId, 'snapshot_mismatch', checkoutSnapshotHash)
      throw new UcpCheckoutServiceError(
        request.expectedActionId ? 'ucp_payment_action_invalid' : 'ucp_payment_result_invalid',
        'Payment authority was acquired for a checkout snapshot that is no longer current.',
        409,
        {
          expectedCheckoutSnapshotHash: session.checkoutSnapshotHash,
          receivedCheckoutSnapshotHash: checkoutSnapshotHash
        }
      )
    }
    const idempotencyKey = stringValue(request.idempotencyKey)
    if (!idempotencyKey) {
      throw new UcpCheckoutServiceError(
        'ucp_idempotency_key_required',
        'Recording a payment provider result requires an idempotency key.',
        422
      )
    }

    const exchange = await (async () => {
      try {
        return await exchangePaymentProviderResult({
          provider: request.provider,
          ...(request.expectedHandlerId ?? session.selectedPaymentHandlerId
            ? { expectedHandlerId: request.expectedHandlerId ?? session.selectedPaymentHandlerId }
            : {}),
          result: request.result,
          checkout: session.checkout,
          businessProfile: session.businessProfile,
          merchantOrigin: session.merchantOrigin,
          credentialProvider: paymentCredentialProvider,
          handlerSpecs: paymentHandlerSpecs,
          ...(request.paymentActionPayload ? { paymentActionPayload: request.paymentActionPayload } : {}),
          ...(request.checkoutSnapshotHash ? { checkoutSnapshotHash: request.checkoutSnapshotHash } : {}),
          ...(request.expectedActionId ? { paymentActionId: request.expectedActionId } : {}),
          ...(trustedHostPaymentVerifier &&
          request.result?.type === 'trusted_host_attestation' &&
          request.expectedActionId &&
          request.expectedHandlerId &&
          request.checkoutSnapshotHash &&
          request.paymentActionNonceHash
            ? {
                trustedHostPaymentVerifier,
                trustedHostExpectedBinding: {
                  provider: request.provider ?? request.expectedHandlerId,
                  expectedHandlerId: request.expectedHandlerId,
                  merchantOrigin: session.merchantOrigin,
                  transactionId: session.transactionId,
                  actionId: request.expectedActionId,
                  checkoutSnapshotHash: request.checkoutSnapshotHash,
                  ...(request.capabilityId ? { capabilityId: request.capabilityId } : {}),
                  paymentActionNonceHash: request.paymentActionNonceHash,
                  checkout: session.checkout
                }
              }
            : {}),
        })
      } catch (error) {
        if (error instanceof PaymentResultExchangeError) {
          const status = error.code === 'payment_result_tokenizer_auth_missing'
            ? 503
            : error.code === 'payment_result_tokenize_failed'
              ? 502
              : 422
          throw new UcpCheckoutServiceError(
            'ucp_payment_result_invalid',
            error.message,
            status,
            {
              code: error.code,
              details: error.details
            }
          )
        }
        throw error
      }
    })()
    if (!paymentCredentialVault) {
      throw new UcpCheckoutServiceError(
        'ucp_payment_credential_vault_required',
        'Recording provider payment results requires a runtime payment credential vault so live credentials are not persisted in ordinary Postgres.',
        503
      )
    }
    const credentialTtlSeconds = (() => {
      if (!request.paymentActionExpiresAt) return paymentCredentialTtlSeconds
      const actionExpiry = Date.parse(request.paymentActionExpiresAt)
      const remainingSeconds = Math.floor((actionExpiry - Date.now()) / 1000)
      if (!Number.isFinite(actionExpiry) || remainingSeconds < 1) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_expired',
          'Payment action expired before its checkout-scoped credential could be vaulted.',
          409
        )
      }
      return Math.min(paymentCredentialTtlSeconds, remainingSeconds)
    })()
    const idempotencyKeyHash = hashScoped(idempotencyKey, hashPepper)
    const paymentResultId = `ucppr_${randomUUID()}`
    const vaultReference = await paymentCredentialVault.put({
      paymentResultId,
      transactionId,
      instrument: exchange.instrument,
      ...(exchange.ap2CheckoutMandate ? { ap2CheckoutMandate: exchange.ap2CheckoutMandate } : {}),
      ttlSeconds: credentialTtlSeconds
    })
    const storedInstrument = vaultBackedPaymentInstrument(exchange.instrument, vaultReference)
    const createResult = await requireStore(store).recordPaymentResult({
      paymentResultId,
      transactionId,
      provider: exchange.provider,
      handlerId: exchange.handlerId,
      checkoutSnapshotHash,
      idempotencyKeyHash,
      resultFingerprint: exchange.resultFingerprint,
      instrument: storedInstrument,
      providerResult: {
        type: request.result?.type ?? 'unknown',
        fingerprint: exchange.resultFingerprint
      }
    })

    if ('conflict' in createResult) {
      await paymentCredentialVault.revoke(vaultReference.reference)
      throw new UcpCheckoutServiceError(
        'ucp_idempotency_conflict',
        createResult.message,
        409
      )
    }
    if (!createResult.stored) {
      await paymentCredentialVault.revoke(vaultReference.reference)
    }

    const updated = await requireStore(store).readSession(transactionId)
    if (
      !updated ||
      updated.checkoutSnapshotHash !== checkoutSnapshotHash ||
      (updated.checkout.status !== 'incomplete' && updated.checkout.status !== 'ready_for_complete')
    ) {
      await revokeChangedCheckoutAuthority(transactionId, 'snapshot_mismatch', checkoutSnapshotHash)
      throw new UcpCheckoutServiceError(
        'ucp_payment_result_invalid',
        'Checkout changed while its payment result was being recorded. Acquire a fresh payment action for the current checkout.',
        409
      )
    }

    await requireStore(store).recordOperation({
      transactionId,
      operation: 'record_payment_result',
      idempotencyKeyHash,
      request: {
        provider: request.provider,
        resultFingerprint: exchange.resultFingerprint
      },
      response: {
        paymentResultId: createResult.paymentResult.paymentResultId,
        provider: createResult.paymentResult.provider,
        handlerId: createResult.paymentResult.handlerId,
        instrumentId: createResult.paymentResult.instrument.id
      },
      status: 'succeeded'
    })

    return {
      ...responseFromSession(updated, platformProfileUrl),
      paymentResult: {
        paymentResultId: createResult.paymentResult.paymentResultId,
        provider: createResult.paymentResult.provider,
        handlerId: createResult.paymentResult.handlerId,
        instrumentId: createResult.paymentResult.instrument.id,
        resultFingerprint: createResult.paymentResult.resultFingerprint,
        idempotentReplay: !createResult.stored,
        createdAt: createResult.paymentResult.createdAt
      }
    }
  }

  return {
    async createCheckout(request: UcpCreateCheckoutRequest) {
      const runtimeStore = requireStore(store)
      const idempotencyKey = stringValue(request.idempotencyKey)
      if (!idempotencyKey) {
        throw new UcpCheckoutServiceError(
          'ucp_idempotency_key_required',
          'Creating a UCP checkout requires an idempotency key.',
          422
        )
      }

      const merchantProfileUrl = stringValue(request.merchantProfileUrl)
      if (!merchantProfileUrl) {
        throw new UcpCheckoutServiceError(
          'ucp_invalid_request',
          'merchantProfileUrl is required.',
          422
        )
      }

      const checkoutRequest = validateBody<UcpCheckoutCreateRequest>(
        createCheckoutValidator,
        request.checkout,
        'create_checkout'
      )
      assertNoRawPaymentCredentials(checkoutRequest)
      if (!checkoutCreateHasSource(checkoutRequest)) {
        throw new UcpCheckoutServiceError(
          'ucp_invalid_request',
          'create_checkout requires line_items or cart_id.',
          422
        )
      }
      // The live commerce directory has already fetched this exact document in
      // the common path. Negotiate it again here (which performs canonical UCP
      // validation), but do not pay for a duplicate merchant round trip.
      const businessProfile = request.businessProfile ??
        await client.discover(merchantProfileUrl).catch(wrapProtocolError)
      const negotiation = await client.negotiate(platformProfile, businessProfile).catch(wrapProtocolError)
      const merchantOrigin = originFromProfileUrl(merchantProfileUrl)
      const cartRequest = request.cart
        ? validateBody<UcpCartCreateRequest>(
            createCartValidator,
            request.cart,
            'create_cart'
          )
        : undefined
      if (cartRequest) assertNoRawPaymentCredentials(cartRequest)
      const cartAuth = cartRequest
        ? await authFor({
            merchantOrigin,
            merchantProfileUrl,
            businessProfile,
            negotiation,
            operation: 'create_cart'
          })
        : undefined
      const cart = cartRequest && hasCapability(negotiation.capabilities, 'dev.ucp.shopping.cart')
        ? await client.createCart({
            negotiation,
            idempotencyKey: `${idempotencyKey}:cart`,
            body: cartRequest,
            ...(cartAuth ? { auth: cartAuth } : {})
          }).catch(wrapProtocolError)
        : undefined
      if (cart && !isUcpCart(cart)) {
        return responseFromBusinessError(cart)
      }
      const effectiveCheckoutRequest = cart
        ? checkoutFromCart(checkoutRequest, cart)
        : checkoutRequest
      const checkoutAuth = await authFor({
        merchantOrigin,
        merchantProfileUrl,
        businessProfile,
        negotiation,
        operation: 'create_checkout'
      })
      const checkoutResponse = await client.createCheckout({
        negotiation,
        idempotencyKey,
        body: effectiveCheckoutRequest,
        ...(checkoutAuth ? { auth: checkoutAuth } : {})
      }).catch(wrapProtocolError)
      if (!isUcpCheckout(checkoutResponse)) {
        return responseFromBusinessError(checkoutResponse)
      }
      const checkout = checkoutResponse
      const transactionId = `ucptx_${randomUUID()}`
      const requestFingerprint = fingerprint({
        merchantProfileUrl,
        checkout: effectiveCheckoutRequest,
        ...(cartRequest ? { cart: cartRequest } : {})
      })
      const orderId = orderIdFromCheckout(checkout)
      const orderPermalinkUrl = orderUrlFromCheckout(checkout)
      const createResult = await runtimeStore.createSession({
        transactionId,
        integrationId: request.principal.integrationId,
        ownerKeyId: request.principal.keyId,
        ownerPrincipalHash: request.principal.ownerPrincipalHash,
        ...(request.principal.externalSubjectRefHash ? { externalSubjectRefHash: request.principal.externalSubjectRefHash } : {}),
        ...(request.principal.externalTaskRefHash ? { externalTaskRefHash: request.principal.externalTaskRefHash } : {}),
        ...(request.principal.agentSessionId ? { agentSessionId: request.principal.agentSessionId } : {}),
        merchantProfileUrl,
        merchantOrigin,
        ucpVersion: negotiation.version,
        ...(cart
          ? {
              cartId: cart.id,
              cartSnapshotHash: ucpStableHash(cart),
              cart
            }
          : {}),
        checkoutId: checkout.id,
        idempotencyKeyHash: hashScoped(idempotencyKey, hashPepper),
        requestFingerprint,
        lastCheckoutStatus: checkout.status,
        checkoutSnapshotHash: ucpCheckoutSnapshotHash(checkout),
        checkout,
        businessProfile,
        negotiation,
        ...(orderId ? { orderId } : {}),
        ...(orderPermalinkUrl ? { orderPermalinkUrl } : {})
      })

      if ('conflict' in createResult) {
        throw new UcpCheckoutServiceError(
          'ucp_idempotency_conflict',
          createResult.message,
          409
        )
      }

      if (cart) {
        await runtimeStore.recordOperation({
          transactionId,
          operation: 'create_cart',
          idempotencyKeyHash: hashScoped(`${idempotencyKey}:cart`, hashPepper),
          request: cartRequest,
          response: cart,
          status: 'succeeded'
        })
      }

      return {
        ...responseFromSession(createResult.session, platformProfileUrl),
        idempotentReplay: !createResult.stored
      }
    },

    async getCheckout(transactionId: string, principal: CommercePrincipal) {
      const session = await readSession(transactionId, principal)
      // After conversion, Checkout is the authority. Reading its source cart
      // first doubles traffic and can block a valid checkout on an unrelated cart error.
      const auth = await authForSession(session, 'get_checkout')
      const checkoutResponse = await client.getCheckout({
        negotiation: session.negotiation,
        checkoutId: session.checkoutId,
        ...(auth ? { auth } : {})
      }).catch(wrapProtocolError)
      if (!isUcpCheckout(checkoutResponse)) return responseFromBusinessError(checkoutResponse, session)
      const checkout = checkoutResponse.status === 'completed' &&
        !checkoutResponse.order &&
        session.checkout.order
        ? { ...checkoutResponse, order: session.checkout.order }
        : checkoutResponse
      const updated = await updateStoredCheckout(transactionId, checkout, session)
      const completedByArro = updated.checkout.status === 'completed' &&
        (await requireStore(store).hasCompletedCheckoutOperation?.(transactionId) ?? false)
      return responseFromSession(updated, platformProfileUrl, completedByArro)
    },

    async updateCheckout(transactionId: string, request: UcpUpdateCheckoutRequest) {
      const session = await readSession(transactionId, request.principal)
      const idempotencyKey = stringValue(request.idempotencyKey)
      const idempotencyKeyHash = idempotencyKey
        ? hashScoped(idempotencyKey, hashPepper)
        : undefined
      const requestFingerprint = fingerprint(
        request.idempotencyFingerprint ?? request.checkout
      )
      if (idempotencyKeyHash && requireStore(store).readOperation) {
        const existing = await requireStore(store).readOperation!({
          transactionId,
          operation: 'update_checkout',
          idempotencyKeyHash
        })
        if (existing) {
          const existingFingerprint = stringValue(asRecord(existing.request).requestFingerprint)
          if (existingFingerprint !== requestFingerprint) {
            throw new UcpCheckoutServiceError(
              'ucp_idempotency_conflict',
              'The update_checkout idempotency key was reused with different review details.',
              409
            )
          }
          if (existing.response !== undefined && (existing.status === 'succeeded' || existing.status === 'failed')) {
            return existing.response as UcpResponse | UcpBusinessErrorResponse
          }
        }
      }
      if (
        request.expectedCheckoutSnapshotHash &&
        session.checkoutSnapshotHash !== request.expectedCheckoutSnapshotHash
      ) {
        throw new UcpCheckoutServiceError(
          'ucp_checkout_confirmation_mismatch',
          'The purchase review is based on a stale Checkout. Refresh the purchase before changing buyer or fulfillment details.',
          409,
          {
            expectedCheckoutSnapshotHash: request.expectedCheckoutSnapshotHash,
            currentCheckoutSnapshotHash: session.checkoutSnapshotHash
          }
        )
      }
      assertCheckoutNotCompleting(session.checkout, 'update_checkout')
      const checkoutRequest = validateBody<UcpCheckoutUpdateRequest>(
        updateCheckoutValidator,
        request.checkout,
        'update_checkout'
      )
      assertNoRawPaymentCredentials(checkoutRequest)
      const operationRequest = {
        requestFingerprint,
        ...(request.expectedCheckoutSnapshotHash
          ? { checkoutSnapshotHash: request.expectedCheckoutSnapshotHash }
          : {}),
        checkout: checkoutRequest
      }
      if (idempotencyKeyHash) {
        await requireStore(store).recordOperation({
          transactionId,
          operation: 'update_checkout',
          idempotencyKeyHash,
          request: operationRequest,
          status: 'started'
        })
      }
      const auth = await authForSession(session, 'update_checkout')
      const checkoutResponse = await client.updateCheckout({
        negotiation: session.negotiation,
        checkoutId: session.checkoutId,
        ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
        body: checkoutRequest,
        ...(auth ? { auth } : {})
      }).catch(wrapReviewProtocolError)
      if (!isUcpCheckout(checkoutResponse)) {
        const businessError = responseFromBusinessError(checkoutResponse, session)
        if (idempotencyKeyHash) {
          await requireStore(store).recordOperation({
            transactionId,
            operation: 'update_checkout',
            idempotencyKeyHash,
            request: operationRequest,
            response: businessError,
            status: 'failed'
          })
        }
        return businessError
      }
      const checkout = checkoutResponse
      const updated = await updateStoredCheckout(transactionId, checkout, session)
      const response = responseFromSession(updated, platformProfileUrl)
      if (idempotencyKeyHash) {
        await requireStore(store).recordOperation({
          transactionId,
          operation: 'update_checkout',
          idempotencyKeyHash,
          request: operationRequest,
          response,
          status: 'succeeded'
        })
      }
      return response
    },

    async listPaymentHandlers(transactionId: string, principal: CommercePrincipal) {
      const session = await readSession(transactionId, principal)
      return {
        transactionId,
        checkout: redactUcpPayload(session.checkout),
        activeCapabilities: session.negotiation.capabilities,
        paymentHandlers: paymentHandlerRegistry.resolve({
          businessProfile: session.businessProfile,
          negotiatedPaymentHandlers: session.negotiation.paymentHandlers,
          checkout: session.checkout
        }),
        paymentCompletedByArro: false,
        primaryAction: checkoutPrimaryAction(session.checkout)
      }
    },

    async createEmbeddedCheckoutSession(
      transactionId: string,
      request: UcpCreateEmbeddedCheckoutSessionRequest
    ) {
      const session = await readSession(transactionId, request.principal)
      if (!hasEmbeddedCheckoutService(session)) {
        throw new UcpCheckoutServiceError(
          'ucp_embedded_checkout_unavailable',
          'Embedded Checkout is not available because the merchant did not negotiate an embedded checkout service for this purchase.',
          409,
          {
            primaryAction: checkoutPrimaryAction(session.checkout)
          }
        )
      }
      const embeddedSession = createEmbeddedCheckoutSession({
        transactionId,
        checkout: session.checkout,
        merchantOrigin: session.merchantOrigin,
        allowedOrigin: request.allowedOrigin
      })
      const payload: EmbeddedCheckoutSessionTokenPayload = {
        v: 1,
        session: embeddedSession,
        integrationId: session.integrationId,
        ...(session.ownerKeyId ? { ownerKeyId: session.ownerKeyId } : {}),
        ...(session.ownerPrincipalHash ? { ownerPrincipalHash: session.ownerPrincipalHash } : {}),
        ...(session.externalSubjectRefHash ? { externalSubjectRefHash: session.externalSubjectRefHash } : {}),
        ...(session.externalTaskRefHash ? { externalTaskRefHash: session.externalTaskRefHash } : {}),
        ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}),
        checkoutSnapshotHash: session.checkoutSnapshotHash,
        expiresAt: embeddedSession.expiresAt
      }
      const sessionToken = signEmbeddedCheckoutSessionToken(payload, paymentActionSigningSecret)
      await requireStore(store).recordEmbeddedCheckoutMessage({
        transactionId,
        embeddedSessionId: embeddedSession.sessionId,
        messageType: 'ec.session.create',
        origin: embeddedSession.allowedOrigin,
        payload: {
          session: embeddedSession,
          initParams: embeddedCheckoutInitParams(embeddedSession),
          checkoutSnapshotHash: session.checkoutSnapshotHash
        }
      })
      return {
        transactionId,
        checkout: redactUcpPayload(session.checkout),
        embeddedCheckout: {
          session: embeddedSession,
          sessionToken,
          initParams: embeddedCheckoutInitParams(embeddedSession),
          serviceConfig: {
            protocol: 'json-rpc-2.0',
            methods: ['ec.ready', 'ec.auth', 'ec.start', 'ec.complete', 'ec.error', 'ec.line_items.change', 'ec.buyer.change', 'ec.payment.change', 'ec.messages.change', 'ec.totals.change', 'ec.fulfillment.change'],
            completionAuthority: 'merchant_checkout_state'
          }
        },
        paymentCompletedByArro: false,
        primaryAction: checkoutPrimaryAction(session.checkout)
      }
    },

    async handleEmbeddedCheckoutMessage(
      request: UcpHandleEmbeddedCheckoutMessageRequest
    ) {
      const payload = verifyEmbeddedCheckoutSessionToken(request.sessionToken, paymentActionSigningSecret)
      if (request.transactionId && request.transactionId !== payload.session.transactionId) {
        throw new UcpCheckoutServiceError(
          'ucp_embedded_checkout_invalid',
          'Embedded Checkout session token does not match the requested purchase.',
          409
        )
      }
      const session = await readSession(payload.session.transactionId, request.principal)
      assertEmbeddedTokenMatchesSession(payload, session)
      let latestCheckout: UcpCheckout | undefined
      const refreshCheckout = async () => {
        const auth = await authForSession(session, 'get_checkout')
        const checkoutResponse = await client.getCheckout({
          negotiation: session.negotiation,
          checkoutId: session.checkoutId,
          ...(auth ? { auth } : {})
        }).catch(wrapProtocolError)
        if (!isUcpCheckout(checkoutResponse)) return undefined
        latestCheckout = checkoutResponse
        await updateStoredCheckout(session.transactionId, checkoutResponse, session)
        return checkoutResponse
      }

      const result = await (async () => {
        try {
          return await handleEmbeddedCheckoutJsonRpc({
            session: payload.session,
            origin: request.origin,
            message: request.message,
            currentCheckout: session.checkout,
            refreshCheckout
          })
        } catch (error) {
          if (error instanceof EmbeddedCheckoutProtocolError) {
            throw new UcpCheckoutServiceError(
              error.code === 'embedded_checkout_origin_invalid'
                ? 'ucp_embedded_checkout_invalid'
                : 'ucp_embedded_checkout_invalid',
              error.message,
              error.status,
              error.details
            )
          }
          throw error
        }
      })()
      if (result.shouldRefreshCheckout && !result.clientCompletionIgnored && !latestCheckout) {
        await refreshCheckout()
      }
      await requireStore(store).recordEmbeddedCheckoutMessage({
        transactionId: session.transactionId,
        embeddedSessionId: payload.session.sessionId,
        messageType: result.request.method,
        origin: request.origin,
        payload: {
          request: result.request,
          response: result.response,
          shouldRefreshCheckout: result.shouldRefreshCheckout,
          clientCompletionIgnored: result.clientCompletionIgnored
        }
      })
      return {
        transactionId: session.transactionId,
        embeddedSessionId: payload.session.sessionId,
        checkout: redactUcpPayload(latestCheckout ?? session.checkout),
        response: result.response,
        shouldRefreshCheckout: result.shouldRefreshCheckout,
        clientCompletionIgnored: result.clientCompletionIgnored,
        paymentCompletedByArro: false,
        primaryAction: checkoutPrimaryAction(latestCheckout ?? session.checkout)
      }
    },

    async createPaymentAction(
      transactionId: string,
      request: UcpCreatePaymentActionRequest
    ): Promise<PurchasePaymentActionResponse> {
      const session = await readSession(transactionId, request.principal)
      assertCheckoutAcceptsPaymentAuthority(session.checkout, 'ucp_payment_action_unavailable')
      const { selected, actionType, capability, presentation, trustedHostContext } = await choosePaymentRoute(session, request)
      const identity = selected.identity
      const idempotencyKey = stringValue(request.idempotencyKey)
      if (!idempotencyKey) {
        throw new UcpCheckoutServiceError(
          'ucp_idempotency_key_required',
          'Creating a payment action requires an idempotency key.',
          422
        )
      }
      const actionId = `${paymentActionIdPrefix}${createHash('sha256')
        .update(`${transactionId}:${request.principal.integrationId}:${idempotencyKey}`, 'utf8')
        .digest('hex')
        .slice(0, 32)}`
      const actionNonce = createHash('sha256')
        .update(`${actionId}:${session.checkoutSnapshotHash}:${idempotencyKey}`, 'utf8')
        .digest('base64url')
      const portableCapability = capability.portableCapability
      if ((actionType === 'x402' || actionType === 'mpp') && !portableCapability) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_unavailable',
          'Portable payment route lost its agent capability binding.',
          409
        )
      }
      const portableChallenge = actionType === 'x402' || actionType === 'mpp'
        ? await portablePaymentChallengeClient.acquire({
            protocol: actionType,
            declaration: selected.declaration,
            checkout: session.checkout,
            checkoutSnapshotHash: session.checkoutSnapshotHash,
            merchantOrigin: session.merchantOrigin,
            capability: portableCapability!,
            idempotencyKey
          }).catch((error) => {
            if (error instanceof PortablePaymentError) {
              throw new UcpCheckoutServiceError(
                'ucp_payment_action_unavailable',
                error.message,
                409,
                { reason: error.code, primaryAction: checkoutPrimaryAction(session.checkout) }
              )
            }
            throw error
          })
        : undefined
      const credentialExpiry = Date.now() + paymentCredentialTtlSeconds * 1000
      const challengeExpiry = portableChallenge ? new Date(portableChallenge.expiresAt).getTime() : credentialExpiry
      const expiresAt = new Date(Math.min(credentialExpiry, challengeExpiry)).toISOString()
      const requestedReturnUrl = request.returnUrl ?? request.executionDownscope?.returnUrl
      const requestedReturnOrigin = originOf(requestedReturnUrl)
      const effectiveReturnUrl = requestedReturnUrl && requestedReturnOrigin && trustedHostContext?.capabilities.allowedReturnOrigins?.includes(
        requestedReturnOrigin
      )
        ? requestedReturnUrl
        : undefined
      let actionPayload = paymentActionPayloadForRoute({
        actionType,
        checkout: session.checkout,
        handlerId: identity.handlerInstanceId,
        handlerName: selected.handlerName,
        handlerVersion: identity.version,
        handlerSpecification: identity.specification,
        handlerSchema: identity.schema,
        handlerConfig: asRecord(selected.declaration.config),
        provider: selected.handlerName,
        presentation,
        ...(request.preference ? { preference: request.preference } : {}),
        ...(effectiveReturnUrl ? { returnUrl: effectiveReturnUrl } : {}),
        merchantOrigin: session.merchantOrigin,
        ...(portableChallenge ? { portableChallenge } : {})
      })
      const providerSessionId = asRecord(actionPayload).providerSession && typeof asRecord(actionPayload).providerSession === 'object'
        ? stringValue(asRecord(asRecord(actionPayload).providerSession).sessionId)
        : undefined
      const actionAmount = paymentActionAmount(session.checkout)
      const durablePaymentRoute = capability.providerKind === 'stripe'
        ? 'processor_tokenizer'
        : capability.providerKind
      const action = await requireStore(store).createPaymentAction({
        actionId,
        transactionId,
        integrationId: session.integrationId,
        ...(session.ownerKeyId ? { ownerKeyId: session.ownerKeyId } : {}),
        ...(session.ownerPrincipalHash ? { ownerPrincipalHash: session.ownerPrincipalHash } : {}),
        ...(session.externalSubjectRefHash ? { externalSubjectRefHash: session.externalSubjectRefHash } : {}),
        ...(session.externalTaskRefHash ? { externalTaskRefHash: session.externalTaskRefHash } : {}),
        ...(session.agentSessionId ? { agentSessionId: session.agentSessionId } : {}),
        merchantOrigin: session.merchantOrigin,
        checkoutId: session.checkoutId,
        checkoutSnapshotHash: session.checkoutSnapshotHash,
        handlerId: identity.handlerInstanceId,
        handlerName: selected.handlerName,
        handlerVersion: identity.version,
        handlerSpecification: identity.specification,
        handlerSchema: identity.schema,
        provider: selected.handlerName,
        capabilityId: capability.capabilityId,
        ...(trustedHostContext?.hostId ? { connectorHostId: trustedHostContext.hostId } : {}),
        authorizationMode: durablePaymentRoute,
        route: durablePaymentRoute,
        presentation,
        ...(providerSessionId ? { providerSessionId } : {}),
        actionType,
        status: 'pending_user_approval',
        ...(actionAmount !== undefined ? { amount: actionAmount } : {}),
        currency: session.checkout.currency,
        tokenNonceHash: paymentActionNonceHash(actionNonce),
        actionPayload,
        expiresAt
      }).catch((error) => {
        if (error instanceof Error && error.message === 'ucp_payment_action_checkout_not_active') {
          throw new UcpCheckoutServiceError(
            'ucp_payment_action_unavailable',
            'Checkout changed while payment was being prepared. Refresh it before choosing a payment method.',
            409
          )
        }
        throw error
      })
      const actionToken = signPaymentActionToken(createPaymentActionTokenPayload({
        actionId: action.actionId,
        session,
        handlerId: action.handlerId,
        handlerName: action.handlerName,
        ...(action.handlerVersion ? { handlerVersion: action.handlerVersion } : {}),
        ...(action.handlerSpecification ? { handlerSpecification: action.handlerSpecification } : {}),
        ...(action.handlerSchema ? { handlerSchema: action.handlerSchema } : {}),
        provider: action.provider,
        ...(action.capabilityId ? { capabilityId: action.capabilityId } : {}),
        expiresAt: action.expiresAt,
        nonce: actionNonce
      }), paymentActionSigningSecret)

      await requireStore(store).recordOperation({
        transactionId,
        operation: 'create_payment_action',
        idempotencyKeyHash: hashScoped(idempotencyKey, hashPepper),
        request: {
          provider: selected.handlerName,
          handlerId: identity.handlerInstanceId,
          handlerName: selected.handlerName,
          actionType,
          presentation,
          capabilityId: capability.capabilityId,
          checkoutSnapshotHash: session.checkoutSnapshotHash
        },
        response: {
          actionId: action.actionId,
          status: action.status
        },
        status: 'succeeded'
      })

      return paymentActionResponseFromRecord({
        action,
        token: actionToken,
        publicBaseUrl
      })
    },

    async getPaymentAction(actionToken: string): Promise<PurchasePaymentActionResponse> {
      const payload = (() => {
        try {
          return verifyPaymentActionToken(actionToken, paymentActionSigningSecret)
        } catch (error) {
          return paymentActionError(error)
        }
      })()
      const action = await requireStore(store).readPaymentAction(payload.actionId)
      if (!action) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_invalid',
          'Payment action was not found.',
          404
        )
      }
      assertPaymentActionTokenMatchesRecord(payload, action)
      if (action.status === 'pending_user_approval') {
        const principal = principalFromPaymentActionPayload(payload)
        const session = await readSession(payload.transactionId, principal)
        if (
          session.checkoutId !== action.checkoutId ||
          session.checkoutSnapshotHash !== action.checkoutSnapshotHash ||
          (session.checkout.status !== 'incomplete' && session.checkout.status !== 'ready_for_complete')
        ) {
          await revokeChangedCheckoutAuthority(
            payload.transactionId,
            'snapshot_mismatch',
            action.checkoutSnapshotHash
          )
          throw new UcpCheckoutServiceError(
            'ucp_payment_action_invalid',
            'Payment action no longer matches the active merchant checkout.',
            409
          )
        }
      }
      if (action.status === 'pending_user_approval' && new Date(action.expiresAt).getTime() <= Date.now()) {
        await requireStore(store).markPaymentActionFailed({
          actionId: action.actionId
        })
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_expired',
          'Payment action has expired. Refresh the purchase to create a new action.',
          410
        )
      }
      return paymentActionResponseFromRecord({
        action,
        token: actionToken,
        publicBaseUrl
      })
    },

    async createPaymentActionSession(
      request: UcpCreatePaymentActionSessionRequest
    ): Promise<StripePaymentActionSession> {
      const payload = (() => {
        try {
          return verifyPaymentActionToken(request.actionToken, paymentActionSigningSecret)
        } catch (error) {
          return paymentActionError(error)
        }
      })()
      const action = await requireStore(store).readPaymentAction(payload.actionId)
      if (!action) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_invalid',
          'Payment action was not found.',
          404
        )
      }
      assertPaymentActionTokenMatchesRecord(payload, action)
      const recoveringApprovedStripeAction = action.status === 'approved'
      if (
        (action.status !== 'pending_user_approval' && !recoveringApprovedStripeAction) ||
        action.actionType !== 'processor_tokenizer' ||
        action.presentation !== 'host_native' ||
        asRecord(action.actionPayload).kind !== 'stripe_payment_sheet'
      ) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_unavailable',
          'This payment action does not expose a native Stripe PaymentSheet session.',
          409
        )
      }
      if (recoveringApprovedStripeAction && !action.providerReferenceId) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_invalid',
          'Approved Stripe payment action is missing its durable PaymentIntent binding.',
          409
        )
      }
      if (new Date(action.expiresAt).getTime() <= Date.now()) {
        await requireStore(store).markPaymentActionFailed({ actionId: action.actionId })
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_expired',
          'Payment action has expired. Refresh the purchase to create a new action.',
          410
        )
      }
      if (!stripeNativePaymentSessionClient) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_unavailable',
          'Native Stripe payment is not configured for this runtime.',
          503
        )
      }

      const principal = principalFromPaymentActionPayload(payload)
      const localSession = await readSession(payload.transactionId, principal)
      if (
        localSession.checkoutId !== action.checkoutId ||
        localSession.checkoutSnapshotHash !== action.checkoutSnapshotHash ||
        (localSession.checkout.status !== 'incomplete' && localSession.checkout.status !== 'ready_for_complete')
      ) {
        await revokeChangedCheckoutAuthority(
          payload.transactionId,
          'snapshot_mismatch',
          action.checkoutSnapshotHash
        )
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_invalid',
          'Payment action no longer matches the active merchant checkout.',
          409
        )
      }

      const checkoutAuth = await authForSession(localSession, 'get_checkout')
      const merchantCheckout = await client.getCheckout({
        negotiation: localSession.negotiation,
        checkoutId: localSession.checkoutId,
        ...(checkoutAuth ? { auth: checkoutAuth } : {})
      }).catch(wrapProtocolError)
      if (!isUcpCheckout(merchantCheckout)) {
        throw new UcpCheckoutServiceError(
          'ucp_protocol_error',
          'Merchant checkout could not be refreshed before opening Stripe.',
          502,
          merchantCheckout
        )
      }
      const merchantSnapshotHash = ucpCheckoutSnapshotHash(merchantCheckout)
      await updateStoredCheckout(payload.transactionId, merchantCheckout, localSession)
      if (merchantSnapshotHash !== action.checkoutSnapshotHash) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_invalid',
          'Checkout changed before Stripe opened. Review the current total and try again.',
          409,
          {
            actionCheckoutSnapshotHash: action.checkoutSnapshotHash,
            merchantCheckoutSnapshotHash: merchantSnapshotHash
          }
        )
      }

      const support = paymentHandlerRegistry.resolve({
        businessProfile: localSession.businessProfile,
        negotiatedPaymentHandlers: localSession.negotiation.paymentHandlers,
        checkout: merchantCheckout
      }).find((candidate) =>
        candidate.supported &&
        candidate.handlerName === action.handlerName &&
        candidate.identity.handlerInstanceId === action.handlerId &&
        candidate.identity.version === action.handlerVersion &&
        candidate.identity.specification === action.handlerSpecification &&
        candidate.identity.schema === action.handlerSchema
      )
      if (!support?.supported) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_unavailable',
          'The merchant no longer advertises the Stripe handler selected for this checkout.',
          409
        )
      }

      const session = await stripeNativePaymentSessionClient.create({
        action,
        checkout: merchantCheckout,
        declaration: support.declaration
      }).catch((error) => {
        if (error instanceof StripeNativePaymentError) {
          throw new UcpCheckoutServiceError(
            'ucp_payment_action_unavailable',
            error.message,
            error.code === 'stripe_native_auth_missing' ? 503 : 502,
            { reason: error.code }
          )
        }
        throw error
      })
      if (
        action.providerReferenceId &&
        action.providerReferenceId !== session.paymentIntentId
      ) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_invalid',
          'Merchant returned a different Stripe PaymentIntent for an existing action.',
          409
        )
      }
      if (!recoveringApprovedStripeAction) {
        const bind = requireStore(store).bindPaymentActionProviderReference
        if (!bind) {
          throw new UcpCheckoutServiceError(
            'ucp_runtime_store_required',
            'Native Stripe payment requires durable provider-reference binding.',
            503
          )
        }
        const bound = await bind.call(requireStore(store), {
          actionId: action.actionId,
          providerReferenceId: session.paymentIntentId
        })
        if (!bound) {
          throw new UcpCheckoutServiceError(
            'ucp_payment_action_replayed',
            'Payment action changed before its Stripe session could be bound.',
            409
          )
        }
      }
      return session
    },

    async recordPaymentActionResult(
      request: UcpRecordPaymentActionResultRequest
    ): Promise<unknown> {
      const payload = (() => {
        try {
          return verifyPaymentActionToken(request.actionToken, paymentActionSigningSecret)
        } catch (error) {
          return paymentActionError(error)
        }
      })()
      const action = await requireStore(store).readPaymentAction(payload.actionId)
      if (!action) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_invalid',
          'Payment action was not found.',
          404
        )
      }
      assertPaymentActionTokenMatchesRecord(payload, action)
      const isStripeAction = asRecord(action.actionPayload).kind === 'stripe_payment_sheet'
      const isStripeResult = request.result.type === 'stripe_payment_intent'
      if (isStripeAction !== isStripeResult) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_invalid',
          'Payment result type does not match the exact native payment action.',
          409
        )
      }
      const recoverableStripeStatus = isStripeResult && (
        action.status === 'approved' ||
        action.status === 'credential_ready' ||
        action.status === 'consumed'
      )
      if (action.status !== 'pending_user_approval' && !recoverableStripeStatus) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_replayed',
          'Payment action has already been used, revoked, failed, or expired.',
          409
        )
      }
      if (new Date(action.expiresAt).getTime() <= Date.now()) {
        await requireStore(store).markPaymentActionFailed({
          actionId: action.actionId
        })
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_expired',
          'Payment action has expired. Refresh the purchase to create a new action.',
          410
        )
      }
      if (request.result.type === 'stripe_payment_intent') {
        if (
          asRecord(action.actionPayload).kind !== 'stripe_payment_sheet' ||
          !action.providerReferenceId ||
          request.result.paymentIntentId !== action.providerReferenceId
        ) {
          throw new UcpCheckoutServiceError(
            'ucp_payment_action_invalid',
            'Stripe result does not match the PaymentIntent bound to this payment action.',
            409
          )
        }
      }

      const principal = principalFromPaymentActionPayload(payload)
      const localSession = await readSession(payload.transactionId, principal)
      if (
        localSession.checkoutId !== action.checkoutId ||
        localSession.checkoutSnapshotHash !== action.checkoutSnapshotHash
      ) {
        await revokeChangedCheckoutAuthority(
          payload.transactionId,
          'snapshot_mismatch',
          action.checkoutSnapshotHash
        )
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_invalid',
          'Payment action no longer matches the current local checkout snapshot.',
          409,
          {
            actionCheckoutSnapshotHash: action.checkoutSnapshotHash,
            currentCheckoutSnapshotHash: localSession.checkoutSnapshotHash
          }
        )
      }
      if (
        localSession.checkout.status !== 'incomplete' &&
        localSession.checkout.status !== 'ready_for_complete' &&
        action.status !== 'consumed'
      ) {
        await revokeChangedCheckoutAuthority(
          payload.transactionId,
          'snapshot_mismatch',
          action.checkoutSnapshotHash
        )
        assertCheckoutAcceptsPaymentAuthority(
          localSession.checkout,
          'ucp_payment_action_unavailable'
        )
      }

      if (action.status === 'credential_ready' || action.status === 'consumed') {
        return {
          ...responseFromSession(localSession, platformProfileUrl),
          paymentAction: paymentActionResponseFromRecord({
            action,
            publicBaseUrl
          })
        }
      }

      const checkoutAuth = await authForSession(localSession, 'get_checkout')
      const merchantCheckoutResponse = await client.getCheckout({
        negotiation: localSession.negotiation,
        checkoutId: localSession.checkoutId,
        ...(checkoutAuth ? { auth: checkoutAuth } : {})
      }).catch(wrapProtocolError)
      if (!isUcpCheckout(merchantCheckoutResponse)) {
        throw new UcpCheckoutServiceError(
          'ucp_protocol_error',
          'Merchant checkout could not be refreshed before accepting payment authority.',
          502,
          merchantCheckoutResponse
        )
      }
      const merchantCheckoutSnapshotHash = ucpCheckoutSnapshotHash(merchantCheckoutResponse)
      await updateStoredCheckout(
        payload.transactionId,
        merchantCheckoutResponse,
        localSession
      )
      if (merchantCheckoutSnapshotHash !== action.checkoutSnapshotHash) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_invalid',
          'Payment action no longer matches the merchant checkout snapshot.',
          409,
          {
            actionCheckoutSnapshotHash: action.checkoutSnapshotHash,
            merchantCheckoutSnapshotHash
          }
        )
      }

      const approved = action.status === 'approved'
        ? action
        : await requireStore(store).markPaymentActionApproved({
            actionId: action.actionId
          })
      if (!approved) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_replayed',
          'Payment action approval was already consumed, revoked, failed, or expired.',
          409
        )
      }

      const response = await recordPaymentProviderResult(payload.transactionId, {
        principal,
        idempotencyKey: request.idempotencyKey,
        provider: payload.provider,
        expectedHandlerId: payload.handlerId,
        expectedActionId: payload.actionId,
        checkoutSnapshotHash: payload.checkoutSnapshotHash,
        ...(payload.capabilityId ? { capabilityId: payload.capabilityId } : {}),
        paymentActionNonceHash: action.tokenNonceHash,
        paymentActionPayload: action.actionPayload,
        paymentActionExpiresAt: action.expiresAt,
        result: request.result
      }).catch(async (error) => {
        const retryableStripeFailure = isStripeResult && (
          !(error instanceof UcpCheckoutServiceError) || error.status >= 500
        )
        if (!retryableStripeFailure) {
          await requireStore(store).markPaymentActionFailed({
            actionId: action.actionId,
            resultFingerprint: fingerprint({
              provider: payload.provider,
              result: request.result
            })
          })
        }
        throw error
      })

      const paymentResult = asRecord(asRecord(response).paymentResult)
      const paymentResultId = stringValue(paymentResult.paymentResultId)
      const resultFingerprint = stringValue(paymentResult.resultFingerprint)
      if (!paymentResultId || !resultFingerprint) {
        await requireStore(store).markPaymentActionFailed({
          actionId: action.actionId
        })
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_invalid',
          'Payment action result did not produce durable payment-result continuity.',
          500
        )
      }
      const completed = await requireStore(store).markPaymentActionCredentialReady({
        actionId: action.actionId,
        paymentResultId,
        resultFingerprint
      })
      if (!completed) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_action_replayed',
          'Payment action could not be consumed exactly once.',
          409
        )
      }
      return {
        ...response,
        paymentAction: paymentActionResponseFromRecord({
          action: completed,
          publicBaseUrl
        })
      }
    },

    async preparePaymentInstrument(transactionId: string, body: unknown, principal: CommercePrincipal) {
      const session = await readSession(transactionId, principal)
      assertCheckoutAcceptsPaymentAuthority(session.checkout, 'ucp_payment_action_unavailable')
      const handlerName = stringValue(asRecord(body).handlerName) ?? 'merchant_hosted_continuation'
      const support = paymentHandlerRegistry.resolve({
        businessProfile: session.businessProfile,
        negotiatedPaymentHandlers: session.negotiation.paymentHandlers,
        checkout: session.checkout
      }).find((candidate) => candidate.handlerName === handlerName)

      if (!support?.supported) {
        return {
          transactionId,
          prepared: false,
          handlerName,
          reason: support?.reason ?? 'Requested UCP payment handler is not supported by Arro.',
          primaryAction: checkoutPrimaryAction(session.checkout),
          paymentCompletedByArro: false
        }
      }

      if (support.executionMode === 'merchant_hosted') {
        return {
          transactionId,
          prepared: true,
          handlerName,
          executionMode: support.executionMode,
          instrumentRequiredByArro: false,
          primaryAction: checkoutPrimaryAction(session.checkout),
          paymentCompletedByArro: false
        }
      }

      const adapter = paymentHandlerRegistry.adapters.find((candidate) =>
        candidate.handlerName === handlerName &&
        candidate.supports(support.declaration)
      )
      const preparedAction = adapter?.acquireInstrument
        ? await adapter.acquireInstrument({
            declaration: support.declaration,
            checkout: session.checkout
          })
        : undefined

      return {
        transactionId,
        prepared: true,
        handlerName,
        executionMode: support.executionMode,
        instrumentRequiredByArro: true,
        ...(preparedAction !== undefined ? { paymentAction: redactUcpPayload(preparedAction) } : {}),
        instruction: 'Submit only an externally tokenized UCP payment instrument. Do not send raw card data to Arro.',
        paymentCompletedByArro: false
      }
    },

    async recordPaymentResult(transactionId: string, request: UcpRecordPaymentResultRequest) {
      return recordPaymentProviderResult(transactionId, request)
    },

    async readLatestPaymentExecutionAuthority(transactionId: string, principal: CommercePrincipal): Promise<PaymentExecutionAuthority | undefined> {
      const session = await readSession(transactionId, principal)
      // Redis credentials are consume-once. Never destroy one merely to learn
      // that the merchant was still waiting for address, delivery, or review.
      assertCheckoutReadyForComplete(session.checkout)
      const paymentResult = await requireStore(store).readLatestPaymentResult(
        transactionId,
        session.checkoutSnapshotHash
      )
      if (!paymentResult) return undefined
      const reference = vaultReferenceFromInstrument(paymentResult.instrument)
      if (
        paymentResult.checkoutSnapshotHash !== session.checkoutSnapshotHash ||
        paymentResult.revokedAt !== undefined
      ) {
        if (reference && paymentCredentialVault) {
          await paymentCredentialVault.revoke(reference)
        }
        await revokeStoredPaymentAuthorities(
          transactionId,
          'snapshot_mismatch',
          paymentResult.checkoutSnapshotHash
        )
        throw new UcpCheckoutServiceError(
          'ucp_payment_result_invalid',
          'Stored payment authority does not match the current checkout snapshot.',
          409,
          {
            paymentCheckoutSnapshotHash: paymentResult.checkoutSnapshotHash,
            currentCheckoutSnapshotHash: session.checkoutSnapshotHash
          }
        )
      }
      if (reference) {
        if (!paymentCredentialVault) {
          throw new UcpCheckoutServiceError(
            'ucp_payment_credential_vault_required',
            'Stored payment result references a payment credential vault, but no vault is configured.',
            503
          )
        }
        const vaulted = await paymentCredentialVault.consume(reference)
        if (!vaulted) {
          throw new UcpCheckoutServiceError(
            'ucp_payment_result_invalid',
            'Payment credential is unavailable or expired. Reacquire a fresh provider result before completing checkout.',
            409,
            {
              code: 'payment_result_credential_expired'
            }
          )
        }
        if (paymentInstrumentCredentialExpired(vaulted.instrument)) {
          throw new UcpCheckoutServiceError(
            'ucp_payment_result_invalid',
            'Payment credential has expired. Reacquire a fresh provider result before completing checkout.',
            409,
            {
              code: 'payment_result_credential_expired'
            }
          )
        }
        return vaulted
      }
      if (credentialRecord(paymentResult.instrument).redacted === true) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_result_invalid',
          'Stored payment result is redacted and cannot be used for checkout completion without a vault reference.',
          409,
          {
            code: 'payment_result_credential_expired'
          }
        )
      }
      if (paymentInstrumentCredentialExpired(paymentResult.instrument)) {
        throw new UcpCheckoutServiceError(
          'ucp_payment_result_invalid',
          'Stored payment credential has expired. Reacquire a fresh provider result before completing checkout.',
          409,
          {
            code: 'payment_result_credential_expired'
          }
        )
      }
      return { instrument: paymentResult.instrument }
    },

    async confirmCheckout(transactionId: string, request: UcpConfirmCheckoutRequest) {
      const session = await readSession(transactionId, request.principal)
      const approvalRef = stringValue(request.approvalRef)
      if (!approvalRef) {
        throw new UcpCheckoutServiceError(
          'ucp_invalid_request',
          'approvalRef is required to confirm the current UCP checkout snapshot.',
          422
        )
      }

      const currentSnapshotHash = ucpCheckoutSnapshotHash(session.checkout)
      const approvedSnapshotHash = stringValue(request.checkoutSnapshotHash)
      if (!approvedSnapshotHash) {
        throw new UcpCheckoutServiceError(
          'ucp_invalid_request',
          'checkoutSnapshotHash is required so approval is bound to the exact Checkout the buyer reviewed.',
          422
        )
      }
      if (approvedSnapshotHash !== currentSnapshotHash) {
        throw new UcpCheckoutServiceError(
          'ucp_checkout_confirmation_mismatch',
          'The confirmation did not match the current UCP checkout snapshot.',
          409
        )
      }

      const total = session.checkout.totals.find((entry) => entry.type === 'total')
      const confirmation = await requireStore(store).recordConfirmation({
        transactionId,
        confirmation: {
          checkoutId: session.checkoutId,
          checkoutSnapshotHash: currentSnapshotHash,
          ...(typeof total?.amount === 'number' ? { totalAmount: total.amount } : {}),
          ...(typeof total?.currency === 'string' ? { currency: total.currency } : {}),
          approvedAt: request.approvedAt ?? new Date().toISOString(),
          approvalRef
        },
        approvalPayload: request
      })

      return {
        transactionId,
        confirmation,
        checkout: redactUcpPayload(session.checkout),
        paymentCompletedByArro: false,
        primaryAction: checkoutPrimaryAction(session.checkout)
      }
    },

    async completeCheckout(transactionId: string, request: UcpCompleteCheckoutRequest) {
      const session = await readSession(transactionId, request.principal)
      assertCheckoutReadyForComplete(session.checkout)
      const idempotencyKey = stringValue(request.idempotencyKey)
      if (!idempotencyKey) {
        throw new UcpCheckoutServiceError(
          'ucp_idempotency_key_required',
          'Completing a UCP checkout requires an idempotency key.',
          422
        )
      }

      assertNoRawPaymentCredentials(request.checkout)
      const confirmation = await requireStore(store).readConfirmation(transactionId)
      const currentSnapshotHash = ucpCheckoutSnapshotHash(session.checkout)
      if (!confirmation) {
        throw new UcpCheckoutServiceError(
          'ucp_checkout_confirmation_required',
          'The buyer must explicitly approve the current merchant checkout snapshot before Arro can call UCP complete_checkout.',
          403
        )
      }
      if (confirmation.checkoutSnapshotHash !== currentSnapshotHash) {
        throw new UcpCheckoutServiceError(
          'ucp_checkout_confirmation_mismatch',
          'The stored buyer approval no longer matches the current merchant checkout snapshot. Refresh and confirm again.',
          409
        )
      }

      const checkoutRequest = validateBody<UcpCheckoutCompleteRequest>(
        completeCheckoutValidator,
        request.checkout,
        'complete_checkout'
      )
      await assertCheckoutCompletionAuthority({
        body: checkoutRequest,
        session,
        store: requireStore(store),
        ap2TrustedIssuers,
        ...(request.ap2Authority ? { ap2Authority: request.ap2Authority } : {})
      })
      const idempotencyKeyHash = hashScoped(idempotencyKey, hashPepper)
      await requireStore(store).recordOperation({
        transactionId,
        operation: 'complete_checkout',
        idempotencyKeyHash,
        request: checkoutRequest,
        status: 'started'
      })

      try {
        const auth = await authForSession(session, 'complete_checkout')
        const checkoutResponse = await client.completeCheckout({
          negotiation: session.negotiation,
          checkoutId: session.checkoutId,
          idempotencyKey,
          body: checkoutRequest,
          ...(auth ? { auth } : {})
        })
        if (!isUcpCheckout(checkoutResponse)) {
          await requireStore(store).recordOperation({
            transactionId,
            operation: 'complete_checkout',
            idempotencyKeyHash,
            request: checkoutRequest,
            response: checkoutResponse,
            status: 'failed'
          })
          return responseFromBusinessError(checkoutResponse, session)
        }
        const checkout = checkoutResponse
        const updated = await updateStoredCheckout(transactionId, checkout, session, true)
        await requireStore(store).recordOperation({
          transactionId,
          operation: 'complete_checkout',
          idempotencyKeyHash,
          request: checkoutRequest,
          response: checkout,
          status: 'succeeded'
        })

        if (checkout.order?.id) {
          const orderAuth = await authForSession(session, 'get_order')
          const order = await client.getOrder({
            negotiation: session.negotiation,
            orderId: checkout.order.id,
            ...(orderAuth ? { auth: orderAuth } : {})
          }).catch(() => undefined)
          if (order) {
            await requireStore(store).recordOrder({
              transactionId,
              merchantOrigin: session.merchantOrigin,
              order
            })
          }
        }

        return responseFromSession(
          updated,
          platformProfileUrl,
          checkout.status === 'completed'
        )
      } catch (error) {
        const auth = await authForSession(session, 'get_checkout')
        const recovered = await client.getCheckout({
          negotiation: session.negotiation,
          checkoutId: session.checkoutId,
          ...(auth ? { auth } : {})
        }).catch(() => undefined)
        await requireStore(store).recordOperation({
          transactionId,
          operation: 'complete_checkout',
          idempotencyKeyHash,
          request: checkoutRequest,
          response: recovered ?? asProtocolDetails(error),
          status: recovered ? 'unknown_outcome' : 'failed'
        })
        if (recovered && isUcpCheckout(recovered)) {
          const updated = await updateStoredCheckout(transactionId, recovered, session, true)
          return responseFromSession(
            updated,
            platformProfileUrl,
            recovered.status === 'completed'
          )
        }
        if (recovered) return responseFromBusinessError(recovered, session)
        wrapProtocolError(error)
      }
    },

    async cancelCheckout(transactionId: string, request: UcpCancelCheckoutRequest) {
      const session = await readSession(transactionId, request.principal)
      const idempotencyKey = stringValue(request.idempotencyKey)
      if (!idempotencyKey) {
        throw new UcpCheckoutServiceError(
          'ucp_idempotency_key_required',
          'Canceling a UCP checkout requires an idempotency key.',
          422
        )
      }

      const reason = stringValue(request.reason)
      const revokeLocalCancellationState = () =>
        Promise.all([
          requireStore(store).revokePendingPaymentActions({
            transactionId,
            reason: 'purchase_canceled'
          }),
          requireStore(store).invalidateAp2Authorities({
            transactionId,
            reason: 'purchase_canceled'
          }),
          revokeStoredPaymentAuthorities(transactionId, 'purchase_canceled')
        ])
      try {
        if (session.cartId) {
          const cartRequest = validateBody<UcpCartCancelRequest>(
            cancelCartValidator,
            reason ? { reason } : {},
            'cancel_cart'
          )
          const cartAuth = await authForSession(session, 'cancel_cart')
          const cartResponse = await client.cancelCart({
            negotiation: session.negotiation,
            cartId: session.cartId,
            idempotencyKey: `${idempotencyKey}:cart`,
            body: cartRequest,
            ...(cartAuth ? { auth: cartAuth } : {})
          }).catch(wrapProtocolError)
          if (isUcpCart(cartResponse)) {
            await updateStoredCart(transactionId, cartResponse)
            await requireStore(store).recordOperation({
              transactionId,
              operation: 'cancel_cart',
              idempotencyKeyHash: hashScoped(`${idempotencyKey}:cart`, hashPepper),
              request: cartRequest,
              response: cartResponse,
              status: 'succeeded'
            })
          } else {
            await revokeLocalCancellationState()
            return responseFromBusinessError(cartResponse, session)
          }
        }
        const auth = await authForSession(session, 'cancel_checkout')
        const checkoutResponse = await client.cancelCheckout({
          negotiation: session.negotiation,
          checkoutId: session.checkoutId,
          idempotencyKey,
          body: reason ? { reason } : {},
          ...(auth ? { auth } : {})
        }).catch(wrapProtocolError)
        if (!isUcpCheckout(checkoutResponse)) {
          await revokeLocalCancellationState()
          return responseFromBusinessError(checkoutResponse, session)
        }
        const checkout = checkoutResponse
        const updated = await updateStoredCheckout(transactionId, checkout, session)
        await requireStore(store).recordOperation({
          transactionId,
          operation: 'cancel_checkout',
          idempotencyKeyHash: hashScoped(idempotencyKey, hashPepper),
          request: reason ? { reason } : {},
          response: checkout,
          status: 'succeeded'
        })
        await revokeLocalCancellationState()
        return responseFromSession(updated, platformProfileUrl)
      } catch (error) {
        await revokeLocalCancellationState()
        throw error
      }
    },

    async recordAp2Receipts(transactionId: string, request: {
      principal: CommercePrincipal
      checkoutReceipt?: string
      paymentReceipt?: string
    }) {
      const session = await readSession(transactionId, request.principal)
      if (!Object.hasOwn(session.negotiation.capabilities, UCP_AP2_MANDATE_CAPABILITY)) {
        throw new UcpCheckoutServiceError(
          'ucp_invalid_request',
          'AP2 receipts are accepted only for a Checkout session that negotiated AP2 authority.',
          422
        )
      }
      if (!request.checkoutReceipt && !request.paymentReceipt) {
        throw new UcpCheckoutServiceError(
          'ucp_invalid_request',
          'At least one signed AP2 Checkout Receipt or Payment Receipt is required.',
          422
        )
      }
      try {
        const checkout = request.checkoutReceipt
          ? await verifyAndRecordAp2Receipt({
              transactionId,
              kind: 'checkout',
              receiptJwt: request.checkoutReceipt,
              trustedIssuers: ap2TrustedIssuers,
              store: requireStore(store)
            })
          : undefined
        const payment = request.paymentReceipt
          ? await verifyAndRecordAp2Receipt({
              transactionId,
              kind: 'payment',
              receiptJwt: request.paymentReceipt,
              trustedIssuers: ap2TrustedIssuers,
              store: requireStore(store)
            })
          : undefined
        return {
          transactionId,
          ...(checkout ? { checkoutReceipt: checkout.receipt } : {}),
          ...(payment ? { paymentReceipt: payment.receipt } : {})
        }
      } catch (error) {
        if (error instanceof Ap2ReceiptError) {
          throw new UcpCheckoutServiceError(
            'ucp_invalid_request',
            error.message,
            error.code === 'ap2_receipt_conflict' ? 409 : 422,
            { code: error.code }
          )
        }
        throw error
      }
    },

    async getOrder(orderId: string, transactionId: string, principal: CommercePrincipal) {
      const stored = await requireStore(store).readOrderForPrincipal(orderId, transactionId, principal)
      if (stored) return { order: redactUcpPayload(stored), source: 'local_order_store' }
      throw new UcpCheckoutServiceError(
        'ucp_transaction_not_found',
        'UCP order was not found for this purchase in Arro order continuity storage.',
        404
      )
    },

    async receiveOrderWebhook(input: {
      headers: Record<string, string>
      rawBody: string
      merchantOrigin: string
      method: string
      path: string
      now?: Date
    }) {
      const contentDigest = input.headers['content-digest']
      const signatureInput = input.headers['signature-input']
      const signature = input.headers.signature
      const webhookId = input.headers['webhook-id']
      const webhookTimestamp = input.headers['webhook-timestamp']
      const ucpAgent = input.headers['ucp-agent']
      if (!contentDigest || !signatureInput || !signature || !webhookId || !webhookTimestamp || !ucpAgent) {
        throw new UcpCheckoutServiceError(
          'ucp_invalid_request',
          'UCP order webhook is missing required signature, digest, identity, or timestamp headers.',
          400
        )
      }
      if (!digestMatches(contentDigest, input.rawBody)) {
        throw new UcpCheckoutServiceError(
          'ucp_webhook_digest_invalid',
          'UCP order webhook Content-Digest does not match the request body.',
          400
        )
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(input.rawBody) as unknown
      } catch {
        throw new UcpCheckoutServiceError('ucp_invalid_request', 'UCP order webhook body is not valid JSON.', 400)
      }
      const order = validateBody<UcpOrder>(orderValidator, parsed, 'order_webhook')
      const timestampSeconds = Number(webhookTimestamp)
      const now = input.now ?? new Date()
      if (
        !Number.isInteger(timestampSeconds) ||
        Math.abs(now.getTime() - timestampSeconds * 1000) > webhookFreshnessMs
      ) {
        throw new UcpCheckoutServiceError(
          'ucp_webhook_timestamp_invalid',
          'UCP order webhook Webhook-Timestamp must be a fresh Unix timestamp.',
          400
        )
      }

      const session = await requireStore(store).readSessionByCheckout({
        merchantOrigin: input.merchantOrigin,
        checkoutId: order.checkout_id
      })
      if (!session) {
        throw new UcpCheckoutServiceError(
          'ucp_webhook_order_not_bound',
          'UCP order webhook does not match a persisted Arro checkout session for this merchant.',
          404
        )
      }

      const verified = verifyHttpMessageSignature({
        businessProfile: session.businessProfile,
        headers: input.headers,
        method: input.method,
        path: input.path,
        now
      })
      if (!verified) {
        throw new UcpCheckoutServiceError(
          'ucp_webhook_signature_invalid',
          'UCP order webhook signature verification failed.',
          401
        )
      }

      const stored = await requireStore(store).recordOrderWebhook({
        merchantOrigin: input.merchantOrigin,
        webhookId,
        webhookTimestamp,
        ucpAgent,
        contentDigest,
        signatureInput,
        signature,
        order,
        signatureVerified: true
      })

      return {
        accepted: true,
        order: redactUcpPayload(stored)
      }
    }
  }
}

export type UcpCheckoutService = ReturnType<typeof createUcpCheckoutService>
