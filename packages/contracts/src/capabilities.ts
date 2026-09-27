import { Type, type Static } from '@sinclair/typebox'
import {
  AgentActionScopeSchema,
  AgentSurfaceSchema,
  AgentTrustSignalCapabilitySchema
} from './agent.ts'
import { McpToolNameSchema } from './mcp.ts'

export const AgentCapabilityAvailabilitySchema = Type.Union([
  Type.Literal('ready'),
  Type.Literal('limited'),
  Type.Literal('gated'),
  Type.Literal('unavailable')
])

export const AgentCapabilityToolSchema = Type.Object(
  {
    name: McpToolNameSchema,
    description: Type.String({ minLength: 1, maxLength: 360 }),
    actionScope: AgentActionScopeSchema,
    availability: AgentCapabilityAvailabilitySchema,
    readOnly: Type.Boolean(),
    requiredTrustSignals: Type.Array(AgentTrustSignalCapabilitySchema, {
      minItems: 1,
      maxItems: 16,
      uniqueItems: true
    }),
    authorityLimit: Type.String({ minLength: 1, maxLength: 360 })
  },
  { additionalProperties: false }
)

export const AgentCapabilityManifestSchema = Type.Object(
  {
    manifestVersion: Type.Literal('arro-agent-capabilities/v0.1'),
    product: Type.Literal('Arro'),
    publicBaseUrl: Type.String({ minLength: 1, maxLength: 512 }),
    mcpEndpoint: Type.String({ minLength: 1, maxLength: 512 }),
    openApiUrl: Type.String({ minLength: 1, maxLength: 512 }),
    ucpProfileUrl: Type.String({ minLength: 1, maxLength: 512 }),
    quickstartUrl: Type.String({ minLength: 1, maxLength: 512 }),
    supportedSurfaces: Type.Array(AgentSurfaceSchema, {
      minItems: 1,
      maxItems: 12,
      uniqueItems: true
    }),
    requiredTrustSignals: Type.Array(AgentTrustSignalCapabilitySchema, {
      minItems: 1,
      maxItems: 16,
      uniqueItems: true
    }),
    firstSuccessFlow: Type.Array(McpToolNameSchema, {
      minItems: 1,
      maxItems: 12,
      uniqueItems: true
    }),
    authorityBoundaries: Type.Array(Type.String({ minLength: 1, maxLength: 360 }), {
      minItems: 1,
      maxItems: 16
    }),
    hermes: Type.Object(
      {
        mcpServerName: Type.Literal('arro'),
        recommendedSkillPath: Type.String({ minLength: 1, maxLength: 240 }),
        mcpToolPrefix: Type.Literal('mcp_arro_'),
        agentContextSurface: Type.Literal('hermes_agent')
      },
      { additionalProperties: false }
    ),
    tools: Type.Array(AgentCapabilityToolSchema, {
      minItems: 1,
      maxItems: 32
    }),
    verification: Type.Object(
      {
        diagnosticsEndpoint: Type.String({ minLength: 1, maxLength: 512 }),
        commands: Type.Array(Type.String({ minLength: 1, maxLength: 240 }), {
          minItems: 1,
          maxItems: 12
        })
      },
      { additionalProperties: false }
    )
  },
  { additionalProperties: false }
)

export type AgentCapabilityAvailability = Static<typeof AgentCapabilityAvailabilitySchema>
export type AgentCapabilityTool = Static<typeof AgentCapabilityToolSchema>
export type AgentCapabilityManifest = Static<typeof AgentCapabilityManifestSchema>
