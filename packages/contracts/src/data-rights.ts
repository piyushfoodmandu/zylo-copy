import { Type, type Static } from '@sinclair/typebox'
import {
  IsoDateTimeSchema,
  PlainStatusMessageSchema
} from './common.ts'

const DataRightsIntegrationIdSchema = Type.String({
  minLength: 1,
  maxLength: 160
})

const DataRightsExternalSubjectRefSchema = Type.String({
  minLength: 1,
  maxLength: 512
})

const DataRightsRecordIdSchema = Type.String({
  minLength: 1,
  maxLength: 180
})

const DataRightsFieldPathSchema = Type.String({
  minLength: 1,
  maxLength: 160
})

const DataRightsCorrectionStatementSchema = Type.String({
  minLength: 1,
  maxLength: 1200
})

export const DataRightsExportRecordKindSchema = Type.Union([
  Type.Literal('ucp_checkout_sessions'),
  Type.Literal('ucp_payment_results'),
  Type.Literal('ucp_orders'),
  Type.Literal('data_rights_events')
])

export const DataRightsDeletionRecordKindSchema = Type.Union([
  Type.Literal('ucp_checkout_sessions'),
  Type.Literal('ucp_payment_results'),
  Type.Literal('ucp_orders')
])

export const DataRightsCorrectionTargetKindSchema = Type.Union([
  Type.Literal('subject_scope'),
  Type.Literal('purchase'),
  Type.Literal('order')
])

export const DataRightsScopeRequestSchema = Type.Object(
  {
    integrationId: DataRightsIntegrationIdSchema,
    externalSubjectRef: DataRightsExternalSubjectRefSchema
  },
  { additionalProperties: false }
)

export const DataRightsExportRequestSchema = Type.Object(
  {
    integrationId: DataRightsIntegrationIdSchema,
    externalSubjectRef: DataRightsExternalSubjectRefSchema,
    include: Type.Optional(Type.Array(DataRightsExportRecordKindSchema, {
      maxItems: 6,
      uniqueItems: true
    }))
  },
  { additionalProperties: false }
)

export const DataRightsCorrectionTargetSchema = Type.Object(
  {
    kind: DataRightsCorrectionTargetKindSchema,
    recordId: Type.Optional(DataRightsRecordIdSchema)
  },
  { additionalProperties: false }
)

export const DataRightsCorrectionRequestSchema = Type.Object(
  {
    integrationId: DataRightsIntegrationIdSchema,
    externalSubjectRef: DataRightsExternalSubjectRefSchema,
    target: DataRightsCorrectionTargetSchema,
    correction: Type.Object(
      {
        field: DataRightsFieldPathSchema,
        statement: DataRightsCorrectionStatementSchema
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
)

export const DataRightsDeletionRequestSchema = Type.Object(
  {
    integrationId: DataRightsIntegrationIdSchema,
    externalSubjectRef: DataRightsExternalSubjectRefSchema,
    recordKinds: Type.Optional(Type.Array(DataRightsDeletionRecordKindSchema, {
      maxItems: 5,
      uniqueItems: true
    })),
    reason: Type.Optional(Type.Union([
      Type.Literal('user_request'),
      Type.Literal('account_closure'),
      Type.Literal('session_scope_cleanup')
    ]))
  },
  { additionalProperties: false }
)

export const DataRightsUcpCheckoutSessionExportSchema = Type.Object(
  {
    purchaseId: DataRightsRecordIdSchema,
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    merchantOrigin: Type.String({ minLength: 1, maxLength: 2048 }),
    checkoutId: DataRightsRecordIdSchema,
    cartId: Type.Optional(DataRightsRecordIdSchema),
    state: Type.String({ minLength: 1, maxLength: 80 }),
    hasCartSnapshot: Type.Boolean(),
    hasCheckoutSnapshot: Type.Boolean(),
    hasPaymentResult: Type.Boolean(),
    hasOrder: Type.Boolean()
  },
  { additionalProperties: false }
)

export const DataRightsUcpPaymentResultExportSchema = Type.Object(
  {
    paymentResultId: DataRightsRecordIdSchema,
    purchaseId: DataRightsRecordIdSchema,
    provider: Type.String({ minLength: 1, maxLength: 160 }),
    handlerId: Type.String({ minLength: 1, maxLength: 160 }),
    resultFingerprint: Type.String({ pattern: '^sha256:[0-9a-f]{64}$' }),
    instrumentId: Type.Optional(DataRightsRecordIdSchema),
    credentialRedacted: Type.Boolean(),
    createdAt: IsoDateTimeSchema
  },
  { additionalProperties: false }
)

export const DataRightsUcpOrderExportSchema = Type.Object(
  {
    orderId: DataRightsRecordIdSchema,
    purchaseId: DataRightsRecordIdSchema,
    checkoutId: DataRightsRecordIdSchema,
    merchantOrigin: Type.String({ minLength: 1, maxLength: 2048 }),
    orderPermalinkUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 2048 })),
    firstSeenAt: IsoDateTimeSchema,
    lastSeenAt: IsoDateTimeSchema
  },
  { additionalProperties: false }
)

export const DataRightsEventActionSchema = Type.Union([
  Type.Literal('access'),
  Type.Literal('export'),
  Type.Literal('correction'),
  Type.Literal('deletion')
])

export const DataRightsEventStatusSchema = Type.Union([
  Type.Literal('completed'),
  Type.Literal('rejected')
])

export const DataRightsEventSchema = Type.Object(
  {
    eventId: DataRightsRecordIdSchema,
    action: DataRightsEventActionSchema,
    status: DataRightsEventStatusSchema,
    target: DataRightsCorrectionTargetSchema,
    createdAt: IsoDateTimeSchema,
    correction: Type.Optional(Type.Object(
      {
        field: DataRightsFieldPathSchema,
        statement: DataRightsCorrectionStatementSchema
      },
      { additionalProperties: false }
    )),
    resultSummary: Type.Record(Type.String({ minLength: 1 }), Type.Unknown())
  },
  { additionalProperties: false }
)

export const DataRightsExportResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    state: Type.Union([
      Type.Literal('access_ready'),
      Type.Literal('export_ready')
    ]),
    scope: Type.Object(
      {
        integrationId: DataRightsIntegrationIdSchema,
        hasExternalSubjectRef: Type.Boolean()
      },
      { additionalProperties: false }
    ),
    records: Type.Object(
      {
        ucpCheckoutSessions: Type.Array(DataRightsUcpCheckoutSessionExportSchema),
        ucpPaymentResults: Type.Array(DataRightsUcpPaymentResultExportSchema),
        ucpOrders: Type.Array(DataRightsUcpOrderExportSchema),
        dataRightsEvents: Type.Array(DataRightsEventSchema)
      },
      { additionalProperties: false }
    ),
    summary: Type.Object(
      {
        generatedAt: IsoDateTimeSchema,
        ucpCheckoutSessionCount: Type.Integer({ minimum: 0 }),
        ucpPaymentResultCount: Type.Integer({ minimum: 0 }),
        ucpOrderCount: Type.Integer({ minimum: 0 }),
        dataRightsEventCount: Type.Integer({ minimum: 0 }),
        messages: Type.Array(PlainStatusMessageSchema, { maxItems: 8 })
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
)

export const DataRightsCorrectionResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    state: Type.Literal('correction_recorded'),
    event: DataRightsEventSchema
  },
  { additionalProperties: false }
)

export const DataRightsDeletionResponseSchema = Type.Object(
  {
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    state: Type.Literal('deletion_completed'),
    deleted: Type.Object(
      {
        ucpCheckoutSessionCount: Type.Integer({ minimum: 0 }),
        ucpPaymentResultCount: Type.Integer({ minimum: 0 }),
        ucpOrderCount: Type.Integer({ minimum: 0 })
      },
      { additionalProperties: false }
    ),
    retained: Type.Object(
      {
        dataRightsEventCount: Type.Integer({ minimum: 0 }),
        sourceGovernanceHistory: Type.Literal('not_in_scope'),
        requestAuditLog: Type.Literal('retained_by_policy')
      },
      { additionalProperties: false }
    ),
    event: DataRightsEventSchema
  },
  { additionalProperties: false }
)

export type DataRightsExportRecordKind = Static<typeof DataRightsExportRecordKindSchema>
export type DataRightsDeletionRecordKind = Static<typeof DataRightsDeletionRecordKindSchema>
export type DataRightsCorrectionTargetKind = Static<typeof DataRightsCorrectionTargetKindSchema>
export type DataRightsScopeRequest = Static<typeof DataRightsScopeRequestSchema>
export type DataRightsExportRequest = Static<typeof DataRightsExportRequestSchema>
export type DataRightsCorrectionRequest = Static<typeof DataRightsCorrectionRequestSchema>
export type DataRightsDeletionRequest = Static<typeof DataRightsDeletionRequestSchema>
export type DataRightsUcpCheckoutSessionExport = Static<typeof DataRightsUcpCheckoutSessionExportSchema>
export type DataRightsUcpPaymentResultExport = Static<typeof DataRightsUcpPaymentResultExportSchema>
export type DataRightsUcpOrderExport = Static<typeof DataRightsUcpOrderExportSchema>
export type DataRightsEvent = Static<typeof DataRightsEventSchema>
export type DataRightsEventAction = Static<typeof DataRightsEventActionSchema>
export type DataRightsEventStatus = Static<typeof DataRightsEventStatusSchema>
export type DataRightsExportResponse = Static<typeof DataRightsExportResponseSchema>
export type DataRightsCorrectionResponse = Static<typeof DataRightsCorrectionResponseSchema>
export type DataRightsDeletionResponse = Static<typeof DataRightsDeletionResponseSchema>
