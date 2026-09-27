import { describe, expect, it } from 'vitest'
import type {
  AgentHostCapabilities,
  PurchaseClientCapabilities,
  TrustedAgentHostContext,
  UcpCheckout
} from '@arro/contracts'
import type { UcpPaymentHandlerSupport } from '@arro/ucp-client'
import type { PaymentHandlerSpecConfig } from './payment-result-exchange.ts'
import {
  createUserPaymentCapabilityProviderRegistry,
  resolvePaymentRoute
} from './payment-route-resolver.ts'

const checkout: UcpCheckout = {
  ucp: {
    version: '2026-08-25',
    status: 'success'
  },
  id: 'chk_1',
  status: 'ready_for_complete',
  currency: 'USD',
  context: {
    merchant_country: 'US'
  },
  line_items: [],
  totals: [{ type: 'total', amount: 1999, currency: 'USD' }],
  links: []
}

const spec = ({
  adapterKind,
  handlerName,
  specification = `https://merchant.example/handlers/${handlerName}`,
  schema = `https://merchant.example/handlers/${handlerName}/schema.json`,
  handlerConfig
}: {
  adapterKind: PaymentHandlerSpecConfig['adapterKind']
  handlerName: string
  specification?: string
  schema?: string
  handlerConfig?: Record<string, unknown>
}): PaymentHandlerSpecConfig => ({
  adapterKind,
  handlerName,
  platformHandlerId: `arro_${handlerName}`,
  versions: ['2026-08-25'],
  specification,
  schema,
  ...(handlerConfig ? { handlerConfig } : {}),
  lifecyclePolicy: {
    rejectReusable: true,
    requiresCheckoutScope: true,
    requiresMerchantOriginScope: true,
    requiresExpiry: true
  }
})

const support = ({
  handlerName,
  handlerId,
  specification = `https://merchant.example/handlers/${handlerName}`,
  schema = `https://merchant.example/handlers/${handlerName}/schema.json`,
  config,
  actionOrigins
}: {
  handlerName: string
  handlerId: string
  specification?: string
  schema?: string
  config?: Record<string, unknown>
  actionOrigins?: string[]
}): Extract<UcpPaymentHandlerSupport, { supported: true }> => ({
  supported: true,
  handlerName,
  identity: {
    handlerName,
    handlerInstanceId: handlerId,
    version: '2026-08-25',
    specification,
    schema
  },
  declaration: {
    id: handlerId,
    version: '2026-08-25',
    spec: specification,
    schema,
    ...(config ? { config } : {})
  },
  executionMode: 'relay',
  ...(actionOrigins ? { actionOrigins } : {}),
  reason: 'supported in test'
})

describe('payment route resolver', () => {
  it('selects an unregistered agent x402 capability before optional host adapters', () => {
    const handlerName = 'dev.arro.payment.x402'
    const config = {
      protocol_version: '2',
      schemes: ['exact'],
      networks: ['eip155:8453'],
      assets: ['USDC']
    }
    const capabilities = createUserPaymentCapabilityProviderRegistry().listCapabilities({
      checkout,
      supports: [support({ handlerName, handlerId: 'merchant_x402_1', config })],
      handlerSpecs: [spec({ adapterKind: 'x402', handlerName, handlerConfig: config })],
      portableCapabilities: [{
        protocol: 'x402',
        version: '2',
        methods: ['exact'],
        networks: ['eip155:8453'],
        assets: ['USDC']
      }]
    })

    expect(resolvePaymentRoute({ capabilities })).toMatchObject({
      available: true,
      actionType: 'x402',
      presentation: 'host_native',
      capability: { providerKind: 'x402' }
    })
  })

  it('chooses trusted host-native capability before embedded and external routes', () => {
    const hostCapabilities: AgentHostCapabilities = {
      hostId: 'hermes',
      integrationId: 'api-key:test',
      surfaces: ['host_native', 'embedded_component', 'external_action'],
      providerKinds: ['trusted_host', 'google_pay', 'processor_tokenizer']
    }
    const trustedHostContext: TrustedAgentHostContext = {
      hostId: 'hermes',
      integrationId: 'api-key:test',
      issuer: 'https://hermes.example',
      audience: 'https://arro.example',
      keyId: 'hermes-key-1',
      capabilities: hostCapabilities,
      attestedAt: '2026-07-12T00:00:00.000Z',
      expiresAt: '2026-07-12T00:10:00.000Z'
    }
    const capabilities = createUserPaymentCapabilityProviderRegistry().listCapabilities({
      checkout,
      supports: [support({ handlerName: 'com.example.processor_tokenizer', handlerId: 'merchant_processor' })],
      handlerSpecs: [
        spec({ adapterKind: 'processor_tokenizer', handlerName: 'com.example.processor_tokenizer' })
      ],
      hostCapabilities,
      trustedHostContext
    })

    const route = resolvePaymentRoute({ capabilities })
    expect(route).toMatchObject({
      available: true,
      actionType: 'host_supplied',
      presentation: 'host_native',
      capability: {
        providerKind: 'trusted_host'
      }
    })
  })

  it('chooses embedded Google Pay when host-native is absent but embedded is available', () => {
    const googleSpec = 'https://pay.google.com/gp/p/ucp/2026-01-23/'
    const googleSchema = 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json'
    const capabilities = createUserPaymentCapabilityProviderRegistry().listCapabilities({
      checkout,
      supports: [
        support({
          handlerName: 'com.google.pay',
          handlerId: 'merchant_google_pay',
          specification: googleSpec,
          schema: googleSchema,
          actionOrigins: ['https://api.arro.example']
        })
      ],
      handlerSpecs: [
        spec({
          adapterKind: 'google_pay',
          handlerName: 'com.google.pay',
          specification: googleSpec,
          schema: googleSchema
        })
      ],
      hostCapabilities: {
        hostId: 'chatgpt-like-host',
        integrationId: 'api-key:test',
        surfaces: ['embedded_component', 'external_action'],
        providerKinds: ['google_pay'],
        componentProtocols: ['arro_payment_action/v1'],
        allowedComponentOrigins: ['https://api.arro.example'],
        allowedReturnOrigins: ['https://host.example'],
        thirdPartyPaymentEmbeddingAllowed: true
      },
      componentOrigin: 'https://api.arro.example',
      returnUrl: 'https://host.example/return'
    })

    expect(resolvePaymentRoute({ capabilities })).toMatchObject({
      available: true,
      actionType: 'google_pay',
      presentation: 'embedded_component',
      capability: {
        providerKind: 'google_pay'
      }
    })
  })

  it('chooses host-native Google Pay for the first-party Android client without agent-host claims', () => {
    const googleSpec = 'https://pay.google.com/gp/p/ucp/2026-01-23/'
    const googleSchema = 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json'
    const clientCapabilities: PurchaseClientCapabilities = {
      platform: 'android',
      surfaces: ['host_native'],
      providerKinds: ['google_pay'],
      handlerNames: ['com.google.pay']
    }
    const capabilities = createUserPaymentCapabilityProviderRegistry().listCapabilities({
      checkout,
      supports: [support({
        handlerName: 'com.google.pay',
        handlerId: 'merchant_google_pay',
        specification: googleSpec,
        schema: googleSchema
      })],
      handlerSpecs: [spec({
        adapterKind: 'google_pay',
        handlerName: 'com.google.pay',
        specification: googleSpec,
        schema: googleSchema
      })],
      clientCapabilities
    })

    expect(resolvePaymentRoute({ capabilities, preference: { mode: 'google_pay' } })).toMatchObject({
      available: true,
      actionType: 'google_pay',
      presentation: 'host_native',
      capability: { providerKind: 'google_pay' }
    })
  })

  it('does not silently fall back to a browser outside the first-party client surface contract', () => {
    const googleSpec = 'https://pay.google.com/gp/p/ucp/2026-01-23/'
    const googleSchema = 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json'
    const base = {
      checkout,
      supports: [support({
        handlerName: 'com.google.pay',
        handlerId: 'merchant_google_pay',
        specification: googleSpec,
        schema: googleSchema
      })],
      handlerSpecs: [spec({
        adapterKind: 'google_pay' as const,
        handlerName: 'com.google.pay',
        specification: googleSpec,
        schema: googleSchema
      })]
    }

    for (const clientCapabilities of [
      {
        platform: 'ios' as const,
        surfaces: ['host_native' as const],
        providerKinds: ['google_pay' as const]
      },
      {
        platform: 'android' as const,
        surfaces: ['host_native' as const],
        providerKinds: ['google_pay' as const],
        handlerNames: ['com.example.other']
      }
    ]) {
      const capabilities = createUserPaymentCapabilityProviderRegistry().listCapabilities({
        ...base,
        clientCapabilities
      })
      expect(capabilities).toEqual([])
    }
  })

  it('uses external Google Pay only when the first-party client explicitly advertises fallback', () => {
    const googleSpec = 'https://pay.google.com/gp/p/ucp/2026-01-23/'
    const googleSchema = 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json'
    const capabilities = createUserPaymentCapabilityProviderRegistry().listCapabilities({
      checkout,
      supports: [support({
        handlerName: 'com.google.pay',
        handlerId: 'merchant_google_pay',
        specification: googleSpec,
        schema: googleSchema,
        actionOrigins: ['https://api.arro.example']
      })],
      handlerSpecs: [spec({
        adapterKind: 'google_pay',
        handlerName: 'com.google.pay',
        specification: googleSpec,
        schema: googleSchema
      })],
      clientCapabilities: {
        platform: 'ios',
        surfaces: ['external_action'],
        providerKinds: ['google_pay']
      }
    })

    expect(resolvePaymentRoute({ capabilities })).toMatchObject({
      available: true,
      actionType: 'google_pay',
      presentation: 'external_action'
    })
  })

  it('keeps native Google Pay available when optional merchant-country data is absent', () => {
    const googleSpec = 'https://pay.google.com/gp/p/ucp/2026-01-23/'
    const googleSchema = 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json'
    const { context: _context, ...checkoutWithoutMerchantCountry } = checkout
    const base = {
      checkout: checkoutWithoutMerchantCountry,
      supports: [support({
        handlerName: 'com.google.pay',
        handlerId: 'merchant_google_pay',
        specification: googleSpec,
        schema: googleSchema,
        actionOrigins: ['https://api.arro.example']
      })],
      handlerSpecs: [spec({
        adapterKind: 'google_pay' as const,
        handlerName: 'com.google.pay',
        specification: googleSpec,
        schema: googleSchema
      })]
    }

    const withFallback = createUserPaymentCapabilityProviderRegistry().listCapabilities({
      ...base,
      clientCapabilities: {
        platform: 'android',
        surfaces: ['host_native', 'external_action'],
        providerKinds: ['google_pay']
      }
    })
    expect(resolvePaymentRoute({ capabilities: withFallback })).toMatchObject({
      available: true,
      presentation: 'host_native'
    })

    const nativeOnly = createUserPaymentCapabilityProviderRegistry().listCapabilities({
      ...base,
      clientCapabilities: {
        platform: 'android',
        surfaces: ['host_native'],
        providerKinds: ['google_pay']
      }
    })
    expect(resolvePaymentRoute({ capabilities: nativeOnly })).toMatchObject({
      available: true,
      presentation: 'host_native'
    })
  })

  it('falls back to external action for Processor Tokenizer when embedded is unavailable', () => {
    const capabilities = createUserPaymentCapabilityProviderRegistry().listCapabilities({
      checkout,
      supports: [support({ handlerName: 'com.example.processor_tokenizer', handlerId: 'merchant_processor' })],
      handlerSpecs: [
        spec({ adapterKind: 'processor_tokenizer', handlerName: 'com.example.processor_tokenizer' })
      ],
      hostCapabilities: {
        hostId: 'claude-like-host',
        integrationId: 'api-key:test',
        surfaces: ['external_action'],
        providerKinds: ['processor_tokenizer'],
        allowedReturnOrigins: ['https://host.example']
      },
      returnUrl: 'https://host.example/return'
    })

    expect(resolvePaymentRoute({ capabilities })).toMatchObject({
      available: true,
      actionType: 'processor_tokenizer',
      presentation: 'external_action',
      capability: {
        providerKind: 'processor_tokenizer'
      }
    })
  })

  it('keeps a signed Processor Tokenizer external action available without host approval', () => {
    const capabilities = createUserPaymentCapabilityProviderRegistry().listCapabilities({
      checkout,
      supports: [support({ handlerName: 'com.example.processor_tokenizer', handlerId: 'merchant_processor' })],
      handlerSpecs: [
        spec({ adapterKind: 'processor_tokenizer', handlerName: 'com.example.processor_tokenizer' })
      ],
      hostCapabilities: {
        hostId: 'status-only-host',
        integrationId: 'api-key:test',
        surfaces: ['merchant_hosted'],
        providerKinds: ['processor_tokenizer']
      }
    })

    expect(resolvePaymentRoute({ capabilities })).toMatchObject({
      available: true,
      actionType: 'processor_tokenizer',
      presentation: 'external_action'
    })
  })

  it('blocks embedded presentation when the component protocol is missing but preserves signed external action', () => {
    const googleSpec = 'https://pay.google.com/gp/p/ucp/2026-01-23/'
    const googleSchema = 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json'
    const capabilities = createUserPaymentCapabilityProviderRegistry().listCapabilities({
      checkout,
      supports: [
        support({
          handlerName: 'com.google.pay',
          handlerId: 'merchant_google_pay',
          specification: googleSpec,
          schema: googleSchema,
          actionOrigins: ['https://api.arro.example']
        })
      ],
      handlerSpecs: [
        spec({
          adapterKind: 'google_pay',
          handlerName: 'com.google.pay',
          specification: googleSpec,
          schema: googleSchema
        })
      ],
      hostCapabilities: {
        hostId: 'embedded-host',
        integrationId: 'api-key:test',
        surfaces: ['embedded_component'],
        providerKinds: ['google_pay'],
        allowedComponentOrigins: ['https://api.arro.example'],
        thirdPartyPaymentEmbeddingAllowed: true
      },
      componentOrigin: 'https://api.arro.example'
    })

    expect(capabilities).toHaveLength(1)
    expect(capabilities[0]?.presentationSurfaces).toEqual(['external_action'])
  })

  it('blocks embedded payment routes when component origin or third-party embedding permission is missing', () => {
    const googleSpec = 'https://pay.google.com/gp/p/ucp/2026-01-23/'
    const googleSchema = 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json'
    const base = {
      checkout,
      supports: [
        support({
          handlerName: 'com.google.pay',
          handlerId: 'merchant_google_pay',
          specification: googleSpec,
          schema: googleSchema,
          actionOrigins: ['https://api.arro.example']
        })
      ],
      handlerSpecs: [
        spec({
          adapterKind: 'google_pay',
          handlerName: 'com.google.pay',
          specification: googleSpec,
          schema: googleSchema
        })
      ]
    }

    expect(createUserPaymentCapabilityProviderRegistry().listCapabilities({
      ...base,
      hostCapabilities: {
        hostId: 'embedded-host',
        integrationId: 'api-key:test',
        surfaces: ['embedded_component'],
        providerKinds: ['google_pay'],
        componentProtocols: ['arro_payment_action/v1'],
        allowedComponentOrigins: ['https://other.example'],
        thirdPartyPaymentEmbeddingAllowed: true
      },
      componentOrigin: 'https://api.arro.example'
    })[0]?.presentationSurfaces).toEqual(['external_action'])

    expect(createUserPaymentCapabilityProviderRegistry().listCapabilities({
      ...base,
      hostCapabilities: {
        hostId: 'embedded-host',
        integrationId: 'api-key:test',
        surfaces: ['embedded_component'],
        providerKinds: ['google_pay'],
        componentProtocols: ['arro_payment_action/v1'],
        allowedComponentOrigins: ['https://api.arro.example'],
        thirdPartyPaymentEmbeddingAllowed: false
      },
      componentOrigin: 'https://api.arro.example'
    })[0]?.presentationSurfaces).toEqual(['external_action'])
  })

  it('does not use return-origin allowlisting as agent approval for signed external actions', () => {
    const capabilities = createUserPaymentCapabilityProviderRegistry().listCapabilities({
      checkout,
      supports: [support({ handlerName: 'com.example.processor_tokenizer', handlerId: 'merchant_processor' })],
      handlerSpecs: [
        spec({ adapterKind: 'processor_tokenizer', handlerName: 'com.example.processor_tokenizer' })
      ],
      hostCapabilities: {
        hostId: 'external-host',
        integrationId: 'api-key:test',
        surfaces: ['external_action'],
        providerKinds: ['processor_tokenizer'],
        allowedReturnOrigins: ['https://trusted-host.example']
      },
      returnUrl: 'https://unregistered-host.example/return'
    })

    expect(resolvePaymentRoute({ capabilities })).toMatchObject({
      available: true,
      actionType: 'processor_tokenizer',
      presentation: 'external_action'
    })
  })

  it('enforces registered return origins only after trusted-host resolution', () => {
    const hostCapabilities: AgentHostCapabilities = {
      hostId: 'trusted-external-host',
      integrationId: 'api-key:test',
      surfaces: ['external_action'],
      providerKinds: ['processor_tokenizer'],
      allowedReturnOrigins: ['https://trusted-host.example']
    }
    const trustedHostContext: TrustedAgentHostContext = {
      hostId: 'trusted-external-host',
      integrationId: 'api-key:test',
      issuer: 'https://trusted-host.example',
      audience: 'https://arro.example',
      keyId: 'trusted-host-key',
      capabilities: hostCapabilities,
      attestedAt: '2026-07-12T00:00:00.000Z',
      expiresAt: '2026-07-12T00:10:00.000Z'
    }
    const input = {
      checkout,
      supports: [support({ handlerName: 'com.example.processor_tokenizer', handlerId: 'merchant_processor' })],
      handlerSpecs: [spec({ adapterKind: 'processor_tokenizer' as const, handlerName: 'com.example.processor_tokenizer' })],
      hostCapabilities,
      trustedHostContext
    }

    expect(createUserPaymentCapabilityProviderRegistry().listCapabilities({
      ...input,
      returnUrl: 'https://unregistered-host.example/return'
    })).toHaveLength(0)
    expect(createUserPaymentCapabilityProviderRegistry().listCapabilities({
      ...input,
      returnUrl: 'https://trusted-host.example/return'
    })).toHaveLength(1)
  })
})
