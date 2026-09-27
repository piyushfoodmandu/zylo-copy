import { Type, type Static } from '@sinclair/typebox'
import { IsoDateTimeSchema } from './common.ts'

export const HealthStatusSchema = Type.Union([
  Type.Literal('ok'),
  Type.Literal('degraded'),
  Type.Literal('fail')
])

export const HealthCheckStatusSchema = Type.Union([
  Type.Literal('ok'),
  Type.Literal('warn'),
  Type.Literal('fail'),
  Type.Literal('skipped')
])

export const ComponentHealthCheckSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    status: HealthCheckStatusSchema,
    required: Type.Boolean(),
    message: Type.String({ minLength: 1 })
  },
  { additionalProperties: false }
)

export const HealthResponseSchema = Type.Object(
  {
    service: Type.Literal('arro-api'),
    status: HealthStatusSchema,
    version: Type.String({ minLength: 1 }),
    runtime: Type.String({ minLength: 1 }),
    requestId: Type.String({ minLength: 1 }),
    correlationId: Type.String({ minLength: 1 }),
    timestamp: IsoDateTimeSchema,
    checks: Type.Array(ComponentHealthCheckSchema)
  },
  { additionalProperties: false }
)

export type HealthResponse = Static<typeof HealthResponseSchema>
export type ComponentHealthCheck = Static<typeof ComponentHealthCheckSchema>
