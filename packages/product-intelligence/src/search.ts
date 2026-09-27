import type {
  AgentActionPolicy,
  CatalogProductSearchInput,
  CatalogProductSummary,
  CatalogSearchRequest,
  CatalogSearchResponse,
  InterpretedSearchQuery,
  PlainStatusMessage
} from '@arro/contracts'
import {
  formatMoney,
  moneyFromDecimalString
} from '@arro/contracts'

type SearchSourcePolicy = {
  sourceMode: CatalogSearchResponse['sourceMode']
  allowedBusinessIds: string[]
  message: PlainStatusMessage
}

type SearchOptions = {
  requestId: string
  correlationId: string
  sourcePolicy: SearchSourcePolicy
  products?: CatalogProductSearchInput[]
  now?: Date
}

type CanonicalSearchIntent = {
  detectedBrands: string[]
  detectedCategories: string[]
  productTypes: string[]
  attributes: Record<string, string[]>
  requiredTerms: string[]
  excludedTerms: string[]
  sellerDomains: string[]
  minPrice?: InterpretedSearchQuery['minPrice']
  maxPrice?: InterpretedSearchQuery['maxPrice']
  sort?: InterpretedSearchQuery['sort']
}

type ScoredProduct = {
  product: CatalogProductSearchInput
  score: number
  reasons: string[]
  ordinal: number
}

const stopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'best',
  'buy',
  'for',
  'from',
  'get',
  'i',
  'in',
  'is',
  'me',
  'need',
  'new',
  'no',
  'of',
  'on',
  'or',
  'please',
  'product',
  'products',
  'show',
  'the',
  'to',
  'under',
  'want',
  'with'
])

const brandAliases = new Map([
  ['adidas', 'adidas'],
  ['apple', 'Apple'],
  ['brooks', 'Brooks'],
  ['dyson', 'Dyson'],
  ['galaxy', 'Samsung'],
  ['hp', 'HP'],
  ['iphone', 'Apple'],
  ['ios', 'Apple'],
  ['lg', 'LG'],
  ['nike', 'Nike'],
  ['reebok', 'Reebok'],
  ['samsung', 'Samsung'],
  ['sony', 'Sony']
])

const categorySignals = [
  { phrases: ['running shoe', 'running shoes', 'trail running shoe', 'trail running shoes', 'sneaker', 'sneakers'], category: 'Running Shoes', productType: 'running shoes' },
  { phrases: ['shoe', 'shoes', 'footwear'], category: 'Footwear', productType: 'shoes' },
  { phrases: ['jacket', 'coat', 'outerwear', 'rain jacket'], category: 'Jackets', productType: 'jacket' },
  { phrases: ['shirt', 't shirt', 't-shirt', 'tee'], category: 'Shirts', productType: 'shirt' },
  { phrases: ['sweater', 'crewneck', 'hoodie'], category: 'Sweaters', productType: 'sweater' },
  { phrases: ['dress'], category: 'Dresses', productType: 'dress' },
  { phrases: ['jeans', 'pants', 'trousers'], category: 'Pants', productType: 'pants' },
  { phrases: ['shorts'], category: 'Shorts', productType: 'shorts' },
  { phrases: ['socks'], category: 'Socks', productType: 'socks' },
  { phrases: ['backpack', 'bag', 'tote'], category: 'Bags', productType: 'bag' },
  { phrases: ['phone', 'phones', 'smartphone', 'smartphones', 'mobile', 'iphone'], category: 'Smartphones', productType: 'smartphone' },
  { phrases: ['headphone', 'headphones', 'earbud', 'earbuds'], category: 'Headphones', productType: 'headphones' },
  { phrases: ['laptop', 'notebook computer'], category: 'Laptops', productType: 'laptop' },
  { phrases: ['tv', 'television'], category: 'Televisions', productType: 'television' },
  { phrases: ['monitor', 'display'], category: 'Monitors', productType: 'monitor' },
  { phrases: ['camera'], category: 'Cameras', productType: 'camera' },
  { phrases: ['watch', 'smartwatch'], category: 'Watches', productType: 'watch' },
  { phrases: ['fridge', 'refrigerator', 'mini fridge'], category: 'Refrigerators', productType: 'refrigerator' },
  { phrases: ['washing machine', 'washer', 'laundry machine'], category: 'Washing Machines', productType: 'washing machine' },
  { phrases: ['vacuum', 'vacuum cleaner'], category: 'Vacuums', productType: 'vacuum cleaner' },
  { phrases: ['microwave'], category: 'Microwaves', productType: 'microwave' },
  { phrases: ['air fryer'], category: 'Air Fryers', productType: 'air fryer' },
  { phrases: ['toothbrush', 'electric toothbrush'], category: 'Oral Care', productType: 'toothbrush' },
  { phrases: ['brush', 'hair brush', 'comb'], category: 'Personal Care', productType: 'brush' },
  { phrases: ['shampoo', 'conditioner'], category: 'Hair Care', productType: 'hair care' },
  { phrases: ['soap', 'body wash'], category: 'Bath and Body', productType: 'soap' },
  { phrases: ['detergent', 'laundry detergent'], category: 'Laundry Care', productType: 'detergent' },
  { phrases: ['coffee', 'coffee beans'], category: 'Coffee', productType: 'coffee' },
  { phrases: ['mattress', 'bed', 'pillow', 'blanket', 'towel'], category: 'Bedding', productType: 'bedding' },
  { phrases: ['cookware', 'frying pan', 'saucepan', 'pan', 'pot'], category: 'Cookware', productType: 'cookware' },
  { phrases: ['chair', 'table', 'sofa', 'desk'], category: 'Furniture', productType: 'furniture' },
  { phrases: ['skincare', 'moisturizer', 'sunscreen'], category: 'Skin Care', productType: 'skincare' },
  { phrases: ['diaper', 'diapers'], category: 'Baby Care', productType: 'diapers' },
  { phrases: ['pet food', 'dog food', 'cat food'], category: 'Pet Supplies', productType: 'pet food' },
  { phrases: ['book', 'books'], category: 'Books', productType: 'book' },
  { phrases: ['toy', 'toys'], category: 'Toys', productType: 'toy' }
]

const catalogAttributeNames = new Map([
  ['color', 'Color'],
  ['colour', 'Color'],
  ['size', 'Size'],
  ['target gender', 'Target gender'],
  ['gender', 'Target gender']
])

const colors = new Set([
  'black',
  'blue',
  'brown',
  'cream',
  'gold',
  'gray',
  'green',
  'grey',
  'navy',
  'orange',
  'pink',
  'purple',
  'red',
  'silver',
  'tan',
  'white',
  'yellow'
])

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9$\.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const tokenize = (value: string) =>
  normalizeText(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

const significantTokens = (value: string) =>
  tokenize(value).filter((token) =>
    token.length > 1 &&
    !stopWords.has(token) &&
    !/^\$?\d+(?:\.\d+)?$/.test(token)
  )

const unique = <T>(values: T[]) => [...new Set(values)]

const cleanSignal = (value: string) =>
  value.trim().replace(/\s+/g, ' ').slice(0, 120)

const cleanSignals = (values: Array<string | undefined>, maxItems: number) =>
  unique(values.flatMap((value) => {
    if (!value) return []
    const cleaned = cleanSignal(value)
    return cleaned.length > 0 ? [cleaned] : []
  })).slice(0, maxItems)

const normalizeDomain = (value: string) => {
  const raw = value.trim().toLowerCase()
  if (!raw) return undefined

  const withoutProtocol = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
  const hostname = withoutProtocol.split('/')[0]?.split(':')[0]?.replace(/^www\./, '')
  if (!hostname || hostname.length > 253) return undefined
  if (!/^[a-z0-9.-]+$/.test(hostname) || !hostname.includes('.')) return undefined

  return hostname
}

const detectPrice = (query: string, currency: string, direction: 'min' | 'max') => {
  const pattern = direction === 'max'
    ? /(?:under|below|less than|max|maximum|up to)\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i
    : /(?:over|above|more than|min|minimum|at least)\s*\$?([0-9]+(?:\.[0-9]{1,2})?)/i
  const match = pattern.exec(query)
  const amount = Number(match?.[1])

  if (!Number.isFinite(amount)) return undefined

  return moneyFromDecimalString({
    amount: String(amount),
    currency
  })
}

const priceFromFilter = (
  filters: CatalogSearchRequest['filters'] | undefined,
  keys: string[],
  currency: string
) => {
  for (const key of keys) {
    const value = filters?.[key]
    const amount = typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : Number.NaN
    if (Number.isFinite(amount) && amount >= 0) {
      return moneyFromDecimalString({
        amount: String(amount),
        currency
      })
    }
  }

  return undefined
}

const arrayFromAttributeValue = (
  value: NonNullable<NonNullable<CatalogSearchRequest['intent']>['attributes']>[string]
) => Array.isArray(value) ? value : [value]

const canonicalAttributes = (request: CatalogSearchRequest) => {
  const attributes: Record<string, string[]> = {}

  for (const [name, value] of Object.entries(request.intent?.attributes ?? {})) {
    const cleanedName = cleanSignal(name)
    const key = catalogAttributeNames.get(cleanedName.toLowerCase()) ?? cleanedName
    const values = cleanSignals(arrayFromAttributeValue(value), 12)
    if (key && values.length > 0) attributes[key] = values
  }

  const tokens = significantTokens(request.query)
  const requestedColors = cleanSignals(tokens.filter((token) => colors.has(token)), 8)
  if (requestedColors.length > 0 && !attributes.Color) attributes.Color = requestedColors

  const sizeMatch = /(?:size|sz)\s*([a-z0-9. -]{1,12})/i.exec(request.query)
  if (sizeMatch?.[1] && !attributes.Size) attributes.Size = [cleanSignal(sizeMatch[1])]

  const gender = tokens.find((token) => ['men', 'mens', 'women', 'womens', 'unisex', 'kids'].includes(token))
  if (gender && !attributes['Target gender']) {
    attributes['Target gender'] = [gender.replace(/s$/, '')]
  }

  return attributes
}

const normalizedPhraseInQuery = (normalizedQuery: string, phrase: string) => {
  const normalizedPhrase = normalizeText(phrase)
  if (!normalizedPhrase) return false

  return ` ${normalizedQuery} `.includes(` ${normalizedPhrase} `)
}

const queryCategorySignals = (normalizedQuery: string) => {
  const matched = categorySignals.filter((signal) =>
    signal.phrases.some((phrase) => normalizedPhraseInQuery(normalizedQuery, phrase))
  )

  return {
    categories: cleanSignals(matched.map((signal) => signal.category), 12),
    productTypes: cleanSignals(matched.map((signal) => signal.productType), 12)
  }
}

const queryBrandSignals = (tokens: string[]) =>
  cleanSignals(tokens.flatMap((token) => brandAliases.get(token) ?? []), 12)

const sortFromQuery = (query: string): InterpretedSearchQuery['sort'] | undefined => {
  if (/\b(cheapest|lowest price|least expensive|budget)\b/i.test(query)) return 'price_asc'
  if (/\b(premium|highest price|most expensive)\b/i.test(query)) return 'price_desc'
  return undefined
}

const intentSourceForRequest = (request: CatalogSearchRequest): InterpretedSearchQuery['intentSource'] =>
  request.intent ? 'query_and_host_agent' : 'query'

const canonicalSearchIntent = (request: CatalogSearchRequest): CanonicalSearchIntent => {
  const normalizedQuery = normalizeText(request.query)
  const queryTokens = significantTokens(normalizedQuery)
  const querySignals = queryCategorySignals(normalizedQuery)
  const currency = request.context?.currency ?? request.intent?.maxPrice?.currency ?? request.intent?.minPrice?.currency ?? 'USD'
  const filterMinPrice = priceFromFilter(request.filters, ['min_price', 'minPrice'], currency)
  const filterMaxPrice = priceFromFilter(request.filters, ['max_price', 'maxPrice'], currency)
  const filterBrands = request.filters?.brand
  const filterCategories = request.filters?.category

  return {
    detectedBrands: cleanSignals([
      ...queryBrandSignals(queryTokens),
      ...(Array.isArray(filterBrands) ? filterBrands : typeof filterBrands === 'string' ? [filterBrands] : []),
      ...(request.intent?.brands ?? [])
    ], 12),
    detectedCategories: cleanSignals([
      ...querySignals.categories,
      ...(Array.isArray(filterCategories) ? filterCategories : typeof filterCategories === 'string' ? [filterCategories] : []),
      ...(request.intent?.categories ?? [])
    ], 12),
    productTypes: cleanSignals([
      ...querySignals.productTypes,
      ...(request.intent?.productTypes ?? [])
    ], 12),
    attributes: canonicalAttributes(request),
    requiredTerms: cleanSignals(request.intent?.requiredTerms ?? [], 20),
    excludedTerms: cleanSignals([
      ...(request.intent?.excludedTerms ?? []),
      ...Array.from(request.query.matchAll(/\b(?:without|not|no)\s+([a-z0-9 -]{2,40})/gi)).map((match) => match[1])
    ], 20),
    sellerDomains: cleanSignals((request.intent?.sellerDomains ?? []).flatMap((domain) => normalizeDomain(domain) ?? []), 8),
    ...(request.intent?.minPrice ?? filterMinPrice ?? detectPrice(request.query, currency, 'min')
      ? { minPrice: request.intent?.minPrice ?? filterMinPrice ?? detectPrice(request.query, currency, 'min') }
      : {}),
    ...(request.intent?.maxPrice ?? filterMaxPrice ?? detectPrice(request.query, currency, 'max')
      ? { maxPrice: request.intent?.maxPrice ?? filterMaxPrice ?? detectPrice(request.query, currency, 'max') }
      : {}),
    ...(request.intent?.sort ?? sortFromQuery(request.query)
      ? { sort: request.intent?.sort ?? sortFromQuery(request.query) }
      : {})
  }
}

export const interpretSearchQuery = (
  request: CatalogSearchRequest
): InterpretedSearchQuery => {
  const normalized = normalizeText(request.query)
  const intent = canonicalSearchIntent(request)
  const attributeConstraints = Object.entries(intent.attributes).flatMap(([name, values]) =>
    values.map((value) => `${name}: ${value}`)
  )
  const constraints = [
    ...intent.detectedBrands.map((brand) => `Brand preference: ${brand}`),
    ...intent.detectedCategories.map((category) => `Category: ${category}`),
    ...intent.productTypes.map((productType) => `Product type: ${productType}`),
    ...attributeConstraints,
    ...intent.requiredTerms.map((term) => `Must include: ${term}`),
    ...intent.excludedTerms.map((term) => `Must exclude: ${term}`),
    ...intent.sellerDomains.map((domain) => `Seller domain: ${domain}`),
    ...(intent.minPrice ? [`Price at or above ${formatMoney(intent.minPrice)}`] : []),
    ...(intent.maxPrice ? [`Price at or below ${formatMoney(intent.maxPrice)}`] : []),
    ...(intent.sort ? [`Sort: ${intent.sort}`] : [])
  ]

  return {
    raw: request.query,
    normalized,
    intentSource: intentSourceForRequest(request),
    detectedBrands: intent.detectedBrands,
    detectedCategories: intent.detectedCategories,
    productTypes: intent.productTypes,
    attributes: intent.attributes,
    requiredTerms: intent.requiredTerms,
    excludedTerms: intent.excludedTerms,
    sellerDomains: intent.sellerDomains,
    ...(intent.minPrice ? { minPrice: intent.minPrice } : {}),
    ...(intent.maxPrice ? { maxPrice: intent.maxPrice } : {}),
    ...(intent.sort ? { sort: intent.sort } : {}),
    constraints
  }
}

export const catalogSearchRequestForConnector = (
  request: CatalogSearchRequest
): CatalogSearchRequest => {
  const interpretedQuery = interpretSearchQuery(request)
  const normalizedIntent: NonNullable<CatalogSearchRequest['intent']> = {
    ...(request.intent ?? {})
  }

  if (interpretedQuery.detectedBrands.length > 0) {
    normalizedIntent.brands = interpretedQuery.detectedBrands
  }
  if (interpretedQuery.detectedCategories.length > 0) {
    normalizedIntent.categories = interpretedQuery.detectedCategories
  }
  if (interpretedQuery.productTypes.length > 0) {
    normalizedIntent.productTypes = interpretedQuery.productTypes
  }
  if (Object.keys(interpretedQuery.attributes).length > 0) {
    normalizedIntent.attributes = interpretedQuery.attributes
  }
  if (interpretedQuery.requiredTerms.length > 0) {
    normalizedIntent.requiredTerms = interpretedQuery.requiredTerms
  }
  if (interpretedQuery.excludedTerms.length > 0) {
    normalizedIntent.excludedTerms = interpretedQuery.excludedTerms
  }
  if (interpretedQuery.sellerDomains.length > 0) {
    normalizedIntent.sellerDomains = interpretedQuery.sellerDomains
  }
  if (interpretedQuery.minPrice) normalizedIntent.minPrice = interpretedQuery.minPrice
  if (interpretedQuery.maxPrice) normalizedIntent.maxPrice = interpretedQuery.maxPrice
  if (interpretedQuery.sort) normalizedIntent.sort = interpretedQuery.sort

  return Object.keys(normalizedIntent).length > 0
    ? {
        ...request,
        intent: normalizedIntent
      }
    : request
}

const textForProduct = (product: CatalogProductSearchInput) =>
  [
    product.title,
    product.brand,
    product.description,
    product.categoryPath.join(' '),
    product.tags.join(' '),
    product.seller?.name,
    product.seller?.domain
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

const tokenSetForProduct = (product: CatalogProductSearchInput) =>
  new Set(significantTokens(textForProduct(product)))

const textMatchesTerm = (searchableText: string, tokens: Set<string>, term: string) => {
  const normalized = normalizeText(term)
  if (!normalized) return false
  if (searchableText.includes(normalized)) return true

  const termTokens = significantTokens(normalized)
  return termTokens.length > 0 && termTokens.every((token) => tokens.has(token))
}

const searchTokensForInterpretedQuery = (interpretedQuery: InterpretedSearchQuery) =>
  unique([
    ...significantTokens(interpretedQuery.normalized),
    ...significantTokens(interpretedQuery.productTypes.join(' ')),
    ...significantTokens(Object.values(interpretedQuery.attributes).flat().join(' '))
  ]).slice(0, 48)

const productSellerDomain = (product: CatalogProductSearchInput) =>
  product.seller?.domain ? normalizeDomain(product.seller.domain) : undefined

const priceAmount = (product: CatalogProductSearchInput) => product.price?.amountMinor

const productHasComparablePrice = (
  product: CatalogProductSearchInput,
  money: NonNullable<InterpretedSearchQuery['minPrice']>
) => product.price?.currency === money.currency && Number.isSafeInteger(product.price.amountMinor)

const productPassesHardFilters = (
  product: CatalogProductSearchInput,
  interpretedQuery: InterpretedSearchQuery,
  searchableText: string,
  productTokens: Set<string>
) => {
  const amount = priceAmount(product)
  if (interpretedQuery.minPrice && (!productHasComparablePrice(product, interpretedQuery.minPrice) || amount! < interpretedQuery.minPrice.amountMinor)) return false
  if (interpretedQuery.maxPrice && (!productHasComparablePrice(product, interpretedQuery.maxPrice) || amount! > interpretedQuery.maxPrice.amountMinor)) return false

  for (const term of interpretedQuery.requiredTerms) {
    if (!textMatchesTerm(searchableText, productTokens, term)) return false
  }

  for (const term of interpretedQuery.excludedTerms) {
    if (textMatchesTerm(searchableText, productTokens, term)) return false
  }

  return true
}

const scoreProduct = (
  product: CatalogProductSearchInput,
  interpretedQuery: InterpretedSearchQuery,
  tokens: string[],
  ordinal: number
): ScoredProduct | undefined => {
  const searchableText = textForProduct(product)
  const productTokens = tokenSetForProduct(product)
  if (!productPassesHardFilters(product, interpretedQuery, searchableText, productTokens)) return undefined

  const reasons: string[] = []
  let score = 0
  let coreIntentMatched = false

  if (searchableText.includes(interpretedQuery.normalized)) {
    score += 12
    coreIntentMatched = true
    reasons.push('Title or description closely matches the search text.')
  }

  for (const token of tokens) {
    if (product.title.toLowerCase().includes(token)) score += 5
    else if (product.brand?.toLowerCase().includes(token)) score += 4
    else if (product.tags.some((tag) => normalizeText(tag).includes(token))) score += 3
    else if (productTokens.has(token)) score += 2
    else if (searchableText.includes(token)) score += 1
  }

  for (const productType of interpretedQuery.productTypes) {
    if (textMatchesTerm(searchableText, productTokens, productType)) {
      score += 8
      coreIntentMatched = true
      reasons.push(`Product type matches ${productType}.`)
    }
  }

  for (const category of interpretedQuery.detectedCategories) {
    const normalizedCategory = normalizeText(category)
    const categoryMatch = product.categoryPath.some((path) =>
      normalizeText(path).includes(normalizedCategory) || normalizedCategory.includes(normalizeText(path))
    )
    if (categoryMatch || textMatchesTerm(searchableText, productTokens, category)) {
      score += 6
      coreIntentMatched = true
      reasons.push(`Category matches ${category}.`)
    }
  }

  if (interpretedQuery.sellerDomains.length > 0) {
    const sellerDomain = productSellerDomain(product)
    if (sellerDomain && interpretedQuery.sellerDomains.includes(sellerDomain)) {
      score += 5
      reasons.push(`Seller matches ${sellerDomain}.`)
    }
  }

  for (const brand of interpretedQuery.detectedBrands) {
    const normalizedBrand = normalizeText(brand)
    if (product.brand && normalizeText(product.brand) === normalizedBrand) {
      score += 8
      reasons.push(`Brand matches ${product.brand}.`)
    } else if (textMatchesTerm(searchableText, productTokens, brand)) {
      score += 3
      reasons.push(`Product facts mention ${brand}.`)
    }
  }

  for (const [name, values] of Object.entries(interpretedQuery.attributes)) {
    const matchingValues = values.filter((value) => textMatchesTerm(searchableText, productTokens, value))
    if (matchingValues.length > 0) {
      score += matchingValues.length * 4
      reasons.push(`${name} matches ${matchingValues.slice(0, 2).join(', ')}.`)
    }
  }

  if (
    (interpretedQuery.productTypes.length > 0 || interpretedQuery.detectedCategories.length > 0) &&
    !coreIntentMatched
  ) {
    return undefined
  }

  if (score <= 0) return undefined

  if (product.availability === 'in_stock') score += 3
  if (product.condition === 'new') score += 2
  if (interpretedQuery.maxPrice && productHasComparablePrice(product, interpretedQuery.maxPrice)) {
    score += 2
    reasons.push(`Price is within ${formatMoney(interpretedQuery.maxPrice)}.`)
  }
  if (interpretedQuery.minPrice && productHasComparablePrice(product, interpretedQuery.minPrice)) {
    score += 1
  }

  if (reasons.length === 0) reasons.push('Product metadata matches the search terms.')

  return {
    product,
    score,
    reasons: unique(reasons).slice(0, 4),
    ordinal
  }
}

const compareScoredProducts = (
  left: ScoredProduct,
  right: ScoredProduct,
  sort: InterpretedSearchQuery['sort']
) => {
  const sameCurrency = left.product.price?.currency && left.product.price.currency === right.product.price?.currency
  const leftPrice = sameCurrency ? left.product.price?.amountMinor : undefined
  const rightPrice = sameCurrency ? right.product.price?.amountMinor : undefined

  // Once products have passed intent matching, an explicit price sort must mean
  // price-first ordering. Ranking score remains the tie-breaker, not a hidden
  // primary sort that can make “Lowest price” appear incorrect to shoppers.
  if (sort === 'price_asc' && leftPrice !== rightPrice) {
    if (leftPrice === undefined) return 1
    if (rightPrice === undefined) return -1
    return leftPrice - rightPrice
  }

  if (sort === 'price_desc' && leftPrice !== rightPrice) {
    if (leftPrice === undefined) return 1
    if (rightPrice === undefined) return -1
    return rightPrice - leftPrice
  }

  if (right.score !== left.score) return right.score - left.score

  if (leftPrice !== undefined && rightPrice !== undefined && leftPrice !== rightPrice) {
    return leftPrice - rightPrice
  }

  return left.ordinal - right.ordinal
}

type ScoredProductGroup = {
  key: string
  products: ScoredProduct[]
  bestRelevance: ScoredProduct
  lowestComparablePrice: { amountMinor: number; currency: string } | undefined
  ordinal: number
}

const scoredProductGroupKey = (product: CatalogProductSearchInput) =>
  `${product.businessId}:${product.productId}`

const groupLowestComparablePrice = (products: ScoredProduct[]) => {
  const priced = products.filter((candidate) => candidate.product.price)
  if (priced.length === 0) return undefined
  const currencies = new Set(priced.map((candidate) => candidate.product.price!.currency))
  if (currencies.size !== 1) return undefined

  return {
    amountMinor: Math.min(...priced.map((candidate) => candidate.product.price!.amountMinor)),
    currency: priced[0]!.product.price!.currency
  }
}

const compareScoredProductGroups = (
  left: ScoredProductGroup,
  right: ScoredProductGroup,
  sort: InterpretedSearchQuery['sort']
) => {
  const leftPrice = left.lowestComparablePrice
  const rightPrice = right.lowestComparablePrice
  const pricesComparable = leftPrice && rightPrice && leftPrice.currency === rightPrice.currency

  if (sort === 'price_asc') {
    if (leftPrice === undefined && rightPrice !== undefined) return 1
    if (rightPrice === undefined && leftPrice !== undefined) return -1
    if (pricesComparable && leftPrice.amountMinor !== rightPrice.amountMinor) {
      return leftPrice.amountMinor - rightPrice.amountMinor
    }
  }

  if (sort === 'price_desc') {
    if (leftPrice === undefined && rightPrice !== undefined) return 1
    if (rightPrice === undefined && leftPrice !== undefined) return -1
    if (pricesComparable && leftPrice.amountMinor !== rightPrice.amountMinor) {
      return rightPrice.amountMinor - leftPrice.amountMinor
    }
  }

  const relevance = compareScoredProducts(left.bestRelevance, right.bestRelevance, 'relevance')
  if (relevance !== 0) return relevance
  return left.ordinal - right.ordinal
}

const topScoredProducts = ({
  products,
  allowedBusinessIds,
  interpretedQuery,
  tokens,
  limit
}: {
  products: CatalogProductSearchInput[]
  allowedBusinessIds: Set<string>
  interpretedQuery: InterpretedSearchQuery
  tokens: string[]
  limit: number
}) => {
  if (limit <= 0) return []

  const grouped = new Map<string, ScoredProduct[]>()
  let ordinal = 0

  for (const product of products) {
    const productOrdinal = ordinal
    ordinal += 1

    if (!allowedBusinessIds.has(product.businessId)) continue

    const scoredProduct = scoreProduct(product, interpretedQuery, tokens, productOrdinal)
    if (!scoredProduct) continue

    const key = scoredProductGroupKey(product)
    const group = grouped.get(key)
    if (group) group.push(scoredProduct)
    else grouped.set(key, [scoredProduct])
  }

  const productGroups: ScoredProductGroup[] = [...grouped.entries()].map(([key, candidates]) => {
    const relevanceSorted = [...candidates].sort((left, right) =>
      compareScoredProducts(left, right, 'relevance')
    )

    return {
      key,
      products: candidates,
      bestRelevance: relevanceSorted[0]!,
      lowestComparablePrice: groupLowestComparablePrice(candidates),
      ordinal: Math.min(...candidates.map((candidate) => candidate.ordinal))
    }
  })

  productGroups.sort((left, right) =>
    compareScoredProductGroups(left, right, interpretedQuery.sort)
  )

  // Pagination limit is a canonical source-product budget, matching UCP catalog
  // semantics. Once a product group is selected, preserve every qualified seller
  // offer for that authoritative product identity rather than truncating merchants.
  return productGroups
    .slice(0, limit)
    .flatMap((group) => [...group.products].sort((left, right) =>
      compareScoredProducts(left, right, 'relevance')
    ))
}

const toCatalogProductSummary = (
  scoredProduct: ScoredProduct
): CatalogProductSummary => {
  const { product, reasons } = scoredProduct
  const { tags: _tags, ...summary } = product

  return {
    ...summary,
    matchReasons: reasons
  }
}

const productsForSourceMode = ({
  sourceMode,
  products
}: {
  sourceMode: CatalogSearchResponse['sourceMode']
  products: CatalogProductSearchInput[] | undefined
}) => {
  if (products) return products

  return []
}

const noMatchMessage = (
  sourceMode: CatalogSearchResponse['sourceMode']
): PlainStatusMessage => {
  if (sourceMode === 'approved_sources') {
    return {
      severity: 'info',
      code: 'approved_catalog_no_match',
      text: 'No approved catalog products matched this search.',
      nextAction: 'Verify approved source freshness, catalog product coverage, and structured intent before expanding search.'
    }
  }

  if (sourceMode === 'connected_sources') {
    return {
      severity: 'info',
      code: 'connected_catalog_no_match',
      text: 'No connected catalog products matched this search.',
      nextAction: 'Verify connector coverage, product metadata, structured intent, and query mapping before expanding traffic.'
    }
  }

  return {
    severity: 'info',
    code: 'catalog_sources_unconfigured',
    text: 'Product search is not connected to approved or official catalog sources yet.',
    nextAction: 'Connect approved UCP or official catalog sources for live product results.'
  }
}

export const searchActionPolicy = (
  state: CatalogSearchResponse['state'],
  itemCount: number
): AgentActionPolicy => {
  if (state === 'ready' || state === 'limited') {
    return {
      state: state === 'limited' ? 'limited' : 'read',
      allowedNextActions: [
        {
          action: 'get_product_detail',
          label: 'Inspect product detail',
          authority: state === 'limited' ? 'limited' : 'allowed',
          requiredActionScope: 'read:product_detail',
          reason: `${itemCount} source-labeled product result${itemCount === 1 ? '' : 's'} can be inspected before any checkout-impacting action.`
        },
        {
          action: 'compare_products',
          label: 'Compare returned products',
          authority: 'allowed',
          requiredActionScope: 'read:compare',
          reason: 'Comparison remains advisory and must keep source labels, caveats, and current freshness state visible.'
        },
        {
          action: 'prepare_purchase',
          label: 'Prepare selected purchase',
          authority: 'allowed',
          requiredActionScope: 'write:purchase',
          reason: 'After the shopper selects a source-labeled result, Arro can prepare the purchase through the compact UCP runtime.'
        }
      ]
    }
  }

  return {
    state: 'unavailable',
    allowedNextActions: [
      {
        action: 'search_products',
        label: 'Try another supported search',
        authority: 'limited',
        requiredActionScope: 'read:search',
        reason: 'No current source-labeled result is ready for checkout-impacting work.'
      },
      {
        action: 'wait',
        label: 'Wait for source readiness',
        authority: 'allowed',
        reason: 'The safer path is to wait until an approved or official source can answer.'
      }
    ]
  }
}

export const searchCatalog = (
  request: CatalogSearchRequest,
  options: SearchOptions
): CatalogSearchResponse => {
  const now = options.now ?? new Date()
  const interpretedQuery = interpretSearchQuery(request)
  const interpretedQueryTokens = searchTokensForInterpretedQuery(interpretedQuery)

  if (
    options.sourcePolicy.sourceMode === 'unconfigured' ||
    options.sourcePolicy.allowedBusinessIds.length === 0
  ) {
    return {
      requestId: options.requestId,
      correlationId: options.correlationId,
      sourceMode: options.sourcePolicy.sourceMode,
      interpretedQuery,
      state: 'unavailable',
      items: [],
      messages: [options.sourcePolicy.message],
      actionPolicy: searchActionPolicy('unavailable', 0),
      fetchedAt: now.toISOString()
    }
  }

  const limit = Math.max(Math.trunc(request.pagination?.limit ?? 10), 0)
  const allowedBusinessIds = new Set(options.sourcePolicy.allowedBusinessIds)
  const scoredProducts = topScoredProducts({
    products: productsForSourceMode({
      sourceMode: options.sourcePolicy.sourceMode,
      products: options.products
    }),
    allowedBusinessIds,
    interpretedQuery,
    tokens: interpretedQueryTokens,
    limit
  })

  const items = scoredProducts.map((product) =>
    toCatalogProductSummary(product)
  )
  const state = items.length > 0
    ? 'ready'
    : 'unavailable'

  return {
    requestId: options.requestId,
    correlationId: options.correlationId,
    sourceMode: options.sourcePolicy.sourceMode,
    interpretedQuery,
    state,
    items,
    messages: [
      options.sourcePolicy.message,
      ...(items.length > 0
        ? []
        : [noMatchMessage(options.sourcePolicy.sourceMode)])
    ],
    actionPolicy: searchActionPolicy(state, items.length),
    fetchedAt: now.toISOString()
  }
}
