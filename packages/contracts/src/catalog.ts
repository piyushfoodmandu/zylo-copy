import { Type, type Static } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  IsoDateTimeSchema,
  PlainStatusMessageSchema,
  SourceLabelSchema,
  validationErrorSummary
} from './common.ts'
import {
  AgentActionPolicySchema,
  AgentIntegrationIdSchema,
  AgentInvocationContextSchema,
  AgentSurfaceSchema
} from './agent.ts'
import { MoneySchema } from './money.ts'
export { MoneySchema } from './money.ts'
import {
  TargetBusinessCapabilityStatusSchema,
  TargetBusinessFeatureVisibilitySchema,
  TargetBusinessLaunchStatusSchema,
  TargetBusinessSourceTypeSchema,
  UcpAccessPolicyStateSchema
} from './connectors.ts'

export const CatalogContextSchema = Type.Object(
  {
    locale: Type.Optional(Type.String({ minLength: 2, maxLength: 35 })),
    region: Type.Optional(Type.String({ minLength: 2, maxLength: 3 })),
    currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
    channel: Type.Optional(
      Type.Union([
        Type.Literal('web'),
        Type.Literal('mobile'),
        Type.Literal('agent'),
        Type.Literal('internal')
      ])
    ),
    requestedQuantity: Type.Optional(Type.Integer({ minimum: 1, maximum: 99 }))
  },
  { additionalProperties: false }
)

export const CatalogSearchSortSchema = Type.Union([
  Type.Literal('relevance'),
  Type.Literal('price_asc'),
  Type.Literal('price_desc')
])

export const CatalogSearchIntentAttributeSchema = Type.Union([
  Type.String({ minLength: 1, maxLength: 80 }),
  Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
    minItems: 1,
    maxItems: 12
  })
])

export const CatalogSearchIntentSchema = Type.Object(
  {
    summary: Type.Optional(Type.String({ minLength: 1, maxLength: 360 })),
    productTypes: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      minItems: 1,
      maxItems: 12
    })),
    categories: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
      minItems: 1,
      maxItems: 12
    })),
    brands: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      minItems: 1,
      maxItems: 12
    })),
    attributes: Type.Optional(Type.Record(
      Type.String({ minLength: 1, maxLength: 80 }),
      CatalogSearchIntentAttributeSchema,
      { maxProperties: 16 }
    )),
    requiredTerms: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      minItems: 1,
      maxItems: 20
    })),
    excludedTerms: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 80 }), {
      minItems: 1,
      maxItems: 20
    })),
    minPrice: Type.Optional(MoneySchema),
    maxPrice: Type.Optional(MoneySchema),
    sellerDomains: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 253 }), {
      minItems: 1,
      maxItems: 8
    })),
    sort: Type.Optional(CatalogSearchSortSchema)
  },
  { additionalProperties: false }
)

export const CatalogSearchRequestSchema = Type.Object(
  {
    query: Type.String({ minLength: 1, maxLength: 256 }),
    intent: Type.Optional(CatalogSearchIntentSchema),
    filters: Type.Optional(
      Type.Record(
        Type.String({ minLength: 1 }),
        Type.Union([
          Type.String(),
          Type.Number(),
          Type.Boolean(),
          Type.Array(Type.String())
        ]),
        { maxProperties: 32 }
      )
    ),
    context: Type.Optional(CatalogContextSchema),
    agentContext: Type.Optional(AgentInvocationContextSchema),
    pagination: Type.Optional(
      Type.Object(
        {
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
          cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 8192 }))
        },
        { additionalProperties: false }
      )
    )
  },
  { additionalProperties: false }
)

export const CatalogProductSelectionSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 120 }),
    label: Type.String({ minLength: 1, maxLength: 240 }),
    id: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
    /**
     * Whether this value is the caller's own decision. A caller carrying a
     * source default forward to keep the configuration exact sets it false, so
     * a default never reads as intent. Absent means chosen: a caller that sends
     * a value without saying otherwise is asking for it.
     */
    chosen: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
)

export const CatalogProductDetailRequestSchema = Type.Object(
  {
    businessId: Type.String({ minLength: 1 }),
    productId: Type.String({ minLength: 1 }),
    variantId: Type.Optional(Type.String({ minLength: 1 })),
    selected: Type.Optional(Type.Array(CatalogProductSelectionSchema, { maxItems: 24 })),
    preferences: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 120 }), {
      maxItems: 24,
      uniqueItems: true
    })),
    context: Type.Optional(CatalogContextSchema),
    agentContext: Type.Optional(AgentInvocationContextSchema)
  },
  { additionalProperties: false }
)

export const CatalogCartPrepareItemRequestSchema = Type.Object(
  {
    productId: Type.String({ minLength: 1 }),
    variantId: Type.Optional(Type.String({ minLength: 1 })),
    quantity: Type.Integer({ minimum: 1, maximum: 99 })
  },
  { additionalProperties: false }
)

export const CatalogCartPrepareActionSchema = Type.Union([
  Type.Literal('prepare_purchase'),
  Type.Literal('create_checkout_session')
])

export const CatalogCartPreparationSchema = Type.Object(
  {
    preparationRef: Type.String({ minLength: 1, maxLength: 160 }),
    decisionReceiptId: Type.String({ minLength: 1, maxLength: 160 }),
    idempotencyKey: Type.String({ minLength: 8, maxLength: 128 }),
    action: CatalogCartPrepareActionSchema,
    confirmedAt: IsoDateTimeSchema,
    expiresAt: IsoDateTimeSchema,
    itemSnapshotHash: Type.String({ pattern: '^sha256:[0-9a-f]{64}$' }),
    businessId: Type.String({ minLength: 1 }),
    externalTaskRef: Type.String({ minLength: 1, maxLength: 160 }),
    integrationId: AgentIntegrationIdSchema,
    surface: AgentSurfaceSchema,
    maxEstimatedTotal: Type.Optional(MoneySchema)
  },
  { additionalProperties: false }
)

export const CatalogCartPreparationIssueRequestSchema = Type.Object(
  {
    businessId: Type.String({ minLength: 1 }),
    items: Type.Array(CatalogCartPrepareItemRequestSchema, { minItems: 1, maxItems: 50 }),
    context: Type.Optional(CatalogContextSchema),
    agentContext: AgentInvocationContextSchema,
    decisionReceiptId: Type.String({ minLength: 1, maxLength: 160 }),
    idempotencyKey: Type.String({ minLength: 8, maxLength: 128 }),
    action: CatalogCartPrepareActionSchema,
    confirmedAt: IsoDateTimeSchema,
    confirmationRef: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    maxEstimatedTotal: Type.Optional(MoneySchema)
  },
  { additionalProperties: false }
)

export const CatalogCartPreparationIssueResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    state: Type.Union([
      Type.Literal('issued'),
      Type.Literal('idempotent_replay')
    ]),
    preparation: CatalogCartPreparationSchema,
    messages: Type.Array(PlainStatusMessageSchema, { minItems: 1, maxItems: 8 })
  },
  { additionalProperties: false }
)

export const CatalogCartPrepareRequestSchema = Type.Object(
  {
    businessId: Type.String({ minLength: 1 }),
    items: Type.Array(CatalogCartPrepareItemRequestSchema, { minItems: 1, maxItems: 50 }),
    context: Type.Optional(CatalogContextSchema),
    agentContext: AgentInvocationContextSchema,
    idempotencyKey: Type.String({ minLength: 8, maxLength: 128 }),
    preparation: CatalogCartPreparationSchema
  },
  { additionalProperties: false }
)

export const CatalogProductSanityCheckIdentifierSchema = Type.Object(
  {
    kind: Type.Union([
      Type.Literal('product_id'),
      Type.Literal('variant_id'),
      Type.Literal('sku'),
      Type.Literal('gtin'),
      Type.Literal('asin'),
      Type.Literal('model'),
      Type.Literal('url_slug')
    ]),
    value: Type.String({ minLength: 1, maxLength: 160 })
  },
  { additionalProperties: false }
)

export const ProductAvailabilitySchema = Type.Union([
  Type.Literal('in_stock'),
  Type.Literal('limited'),
  Type.Literal('out_of_stock'),
  Type.Literal('unknown')
])

export const ProductConditionSchema = Type.Union([
  Type.Literal('new'),
  Type.Literal('refurbished'),
  Type.Literal('open_box'),
  Type.Literal('used'),
  Type.Literal('unknown')
])

export const CatalogProductRatingSchema = Type.Object(
  {
    value: Type.Number({ minimum: 0 }),
    scaleMax: Type.Number({ exclusiveMinimum: 0 }),
    count: Type.Integer({ minimum: 0 })
  },
  { additionalProperties: false }
)

export const CatalogSellerIdentitySchema = Type.Object(
  {
    id: Type.Optional(Type.String({ minLength: 1 })),
    name: Type.Optional(Type.String({ minLength: 1 })),
    domain: Type.String({ minLength: 1 }),
    url: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export const CatalogHandoffSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal('product'),
      Type.Literal('variant_checkout'),
      Type.Literal('seller')
    ]),
    url: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
)

export const SearchSourceModeSchema = Type.Union([
  Type.Literal('approved_sources'),
  Type.Literal('connected_sources'),
  Type.Literal('unconfigured')
])

export const InterpretedSearchQuerySchema = Type.Object(
  {
    raw: Type.String({ minLength: 1 }),
    normalized: Type.String({ minLength: 1 }),
    intentSource: Type.Union([
      Type.Literal('query'),
      Type.Literal('host_agent'),
      Type.Literal('query_and_host_agent')
    ]),
    detectedBrands: Type.Array(Type.String({ minLength: 1 })),
    detectedCategories: Type.Array(Type.String({ minLength: 1 })),
    productTypes: Type.Array(Type.String({ minLength: 1 })),
    attributes: Type.Record(Type.String({ minLength: 1 }), Type.Array(Type.String({ minLength: 1 })),
      { additionalProperties: false }
    ),
    requiredTerms: Type.Array(Type.String({ minLength: 1 })),
    excludedTerms: Type.Array(Type.String({ minLength: 1 })),
    sellerDomains: Type.Array(Type.String({ minLength: 1 })),
    minPrice: Type.Optional(MoneySchema),
    maxPrice: Type.Optional(MoneySchema),
    sort: Type.Optional(CatalogSearchSortSchema),
    constraints: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export const CatalogProductSummarySchema = Type.Object(
  {
    productId: Type.String({ minLength: 1 }),
    businessId: Type.String({ minLength: 1 }),
    businessName: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    brand: Type.Optional(Type.String({ minLength: 1 })),
    description: Type.Optional(Type.String({ minLength: 1 })),
    categoryPath: Type.Array(Type.String({ minLength: 1 })),
    variantId: Type.Optional(Type.String({ minLength: 1 })),
    price: Type.Optional(MoneySchema),
    availability: ProductAvailabilitySchema,
    condition: ProductConditionSchema,
    productUrl: Type.Optional(Type.String({ minLength: 1 })),
    imageUrl: Type.Optional(Type.String({ minLength: 1 })),
    rating: Type.Optional(CatalogProductRatingSchema),
    seller: Type.Optional(CatalogSellerIdentitySchema),
    handoff: Type.Optional(CatalogHandoffSchema),
    matchReasons: Type.Array(Type.String({ minLength: 1 })),
    sourceLabel: SourceLabelSchema
  },
  { additionalProperties: false }
)

export const CatalogProductMediaSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal('image'),
      Type.Literal('video'),
      Type.Literal('unknown')
    ]),
    url: Type.String({ minLength: 1 }),
    alt: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export const CatalogProductOptionValueSchema = Type.Object(
  {
    label: Type.String({ minLength: 1 }),
    id: Type.Optional(Type.String({ minLength: 1 })),
    available: Type.Optional(Type.Boolean()),
    exists: Type.Optional(Type.Boolean())
  },
  { additionalProperties: false }
)

export const CatalogProductOptionSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    values: Type.Array(CatalogProductOptionValueSchema)
  },
  { additionalProperties: false }
)

export const CatalogProductSelectedOptionSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    label: Type.String({ minLength: 1 }),
    id: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export const CatalogProductVariantSchema = Type.Object(
  {
    variantId: Type.String({ minLength: 1 }),
    title: Type.Optional(Type.String({ minLength: 1 })),
    /**
     * A merchant's full product copy frequently hangs off the variant rather
     * than the product — the product-level description is a one-line summary of
     * the cluster, and the variant carries the page a shopper would actually
     * read. Dropping it left product pages with a single sentence.
     */
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 20000 })),
    selectedOptions: Type.Array(CatalogProductSelectedOptionSchema),
    price: Type.Optional(MoneySchema),
    availability: ProductAvailabilitySchema,
    condition: Type.Optional(ProductConditionSchema),
    seller: Type.Optional(CatalogSellerIdentitySchema),
    productUrl: Type.Optional(Type.String({ minLength: 1 })),
    handoff: Type.Optional(CatalogHandoffSchema)
  },
  { additionalProperties: false }
)

export const CatalogCartHandoffSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal('cart'),
      Type.Literal('checkout'),
      Type.Literal('seller')
    ]),
    url: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
)

export const CatalogCartLineItemSchema = Type.Object(
  {
    lineId: Type.Optional(Type.String({ minLength: 1 })),
    productId: Type.String({ minLength: 1 }),
    variantId: Type.Optional(Type.String({ minLength: 1 })),
    title: Type.Optional(Type.String({ minLength: 1 })),
    quantity: Type.Integer({ minimum: 1, maximum: 99 }),
    unitPrice: Type.Optional(MoneySchema),
    lineTotal: Type.Optional(MoneySchema),
    availability: ProductAvailabilitySchema
  },
  { additionalProperties: false }
)

export const CatalogPreparedCartSchema = Type.Object(
  {
    cartId: Type.String({ minLength: 1 }),
    businessId: Type.String({ minLength: 1 }),
    businessName: Type.String({ minLength: 1 }),
    items: Type.Array(CatalogCartLineItemSchema, { minItems: 1 }),
    subtotal: Type.Optional(MoneySchema),
    estimatedTax: Type.Optional(MoneySchema),
    estimatedShipping: Type.Optional(MoneySchema),
    estimatedTotal: Type.Optional(MoneySchema),
    handoff: Type.Optional(CatalogCartHandoffSchema),
    expiresAt: Type.Optional(IsoDateTimeSchema),
    warnings: Type.Array(PlainStatusMessageSchema),
    sourceLabel: SourceLabelSchema
  },
  { additionalProperties: false }
)

export const CatalogProductDetailSchema = Type.Object(
  {
    productId: Type.String({ minLength: 1 }),
    businessId: Type.String({ minLength: 1 }),
    businessName: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    brand: Type.Optional(Type.String({ minLength: 1 })),
    description: Type.Optional(Type.String({ minLength: 1 })),
    categoryPath: Type.Array(Type.String({ minLength: 1 })),
    variantId: Type.Optional(Type.String({ minLength: 1 })),
    price: Type.Optional(MoneySchema),
    availability: ProductAvailabilitySchema,
    condition: ProductConditionSchema,
    productUrl: Type.Optional(Type.String({ minLength: 1 })),
    imageUrl: Type.Optional(Type.String({ minLength: 1 })),
    rating: Type.Optional(CatalogProductRatingSchema),
    seller: Type.Optional(CatalogSellerIdentitySchema),
    handoff: Type.Optional(CatalogHandoffSchema),
    media: Type.Array(CatalogProductMediaSchema),
    options: Type.Array(CatalogProductOptionSchema),
    selected: Type.Array(CatalogProductSelectedOptionSchema),
    variants: Type.Array(CatalogProductVariantSchema),
    /** Merchant-written selling points, one per entry, in the shop's own words. */
    highlights: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 400 }), { maxItems: 24 })),
    /**
     * Merchant-published attributes, already split into label and value. Sources
     * ship these as one newline-delimited blob; normalising here keeps vendor
     * parsing out of every consumer.
     */
    specifications: Type.Optional(Type.Array(
      Type.Object(
        {
          label: Type.String({ minLength: 1, maxLength: 120 }),
          value: Type.String({ minLength: 1, maxLength: 600 })
        },
        { additionalProperties: false }
      ),
      { maxItems: 60 }
    )),
    warnings: Type.Array(PlainStatusMessageSchema),
    sourceLabel: SourceLabelSchema
  },
  { additionalProperties: false }
)

export const CatalogProductSearchInputSchema = Type.Object(
  {
    productId: Type.String({ minLength: 1 }),
    businessId: Type.String({ minLength: 1 }),
    businessName: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    brand: Type.Optional(Type.String({ minLength: 1 })),
    description: Type.Optional(Type.String({ minLength: 1 })),
    categoryPath: Type.Array(Type.String({ minLength: 1 })),
    variantId: Type.Optional(Type.String({ minLength: 1 })),
    price: Type.Optional(MoneySchema),
    availability: ProductAvailabilitySchema,
    condition: ProductConditionSchema,
    productUrl: Type.Optional(Type.String({ minLength: 1 })),
    imageUrl: Type.Optional(Type.String({ minLength: 1 })),
    rating: Type.Optional(CatalogProductRatingSchema),
    seller: Type.Optional(CatalogSellerIdentitySchema),
    handoff: Type.Optional(CatalogHandoffSchema),
    tags: Type.Array(Type.String({ minLength: 1 })),
    sourceLabel: SourceLabelSchema
  },
  { additionalProperties: false }
)

export const CatalogProductSanityCheckRequestSchema = Type.Object(
  {
    intentSummary: Type.Optional(Type.String({ minLength: 1, maxLength: 360 })),
    submittedUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    identifiers: Type.Optional(
      Type.Array(CatalogProductSanityCheckIdentifierSchema, {
        maxItems: 12
      })
    ),
    visibleClaimText: Type.Optional(Type.String({ minLength: 1, maxLength: 2000 })),
    candidates: Type.Optional(
      Type.Array(CatalogProductSearchInputSchema, {
        maxItems: 10
      })
    ),
    context: Type.Optional(CatalogContextSchema),
    agentContext: Type.Optional(AgentInvocationContextSchema)
  },
  { additionalProperties: false }
)

export const CatalogProductCompareCriterionSchema = Type.Union([
  Type.Literal('price'),
  Type.Literal('availability'),
  Type.Literal('condition'),
  Type.Literal('source_freshness'),
  Type.Literal('handoff_readiness'),
  Type.Literal('seller_identity')
])

export const CatalogProductCompareRequestSchema = Type.Object(
  {
    intentSummary: Type.Optional(Type.String({ minLength: 1, maxLength: 360 })),
    sourceMode: Type.Optional(SearchSourceModeSchema),
    products: Type.Array(CatalogProductSearchInputSchema, {
      minItems: 1,
      maxItems: 8
    }),
    criteria: Type.Optional(
      Type.Array(CatalogProductCompareCriterionSchema, {
        minItems: 1,
        maxItems: 8,
        uniqueItems: true
      })
    ),
    context: Type.Optional(CatalogContextSchema),
    agentContext: Type.Optional(AgentInvocationContextSchema)
  },
  { additionalProperties: false }
)

export const CatalogSourceStateRequestSchema = Type.Object(
  {
    businessId: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
    domain: Type.Optional(Type.String({ minLength: 1, maxLength: 253 })),
    context: Type.Optional(CatalogContextSchema),
    agentContext: Type.Optional(AgentInvocationContextSchema)
  },
  { additionalProperties: false }
)

export const CommercialIsolationManifestSchema = Type.Object(
  {
    version: Type.String({ minLength: 1 }),
    allowedProductFactFields: Type.Array(Type.String({ minLength: 1 })),
    excludedCommercialFields: Type.Array(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export const commercialIsolationManifest = {
  version: 'catalog-product-search-input-v1',
  allowedProductFactFields: [
    'productId',
    'businessId',
    'businessName',
    'title',
    'brand',
    'description',
    'categoryPath',
    'variantId',
    'price',
    'availability',
    'condition',
    'productUrl',
    'imageUrl',
    'rating',
    'seller',
    'handoff',
    'tags',
    'sourceLabel'
  ],
  excludedCommercialFields: [
    'affiliatePriority',
    'commissionRate',
    'commercialRankingScore',
    'margin',
    'paidPlacement',
    'partnerTier',
    'payoutAmount',
    'payoutRate',
    'settlementState'
  ]
} satisfies CommercialIsolationManifest

export const CatalogSearchResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    sourceMode: SearchSourceModeSchema,
    interpretedQuery: InterpretedSearchQuerySchema,
    state: Type.Union([
      Type.Literal('ready'),
      Type.Literal('limited'),
      Type.Literal('unavailable')
    ]),
    items: Type.Array(CatalogProductSummarySchema),
    pageInfo: Type.Optional(
      Type.Object(
        {
          hasNextPage: Type.Boolean(),
          nextCursor: Type.Optional(Type.String({ minLength: 1, maxLength: 8192 }))
        },
        { additionalProperties: false }
      )
    ),
    messages: Type.Array(PlainStatusMessageSchema),
    actionPolicy: AgentActionPolicySchema,
    fetchedAt: IsoDateTimeSchema
  },
  { additionalProperties: false }
)

export const CatalogProductDetailResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    sourceMode: SearchSourceModeSchema,
    state: Type.Union([
      Type.Literal('ready'),
      Type.Literal('limited'),
      Type.Literal('unavailable')
    ]),
    product: Type.Optional(CatalogProductDetailSchema),
    messages: Type.Array(PlainStatusMessageSchema),
    actionPolicy: AgentActionPolicySchema,
    fetchedAt: IsoDateTimeSchema
  },
  { additionalProperties: false }
)

export const CatalogCartPrepareResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    sourceMode: SearchSourceModeSchema,
    state: Type.Union([
      Type.Literal('ready'),
      Type.Literal('limited'),
      Type.Literal('unavailable')
    ]),
    cart: Type.Optional(CatalogPreparedCartSchema),
    messages: Type.Array(PlainStatusMessageSchema),
    actionPolicy: AgentActionPolicySchema,
    fetchedAt: IsoDateTimeSchema
  },
  { additionalProperties: false }
)

export const CatalogProductSanityCheckStateSchema = Type.Union([
  Type.Literal('supported'),
  Type.Literal('needs_review'),
  Type.Literal('no_buy'),
  Type.Literal('unsupported_evidence')
])

export const CatalogProductSanityCheckEvidenceSummarySchema = Type.Object(
  {
    hasSubmittedUrl: Type.Boolean(),
    submittedUrlHost: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
    identifierCount: Type.Integer({ minimum: 0, maximum: 12 }),
    hasVisibleClaimText: Type.Boolean(),
    candidateCount: Type.Integer({ minimum: 0, maximum: 10 }),
    sourceLabelCount: Type.Integer({ minimum: 0, maximum: 10 })
  },
  { additionalProperties: false }
)

export const CatalogProductSanityCheckCandidateAssessmentSchema = Type.Object(
  {
    businessId: Type.String({ minLength: 1 }),
    productId: Type.String({ minLength: 1 }),
    variantId: Type.Optional(Type.String({ minLength: 1 })),
    title: Type.String({ minLength: 1 }),
    matchState: Type.Union([
      Type.Literal('supports'),
      Type.Literal('conflicts'),
      Type.Literal('uncertain')
    ]),
    reasons: Type.Array(Type.String({ minLength: 1, maxLength: 240 }), {
      minItems: 1,
      maxItems: 6
    }),
    sourceLabel: SourceLabelSchema
  },
  { additionalProperties: false }
)

export const CatalogProductSanityCheckResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    state: CatalogProductSanityCheckStateSchema,
    evidence: CatalogProductSanityCheckEvidenceSummarySchema,
    candidateAssessments: Type.Array(CatalogProductSanityCheckCandidateAssessmentSchema, {
      maxItems: 10
    }),
    findings: Type.Array(PlainStatusMessageSchema, {
      minItems: 1,
      maxItems: 12
    }),
    actionPolicy: AgentActionPolicySchema,
    checkedAt: IsoDateTimeSchema
  },
  { additionalProperties: false }
)

export const CatalogProductCompareStateSchema = Type.Union([
  Type.Literal('ready'),
  Type.Literal('needs_review'),
  Type.Literal('unsupported_evidence')
])

export const CatalogProductCompareEvidenceSummarySchema = Type.Object(
  {
    productCount: Type.Integer({ minimum: 0, maximum: 8 }),
    sourceLabelCount: Type.Integer({ minimum: 0, maximum: 8 }),
    staleSourceLabelCount: Type.Integer({ minimum: 0, maximum: 8 }),
    unavailableProductCount: Type.Integer({ minimum: 0, maximum: 8 }),
    hasIntentSummary: Type.Boolean(),
    criteria: Type.Array(CatalogProductCompareCriterionSchema, {
      minItems: 1,
      maxItems: 8
    })
  },
  { additionalProperties: false }
)

export const CatalogProductCompareAssessmentSchema = Type.Object(
  {
    businessId: Type.String({ minLength: 1 }),
    productId: Type.String({ minLength: 1 }),
    variantId: Type.Optional(Type.String({ minLength: 1 })),
    title: Type.String({ minLength: 1 }),
    price: Type.Optional(MoneySchema),
    availability: ProductAvailabilitySchema,
    condition: ProductConditionSchema,
    comparisonState: Type.Union([
      Type.Literal('stronger'),
      Type.Literal('viable'),
      Type.Literal('risky'),
      Type.Literal('unavailable')
    ]),
    strengths: Type.Array(Type.String({ minLength: 1, maxLength: 240 }), {
      maxItems: 6
    }),
    risks: Type.Array(Type.String({ minLength: 1, maxLength: 240 }), {
      maxItems: 6
    }),
    sourceLabel: SourceLabelSchema
  },
  { additionalProperties: false }
)

export const CatalogProductCompareResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    sourceMode: SearchSourceModeSchema,
    state: CatalogProductCompareStateSchema,
    evidence: CatalogProductCompareEvidenceSummarySchema,
    assessments: Type.Array(CatalogProductCompareAssessmentSchema, {
      maxItems: 8
    }),
    findings: Type.Array(PlainStatusMessageSchema, {
      minItems: 1,
      maxItems: 12
    }),
    actionPolicy: AgentActionPolicySchema,
    comparedAt: IsoDateTimeSchema
  },
  { additionalProperties: false }
)

export const CatalogSourceStateSchema = Type.Union([
  Type.Literal('ready'),
  Type.Literal('limited'),
  Type.Literal('unavailable')
])

export const CatalogSourceStateFreshnessSchema = Type.Object(
  {
    lastObservedAt: Type.Optional(IsoDateTimeSchema),
    nextReviewAt: Type.Optional(IsoDateTimeSchema),
    hasCurrentConformanceEvidence: Type.Boolean()
  },
  { additionalProperties: false }
)

export const CatalogSourceStateCapabilitySummarySchema = Type.Object(
  {
    capability: Type.String({ minLength: 1 }),
    status: TargetBusinessCapabilityStatusSchema
  },
  { additionalProperties: false }
)

export const CatalogSourceStateSummarySchema = Type.Object(
  {
    businessId: Type.String({ minLength: 1 }),
    businessName: Type.String({ minLength: 1 }),
    domain: Type.String({ minLength: 1 }),
    sourceType: TargetBusinessSourceTypeSchema,
    sourceMode: SearchSourceModeSchema,
    state: CatalogSourceStateSchema,
    launchStatus: Type.Optional(TargetBusinessLaunchStatusSchema),
    featureVisibility: Type.Optional(TargetBusinessFeatureVisibilitySchema),
    accessPolicyState: Type.Optional(UcpAccessPolicyStateSchema),
    profileUrl: Type.Optional(Type.String({ minLength: 1 })),
    profileHash: Type.Optional(Type.String({ minLength: 1 })),
    capabilities: Type.Array(CatalogSourceStateCapabilitySummarySchema, {
      maxItems: 24
    }),
    freshness: CatalogSourceStateFreshnessSchema,
    messages: Type.Array(PlainStatusMessageSchema, {
      minItems: 1,
      maxItems: 8
    })
  },
  { additionalProperties: false }
)

export const CatalogSourceStateResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    sourceMode: SearchSourceModeSchema,
    state: CatalogSourceStateSchema,
    sources: Type.Array(CatalogSourceStateSummarySchema, {
      maxItems: 20
    }),
    messages: Type.Array(PlainStatusMessageSchema, {
      minItems: 1,
      maxItems: 12
    }),
    actionPolicy: AgentActionPolicySchema,
    fetchedAt: IsoDateTimeSchema
  },
  { additionalProperties: false }
)

export type CatalogSearchRequest = Static<typeof CatalogSearchRequestSchema>
export type CatalogSearchResponse = Static<typeof CatalogSearchResponseSchema>
export type CatalogProductSummary = Static<typeof CatalogProductSummarySchema>
export type CatalogProductDetailRequest = Static<typeof CatalogProductDetailRequestSchema>
export type CatalogProductDetailResponse = Static<typeof CatalogProductDetailResponseSchema>
export type CatalogProductDetail = Static<typeof CatalogProductDetailSchema>
export type CatalogProductMedia = Static<typeof CatalogProductMediaSchema>
export type CatalogProductSelection = Static<typeof CatalogProductSelectionSchema>
export type CatalogProductOptionValue = Static<typeof CatalogProductOptionValueSchema>
export type CatalogProductOption = Static<typeof CatalogProductOptionSchema>
export type CatalogProductSelectedOption = Static<typeof CatalogProductSelectedOptionSchema>
export type CatalogProductVariant = Static<typeof CatalogProductVariantSchema>
export type CatalogCartPrepareRequest = Static<typeof CatalogCartPrepareRequestSchema>
export type CatalogCartPrepareAction = Static<typeof CatalogCartPrepareActionSchema>
export type CatalogCartPreparation = Static<typeof CatalogCartPreparationSchema>
export type CatalogCartPreparationIssueRequest = Static<typeof CatalogCartPreparationIssueRequestSchema>
export type CatalogCartPreparationIssueResponse = Static<typeof CatalogCartPreparationIssueResponseSchema>
export type CatalogCartPrepareResponse = Static<typeof CatalogCartPrepareResponseSchema>
export type CatalogProductSanityCheckIdentifier = Static<typeof CatalogProductSanityCheckIdentifierSchema>
export type CatalogProductSanityCheckRequest = Static<typeof CatalogProductSanityCheckRequestSchema>
export type CatalogProductSanityCheckState = Static<typeof CatalogProductSanityCheckStateSchema>
export type CatalogProductSanityCheckEvidenceSummary = Static<typeof CatalogProductSanityCheckEvidenceSummarySchema>
export type CatalogProductSanityCheckCandidateAssessment = Static<typeof CatalogProductSanityCheckCandidateAssessmentSchema>
export type CatalogProductSanityCheckResponse = Static<typeof CatalogProductSanityCheckResponseSchema>
export type CatalogProductCompareCriterion = Static<typeof CatalogProductCompareCriterionSchema>
export type CatalogProductCompareRequest = Static<typeof CatalogProductCompareRequestSchema>
export type CatalogProductCompareState = Static<typeof CatalogProductCompareStateSchema>
export type CatalogProductCompareEvidenceSummary = Static<typeof CatalogProductCompareEvidenceSummarySchema>
export type CatalogProductCompareAssessment = Static<typeof CatalogProductCompareAssessmentSchema>
export type CatalogProductCompareResponse = Static<typeof CatalogProductCompareResponseSchema>
export type CatalogSourceStateRequest = Static<typeof CatalogSourceStateRequestSchema>
export type CatalogSourceState = Static<typeof CatalogSourceStateSchema>
export type CatalogSourceStateFreshness = Static<typeof CatalogSourceStateFreshnessSchema>
export type CatalogSourceStateCapabilitySummary = Static<typeof CatalogSourceStateCapabilitySummarySchema>
export type CatalogSourceStateSummary = Static<typeof CatalogSourceStateSummarySchema>
export type CatalogSourceStateResponse = Static<typeof CatalogSourceStateResponseSchema>
export type CatalogPreparedCart = Static<typeof CatalogPreparedCartSchema>
export type CatalogCartLineItem = Static<typeof CatalogCartLineItemSchema>
export type CatalogProductSearchInput = Static<typeof CatalogProductSearchInputSchema>
export type InterpretedSearchQuery = Static<typeof InterpretedSearchQuerySchema>
export type SearchSourceMode = Static<typeof SearchSourceModeSchema>
export type CommercialIsolationManifest = Static<typeof CommercialIsolationManifestSchema>
export type CatalogSellerIdentity = Static<typeof CatalogSellerIdentitySchema>
export type CatalogHandoff = Static<typeof CatalogHandoffSchema>

const catalogProductSearchInputValidator = TypeCompiler.Compile(CatalogProductSearchInputSchema)
const catalogProductDetailValidator = TypeCompiler.Compile(CatalogProductDetailSchema)
const catalogPreparedCartValidator = TypeCompiler.Compile(CatalogPreparedCartSchema)

export const isCatalogProductSearchInput = (value: unknown): value is CatalogProductSearchInput =>
  catalogProductSearchInputValidator.Check(value)

export const isCatalogProductDetail = (value: unknown): value is CatalogProductDetail =>
  catalogProductDetailValidator.Check(value)

export const isCatalogPreparedCart = (value: unknown): value is CatalogPreparedCart =>
  catalogPreparedCartValidator.Check(value)

export const catalogProductSearchInputErrorSummary = (value: unknown) =>
  validationErrorSummary(catalogProductSearchInputValidator, value)

export const catalogProductDetailErrorSummary = (value: unknown) =>
  validationErrorSummary(catalogProductDetailValidator, value)

export const catalogPreparedCartErrorSummary = (value: unknown) =>
  validationErrorSummary(catalogPreparedCartValidator, value)
