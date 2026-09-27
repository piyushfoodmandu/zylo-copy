import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  CatalogProductDetailResponseSchema,
  CatalogSearchResponseSchema,
  validationErrorSummary,
  type CatalogProductDetailResponse,
  type CatalogSearchResponse
} from '@arro/contracts'

const responseValidator = TypeCompiler.Compile(CatalogSearchResponseSchema)
const detailResponseValidator = TypeCompiler.Compile(CatalogProductDetailResponseSchema)
const baseUrl = (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const rawQueries = process.env.PRODUCTION_SEARCH_VERIFY_QUERIES?.trim()
const queries = rawQueries
  ? rawQueries.split('|').map((query) => query.trim()).filter(Boolean)
  : [
      'trail running shoes',
      'wireless headphones under $100',
      'organic cotton sweater',
      'running shoes',
      'black jacket',
      'fridge'
    ]
const commercialFieldPattern = /affiliate|commission|commercialRankingScore|margin|paidPlacement|partnerTier|payout|settlement/i
const failures: string[] = []

const assert = (condition: boolean, message: string) => {
  if (!condition) failures.push(message)
}

const searchRoute = '/v1/catalog/search'

const itemSummary = (item: CatalogSearchResponse['items'][number]) => ({
  productId: item.productId,
  title: item.title,
  businessId: item.businessId,
  businessName: item.businessName,
  seller: item.seller,
  price: item.price,
  availability: item.availability,
  handoff: item.handoff,
  source: item.sourceLabel
})

const detailSummary = (detail: CatalogProductDetailResponse['product']) => detail
  ? {
      productId: detail.productId,
      variantId: detail.variantId,
      title: detail.title,
      businessId: detail.businessId,
      businessName: detail.businessName,
      price: detail.price,
      availability: detail.availability,
      mediaCount: detail.media.length,
      optionCount: detail.options.length,
      variantCount: detail.variants.length,
      handoff: detail.handoff,
      source: detail.sourceLabel
    }
  : undefined

const isSafeHttpsUrl = (value: string | undefined) => {
  if (!value) return true

  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const validateSearchResponse = ({
  query,
  route,
  body
}: {
  query: string
  route: string
  body: unknown
}) => {
  if (!responseValidator.Check(body)) {
    const errors = validationErrorSummary(responseValidator, body)
    failures.push(`${route} ${query}: response failed CatalogSearchResponseSchema: ${errors}`)
    return undefined
  }

  const searchBody = body as CatalogSearchResponse
  assert(
    searchBody.sourceMode === 'approved_sources' || searchBody.sourceMode === 'connected_sources',
    `${route} ${query}: expected approved_sources or connected_sources, received ${searchBody.sourceMode}.`
  )
  assert(
    searchBody.state === 'ready' || searchBody.state === 'limited',
    `${route} ${query}: expected ready or limited state, received ${searchBody.state}.`
  )
  assert(searchBody.items.length > 0, `${route} ${query}: expected at least one real product item.`)
  assert(!commercialFieldPattern.test(JSON.stringify(searchBody)), `${route} ${query}: response contains commercial fields.`)

  for (const [index, item] of searchBody.items.entries()) {
    assert(
      item.sourceLabel.factType === 'approved_catalog_product' || item.sourceLabel.factType === 'connected_catalog_product',
      `${route} ${query} item ${index}: expected connector-backed product source label.`
    )
    assert(item.sourceLabel.sourceId === item.businessId, `${route} ${query} item ${index}: source label does not match business ID.`)
    assert(item.matchReasons.length > 0, `${route} ${query} item ${index}: expected match reasons.`)
    assert(isSafeHttpsUrl(item.productUrl), `${route} ${query} item ${index}: product URL must be HTTPS when present.`)
    assert(isSafeHttpsUrl(item.imageUrl), `${route} ${query} item ${index}: image URL must be HTTPS when present.`)
    assert(isSafeHttpsUrl(item.handoff?.url), `${route} ${query} item ${index}: handoff URL must be HTTPS when present.`)
    assert(isSafeHttpsUrl(item.seller?.url), `${route} ${query} item ${index}: seller URL must be HTTPS when present.`)
  }

  return searchBody
}

const validateProductDetailResponse = ({
  query,
  item,
  body
}: {
  query: string
  item: CatalogSearchResponse['items'][number]
  body: unknown
}) => {
  if (!detailResponseValidator.Check(body)) {
    const errors = validationErrorSummary(detailResponseValidator, body)
    failures.push(`${query} ${item.productId}: detail response failed CatalogProductDetailResponseSchema: ${errors}`)
    return undefined
  }

  const detailBody = body as CatalogProductDetailResponse
  assert(
    detailBody.sourceMode === 'approved_sources' || detailBody.sourceMode === 'connected_sources',
    `${query} ${item.productId}: expected approved_sources or connected_sources detail, received ${detailBody.sourceMode}.`
  )
  assert(detailBody.state === 'ready', `${query} ${item.productId}: expected ready product detail, received ${detailBody.state}.`)
  assert(Boolean(detailBody.product), `${query} ${item.productId}: expected connector-backed product detail.`)
  assert(!commercialFieldPattern.test(JSON.stringify(detailBody)), `${query} ${item.productId}: detail response contains commercial fields.`)

  const product = detailBody.product
  if (product) {
    assert(product.businessId === item.businessId, `${query} ${item.productId}: detail business ID does not match search item.`)
    assert(product.productId === item.productId, `${query} ${item.productId}: detail product ID does not match search item.`)
    if (item.variantId) {
      assert(product.variantId === item.variantId, `${query} ${item.productId}: detail variant ID does not match search item.`)
    }
    assert(product.sourceLabel.sourceId === product.businessId, `${query} ${item.productId}: detail source label does not match business ID.`)
    assert(
      product.sourceLabel.factType === 'approved_catalog_product_detail' || product.sourceLabel.factType === 'connected_catalog_product_detail',
      `${query} ${item.productId}: expected connector-backed product detail source label.`
    )
    assert(isSafeHttpsUrl(product.productUrl), `${query} ${item.productId}: detail product URL must be HTTPS when present.`)
    assert(isSafeHttpsUrl(product.handoff?.url), `${query} ${item.productId}: detail handoff URL must be HTTPS when present.`)
    assert(isSafeHttpsUrl(product.seller?.url), `${query} ${item.productId}: detail seller URL must be HTTPS when present.`)
    for (const [mediaIndex, media] of product.media.entries()) {
      assert(isSafeHttpsUrl(media.url), `${query} ${item.productId} media ${mediaIndex}: media URL must be HTTPS.`)
    }
    for (const [variantIndex, variant] of product.variants.entries()) {
      assert(isSafeHttpsUrl(variant.productUrl), `${query} ${item.productId} variant ${variantIndex}: variant product URL must be HTTPS when present.`)
      assert(isSafeHttpsUrl(variant.handoff?.url), `${query} ${item.productId} variant ${variantIndex}: variant handoff URL must be HTTPS when present.`)
    }
  }

  return detailBody
}

const summaries: Array<{
  query: string
  route: string
  topItem?: ReturnType<typeof itemSummary>
  topItemDetail?: ReturnType<typeof detailSummary>
}> = []

for (const [index, query] of queries.entries()) {
  const route = searchRoute
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-request-id': `production-search-${index}`
    },
    body: JSON.stringify({
      query,
      context: {
        locale: 'en-US',
        region: 'US',
        currency: 'USD',
        channel: index % 2 === 0 ? 'web' : 'agent'
      }
    })
  })
  const body = await response.json().catch(() => undefined) as unknown

  assert(response.status === 200, `${route} ${query}: expected HTTP 200, received ${response.status}.`)
  const searchBody = validateSearchResponse({ query, route, body })
  const topItem = searchBody?.items[0]
  let topItemDetail: CatalogProductDetailResponse | undefined
  if (topItem) {
    const detailResponse = await fetch(`${baseUrl}/v1/catalog/product`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-request-id': `production-product-detail-${index}`
      },
      body: JSON.stringify({
        businessId: topItem.businessId,
        productId: topItem.productId,
        ...(topItem.variantId ? { variantId: topItem.variantId } : {}),
        context: {
          locale: 'en-US',
          region: 'US',
          currency: 'USD',
          channel: index % 2 === 0 ? 'web' : 'agent'
        }
      })
    })
    const detailBody = await detailResponse.json().catch(() => undefined) as unknown

    assert(detailResponse.status === 200, `/v1/catalog/product ${query}: expected HTTP 200, received ${detailResponse.status}.`)
    topItemDetail = validateProductDetailResponse({ query, item: topItem, body: detailBody })
  }
  summaries.push({
    query,
    route,
    ...(topItem ? { topItem: itemSummary(topItem) } : {}),
    ...(topItemDetail ? { topItemDetail: detailSummary(topItemDetail.product) } : {})
  })
}

if (failures.length > 0) {
  console.error('Production search verification failed.')
  console.error('This verifier requires real configured catalog adapters or approved source-authority records. It must not pass with sandbox or unconfigured responses.')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log('Production search verification passed.')
  console.log('Validated connector-backed, non-sandbox search and product-detail responses with source labels and commercial-field isolation.')
  for (const summary of summaries) console.log(JSON.stringify(summary))
}
