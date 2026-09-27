import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { IsoDateTimeSchema } from './common.ts'

export { UCP_STABLE_VERSION } from './ucp-version.ts'

export const UcpProtocolVersionSchema = Type.String({
  minLength: 10,
  maxLength: 32,
  pattern: '^\\d{4}-\\d{2}-\\d{2}$'
})

/**
 * UCP mutation keys must carry at least 128 bits of caller-generated entropy.
 * Twenty-two base64url characters are the shortest unpadded representation of
 * 128 bits; UUIDv4 values and UUID-derived operation keys also fit this safe
 * HTTP-field alphabet.
 */
export const UcpIdempotencyKeySchema = Type.String({
  minLength: 22,
  maxLength: 255,
  pattern: '^[A-Za-z0-9._:~-]{22,255}$'
})

const ucpIdempotencyKeyPattern = /^[A-Za-z0-9._:~-]{22,255}$/
export const isUcpIdempotencyKey = (value: unknown): value is string =>
  typeof value === 'string' && ucpIdempotencyKeyPattern.test(value)

export const UcpServiceTransportSchema = Type.Union([
  Type.Literal('rest'),
  Type.Literal('mcp'),
  Type.Literal('a2a'),
  Type.Literal('embedded')
])

export const UcpJsonObjectSchema = Type.Record(Type.String({ minLength: 1 }), Type.Unknown())

export const UcpReverseDomainNameSchema = Type.String({
  pattern: '^[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9_-]*[a-z0-9_])?)+$'
})

export const UcpMapOrderSchema = Type.Record(
  Type.String({ minLength: 1 }),
  Type.Array(Type.String())
)

export const UcpEmbeddedTransportConfigSchema = Type.Object(
  {
    delegate: Type.Optional(Type.Array(Type.String())),
    color_scheme: Type.Optional(Type.Array(Type.Union([
      Type.Literal('light'),
      Type.Literal('dark')
    ])))
  },
  { additionalProperties: true }
)

export const UcpProtocolServiceDeclarationSchema = Type.Object(
  {
    version: UcpProtocolVersionSchema,
    id: Type.Optional(Type.String()),
    spec: Type.Optional(Type.String({ minLength: 1 })),
    schema: Type.Optional(Type.String({ minLength: 1 })),
    transport: UcpServiceTransportSchema,
    endpoint: Type.Optional(Type.String({ minLength: 1 })),
    config: Type.Optional(UcpJsonObjectSchema)
  },
  { additionalProperties: true }
)

const ucpServiceEntityFields = {
  version: UcpProtocolVersionSchema,
  id: Type.Optional(Type.String()),
  config: Type.Optional(UcpJsonObjectSchema),
  endpoint: Type.Optional(Type.String()),
  spec: Type.Optional(Type.String()),
  schema: Type.Optional(Type.String())
}

export const UcpPlatformServiceDeclarationSchema = Type.Union([
  Type.Object({
    ...ucpServiceEntityFields,
    spec: Type.String(),
    schema: Type.String(),
    transport: Type.Literal('rest')
  }, { additionalProperties: true }),
  Type.Object({
    ...ucpServiceEntityFields,
    spec: Type.String(),
    schema: Type.String(),
    transport: Type.Literal('mcp')
  }, { additionalProperties: true }),
  Type.Object({
    ...ucpServiceEntityFields,
    spec: Type.String(),
    transport: Type.Literal('a2a')
  }, { additionalProperties: true }),
  Type.Object({
    ...ucpServiceEntityFields,
    spec: Type.String(),
    schema: Type.String(),
    config: Type.Optional(UcpEmbeddedTransportConfigSchema),
    transport: Type.Literal('embedded')
  }, { additionalProperties: true })
])

export const UcpBusinessServiceDeclarationSchema = Type.Union([
  Type.Object({
    ...ucpServiceEntityFields,
    endpoint: Type.String(),
    transport: Type.Literal('rest')
  }, { additionalProperties: true }),
  Type.Object({
    ...ucpServiceEntityFields,
    endpoint: Type.String(),
    transport: Type.Literal('mcp')
  }, { additionalProperties: true }),
  Type.Object({
    ...ucpServiceEntityFields,
    endpoint: Type.String(),
    transport: Type.Literal('a2a')
  }, { additionalProperties: true }),
  Type.Object({
    ...ucpServiceEntityFields,
    config: Type.Optional(UcpEmbeddedTransportConfigSchema),
    transport: Type.Literal('embedded')
  }, { additionalProperties: true })
])

export const UcpResponseServiceDeclarationSchema = UcpProtocolServiceDeclarationSchema

export const UcpVersionRangeSchema = Type.Object(
  {
    min: UcpProtocolVersionSchema,
    max: Type.Optional(UcpProtocolVersionSchema)
  },
  { additionalProperties: true }
)

export const UcpVersionRequirementSchema = Type.Object(
  {
    protocol: Type.Optional(UcpVersionRangeSchema),
    capabilities: Type.Optional(Type.Record(Type.String({ minLength: 1 }), UcpVersionRangeSchema))
  },
  { additionalProperties: true }
)

export const UcpProtocolCapabilityDeclarationSchema = Type.Object(
  {
    version: UcpProtocolVersionSchema,
    spec: Type.Optional(Type.String({ minLength: 1 })),
    schema: Type.Optional(Type.String({ minLength: 1 })),
    extends: Type.Optional(Type.Union([
      Type.String({ minLength: 1 }),
      Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })
    ])),
    // UCP declares `requires` as version constraints, not a list of capability
    // names: { protocol: { min, max? }, capabilities: { <name>: { min, max? } } }.
    // Real merchant profiles publish the object form, so an array-only schema
    // rejects them outright.
    requires: Type.Optional(UcpVersionRequirementSchema),
    config: Type.Optional(UcpJsonObjectSchema)
  },
  { additionalProperties: true }
)

const ucpCapabilityEntityFields = {
  version: UcpProtocolVersionSchema,
  spec: Type.Optional(Type.String()),
  schema: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
  config: Type.Optional(UcpJsonObjectSchema),
  requires: Type.Optional(UcpVersionRequirementSchema),
  extends: Type.Optional(Type.Union([
    UcpReverseDomainNameSchema,
    Type.Array(UcpReverseDomainNameSchema, { minItems: 1 })
  ]))
}

export const UcpPlatformCapabilityDeclarationSchema = Type.Object(
  {
    ...ucpCapabilityEntityFields,
    spec: Type.String(),
    schema: Type.String()
  },
  { additionalProperties: true }
)

export const UcpBusinessCapabilityDeclarationSchema = Type.Object(
  {
    ...ucpCapabilityEntityFields,
    schema: Type.String()
  },
  { additionalProperties: true }
)

export const UcpResponseCapabilityDeclarationSchema = Type.Object(
  ucpCapabilityEntityFields,
  { additionalProperties: true }
)

export const UcpAvailablePaymentInstrumentSchema = Type.Object(
  {
    type: Type.String({ minLength: 1 }),
    constraints: Type.Optional(UcpJsonObjectSchema)
  },
  { additionalProperties: true }
)

export const UcpPaymentHandlerDeclarationSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    version: UcpProtocolVersionSchema,
    spec: Type.Optional(Type.String({ minLength: 1 })),
    schema: Type.Optional(Type.String({ minLength: 1 })),
    available_instruments: Type.Optional(Type.Array(UcpAvailablePaymentInstrumentSchema, { minItems: 1 })),
    config: Type.Optional(UcpJsonObjectSchema)
  },
  { additionalProperties: true }
)

export const UcpPlatformPaymentHandlerDeclarationSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    version: UcpProtocolVersionSchema,
    spec: Type.String(),
    schema: Type.String(),
    available_instruments: Type.Optional(Type.Array(UcpAvailablePaymentInstrumentSchema, { minItems: 1 })),
    config: Type.Optional(UcpJsonObjectSchema)
  },
  { additionalProperties: true }
)

export const UcpBusinessPaymentHandlerDeclarationSchema = UcpPaymentHandlerDeclarationSchema
export const UcpResponsePaymentHandlerDeclarationSchema = UcpPaymentHandlerDeclarationSchema

const ucpServiceRegistry = <T extends TSchema>(declaration: T) =>
  Type.Record(UcpReverseDomainNameSchema, Type.Array(declaration))

const ucpCapabilityRegistry = <T extends TSchema>(declaration: T) =>
  Type.Record(UcpReverseDomainNameSchema, Type.Array(declaration))

const ucpPaymentHandlerRegistry = <T extends TSchema>(declaration: T) =>
  Type.Record(UcpReverseDomainNameSchema, Type.Array(declaration))

const ucpResponseMetadataFields = {
  version: UcpProtocolVersionSchema,
  map_order: Type.Optional(UcpMapOrderSchema),
  status: Type.Optional(Type.Union([
    Type.Literal('success'),
    Type.Literal('error')
  ])),
  services: Type.Optional(ucpServiceRegistry(UcpResponseServiceDeclarationSchema)),
  capabilities: Type.Optional(ucpCapabilityRegistry(UcpResponseCapabilityDeclarationSchema)),
  payment_handlers: Type.Optional(ucpPaymentHandlerRegistry(UcpResponsePaymentHandlerDeclarationSchema))
}

export const UcpResponseMetadataSchema = Type.Object(
  ucpResponseMetadataFields,
  { additionalProperties: true }
)

export const UcpCheckoutResponseMetadataSchema = Type.Object(
  {
    ...ucpResponseMetadataFields,
    payment_handlers: ucpPaymentHandlerRegistry(UcpResponsePaymentHandlerDeclarationSchema)
  },
  { additionalProperties: true }
)

export const UcpCartResponseMetadataSchema = UcpResponseMetadataSchema
export const UcpOrderResponseMetadataSchema = UcpResponseMetadataSchema

const ucpKnownJwkKeyTypes = Type.Union([
  Type.Literal('EC'),
  Type.Literal('OKP')
])

const ucpPublicJwkShapeSchema = Type.Union([
  Type.Object({
    kid: Type.String(),
    kty: Type.Literal('EC'),
    crv: Type.String(),
    x: Type.String(),
    y: Type.String(),
    alg: Type.Optional(Type.String()),
    use: Type.Optional(Type.String())
  }, { additionalProperties: true }),
  Type.Object({
    kid: Type.String(),
    kty: Type.Literal('OKP'),
    crv: Type.String(),
    x: Type.String(),
    y: Type.Optional(Type.String()),
    alg: Type.Optional(Type.String()),
    use: Type.Optional(Type.String())
  }, { additionalProperties: true }),
  Type.Object({
    kid: Type.String(),
    kty: Type.Intersect([
      Type.String(),
      Type.Not(ucpKnownJwkKeyTypes)
    ]),
    crv: Type.Optional(Type.String()),
    x: Type.Optional(Type.String()),
    y: Type.Optional(Type.String()),
    alg: Type.Optional(Type.String()),
    use: Type.Optional(Type.String())
  }, { additionalProperties: true })
])

const ucpKnownJwkCurves = Type.Union([
  Type.Literal('P-256'),
  Type.Literal('P-384'),
  Type.Literal('Ed25519')
])

const ucpPublicJwkAlgorithmSchema = Type.Union([
  Type.Object({
    crv: Type.Literal('P-256'),
    alg: Type.Optional(Type.Literal('ES256'))
  }, { additionalProperties: true }),
  Type.Object({
    crv: Type.Literal('P-384'),
    alg: Type.Optional(Type.Literal('ES384'))
  }, { additionalProperties: true }),
  Type.Object({
    crv: Type.Literal('Ed25519'),
    alg: Type.Optional(Type.Literal('EdDSA'))
  }, { additionalProperties: true }),
  Type.Intersect([
    Type.Object({
      crv: Type.String(),
      alg: Type.Optional(Type.String())
    }, { additionalProperties: true }),
    Type.Not(Type.Object({ crv: ucpKnownJwkCurves }, { additionalProperties: true }))
  ]),
  Type.Not(Type.Object({ crv: Type.Unknown() }, { additionalProperties: true }))
])

const ucpPrivateJwkMaterialSchema = Type.Union(
  ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].map((member) =>
    Type.Object({ [member]: Type.Unknown() }, { additionalProperties: true }))
)

export const UcpPublicJwkSchema = Type.Intersect([
  ucpPublicJwkShapeSchema,
  ucpPublicJwkAlgorithmSchema,
  Type.Not(ucpPrivateJwkMaterialSchema)
])

const ucpProfileRootFields = {
  keys: Type.Optional(Type.Array(UcpPublicJwkSchema))
}

export const UcpBusinessProfileSchema = Type.Object(
  {
    ucp: Type.Object(
      {
        version: UcpProtocolVersionSchema,
        map_order: Type.Optional(UcpMapOrderSchema),
        status: Type.Optional(Type.Union([Type.Literal('success'), Type.Literal('error')])),
        supported_versions: Type.Optional(Type.Record(
          UcpProtocolVersionSchema,
          Type.String()
        )),
        services: Type.Record(
          UcpReverseDomainNameSchema,
          Type.Array(UcpBusinessServiceDeclarationSchema)
        ),
        capabilities: Type.Optional(Type.Record(
          UcpReverseDomainNameSchema,
          Type.Array(UcpBusinessCapabilityDeclarationSchema)
        )),
        payment_handlers: Type.Record(
          UcpReverseDomainNameSchema,
          Type.Array(UcpBusinessPaymentHandlerDeclarationSchema)
        )
      },
      { additionalProperties: true }
    ),
    ...ucpProfileRootFields
  },
  { additionalProperties: true }
)

export const UcpPlatformProfileSchema = Type.Object(
  {
    ucp: Type.Object(
      {
        version: UcpProtocolVersionSchema,
        map_order: Type.Optional(UcpMapOrderSchema),
        status: Type.Optional(Type.Union([Type.Literal('success'), Type.Literal('error')])),
        services: Type.Record(
          UcpReverseDomainNameSchema,
          Type.Array(UcpPlatformServiceDeclarationSchema)
        ),
        capabilities: Type.Optional(Type.Record(
          UcpReverseDomainNameSchema,
          Type.Array(UcpPlatformCapabilityDeclarationSchema)
        )),
        payment_handlers: Type.Record(
          UcpReverseDomainNameSchema,
          Type.Array(UcpPlatformPaymentHandlerDeclarationSchema)
        )
      },
      { additionalProperties: true }
    ),
    ...ucpProfileRootFields
  },
  { additionalProperties: true }
)

// Merchant discovery resolves the business-profile variant. Platforms use the
// explicitly exported UcpPlatformProfileSchema rather than a role-ambiguous
// compatibility union.
export const UcpProfileSchema = UcpBusinessProfileSchema

export const UcpCheckoutStatusSchema = Type.Union([
  Type.Literal('incomplete'),
  Type.Literal('requires_escalation'),
  Type.Literal('ready_for_complete'),
  Type.Literal('complete_in_progress'),
  Type.Literal('completed'),
  Type.Literal('canceled')
])

export const UcpMessageSeveritySchema = Type.Union([
  Type.Literal('recoverable'),
  Type.Literal('requires_buyer_input'),
  Type.Literal('requires_buyer_review'),
  Type.Literal('unrecoverable')
])

const ucpMessageCommonFields = {
  path: Type.Optional(Type.String()),
  content_type: Type.Optional(Type.Union([
    Type.Literal('plain'),
    Type.Literal('markdown')
  ]))
}

export const UcpCheckoutMessageSchema = Type.Union([
  Type.Object(
    {
      ...ucpMessageCommonFields,
      type: Type.Literal('info'),
      code: Type.Optional(Type.String()),
      content: Type.String()
    },
    { additionalProperties: true }
  ),
  Type.Object(
    {
      ...ucpMessageCommonFields,
      type: Type.Literal('warning'),
      code: Type.String(),
      content: Type.String(),
      presentation: Type.Optional(Type.String()),
      url: Type.Optional(Type.String()),
      image_url: Type.Optional(Type.String())
    },
    { additionalProperties: true }
  ),
  Type.Object(
    {
      ...ucpMessageCommonFields,
      type: Type.Literal('error'),
      code: Type.String(),
      content: Type.String(),
      severity: UcpMessageSeveritySchema
    },
    { additionalProperties: true }
  )
])

export const UcpMoneyAmountSchema = Type.Object(
  {
    type: Type.String({ minLength: 1 }),
    amount: Type.Integer({
      minimum: -9007199254740991,
      maximum: 9007199254740991
    }),
    display_text: Type.Optional(Type.String()),
    currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
  },
  { additionalProperties: true }
)

export const UcpItemRequestSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    quantity_unit: Type.Optional(UcpJsonObjectSchema)
  },
  { additionalProperties: true }
)

export const UcpItemReferenceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    title: Type.String(),
    price: Type.Integer({ minimum: 0, maximum: 9007199254740991 }),
    quantity_unit: Type.Optional(UcpJsonObjectSchema),
    unit_price: Type.Optional(UcpJsonObjectSchema),
    url: Type.Optional(Type.String({ minLength: 1 })),
    image_url: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: true }
)

export const UcpLineItemCreateRequestSchema = Type.Object(
  {
    item: UcpItemRequestSchema,
    quantity: Type.Integer({ minimum: 1, maximum: 9007199254740991 })
  },
  { additionalProperties: true }
)

export const UcpLineItemUpdateRequestSchema = Type.Object(
  {
    id: Type.Optional(Type.String()),
    item: UcpItemRequestSchema,
    quantity: Type.Integer({ minimum: 1, maximum: 9007199254740991 })
  },
  { additionalProperties: true }
)

export const UcpLineItemRequestSchema = UcpLineItemUpdateRequestSchema

export const UcpLineItemSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    item: UcpItemReferenceSchema,
    quantity: Type.Integer({ minimum: 1, maximum: 9007199254740991 }),
    totals: Type.Array(UcpMoneyAmountSchema),
    parent_id: Type.Optional(Type.String())
  },
  { additionalProperties: true }
)

export const UcpOrderLineItemSchema = Type.Object(
  {
    id: Type.String(),
    item: UcpItemReferenceSchema,
    quantity: Type.Object(
      {
        original: Type.Optional(Type.Integer({ minimum: 0, maximum: 9007199254740991 })),
        total: Type.Integer({ minimum: 0, maximum: 9007199254740991 }),
        fulfilled: Type.Integer({ minimum: 0, maximum: 9007199254740991 })
      },
      { additionalProperties: true }
    ),
    totals: Type.Array(UcpMoneyAmountSchema),
    status: Type.Union([
      Type.Literal('processing'),
      Type.Literal('partial'),
      Type.Literal('fulfilled'),
      Type.Literal('removed')
    ]),
    parent_id: Type.Optional(Type.String())
  },
  { additionalProperties: true }
)

export const UcpBuyerSchema = Type.Object(
  {
    email: Type.Optional(Type.String()),
    first_name: Type.Optional(Type.String()),
    last_name: Type.Optional(Type.String()),
    phone_number: Type.Optional(Type.String())
  },
  { additionalProperties: true }
)

export const UcpDescriptionSchema = Type.Object(
  {
    plain: Type.Optional(Type.String()),
    html: Type.Optional(Type.String()),
    markdown: Type.Optional(Type.String())
  },
  { additionalProperties: true, minProperties: 1 }
)

export const UcpPostalAddressSchema = Type.Object(
  {
    extended_address: Type.Optional(Type.String()),
    street_address: Type.Optional(Type.String()),
    address_locality: Type.Optional(Type.String()),
    address_region: Type.Optional(Type.String()),
    address_country: Type.Optional(Type.String()),
    postal_code: Type.Optional(Type.String()),
    first_name: Type.Optional(Type.String()),
    last_name: Type.Optional(Type.String()),
    phone_number: Type.Optional(Type.String())
  },
  { additionalProperties: true }
)

export const UcpShippingDestinationSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1 })),
    type: Type.Optional(Type.Literal('shipping_address')),
    extended_address: Type.Optional(Type.String()),
    street_address: Type.Optional(Type.String()),
    address_locality: Type.Optional(Type.String()),
    address_region: Type.Optional(Type.String()),
    address_country: Type.Optional(Type.String()),
    postal_code: Type.Optional(Type.String()),
    first_name: Type.Optional(Type.String()),
    last_name: Type.Optional(Type.String()),
    phone_number: Type.Optional(Type.String())
  },
  { additionalProperties: true }
)

export const UcpBusinessLocationDestinationSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    type: Type.Literal('business_location'),
    name: Type.String(),
    address: Type.Optional(UcpPostalAddressSchema)
  },
  { additionalProperties: true }
)

export const UcpFulfillmentDestinationSchema = Type.Union([
  UcpShippingDestinationSchema,
  UcpBusinessLocationDestinationSchema,
  Type.Object(
    {
      id: Type.String({ minLength: 1 }),
      type: Type.String({ minLength: 1 })
    },
    { additionalProperties: true }
  )
])

export const UcpFulfillmentOptionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    title: Type.String(),
    description: Type.Optional(UcpDescriptionSchema),
    carrier: Type.Optional(Type.String()),
    earliest_fulfillment_time: Type.Optional(IsoDateTimeSchema),
    latest_fulfillment_time: Type.Optional(IsoDateTimeSchema),
    totals: Type.Array(UcpMoneyAmountSchema)
  },
  { additionalProperties: true }
)

export const UcpFulfillmentGroupSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    line_item_ids: Type.Optional(Type.Array(Type.String())),
    options: Type.Optional(Type.Array(UcpFulfillmentOptionSchema)),
    selected_option_id: Type.Optional(Type.Union([Type.String(), Type.Null()]))
  },
  { additionalProperties: true }
)

export const UcpFulfillmentMethodSchema = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1 })),
    type: Type.String({ minLength: 1 }),
    line_item_ids: Type.Optional(Type.Array(Type.String())),
    destinations: Type.Optional(Type.Array(UcpFulfillmentDestinationSchema)),
    selected_destination_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    groups: Type.Optional(Type.Array(UcpFulfillmentGroupSchema))
  },
  { additionalProperties: true }
)

export const UcpFulfillmentAvailableMethodSchema = Type.Object(
  {
    type: Type.String({ minLength: 1 }),
    line_item_ids: Type.Array(Type.String()),
    fulfillable_on: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    description: Type.Optional(Type.String())
  },
  { additionalProperties: true }
)

export const UcpFulfillmentSchema = Type.Object(
  {
    methods: Type.Optional(Type.Array(UcpFulfillmentMethodSchema)),
    available_methods: Type.Optional(Type.Array(UcpFulfillmentAvailableMethodSchema))
  },
  { additionalProperties: true }
)

export const UcpPaymentCredentialSchema = Type.Object(
  {
    type: Type.String({ minLength: 1 }),
    token: Type.Optional(Type.String({ minLength: 1 })),
    value: Type.Optional(Type.String({ minLength: 1 })),
    reference: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: true }
)

export const UcpPaymentInstrumentSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    handler_id: Type.String({ minLength: 1 }),
    type: Type.String({ minLength: 1 }),
    selected: Type.Optional(Type.Boolean()),
    display: Type.Optional(UcpJsonObjectSchema),
    billing_address: Type.Optional(UcpJsonObjectSchema),
    credential: Type.Optional(UcpPaymentCredentialSchema)
  },
  { additionalProperties: true }
)

export const UcpActionInstanceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    config: Type.Optional(UcpJsonObjectSchema)
  },
  { additionalProperties: true }
)

export const UcpActionsSchema = Type.Record(
  UcpReverseDomainNameSchema,
  Type.Array(UcpActionInstanceSchema, { minItems: 1 })
)

export const UcpLinkSchema = Type.Object(
  {
    type: Type.String(),
    url: Type.String(),
    title: Type.Optional(Type.String())
  },
  { additionalProperties: true }
)

export const UcpPolicySchema = Type.Object(
  {
    type: UcpReverseDomainNameSchema,
    description: UcpDescriptionSchema,
    applies_to: Type.Optional(Type.Array(Type.String())),
    url: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: true }
)

export const UcpCheckoutPaymentSchema = Type.Object(
  {
    instruments: Type.Optional(Type.Array(UcpPaymentInstrumentSchema))
  },
  { additionalProperties: true }
)

export const UcpCartCreateRequestSchema = Type.Object(
  {
    line_items: Type.Array(UcpLineItemCreateRequestSchema),
    buyer: Type.Optional(UcpBuyerSchema),
    fulfillment: Type.Optional(UcpFulfillmentSchema),
    context: Type.Optional(UcpJsonObjectSchema),
    signals: Type.Optional(UcpJsonObjectSchema),
    attribution: Type.Optional(UcpJsonObjectSchema)
  },
  { additionalProperties: true }
)

// UCP cart updates use full-replacement semantics.
export const UcpCartUpdateRequestSchema = Type.Object(
  {
    line_items: Type.Array(UcpLineItemUpdateRequestSchema),
    buyer: Type.Optional(UcpBuyerSchema),
    fulfillment: Type.Optional(UcpFulfillmentSchema),
    context: Type.Optional(UcpJsonObjectSchema),
    signals: Type.Optional(UcpJsonObjectSchema),
    attribution: Type.Optional(UcpJsonObjectSchema)
  },
  { additionalProperties: true }
)

export const UcpCartCancelRequestSchema = Type.Object(
  {
    reason: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: true }
)

export const UcpCartSchema = Type.Object(
  {
    ucp: UcpCartResponseMetadataSchema,
    id: Type.String({ minLength: 1 }),
    // UCP puts cart response status inside the `ucp` metadata object, not on the
    // Cart itself, and `links` is optional. Requiring either at the top level
    // rejects conforming merchant carts.
    status: Type.Optional(Type.String({ minLength: 1 })),
    currency: Type.String({ minLength: 3, maxLength: 3, pattern: '^[A-Z]{3}$' }),
    line_items: Type.Array(UcpLineItemSchema),
    totals: Type.Array(UcpMoneyAmountSchema),
    links: Type.Optional(Type.Array(UcpLinkSchema)),
    buyer: Type.Optional(UcpBuyerSchema),
    context: Type.Optional(UcpJsonObjectSchema),
    signals: Type.Optional(UcpJsonObjectSchema),
    attribution: Type.Optional(UcpJsonObjectSchema),
    messages: Type.Optional(Type.Array(UcpCheckoutMessageSchema)),
    expires_at: Type.Optional(IsoDateTimeSchema),
    continue_url: Type.Optional(Type.String({ minLength: 1 })),
    fulfillment: Type.Optional(UcpFulfillmentSchema),
    checkout_id: Type.Optional(Type.String({ minLength: 1 })),
    actions: Type.Optional(UcpActionsSchema)
  },
  { additionalProperties: true }
)

export const UcpCheckoutCreateRequestSchema = Type.Object(
  {
    cart_id: Type.Optional(Type.String({ minLength: 1 })),
    line_items: Type.Optional(Type.Array(UcpLineItemCreateRequestSchema)),
    buyer: Type.Optional(UcpBuyerSchema),
    fulfillment: Type.Optional(UcpFulfillmentSchema),
    payment: Type.Optional(UcpCheckoutPaymentSchema),
    context: Type.Optional(UcpJsonObjectSchema),
    signals: Type.Optional(UcpJsonObjectSchema),
    attribution: Type.Optional(UcpJsonObjectSchema)
  },
  {
    additionalProperties: true,
    anyOf: [
      { required: ['line_items'] },
      { required: ['cart_id'] }
    ]
  }
)

export const UcpCheckoutUpdateRequestSchema = Type.Object(
  {
    line_items: Type.Array(UcpLineItemUpdateRequestSchema),
    buyer: Type.Optional(UcpBuyerSchema),
    fulfillment: Type.Optional(UcpFulfillmentSchema),
    payment: Type.Optional(UcpCheckoutPaymentSchema),
    context: Type.Optional(UcpJsonObjectSchema),
    signals: Type.Optional(UcpJsonObjectSchema),
    attribution: Type.Optional(UcpJsonObjectSchema)
  },
  { additionalProperties: true }
)

export const UcpCheckoutCompleteRequestSchema = Type.Object(
  {
    payment: UcpCheckoutPaymentSchema,
    ap2: Type.Optional(Type.Object(
      {
        checkout_mandate: Type.String({ minLength: 1 })
      },
      { additionalProperties: false }
    )),
    signals: Type.Optional(UcpJsonObjectSchema),
    attribution: Type.Optional(UcpJsonObjectSchema)
  },
  { additionalProperties: true }
)

export const UcpCheckoutCancelRequestSchema = Type.Object(
  {
    reason: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: true }
)

export const UcpOrderConfirmationSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    label: Type.Optional(Type.String()),
    permalink_url: Type.String({ minLength: 1 })
  },
  { additionalProperties: true }
)

export const UcpCheckoutSchema = Type.Object(
  {
    ucp: UcpCheckoutResponseMetadataSchema,
    id: Type.String({ minLength: 1 }),
    status: UcpCheckoutStatusSchema,
    currency: Type.String({ minLength: 3, maxLength: 3, pattern: '^[A-Z]{3}$' }),
    line_items: Type.Array(UcpLineItemSchema),
    totals: Type.Array(UcpMoneyAmountSchema),
    links: Type.Array(UcpLinkSchema),
    policies: Type.Optional(Type.Array(UcpPolicySchema)),
    buyer: Type.Optional(UcpBuyerSchema),
    context: Type.Optional(UcpJsonObjectSchema),
    signals: Type.Optional(UcpJsonObjectSchema),
    attribution: Type.Optional(UcpJsonObjectSchema),
    messages: Type.Optional(Type.Array(UcpCheckoutMessageSchema)),
    expires_at: Type.Optional(IsoDateTimeSchema),
    continue_url: Type.Optional(Type.String({ minLength: 1 })),
    payment: Type.Optional(UcpCheckoutPaymentSchema),
    fulfillment: Type.Optional(UcpFulfillmentSchema),
    order: Type.Optional(UcpOrderConfirmationSchema),
    actions: Type.Optional(UcpActionsSchema)
  },
  { additionalProperties: true }
)

export const UcpErrorMetadataSchema = Type.Object(
  {
    ...ucpResponseMetadataFields,
    status: Type.Literal('error')
  },
  { additionalProperties: true }
)

export const UcpErrorResponseSchema = Type.Object(
  {
    ucp: UcpErrorMetadataSchema,
    messages: Type.Array(UcpCheckoutMessageSchema, { minItems: 1 }),
    continue_url: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export const UcpCartOperationResponseSchema = Type.Union([
  UcpCartSchema,
  UcpErrorResponseSchema
])

export const UcpCheckoutOperationResponseSchema = Type.Union([
  UcpCheckoutSchema,
  UcpErrorResponseSchema
])

export const UcpOrderFulfillmentSchema = Type.Object(
  {
    expectations: Type.Optional(Type.Array(UcpJsonObjectSchema)),
    events: Type.Optional(Type.Array(UcpJsonObjectSchema))
  },
  { additionalProperties: true }
)

export const UcpOrderSchema = Type.Object(
  {
    ucp: UcpOrderResponseMetadataSchema,
    id: Type.String({ minLength: 1 }),
    label: Type.Optional(Type.String()),
    checkout_id: Type.String({ minLength: 1 }),
    permalink_url: Type.String({ minLength: 1 }),
    currency: Type.String({ minLength: 3, maxLength: 3 }),
    line_items: Type.Array(UcpOrderLineItemSchema),
    fulfillment: UcpOrderFulfillmentSchema,
    adjustments: Type.Optional(Type.Array(UcpJsonObjectSchema)),
    totals: Type.Array(UcpMoneyAmountSchema),
    policies: Type.Optional(Type.Array(UcpPolicySchema)),
    messages: Type.Optional(Type.Array(UcpCheckoutMessageSchema)),
    attribution: Type.Optional(UcpJsonObjectSchema)
  },
  { additionalProperties: true }
)

export const UcpOrderWebhookEventSchema = UcpOrderSchema

export const UcpCheckoutConfirmationSchema = Type.Object(
  {
    checkoutId: Type.String({ minLength: 1 }),
    checkoutSnapshotHash: Type.String({ pattern: '^sha256:[0-9a-f]{64}$' }),
    totalAmount: Type.Optional(Type.Integer()),
    currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
    approvedAt: IsoDateTimeSchema,
    approvalRef: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
)

export const ArroUcpTransactionSchema = Type.Object(
  {
    transactionId: Type.String({ minLength: 1 }),
    integrationId: Type.String({ minLength: 1 }),
    externalSubjectRefHash: Type.Optional(Type.String({ pattern: '^sha256:[0-9a-f]{64}$' })),
    externalTaskRefHash: Type.Optional(Type.String({ pattern: '^sha256:[0-9a-f]{64}$' })),
    merchantProfileUrl: Type.String({ minLength: 1 }),
    merchantOrigin: Type.String({ minLength: 1 }),
    ucpVersion: UcpProtocolVersionSchema,
    checkoutId: Type.String({ minLength: 1 }),
    selectedPaymentHandlerId: Type.Optional(Type.String({ minLength: 1 })),
    idempotencyKey: UcpIdempotencyKeySchema,
    lastCheckoutStatus: UcpCheckoutStatusSchema,
    orderId: Type.Optional(Type.String({ minLength: 1 })),
    orderPermalinkUrl: Type.Optional(Type.String({ minLength: 1 })),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema
  },
  { additionalProperties: false }
)

export type UcpProtocolVersion = Static<typeof UcpProtocolVersionSchema>
export type UcpIdempotencyKey = Static<typeof UcpIdempotencyKeySchema>
export type UcpServiceTransport = Static<typeof UcpServiceTransportSchema>
export type UcpJsonObject = Static<typeof UcpJsonObjectSchema>
export type UcpReverseDomainName = Static<typeof UcpReverseDomainNameSchema>
export type UcpProtocolServiceDeclaration = Static<typeof UcpProtocolServiceDeclarationSchema>
export type UcpPlatformServiceDeclaration = Static<typeof UcpPlatformServiceDeclarationSchema>
export type UcpBusinessServiceDeclaration = Static<typeof UcpBusinessServiceDeclarationSchema>
export type UcpResponseServiceDeclaration = Static<typeof UcpResponseServiceDeclarationSchema>
export type UcpProtocolCapabilityDeclaration = Static<typeof UcpProtocolCapabilityDeclarationSchema>
export type UcpPlatformCapabilityDeclaration = Static<typeof UcpPlatformCapabilityDeclarationSchema>
export type UcpBusinessCapabilityDeclaration = Static<typeof UcpBusinessCapabilityDeclarationSchema>
export type UcpResponseCapabilityDeclaration = Static<typeof UcpResponseCapabilityDeclarationSchema>
export type UcpAvailablePaymentInstrument = Static<typeof UcpAvailablePaymentInstrumentSchema>
export type UcpPaymentHandlerDeclaration = Static<typeof UcpPaymentHandlerDeclarationSchema>
export type UcpPlatformPaymentHandlerDeclaration = Static<typeof UcpPlatformPaymentHandlerDeclarationSchema>
export type UcpBusinessPaymentHandlerDeclaration = Static<typeof UcpBusinessPaymentHandlerDeclarationSchema>
export type UcpResponsePaymentHandlerDeclaration = Static<typeof UcpResponsePaymentHandlerDeclarationSchema>
export type UcpResponseMetadata = Static<typeof UcpResponseMetadataSchema>
export type UcpCheckoutResponseMetadata = Static<typeof UcpCheckoutResponseMetadataSchema>
export type UcpPublicJwk = Static<typeof UcpPublicJwkSchema>
export type UcpBusinessProfile = Static<typeof UcpBusinessProfileSchema>
export type UcpPlatformProfile = Static<typeof UcpPlatformProfileSchema>
export type UcpProfile = Static<typeof UcpProfileSchema>
export type UcpCheckoutStatus = Static<typeof UcpCheckoutStatusSchema>
export type UcpCheckoutMessage = Static<typeof UcpCheckoutMessageSchema>
export type UcpMoneyAmount = Static<typeof UcpMoneyAmountSchema>
export type UcpItemRequest = Static<typeof UcpItemRequestSchema>
export type UcpItemReference = Static<typeof UcpItemReferenceSchema>
export type UcpLineItemCreateRequest = Static<typeof UcpLineItemCreateRequestSchema>
export type UcpLineItemUpdateRequest = Static<typeof UcpLineItemUpdateRequestSchema>
export type UcpLineItemRequest = Static<typeof UcpLineItemRequestSchema>
export type UcpLineItem = Static<typeof UcpLineItemSchema>
export type UcpOrderLineItem = Static<typeof UcpOrderLineItemSchema>
export type UcpBuyer = Static<typeof UcpBuyerSchema>
export type UcpDescription = Static<typeof UcpDescriptionSchema>
export type UcpPostalAddress = Static<typeof UcpPostalAddressSchema>
export type UcpShippingDestination = Static<typeof UcpShippingDestinationSchema>
export type UcpBusinessLocationDestination = Static<typeof UcpBusinessLocationDestinationSchema>
export type UcpFulfillmentDestination = Static<typeof UcpFulfillmentDestinationSchema>
export type UcpFulfillmentOption = Static<typeof UcpFulfillmentOptionSchema>
export type UcpFulfillmentGroup = Static<typeof UcpFulfillmentGroupSchema>
export type UcpFulfillmentMethod = Static<typeof UcpFulfillmentMethodSchema>
export type UcpFulfillmentAvailableMethod = Static<typeof UcpFulfillmentAvailableMethodSchema>
export type UcpFulfillment = Static<typeof UcpFulfillmentSchema>
export type UcpPaymentCredential = Static<typeof UcpPaymentCredentialSchema>
export type UcpPaymentInstrument = Static<typeof UcpPaymentInstrumentSchema>
export type UcpActionInstance = Static<typeof UcpActionInstanceSchema>
export type UcpActions = Static<typeof UcpActionsSchema>
export type UcpLink = Static<typeof UcpLinkSchema>
export type UcpPolicy = Static<typeof UcpPolicySchema>
export type UcpCheckoutPayment = Static<typeof UcpCheckoutPaymentSchema>
export type UcpCartCreateRequest = Static<typeof UcpCartCreateRequestSchema>
export type UcpCartUpdateRequest = Static<typeof UcpCartUpdateRequestSchema>
export type UcpCartCancelRequest = Static<typeof UcpCartCancelRequestSchema>
export type UcpCart = Static<typeof UcpCartSchema>
export type UcpCartOperationResponse = Static<typeof UcpCartOperationResponseSchema>
export type UcpCheckoutCreateRequest = Static<typeof UcpCheckoutCreateRequestSchema>
export type UcpCheckoutUpdateRequest = Static<typeof UcpCheckoutUpdateRequestSchema>
export type UcpCheckoutCompleteRequest = Static<typeof UcpCheckoutCompleteRequestSchema>
export type UcpCheckoutCancelRequest = Static<typeof UcpCheckoutCancelRequestSchema>
export type UcpCheckout = Static<typeof UcpCheckoutSchema>
export type UcpErrorMetadata = Static<typeof UcpErrorMetadataSchema>
export type UcpErrorResponse = Static<typeof UcpErrorResponseSchema>
export type UcpCheckoutOperationResponse = Static<typeof UcpCheckoutOperationResponseSchema>
export type UcpOrderFulfillment = Static<typeof UcpOrderFulfillmentSchema>
export type UcpOrder = Static<typeof UcpOrderSchema>
export type UcpOrderWebhookEvent = Static<typeof UcpOrderWebhookEventSchema>
export type UcpCheckoutConfirmation = Static<typeof UcpCheckoutConfirmationSchema>
export type ArroUcpTransaction = Static<typeof ArroUcpTransactionSchema>
