import { Type, type Static } from '@sinclair/typebox'
import { AgentInvocationContextSchema } from './agent.ts'
import { UCP_STABLE_VERSION } from './ucp-version.ts'
import {
  UcpBuyerSchema,
  UcpCheckoutCreateRequestSchema,
  UcpCheckoutStatusSchema,
  UcpCheckoutUpdateRequestSchema,
  UcpFulfillmentSchema,
  UcpJsonObjectSchema,
  UcpLinkSchema,
  UcpMoneyAmountSchema,
  UcpPolicySchema
} from './ucp.ts'

const PurchaseRefSchema = Type.String({ minLength: 1, maxLength: 256 })

export const PortablePaymentProtocolSchema = Type.Union([
  Type.Literal('x402'),
  Type.Literal('mpp')
])

export const PortablePaymentCapabilitySchema = Type.Object(
  {
    protocol: PortablePaymentProtocolSchema,
    version: Type.String({ minLength: 1, maxLength: 80 }),
    methods: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      minItems: 1,
      maxItems: 32,
      uniqueItems: true
    })),
    intents: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      minItems: 1,
      maxItems: 16,
      uniqueItems: true
    })),
    networks: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
      minItems: 1,
      maxItems: 32,
      uniqueItems: true
    })),
    assets: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      minItems: 1,
      maxItems: 64,
      uniqueItems: true
    }))
  },
  { additionalProperties: false }
)

export const PurchaseAcceptedPaymentCapabilitySchema = Type.Object(
  {
    protocol: Type.String({ minLength: 1, maxLength: 80 }),
    version: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    methods: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 32 })),
    intents: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { maxItems: 16 })),
    networks: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { maxItems: 32 })),
    assets: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 64 })),
    autonomous: Type.Boolean()
  },
  { additionalProperties: false }
)

export const PurchaseExecutionLevelSchema = Type.Union([
  Type.Literal('direct_payment'),
  Type.Literal('hosted_checkout'),
  Type.Literal('cart_permalink'),
  Type.Literal('product_permalink'),
  Type.Literal('discovery_only')
])

export const PurchaseStateSchema = Type.Union([
  Type.Literal('review_required'),
  Type.Literal('payment_action_required'),
  Type.Literal('merchant_continuation_required'),
  Type.Literal('ready_for_autonomous_completion'),
  Type.Literal('completed'),
  Type.Literal('unavailable'),
  Type.Literal('canceled')
])

export const EmbeddedCheckoutPresentationSchema = Type.Object({
  type: Type.Literal('ucp_embedded'),
  version: Type.Literal(UCP_STABLE_VERSION),
  checkoutId: Type.String({ minLength: 1, maxLength: 256 })
}, { additionalProperties: false })

export const PurchaseActionSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal('review_purchase'),
      Type.Literal('review_cart'),
      Type.Literal('approve_payment_action'),
      Type.Literal('provide_payment'),
      Type.Literal('continue_on_merchant'),
      Type.Literal('confirm_purchase'),
      Type.Literal('refresh_purchase'),
      Type.Literal('cancel_purchase'),
      Type.Literal('view_order'),
      Type.Literal('complete_ucp_action')
    ]),
    label: Type.String({ minLength: 1, maxLength: 160 }),
    url: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    presentation: Type.Optional(Type.Union([
      EmbeddedCheckoutPresentationSchema,
      Type.Object({ type: Type.Literal('native_checkout'), provider: Type.Literal('shopify') }, { additionalProperties: false }),
      Type.Object({ type: Type.Literal('browser') }, { additionalProperties: false })
    ])),
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 320 }))
  },
  { additionalProperties: false }
)

export const PurchasePendingActionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    type: Type.String({ minLength: 1, maxLength: 256 }),
    presentation: Type.Union([
      Type.Literal('hidden_browser'),
      Type.Literal('visible_browser'),
      Type.Literal('render_artifact'),
      Type.Literal('unsupported')
    ]),
    executable: Type.Boolean(),
    extensionVersion: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    paymentInstrumentId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    url: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
    allowedOrigins: Type.Optional(Type.Array(
      Type.String({ minLength: 1, maxLength: 2048 }),
      { minItems: 1, maxItems: 32, uniqueItems: true }
    )),
    artifact: Type.Optional(Type.Object(
      {
        type: Type.String({ minLength: 1, maxLength: 160 }),
        code: Type.Optional(Type.String({ minLength: 1, maxLength: 16384 })),
        image: Type.Optional(Type.String({ minLength: 1, maxLength: 1500000 })),
        instructionsUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
        reference: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
        expiresAt: Type.Optional(Type.String({ minLength: 1, maxLength: 80 }))
      },
      { additionalProperties: false }
    )),
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 420 }))
  },
  { additionalProperties: false }
)

export const PurchaseMerchantSummarySchema = Type.Object(
  {
    merchantId: Type.String({ minLength: 1, maxLength: 256 }),
    canonicalOrigin: Type.String({ minLength: 1, maxLength: 2048 }),
    profileUrl: Type.String({ minLength: 1, maxLength: 2048 }),
    displayName: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    platform: Type.Optional(Type.String({ minLength: 1, maxLength: 80 }))
  },
  { additionalProperties: false }
)

export const PurchaseItemSummarySchema = Type.Object(
  {
    lineItemId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    itemId: Type.String({ minLength: 1, maxLength: 256 }),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    quantity: Type.Optional(Type.Integer({ minimum: 0 })),
    url: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 }))
  },
  { additionalProperties: false }
)

export const PurchasePaymentSummarySchema = Type.Object(
  {
    completedByArro: Type.Boolean(),
    selectedHandlerId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    executionLevel: PurchaseExecutionLevelSchema,
    actionId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    actionStatus: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    provider: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    capabilityId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    display: Type.Optional(UcpJsonObjectSchema),
    acceptedCapabilities: Type.Optional(Type.Array(PurchaseAcceptedPaymentCapabilitySchema, {
      maxItems: 32
    }))
  },
  { additionalProperties: false }
)

export const PurchaseCartSummarySchema = Type.Object(
  {
    cartId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    status: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    checkoutId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    continueUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    snapshotHash: Type.Optional(Type.String({ pattern: '^sha256:[0-9a-f]{64}$' }))
  },
  { additionalProperties: false }
)

export const PurchaseMessageSchema = Type.Object(
  {
    severity: Type.Union([
      Type.Literal('info'),
      Type.Literal('warning'),
      Type.Literal('blocked')
    ]),
    text: Type.String({ minLength: 1, maxLength: 2000 }),
    code: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    path: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    resolution: Type.Optional(Type.Union([
      Type.Literal('recoverable'),
      Type.Literal('requires_buyer_input'),
      Type.Literal('requires_buyer_review'),
      Type.Literal('unrecoverable')
    ])),
    contentType: Type.Optional(Type.Union([
      Type.Literal('plain'),
      Type.Literal('markdown')
    ])),
    presentation: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    url: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    imageUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 }))
  },
  { additionalProperties: false }
)

export const PurchaseSelectedOfferSchema = Type.Object(
  {
    merchantProfileUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    merchantDomain: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    productId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    variantId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    itemId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    title: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    url: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    quantity: Type.Optional(Type.Integer({ minimum: 1 }))
  },
  { additionalProperties: true }
)

export const PurchasePrepareRequestSchema = Type.Object(
  {
    merchantProfileUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    merchantDomain: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    selectedOffer: Type.Optional(PurchaseSelectedOfferSchema),
    checkout: Type.Optional(UcpCheckoutCreateRequestSchema),
    buyer: Type.Optional(UcpBuyerSchema),
    fulfillment: Type.Optional(UcpFulfillmentSchema),
    context: Type.Optional(UcpJsonObjectSchema),
    signals: Type.Optional(UcpJsonObjectSchema),
    attribution: Type.Optional(UcpJsonObjectSchema),
    agentContext: Type.Optional(AgentInvocationContextSchema),
    idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 160 }))
  },
  { additionalProperties: false }
)

export const PurchaseUpdateRequestSchema = Type.Object(
  {
    checkout: UcpCheckoutUpdateRequestSchema,
    agentContext: Type.Optional(AgentInvocationContextSchema),
    idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 160 }))
  },
  { additionalProperties: false }
)

export const PurchaseShippingDestinationInputSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    type: Type.Optional(Type.Literal('shipping_address')),
    extended_address: Type.Optional(Type.String({ maxLength: 240 })),
    street_address: Type.Optional(Type.String({ maxLength: 240 })),
    address_locality: Type.Optional(Type.String({ maxLength: 160 })),
    address_region: Type.Optional(Type.String({ maxLength: 160 })),
    address_country: Type.Optional(Type.String({ maxLength: 80 })),
    postal_code: Type.Optional(Type.String({ maxLength: 40 })),
    first_name: Type.Optional(Type.String({ maxLength: 120 })),
    last_name: Type.Optional(Type.String({ maxLength: 120 })),
    phone_number: Type.Optional(Type.String({ maxLength: 40 }))
  },
  { additionalProperties: false, minProperties: 1 }
)

export const PurchaseBuyerReviewInputSchema = Type.Object(
  {
    email: Type.Optional(Type.String({ maxLength: 320 })),
    first_name: Type.Optional(Type.String({ maxLength: 120 })),
    last_name: Type.Optional(Type.String({ maxLength: 120 })),
    phone_number: Type.Optional(Type.String({ maxLength: 40 }))
  },
  { additionalProperties: false, minProperties: 1 }
)

export const PurchaseFulfillmentGroupSelectionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    selected_option_id: Type.Union([
      Type.String({ minLength: 1, maxLength: 256 }),
      Type.Null()
    ])
  },
  { additionalProperties: false }
)

export const PurchaseFulfillmentMethodSelectionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    selected_destination_id: Type.Optional(Type.Union([
      Type.String({ minLength: 1, maxLength: 256 }),
      Type.Null()
    ])),
    destinations: Type.Optional(Type.Array(PurchaseShippingDestinationInputSchema, {
      minItems: 1,
      maxItems: 20
    })),
    groups: Type.Optional(Type.Array(PurchaseFulfillmentGroupSelectionSchema, {
      minItems: 1,
      maxItems: 40
    }))
  },
  { additionalProperties: false, minProperties: 2 }
)

/**
 * Shopper-safe edits. The API expands these selections into the full UCP
 * replacement request and never accepts merchant-owned option/location data
 * or line-item prices from the app.
 */
export const PurchaseReviewUpdateRequestSchema = Type.Object(
  {
    checkoutSnapshotHash: Type.String({ pattern: '^sha256:[0-9a-f]{64}$' }),
    buyer: Type.Optional(PurchaseBuyerReviewInputSchema),
    fulfillment: Type.Optional(Type.Object(
      {
        methods: Type.Array(Type.Union([
          PurchaseFulfillmentMethodSelectionSchema,
          Type.Object({
            type: Type.Literal('shipping'),
            destinations: Type.Array(PurchaseShippingDestinationInputSchema, { minItems: 1, maxItems: 1 })
          }, { additionalProperties: false })
        ]), {
          minItems: 1,
          maxItems: 20
        })
      },
      { additionalProperties: false }
    )),
    agentContext: Type.Optional(AgentInvocationContextSchema),
    idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 160 }))
  },
  {
    additionalProperties: false,
    anyOf: [
      { required: ['buyer'] },
      { required: ['fulfillment'] }
    ]
  }
)

export const PurchaseConfirmRequestSchema = Type.Object(
  {
    approvalRef: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    mandateId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    checkoutSnapshotHash: Type.Optional(Type.String({ pattern: '^sha256:[0-9a-f]{64}$' })),
    approvedAt: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    agentContext: Type.Optional(AgentInvocationContextSchema),
    idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 160 }))
  },
  {
    additionalProperties: false,
    // A human approval must carry the exact reviewed snapshot. Autonomous
    // mandate confirmation derives that hash from a fresh mandate evaluation.
    anyOf: [
      { required: ['checkoutSnapshotHash'] },
      { required: ['mandateId'] }
    ]
  }
)

export const PurchaseMandateAuthorizationProviderSchema = Type.Union([
  Type.Literal('user_approval_action'),
  Type.Literal('passkey_webauthn'),
  Type.Literal('ap2_trusted_surface'),
  Type.Literal('trusted_host_signature')
])

export const PurchaseMandateCreateRequestSchema = Type.Object(
  {
    intentDescription: Type.String({ minLength: 1, maxLength: 420 }),
    merchantOrigin: Type.String({ minLength: 1, maxLength: 2048 }),
    productId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    variantId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    intendedQuantity: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    currency: Type.String({ minLength: 3, maxLength: 3 }),
    maximumPerTransactionMinor: Type.String({ pattern: '^[0-9]+$' }),
    maximumTotalSpendMinor: Type.String({ pattern: '^[0-9]+$' }),
    useLimit: Type.Optional(Type.Integer({ minimum: 1 })),
    expiresAt: Type.String({ minLength: 1, maxLength: 80 }),
    authorizationProvider: Type.Optional(PurchaseMandateAuthorizationProviderSchema),
    agentContext: Type.Optional(AgentInvocationContextSchema)
  },
  { additionalProperties: false }
)

export const PurchaseMandateAuthorizeRequestSchema = Type.Object(
  {
    mode: PurchaseMandateAuthorizationProviderSchema,
    approvalActionId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    evidence: Type.Optional(UcpJsonObjectSchema),
    providerContext: Type.Optional(UcpJsonObjectSchema),
    agentContext: Type.Optional(AgentInvocationContextSchema)
  },
  { additionalProperties: false }
)

export const PurchaseMandateUpdateRequestSchema = Type.Object(
  {
    status: Type.Optional(Type.Union([
      Type.Literal('suspended'),
      Type.Literal('revoked')
    ])),
    agentContext: Type.Optional(AgentInvocationContextSchema)
  },
  { additionalProperties: false }
)

export const CommerceBuyerAddressSchema = Type.Object(
  {
    addressId: Type.String({ minLength: 1, maxLength: 160 }),
    recipientName: Type.String({ minLength: 1, maxLength: 240 }),
    line1: Type.String({ minLength: 1, maxLength: 240 }),
    line2: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    city: Type.String({ minLength: 1, maxLength: 160 }),
    region: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    postalCode: Type.String({ minLength: 1, maxLength: 80 }),
    countryCode: Type.String({ minLength: 2, maxLength: 2 })
  },
  { additionalProperties: false }
)

export const CommerceBuyerProviderCustomerSchema = Type.Object(
  {
    provider: Type.Union([
      Type.Literal('stripe'),
      Type.Literal('trusted_host')
    ]),
    customerReference: Type.String({ minLength: 1, maxLength: 256 })
  },
  { additionalProperties: false }
)

export const CommerceBuyerSafePaymentReferenceSchema = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 120 }),
    referenceId: Type.String({ minLength: 1, maxLength: 256 }),
    brand: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    last4: Type.Optional(Type.String({ minLength: 2, maxLength: 8 })),
    expiryMonth: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
    expiryYear: Type.Optional(Type.Integer({ minimum: 2024, maximum: 2100 })),
    status: Type.String({ minLength: 1, maxLength: 80 })
  },
  { additionalProperties: false }
)

export const CommerceBuyerProfileSchema = Type.Object(
  {
    ownerId: Type.String({ minLength: 1, maxLength: 256 }),
    email: Type.Optional(Type.String({ minLength: 3, maxLength: 320 })),
    phone: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    countryCode: Type.Optional(Type.String({ minLength: 2, maxLength: 2 })),
    shippingAddresses: Type.Array(CommerceBuyerAddressSchema, { maxItems: 16 }),
    defaultShippingAddressId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    providerCustomers: Type.Optional(Type.Array(CommerceBuyerProviderCustomerSchema, { maxItems: 16 })),
    safePaymentReferences: Type.Optional(Type.Array(CommerceBuyerSafePaymentReferenceSchema, { maxItems: 32 }))
  },
  { additionalProperties: false }
)

export const CommerceBuyerProfileUpsertRequestSchema = Type.Omit(CommerceBuyerProfileSchema, ['ownerId'], {
  additionalProperties: false
})

export const AutonomousPurchaseJobStatusSchema = Type.Union([
  Type.Literal('scheduled'),
  Type.Literal('searching'),
  Type.Literal('checkout_prepared'),
  Type.Literal('waiting_for_condition'),
  Type.Literal('waiting_for_step_up'),
  Type.Literal('executing'),
  Type.Literal('reconciliation_required'),
  Type.Literal('completed'),
  Type.Literal('cancelled'),
  Type.Literal('failed')
])

export const AutonomousPurchaseJobTriggerSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal('immediate'),
      Type.Literal('scheduled'),
      Type.Literal('condition')
    ]),
    executeAt: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    condition: Type.Optional(UcpJsonObjectSchema)
  },
  { additionalProperties: false }
)

export const AutonomousPurchaseJobSchema = Type.Object(
  {
    jobId: Type.String({ minLength: 1, maxLength: 256 }),
    ownerId: Type.String({ minLength: 1, maxLength: 256 }),
    integrationId: Type.String({ minLength: 1, maxLength: 160 }),
    authorizationRoute: Type.Optional(Type.Literal('trusted_host')),
    hostId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    agentSessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    mandateId: Type.String({ minLength: 1, maxLength: 256 }),
    mandateVersion: Type.Integer({ minimum: 1 }),
    status: AutonomousPurchaseJobStatusSchema,
    trigger: AutonomousPurchaseJobTriggerSchema,
    leaseOwner: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    leaseExpiresAt: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    attemptCount: Type.Integer({ minimum: 0 }),
    nextAttemptAt: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    purchaseId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    reservationId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    lastSafeErrorCode: Type.Optional(Type.String({ minLength: 1, maxLength: 120 }))
  },
  { additionalProperties: false }
)

export const AutonomousPurchaseJobCreateRequestSchema = Type.Object(
  {
    trigger: AutonomousPurchaseJobTriggerSchema,
    agentContext: Type.Optional(AgentInvocationContextSchema),
    idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 160 }))
  },
  { additionalProperties: false }
)

export const PurchasePaymentPreferenceSchema = Type.Object(
  {
    provider: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
    capabilityId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    mode: Type.Optional(Type.Union([
      Type.Literal('x402'),
      Type.Literal('mpp'),
      Type.Literal('host_supplied'),
      Type.Literal('google_pay'),
      Type.Literal('stripe'),
      Type.Literal('processor_tokenizer')
    ]))
  },
  { additionalProperties: false }
)

export const AgentPaymentPresentationSurfaceSchema = Type.Union([
  Type.Literal('host_native'),
  Type.Literal('embedded_component'),
  Type.Literal('external_action'),
  Type.Literal('merchant_hosted')
])

export const UserPaymentProviderKindSchema = Type.Union([
  Type.Literal('x402'),
  Type.Literal('mpp'),
  Type.Literal('trusted_host'),
  Type.Literal('google_pay'),
  Type.Literal('stripe'),
  Type.Literal('processor_tokenizer'),
  Type.Literal('merchant_hosted')
])

export const AgentHostCapabilitiesSchema = Type.Object(
  {
    hostId: Type.String({ minLength: 1, maxLength: 160 }),
    integrationId: Type.String({ minLength: 1, maxLength: 96 }),
    surfaces: Type.Array(AgentPaymentPresentationSurfaceSchema, {
      minItems: 1,
      maxItems: 4,
      uniqueItems: true
    }),
    providerKinds: Type.Array(UserPaymentProviderKindSchema, {
      minItems: 1,
      maxItems: 8,
      uniqueItems: true
    }),
    handlerNames: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
      minItems: 1,
      maxItems: 32,
      uniqueItems: true
    })),
    authorizationProviderKinds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
      minItems: 1,
      maxItems: 16,
      uniqueItems: true
    })),
    componentProtocols: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
      minItems: 1,
      maxItems: 16,
      uniqueItems: true
    })),
    allowedComponentOrigins: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      minItems: 1,
      maxItems: 32,
      uniqueItems: true
    })),
    allowedReturnOrigins: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      minItems: 1,
      maxItems: 32,
      uniqueItems: true
    })),
    canReceiveAsyncPurchaseUpdates: Type.Optional(Type.Boolean()),
    thirdPartyPaymentEmbeddingAllowed: Type.Optional(Type.Boolean()),
    autonomousExecutionAllowed: Type.Optional(Type.Boolean()),
    attestationIssuer: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    attestationAudience: Type.Optional(Type.String({ minLength: 1, maxLength: 256 }))
  },
  { additionalProperties: false }
)

export const PurchaseClientPlatformSchema = Type.Union([
  Type.Literal('android'),
  Type.Literal('ios'),
  Type.Literal('web')
])

/**
 * First-party shopper-client capabilities. These are intentionally separate
 * from AgentHostCapabilities: an Arro app can describe executable UI that is
 * installed on the shopper's device without claiming to be an attested agent
 * host or receiving any of the host trust privileges.
 */
export const PurchaseClientCapabilitiesSchema = Type.Object(
  {
    platform: PurchaseClientPlatformSchema,
    surfaces: Type.Array(AgentPaymentPresentationSurfaceSchema, {
      minItems: 1,
      maxItems: 4,
      uniqueItems: true
    }),
    providerKinds: Type.Array(UserPaymentProviderKindSchema, {
      minItems: 1,
      maxItems: 8,
      uniqueItems: true
    }),
    handlerNames: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 160 }), {
      minItems: 1,
      maxItems: 32,
      uniqueItems: true
    }))
  },
  { additionalProperties: false }
)

export const AgentExecutionDownscopeSchema = Type.Object(
  {
    allowedPresentationModes: Type.Optional(Type.Array(AgentPaymentPresentationSurfaceSchema, {
      minItems: 1,
      maxItems: 4,
      uniqueItems: true
    })),
    preferredPaymentProviderKinds: Type.Optional(Type.Array(UserPaymentProviderKindSchema, {
      minItems: 1,
      maxItems: 8,
      uniqueItems: true
    })),
    autonomousExecutionAllowed: Type.Optional(Type.Boolean()),
    returnUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 }))
  },
  { additionalProperties: false }
)

export const TrustedAgentHostContextSchema = Type.Object(
  {
    hostId: Type.String({ minLength: 1, maxLength: 160 }),
    integrationId: Type.String({ minLength: 1, maxLength: 96 }),
    issuer: Type.String({ minLength: 1, maxLength: 256 }),
    audience: Type.String({ minLength: 1, maxLength: 256 }),
    keyId: Type.String({ minLength: 1, maxLength: 256 }),
    subjectRefHash: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    taskRefHash: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    capabilities: AgentHostCapabilitiesSchema,
    attestedAt: Type.String({ minLength: 1, maxLength: 80 }),
    expiresAt: Type.String({ minLength: 1, maxLength: 80 })
  },
  { additionalProperties: false }
)

export const PurchasePaymentActionCreateRequestSchema = Type.Object(
  {
    portableCapabilities: Type.Optional(Type.Array(PortablePaymentCapabilitySchema, {
      minItems: 1,
      maxItems: 32
    })),
    clientCapabilities: Type.Optional(PurchaseClientCapabilitiesSchema),
    preference: Type.Optional(PurchasePaymentPreferenceSchema),
    executionDownscope: Type.Optional(AgentExecutionDownscopeSchema),
    returnUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    agentContext: Type.Optional(AgentInvocationContextSchema),
    idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 160 }))
  },
  { additionalProperties: false }
)

export const TrustedHostPaymentActionResultSchema = Type.Object(
  {
    type: Type.Literal('trusted_host_attestation'),
    attestation: Type.String({ minLength: 32, maxLength: 20000 })
  },
  { additionalProperties: false }
)

export const GooglePayPaymentActionResultSchema = Type.Object(
  {
    type: Type.Literal('google_pay_payment_data'),
    source: Type.Union([
      Type.Literal('native'),
      Type.Literal('web')
    ]),
    paymentData: Type.Object(
      {
        apiVersion: Type.Integer({ minimum: 2 }),
        apiVersionMinor: Type.Integer({ minimum: 0 }),
        paymentMethodData: Type.Object(
          {
            type: Type.Literal('CARD'),
            description: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
            info: Type.Optional(Type.Object(
              {
                cardNetwork: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
                cardDetails: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
                assuranceDetails: Type.Optional(UcpJsonObjectSchema),
                billingAddress: Type.Optional(UcpJsonObjectSchema)
              },
              { additionalProperties: false }
            )),
            tokenizationData: Type.Object(
              {
                type: Type.Union([
                  Type.Literal('PAYMENT_GATEWAY'),
                  Type.Literal('DIRECT')
                ]),
                token: Type.String({ minLength: 1, maxLength: 20000 })
              },
              { additionalProperties: false }
            )
          },
          { additionalProperties: false }
        ),
        email: Type.Optional(Type.String({ minLength: 3, maxLength: 320 })),
        shippingAddress: Type.Optional(UcpJsonObjectSchema)
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
)

export const ProcessorTokenizerPaymentActionResultSchema = Type.Object(
  {
    type: Type.Literal('processor_tokenizer_result'),
    provider: Type.String({ minLength: 1, maxLength: 120 }),
    credentialReference: Type.Object(
      {
        reference: Type.String({ minLength: 8, maxLength: 4096 }),
        proof: Type.Optional(Type.String({ minLength: 16, maxLength: 4096 })),
        expiresAt: Type.Optional(Type.String({ minLength: 1, maxLength: 80 }))
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
)

/**
 * Stripe PaymentSheet confirms a merchant-owned, manual-capture PaymentIntent.
 * Only the opaque Intent id crosses Arro's public contract; the client secret
 * is obtained from a short-lived signed action-session endpoint and is never
 * accepted back from an application client.
 */
export const StripePaymentActionResultSchema = Type.Object(
  {
    type: Type.Literal('stripe_payment_intent'),
    paymentIntentId: Type.String({ pattern: '^pi_[A-Za-z0-9_]+$', maxLength: 256 })
  },
  { additionalProperties: false }
)

export const StripePaymentActionSessionSchema = Type.Object(
  {
    provider: Type.Literal('stripe'),
    livemode: Type.Literal(true),
    publishableKey: Type.String({ pattern: '^pk_live_[A-Za-z0-9_]+$', maxLength: 512 }),
    paymentIntentClientSecret: Type.String({
      pattern: '^pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$',
      maxLength: 1024
    }),
    paymentIntentId: Type.String({ pattern: '^pi_[A-Za-z0-9_]+$', maxLength: 256 }),
    stripeAccountId: Type.Optional(Type.String({ pattern: '^acct_[A-Za-z0-9_]+$', maxLength: 256 })),
    merchantDisplayName: Type.String({ minLength: 1, maxLength: 120 }),
    merchantCountryCode: Type.String({ pattern: '^[A-Z]{2}$' }),
    currency: Type.String({ pattern: '^[A-Z]{3}$' }),
    amount: Type.Integer({ minimum: 1 }),
    captureMethod: Type.Literal('manual'),
    paymentMethodTypes: Type.Tuple([Type.Literal('card')]),
    allowedCardBrands: Type.Tuple([
      Type.Literal('visa'),
      Type.Literal('mastercard')
    ]),
    expiresAt: Type.String({ minLength: 1, maxLength: 80 })
  },
  { additionalProperties: false }
)

const X402ResourceInfoSchema = Type.Object(
  {
    url: Type.String({ minLength: 1, maxLength: 2048 }),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 420 })),
    mimeType: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    serviceName: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
    tags: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 32 }), { maxItems: 5 })),
    iconUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 }))
  },
  { additionalProperties: false }
)

const X402PaymentRequirementsSchema = Type.Object(
  {
    scheme: Type.String({ minLength: 1, maxLength: 80 }),
    network: Type.String({ minLength: 1, maxLength: 160 }),
    amount: Type.String({ pattern: '^[0-9]+$' }),
    asset: Type.String({ minLength: 1, maxLength: 256 }),
    payTo: Type.String({ minLength: 1, maxLength: 256 }),
    maxTimeoutSeconds: Type.Integer({ minimum: 1, maximum: 86_400 }),
    extra: Type.Optional(UcpJsonObjectSchema)
  },
  { additionalProperties: false }
)

export const X402PaymentPayloadSchema = Type.Object(
  {
    x402Version: Type.Literal(2),
    resource: Type.Optional(X402ResourceInfoSchema),
    accepted: X402PaymentRequirementsSchema,
    payload: UcpJsonObjectSchema,
    extensions: Type.Optional(UcpJsonObjectSchema)
  },
  { additionalProperties: false }
)

export const X402PaymentActionResultSchema = Type.Object(
  {
    type: Type.Literal('x402_payment_payload'),
    paymentPayload: X402PaymentPayloadSchema
  },
  { additionalProperties: false }
)

export const MppPaymentActionResultSchema = Type.Object(
  {
    type: Type.Literal('mpp_payment_credential'),
    authorization: Type.String({ pattern: '^Payment [A-Za-z0-9_-]+$', maxLength: 40_000 })
  },
  { additionalProperties: false }
)

export const PurchasePaymentActionResultSchema = Type.Union([
  X402PaymentActionResultSchema,
  MppPaymentActionResultSchema,
  TrustedHostPaymentActionResultSchema,
  GooglePayPaymentActionResultSchema,
  StripePaymentActionResultSchema,
  ProcessorTokenizerPaymentActionResultSchema
])

export const PurchasePaymentActionResultRequestSchema = Type.Object(
  {
    result: PurchasePaymentActionResultSchema,
    idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 160 }))
  },
  { additionalProperties: false }
)

export const PurchasePaymentActionStatusSchema = Type.Union([
  Type.Literal('pending_user_approval'),
  Type.Literal('approved'),
  Type.Literal('credential_ready'),
  Type.Literal('consumed'),
  Type.Literal('failed'),
  Type.Literal('revoked'),
  Type.Literal('expired')
])

export const PurchasePaymentActionResponseSchema = Type.Object(
  {
    actionId: Type.String({ minLength: 1, maxLength: 256 }),
    purchaseId: PurchaseRefSchema,
    status: PurchasePaymentActionStatusSchema,
    actionType: Type.String({ minLength: 1, maxLength: 80 }),
    provider: Type.String({ minLength: 1, maxLength: 120 }),
    handlerId: Type.String({ minLength: 1, maxLength: 160 }),
    handlerName: Type.String({ minLength: 1, maxLength: 160 }),
    handlerVersion: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    handlerSpecification: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    handlerSchema: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    capabilityId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    presentation: AgentPaymentPresentationSurfaceSchema,
    merchantOrigin: Type.String({ minLength: 1, maxLength: 2048 }),
    checkoutId: Type.String({ minLength: 1, maxLength: 256 }),
    checkoutSnapshotHash: Type.String({ pattern: '^sha256:[0-9a-f]{64}$' }),
    amount: Type.Optional(Type.Integer()),
    currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
    expiresAt: Type.String({ minLength: 1, maxLength: 80 }),
    actionToken: Type.Optional(Type.String({ minLength: 1 })),
    actionUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),
    action: Type.Optional(UcpJsonObjectSchema),
    message: Type.String({ minLength: 1, maxLength: 420 })
  },
  { additionalProperties: false }
)

export const PurchaseResponseSchema = Type.Object(
  {
    purchaseId: PurchaseRefSchema,
    state: PurchaseStateSchema,
    executionLevel: PurchaseExecutionLevelSchema,
    merchant: PurchaseMerchantSummarySchema,
    items: Type.Array(PurchaseItemSummarySchema),
    currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
    buyer: Type.Optional(UcpBuyerSchema),
    totals: Type.Optional(Type.Array(UcpMoneyAmountSchema)),
    fulfillment: Type.Optional(UcpFulfillmentSchema),
    canAddShippingAddress: Type.Optional(Type.Boolean()),
    links: Type.Array(UcpLinkSchema),
    policies: Type.Optional(Type.Array(UcpPolicySchema)),
    payment: PurchasePaymentSummarySchema,
    cart: Type.Optional(PurchaseCartSummarySchema),
    checkoutStatus: Type.Optional(UcpCheckoutStatusSchema),
    checkoutSnapshotHash: Type.Optional(Type.String({ pattern: '^sha256:[0-9a-f]{64}$' })),
    messages: Type.Array(PurchaseMessageSchema),
    pendingActions: Type.Optional(Type.Array(PurchasePendingActionSchema, { maxItems: 32 })),
    nextAction: Type.Optional(PurchaseActionSchema),
    rawUcpTransactionId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 }))
  },
  { additionalProperties: false }
)

export type PurchaseExecutionLevel = Static<typeof PurchaseExecutionLevelSchema>
export type PurchaseState = Static<typeof PurchaseStateSchema>
export type PurchaseAction = Static<typeof PurchaseActionSchema>
export type PurchasePendingAction = Static<typeof PurchasePendingActionSchema>
export type PurchasePrepareRequest = Static<typeof PurchasePrepareRequestSchema>
export type PurchaseUpdateRequest = Static<typeof PurchaseUpdateRequestSchema>
export type PurchaseBuyerReviewInput = Static<typeof PurchaseBuyerReviewInputSchema>
export type PurchaseShippingDestinationInput = Static<typeof PurchaseShippingDestinationInputSchema>
export type PurchaseFulfillmentGroupSelection = Static<typeof PurchaseFulfillmentGroupSelectionSchema>
export type PurchaseFulfillmentMethodSelection = Static<typeof PurchaseFulfillmentMethodSelectionSchema>
export type PurchaseReviewUpdateRequest = Static<typeof PurchaseReviewUpdateRequestSchema>
export type PurchaseConfirmRequest = Static<typeof PurchaseConfirmRequestSchema>
export type PurchaseMandateCreateRequest = Static<typeof PurchaseMandateCreateRequestSchema>
export type PurchaseMandateAuthorizeRequest = Static<typeof PurchaseMandateAuthorizeRequestSchema>
export type PurchaseMandateUpdateRequest = Static<typeof PurchaseMandateUpdateRequestSchema>
export type CommerceBuyerProfile = Static<typeof CommerceBuyerProfileSchema>
export type CommerceBuyerProfileUpsertRequest = Static<typeof CommerceBuyerProfileUpsertRequestSchema>
export type AutonomousPurchaseJob = Static<typeof AutonomousPurchaseJobSchema>
export type AutonomousPurchaseJobCreateRequest = Static<typeof AutonomousPurchaseJobCreateRequestSchema>
export type PurchasePaymentPreference = Static<typeof PurchasePaymentPreferenceSchema>
export type PortablePaymentProtocol = Static<typeof PortablePaymentProtocolSchema>
export type PortablePaymentCapability = Static<typeof PortablePaymentCapabilitySchema>
export type AgentPaymentPresentationSurface = Static<typeof AgentPaymentPresentationSurfaceSchema>
export type UserPaymentProviderKind = Static<typeof UserPaymentProviderKindSchema>
export type AgentHostCapabilities = Static<typeof AgentHostCapabilitiesSchema>
export type PurchaseClientPlatform = Static<typeof PurchaseClientPlatformSchema>
export type PurchaseClientCapabilities = Static<typeof PurchaseClientCapabilitiesSchema>
export type AgentExecutionDownscope = Static<typeof AgentExecutionDownscopeSchema>
export type TrustedAgentHostContext = Static<typeof TrustedAgentHostContextSchema>
export type PurchasePaymentActionCreateRequest = Static<typeof PurchasePaymentActionCreateRequestSchema>
export type PurchasePaymentActionResult = Static<typeof PurchasePaymentActionResultSchema>
export type PurchasePaymentActionResultRequest = Static<typeof PurchasePaymentActionResultRequestSchema>
export type PurchasePaymentActionResponse = Static<typeof PurchasePaymentActionResponseSchema>
export type StripePaymentActionSession = Static<typeof StripePaymentActionSessionSchema>
export type PurchaseResponse = Static<typeof PurchaseResponseSchema>
