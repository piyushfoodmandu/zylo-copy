import { describe, expect, it } from 'vitest'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  CatalogProductSanityCheckResponseSchema,
  type CatalogProductSearchInput
} from '@arro/contracts'
import { analyzeProductSanityCheck } from './sanity-check.ts'

const responseValidator = TypeCompiler.Compile(CatalogProductSanityCheckResponseSchema)
const now = new Date('2026-06-24T00:00:00.000Z')

const candidate: CatalogProductSearchInput = {
  productId: 'shoe-1',
  variantId: 'shoe-1-blue-10',
  businessId: 'runner-shop',
  businessName: 'Runner Shop',
  title: 'Runner Shop Blue Daily Trainer',
  brand: 'Runner Shop',
  description: 'A new daily running trainer.',
  categoryPath: ['Footwear', 'Running Shoes'],
  price: { amountMinor: 120, currency: 'USD' },
  availability: 'in_stock',
  condition: 'new',
  productUrl: 'https://runner-shop.example.com/products/shoe-1',
  seller: {
    name: 'Runner Shop',
    domain: 'runner-shop.example.com',
    url: 'https://runner-shop.example.com'
  },
  handoff: {
    type: 'product',
    url: 'https://runner-shop.example.com/products/shoe-1'
  },
  tags: ['running', 'trainer', 'blue'],
  sourceLabel: {
    sourceId: 'runner-shop',
    sourceName: 'Runner Shop',
    factType: 'connected_catalog_product',
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 15 * 60 * 1000).toISOString(),
    freshnessClass: 'advisory_catalog',
    bindingStatus: 'advisory'
  }
}

describe('product sanity-check analysis', () => {
  it('supports submitted evidence only as a safer-next-action signal', () => {
    const response = analyzeProductSanityCheck(
      {
        submittedUrl: 'https://runner-shop.example.com/products/shoe-1',
        identifiers: [{ kind: 'product_id', value: 'shoe-1' }],
        visibleClaimText: 'Brand new authentic Runner Shop daily trainer.',
        candidates: [candidate]
      },
      {
        requestId: 'sanity-supported-request',
        correlationId: 'sanity-supported-correlation',
        now
      }
    )

    expect(responseValidator.Check(response)).toBe(true)
    expect(response.state).toBe('supported')
    expect(response.evidence).toMatchObject({
      hasSubmittedUrl: true,
      submittedUrlHost: 'runner-shop.example.com',
      identifierCount: 1,
      hasVisibleClaimText: true,
      candidateCount: 1,
      sourceLabelCount: 1
    })
    expect(response.candidateAssessments[0]).toMatchObject({
      matchState: 'supports',
      productId: 'shoe-1'
    })
    expect(response.actionPolicy.state).toBe('safer_next_action')
    expect(response.actionPolicy.allowedNextActions.map((action) => action.action)).toEqual([
      'get_product_detail',
      'prepare_purchase'
    ])
    expect(JSON.stringify(response)).not.toContain('Brand new authentic')
  })

  it('returns a no-buy warning when submitted evidence conflicts with source-labeled facts', () => {
    const response = analyzeProductSanityCheck(
      {
        submittedUrl: 'https://fake-shop.example.net/products/shoe-1',
        visibleClaimText: 'Brand new Runner Shop daily trainer.',
        candidates: [
          {
            ...candidate,
            condition: 'used'
          }
        ]
      },
      {
        requestId: 'sanity-conflict-request',
        correlationId: 'sanity-conflict-correlation',
        now
      }
    )

    expect(responseValidator.Check(response)).toBe(true)
    expect(response.state).toBe('no_buy')
    expect(response.candidateAssessments[0]?.matchState).toBe('conflicts')
    expect(response.findings.map((finding) => finding.code)).toContain(
      'sanity_check_candidate_conflict'
    )
    expect(response.actionPolicy.allowedNextActions.map((action) => action.action)).toEqual([
      'stop',
      'search_products',
      'wait'
    ])
  })

  it('does not treat claim-only evidence as source-backed proof', () => {
    const response = analyzeProductSanityCheck(
      {
        visibleClaimText: 'Official authentic limited edition product.'
      },
      {
        requestId: 'sanity-claim-only-request',
        correlationId: 'sanity-claim-only-correlation',
        now
      }
    )

    expect(responseValidator.Check(response)).toBe(true)
    expect(response.state).toBe('needs_review')
    expect(response.findings.map((finding) => finding.code)).toContain(
      'sanity_check_authenticity_unverified'
    )
    expect(JSON.stringify(response)).not.toContain('Official authentic limited edition')
  })
})
