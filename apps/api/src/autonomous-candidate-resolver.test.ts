import { describe, expect, it, vi } from 'vitest'
import type { CatalogProductFetcher, CatalogSource } from '@arro/connectors'
import type { CatalogProductSearchInput } from '@arro/contracts'
import { createAutonomousCandidateResolver } from './autonomous-candidate-resolver.ts'
import type { AutonomousPurchaseJobClaim } from './autonomous-purchase-jobs.ts'
import type { PurchaseMandate } from './purchase-mandate.ts'

const source: CatalogSource = {
  businessId: 'merchant-source',
  domain: 'merchant.example',
  displayName: 'Merchant',
  sourceType: 'direct_ucp',
  profileUrl: 'https://merchant.example/.well-known/ucp'
}

const product = (overrides: Partial<CatalogProductSearchInput> = {}): CatalogProductSearchInput => ({
  productId: 'charger-65w',
  variantId: 'charger-65w-black',
  businessId: source.businessId,
  businessName: source.displayName,
  title: 'Safe 65W USB-C laptop charger black',
  description: 'USB-C PD charger with grounded cable',
  categoryPath: ['Electronics', 'Laptop chargers'],
  price: { amountMinor: 3299, currency: 'USD' },
  availability: 'in_stock',
  condition: 'new',
  productUrl: 'https://merchant.example/products/charger-65w',
  seller: { domain: 'merchant.example', name: 'Merchant' },
  tags: ['USB-C', '65W', 'PD'],
  sourceLabel: {
    sourceId: source.businessId,
    sourceName: source.displayName,
    factType: 'connected_catalog_product',
    fetchedAt: '2026-07-13T05:00:00.000Z',
    expiresAt: '2026-07-13T07:00:00.000Z',
    freshnessClass: 'binding_commerce',
    bindingStatus: 'binding'
  },
  ...overrides
})

const mandate: PurchaseMandate = {
  mandateId: 'mandate-1',
  ownerId: 'owner:hash',
  integrationId: 'agent:owner:host',
  version: 1,
  status: 'active',
  authorizationProvider: 'trusted_host_signature',
  intent: {
    description: 'Buy one safe USB-C laptop charger',
    productQueries: ['65W USB-C laptop charger'],
    categories: ['Laptop chargers'],
    requiredAttributes: { power: '65W' },
    prohibitedAttributes: { condition: 'used' },
    intendedQuantity: 1,
    quantityMaximum: 1,
    substitutionPolicy: 'within_constraints'
  },
  merchantPolicy: {
    allowedMerchantOrigins: ['https://merchant.example'],
    authorizedSellerRequired: true
  },
  financialPolicy: {
    currency: 'USD',
    maximumPerTransactionMinor: '5000',
    maximumTotalSpendMinor: '5000',
    useLimit: 1
  },
  fulfillmentPolicy: {},
  executionPolicy: {
    humanConfirmation: 'never_within_mandate',
    stepUpAllowed: true,
    challengeBehavior: 'request_user'
  },
  validFrom: '2026-07-13T00:00:00.000Z',
  expiresAt: '2026-07-14T00:00:00.000Z'
}

const job: AutonomousPurchaseJobClaim = {
  jobId: 'job-1',
  ownerId: mandate.ownerId,
  ownerKeyId: 'owner',
  ownerPrincipalHash: 'hash',
  integrationId: mandate.integrationId,
  mandateId: mandate.mandateId,
  mandateVersion: 1,
  authorizationRoute: 'trusted_host',
  status: 'searching',
  trigger: { type: 'condition', condition: { maximumPriceMinor: '4000' } },
  attemptCount: 1
}

describe('autonomous candidate resolver', () => {
  it('ranks all current source-backed candidates deterministically instead of selecting the first result', async () => {
    const fetcher = vi.fn<CatalogProductFetcher>(async () => ({
      sourceId: source.businessId,
      sourceName: source.displayName,
      status: 'fetched',
      products: [
        product({ productId: 'expensive', variantId: 'expensive-black', price: { amountMinor: 3999, currency: 'USD' } }),
        product()
      ],
      messages: [],
      fetchedAt: '2026-07-13T05:00:00.000Z',
      latencyMs: 10
    }))
    const result = await createAutonomousCandidateResolver({
      sources: [source],
      fetcher,
      now: () => new Date('2026-07-13T06:00:00.000Z')
    }).resolve({ job, mandate })

    expect(result).toMatchObject({
      state: 'selected',
      qualifyingCount: 2,
      candidate: {
        productId: 'charger-65w',
        variantId: 'charger-65w-black',
        merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
        quantity: 1
      }
    })
  })

  it('returns no candidate when price, source freshness, seller, or conditions fail', async () => {
    const fetcher = vi.fn<CatalogProductFetcher>(async () => ({
      sourceId: source.businessId,
      sourceName: source.displayName,
      status: 'fetched',
      products: [product({
        price: { amountMinor: 4999, currency: 'USD' },
        seller: { domain: 'untrusted.example' }
      })],
      messages: [],
      fetchedAt: '2026-07-13T05:00:00.000Z',
      latencyMs: 10
    }))
    const result = await createAutonomousCandidateResolver({
      sources: [source],
      fetcher,
      now: () => new Date('2026-07-13T06:00:00.000Z')
    }).resolve({ job, mandate })
    expect(result).toEqual({
      state: 'no_candidate',
      reasonCode: 'no_qualifying_purchase_candidate',
      checkedSourceCount: 1
    })
  })
})
