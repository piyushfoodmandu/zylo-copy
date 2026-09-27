import type {
  AgentActionPolicy,
  CatalogProductCompareAssessment,
  CatalogProductCompareCriterion,
  CatalogProductCompareRequest,
  CatalogProductCompareResponse,
  CatalogProductCompareState,
  CatalogProductSearchInput,
  PlainStatusMessage,
  SearchSourceMode
} from '@arro/contracts'
import {
  formatMoney
} from '@arro/contracts'

type ProductCompareOptions = {
  requestId: string
  correlationId: string
  now?: Date
}

type ScoredAssessment = {
  assessment: CatalogProductCompareAssessment
  score: number
}

const defaultCriteria: CatalogProductCompareCriterion[] = [
  'price',
  'availability',
  'condition',
  'source_freshness',
  'handoff_readiness',
  'seller_identity'
]

const message = (
  severity: PlainStatusMessage['severity'],
  code: string,
  text: string,
  nextAction?: string
): PlainStatusMessage => ({
  severity,
  code,
  text,
  ...(nextAction ? { nextAction } : {})
})

const unique = <T>(values: T[]) => [...new Set(values)]

const expiredSourceLabel = (product: CatalogProductSearchInput, now: Date) =>
  product.sourceLabel.expiresAt &&
  new Date(product.sourceLabel.expiresAt).getTime() <= now.getTime()

const hasStaleSourceLabel = (product: CatalogProductSearchInput, now: Date) =>
  product.sourceLabel.bindingStatus === 'stale' || expiredSourceLabel(product, now)

const hasMissingSourceBinding = (product: CatalogProductSearchInput) =>
  product.sourceLabel.bindingStatus === 'missing'

const inferSourceMode = (
  products: CatalogProductSearchInput[],
  requestedSourceMode: SearchSourceMode | undefined
): SearchSourceMode => {
  if (requestedSourceMode) return requestedSourceMode
  if (products.length === 0) return 'unconfigured'

  return products.every((product) => product.sourceLabel.factType.startsWith('approved_'))
    ? 'approved_sources'
    : 'connected_sources'
}

const currencySet = (products: CatalogProductSearchInput[]) =>
  new Set(
    products
      .map((product) => product.price?.currency)
      .filter((currency): currency is string => Boolean(currency))
  )

const lowestComparablePrice = (products: CatalogProductSearchInput[]) => {
  const currencies = currencySet(products)
  if (currencies.size !== 1) return undefined

  const pricedProducts = products.filter((product) => product.price)
  if (pricedProducts.length === 0) return undefined

  return Math.min(...pricedProducts.map((product) => product.price!.amountMinor))
}

const assessProduct = ({
  product,
  lowestPrice,
  now
}: {
  product: CatalogProductSearchInput
  lowestPrice: number | undefined
  now: Date
}): ScoredAssessment => {
  const strengths: string[] = []
  const risks: string[] = []
  let score = 0

  if (product.availability === 'in_stock') {
    score += 4
    strengths.push('Source-labeled availability says the product is in stock.')
  } else if (product.availability === 'limited') {
    score += 1
    risks.push('Availability is limited, so the user should revalidate detail before acting.')
  } else if (product.availability === 'out_of_stock') {
    score -= 8
    risks.push('Source-labeled availability says the product is out of stock.')
  } else {
    score -= 2
    risks.push('Availability is unknown.')
  }

  if (product.condition === 'new') {
    score += 2
    strengths.push('Condition is new.')
  } else if (product.condition === 'unknown') {
    score -= 1
    risks.push('Condition is unknown.')
  } else {
    score -= 2
    risks.push(`Condition is ${product.condition.replace('_', ' ')}.`)
  }

  if (product.price && lowestPrice !== undefined) {
    if (product.price.amountMinor === lowestPrice) {
      score += 2
      strengths.push(`Lowest supplied price at ${formatMoney(product.price)}.`)
    } else {
      strengths.push(`Price is available at ${formatMoney(product.price)}.`)
    }
  } else if (!product.price) {
    score -= 1
    risks.push('Price is missing from the supplied source-backed facts.')
  }

  if (hasStaleSourceLabel(product, now)) {
    score -= 4
    risks.push('Source label is stale or expired.')
  } else {
    score += 2
    strengths.push('Source label is current for comparison use.')
  }

  if (hasMissingSourceBinding(product)) {
    score -= 5
    risks.push('Source label binding status is missing.')
  }

  if (product.handoff?.url) {
    score += 1
    strengths.push('A merchant handoff path is present, but it is not checkout authority.')
  } else {
    risks.push('No merchant handoff path was supplied.')
  }

  if (product.seller?.domain) {
    score += 1
    strengths.push(`Seller identity includes ${product.seller.domain}.`)
  } else {
    risks.push('Seller identity is incomplete.')
  }

  const comparisonState: CatalogProductCompareAssessment['comparisonState'] =
    product.availability === 'out_of_stock'
      ? 'unavailable'
      : risks.some((risk) =>
          risk.includes('stale') ||
          risk.includes('missing') ||
          risk.includes('unknown') ||
          risk.includes('No merchant handoff')
        )
        ? 'risky'
        : 'viable'

  return {
    assessment: {
      businessId: product.businessId,
      productId: product.productId,
      ...(product.variantId ? { variantId: product.variantId } : {}),
      title: product.title,
      ...(product.price ? { price: product.price } : {}),
      availability: product.availability,
      condition: product.condition,
      comparisonState,
      strengths: unique(strengths).slice(0, 6),
      risks: unique(risks).slice(0, 6),
      sourceLabel: product.sourceLabel
    },
    score
  }
}

const comparisonActionPolicy = (
  state: CatalogProductCompareState
): AgentActionPolicy => {
  if (state === 'ready') {
    return {
      state: 'compare',
      allowedNextActions: [
        {
          action: 'get_product_detail',
          label: 'Revalidate product detail',
          authority: 'limited',
          requiredActionScope: 'read:product_detail',
          reason: 'Comparison is advisory; product detail must be revalidated before cart or checkout-adjacent work.'
        },
        {
          action: 'prepare_purchase',
          label: 'Prepare selected purchase',
          authority: 'allowed',
          requiredActionScope: 'write:purchase',
          reason: 'After a shopper selects an option, Arro can prepare the purchase through the compact UCP runtime while preserving source facts and caveats.'
        }
      ]
    }
  }

  if (state === 'needs_review') {
    return {
      state: 'limited',
      allowedNextActions: [
        {
          action: 'get_product_detail',
          label: 'Refresh product detail',
          authority: 'limited',
          requiredActionScope: 'read:product_detail',
          reason: 'At least one compared option needs fresher or more complete source-backed detail.'
        },
        {
          action: 'search_products',
          label: 'Search for better-supported alternatives',
          authority: 'limited',
          requiredActionScope: 'read:search',
          reason: 'The safer path may be to find alternatives with stronger source evidence.'
        },
        {
          action: 'prepare_purchase',
          label: 'Prepare only after selection',
          authority: 'allowed',
          requiredActionScope: 'write:purchase',
          reason: 'Purchase preparation may continue only after the shopper chooses a source-backed option and Arro can preserve the current uncertainty.'
        }
      ]
    }
  }

  return {
    state: 'unavailable',
    allowedNextActions: [
      {
        action: 'search_products',
        label: 'Search supported sources',
        authority: 'limited',
        requiredActionScope: 'read:search',
        reason: 'Comparison needs at least two source-labeled products before it can be useful.'
      },
      {
        action: 'wait',
        label: 'Wait for source readiness',
        authority: 'allowed',
        reason: 'The safer path is to wait until supported source evidence is available.'
      }
    ]
  }
}

export const compareProducts = (
  request: CatalogProductCompareRequest,
  {
    requestId,
    correlationId,
    now = new Date()
  }: ProductCompareOptions
): CatalogProductCompareResponse => {
  const products = request.products
  const criteria = request.criteria ?? defaultCriteria
  const sourceMode = inferSourceMode(products, request.sourceMode)
  const lowestPrice = lowestComparablePrice(products)
  const compared = products
    .map((product) => assessProduct({ product, lowestPrice, now }))
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      return (left.assessment.price?.amountMinor ?? Number.MAX_SAFE_INTEGER) -
        (right.assessment.price?.amountMinor ?? Number.MAX_SAFE_INTEGER)
    })

  const strongestScore = compared[0]?.score
  const assessments = compared.map(({ assessment, score }) => ({
    ...assessment,
    comparisonState:
      strongestScore !== undefined &&
      score === strongestScore &&
      assessment.comparisonState === 'viable'
        ? 'stronger' as const
        : assessment.comparisonState
  }))
  const staleSourceLabelCount = products.filter((product) =>
    hasStaleSourceLabel(product, now) || hasMissingSourceBinding(product)
  ).length
  const unavailableProductCount = products.filter((product) =>
    product.availability === 'out_of_stock'
  ).length
  const currencies = currencySet(products)
  const findings: PlainStatusMessage[] = []

  if (products.length < 2) {
    findings.push(message(
      'warning',
      'comparison_more_products_required',
      'Comparison needs at least two source-labeled products.',
      'Run source-backed search or product detail before asking the user to choose.'
    ))
  }

  if (staleSourceLabelCount > 0) {
    findings.push(message(
      'warning',
      'comparison_stale_source_label',
      'One or more compared products have stale, expired, or missing source binding.',
      'Refresh product detail before acting on this comparison.'
    ))
  }

  if (unavailableProductCount > 0) {
    findings.push(message(
      'warning',
      'comparison_unavailable_product',
      'One or more compared products are out of stock.',
      'Do not use out-of-stock products as checkout candidates.'
    ))
  }

  if (currencies.size > 1) {
    findings.push(message(
      'warning',
      'comparison_mixed_currency',
      'Compared products use different currencies, so price comparison is limited.',
      'Normalize region and currency before making a price-led decision.'
    ))
  }

  if (products.some((product) => !product.price)) {
    findings.push(message(
      'info',
      'comparison_missing_price',
      'One or more products are missing price facts.',
      'Refresh product detail before treating price as decisive.'
    ))
  }

  if (findings.length === 0) {
    findings.push(message(
      'info',
      'comparison_ready',
      'Compared products have enough source-labeled facts for an advisory comparison.',
      'Revalidate product detail before any cart or checkout-adjacent action.'
    ))
  }

  const state: CatalogProductCompareState =
    products.length < 2
      ? 'unsupported_evidence'
      : staleSourceLabelCount > 0 ||
        unavailableProductCount > 0 ||
        currencies.size > 1 ||
        products.some((product) => !product.price)
        ? 'needs_review'
        : 'ready'

  return {
    requestId,
    correlationId,
    sourceMode,
    state,
    evidence: {
      productCount: products.length,
      sourceLabelCount: products.filter((product) => product.sourceLabel).length,
      staleSourceLabelCount,
      unavailableProductCount,
      hasIntentSummary: Boolean(request.intentSummary),
      criteria
    },
    assessments,
    findings,
    actionPolicy: comparisonActionPolicy(state),
    comparedAt: now.toISOString()
  }
}
