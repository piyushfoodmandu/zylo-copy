import { describe, expect, it } from 'vitest'
import type { TrustedAgentHostContext } from '@arro/contracts'
import { applyAgentExecutionDownscope, createAgentHostRegistry, type RegisteredAgentHost } from './agent-host-registry.ts'

const context: TrustedAgentHostContext = {
  hostId: 'hermes',
  integrationId: 'agent:test-key:hermes',
  issuer: 'https://hermes.example',
  audience: 'https://arro.example',
  keyId: 'hermes-key-1',
  capabilities: {
    hostId: 'hermes',
    integrationId: 'agent:test-key:hermes',
    surfaces: ['host_native'],
    providerKinds: ['trusted_host']
  },
  attestedAt: '2026-07-12T00:00:00.000Z',
  expiresAt: '2026-07-12T00:10:00.000Z'
}

describe('agent host registry', () => {
  it('does not invent merchant-hosted capabilities when caller downscope intersects to empty', () => {
    const downscoped = applyAgentExecutionDownscope(context, {
      allowedPresentationModes: ['external_action'],
      preferredPaymentProviderKinds: ['processor_tokenizer']
    })

    expect(downscoped.capabilities.surfaces).toEqual([])
    expect(downscoped.capabilities.providerKinds).toEqual([])
  })

  it('resolves only signed sessions bound to configured registered integrations', async () => {
    const host: RegisteredAgentHost = {
      hostId: 'hermes',
      integrationId: 'agent:test-key:hermes',
      allowedScopes: ['write:purchase'],
      presentationModes: ['host_native'],
      paymentProviderKinds: ['trusted_host'],
      authorizationProviderKinds: ['trusted_host'],
      canReceiveAsyncPurchaseUpdates: true,
      thirdPartyPaymentEmbeddingAllowed: false,
      autonomousExecutionAllowed: true
    }
    const registry = createAgentHostRegistry([host])

    await expect(registry.resolve({
      principal: {
        keyId: 'test-key',
        ownerPrincipal: 'owner:test',
        ownerPrincipalHash: 'sha256:owner',
        integrationId: 'api-key:test-key'
      }
    })).resolves.toBeUndefined()

    await expect(registry.resolve({
      principal: {
        keyId: 'test-key',
        ownerPrincipal: 'owner:test',
        ownerPrincipalHash: 'sha256:owner',
        integrationId: 'agent:test-key:hermes',
        agentSessionId: 'session_1',
        agentActionScope: 'write:purchase',
        agentAllowedActionScopes: ['write:purchase']
      }
    })).resolves.toMatchObject({
      hostId: 'hermes',
      capabilities: {
        surfaces: ['host_native'],
        providerKinds: ['trusted_host']
      }
    })
  })

  it('propagates registered component, return-origin, async, embedding, autonomous, and authorization fields into trusted context', async () => {
    const host: RegisteredAgentHost = {
      hostId: 'embedded-host',
      integrationId: 'agent:test-key:embedded',
      allowedScopes: ['write:complete_purchase'],
      presentationModes: ['embedded_component', 'external_action'],
      paymentProviderKinds: ['google_pay', 'processor_tokenizer'],
      authorizationProviderKinds: ['trusted_host_signature'],
      handlerNames: ['com.google.pay'],
      componentProtocols: ['arro_payment_action/v1'],
      allowedComponentOrigins: ['https://api.arro.example'],
      allowedReturnOrigins: ['https://host.example'],
      canReceiveAsyncPurchaseUpdates: true,
      thirdPartyPaymentEmbeddingAllowed: true,
      autonomousExecutionAllowed: false,
      attestationIssuer: 'https://embedded-host.example',
      attestationAudience: 'https://arro.example'
    }
    const registry = createAgentHostRegistry([host])

    await expect(registry.resolve({
      principal: {
        keyId: 'test-key',
        ownerPrincipal: 'owner:test',
        ownerPrincipalHash: 'sha256:owner',
        integrationId: 'agent:test-key:embedded',
        agentSessionId: 'session_1',
        agentActionScope: 'write:complete_purchase',
        agentAllowedActionScopes: ['write:complete_purchase']
      }
    })).resolves.toMatchObject({
      hostId: 'embedded-host',
      issuer: 'https://embedded-host.example',
      audience: 'https://arro.example',
      capabilities: {
        authorizationProviderKinds: ['trusted_host_signature'],
        handlerNames: ['com.google.pay'],
        componentProtocols: ['arro_payment_action/v1'],
        allowedComponentOrigins: ['https://api.arro.example'],
        allowedReturnOrigins: ['https://host.example'],
        canReceiveAsyncPurchaseUpdates: true,
        thirdPartyPaymentEmbeddingAllowed: true,
        autonomousExecutionAllowed: false
      }
    })
  })
})
