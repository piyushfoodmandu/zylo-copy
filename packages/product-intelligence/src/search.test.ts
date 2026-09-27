import { describe, expect, it } from 'vitest'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  CatalogSearchResponseSchema,
  type CatalogProductSearchInput,
  type PlainStatusMessage
} from '@arro/contracts'
import { catalogSearchRequestForConnector, searchCatalog } from './search.ts'

const searchValidator = TypeCompiler.Compile(CatalogSearchResponseSchema)
const now = new Date('2026-05-30T12:00:00.000Z')

const unconfiguredMessage: PlainStatusMessage = {
  severity: 'info',
  code: 'connectors_not_configured',
  text: 'Product search is not connected to approved catalog sources or official connectors yet.',
  nextAction: 'Connect approved UCP or official catalog sources before showing live results.'
}

const approvedMessage: PlainStatusMessage = {
  severity: 'info',
  code: 'approved_catalog_sources',
  text: 'Results are constrained to approved launch-visible catalog sources.',
  nextAction: 'Keep source evidence, freshness, and approval state current before expanding coverage.'
}

const connectedMessage: PlainStatusMessage = {
  severity: 'info',
  code: 'connected_catalog_sources',
  text: 'Results are constrained to configured official catalog connectors.',
  nextAction: 'Keep connector credentials, protocol compatibility, and response validation healthy before expanding traffic.'
}

const approvedProducts: CatalogProductSearchInput[] = [
  {
    productId: 'approved-running-shoe-neutral',
    variantId: 'approved-running-shoe-neutral-10',
    businessId: 'approved-catalog-source',
    businessName: 'Approved Catalog Source',
    title: 'Approved Neutral Daily Running Shoe',
    brand: 'Approved Run Lab',
    description: 'Neutral road running shoe from an approved source.',
    categoryPath: ['Footwear', 'Running Shoes'],
    price: { amountMinor: 118, currency: 'USD' },
    availability: 'in_stock',
    condition: 'new',
    productUrl: 'https://approved.example.com/products/running-shoe-neutral',
    tags: ['running', 'shoe', 'trainer'],
    sourceLabel: {
      sourceId: 'approved-catalog-source',
      sourceName: 'Approved Catalog Source',
      factType: 'approved_catalog_product',
      fetchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      freshnessClass: 'advisory_catalog',
      bindingStatus: 'advisory'
    }
  },
  {
    productId: 'blocked-running-shoe-neutral',
    businessId: 'blocked-source',
    businessName: 'Blocked Source',
    title: 'Blocked Neutral Daily Running Shoe',
    brand: 'Blocked Run Lab',
    description: 'Matching product from a disallowed source.',
    categoryPath: ['Footwear', 'Running Shoes'],
    price: { amountMinor: 1, currency: 'USD' },
    availability: 'in_stock',
    condition: 'new',
    productUrl: 'https://blocked.example.com/products/running-shoe-neutral',
    tags: ['running', 'shoe', 'trainer'],
    sourceLabel: {
      sourceId: 'blocked-source',
      sourceName: 'Blocked Source',
      factType: 'approved_catalog_product',
      fetchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
      freshnessClass: 'advisory_catalog',
      bindingStatus: 'advisory'
    }
  }
]

describe('catalog search source policy enforcement', () => {
  it('does not return other brands when the query detects a brand', () => {
    const response = searchCatalog(
      { query: 'running shoe' },
      {
        requestId: 'req-search',
        correlationId: 'corr-search',
        now,
        sourcePolicy: {
          sourceMode: 'approved_sources',
          allowedBusinessIds: ['approved-catalog-source'],
          message: approvedMessage
        },
        products: approvedProducts
      }
    )

    expect(searchValidator.Check(response)).toBe(true)
    expect(response.interpretedQuery.detectedCategories).toEqual(expect.arrayContaining(['Running Shoes']))
    expect(response.items.length).toBeGreaterThan(0)
    expect(response.items.every((item) => item.brand === 'Approved Run Lab')).toBe(true)
  })

  it('does not leak disallowed matching products', () => {
    const response = searchCatalog(
      { query: 'running shoe' },
      {
        requestId: 'req-search',
        correlationId: 'corr-search',
        now,
        sourcePolicy: {
          sourceMode: 'approved_sources',
          allowedBusinessIds: ['blocked-source'],
          message: approvedMessage
        },
        products: approvedProducts
      }
    )

    expect(searchValidator.Check(response)).toBe(true)
    expect(response.items.length).toBeGreaterThan(0)
    expect(response.items.every((item) => item.businessId === 'blocked-source')).toBe(true)
    expect(response.items.every((item) => item.businessId !== 'approved-catalog-source')).toBe(true)
  })

  it('returns a safe unavailable state when sources are unconfigured', () => {
    const response = searchCatalog(
      { query: 'iphone' },
      {
        requestId: 'req-search',
        correlationId: 'corr-search',
        now,
        sourcePolicy: {
          sourceMode: 'unconfigured',
          allowedBusinessIds: [],
          message: unconfiguredMessage
        }
      }
    )

    expect(searchValidator.Check(response)).toBe(true)
    expect(response.sourceMode).toBe('unconfigured')
    expect(response.state).toBe('unavailable')
    expect(response.items).toEqual([])
    expect(response.messages).toEqual([unconfiguredMessage])
  })

  it('ranks injected approved-source product facts without leaking disallowed sources', () => {
    const response = searchCatalog(
      { query: 'running shoe' },
      {
        requestId: 'req-search',
        correlationId: 'corr-search',
        now,
        sourcePolicy: {
          sourceMode: 'approved_sources',
          allowedBusinessIds: ['approved-catalog-source'],
          message: approvedMessage
        },
        products: approvedProducts
      }
    )

    expect(searchValidator.Check(response)).toBe(true)
    expect(response.sourceMode).toBe('approved_sources')
    expect(response.state).toBe('ready')
    expect(response.items).toHaveLength(1)
    expect(response.items[0]?.businessId).toBe('approved-catalog-source')
    expect(response.items[0]?.productId).toBe('approved-running-shoe-neutral')
    expect(response.items[0]?.sourceLabel.factType).toBe('approved_catalog_product')
    expect(JSON.stringify(response)).not.toMatch(/commission|payout|affiliate|settlement|margin/i)
  })

  it('keeps bounded search collection ordered by relevance and price', () => {
    const rankedProducts: CatalogProductSearchInput[] = [
      {
        ...approvedProducts[0]!,
        productId: 'premium-running-shoe',
        title: 'Premium Running Shoe',
        price: { amountMinor: 150, currency: 'USD' }
      },
      {
        ...approvedProducts[0]!,
        productId: 'budget-running-shoe',
        title: 'Budget Running Shoe',
        price: { amountMinor: 90, currency: 'USD' }
      },
      {
        ...approvedProducts[0]!,
        productId: 'midrange-running-shoe',
        title: 'Midrange Running Shoe',
        price: { amountMinor: 120, currency: 'USD' }
      }
    ]

    const response = searchCatalog(
      { query: 'running shoe', pagination: { limit: 2 } },
      {
        requestId: 'req-search',
        correlationId: 'corr-search',
        now,
        sourcePolicy: {
          sourceMode: 'approved_sources',
          allowedBusinessIds: ['approved-catalog-source'],
          message: approvedMessage
        },
        products: rankedProducts
      }
    )

    expect(searchValidator.Check(response)).toBe(true)
    expect(response.items.map((item) => item.productId)).toEqual([
      'budget-running-shoe',
      'midrange-running-shoe'
    ])
  })

  it('applies the result limit to canonical product groups without truncating merchant offers', () => {
    const products: CatalogProductSearchInput[] = [
      {
        ...approvedProducts[0]!,
        productId: 'clustered-running-shoe',
        variantId: 'seller-a',
        title: 'Clustered Running Shoe',
        price: { amountMinor: 100, currency: 'USD' },
        seller: {
          id: 'seller-a',
          name: 'Seller A',
          domain: 'seller-a.example.com'
        }
      },
      {
        ...approvedProducts[0]!,
        productId: 'clustered-running-shoe',
        variantId: 'seller-b',
        title: 'Clustered Running Shoe',
        price: { amountMinor: 95, currency: 'USD' },
        seller: {
          id: 'seller-b',
          name: 'Seller B',
          domain: 'seller-b.example.com'
        }
      },
      {
        ...approvedProducts[0]!,
        productId: 'second-running-shoe',
        title: 'Second Running Shoe',
        price: { amountMinor: 200, currency: 'USD' }
      }
    ]

    const response = searchCatalog(
      { query: 'running shoe', pagination: { limit: 1 } },
      {
        requestId: 'req-group-budget',
        correlationId: 'corr-group-budget',
        now,
        sourcePolicy: {
          sourceMode: 'approved_sources',
          allowedBusinessIds: ['approved-catalog-source'],
          message: approvedMessage
        },
        products
      }
    )

    expect(response.items).toHaveLength(2)
    expect(response.items.map((item) => item.productId)).toEqual([
      'clustered-running-shoe',
      'clustered-running-shoe'
    ])
    expect(response.items.map((item) => item.seller?.domain).sort()).toEqual([
      'seller-a.example.com',
      'seller-b.example.com'
    ])
  })

  it('honors explicit lowest-price ordering after products pass intent matching', () => {
    const products: CatalogProductSearchInput[] = [
      {
        ...approvedProducts[0]!,
        productId: 'stronger-match-expensive',
        title: 'Noise Cancelling Wireless Headphones Headphones',
        description: 'Wireless headphones with noise cancelling.',
        categoryPath: ['Electronics', 'Headphones'],
        price: { amountMinor: 24999, currency: 'USD' },
        tags: ['wireless', 'headphones', 'noise cancelling']
      },
      {
        ...approvedProducts[0]!,
        productId: 'qualified-cheaper',
        title: 'Wireless Headphones',
        description: 'Everyday wireless audio headphones.',
        categoryPath: ['Electronics', 'Headphones'],
        price: { amountMinor: 7999, currency: 'USD' },
        tags: ['wireless', 'headphones']
      }
    ]

    const response = searchCatalog(
      {
        query: 'wireless headphones',
        intent: { sort: 'price_asc' }
      },
      {
        requestId: 'req-price-sort',
        correlationId: 'corr-price-sort',
        now,
        sourcePolicy: {
          sourceMode: 'approved_sources',
          allowedBusinessIds: ['approved-catalog-source'],
          message: approvedMessage
        },
        products
      }
    )

    expect(response.items.map((item) => item.productId)).toEqual([
      'qualified-cheaper',
      'stronger-match-expensive'
    ])
  })

  it('does not order different currencies by raw minor units', () => {
    const products: CatalogProductSearchInput[] = [
      {
        ...approvedProducts[0]!,
        productId: 'relevant-usd-headphones',
        title: 'Wireless Headphones Headphones',
        description: 'Wireless headphones with a strong query match.',
        categoryPath: ['Electronics', 'Headphones'],
        price: { amountMinor: 12000, currency: 'USD' },
        tags: ['wireless', 'headphones']
      },
      {
        ...approvedProducts[0]!,
        productId: 'weaker-eur-headphones',
        title: 'Wireless Audio',
        description: 'Headphones for everyday listening.',
        categoryPath: ['Electronics', 'Headphones'],
        price: { amountMinor: 5000, currency: 'EUR' },
        tags: ['wireless', 'headphones']
      }
    ]

    const response = searchCatalog(
      {
        query: 'wireless headphones',
        intent: { sort: 'price_asc' }
      },
      {
        requestId: 'req-cross-currency-sort',
        correlationId: 'corr-cross-currency-sort',
        now,
        sourcePolicy: {
          sourceMode: 'approved_sources',
          allowedBusinessIds: ['approved-catalog-source'],
          message: approvedMessage
        },
        products
      }
    )

    expect(response.items.map((item) => item.productId)).toEqual([
      'relevant-usd-headphones',
      'weaker-eur-headphones'
    ])
  })

  it('uses host-agent structured intent as advisory ranking and filtering input for broad goods', () => {
    const products: CatalogProductSearchInput[] = [
      {
        ...approvedProducts[0]!,
        productId: 'white-front-load-washer',
        title: 'White Front Load Washing Machine',
        brand: 'HomeWorks',
        description: 'Energy efficient washing machine for family laundry.',
        categoryPath: ['Appliances', 'Washing Machines'],
        price: { amountMinor: 649, currency: 'USD' },
        tags: ['appliance', 'laundry', 'washer', 'white']
      },
      {
        ...approvedProducts[0]!,
        productId: 'portable-laundry-basket',
        title: 'Portable Laundry Basket',
        brand: 'HomeWorks',
        description: 'Collapsible basket for laundry storage.',
        categoryPath: ['Home', 'Storage'],
        price: { amountMinor: 24, currency: 'USD' },
        tags: ['laundry', 'basket']
      }
    ]

    const response = searchCatalog(
      {
        query: 'something for laundry under $700',
        intent: {
          summary: 'Find a white washing machine for home laundry.',
          productTypes: ['washing machine'],
          categories: ['Appliances'],
          attributes: {
            Color: ['white']
          },
          maxPrice: { amountMinor: 700, currency: 'USD' },
          sort: 'price_asc'
        }
      },
      {
        requestId: 'req-search',
        correlationId: 'corr-search',
        now,
        sourcePolicy: {
          sourceMode: 'approved_sources',
          allowedBusinessIds: ['approved-catalog-source'],
          message: approvedMessage
        },
        products
      }
    )

    expect(searchValidator.Check(response)).toBe(true)
    expect(response.interpretedQuery.intentSource).toBe('query_and_host_agent')
    expect(response.interpretedQuery.productTypes).toContain('washing machine')
    expect(response.interpretedQuery.attributes.Color).toEqual(['white'])
    expect(response.interpretedQuery.maxPrice).toEqual({ amountMinor: 700, currency: 'USD' })
    expect(response.items[0]?.productId).toBe('white-front-load-washer')
    expect(response.items[0]?.matchReasons).toEqual(expect.arrayContaining([
      'Product type matches washing machine.'
    ]))
  })

  it('treats host-agent brand and seller hints as bounded preferences instead of merchant authority', () => {
    const products: CatalogProductSearchInput[] = [
      {
        ...approvedProducts[0]!,
        productId: 'approved-black-jacket',
        title: 'Black Rain Jacket',
        brand: 'North Ridge',
        description: 'Water resistant black jacket.',
        categoryPath: ['Apparel', 'Jackets'],
        price: { amountMinor: 90, currency: 'USD' },
        seller: {
          id: 'seller-allowed',
          name: 'Approved Outerwear',
          domain: 'outerwear.example.com',
          url: 'https://outerwear.example.com'
        },
        tags: ['black', 'jacket', 'outerwear']
      },
      {
        ...approvedProducts[0]!,
        productId: 'other-black-jacket',
        title: 'Black Moto Jacket',
        brand: 'Other Brand',
        description: 'Black jacket from another seller.',
        categoryPath: ['Apparel', 'Jackets'],
        price: { amountMinor: 70, currency: 'USD' },
        seller: {
          id: 'seller-blocked',
          name: 'Other Outerwear',
          domain: 'other.example.com',
          url: 'https://other.example.com'
        },
        tags: ['black', 'jacket']
      }
    ]

    const response = searchCatalog(
      {
        query: 'black jacket',
        intent: {
          brands: ['North Ridge'],
          sellerDomains: ['outerwear.example.com']
        }
      },
      {
        requestId: 'req-search',
        correlationId: 'corr-search',
        now,
        sourcePolicy: {
          sourceMode: 'approved_sources',
          allowedBusinessIds: ['approved-catalog-source'],
          message: approvedMessage
        },
        products
      }
    )

    expect(searchValidator.Check(response)).toBe(true)
    expect(response.items.map((item) => item.productId)).toEqual([
      'approved-black-jacket',
      'other-black-jacket'
    ])
    expect(response.items[0]?.sourceLabel.factType).toBe('approved_catalog_product')
    expect(response.items[0]?.matchReasons).toEqual(expect.arrayContaining([
      'Seller matches outerwear.example.com.'
    ]))
  })

  it('normalizes plain query constraints for connector catalog filters without changing response intent source', () => {
    const connectorRequest = catalogSearchRequestForConnector({
      query: 'black trail running shoes under $150',
      context: { region: 'US', currency: 'USD', channel: 'agent' }
    })

    expect(connectorRequest.intent).toMatchObject({
      productTypes: expect.arrayContaining(['running shoes', 'shoes']),
      categories: expect.arrayContaining(['Running Shoes', 'Footwear']),
      attributes: { Color: ['black'] },
      maxPrice: { amountMinor: 15000, currency: 'USD' }
    })

    const response = searchCatalog(
      {
        query: 'black trail running shoes under $150',
        context: { region: 'US', currency: 'USD', channel: 'agent' }
      },
      {
        requestId: 'req-search',
        correlationId: 'corr-search',
        now,
        sourcePolicy: {
          sourceMode: 'approved_sources',
          allowedBusinessIds: ['approved-catalog-source'],
          message: approvedMessage
        },
        products: approvedProducts
      }
    )

    expect(response.interpretedQuery.intentSource).toBe('query')
  })

  it('matches product phrases by words so pants do not trigger cookware pan intent', () => {
    const response = searchCatalog(
      { query: 'black pants' },
      {
        requestId: 'req-search',
        correlationId: 'corr-search',
        now,
        sourcePolicy: {
          sourceMode: 'approved_sources',
          allowedBusinessIds: ['approved-catalog-source'],
          message: approvedMessage
        },
        products: [
          {
            ...approvedProducts[0]!,
            productId: 'black-pants',
            title: 'Black Travel Pants',
            categoryPath: ['Apparel', 'Pants'],
            tags: ['black', 'pants']
          }
        ]
      }
    )

    expect(searchValidator.Check(response)).toBe(true)
    expect(response.interpretedQuery.detectedCategories).toContain('Pants')
    expect(response.interpretedQuery.detectedCategories).not.toContain('Cookware')
    expect(response.items[0]?.productId).toBe('black-pants')
  })

  it('does not compare price constraints across mismatched currencies', () => {
    const response = searchCatalog(
      {
        query: 'washing machine under $700',
        context: { currency: 'USD' }
      },
      {
        requestId: 'req-search',
        correlationId: 'corr-search',
        now,
        sourcePolicy: {
          sourceMode: 'approved_sources',
          allowedBusinessIds: ['approved-catalog-source'],
          message: approvedMessage
        },
        products: [
          {
            ...approvedProducts[0]!,
            productId: 'eur-washer',
            title: 'Compact Washing Machine',
            categoryPath: ['Appliances', 'Washing Machines'],
            price: { amountMinor: 500, currency: 'EUR' },
            tags: ['washing', 'machine']
          },
          {
            ...approvedProducts[0]!,
            productId: 'usd-washer',
            title: 'Compact Washing Machine',
            categoryPath: ['Appliances', 'Washing Machines'],
            price: { amountMinor: 650, currency: 'USD' },
            tags: ['washing', 'machine']
          }
        ]
      }
    )

    expect(searchValidator.Check(response)).toBe(true)
    expect(response.items.map((item) => item.productId)).toEqual(['usd-washer'])
  })

  it('ranks connected-source product facts without requiring approval-mode state', () => {
    const connectedProducts: CatalogProductSearchInput[] = [
      {
        ...approvedProducts[0]!,
        sourceLabel: {
          ...approvedProducts[0]!.sourceLabel,
          factType: 'connected_catalog_product'
        },
        seller: {
          id: 'shopify-seller-1',
          name: 'Runner Shop',
          domain: 'runner-shop.example.com',
          url: 'https://runner-shop.example.com'
        },
        handoff: {
          type: 'variant_checkout',
          url: 'https://runner-shop.example.com/cart/approved-running-shoe-neutral-10:1'
        }
      }
    ]
    const response = searchCatalog(
      { query: 'running shoe' },
      {
        requestId: 'req-search',
        correlationId: 'corr-search',
        now,
        sourcePolicy: {
          sourceMode: 'connected_sources',
          allowedBusinessIds: ['approved-catalog-source'],
          message: connectedMessage
        },
        products: connectedProducts
      }
    )

    expect(searchValidator.Check(response)).toBe(true)
    expect(response.sourceMode).toBe('connected_sources')
    expect(response.state).toBe('ready')
    expect(response.messages[0]?.code).toBe('connected_catalog_sources')
    expect(response.items).toHaveLength(1)
    expect(response.items[0]?.businessId).toBe('approved-catalog-source')
    expect(response.items[0]?.sourceLabel.factType).toBe('connected_catalog_product')
    expect(response.items[0]?.seller).toEqual(connectedProducts[0]!.seller)
    expect(response.items[0]?.handoff).toEqual(connectedProducts[0]!.handoff)
    expect(JSON.stringify(response)).not.toMatch(/commission|payout|affiliate|settlement|margin/i)
  })

  it('returns unavailable approved-source state when no injected products match', () => {
    const response = searchCatalog(
      { query: 'fridge' },
      {
        requestId: 'req-search',
        correlationId: 'corr-search',
        now,
        sourcePolicy: {
          sourceMode: 'approved_sources',
          allowedBusinessIds: ['approved-catalog-source'],
          message: approvedMessage
        },
        products: approvedProducts
      }
    )

    expect(searchValidator.Check(response)).toBe(true)
    expect(response.sourceMode).toBe('approved_sources')
    expect(response.state).toBe('unavailable')
    expect(response.items).toEqual([])
    expect(response.messages.map((message) => message.code)).toContain('approved_catalog_no_match')
  })

  it('does not turn a nonsense term plus generic catalogue words into weak matches', () => {
    const response = searchCatalog(
      { query: 'zzzzzz no product' },
      {
        requestId: 'req-nonsense-search',
        correlationId: 'corr-nonsense-search',
        now,
        sourcePolicy: {
          sourceMode: 'approved_sources',
          allowedBusinessIds: ['approved-catalog-source'],
          message: approvedMessage
        },
        products: [{
          ...approvedProducts[0]!,
          title: 'Everyday Product Bundle',
          description: 'A general catalogue product.',
          categoryPath: ['Catalog'],
          tags: ['product']
        }]
      }
    )

    expect(response.state).toBe('unavailable')
    expect(response.items).toEqual([])
    expect(response.messages.map((message) => message.code)).toContain('approved_catalog_no_match')
  })

  it('returns unavailable connected-source state when no injected products match', () => {
    const response = searchCatalog(
      { query: 'fridge' },
      {
        requestId: 'req-search',
        correlationId: 'corr-search',
        now,
        sourcePolicy: {
          sourceMode: 'connected_sources',
          allowedBusinessIds: ['approved-catalog-source'],
          message: connectedMessage
        },
        products: approvedProducts
      }
    )

    expect(searchValidator.Check(response)).toBe(true)
    expect(response.sourceMode).toBe('connected_sources')
    expect(response.state).toBe('unavailable')
    expect(response.items).toEqual([])
    expect(response.messages.map((message) => message.code)).toContain('connected_catalog_no_match')
  })
})
