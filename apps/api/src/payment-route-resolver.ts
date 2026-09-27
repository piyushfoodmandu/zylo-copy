import type {
  AgentHostCapabilities,
  AgentPaymentPresentationSurface,
  PortablePaymentCapability,
  PurchaseClientCapabilities,
  PurchasePaymentPreference,
  TrustedAgentHostContext,
  UserPaymentProviderKind,
  UcpCheckout,
  UcpPaymentHandlerDeclaration
} from '@arro/contracts'
import type {
  UcpPaymentHandlerIdentity,
  UcpPaymentHandlerSupport
} from '@arro/ucp-client'
import type { PaymentHandlerSpecConfig } from './payment-result-exchange.ts'
import type { UcpPaymentActionRecord } from './ucp-checkout-store.ts'
import { googlePayTransactionInfoFromCheckout } from './google-pay-transaction.ts'
import { isStripeNativeProcessorHandler } from './stripe-native-payment.ts'

export type UserPaymentCapability = {
  capabilityId: string
  providerKind: UserPaymentProviderKind
  provider: string
  handlerName: string
  handlerId: string
  identity: UcpPaymentHandlerIdentity
  declaration: UcpPaymentHandlerDeclaration
  presentationSurfaces: AgentPaymentPresentationSurface[]
  supported: boolean
  reason: string
  portableCapability?: PortablePaymentCapability | undefined
}

export type UserPaymentCapabilityProviderInput = {
  checkout: UcpCheckout
  supports: UcpPaymentHandlerSupport[]
  handlerSpecs: PaymentHandlerSpecConfig[]
  portableCapabilities?: PortablePaymentCapability[] | undefined
  clientCapabilities?: PurchaseClientCapabilities | undefined
  hostCapabilities?: AgentHostCapabilities | undefined
  trustedHostContext?: TrustedAgentHostContext | undefined
  componentOrigin?: string | undefined
  returnUrl?: string | undefined
}

export type UserPaymentCapabilityProvider = {
  readonly name: string
  listCapabilities(input: UserPaymentCapabilityProviderInput): UserPaymentCapability[]
}

export type PaymentRouteDecision =
  | {
      available: true
      capability: UserPaymentCapability
      actionType: UcpPaymentActionRecord['actionType']
      presentation: AgentPaymentPresentationSurface
    }
  | {
      available: false
      reason: string
      requestedMode?: PurchasePaymentPreference['mode'] | undefined
    }

const routeOrder: AgentPaymentPresentationSurface[] = [
  'host_native',
  'embedded_component',
  'external_action',
  'merchant_hosted'
]

const unique = <T>(values: T[]) => [...new Set(values)]

const has = <T extends string>(values: readonly T[] | undefined, value: T) =>
  values?.includes(value) ?? false

const paymentActionComponentProtocol = 'arro_payment_action/v1'

const originOf = (value: string | undefined) => {
  if (!value) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

const hostAllowsHandler = (
  hostCapabilities: AgentHostCapabilities | undefined,
  handlerName: string
) =>
  !hostCapabilities?.handlerNames ||
  hostCapabilities.handlerNames.length === 0 ||
  hostCapabilities.handlerNames.includes(handlerName)

const clientAllowsHandler = (
  clientCapabilities: PurchaseClientCapabilities | undefined,
  handlerName: string
) =>
  !clientCapabilities?.handlerNames ||
  clientCapabilities.handlerNames.length === 0 ||
  clientCapabilities.handlerNames.includes(handlerName)

const clientAllowsSurface = (
  clientCapabilities: PurchaseClientCapabilities | undefined,
  surface: AgentPaymentPresentationSurface
) =>
  !clientCapabilities || has(clientCapabilities.surfaces, surface)

const clientCanExecuteNativeGooglePay = (
  clientCapabilities: PurchaseClientCapabilities | undefined,
  handlerName: string
) =>
  clientCapabilities?.platform === 'android' &&
  has(clientCapabilities.providerKinds, 'google_pay') &&
  has(clientCapabilities.surfaces, 'host_native') &&
  clientAllowsHandler(clientCapabilities, handlerName)

const clientCanExecuteNativeStripe = (
  clientCapabilities: PurchaseClientCapabilities | undefined,
  handlerName: string
) =>
  (clientCapabilities?.platform === 'android' || clientCapabilities?.platform === 'ios') &&
  has(clientCapabilities.providerKinds, 'stripe') &&
  has(clientCapabilities.surfaces, 'host_native') &&
  clientAllowsHandler(clientCapabilities, handlerName)

const hostAllowsEmbeddedComponent = (
  input: UserPaymentCapabilityProviderInput
) =>
  input.hostCapabilities?.thirdPartyPaymentEmbeddingAllowed === true &&
  has(input.hostCapabilities?.componentProtocols, paymentActionComponentProtocol) &&
  Boolean(input.componentOrigin) &&
  has(input.hostCapabilities?.allowedComponentOrigins, input.componentOrigin!)

const trustedHostAllowsReturnUrl = (
  input: UserPaymentCapabilityProviderInput
) => {
  if (!input.trustedHostContext) return true
  const origin = originOf(input.returnUrl)
  return Boolean(origin && has(input.hostCapabilities?.allowedReturnOrigins, origin))
}

const supportedHandlers = (input: UserPaymentCapabilityProviderInput) =>
  input.supports.filter((support): support is Extract<UcpPaymentHandlerSupport, { supported: true }> =>
    support.supported === true &&
    support.executionMode !== 'merchant_hosted' &&
    hostAllowsHandler(input.hostCapabilities, support.handlerName)
  )

const openSupportedHandlers = (input: UserPaymentCapabilityProviderInput) =>
  input.supports.filter((support): support is Extract<UcpPaymentHandlerSupport, { supported: true }> =>
    support.supported === true && support.executionMode !== 'merchant_hosted'
  )

const handlerSpecFor = (
  support: Extract<UcpPaymentHandlerSupport, { supported: true }>,
  handlerSpecs: PaymentHandlerSpecConfig[]
) =>
  handlerSpecs.find((spec) =>
    spec.handlerName === support.handlerName &&
    spec.versions.includes(support.identity.version) &&
    spec.specification === support.identity.specification &&
    spec.schema === support.identity.schema
  )

const capabilityIdFor = (kind: UserPaymentProviderKind, identity: UcpPaymentHandlerIdentity) =>
  `${kind}:${identity.handlerName}:${identity.handlerInstanceId}`

const capabilityFromSupport = ({
  providerKind,
  support,
  presentationSurfaces,
  reason,
  portableCapability
}: {
  providerKind: UserPaymentProviderKind
  support: Extract<UcpPaymentHandlerSupport, { supported: true }>
  presentationSurfaces: AgentPaymentPresentationSurface[]
  reason: string
  portableCapability?: PortablePaymentCapability | undefined
}): UserPaymentCapability => ({
  capabilityId: capabilityIdFor(providerKind, support.identity),
  providerKind,
  provider: support.handlerName,
  handlerName: support.handlerName,
  handlerId: support.identity.handlerInstanceId,
  identity: support.identity,
  declaration: support.declaration,
  presentationSurfaces: unique(presentationSurfaces),
  supported: true,
  reason,
  ...(portableCapability ? { portableCapability } : {})
})

export const createMerchantHostedPaymentCapabilityProvider = (): UserPaymentCapabilityProvider => ({
  name: 'merchant_hosted',
  listCapabilities(input) {
    const hosted = input.supports.find((support): support is Extract<UcpPaymentHandlerSupport, { supported: true }> =>
      support.supported === true && support.executionMode === 'merchant_hosted'
    )
    if (!hosted) return []
    return [capabilityFromSupport({
      providerKind: 'merchant_hosted',
      support: hosted,
      presentationSurfaces: ['merchant_hosted'],
      reason: 'Merchant-hosted checkout continuation is available.'
    })]
  }
})

const stringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : []

const overlaps = (declared: string[] | undefined, supported: string[]) =>
  !declared?.length || !supported.length || declared.some((value) => supported.includes(value))

const portableCapabilityMatches = (
  capability: PortablePaymentCapability,
  spec: PaymentHandlerSpecConfig
) => {
  const config = spec.handlerConfig ?? {}
  const protocolVersion = typeof config.protocol_version === 'string'
    ? config.protocol_version
    : spec.adapterKind === 'x402'
      ? '2'
      : undefined
  return capability.protocol === spec.adapterKind &&
    Boolean(protocolVersion) &&
    capability.version === protocolVersion &&
    overlaps(capability.methods, stringArray(config.methods ?? config.schemes)) &&
    overlaps(capability.intents, stringArray(config.intents)) &&
    overlaps(capability.networks, stringArray(config.networks)) &&
    overlaps(capability.assets, stringArray(config.assets))
}

const createPortablePaymentCapabilityProvider = (
  protocol: 'x402' | 'mpp'
): UserPaymentCapabilityProvider => ({
  name: protocol,
  listCapabilities(input) {
    if (!clientAllowsSurface(input.clientCapabilities, 'host_native')) return []
    const agentCapabilities = input.portableCapabilities?.filter((capability) => capability.protocol === protocol) ?? []
    if (agentCapabilities.length === 0) return []
    return openSupportedHandlers(input).flatMap((support) => {
      const spec = handlerSpecFor(support, input.handlerSpecs)
      if (!spec || spec.adapterKind !== protocol) return []
      const agentCapability = agentCapabilities.find((candidate) => portableCapabilityMatches(candidate, spec))
      if (!agentCapability) return []
      return [capabilityFromSupport({
        providerKind: protocol,
        support,
        presentationSurfaces: ['host_native'],
        reason: `Agent and merchant advertise an exact ${protocol} protocol intersection for this Checkout.`,
        portableCapability: agentCapability
      })]
    })
  }
})

export const createProcessorTokenizerPaymentCapabilityProvider = (): UserPaymentCapabilityProvider => ({
  name: 'processor_tokenizer',
  listCapabilities(input) {
    return openSupportedHandlers(input)
      .filter((support) => handlerSpecFor(support, input.handlerSpecs)?.adapterKind === 'processor_tokenizer')
      .map((support) => {
        const nativeStripe =
          isStripeNativeProcessorHandler(support.declaration) &&
          clientCanExecuteNativeStripe(input.clientCapabilities, support.handlerName)
        return capabilityFromSupport({
          providerKind: nativeStripe ? 'stripe' : 'processor_tokenizer',
          support,
          presentationSurfaces: unique([
            ...(nativeStripe ? ['host_native' as const] : []),
            ...(clientAllowsSurface(input.clientCapabilities, 'embedded_component') && has(input.hostCapabilities?.surfaces, 'embedded_component') && hostAllowsEmbeddedComponent(input) ? ['embedded_component' as const] : []),
            ...(clientAllowsSurface(input.clientCapabilities, 'external_action') && trustedHostAllowsReturnUrl(input) ? ['external_action' as const] : [])
          ]),
          reason: nativeStripe
            ? 'Merchant declares a live Stripe Processor Tokenizer contract and this app can present its native PaymentSheet.'
            : 'Merchant declares a Processor Tokenizer handler and Arro can present its signed external action.'
        })
      })
      .filter((capability) => capability.presentationSurfaces.length > 0)
  }
})

export const createGooglePayPaymentCapabilityProvider = (): UserPaymentCapabilityProvider => ({
  name: 'google_pay',
  listCapabilities(input) {
    const transactionInfo = googlePayTransactionInfoFromCheckout(input.checkout)
    if (!transactionInfo) return []
    return openSupportedHandlers(input)
      .filter((support) => handlerSpecFor(support, input.handlerSpecs)?.adapterKind === 'google_pay')
      .map((support) => {
        const nativeExecutorAvailable = (
          (has(input.hostCapabilities?.providerKinds, 'google_pay') &&
            has(input.hostCapabilities?.surfaces, 'host_native')) ||
          clientCanExecuteNativeGooglePay(input.clientCapabilities, support.handlerName)
        )
        const hostedWebExecutorAvailable = (support.actionOrigins?.length ?? 0) > 0
        return capabilityFromSupport({
          providerKind: 'google_pay',
          support,
          presentationSurfaces: unique([
            ...(nativeExecutorAvailable ? ['host_native' as const] : []),
            ...(hostedWebExecutorAvailable && clientAllowsSurface(input.clientCapabilities, 'embedded_component') && has(input.hostCapabilities?.surfaces, 'embedded_component') && hostAllowsEmbeddedComponent(input) ? ['embedded_component' as const] : []),
            ...(hostedWebExecutorAvailable && clientAllowsSurface(input.clientCapabilities, 'external_action') && trustedHostAllowsReturnUrl(input) ? ['external_action' as const] : [])
          ]),
          reason: 'Merchant declares Google Pay and Arro can present the signed action; the first-party Android app or a trusted host may execute it natively.'
        })
      })
      .filter((capability) => capability.presentationSurfaces.length > 0)
  }
})

export const createTrustedHostPaymentCapabilityProvider = (): UserPaymentCapabilityProvider => ({
  name: 'trusted_host',
  listCapabilities(input) {
    if (!clientAllowsSurface(input.clientCapabilities, 'host_native')) return []
    if (!input.trustedHostContext) return []
    if (!has(input.hostCapabilities?.providerKinds, 'trusted_host')) return []
    if (!has(input.hostCapabilities?.surfaces, 'host_native')) return []
    if (
      input.hostCapabilities?.hostId !== input.trustedHostContext.hostId ||
      input.hostCapabilities.integrationId !== input.trustedHostContext.integrationId
    ) {
      return []
    }
    return supportedHandlers(input).map((support) => capabilityFromSupport({
      providerKind: 'trusted_host',
      support,
      presentationSurfaces: ['host_native'],
      reason: 'Trusted host context is present and host-native payment capability is attested for this checkout.'
    }))
  }
})

export const createUserPaymentCapabilityProviderRegistry = (
  providers: UserPaymentCapabilityProvider[] = [
    createPortablePaymentCapabilityProvider('x402'),
    createPortablePaymentCapabilityProvider('mpp'),
    createTrustedHostPaymentCapabilityProvider(),
    createGooglePayPaymentCapabilityProvider(),
    createProcessorTokenizerPaymentCapabilityProvider(),
    createMerchantHostedPaymentCapabilityProvider()
  ]
) => ({
  providers,
  listCapabilities(input: UserPaymentCapabilityProviderInput) {
    const seen = new Set<string>()
    const capabilities: UserPaymentCapability[] = []
    for (const capability of providers.flatMap((provider) => provider.listCapabilities(input))) {
      const key = [
        capability.providerKind,
        capability.provider,
        capability.handlerId,
        capability.presentationSurfaces.join(',')
      ].join('|')
      if (seen.has(key)) continue
      seen.add(key)
      capabilities.push(capability)
    }
    return capabilities
  }
})

const modeProviderKinds = (
  mode: PurchasePaymentPreference['mode'] | undefined
): UserPaymentProviderKind[] | undefined => {
  if (!mode) return undefined
  if (mode === 'x402') return ['x402']
  if (mode === 'mpp') return ['mpp']
  if (mode === 'host_supplied') return ['trusted_host']
  if (mode === 'google_pay') return ['google_pay']
  if (mode === 'stripe') return ['stripe']
  if (mode === 'processor_tokenizer') return ['processor_tokenizer']
  return undefined
}

const actionTypeFor = (
  providerKind: UserPaymentProviderKind
): UcpPaymentActionRecord['actionType'] | undefined => {
  if (providerKind === 'x402') return 'x402'
  if (providerKind === 'mpp') return 'mpp'
  if (providerKind === 'trusted_host') return 'host_supplied'
  if (providerKind === 'google_pay') return 'google_pay'
  if (providerKind === 'stripe') return 'processor_tokenizer'
  if (providerKind === 'processor_tokenizer') return 'processor_tokenizer'
  return undefined
}

const preferredSurface = (
  capability: UserPaymentCapability
): AgentPaymentPresentationSurface =>
  routeOrder.find((surface) => capability.presentationSurfaces.includes(surface)) ?? 'merchant_hosted'

export const resolvePaymentRoute = ({
  capabilities,
  preference
}: {
  capabilities: UserPaymentCapability[]
  preference?: PurchasePaymentPreference | undefined
}): PaymentRouteDecision => {
  const preferredProvider = preference?.provider?.trim()
  const preferredKinds = modeProviderKinds(preference?.mode)
  const requestedCapabilityId = preference?.capabilityId?.trim()
  const filtered = capabilities.filter((capability) => {
    if (!capability.supported) return false
    if (preferredProvider && capability.provider !== preferredProvider) return false
    if (requestedCapabilityId && capability.capabilityId !== requestedCapabilityId) return false
    if (preferredKinds && !preferredKinds.includes(capability.providerKind)) return false
    return true
  })

  const executable = filtered
    .map((capability) => ({
      capability,
      actionType: actionTypeFor(capability.providerKind),
      presentation: preferredSurface(capability)
    }))
    .filter((entry): entry is {
      capability: UserPaymentCapability
      actionType: UcpPaymentActionRecord['actionType']
      presentation: AgentPaymentPresentationSurface
    } => Boolean(entry.actionType) && entry.presentation !== 'merchant_hosted')
    .sort((left, right) =>
      routeOrder.indexOf(left.presentation) - routeOrder.indexOf(right.presentation)
    )

  if (executable[0]) {
    return {
      available: true,
      ...executable[0]
    }
  }

  return {
    available: false,
    reason: preference?.mode
      ? `requested_${preference.mode}_unavailable`
      : 'hosted_continuation_only',
    ...(preference?.mode ? { requestedMode: preference.mode } : {})
  }
}
