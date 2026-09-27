import { describe, expect, it } from 'vitest'
import type { CatalogProductDetail } from '@arro/contracts'
import { assessProductDetailQuality } from './product-detail-quality.ts'

const sourceLabel = {
  sourceId: 'connected-source',
  sourceName: 'Connected Source',
  factType: 'connected_catalog_product_detail',
  fetchedAt: '2026-06-03T00:00:00.000Z',
  expiresAt: '2026-06-03T00:15:00.000Z',
  freshnessClass: 'advisory_catalog' as const,
  bindingStatus: 'advisory' as const
}

const productDetail: CatalogProductDetail = {
  productId: 'source-product-1',
  businessId: 'connected-source',
  businessName: 'Connected Source',
  title: 'Source Confirmed Running Shoe',
  brand: 'Run Lab',
  description: 'Source-confirmed product detail.',
  categoryPath: ['Footwear', 'Running Shoes'],
  variantId: 'source-product-1-size-10',
  price: { amountMinor: 128, currency: 'USD' },
  availability: 'in_stock',
  condition: 'new',
  productUrl: 'https://shop.example.com/products/source-product-1',
  seller: {
    name: 'Shop Example',
    domain: 'shop.example.com',
    url: 'https://shop.example.com'
  },
  handoff: {
    type: 'product',
    url: 'https://shop.example.com/products/source-product-1'
  },
  media: [
    {
      type: 'image',
      url: 'https://shop.example.com/images/source-product-1.jpg'
    }
  ],
  options: [
    {
      name: 'Size',
      values: [{ label: '10' }]
    }
  ],
  selected: [{ name: 'Size', label: '10' }],
  variants: [
    {
      variantId: 'source-product-1-size-10',
      title: 'Size 10',
      selectedOptions: [{ name: 'Size', label: '10' }],
      price: { amountMinor: 128, currency: 'USD' },
      availability: 'in_stock',
      productUrl: 'https://shop.example.com/products/source-product-1?variant=10'
    }
  ],
  warnings: [],
  sourceLabel
}

describe('product detail quality assessment', () => {
  it('marks source-confirmed variant detail as transaction-ready', () => {
    const assessment = assessProductDetailQuality(productDetail)

    expect(assessment).toMatchObject({
      state: 'ready',
      purchaseReady: true,
      variantResolvable: true,
      checks: {
        hasCurrentPrice: true,
        hasConcreteAvailability: true,
        hasMedia: true,
        hasSafeHandoff: true,
        hasResolvableVariant: true,
        selectedVariantAvailable: true
      },
      messages: []
    })
  })

  it('requires a shopper-confirmed selection for configurable products', () => {
    const configurable: CatalogProductDetail = {
      ...productDetail,
      options: [{
        name: 'Size',
        values: [{ label: '10' }, { label: '11' }]
      }],
      selected: [{ name: 'Size', label: '10' }],
      variants: [
        productDetail.variants[0]!,
        {
          ...productDetail.variants[0]!,
          variantId: 'source-product-1-size-11',
          title: 'Size 11',
          selectedOptions: [{ name: 'Size', label: '11' }]
        }
      ]
    }

    expect(assessProductDetailQuality(configurable).purchaseReady).toBe(false)
    expect(assessProductDetailQuality(configurable).messages.map((message) => message.code)).toContain('product_variant_ambiguous')

    const confirmed = assessProductDetailQuality(configurable, {
      requestedSelected: [{ name: 'Size', label: '10' }]
    })
    expect(confirmed.purchaseReady).toBe(true)
    expect(confirmed.variantResolvable).toBe(true)
  })

  it('settles an axis whose alternatives the source will not sell', () => {
    const configurable: CatalogProductDetail = {
      ...productDetail,
      options: [{
        name: 'Storage',
        values: [
          { label: '256 gb', available: true, exists: true },
          { label: '512 gb', available: false, exists: false }
        ]
      }],
      selected: [{ name: 'Storage', label: '256 gb' }]
    }

    expect(assessProductDetailQuality(configurable).purchaseReady).toBe(true)
  })

  it('does not let a carried source default stand in for a shopper decision', () => {
    // Picking a colour can make a second storage size purchasable. The storage
    // value was only carried forward to keep the configuration exact, so the
    // axis becomes a real choice again rather than staying settled.
    const configurable: CatalogProductDetail = {
      ...productDetail,
      options: [{
        name: 'Storage',
        values: [
          { label: '256 gb', available: true, exists: true },
          { label: '512 gb', available: true, exists: true }
        ]
      }],
      selected: [{ name: 'Storage', label: '256 gb' }]
    }

    const carried = assessProductDetailQuality(configurable, {
      requestedSelected: [{ name: 'Storage', label: '256 gb', chosen: false }]
    })
    expect(carried.purchaseReady).toBe(false)

    const chosen = assessProductDetailQuality(configurable, {
      requestedSelected: [{ name: 'Storage', label: '256 gb' }]
    })
    expect(chosen.purchaseReady).toBe(true)
  })

  it('does not treat a UCP-relaxed selection as shopper-confirmed', () => {
    const configurable: CatalogProductDetail = {
      ...productDetail,
      options: [{
        name: 'Size',
        values: [{ label: '10' }, { label: '11' }]
      }],
      selected: [{ name: 'Size', label: '10' }]
    }

    const assessment = assessProductDetailQuality(configurable, {
      requestedSelected: [{ name: 'Size', label: '11' }]
    })

    expect(assessment.purchaseReady).toBe(false)
    expect(assessment.variantResolvable).toBe(false)
  })

  it('keeps products usable but limited when rich media is missing', () => {
    const assessment = assessProductDetailQuality({
      ...productDetail,
      media: []
    })

    expect(assessment.state).toBe('limited')
    expect(assessment.purchaseReady).toBe(true)
    expect(assessment.messages.map((message) => message.code)).toEqual(['product_media_missing'])
  })

  it('blocks transaction preparation when variant and handoff evidence are ambiguous', () => {
    const assessment = assessProductDetailQuality({
      ...productDetail,
      variantId: undefined,
      price: undefined,
      availability: 'unknown',
      productUrl: undefined,
      handoff: undefined,
      seller: undefined,
      variants: [
        {
          variantId: 'source-product-1-opaque-a',
          selectedOptions: [],
          availability: 'unknown'
        },
        {
          variantId: 'source-product-1-opaque-b',
          selectedOptions: [],
          availability: 'unknown'
        }
      ]
    })

    expect(assessment.state).toBe('blocked')
    expect(assessment.purchaseReady).toBe(false)
    expect(assessment.variantResolvable).toBe(false)
    expect(assessment.messages.map((message) => message.code)).toEqual(expect.arrayContaining([
      'product_price_missing',
      'product_availability_unknown',
      'product_handoff_missing',
      'product_variant_ambiguous',
      'product_variant_unavailable'
    ]))
    expect(JSON.stringify(assessment)).not.toMatch(/commission|payout|affiliate|settlement|margin/i)
  })
})