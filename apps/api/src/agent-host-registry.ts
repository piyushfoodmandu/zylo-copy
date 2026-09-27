import type {
  AgentExecutionDownscope,
  AgentHostCapabilities,
  AgentPaymentPresentationSurface,
  TrustedAgentHostContext,
  UserPaymentProviderKind
} from '@arro/contracts'
import type { CommercePrincipal } from './commerce-principal.ts'

export type RegisteredAgentHost = {
  hostId: string
  integrationId: string
  allowedScopes: string[]
  presentationModes: AgentPaymentPresentationSurface[]
  paymentProviderKinds: UserPaymentProviderKind[]
  authorizationProviderKinds: string[]
  handlerNames?: string[]
  componentProtocols?: string[]
  allowedComponentOrigins?: string[]
  allowedReturnOrigins?: string[]
  canReceiveAsyncPurchaseUpdates: boolean
  thirdPartyPaymentEmbeddingAllowed: boolean
  autonomousExecutionAllowed: boolean
  attestationIssuer?: string
  attestationAudience?: string
}

export type AgentHostRegistry = {
  resolve(input: {
    principal: CommercePrincipal
  }): Promise<TrustedAgentHostContext | undefined>
  resolveRegistered(input: {
    principal: CommercePrincipal
  }): Promise<RegisteredAgentHost | undefined>
}

const unique = <T>(values: readonly T[]) => [...new Set(values)]

const intersection = <T extends string>(left: readonly T[], right: readonly T[]) =>
  left.filter((entry) => right.includes(entry))

export const createAgentHostRegistry = (
  hosts: RegisteredAgentHost[]
): AgentHostRegistry => {
  const resolveRegistered = (principal: CommercePrincipal) => {
    if (!principal.agentSessionId) return undefined
    const registered = hosts.find((host) => host.integrationId === principal.integrationId)
    if (!registered) return undefined
    if (
      registered.allowedScopes.length > 0 &&
      (!principal.agentActionScope || !registered.allowedScopes.includes(principal.agentActionScope))
    ) {
      return undefined
    }
    return registered
  }

  return {
    async resolve({ principal }) {
      const registered = resolveRegistered(principal)
      if (!registered) return undefined
      const capabilities: AgentHostCapabilities = {
        hostId: registered.hostId,
        integrationId: principal.integrationId,
        surfaces: registered.presentationModes,
        providerKinds: registered.paymentProviderKinds,
        authorizationProviderKinds: registered.authorizationProviderKinds,
        ...(registered.handlerNames && registered.handlerNames.length > 0 ? { handlerNames: registered.handlerNames } : {}),
        ...(registered.componentProtocols && registered.componentProtocols.length > 0 ? { componentProtocols: registered.componentProtocols } : {}),
        ...(registered.allowedComponentOrigins && registered.allowedComponentOrigins.length > 0 ? { allowedComponentOrigins: registered.allowedComponentOrigins } : {}),
        ...(registered.allowedReturnOrigins && registered.allowedReturnOrigins.length > 0 ? { allowedReturnOrigins: registered.allowedReturnOrigins } : {}),
        canReceiveAsyncPurchaseUpdates: registered.canReceiveAsyncPurchaseUpdates,
        thirdPartyPaymentEmbeddingAllowed: registered.thirdPartyPaymentEmbeddingAllowed,
        autonomousExecutionAllowed: registered.autonomousExecutionAllowed,
        ...(registered.attestationIssuer ? { attestationIssuer: registered.attestationIssuer } : {}),
        ...(registered.attestationAudience ? { attestationAudience: registered.attestationAudience } : {})
      }

      return {
        hostId: registered.hostId,
        integrationId: principal.integrationId,
        issuer: registered.attestationIssuer ?? `arro-agent-host:${registered.hostId}`,
        audience: registered.attestationAudience ?? 'arro-commerce',
        keyId: registered.hostId,
        ...(principal.externalSubjectRefHash ? { subjectRefHash: principal.externalSubjectRefHash } : {}),
        ...(principal.externalTaskRefHash ? { taskRefHash: principal.externalTaskRefHash } : {}),
        capabilities,
        attestedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }
    },

    async resolveRegistered({ principal }) {
      return resolveRegistered(principal)
    }
  }
}

export const applyAgentExecutionDownscope = (
  context: TrustedAgentHostContext,
  downscope: AgentExecutionDownscope | undefined
): TrustedAgentHostContext => {
  const allowedModes = downscope?.allowedPresentationModes
    ? intersection(context.capabilities.surfaces, downscope.allowedPresentationModes)
    : context.capabilities.surfaces
  const providerKinds = downscope?.preferredPaymentProviderKinds
    ? intersection(context.capabilities.providerKinds, downscope.preferredPaymentProviderKinds)
    : context.capabilities.providerKinds
  return {
    ...context,
    capabilities: {
      ...context.capabilities,
      surfaces: unique(allowedModes),
      providerKinds: unique(providerKinds)
    }
  }
}
