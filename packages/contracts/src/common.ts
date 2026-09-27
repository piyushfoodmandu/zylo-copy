import { Type, type Static } from '@sinclair/typebox'

export const IsoDateTimeSchema = Type.String({
  description: 'ISO 8601 timestamp'
})

export const FreshnessClassSchema = Type.Union([
  Type.Literal('advisory_catalog'),
  Type.Literal('profile_and_artifact'),
  Type.Literal('binding_commerce'),
  Type.Literal('watch_snapshot'),
  Type.Literal('user_specific_context')
])

export const BindingStatusSchema = Type.Union([
  Type.Literal('advisory'),
  Type.Literal('binding'),
  Type.Literal('missing'),
  Type.Literal('stale'),
  Type.Literal('requires_handoff')
])

export const SourceLabelSchema = Type.Object(
  {
    sourceId: Type.String({ minLength: 1 }),
    sourceName: Type.String({ minLength: 1 }),
    factType: Type.String({ minLength: 1 }),
    fetchedAt: IsoDateTimeSchema,
    expiresAt: Type.Optional(IsoDateTimeSchema),
    freshnessClass: FreshnessClassSchema,
    bindingStatus: BindingStatusSchema
  },
  { additionalProperties: false }
)

export const PlainStatusMessageSchema = Type.Object(
  {
    severity: Type.Union([
      Type.Literal('info'),
      Type.Literal('warning'),
      Type.Literal('error')
    ]),
    code: Type.String({ minLength: 1 }),
    text: Type.String({ minLength: 1 }),
    nextAction: Type.Optional(Type.String({ minLength: 1 }))
  },
  { additionalProperties: false }
)

export const ApiErrorSchema = Type.Object(
  {
    error: Type.Object(
      {
        code: Type.String({ minLength: 1 }),
        message: Type.String({ minLength: 1 }),
        requestId: Type.Optional(Type.String({ minLength: 1 }))
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
)

type ValidationErrorSummarySource = {
  Errors: (value: unknown) => Iterable<{ path: string; message: string }>
}

export const validationErrorSummary = (
  validator: ValidationErrorSummarySource,
  value: unknown,
  limit = 5
) =>
  validationErrorMessages(validator, value, limit).join('; ')

export const validationErrorMessages = (
  validator: ValidationErrorSummarySource,
  value: unknown,
  limit = 5
) =>
  [...validator.Errors(value)]
    .slice(0, limit)
    .map((error) => `${error.path || '/'} ${error.message}`)

export type SourceLabel = Static<typeof SourceLabelSchema>
export type PlainStatusMessage = Static<typeof PlainStatusMessageSchema>
export type ApiError = Static<typeof ApiErrorSchema>
