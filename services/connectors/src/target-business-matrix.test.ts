import { describe, expect, it } from 'vitest'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { TargetBusinessMatrixResponseSchema } from '@arro/contracts'
import {
  buildCartPrepareSourcePolicy,
  buildCatalogSearchSourcePolicy,
  buildTargetBusinessMatrix,
  cartPrepareVisibleRecords,
  catalogVisibleRecords,
  launchVisibleRecords
} from './target-business-matrix.ts'

const matrixValidator = TypeCompiler.Compile(TargetBusinessMatrixResponseSchema)
const now = new Date('2026-05-30T12:00:00.000Z')
const approvedCatalogRecord = {
  businessId: 'approved-catalog-source',
  domain: 'approved.example.com',
  displayName: 'Approved Catalog Source',
  sourceType: 'direct_ucp' as const,
  launchStatus: 'launch_visible' as const,
  featureVisibility: 'catalog_visible' as const,
  accessPolicyState: 'approved' as const,
  profileHash: 'sha256:approved-profile',
  capabilities: [
    {
      capability: 'dev.ucp.shopping.catalog.search',
      status: 'approved' as const,
      source: 'arro_conformance'
    }
  ],
  evidence: [
    {
      kind: 'arro_conformance' as const,
      source: 'target_business_conformance_runs:77; request:approved',
      observedAt: '2026-05-30T00:00:00.000Z',
      expiresAt: '2026-06-01T00:00:00.000Z',
      summary: 'Conformance passed for profile sha256:approved-profile with 8 passing checks.'
    }
  ],
  userFacingStatus: {
    label: 'Admin review recorded',
    reason: 'Source authority remains limited until conformance and explicit approval are complete.',
    nextAction: 'Keep discovery, conformance, and policy evidence current before launch exposure.'
  }
}

const approvedCartPrepareRecord = {
  ...approvedCatalogRecord,
  businessId: 'approved-cart-prepare-source',
  displayName: 'Approved Cart Prepare Source',
  featureVisibility: 'checkout_visible' as const,
  capabilities: [
    {
      capability: 'dev.ucp.shopping.catalog.search',
      status: 'approved' as const,
      source: 'arro_conformance'
    },
    {
      capability: 'dev.ucp.shopping.checkout',
      status: 'approved' as const,
      source: 'arro_conformance'
    }
  ]
}

describe('target business matrix', () => {
  it('returns schema-valid launch candidate records', () => {
    const matrix = buildTargetBusinessMatrix({
      requestId: 'req-matrix',
      correlationId: 'corr-matrix',
      now
    })

    expect(matrixValidator.Check(matrix)).toBe(true)
    expect(matrix.requestId).toBe('req-matrix')
    expect(matrix.generatedAt).toBe(now.toISOString())
    expect(matrix.records.length).toBeGreaterThanOrEqual(3)
  })

  it('keeps candidate, managed-channel, and unsupported authority separate', () => {
    const matrix = buildTargetBusinessMatrix({
      requestId: 'req-matrix',
      correlationId: 'corr-matrix',
      now
    })

    const allbirdsRecord = matrix.records.find((record) => record.businessId === 'allbirds-public-ucp-candidate')
    const shopifyRecord = matrix.records.find((record) => record.businessId === 'shopify-global-catalog-candidate')
    const unsupportedRecord = matrix.records.find((record) => record.businessId === 'major-retail-unsupported-snapshot')

    expect(allbirdsRecord?.sourceType).toBe('direct_ucp')
    expect(allbirdsRecord?.accessPolicyState).toBe('profile_fetched')
    expect(allbirdsRecord?.featureVisibility).toBe('hidden')
    expect(shopifyRecord?.sourceType).toBe('managed_channel')
    expect(shopifyRecord?.accessPolicyState).toBe('partner_required')
    expect(unsupportedRecord?.sourceType).toBe('unsupported')
    expect(unsupportedRecord?.featureVisibility).toBe('hidden')
  })

  it('does not expose launch-visible businesses until approval gates pass', () => {
    expect(launchVisibleRecords()).toEqual([])
    expect(catalogVisibleRecords()).toEqual([])
  })

  it('returns an unconfigured policy when no approved or connected sources exist', () => {
    const policy = buildCatalogSearchSourcePolicy({})

    expect(policy.sourceMode).toBe('unconfigured')
    expect(policy.allowedBusinessIds).toEqual([])
    expect(policy.message.code).toBe('connectors_not_configured')
  })

  it('allows configured official connectors without internal catalog approval', () => {
    const policy = buildCatalogSearchSourcePolicy({
      connectedSources: [
        {
          businessId: 'connected-shopify-storefront',
          domain: 'merchant.myshopify.com',
          displayName: 'Connected Shopify Storefront',
          sourceType: 'direct_ucp'
        }
      ]
    })

    expect(policy.sourceMode).toBe('connected_sources')
    expect(policy.allowedBusinessIds).toEqual(['connected-shopify-storefront'])
    expect(policy.message.code).toBe('connected_catalog_sources')
  })

  it('prefers configured official connectors over unconfigured state', () => {
    const policy = buildCatalogSearchSourcePolicy({
      connectedSources: [
        {
          businessId: 'connected-shopify-storefront',
          domain: 'merchant.myshopify.com',
          displayName: 'Connected Shopify Storefront',
          sourceType: 'direct_ucp'
        }
      ]
    })

    expect(policy.sourceMode).toBe('connected_sources')
    expect(policy.allowedBusinessIds).toEqual(['connected-shopify-storefront'])
  })

  it('allows approved catalog sources only with current conformance evidence', () => {
    const policy = buildCatalogSearchSourcePolicy({
      records: [approvedCatalogRecord],
      now
    })

    expect(policy.sourceMode).toBe('approved_sources')
    expect(policy.allowedBusinessIds).toEqual(['approved-catalog-source'])
    expect(policy.message.code).toBe('approved_catalog_sources')
    expect(catalogVisibleRecords([approvedCatalogRecord], now)).toHaveLength(1)
  })

  it('rejects approved-looking catalog sources when conformance evidence is expired', () => {
    const expiredRecord = {
      ...approvedCatalogRecord,
      evidence: [
        {
          ...approvedCatalogRecord.evidence[0]!,
          expiresAt: '2026-05-29T00:00:00.000Z'
        }
      ]
    }
    const policy = buildCatalogSearchSourcePolicy({
      records: [expiredRecord],
      now
    })

    expect(policy.sourceMode).toBe('unconfigured')
    expect(policy.allowedBusinessIds).toEqual([])
    expect(catalogVisibleRecords([expiredRecord], now)).toEqual([])
  })

  it('returns an unconfigured cart-prepare policy without explicit transaction authority', () => {
    const policy = buildCartPrepareSourcePolicy({
      records: [approvedCatalogRecord],
      now
    })

    expect(policy.sourceMode).toBe('unconfigured')
    expect(policy.allowedBusinessIds).toEqual([])
    expect(policy.message.code).toBe('cart_prepare_sources_not_configured')
    expect(cartPrepareVisibleRecords([approvedCatalogRecord], now)).toEqual([])
  })

  it('allows configured cart-prepare connectors without treating them as catalog policy', () => {
    const policy = buildCartPrepareSourcePolicy({
      connectedSources: [
        {
          businessId: 'connected-checkout-source',
          domain: 'merchant.example.com',
          displayName: 'Connected Checkout Source',
          sourceType: 'direct_ucp'
        }
      ],
      now
    })

    expect(policy.sourceMode).toBe('connected_sources')
    expect(policy.allowedBusinessIds).toEqual(['connected-checkout-source'])
    expect(policy.message.code).toBe('connected_cart_prepare_sources')
  })

  it('allows approved cart-prepare sources only with checkout-visible transaction capability', () => {
    const policy = buildCartPrepareSourcePolicy({
      records: [approvedCartPrepareRecord],
      now
    })

    expect(policy.sourceMode).toBe('approved_sources')
    expect(policy.allowedBusinessIds).toEqual(['approved-cart-prepare-source'])
    expect(policy.message.code).toBe('approved_cart_prepare_sources')
    expect(cartPrepareVisibleRecords([approvedCartPrepareRecord], now)).toHaveLength(1)
  })
})
