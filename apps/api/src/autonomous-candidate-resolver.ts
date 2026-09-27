import { randomUUID } from 'node:crypto'
import type { CatalogProductSearchInput, CatalogSearchRequest } from '@arro/contracts'
import type { CatalogProductFetcher, CatalogSource } from '@arro/connectors'
import type { AutonomousPurchaseJobClaim } from './autonomous-purchase-jobs.ts'
import type { PurchaseMandate } from './purchase-mandate.ts'

export type AutonomousPurchaseCandidate = {
  merchantDomain: string
  merchantProfileUrl?: string
  productId: string
  variantId: string
  title: string
  productUrl?: string
  quantity: number
  evidence: {
    businessId: string
    sourceId: string
    sourceFetchedAt: string
    sourceExpiresAt?: string
    priceAmountMinor?: number
    priceCurrency?: string
    sellerDomain?: string
  }
}

export type AutonomousCandidateResolution =
  | { state: 'selected'; candidate: AutonomousPurchaseCandidate; qualifyingCount: number }
  | { state: 'no_candidate'; reasonCode: string; checkedSourceCount: number }

export type AutonomousCandidateResolver = {
  resolve(input: {
    job: AutonomousPurchaseJobClaim
    mandate: PurchaseMandate
  }): Promise<AutonomousCandidateResolution>
}

const normalizedHost = (value: string) => {
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return value.toLowerCase().replace(/^www\./, '')
  }
}

const text = (product: CatalogProductSearchInput) => [
  product.title,
  product.brand,
  product.description,
  ...product.categoryPath,
  ...product.tags,
  product.seller?.name,
  product.seller?.domain
].filter(Boolean).join(' ').toLowerCase()

const terms = (values: string[] | undefined) =>
  (values ?? []).flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/).filter((entry) => entry.length > 1))

const attributeTerms = (attributes: PurchaseMandate['intent']['requiredAttributes']) =>
  Object.values(attributes ?? {}).flatMap((value) => Array.isArray(value) ? value : [value])

const prohibitedTerms = (attributes: PurchaseMandate['intent']['prohibitedAttributes']) =>
  Object.values(attributes ?? {}).flatMap((value) => Array.isArray(value) ? value : [value])

const sellerHost = (product: CatalogProductSearchInput, source: CatalogSource) =>
  normalizedHost(product.seller?.domain ?? source.domain)

const sourceEligible = (source: CatalogSource, mandate: PurchaseMandate) => {
  const host = normalizedHost(source.domain)
  const allowed = mandate.merchantPolicy.allowedMerchantOrigins?.map(normalizedHost) ?? []
  const denied = mandate.merchantPolicy.deniedMerchantOrigins?.map(normalizedHost) ?? []
  return !denied.includes(host) && (allowed.length === 0 || allowed.includes(host))
}

const scoreCandidate = ({
  product,
  source,
  mandate,
  condition,
  now
}: {
  product: CatalogProductSearchInput
  source: CatalogSource
  mandate: PurchaseMandate
  condition: Record<string, unknown>
  now: Date
}) => {
  if (product.availability !== 'in_stock') return undefined
  if (product.sourceLabel.bindingStatus === 'missing' || product.sourceLabel.bindingStatus === 'stale') return undefined
  if (product.sourceLabel.expiresAt && new Date(product.sourceLabel.expiresAt).getTime() <= now.getTime()) return undefined
  const candidateText = text(product)
  const required = [
    ...terms(mandate.intent.productQueries),
    ...terms(mandate.intent.categories),
    ...terms(attributeTerms(mandate.intent.requiredAttributes))
  ]
  if (required.length > 0 && !required.every((term) => candidateText.includes(term))) return undefined
  const prohibited = terms(prohibitedTerms(mandate.intent.prohibitedAttributes))
  if (prohibited.some((term) => candidateText.includes(term))) return undefined

  const productIds = mandate.intent.productIds ?? []
  if (productIds.length > 0 && !productIds.includes(product.productId) && !productIds.includes(product.variantId ?? '')) return undefined
  const variants = mandate.intent.allowedVariants ?? []
  if (variants.length > 0 && (!product.variantId || !variants.includes(product.variantId))) return undefined
  const merchantHost = sellerHost(product, source)
  const allowed = mandate.merchantPolicy.allowedMerchantOrigins?.map(normalizedHost) ?? []
  const denied = mandate.merchantPolicy.deniedMerchantOrigins?.map(normalizedHost) ?? []
  if (denied.includes(merchantHost) || (allowed.length > 0 && !allowed.includes(merchantHost))) return undefined
  if (mandate.merchantPolicy.authorizedSellerRequired && merchantHost !== normalizedHost(source.domain)) return undefined

  const maximumPrice = BigInt(mandate.financialPolicy.maximumPerTransactionMinor)
  if (!product.price || product.price.currency !== mandate.financialPolicy.currency || BigInt(product.price.amountMinor) > maximumPrice) return undefined
  const conditionMaximum = typeof condition.maximumPriceMinor === 'string' && /^[0-9]+$/.test(condition.maximumPriceMinor)
    ? BigInt(condition.maximumPriceMinor)
    : typeof condition.maximumPriceMinor === 'number' && Number.isSafeInteger(condition.maximumPriceMinor)
      ? BigInt(condition.maximumPriceMinor)
      : undefined
  if (conditionMaximum !== undefined && BigInt(product.price.amountMinor) > conditionMaximum) return undefined
  if (typeof condition.requiredAvailability === 'string' && product.availability !== condition.requiredAvailability) return undefined

  const exactProduct = productIds.includes(product.productId) ? 1 : 0
  const exactVariant = product.variantId && variants.includes(product.variantId) ? 1 : 0
  const matchedTerms = required.filter((term) => candidateText.includes(term)).length
  const binding = product.sourceLabel.bindingStatus === 'binding' ? 1 : 0
  return {
    product,
    source,
    score: exactVariant * 1_000 + exactProduct * 500 + binding * 100 + matchedTerms * 10,
    price: product.price.amountMinor,
    merchantHost
  }
}

export const createAutonomousCandidateResolver = ({
  sources,
  fetcher,
  timeoutMs = 5_000,
  now = () => new Date()
}: {
  sources: CatalogSource[]
  fetcher: CatalogProductFetcher
  timeoutMs?: number
  now?: () => Date
}): AutonomousCandidateResolver => ({
  async resolve({ job, mandate }) {
    const eligibleSources = sources.filter((source) => sourceEligible(source, mandate))
    if (eligibleSources.length === 0) {
      return { state: 'no_candidate', reasonCode: 'mandate_merchant_unresolved', checkedSourceCount: 0 }
    }
    const query = mandate.intent.productQueries?.join(' ') || mandate.intent.description
    const maximumPerTransaction = BigInt(mandate.financialPolicy.maximumPerTransactionMinor)
    const maximumSearchPrice = maximumPerTransaction > BigInt(Number.MAX_SAFE_INTEGER)
      ? Number.MAX_SAFE_INTEGER
      : Number(maximumPerTransaction)
    const searchRequest: CatalogSearchRequest = {
      query,
      intent: {
        summary: mandate.intent.description,
        ...(mandate.intent.categories?.length ? { categories: mandate.intent.categories } : {}),
        ...(mandate.intent.requiredAttributes ? { attributes: mandate.intent.requiredAttributes } : {}),
        maxPrice: {
          amountMinor: maximumSearchPrice,
          currency: mandate.financialPolicy.currency
        },
        sort: 'price_asc'
      },
      context: {
        currency: mandate.financialPolicy.currency,
        channel: 'agent',
        requestedQuantity: mandate.intent.intendedQuantity ?? 1
      },
      pagination: { limit: 50 }
    }
    const fetched = await Promise.all(eligibleSources.map(async (source) => {
      try {
        return {
          source,
          result: await fetcher({
            requestId: `autonomous:${job.jobId}:${randomUUID()}`,
            correlationId: job.jobId,
            source,
            searchRequest,
            timeoutMs,
            signal: AbortSignal.timeout(timeoutMs),
            now: now()
          })
        }
      } catch {
        return undefined
      }
    }))
    const condition = job.trigger.type === 'condition' && job.trigger.condition && typeof job.trigger.condition === 'object'
      ? job.trigger.condition
      : {}
    const candidates = fetched.flatMap((entry) => entry?.result.status === 'fetched'
      ? entry.result.products.flatMap((product) => {
          const scored = scoreCandidate({ product, source: entry.source, mandate, condition, now: now() })
          return scored ? [scored] : []
        })
      : [])
    candidates.sort((left, right) =>
      right.score - left.score ||
      left.price - right.price ||
      left.merchantHost.localeCompare(right.merchantHost) ||
      left.product.productId.localeCompare(right.product.productId) ||
      (left.product.variantId ?? '').localeCompare(right.product.variantId ?? '')
    )
    const selected = candidates[0]
    if (!selected) {
      return {
        state: 'no_candidate',
        reasonCode: 'no_qualifying_purchase_candidate',
        checkedSourceCount: eligibleSources.length
      }
    }
    return {
      state: 'selected',
      qualifyingCount: candidates.length,
      candidate: {
        merchantDomain: selected.merchantHost,
        ...(selected.source.profileUrl && normalizedHost(selected.source.domain) === selected.merchantHost
          ? { merchantProfileUrl: selected.source.profileUrl }
          : {}),
        productId: selected.product.productId,
        variantId: selected.product.variantId ?? selected.product.productId,
        title: selected.product.title,
        ...(selected.product.productUrl ? { productUrl: selected.product.productUrl } : {}),
        quantity: Math.max(1, mandate.intent.intendedQuantity ?? 1),
        evidence: {
          businessId: selected.product.businessId,
          sourceId: selected.product.sourceLabel.sourceId,
          sourceFetchedAt: selected.product.sourceLabel.fetchedAt,
          ...(selected.product.sourceLabel.expiresAt ? { sourceExpiresAt: selected.product.sourceLabel.expiresAt } : {}),
          priceAmountMinor: selected.product.price!.amountMinor,
          priceCurrency: selected.product.price!.currency,
          ...(selected.product.seller?.domain ? { sellerDomain: selected.product.seller.domain } : {})
        }
      }
    }
  }
})
