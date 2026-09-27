/**
 * The shopper is a consumer of the public Arro contract, not a second place to
 * redefine it. Keep these aliases local so feature code has short imports while
 * the actual wire shape stays owned by @arro/contracts.
 */
export type {
  Money,
  SourceLabel,
  CatalogProductSummary,
  CatalogProductDetail
} from '@arro/contracts'

export type SearchResponse = import('@arro/contracts').CatalogSearchResponse
export type ProductDetailResponse = import('@arro/contracts').CatalogProductDetailResponse
export type CompareResponse = import('@arro/contracts').CatalogProductCompareResponse
export type InterpretedQuery = SearchResponse['interpretedQuery']
