import { describe, expect, it, vi } from 'vitest'
import type { QueryResult, QueryResultRow } from 'pg'
import type {
  CatalogProductDetailRequest,
  CatalogProductDetailResponse,
  PlainStatusMessage
} from '@arro/contracts'
import type { CatalogSearchSourcePolicy } from '@arro/connectors'
import {
  insertProductDetailAuditLog,
  productDetailCommercialIsolationVersion,
  productDetailRefStorageMode
} from './product-detail-audit.ts'
import type { Queryable } from './target-business-repository.ts'

const queryable = () => ({
  query: vi.fn(async <Row extends QueryResultRow>() => ({
    command: 'INSERT',
    fields: [],
    oid: 0,
    rowCount: 1,
    rows: []
  }) satisfies QueryResult<Row>)
}) satisfies Queryable

const policyMessage: PlainStatusMessage = {
  severity: 'info',
  code: 'connected_catalog_sources',
  text: 'Results are constrained to configured official catalog connectors.',
  nextAction: 'Connect approved UCP or official catalog sources before showing live results.'
}

const sourcePolicy: CatalogSearchSourcePolicy = {
  sourceMode: 'connected_sources',
  allowedBusinessIds: ['connected-shopify-storefront'],
  message: policyMessage
}

const request: CatalogProductDetailRequest = {
  businessId: 'connected-shopify-storefront',
  productId: 'gid://shopify/p/private-product-ref',
  variantId: 'gid://shopify/ProductVariant/private-variant-ref',
  agentContext: {
    integrationId: 'test-integration',
    surface: 'direct_http',
    requestedActionScope: 'read:product_detail',
    externalSubjectRef: 'raw-subject-ref-must-not-persist',
    externalTaskRef: 'raw-task-ref-must-not-persist'
  }
}

const response: CatalogProductDetailResponse = {
  requestId: 'product-detail-audit-request',
  correlationId: 'product-detail-audit-correlation',
  sourceMode: 'connected_sources',
  state: 'ready',
  product: {
    productId: request.productId,
    variantId: request.variantId,
    businessId: request.businessId,
    businessName: 'Connected Shopify Storefront',
    title: 'Connector-backed product detail',
    categoryPath: ['Catalog'],
    availability: 'in_stock',
    condition: 'new',
    media: [
      {
        type: 'image',
        url: 'https://connected-shop.myshopify.com/product.jpg'
      }
    ],
    options: [],
    selected: [],
    variants: [
      {
        variantId: request.variantId!,
        availability: 'in_stock'
      }
    ],
    warnings: [],
    sourceLabel: {
      sourceId: request.businessId,
      sourceName: 'Connected Shopify Storefront',
      factType: 'connected_catalog_product_detail',
      fetchedAt: '2026-05-31T00:00:00.000Z',
      expiresAt: '2026-05-31T00:15:00.000Z',
      freshnessClass: 'advisory_catalog',
      bindingStatus: 'advisory'
    }
  },
  messages: [policyMessage],
  actionPolicy: {
    state: 'read',
    allowedNextActions: [
      {
        action: 'prepare_purchase',
        label: 'Prepare purchase only if source capability allows it',
        authority: 'requires_source_capability',
        reason: 'Verifier detail only.'
      }
    ]
  },
  fetchedAt: '2026-05-31T00:00:00.000Z'
}

describe('product detail audit', () => {
  it('inserts hashed product references and bounded commercial-isolation fields', async () => {
    const client = queryable()

    await insertProductDetailAuditLog(client, {
      requestId: 'product-detail-audit-request',
      correlationId: 'product-detail-audit-correlation',
      route: '/v1/catalog/product',
      request,
      sourcePolicy,
      response,
      latencyMs: 19.8,
      metadata: {
        verifier: 'product-detail-audit-test',
        secretToken: 'must-not-be-stored',
        productTitle: 'must-not-be-stored'
      }
    })

    expect(client.query).toHaveBeenCalledTimes(1)
    const [sql, values] = client.query.mock.calls[0]!

    expect(sql).toContain('insert into product_detail_audit_logs')
    expect(sql).toContain('payout_fields_accessed')
    expect(values?.[0]).toBe('product-detail-audit-request')
    expect(values?.[2]).toBe('/v1/catalog/product')
    expect(values?.[3]).toBe('connected-shopify-storefront')
    expect(values?.[4]).toMatch(/^[a-f0-9]{64}$/)
    expect(values?.[5]).toMatch(/^[a-f0-9]{64}$/)
    expect(values?.[6]).toBe(productDetailRefStorageMode)
    expect(values?.[7]).toBe('connected_sources')
    expect(values?.[8]).toBe('ready')
    expect(values?.[9]).toEqual(['connected-shopify-storefront'])
    expect(values?.[10]).toBe(true)
    expect(values?.[11]).toBe('connected_catalog_product_detail')
    expect(values?.[12]).toBe(1)
    expect(values?.[13]).toBe(1)
    expect(values?.[14]).toBe('connected_catalog_sources')
    expect(values?.[15]).toBe(productDetailCommercialIsolationVersion)
    expect(values?.[16]).toBe(19)
    expect(values?.[17]).toEqual({
      verifier: 'product-detail-audit-test',
      productRefStorage: productDetailRefStorageMode
    })
    expect(JSON.stringify(values)).not.toContain('gid://shopify')
    expect(JSON.stringify(values)).not.toContain('must-not-be-stored')
    expect(JSON.stringify(values)).not.toContain('raw-subject-ref-must-not-persist')
    expect(JSON.stringify(values)).not.toContain('raw-task-ref-must-not-persist')
  })
})
