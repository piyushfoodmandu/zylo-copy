import { Type, type Static, type TSchema } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  BindingStatusSchema,
  IsoDateTimeSchema,
  SourceLabelSchema,
  validationErrorMessages,
  validationErrorSummary
} from './common.ts'
import {
  AgentExternalSubjectRefSchema,
  AgentExternalTaskRefSchema,
  AgentIntegrationIdSchema
} from './agent.ts'
import { commercialIsolationManifest, MoneySchema } from './catalog.ts'

const CommerceMemoryRefSchema = Type.String({
  minLength: 1,
  maxLength: 160
})

const CommerceMemoryShortTextSchema = Type.String({
  minLength: 1,
  maxLength: 120
})

const CommerceMemoryPlainReasonSchema = Type.String({
  minLength: 1,
  maxLength: 280
})

const CommerceMemoryUrlSchema = Type.String({
  minLength: 1,
  maxLength: 2048
})

export const CommerceMemoryRecordKindSchema = Type.Union([
  Type.Literal('region'),
  Type.Literal('currency'),
  Type.Literal('size'),
  Type.Literal('budget'),
  Type.Literal('fulfillment_preference'),
  Type.Literal('accepted_alternative'),
  Type.Literal('rejected_alternative'),
  Type.Literal('saved_product_reference'),
  Type.Literal('comparison_reference'),
  Type.Literal('cart_handoff_reference'),
  Type.Literal('checkout_completion_reference'),
  Type.Literal('decision_receipt_reference'),
  Type.Literal('source_state_reference'),
  Type.Literal('no_buy_warning'),
  Type.Literal('stale_reference')
])

export const CommerceMemoryRetentionClassSchema = Type.Union([
  Type.Literal('session_only'),
  Type.Literal('user_controlled'),
  Type.Literal('time_limited'),
  Type.Literal('receipt_bound')
])

export const CommerceMemoryPromptExposureClassSchema = Type.Union([
  Type.Literal('never_prompt'),
  Type.Literal('summary_only'),
  Type.Literal('retrieval_allowed')
])

export const CommerceMemoryProposalProvenanceKindSchema = Type.Union([
  Type.Literal('user_explicit'),
  Type.Literal('agent_proposed'),
  Type.Literal('receipt_derived'),
  Type.Literal('source_refresh'),
  Type.Literal('typed_migration')
])

export const CommerceMemoryConsentBasisSchema = Type.Union([
  Type.Literal('explicit_user_request'),
  Type.Literal('session_policy'),
  Type.Literal('arro_account_setting'),
  Type.Literal('typed_migration_authorization')
])

export const CommerceMemoryMigrationSourceKindSchema = Type.Union([
  Type.Literal('host_memory'),
  Type.Literal('external_memory_provider'),
  Type.Literal('vector_store'),
  Type.Literal('user_modeling_system'),
  Type.Literal('agent_session_log')
])

export const CommerceMemoryScopeSchema = Type.Object(
  {
    integrationId: AgentIntegrationIdSchema,
    externalSubjectRef: AgentExternalSubjectRefSchema,
    externalTaskRef: Type.Optional(AgentExternalTaskRefSchema),
    arroUserId: Type.Optional(CommerceMemoryRefSchema),
    decisionReceiptId: Type.Optional(CommerceMemoryRefSchema),
    sourceLabel: Type.Optional(SourceLabelSchema)
  },
  { additionalProperties: false }
)

export const CommerceMemoryConsentSchema = Type.Object(
  {
    userAuthorized: Type.Boolean(),
    basis: CommerceMemoryConsentBasisSchema,
    grantedAt: IsoDateTimeSchema
  },
  { additionalProperties: false }
)

export const CommerceMemoryProposalProvenanceSchema = Type.Object(
  {
    kind: CommerceMemoryProposalProvenanceKindSchema,
    evidenceRef: Type.Optional(CommerceMemoryRefSchema),
    adapterId: Type.Optional(CommerceMemoryRefSchema),
    sourceRecordRef: Type.Optional(CommerceMemoryRefSchema)
  },
  { additionalProperties: false }
)

export const CommerceMemoryMigrationAdapterSchema = Type.Object(
  {
    adapterId: CommerceMemoryRefSchema,
    sourceKind: CommerceMemoryMigrationSourceKindSchema,
    sourceSystem: CommerceMemoryShortTextSchema,
    sourceRecordRef: CommerceMemoryRefSchema
  },
  { additionalProperties: false }
)

export const CommerceMemoryProductReferenceSchema = Type.Object(
  {
    businessId: CommerceMemoryRefSchema,
    businessName: Type.Optional(CommerceMemoryShortTextSchema),
    productId: CommerceMemoryRefSchema,
    variantId: Type.Optional(CommerceMemoryRefSchema),
    title: Type.Optional(CommerceMemoryShortTextSchema),
    sourceLabel: SourceLabelSchema
  },
  { additionalProperties: false }
)

export const CommerceMemoryRegionValueSchema = Type.Object(
  {
    region: Type.String({ minLength: 2, maxLength: 3 })
  },
  { additionalProperties: false }
)

export const CommerceMemoryCurrencyValueSchema = Type.Object(
  {
    currency: Type.String({ minLength: 3, maxLength: 3 })
  },
  { additionalProperties: false }
)

export const CommerceMemorySizeValueSchema = Type.Object(
  {
    label: CommerceMemoryShortTextSchema,
    system: Type.Optional(CommerceMemoryShortTextSchema),
    category: Type.Optional(CommerceMemoryShortTextSchema)
  },
  { additionalProperties: false }
)

export const CommerceMemoryBudgetValueSchema = Type.Object(
  {
    budget: MoneySchema,
    appliesTo: Type.Optional(CommerceMemoryShortTextSchema)
  },
  { additionalProperties: false }
)

export const CommerceMemoryFulfillmentPreferenceValueSchema = Type.Object(
  {
    mode: Type.Union([
      Type.Literal('ship_to_address'),
      Type.Literal('pickup'),
      Type.Literal('digital'),
      Type.Literal('fastest'),
      Type.Literal('lowest_cost'),
      Type.Literal('no_preference')
    ]),
    region: Type.Optional(Type.String({ minLength: 2, maxLength: 3 }))
  },
  { additionalProperties: false }
)

export const CommerceMemoryProductDecisionValueSchema = Type.Object(
  {
    product: CommerceMemoryProductReferenceSchema,
    reasonCode: CommerceMemoryRefSchema,
    plainReason: Type.Optional(CommerceMemoryPlainReasonSchema),
    decisionReceiptId: Type.Optional(CommerceMemoryRefSchema)
  },
  { additionalProperties: false }
)

export const CommerceMemoryComparisonReferenceValueSchema = Type.Object(
  {
    comparisonId: Type.Optional(CommerceMemoryRefSchema),
    products: Type.Array(CommerceMemoryProductReferenceSchema, {
      minItems: 2,
      maxItems: 12
    }),
    decisionReceiptId: Type.Optional(CommerceMemoryRefSchema)
  },
  { additionalProperties: false }
)

export const CommerceMemoryCartHandoffReferenceValueSchema = Type.Object(
  {
    businessId: CommerceMemoryRefSchema,
    cartId: CommerceMemoryRefSchema,
    handoffUrl: CommerceMemoryUrlSchema,
    sourceLabel: SourceLabelSchema,
    expiresAt: Type.Optional(IsoDateTimeSchema)
  },
  { additionalProperties: false }
)

export const CommerceMemoryCheckoutCompletionReferenceValueSchema = Type.Object(
  {
    businessId: CommerceMemoryRefSchema,
    completionRef: CommerceMemoryRefSchema,
    decisionReceiptId: CommerceMemoryRefSchema,
    completedAt: IsoDateTimeSchema,
    sourceLabel: SourceLabelSchema
  },
  { additionalProperties: false }
)

export const CommerceMemoryDecisionReceiptReferenceValueSchema = Type.Object(
  {
    decisionReceiptId: CommerceMemoryRefSchema,
    allowedNextAction: Type.Optional(CommerceMemoryShortTextSchema)
  },
  { additionalProperties: false }
)

export const CommerceMemorySourceStateReferenceValueSchema = Type.Object(
  {
    sourceId: CommerceMemoryRefSchema,
    sourceName: CommerceMemoryShortTextSchema,
    bindingStatus: BindingStatusSchema,
    sourceLabel: SourceLabelSchema
  },
  { additionalProperties: false }
)

export const CommerceMemoryNoBuyWarningValueSchema = Type.Object(
  {
    warningCode: CommerceMemoryRefSchema,
    plainReason: CommerceMemoryPlainReasonSchema,
    decisionReceiptId: CommerceMemoryRefSchema,
    sourceLabel: Type.Optional(SourceLabelSchema)
  },
  { additionalProperties: false }
)

export const CommerceMemoryStaleReferenceValueSchema = Type.Object(
  {
    referenceType: Type.Union([
      Type.Literal('saved_product_reference'),
      Type.Literal('comparison_reference'),
      Type.Literal('cart_handoff_reference'),
      Type.Literal('checkout_completion_reference'),
      Type.Literal('decision_receipt_reference'),
      Type.Literal('source_state_reference')
    ]),
    referenceId: CommerceMemoryRefSchema,
    markedStaleAt: IsoDateTimeSchema,
    refreshReasonCode: CommerceMemoryRefSchema,
    sourceLabel: Type.Optional(SourceLabelSchema)
  },
  { additionalProperties: false }
)

const CommerceMemoryProposalBaseFields = {
  proposalId: CommerceMemoryRefSchema,
  scope: CommerceMemoryScopeSchema,
  provenance: CommerceMemoryProposalProvenanceSchema,
  consent: CommerceMemoryConsentSchema,
  retentionClass: CommerceMemoryRetentionClassSchema,
  promptExposureClass: CommerceMemoryPromptExposureClassSchema,
  mutationReason: CommerceMemoryPlainReasonSchema,
  proposedAt: IsoDateTimeSchema,
  expiresAt: Type.Optional(IsoDateTimeSchema)
}

const commerceMemoryProposalVariant = <TKind extends string, TValue extends TSchema>(
  recordKind: TKind,
  value: TValue
) =>
  Type.Object(
    {
      ...CommerceMemoryProposalBaseFields,
      recordKind: Type.Literal(recordKind),
      value
    },
    { additionalProperties: false }
  )

export const CommerceMemoryProposalSchema = Type.Union([
  commerceMemoryProposalVariant('region', CommerceMemoryRegionValueSchema),
  commerceMemoryProposalVariant('currency', CommerceMemoryCurrencyValueSchema),
  commerceMemoryProposalVariant('size', CommerceMemorySizeValueSchema),
  commerceMemoryProposalVariant('budget', CommerceMemoryBudgetValueSchema),
  commerceMemoryProposalVariant(
    'fulfillment_preference',
    CommerceMemoryFulfillmentPreferenceValueSchema
  ),
  commerceMemoryProposalVariant(
    'accepted_alternative',
    CommerceMemoryProductDecisionValueSchema
  ),
  commerceMemoryProposalVariant(
    'rejected_alternative',
    CommerceMemoryProductDecisionValueSchema
  ),
  commerceMemoryProposalVariant(
    'saved_product_reference',
    CommerceMemoryProductDecisionValueSchema
  ),
  commerceMemoryProposalVariant(
    'comparison_reference',
    CommerceMemoryComparisonReferenceValueSchema
  ),
  commerceMemoryProposalVariant(
    'cart_handoff_reference',
    CommerceMemoryCartHandoffReferenceValueSchema
  ),
  commerceMemoryProposalVariant(
    'checkout_completion_reference',
    CommerceMemoryCheckoutCompletionReferenceValueSchema
  ),
  commerceMemoryProposalVariant(
    'decision_receipt_reference',
    CommerceMemoryDecisionReceiptReferenceValueSchema
  ),
  commerceMemoryProposalVariant(
    'source_state_reference',
    CommerceMemorySourceStateReferenceValueSchema
  ),
  commerceMemoryProposalVariant('no_buy_warning', CommerceMemoryNoBuyWarningValueSchema),
  commerceMemoryProposalVariant('stale_reference', CommerceMemoryStaleReferenceValueSchema)
])

export const CommerceMemoryMigrationImportSchema = Type.Object(
  {
    importId: CommerceMemoryRefSchema,
    adapter: CommerceMemoryMigrationAdapterSchema,
    importedAt: IsoDateTimeSchema,
    proposal: CommerceMemoryProposalSchema
  },
  { additionalProperties: false }
)

export const SensitiveCommerceMemoryFieldNames = [
  'accessToken',
  'apiKey',
  'audio',
  'audioTranscript',
  'arbitraryText',
  'bankAccount',
  'cardNumber',
  'connectorCredential',
  'connectorCredentials',
  'conversation',
  'cvc',
  'cvv',
  'dom',
  'hostMemory',
  'hostMemoryImport',
  'html',
  'messages',
  'pageContent',
  'password',
  'paymentCredential',
  'paymentCredentials',
  'paymentMethodId',
  'prompt',
  'rawBlob',
  'rawAudio',
  'rawCompletion',
  'rawMessages',
  'rawPrompt',
  'rawText',
  'rawTranscript',
  'refreshToken',
  'secret',
  'settlementState',
  'thirdPartyMemory',
  'transcript',
  'unsupportedPageContent',
  'wallet'
] as const

export const ForbiddenCommerceMemoryFieldNames = [
  ...SensitiveCommerceMemoryFieldNames,
  ...commercialIsolationManifest.excludedCommercialFields
] as const

export type CommerceMemoryRecordKind = Static<typeof CommerceMemoryRecordKindSchema>
export type CommerceMemoryRetentionClass = Static<typeof CommerceMemoryRetentionClassSchema>
export type CommerceMemoryPromptExposureClass = Static<typeof CommerceMemoryPromptExposureClassSchema>
export type CommerceMemoryProposalProvenanceKind = Static<
  typeof CommerceMemoryProposalProvenanceKindSchema
>
export type CommerceMemoryConsentBasis = Static<typeof CommerceMemoryConsentBasisSchema>
export type CommerceMemoryScope = Static<typeof CommerceMemoryScopeSchema>
export type CommerceMemoryConsent = Static<typeof CommerceMemoryConsentSchema>
export type CommerceMemoryProposalProvenance = Static<
  typeof CommerceMemoryProposalProvenanceSchema
>
export type CommerceMemoryMigrationSourceKind = Static<
  typeof CommerceMemoryMigrationSourceKindSchema
>
export type CommerceMemoryMigrationAdapter = Static<typeof CommerceMemoryMigrationAdapterSchema>
export type CommerceMemoryProductReference = Static<typeof CommerceMemoryProductReferenceSchema>
export type CommerceMemoryProposal = Static<typeof CommerceMemoryProposalSchema>
export type CommerceMemoryMigrationImport = Static<typeof CommerceMemoryMigrationImportSchema>
export type SensitiveCommerceMemoryFieldName = (typeof SensitiveCommerceMemoryFieldNames)[number]
export type ForbiddenCommerceMemoryFieldName = (typeof ForbiddenCommerceMemoryFieldNames)[number]

export type CommerceMemoryProposalValidationIssueCode =
  | 'schema_invalid'
  | 'forbidden_field'
  | 'consent_required'
  | 'time_limited_expiry_required'
  | 'typed_migration_authorization_required'
  | 'typed_migration_adapter_required'

export type CommerceMemoryProposalValidationIssue = {
  code: CommerceMemoryProposalValidationIssueCode
  message: string
  path?: string
}

export type CommerceMemoryProposalValidationResult =
  | {
      accepted: true
      proposal: CommerceMemoryProposal
      issues: []
    }
  | {
      accepted: false
      issues: CommerceMemoryProposalValidationIssue[]
    }

export type CommerceMemoryMigrationImportValidationIssueCode =
  | 'schema_invalid'
  | 'forbidden_field'
  | 'proposal_invalid'
  | 'typed_migration_required'
  | 'migration_adapter_mismatch'
  | 'migration_source_record_mismatch'
  | 'typed_migration_authorization_required'

export type CommerceMemoryMigrationImportValidationIssue = {
  code: CommerceMemoryMigrationImportValidationIssueCode
  message: string
  path?: string
}

export type CommerceMemoryMigrationImportValidationResult =
  | {
      accepted: true
      migrationImport: CommerceMemoryMigrationImport
      proposal: CommerceMemoryProposal
      issues: []
    }
  | {
      accepted: false
      issues: CommerceMemoryMigrationImportValidationIssue[]
    }

const commerceMemoryProposalValidator = TypeCompiler.Compile(CommerceMemoryProposalSchema)
const commerceMemoryMigrationImportValidator = TypeCompiler.Compile(
  CommerceMemoryMigrationImportSchema
)
const forbiddenCommerceMemoryFieldNameSet = new Set(
  ForbiddenCommerceMemoryFieldNames.map((fieldName) => fieldName.toLowerCase())
)

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const joinPath = (path: string, key: string) =>
  path === '/' ? `/${key}` : `${path}/${key}`

export const forbiddenCommerceMemoryFieldPaths = (
  value: unknown,
  path = '/'
): string[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      forbiddenCommerceMemoryFieldPaths(item, joinPath(path, String(index)))
    )
  }

  if (!isJsonObject(value)) {
    return []
  }

  return Object.entries(value).flatMap(([key, item]) => {
    const itemPath = joinPath(path, key)
    const matches = forbiddenCommerceMemoryFieldNameSet.has(key.toLowerCase())
      ? [itemPath]
      : []

    return [
      ...matches,
      ...forbiddenCommerceMemoryFieldPaths(item, itemPath)
    ]
  })
}

export const isCommerceMemoryProposal = (value: unknown): value is CommerceMemoryProposal =>
  commerceMemoryProposalValidator.Check(value)

export const commerceMemoryProposalErrorSummary = (value: unknown) =>
  validationErrorSummary(commerceMemoryProposalValidator, value)

export const commerceMemoryMigrationImportErrorSummary = (value: unknown) =>
  validationErrorSummary(commerceMemoryMigrationImportValidator, value)

export const validateCommerceMemoryProposal = (
  value: unknown
): CommerceMemoryProposalValidationResult => {
  const issues: CommerceMemoryProposalValidationIssue[] = []

  for (const path of forbiddenCommerceMemoryFieldPaths(value)) {
    issues.push({
      code: 'forbidden_field',
      path,
      message: `Commerce memory proposals cannot include forbidden field ${path}`
    })
  }

  const schemaErrors = validationErrorMessages(commerceMemoryProposalValidator, value)
  if (schemaErrors.length > 0) {
    issues.push({
      code: 'schema_invalid',
      message: schemaErrors.join('; ')
    })
  }

  if (!commerceMemoryProposalValidator.Check(value)) {
    return {
      accepted: false,
      issues
    }
  }

  const proposal = value

  if (!proposal.consent.userAuthorized) {
    issues.push({
      code: 'consent_required',
      path: '/consent/userAuthorized',
      message: 'Commerce memory proposals require explicit user authorization before commit'
    })
  }

  if (proposal.retentionClass === 'time_limited' && !proposal.expiresAt) {
    issues.push({
      code: 'time_limited_expiry_required',
      path: '/expiresAt',
      message: 'Time-limited commerce memory proposals require expiresAt'
    })
  }

  if (proposal.provenance.kind === 'typed_migration') {
    if (proposal.consent.basis !== 'typed_migration_authorization') {
      issues.push({
        code: 'typed_migration_authorization_required',
        path: '/consent/basis',
        message: 'Typed memory migrations require typed_migration_authorization consent'
      })
    }

    if (!proposal.provenance.adapterId || !proposal.provenance.sourceRecordRef) {
      issues.push({
        code: 'typed_migration_adapter_required',
        path: '/provenance',
        message: 'Typed memory migrations require adapterId and sourceRecordRef provenance'
      })
    }
  }

  if (issues.length > 0) {
    return {
      accepted: false,
      issues
    }
  }

  return {
    accepted: true,
    proposal,
    issues: []
  }
}

export const validateCommerceMemoryMigrationImport = (
  value: unknown
): CommerceMemoryMigrationImportValidationResult => {
  const issues: CommerceMemoryMigrationImportValidationIssue[] = []

  for (const path of forbiddenCommerceMemoryFieldPaths(value)) {
    issues.push({
      code: 'forbidden_field',
      path,
      message: `Commerce memory migration imports cannot include forbidden field ${path}`
    })
  }

  const schemaErrors = validationErrorMessages(
    commerceMemoryMigrationImportValidator,
    value
  )
  if (schemaErrors.length > 0) {
    issues.push({
      code: 'schema_invalid',
      message: schemaErrors.join('; ')
    })
  }

  if (!commerceMemoryMigrationImportValidator.Check(value)) {
    return {
      accepted: false,
      issues
    }
  }

  const migrationImport = value
  const proposalValidation = validateCommerceMemoryProposal(migrationImport.proposal)
  if (!proposalValidation.accepted) {
    issues.push(
      ...proposalValidation.issues.map((proposalIssue) => ({
        code: 'proposal_invalid' as const,
        path: proposalIssue.path
          ? `/proposal${proposalIssue.path}`
          : '/proposal',
        message: proposalIssue.message
      }))
    )
  }

  if (migrationImport.proposal.provenance.kind !== 'typed_migration') {
    issues.push({
      code: 'typed_migration_required',
      path: '/proposal/provenance/kind',
      message: 'External memory imports must create typed_migration proposals only'
    })
  }

  if (migrationImport.proposal.provenance.adapterId !== migrationImport.adapter.adapterId) {
    issues.push({
      code: 'migration_adapter_mismatch',
      path: '/adapter/adapterId',
      message: 'Migration adapter ID must match proposal provenance adapterId'
    })
  }

  if (
    migrationImport.proposal.provenance.sourceRecordRef !==
    migrationImport.adapter.sourceRecordRef
  ) {
    issues.push({
      code: 'migration_source_record_mismatch',
      path: '/adapter/sourceRecordRef',
      message: 'Migration source record reference must match proposal provenance sourceRecordRef'
    })
  }

  if (
    !migrationImport.proposal.consent.userAuthorized ||
    migrationImport.proposal.consent.basis !== 'typed_migration_authorization'
  ) {
    issues.push({
      code: 'typed_migration_authorization_required',
      path: '/proposal/consent',
      message: 'External memory imports require explicit typed migration authorization'
    })
  }

  if (issues.length > 0) {
    return {
      accepted: false,
      issues
    }
  }

  return {
    accepted: true,
    migrationImport,
    proposal: migrationImport.proposal,
    issues: []
  }
}
