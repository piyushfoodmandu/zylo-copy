import type {
  CatalogProductDetailFetchRequest,
  CatalogProductFetchRequest,
  CatalogSource
} from './catalog-fetcher.ts'

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)])
  )
}

export const stableCatalogIdentity = (value: unknown): string =>
  JSON.stringify(stableValue(value)) ?? 'null'

const sourceIdentity = (source: CatalogSource) => ({
  businessId: source.businessId,
  domain: source.domain,
  displayName: source.displayName,
  sourceType: source.sourceType,
  profileHash: source.profileHash,
  profileUrl: source.profileUrl
})

/** Public catalog facts do not vary by the identity of the caller. */
export const catalogSearchRequestIdentity = (
  request: Pick<CatalogProductFetchRequest, 'source' | 'searchRequest'>
) => stableCatalogIdentity({
  source: sourceIdentity(request.source),
  searchRequest: {
    query: request.searchRequest.query,
    intent: request.searchRequest.intent,
    filters: request.searchRequest.filters,
    context: request.searchRequest.context,
    pagination: request.searchRequest.pagination
  }
})

export const catalogProductDetailRequestIdentity = (
  request: Pick<CatalogProductDetailFetchRequest, 'source' | 'detailRequest'>
) => stableCatalogIdentity({
  source: sourceIdentity(request.source),
  detailRequest: {
    businessId: request.detailRequest.businessId,
    productId: request.detailRequest.productId,
    variantId: request.detailRequest.variantId,
    selected: request.detailRequest.selected,
    preferences: request.detailRequest.preferences,
    context: request.detailRequest.context
  }
})
