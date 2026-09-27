import { describe, expect, it } from 'vitest'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  CatalogProductCompareResponseSchema,
  type CatalogProductSearchInput
} from '@arro/contracts'
import { compareProducts } from './compare.ts'

const responseValidator = TypeCompiler.Compile(CatalogProductCompareResponseSchema)
const now = new Date('2026-06-24T00:00:00.000Z')

const product = ({
  productId,
  title,
  price,
  sourceLabelOverrides = {}
}: {
  productId: string
  title: string
  price: number
  sourceLabelOverrides?: Partial<CatalogProductSearchInput['sourceLabel']>
}): CatalogProductSearchInput => ({
  productId,
  businessId: 'runner-shop',
  businessName: 'Runner Shop',
  title,
  brand: 'Runner Shop',
  description: 'A source-backed running shoe option.',
  categoryPath: ['Footwear', 'Running Shoes'],
  price: { amountMinor: price * 100, currency: 'USD' },
  availability: 'in_stock',
  condition: 'new',
  productUrl: `https://runner-shop.example.com/products/${productId}`,
  seller: {
    name: 'Runner Shop',
    domain: 'runner-shop.example.com',
    url: 'https://runner-shop.example.com'
  },
  handoff: {
    type: 'product',
    url: `https://runner-shop.example.com/products/${productId}`
  },
  tags: ['running', 'trainer'],
  sourceLabel: {
    sourceId: 'runner-shop',
    sourceName: 'Runner Shop',
    factType: 'connected_catalog_product',
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    freshnessClass: 'advisory_catalog',
    bindingStatus: 'advisory',
    ...sourceLabelOverrides
  }
})

describe('product comparison analysis', () => {
  it('compares source-labeled products as advisory evidence without checkout authority', () => {
    const response = compareProducts(
      {
        intentSummary: 'Compare two daily trainers.',
        sourceMode: 'connected_sources',
        products: [
          product({
            productId: 'shoe-1',
            title: 'Runner Shop Blue Daily Trainer',
            price: 120
          }),
          product({
            productId: 'shoe-2',
            title: 'Runner Shop Green Daily Trainer',
            price: 110
          })
        ]
      },
      {
        requestId: 'compare-ready-request',
        correlationId: 'compare-ready-correlation',
        now
      }
    )

    expect(responseValidator.Check(response)).toBe(true)
    expect(response.state).toBe('ready')
    expect(response.sourceMode).toBe('connected_sources')
    expect(response.evidence).toMatchObject({
      productCount: 2,
      sourceLabelCount: 2,
      staleSourceLabelCount: 0,
      hasIntentSummary: true
    })
    expect(response.assessments[0]).toMatchObject({
      productId: 'shoe-2',
      comparisonState: 'stronger'
    })
    expect(response.findings.map((finding) => finding.code)).toContain('comparison_ready')
    expect(response.actionPolicy.state).toBe('compare')
    expect(response.actionPolicy.allowedNextActions.map((action) => action.action)).toEqual([
      'get_product_detail',
      'prepare_purchase'
    ])
    expect(JSON.stringify(response)).not.toContain('Compare two daily trainers')
    expect(JSON.stringify(response)).not.toContain('complete_checkout')
  })

  it('keeps comparison limited when source labels are stale or product facts are incomplete', () => {
    const { price: _price, ...productWithoutPrice } = product({
      productId: 'shoe-missing-price',
      title: 'Runner Shop Missing Price Trainer',
      price: 105
    })

    const response = compareProducts(
      {
        products: [
          product({
            productId: 'shoe-stale',
            title: 'Runner Shop Stale Trainer',
            price: 100,
            sourceLabelOverrides: {
              bindingStatus: 'stale',
              expiresAt: new Date(now.getTime() - 1000).toISOString()
            }
          }),
          productWithoutPrice
        ]
      },
      {
        requestId: 'compare-limited-request',
        correlationId: 'compare-limited-correlation',
        now
      }
    )

    expect(responseValidator.Check(response)).toBe(true)
    expect(response.state).toBe('needs_review')
    expect(response.evidence.staleSourceLabelCount).toBe(1)
    expect(response.findings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining([
        'comparison_stale_source_label',
        'comparison_missing_price'
      ])
    )
    expect(response.actionPolicy.state).toBe('limited')
  })
})
