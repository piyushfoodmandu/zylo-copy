import { describe, expect, it } from 'vitest'
import {
  resolveProductionCapabilities,
  type ProductionCapabilityContext
} from './production-capability-resolver.ts'

const baseContext = (): ProductionCapabilityContext => ({
  environment: 'production',
  integration: {
    authenticated: true,
    allowedActionScopes: [
      'read:search',
      'read:product_detail',
      'read:compare',
      'read:source_state',
      'read:sanity_check',
      'write:purchase',
      'write:complete_purchase',
      'read:purchase'
    ]
  },
  session: {
    signed: true,
    subjectBound: true,
    taskBound: true,
    explicitUserConfirmation: true,
    scopedHandoffAvailable: true
  },
  user: {
    eligibility: 'eligible',
    jurisdiction: 'supported'
  },
  source: {
    approval: 'transaction_approved',
    health: 'healthy',
    evidence: 'current',
    capabilities: {
      catalog: true,
      cart: true,
      checkoutHandoff: true,
      directCheckout: true,
      orderStatus: true,
      refundCancellation: true
    },
    merchantContract: 'active'
  },
  payment: {
    merchantHosted: 'supported',
    directProvider: 'active',
    proof: 'provider_signed'
  },
  risk: {
    decision: 'allow',
    reasonCodes: []
  },
  productPolicy: {
    decision: 'allowed',
    reasonCodes: []
  },
  incident: {
    state: 'normal',
    disabledActionScopes: []
  }
})

const tool = (
  context: ProductionCapabilityContext,
  name: string
) => resolveProductionCapabilities(context).tools.find((entry) => entry.name === name)

describe('resolveProductionCapabilities', () => {
  it('keeps public advisory reads available while blocking transaction tools without signed authority', () => {
    const context = baseContext()
    context.integration.authenticated = false
    context.integration.allowedActionScopes = [
      'read:search',
      'read:product_detail',
      'read:compare',
      'read:source_state',
      'read:sanity_check'
    ]
    context.session.signed = false
    context.session.subjectBound = false
    context.session.taskBound = false
    context.session.explicitUserConfirmation = false

    const resolution = resolveProductionCapabilities(context)

    expect(tool(context, 'search_products')).toMatchObject({
      decision: 'available',
      executionAllowed: true
    })
    expect(tool(context, 'prepare_purchase')).toMatchObject({
      decision: 'blocked',
      executionAllowed: false
    })
    expect(tool(context, 'confirm_purchase')).toMatchObject({
      decision: 'hidden',
      executionAllowed: false
    })
    expect(tool(context, 'prepare_payment')).toMatchObject({
      decision: 'hidden',
      executionAllowed: false
    })
    expect(resolution.summary).toMatchObject({
      lane0AdvisoryAvailable: true,
      lane1MerchantHandoffAvailable: false,
      lane2DirectCompletionAvailable: false
    })
  })

  it('opens Lane 1 merchant-hosted handoff when negotiated UCP source evidence and merchant payment boundary pass', () => {
    const context = baseContext()
    context.source.capabilities.directCheckout = false
    context.payment.directProvider = 'missing'
    context.payment.proof = 'none'

    const resolution = resolveProductionCapabilities(context)

    expect(tool(context, 'prepare_purchase')).toMatchObject({
      decision: 'available',
      executionAllowed: true
    })
    expect(tool(context, 'confirm_purchase')).toMatchObject({
      decision: 'hidden',
      executionAllowed: false
    })
    expect(resolution.summary).toMatchObject({
      lane1MerchantHandoffAvailable: true,
      lane2DirectCompletionAvailable: false
    })
  })

  it('does not add merchant-contract or jurisdiction blockers on top of a valid UCP handoff', () => {
    const context = baseContext()
    context.source.approval = 'catalog_approved'
    context.source.merchantContract = 'missing'
    context.user.jurisdiction = 'unknown'

    const preparePurchase = tool(context, 'prepare_purchase')

    expect(preparePurchase).toMatchObject({
      decision: 'available',
      executionAllowed: true
    })
    expect(preparePurchase?.missing).not.toContain('transaction-approved source')
    expect(preparePurchase?.missing).not.toContain('active merchant contract')
    expect(preparePurchase?.missing).not.toContain('supported user jurisdiction')
  })

  it('still blocks transaction tools for suspended sources or explicit product/risk blocks', () => {
    const context = baseContext()
    context.source.approval = 'suspended'
    context.risk.decision = 'block'
    context.productPolicy.decision = 'blocked'

    const preparePurchase = tool(context, 'prepare_purchase')

    expect(preparePurchase).toMatchObject({
      decision: 'blocked',
      executionAllowed: false
    })
    expect(preparePurchase?.missing).toEqual(expect.arrayContaining([
      'source not suspended, revoked, or expired',
      'risk state not blocked',
      'product policy not blocked'
    ]))
  })

  it('allows Lane 2 only with active direct provider and tokenized payment evidence', () => {
    const context = baseContext()

    expect(tool(context, 'confirm_purchase')).toMatchObject({
      decision: 'available',
      executionAllowed: true
    })

    context.payment.proof = 'none'
    const missingPaymentCheckout = tool(context, 'confirm_purchase')

    expect(missingPaymentCheckout).toMatchObject({
      decision: 'hidden',
      executionAllowed: false
    })
    expect(missingPaymentCheckout?.missing).toEqual(expect.arrayContaining([
      'provider-grade tokenized payment evidence'
    ]))
  })

  it('honors incident kill switches and scoped action disables', () => {
    const context = baseContext()
    context.incident.disabledActionScopes = ['write:purchase']

    expect(tool(context, 'prepare_purchase')).toMatchObject({
      executionAllowed: false
    })

    context.incident.state = 'kill_switch'

    expect(tool(context, 'search_products')).toMatchObject({
      executionAllowed: false
    })
    expect(tool(context, 'confirm_purchase')).toMatchObject({
      executionAllowed: false
    })
  })
})
