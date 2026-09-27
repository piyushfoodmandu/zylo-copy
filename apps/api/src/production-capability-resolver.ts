import type {
  AgentActionScope,
  McpToolName
} from '@arro/contracts'

export type ProductionEnvironment = 'development' | 'test' | 'preview' | 'production'
export type ProductionCapabilityDecision = 'available' | 'limited' | 'blocked' | 'hidden'
export type ProductionCapabilityLane =
  | 'lane_0_advisory'
  | 'lane_1_merchant_handoff'
  | 'lane_2_direct_completion'

export type ProductionCapabilityContext = {
  environment: ProductionEnvironment
  integration: {
    authenticated: boolean
    allowedActionScopes: AgentActionScope[]
  }
  session: {
    signed: boolean
    subjectBound: boolean
    taskBound: boolean
    explicitUserConfirmation: boolean
    scopedHandoffAvailable: boolean
  }
  user: {
    eligibility: 'eligible' | 'ineligible' | 'unknown'
    jurisdiction: 'supported' | 'unsupported' | 'unknown'
  }
  source: {
    approval: 'none' | 'candidate' | 'catalog_approved' | 'transaction_approved' | 'suspended' | 'revoked' | 'expired'
    health: 'healthy' | 'degraded' | 'down'
    evidence: 'current' | 'stale' | 'missing'
    capabilities: {
      catalog: boolean
      cart: boolean
      checkoutHandoff: boolean
      directCheckout: boolean
      orderStatus: boolean
      refundCancellation: boolean
    }
    merchantContract: 'active' | 'missing' | 'expired' | 'suspended'
  }
  payment: {
    merchantHosted: 'supported' | 'unsupported'
    directProvider: 'active' | 'missing' | 'degraded' | 'suspended'
    proof: 'provider_signed' | 'provider_reference' | 'tokenized_instrument' | 'none'
  }
  risk: {
    decision: 'allow' | 'challenge' | 'manual_review' | 'block'
    reasonCodes: string[]
  }
  productPolicy: {
    decision: 'allowed' | 'restricted' | 'unknown' | 'blocked'
    reasonCodes: string[]
  }
  incident: {
    state: 'normal' | 'degraded' | 'kill_switch'
    disabledActionScopes: AgentActionScope[]
  }
}

export type ProductionCapabilityToolDecision = {
  name: McpToolName
  actionScope: AgentActionScope
  lane: ProductionCapabilityLane
  decision: ProductionCapabilityDecision
  executionAllowed: boolean
  reasons: string[]
  missing: string[]
}

export type ProductionCapabilityResolution = {
  launchMode: 'public_preview' | 'production'
  allowedActionScopes: AgentActionScope[]
  tools: ProductionCapabilityToolDecision[]
  summary: {
    lane0AdvisoryAvailable: boolean
    lane1MerchantHandoffAvailable: boolean
    lane2DirectCompletionAvailable: boolean
  }
}

export const productionCapabilityToolScopes = {
  agent_diagnostics: 'read:sanity_check',
  search_products: 'read:search',
  get_product_detail: 'read:product_detail',
  compare_products: 'read:compare',
  get_source_state: 'read:source_state',
  sanity_check_product: 'read:sanity_check',
  prepare_purchase: 'write:purchase',
  update_purchase: 'write:purchase',
  prepare_payment: 'write:purchase',
  provide_payment: 'write:complete_purchase',
  confirm_purchase: 'write:complete_purchase',
  get_purchase: 'read:purchase',
  cancel_purchase: 'write:purchase'
} satisfies Record<McpToolName, AgentActionScope>

const toolLanes = {
  agent_diagnostics: 'lane_0_advisory',
  search_products: 'lane_0_advisory',
  get_product_detail: 'lane_0_advisory',
  compare_products: 'lane_0_advisory',
  get_source_state: 'lane_0_advisory',
  sanity_check_product: 'lane_0_advisory',
  prepare_purchase: 'lane_1_merchant_handoff',
  update_purchase: 'lane_1_merchant_handoff',
  prepare_payment: 'lane_2_direct_completion',
  provide_payment: 'lane_2_direct_completion',
  confirm_purchase: 'lane_2_direct_completion',
  get_purchase: 'lane_1_merchant_handoff',
  cancel_purchase: 'lane_1_merchant_handoff'
} satisfies Record<McpToolName, ProductionCapabilityLane>

const orderedTools = Object.keys(productionCapabilityToolScopes) as McpToolName[]

const sourceCanRead = (context: ProductionCapabilityContext) =>
  context.source.capabilities.catalog &&
  context.source.evidence === 'current' &&
  context.source.health !== 'down'

const baseExecutionGates = (context: ProductionCapabilityContext) => {
  const missing: string[] = []
  const reasons: string[] = []

  if (!context.integration.authenticated) missing.push('authenticated integration')
  if (!context.session.signed) missing.push('signed session')
  if (!context.session.subjectBound) missing.push('subject-bound session')
  if (!context.session.taskBound) missing.push('task-bound session')
  if (!context.session.explicitUserConfirmation) missing.push('explicit user confirmation')
  if (['suspended', 'revoked', 'expired'].includes(context.source.approval)) {
    missing.push('source not suspended, revoked, or expired')
  }
  if (context.source.evidence !== 'current') missing.push('current source capability evidence')
  if (context.source.health === 'down') missing.push('healthy source')
  if (context.risk.decision === 'block') missing.push('risk state not blocked')
  if (context.productPolicy.decision === 'blocked') missing.push('product policy not blocked')
  if (context.incident.state === 'kill_switch') missing.push('no global kill switch')

  if (context.source.approval === 'candidate' || context.source.approval === 'catalog_approved') {
    reasons.push('source is UCP-capability driven; live checkout operations must still use the negotiated merchant response as authority')
  }
  if (context.source.health === 'degraded') {
    reasons.push('source is degraded; only recoverable handoff/status actions may proceed')
  }
  if (context.incident.state === 'degraded') {
    reasons.push('incident state is degraded; high-risk actions should prefer handoff or block')
  }

  return { missing, reasons }
}

const hasScope = (context: ProductionCapabilityContext, scope: AgentActionScope) =>
  context.integration.allowedActionScopes.includes(scope)

const disabledByIncident = (context: ProductionCapabilityContext, scope: AgentActionScope) =>
  context.incident.disabledActionScopes.includes(scope)

const decisionForRead = (
  context: ProductionCapabilityContext,
  toolName: McpToolName,
  scope: AgentActionScope
): ProductionCapabilityToolDecision => {
  const missing: string[] = []
  const reasons: string[] = []

  if (disabledByIncident(context, scope)) missing.push('action scope not disabled by incident')
  if (!hasScope(context, scope)) missing.push(`integration action scope ${scope}`)
  if (toolName !== 'agent_diagnostics' && !sourceCanRead(context)) {
    missing.push('catalog-approved current source evidence')
  }
  if (context.risk.decision === 'block') missing.push('risk state not blocked')
  if (context.productPolicy.decision === 'blocked') missing.push('product policy not blocked')
  if (context.incident.state === 'kill_switch') missing.push('no global kill switch')

  const executionAllowed = missing.length === 0

  return {
    name: toolName,
    actionScope: scope,
    lane: toolLanes[toolName],
    decision: executionAllowed ? 'available' : 'limited',
    executionAllowed,
    reasons: executionAllowed
      ? ['read-first source-governed commerce preflight is available']
      : reasons,
    missing
  }
}

const decisionForLane1 = (
  context: ProductionCapabilityContext,
  toolName: McpToolName,
  scope: AgentActionScope
): ProductionCapabilityToolDecision => {
  const gate = baseExecutionGates(context)
  const missing = [...gate.missing]

  if (disabledByIncident(context, scope)) missing.push('action scope not disabled by incident')
  if (!hasScope(context, scope)) missing.push(`integration action scope ${scope}`)
  if (!context.source.capabilities.cart && !context.source.capabilities.checkoutHandoff) {
    missing.push('cart or checkout handoff source capability')
  }
  if (context.payment.merchantHosted !== 'supported') missing.push('merchant-hosted payment boundary')

  const executionAllowed = missing.length === 0

  return {
    name: toolName,
    actionScope: scope,
    lane: toolLanes[toolName],
    decision: executionAllowed ? 'available' : 'blocked',
    executionAllowed,
    reasons: executionAllowed
      ? ['Lane 1 merchant-hosted handoff is available; payment remains on the merchant/provider surface']
      : gate.reasons,
    missing
  }
}

const productionGradePaymentProof = (context: ProductionCapabilityContext) =>
  context.payment.proof === 'provider_signed' ||
  context.payment.proof === 'provider_reference' ||
  context.payment.proof === 'tokenized_instrument'

const decisionForLane2 = (
  context: ProductionCapabilityContext,
  toolName: McpToolName,
  scope: AgentActionScope
): ProductionCapabilityToolDecision => {
  const gate = baseExecutionGates(context)
  const missing = [...gate.missing]

  if (disabledByIncident(context, scope)) missing.push('action scope not disabled by incident')
  if (!hasScope(context, scope)) missing.push(`integration action scope ${scope}`)
  if (!context.source.capabilities.directCheckout) missing.push('direct checkout source capability')
  if (context.payment.directProvider !== 'active') missing.push('active direct payment provider')
  if (!productionGradePaymentProof(context)) missing.push('provider-grade tokenized payment evidence')

  const executionAllowed = missing.length === 0

  return {
    name: toolName,
    actionScope: scope,
    lane: toolLanes[toolName],
    decision: executionAllowed ? 'available' : 'hidden',
    executionAllowed,
    reasons: executionAllowed
      ? ['Lane 2 direct checkout completion is available for this exact production context']
      : gate.reasons,
    missing
  }
}

export const resolveProductionCapabilities = (
  context: ProductionCapabilityContext
): ProductionCapabilityResolution => {
  const tools = orderedTools.map((toolName) => {
    const scope = productionCapabilityToolScopes[toolName]
    if (scope.startsWith('read:')) return decisionForRead(context, toolName, scope)
    if (toolLanes[toolName] === 'lane_2_direct_completion') {
      return decisionForLane2(context, toolName, scope)
    }
    return decisionForLane1(context, toolName, scope)
  })

  const allowedActionScopes = [
    ...new Set(
      tools
        .filter((tool) => tool.executionAllowed)
        .map((tool) => tool.actionScope)
    )
  ]

  return {
    launchMode: context.environment === 'production' ? 'production' : 'public_preview',
    allowedActionScopes,
    tools,
    summary: {
      lane0AdvisoryAvailable: tools.some((tool) => tool.lane === 'lane_0_advisory' && tool.executionAllowed),
      lane1MerchantHandoffAvailable: tools.some((tool) => tool.lane === 'lane_1_merchant_handoff' && tool.executionAllowed),
      lane2DirectCompletionAvailable: tools.some((tool) => tool.lane === 'lane_2_direct_completion' && tool.executionAllowed)
    }
  }
}
