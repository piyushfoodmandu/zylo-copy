import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { getProductDetail, preparePurchase, type ProductDetailSelection } from '../api/client'
import { Breadcrumb } from '../components/Breadcrumb'
import { Carousel } from '../components/Carousel'
import { Icon } from '../components/Icon'
import { Appear, Tappable } from '../components/motion'
import { Shell } from '../components/Page'
import { ProductImage } from '../components/ProductImage'
import { ProductLink } from '../components/ProductLink'
import { SaveButton } from '../components/SaveButton'
import { SiteFooter } from '../components/SiteFooter'
import { HandoffSheet } from '../components/HandoffSheet'
import { DetailSkeleton } from '../components/skeletons'
import { Heading } from '../components/semantic'
import { Badge, Button, Notice, Stars } from '../components/ui'
import { cartLineKey } from '../lib/cart'
import { heroImageSizes, thumbImageSizes } from '../lib/image-url'
import { useDocumentTitle } from '../lib/document-title'
import { useLayoutMode } from '../lib/layout'
import { formatMoney } from '../lib/money'
import { productGroupKey } from '../lib/product-groups'
import { availabilityLabel, freshnessLabel, soldByLabel } from '../lib/product-display'
import { conditionLabel } from '../lib/facets'
import type { ProductIdentity } from '../lib/product-url'
import { categoryForQuery, productBrowseTrail, relatedSearches } from '../lib/categories'
import { categoryHref, productHref, searchHref } from '../lib/product-url'
import { isPreparedCheckout } from '../lib/purchase-capability'
import { shareProduct } from '../lib/share-product'
import { shopperErrorText } from '../lib/shopper-copy'
import { color } from '../lib/theme'
import { useCartStore } from '../store/useCartStore'
import { useCheckoutStore } from '../store/useCheckoutStore'
import { useAlertsStore } from '../store/useAlertsStore'
import { useSavedStore } from '../store/useSavedStore'
import { buyerFromDetails, useShopperStore } from '../store/useShopperStore'
import { useShopStore } from '../store/useShopStore'
import type { CatalogProductDetail, CatalogProductSummary, Money } from '../types/catalog'
import type { PurchaseResponse } from '../types/purchase'

type DisplayOffer = {
  key: string
  productId: string
  title: string
  seller?: CatalogProductSummary['seller']
  businessName: string
  variantId?: string
  price?: Money
  availability: CatalogProductSummary['availability']
  condition: CatalogProductSummary['condition']
  productUrl?: string
  handoff?: CatalogProductSummary['handoff']
  fetchedAt: string
  /** The option values that distinguish this offer, e.g. "256GB · Black". */
  options?: string
}

const sellerKey = (seller: CatalogProductSummary['seller'] | undefined, businessName: string) =>
  seller?.domain || seller?.id || `business:${businessName}`

const isAvailable = (availability: CatalogProductSummary['availability']) =>
  availability === 'in_stock' || availability === 'limited'

/**
 * The currency most offers are priced in. Offers outside it are still shown,
 * but they sort after the comparable group: one foreign-currency listing must
 * not be allowed to scramble the ordering of every offer a shopper can compare.
 */
const primaryCurrencyOf = (offers: DisplayOffer[]) => {
  const counts = new Map<string, number>()
  for (const offer of offers) {
    if (!offer.price) continue
    counts.set(offer.price.currency, (counts.get(offer.price.currency) ?? 0) + 1)
  }
  let primary: string | undefined
  let best = 0
  for (const [currency, count] of counts) {
    if (count > best) { primary = currency; best = count }
  }
  return primary
}

const rankOffers = (offers: DisplayOffer[], primaryCurrency = primaryCurrencyOf(offers)) => {
  const comparable = (offer: DisplayOffer) => Boolean(offer.price && offer.price.currency === primaryCurrency)
  return [...offers].sort((left, right) => {
    if (isAvailable(left.availability) !== isAvailable(right.availability)) return isAvailable(left.availability) ? -1 : 1
    if (comparable(left) !== comparable(right)) return comparable(left) ? -1 : 1
    if (comparable(left) && comparable(right)) return left.price!.amountMinor - right.price!.amountMinor
    if (!left.price && right.price) return 1
    if (left.price && !right.price) return -1
    return 0
  })
}

const normalizedOption = (value: string) => value.trim().toLocaleLowerCase()

const sameSelectedValue = (
  left: { label: string; id?: string },
  right: { label: string; id?: string }
) => {
  if (left.id && right.id) return left.id === right.id
  return normalizedOption(left.label) === normalizedOption(right.label)
}

const selectionFor = <T extends { name: string }>(items: T[], name: string) =>
  items.find((item) => normalizedOption(item.name) === normalizedOption(name))

/**
 * Whether a variant is the effective configuration. A variant that names an
 * axis and disagrees is a different SKU. A variant that never names the axis
 * cannot be judged either way — the source narrowed to it for some reason we
 * cannot see, which is weaker evidence than a match but not a contradiction.
 */
const variantAgreement = (
  variant: CatalogProductDetail['variants'][number],
  selected: CatalogProductDetail['selected']
): 'match' | 'mismatch' | 'unknown' => {
  if (selected.length === 0) return 'unknown'

  let confirmed = 0
  for (const effective of selected) {
    const actual = selectionFor(variant.selectedOptions, effective.name)
    if (!actual) continue
    if (!sameSelectedValue(effective, actual)) return 'mismatch'
    confirmed += 1
  }

  return confirmed === selected.length ? 'match' : 'unknown'
}

const offersFromDetail = (detail: CatalogProductDetail): DisplayOffer[] => {
  const byMerchant = new Map<string, DisplayOffer>()

  // Narrowing to the effective configuration keeps a chosen 512 GB from being
  // ranked against a cheaper 256 GB SKU. Variants that cannot be judged stand in
  // when nothing matches outright, because a source that omits per-variant
  // options would otherwise leave the shopper with no offers at all. Variants
  // that contradict the configuration on screen never stand in — that is the
  // wrong-SKU bug the narrowing exists to prevent.
  // A response missing `selected` — an older API, a partial payload — must not
  // take the page down. Absent is treated as "nothing selected", which is what
  // it means.
  const effective = detail.selected ?? []
  const agreement = (detail.variants ?? []).map((variant) => [variant, variantAgreement(variant, effective)] as const)
  const matched = agreement.filter(([, verdict]) => verdict === 'match')
  const selectedVariants = (matched.length > 0 ? matched : agreement.filter(([, verdict]) => verdict === 'unknown'))
    .map(([variant]) => variant)

  for (const variant of selectedVariants) {
    if (!variant.seller) continue
    const candidate: DisplayOffer = {
      key: `${sellerKey(variant.seller, detail.businessName)}:${variant.variantId}`,
      productId: detail.productId,
      title: detail.title,
      seller: variant.seller,
      businessName: variant.seller.name || detail.businessName,
      variantId: variant.variantId,
      price: variant.price,
      availability: variant.availability,
      condition: variant.condition ?? detail.condition,
      productUrl: variant.productUrl,
      handoff: variant.handoff,
      fetchedAt: detail.sourceLabel.fetchedAt,
      ...(optionSummary(variant.selectedOptions, detail.title)
        ? { options: optionSummary(variant.selectedOptions, detail.title) }
        : {})
    }
    const identity = sellerKey(candidate.seller, candidate.businessName)
    const current = byMerchant.get(identity)
    if (!current || rankOffers([candidate, current])[0] === candidate) byMerchant.set(identity, candidate)
  }

  if (byMerchant.size === 0) {
    byMerchant.set(sellerKey(detail.seller, detail.businessName), {
      key: `${sellerKey(detail.seller, detail.businessName)}:${detail.variantId ?? detail.productId}`,
      productId: detail.productId,
      title: detail.title,
      seller: detail.seller,
      businessName: detail.seller?.name || detail.businessName,
      ...(detail.variantId ? { variantId: detail.variantId } : {}),
      price: detail.price,
      availability: detail.availability,
      condition: detail.condition,
      productUrl: detail.productUrl,
      handoff: detail.handoff,
      fetchedAt: detail.sourceLabel.fetchedAt
    })
  }

  return rankOffers([...byMerchant.values()])
}

const offersFromSummaries = (items: CatalogProductSummary[]): DisplayOffer[] => rankOffers(items.map((item) => ({
  key: `${sellerKey(item.seller, item.businessName)}:${item.variantId ?? item.productId}`,
  productId: item.productId,
  title: item.title,
  seller: item.seller,
  businessName: item.seller?.name || item.businessName,
  ...(item.variantId ? { variantId: item.variantId } : {}),
  price: item.price,
  availability: item.availability,
  condition: item.condition,
  productUrl: item.productUrl,
  handoff: item.handoff,
  fetchedAt: item.sourceLabel.fetchedAt
})))

const sameCompareProduct = (candidate: CatalogProductSummary, product: CatalogProductSummary) =>
  candidate.businessId === product.businessId &&
  candidate.productId === product.productId &&
  candidate.variantId === product.variantId

const warningCopy = (code: string) => {
  if (code.includes('availability')) return 'Availability may change before checkout.'
  if (code.includes('price')) return 'The final price can change when the shop calculates shipping or tax.'
  if (code.includes('variant')) return 'Check the exact size, colour or model before you pay.'
  return 'Check the shop details before placing the order.'
}

/** Values a shop fills in because the schema demands one, not because it means anything. */
const placeholderValue = (value: string | undefined, title: string) => {
  const normalised = (value ?? '').trim().toLowerCase()
  return normalised === '' ||
    normalised === 'none' ||
    normalised === 'default title' ||
    normalised === 'default' ||
    normalised === title.trim().toLowerCase()
}

/**
 * Every option axis the shops published, from the product and from its variants.
 *
 * The previous rule kept only options with more than one value, on the grounds
 * that a single value is a placeholder. That is true of "Title: Default Title"
 * and badly wrong of "Configuration: Intel Core i5-13420H / RTX 4050 6GB" —
 * the single most useful line on a laptop's page. This catalogue returns no
 * brand and no category, so discarding single-value options left the
 * specification table with nothing in it at all.
 *
 * Placeholders are filtered by what they say, not by how many of them there are.
 */
const productOptions = (detail: CatalogProductDetail | undefined) => {
  if (!detail) return []
  const axes = new Map<string, CatalogProductDetail['options'][number]['values']>()

  const add = (name: string, raw: unknown) => {
    // Some sources — and any older deployment of our own API — describe an
    // option value as a plain string rather than a labelled object. Normalising
    // here keeps one malformed payload from taking the whole page down.
    const value = typeof raw === 'string'
      ? { label: raw }
      : (raw as CatalogProductDetail['options'][number]['values'][number] | undefined)
    if (!value?.label || !name?.trim() || placeholderValue(value.label, detail.title)) return
    const values = axes.get(name) ?? []
    const existing = values.find((candidate) => sameSelectedValue(candidate, value))
    if (!existing) values.push(value)
    axes.set(name, values)
  }

  for (const option of detail.options ?? []) {
    for (const value of option.values ?? []) add(option.name, value)
  }
  for (const variant of detail.variants ?? []) {
    for (const option of variant.selectedOptions ?? []) add(option.name, option)
  }

  return [...axes.entries()]
    .filter(([, values]) => values.length > 0)
    .map(([name, values]) => ({ name, values }))
}

const configurableOptions = (detail: CatalogProductDetail | undefined) =>
  productOptions(detail).filter((option) => option.values.length > 1)

/**
 * A shop that packs a whole configuration into one string separates the parts
 * with a slash. Splitting it gives the table one fact per row instead of a
 * paragraph in a cell, and it is still only what the shop wrote.
 */
const splitSpecValue = (value: string) =>
  value.split(/\s+\/\s+/).map((part) => part.trim()).filter(Boolean)

/** The option values that distinguish one offer from another, as one line. */
const optionSummary = (
  selected: Array<{ name: string; label: string; id?: string }> | undefined,
  title: string
) => (selected ?? [])
  .filter((option) => !placeholderValue(option.label, title))
  .map((option) => option.label.trim())
  .join(' · ')

const galleryImages = (detail: CatalogProductDetail | undefined, fallback: string | undefined) => {
  const urls = [
    ...(detail?.imageUrl ? [detail.imageUrl] : []),
    ...(detail?.media ?? []).filter((media) => media.type === 'image').map((media) => media.url),
    ...(fallback ? [fallback] : [])
  ]
  return [...new Set(urls)].slice(0, 8)
}

export type DetailScreenProps = {
  identity: ProductIdentity | undefined
  /** Server-rendered detail, so the first paint already has the real product. */
  initialDetail?: CatalogProductDetail | undefined
  initialVariantUnconfirmed?: boolean
}

export function DetailScreen({ identity, initialDetail, initialVariantUnconfirmed }: DetailScreenProps) {
  const router = useRouter()
  const businessId = identity?.businessId ?? ''
  const productId = identity?.productId ?? ''
  const variantId = identity?.variantId
  const { desktop, width } = useLayoutMode()
  const selectedProduct = useShopStore((state) => state.selectedProduct)
  const selectedOffers = useShopStore((state) => state.selectedOffers)
  const compare = useShopStore((state) => state.compare)
  const toggleCompare = useShopStore((state) => state.toggleCompare)
  const addToCart = useCartStore((state) => state.add)
  const cartLines = useCartStore((state) => state.lines)
  const recordView = useSavedStore((state) => state.view)
  const setPrepared = useCheckoutStore((state) => state.setPrepared)
  const shopper = useShopperStore((state) => state)
  const [detail, setDetail] = useState<CatalogProductDetail | undefined>(initialDetail)
  const [loading, setLoading] = useState(!initialDetail)
  const [error, setError] = useState<string>()
  const [buyingKey, setBuyingKey] = useState<string>()
  const [addedKey, setAddedKey] = useState<string>()
  const [handoff, setHandoff] = useState<PurchaseResponse>()
  const [activeImage, setActiveImage] = useState(0)
  const [variantUnconfirmed, setVariantUnconfirmed] = useState(Boolean(initialVariantUnconfirmed))
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const [explicitSelections, setExplicitSelections] = useState<ProductDetailSelection[]>([])
  const [resolvingOption, setResolvingOption] = useState<string>()
  const [selectionMessage, setSelectionMessage] = useState<string>()
  const [shareFeedback, setShareFeedback] = useState<string>()
  const optionRequest = useRef<AbortController | null>(null)
  const shareFeedbackTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (!businessId || !productId) {
      setLoading(false)
      setError('That link did not work. Try searching for the product.')
      return
    }
    // The server already resolved this exact product for the first paint, so a
    // second identical fetch on hydration would only cost the shopper latency.
    if (initialDetail && initialDetail.businessId === businessId && initialDetail.productId === productId) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError(undefined)
    setActiveImage(0)
    setVariantUnconfirmed(false)
    setExplicitSelections([])
    setSelectionMessage(undefined)
    optionRequest.current?.abort()
    void getProductDetail({ businessId, productId, ...(variantId ? { variantId } : {}) }, controller.signal)
      .then((response) => {
        if (!response.product) {
          setError('This product is not available right now.')
          return
        }
        setDetail(response.product)
        setVariantUnconfirmed(Boolean(response.variantUnconfirmed))
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(shopperErrorText(caught, 'We could not load this product. Try again.'))
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [businessId, initialDetail, productId, variantId])

  useEffect(() => () => {
    optionRequest.current?.abort()
    clearTimeout(shareFeedbackTimer.current)
  }, [])

  const summary = selectedProduct?.businessId === businessId && selectedProduct.productId === productId
    ? selectedProduct
    : undefined
  const product = detail ?? summary
  // Detail responses carry no rating, so the rating the shopper already saw in
  // results is the only one available. Dropping it would look like a downgrade.
  const rating = detail?.rating ?? summary?.rating

  const displayOffers = useMemo(() => {
    if (detail) return offersFromDetail(detail)
    const relevant = selectedOffers.filter((offer) => offer.businessId === businessId && offer.productId === productId)
    return offersFromSummaries(relevant.length ? relevant : summary ? [summary] : [])
  }, [businessId, detail, productId, selectedOffers, summary])

  /**
   * The fullest copy the shops published.
   *
   * A cluster's product-level description is usually a one-line summary while
   * the variant carries the page a shopper would actually read — for this
   * catalogue, 137 characters against 2,693. Taking the longer of the two is
   * what turns a stub into a product page.
   */
  const description = useMemo(() => {
    const candidates = [
      detail?.description,
      ...(detail?.variants ?? []).map((variant) => variant.description)
    ].filter((value): value is string => Boolean(value?.trim()))
    return candidates.sort((left, right) => right.length - left.length)[0] ?? product?.description
  }, [detail, product])

  const bestOffer = displayOffers[0]
  const merchantCount = new Set(displayOffers.map((offer) => sellerKey(offer.seller, offer.businessName))).size
  const primaryCurrency = primaryCurrencyOf(displayOffers)
  const comparableOffers = displayOffers.filter((offer) => offer.price?.currency === primaryCurrency)
  const comparablePrices = comparableOffers.length > 1 && bestOffer?.price?.currency === primaryCurrency
  const highestOffer = comparablePrices
    ? comparableOffers.reduce((left, right) => (right.price!.amountMinor > left.price!.amountMinor ? right : left))
    : undefined
  const showRange = Boolean(highestOffer && highestOffer.price!.amountMinor !== bestOffer?.price?.amountMinor)
  const images = useMemo(() => galleryImages(detail, summary?.imageUrl), [detail, summary?.imageUrl])
  const options = useMemo(() => productOptions(detail), [detail])
  const selectableOptions = useMemo(() => configurableOptions(detail), [detail])
  // An axis needs a shopper decision only when it offers more than one value
  // the source will actually sell. Where the alternatives are unavailable there
  // is nothing to choose, so the effective selection settles it and the shopper
  // is not asked to confirm the only value they could have picked.
  const unsettledOptions = selectableOptions.filter((option) => {
    if (selectionFor(explicitSelections, option.name)) return false
    if (!selectionFor(detail?.selected ?? [], option.name)) return true
    return option.values.filter((value) => value.available !== false && value.exists !== false).length > 1
  })
  const effectiveSelectionComplete = unsettledOptions.length === 0
  const explicitSelectionsHonoured = explicitSelections.every((wanted) => {
    const effective = selectionFor(detail?.selected ?? [], wanted.name)
    return Boolean(effective && sameSelectedValue(wanted, effective))
  })
  // "Choose options" makes the shopper hunt for which one. Naming the open axis
  // turns the button into its own instruction and removes the need for a notice
  // repeating it underneath.
  const chooseLabel = unsettledOptions.length === 1
    ? `Choose ${unsettledOptions[0]!.name.toLowerCase()}`
    : 'Choose options'
  const selectionTouched = explicitSelections.length > 0
  const exactConfigurationReady = !variantUnconfirmed && explicitSelectionsHonoured && (
    selectableOptions.length === 0 ||
    (!selectionTouched && Boolean(detail?.variantId ?? variantId)) ||
    effectiveSelectionComplete
  )
  const canCheckoutBestOffer = Boolean(
    bestOffer &&
    bestOffer.availability !== 'out_of_stock' &&
    exactConfigurationReady &&
    (selectableOptions.length === 0 || bestOffer.variantId)
  )
  const categoryPath = (product?.categoryPath ?? []).filter((part) => part.toLowerCase() !== 'catalog')

  /**
   * Every level the source named, plus the Arro category it belongs to when one
   * matches. The catalogue's own path is often one or two levels deep, so the
   * browse category is what makes the trail navigable rather than decorative.
   */
  const breadcrumbTrail = useMemo(() => {
    return productBrowseTrail(product?.title ?? '', categoryPath).map((item) => ({
      name: item.name,
      href: item.kind === 'category' ? categoryHref(item.query) : searchHref(item.query)
    }))
  }, [categoryPath, product?.title])

  /**
   * Attributes the shops actually published. Product name, offer count, rating
   * and freshness all appear above already, so repeating them here would pad
   * the table without telling the reader anything new.
   */
  const specRows = useMemo(() => {
    const rows: Array<readonly [string, string]> = []

    // The effective variant selection is the fact on screen. Keep it ahead of
    // a product-level specification that may describe a different default SKU
    // (for example selected Gray while the base product says Color: Black).
    for (const selected of detail?.selected ?? []) {
      if (!placeholderValue(selected.label, detail?.title ?? '')) {
        rows.push([selected.name, selected.label] as const)
      }
    }

    // What the shop published about the product itself, before the axes it is
    // merely sold along.
    for (const spec of detail?.specifications ?? []) {
      rows.push([spec.label, spec.value] as const)
    }

    for (const option of options) {
      const single = option.values.length === 1 ? option.values[0]!.label : undefined
      const parts = single ? splitSpecValue(single) : []
      if (single && parts.length > 1 && single.length > 40) {
        // One packed configuration string reads as a list under one label, not
        // as "Configuration 2", which is a label the shop never wrote.
        rows.push([option.name, parts.join('\n')] as const)
        continue
      }
      rows.push([option.name, option.values.slice(0, 12).map((value) => value.label).join(', ')] as const)
    }

    if (categoryPath.length > 0) rows.unshift(['Category', categoryPath.join(' / ')] as const)
    if (product?.brand) rows.unshift(['Brand', product.brand] as const)
    if (product && product.condition !== 'unknown') {
      rows.push(['Condition', conditionLabel(product.condition)] as const)
    }

    // A shop can publish "Condition" as a specification while the source also
    // sells it as an option axis, and the table keys on the label. Keeping the
    // first writer keeps merchant-published facts ahead of derived ones and
    // stops React from seeing two rows with the same key.
    const seen = new Set<string>()
    return rows.filter(([label, value]) => {
      if (!value) return false
      const key = label.trim().toLocaleLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [categoryPath, detail, options, product])

  const related = useMemo(
    // Only a real category earns this rail. Falling back to the generic popular
    // searches puts "running shoes" under a phone, which tells the shopper
    // nothing about what they are looking at.
    () => {
      const query = categoryPath[0] ?? product?.title
      return query && categoryForQuery(query) ? relatedSearches(query, 8) : []
    },
    [categoryPath, product]
  )

  const comparisonProduct = useMemo<CatalogProductSummary | undefined>(() => {
    if (!product) return undefined
    if (!detail) return product as CatalogProductSummary
    return {
      productId: detail.productId,
      businessId: detail.businessId,
      businessName: detail.businessName,
      title: detail.title,
      ...(detail.brand ? { brand: detail.brand } : {}),
      ...(detail.description ? { description: detail.description } : {}),
      categoryPath: detail.categoryPath,
      ...(detail.variantId ? { variantId: detail.variantId } : {}),
      ...(detail.price ? { price: detail.price } : {}),
      availability: detail.availability,
      condition: detail.condition,
      ...(detail.productUrl ? { productUrl: detail.productUrl } : {}),
      ...(detail.imageUrl ? { imageUrl: detail.imageUrl } : {}),
      ...(rating ? { rating } : {}),
      ...(detail.seller ? { seller: detail.seller } : {}),
      ...(detail.handoff ? { handoff: detail.handoff } : {}),
      matchReasons: [],
      sourceLabel: detail.sourceLabel
    }
  }, [detail, product, rating])

  // A cart line is a merchant offer, not the product identity, so each offer row
  // carries its own seller, variant and price into the cart.
  const cartProductFor = useCallback((offer: DisplayOffer): CatalogProductSummary | undefined => {
    if (!comparisonProduct) return undefined
    return {
      ...comparisonProduct,
      ...(offer.variantId ? { variantId: offer.variantId } : {}),
      ...(offer.price ? { price: offer.price } : {}),
      availability: offer.availability,
      condition: offer.condition,
      ...(offer.productUrl ? { productUrl: offer.productUrl } : {}),
      ...(offer.seller ? { seller: offer.seller } : {}),
      ...(offer.handoff ? { handoff: offer.handoff } : {}),
      businessName: offer.businessName
    }
  }, [comparisonProduct])

  useEffect(() => {
    if (comparisonProduct) recordView(comparisonProduct)
  }, [comparisonProduct, recordView])

  useDocumentTitle(product ? `${product.title} — compare prices · Arro` : undefined)

  const compareSelected = comparisonProduct
    ? compare.some((candidate) => sameCompareProduct(candidate, comparisonProduct))
    : false

  const alertKey = comparisonProduct ? productGroupKey(comparisonProduct) : undefined
  const watching = useAlertsStore((state) => Boolean(alertKey) && state.alerts.some((alert) => alert.key === alertKey))
  const toggleAlertFor = useAlertsStore((state) => state.toggle)
  const toggleAlert = useCallback(() => {
    if (comparisonProduct) toggleAlertFor(comparisonProduct)
  }, [comparisonProduct, toggleAlertFor])

  /**
   * Comparing starts here and finishes on the comparison page.
   *
   * Adding a product to an invisible tray and leaving the shopper on the page
   * they were already reading gives no sign anything happened, and the second
   * product — the entire point — is never asked for. Taking them straight to the
   * comparison with this product in place makes the empty slot the obvious next
   * move.
   */
  const startCompare = useCallback(() => {
    if (!comparisonProduct) return
    if (!compareSelected) toggleCompare(comparisonProduct)
    router.push('/compare')
  }, [compareSelected, comparisonProduct, router, toggleCompare])

  /** The span the shopper is deciding inside, when the shops disagree. */
  const priceSpread = useMemo(() => {
    if (!comparablePrices || !bestOffer?.price || !highestOffer?.price) return undefined
    if (highestOffer.price.amountMinor === bestOffer.price.amountMinor) return undefined
    return `Compare ${merchantCount} shop${merchantCount === 1 ? '' : 's'} from ${formatMoney(bestOffer.price)} to ${formatMoney(highestOffer.price)}`
  }, [bestOffer, comparablePrices, highestOffer, merchantCount])

  const selectOption = useCallback(async (
    name: string,
    value: CatalogProductDetail['options'][number]['values'][number]
  ) => {
    if (!detail) return

    // What the shopper has actually decided, newest first. Only these are
    // intent; everything else in the request is scaffolding.
    const chosen: ProductDetailSelection[] = [
      { name, label: value.label, ...(value.id ? { id: value.id } : {}) },
      ...explicitSelections.filter((selection) => normalizedOption(selection.name) !== normalizedOption(name))
    ]

    // Sending one axis makes the source resolve the rest from its own defaults,
    // which can land on a different SKU than the one on screen. The current
    // effective configuration therefore travels with the choice, flagged as
    // carried so it is never mistaken for a decision.
    const carried = (detail.selected ?? [])
      .filter((selection) => !selectionFor(chosen, selection.name))
      .map((selection) => ({ ...selection, chosen: false }))
    const nextSelections = [...chosen, ...carried]

    // UCP relaxes from the end of the preference order, so the shopper's own
    // choices are named first and the carried defaults are given up first.
    const preferences = nextSelections.map((selection) => selection.name)

    optionRequest.current?.abort()
    const controller = new AbortController()
    optionRequest.current = controller
    setResolvingOption(name)
    setSelectionMessage(undefined)
    setError(undefined)

    try {
      const response = await getProductDetail({
        businessId,
        productId,
        selected: nextSelections,
        preferences
      }, controller.signal)
      if (!response.product) {
        setSelectionMessage('That combination is not available.')
        return
      }

      setDetail(response.product)
      setVariantUnconfirmed(false)
      setExplicitSelections(chosen)
      setActiveImage(0)

      // Only a choice the source refused is worth interrupting for. A carried
      // default that moved is the source resolving the configuration, which the
      // option rows already show.
      const changed = chosen.some((wanted) => {
        const effective = selectionFor(response.product!.selected, wanted.name)
        return !effective || !sameSelectedValue(wanted, effective)
      })
      if (changed) {
        setSelectionMessage('That combination is not available. Try a different one.')
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        setSelectionMessage(shopperErrorText(caught, 'That did not go through. Try again.'))
      }
    } finally {
      if (!controller.signal.aborted) setResolvingOption(undefined)
    }
  }, [businessId, detail, explicitSelections, productId])

  const startCheckout = useCallback(async (offer: DisplayOffer) => {
    try {
      setBuyingKey(offer.key)
      setError(undefined)
      const purchase = await preparePurchase({
        productId: offer.productId,
        ...(offer.variantId ? { variantId: offer.variantId } : {}),
        title: offer.title,
        businessName: offer.businessName,
        ...(offer.seller ? { seller: offer.seller } : {}),
        ...(offer.productUrl ? { productUrl: offer.productUrl } : {}),
        ...(offer.handoff ? { handoff: offer.handoff } : {})
      }, buyerFromDetails(shopper))
      // A shop that never opened checkout to Arro has no checkout to open. The
      // runtime still answers with the shop's own link, so the shopper is told
      // that plainly here instead of meeting a 404 on the next screen.
      if (!isPreparedCheckout(purchase)) {
        setHandoff(purchase)
        return
      }
      setPrepared(purchase)
      router.push({ pathname: '/checkout', params: { id: purchase.purchaseId } })
    } catch (caught) {
      setError(shopperErrorText(caught, 'Checkout could not start for this offer. Try again.'))
    } finally {
      setBuyingKey(undefined)
    }
  }, [router, setPrepared, shopper])

  const addOffer = useCallback((offer: DisplayOffer) => {
    const cartProduct = cartProductFor(offer)
    if (!cartProduct) return
    addToCart(cartProduct)
    setAddedKey(offer.key)
  }, [addToCart, cartProductFor])

  const shareCurrentProduct = useCallback(async () => {
    if (!comparisonProduct) return
    clearTimeout(shareFeedbackTimer.current)
    setShareFeedback(undefined)
    try {
      const result = await shareProduct({
        title: comparisonProduct.title,
        path: productHref(comparisonProduct)
      })
      if (result !== 'copied') return
      setShareFeedback('Link copied')
    } catch {
      setShareFeedback('Could not share this link')
    }
    shareFeedbackTimer.current = setTimeout(() => setShareFeedback(undefined), 2200)
  }, [comparisonProduct])

  useEffect(() => {
    if (!addedKey) return
    const timer = setTimeout(() => setAddedKey(undefined), 1800)
    return () => clearTimeout(timer)
  }, [addedKey])

  if (loading && !product) {
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" className="flex-1 bg-white">
        <DetailSkeleton desktop={desktop} />
      </ScrollView>
    )
  }

  if (!product) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-fill">
          <Icon name="alert" size={24} color={color.ink600} />
        </View>
        <Text className="mt-4 text-[20px] font-bold leading-7 text-ink-950">We could not open this product</Text>
        <Text className="mt-2 max-w-[420px] text-center text-[14px] leading-5 text-ink-600">
          {error || 'Try another result or search again.'}
        </Text>
        <View className="mt-5"><Button variant="outline" onPress={() => router.back()}>Go back</Button></View>
      </View>
    )
  }

  const priceLine = bestOffer?.price ? formatMoney(bestOffer.price) : 'Price unavailable'
  const offersLabel = merchantCount > 1
    ? `Across ${merchantCount} shops`
    : bestOffer
      ? `Sold by ${bestOffer.seller?.name || bestOffer.businessName}`
      : 'No shop offer available'
  const bestOfferProduct = bestOffer ? cartProductFor(bestOffer) : undefined
  const bestInCart = bestOfferProduct
    ? cartLines.some((line) => line.key === cartLineKey(bestOfferProduct))
    : false

  // Leave enough of the decision block in the first phone viewport to orient a
  // shopper before they scroll. The image remains the largest object on the
  // page, but it no longer pushes the title and price behind the sticky buy bar.
  const galleryHeight = desktop ? 480 : Math.min(280, width * 0.72)
  const galleryWidth = desktop ? Math.min(560, width * 0.46) : width - 32

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, paddingBottom: desktop ? 0 : 132 }}
      >
        <Shell className="flex-1 py-4 md:py-8">
          <Breadcrumb
            className="mb-4"
            hideCurrentOnCompact
            trail={[
              { name: 'Home', href: '/' },
              // The whole path, not just the last step. A trail that jumps from
              // Home straight to the product tells the shopper nothing about
              // where they are or what else is nearby — which is most of what a
              // breadcrumb is for on a comparison site.
              ...breadcrumbTrail,
              { name: product.title }
            ]}
          />

          <View className={desktop ? 'flex-row items-start gap-12' : 'gap-5'}>
            <View className={desktop ? 'w-[46%] max-w-[560px] gap-3' : 'gap-3'}>
              <View className="relative">
                {images.length > 1 ? (
                  <Carousel
                    label={`${product.title} images`}
                    data={images}
                    keyExtractor={(uri) => uri}
                    itemWidth={galleryWidth}
                    gap={8}
                    indicator="dots"
                    activeIndex={activeImage}
                    onIndexChange={setActiveImage}
                    renderItem={(uri, index) => (
                      <View
                        className="items-center justify-center overflow-hidden rounded-3xl bg-fill-soft p-6"
                        style={{ height: galleryHeight }}
                      >
                        <ProductImage
                          uri={uri}
                          alt={`${product.title}${index > 0 ? ` — image ${index + 1}` : ''}`}
                          className="h-full w-full"
                          sizes={heroImageSizes}
                          priority={index === 0}
                        />
                      </View>
                    )}
                  />
                ) : (
                  <View
                    className="items-center justify-center overflow-hidden rounded-3xl bg-fill-soft p-6"
                    style={{ height: galleryHeight }}
                  >
                    {images[0] ? (
                      <ProductImage
                        uri={images[0]}
                        alt={product.title}
                        className="h-full w-full"
                        sizes={heroImageSizes}
                        priority
                      />
                    ) : (
                      <Icon name="store" size={44} color={color.ink400} />
                    )}
                  </View>
                )}

                {images.length > 1 ? (
                  <View className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1">
                    <Text className="text-[12px] font-semibold leading-4 text-ink-800">
                      {activeImage + 1} / {images.length}
                    </Text>
                  </View>
                ) : null}

                {comparisonProduct ? (
                  <View className="absolute right-3 top-3">
                    <SaveButton product={comparisonProduct} surface="floating" showAlert={false} />
                  </View>
                ) : null}
              </View>

              {images.length > 1 ? (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  className="arro-rail"
                  contentContainerStyle={{ gap: 8 }}
                >
                  {images.map((uri, index) => (
                    <Pressable
                      key={uri}
                      accessibilityRole="button"
                      accessibilityLabel={`Show image ${index + 1} of ${images.length}`}
                      accessibilityState={{ selected: index === activeImage }}
                      onPress={() => setActiveImage(index)}
                      className={`h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-fill-soft p-1.5 ${index === activeImage ? 'border-2 border-ink-950' : ''}`}
                    >
                      <ProductImage
                        uri={uri}
                        alt={`${product.title} — view ${index + 1}`}
                        className="h-full w-full"
                        width={72}
                        sizes={thumbImageSizes}
                      />
                    </Pressable>
                  ))}
                </ScrollView>
              ) : null}
            </View>

            <View className="min-w-0 flex-1">
              {product.brand ? (
                <Text className="text-[13px] font-semibold leading-[18px] text-arro-700">{product.brand}</Text>
              ) : null}
              <Heading level={1} className="mt-1 text-[24px] font-bold leading-8 tracking-[-0.4px] text-ink-950 md:text-[32px] md:leading-10">
                {product.title}
              </Heading>

              {/* Rating, watching and comparing sit on one line under the title.
                  Each is a small decision about this product, and stacking them
                  as separate blocks made the page feel like a form. */}
              <View className="mt-2.5 flex-row flex-wrap items-center gap-x-5 gap-y-2">
                {rating ? <Stars value={rating.value} count={rating.count} /> : null}
                <Tappable
                  accessibilityRole="button"
                  accessibilityLabel={watching ? 'Stop watching this price' : 'Watch this price'}
                  accessibilityState={{ selected: watching }}
                  onPress={() => toggleAlert()}
                  className={`-mx-2 min-h-11 flex-row items-center gap-1.5 rounded-full px-2.5 hover:bg-fill ${watching ? 'bg-arro-50' : ''}`}
                >
                  <Icon name={watching ? 'bellFill' : 'bell'} size={15} color={watching ? color.arro600 : color.ink600} />
                  <Text className={`text-[13px] font-medium leading-[18px] ${watching ? 'text-arro-700' : 'text-ink-600'}`}>
                    {watching ? 'Watching price' : 'Price alert'}
                  </Text>
                </Tappable>
                {comparisonProduct ? (
                  <Tappable
                    accessibilityRole="button"
                    accessibilityLabel={compareSelected ? 'Open comparison' : 'Compare this product'}
                    onPress={() => startCompare()}
                    className={`min-h-11 flex-row items-center gap-1.5 rounded-full px-2.5 hover:bg-fill ${compareSelected ? 'bg-arro-50' : ''}`}
                  >
                    <Icon name="compare" size={15} color={compareSelected ? color.arro600 : color.ink600} />
                    <Text className={`text-[13px] font-medium leading-[18px] ${compareSelected ? 'text-arro-700' : 'text-ink-600'}`}>
                      Compare
                    </Text>
                  </Tappable>
                ) : null}
                {comparisonProduct ? (
                  <Tappable
                    accessibilityRole="button"
                    accessibilityLabel={`Share ${comparisonProduct.title}`}
                    onPress={() => void shareCurrentProduct()}
                    className="min-h-11 flex-row items-center gap-1.5 rounded-full px-2.5 hover:bg-fill"
                  >
                    <Icon name="share" size={15} color={color.ink600} />
                    <Text className="text-[13px] font-medium leading-[18px] text-ink-600">Share</Text>
                  </Tappable>
                ) : null}
                {shareFeedback ? (
                  <Text accessibilityLiveRegion="polite" className="text-[12px] leading-4 text-ink-600">
                    {shareFeedback}
                  </Text>
                ) : null}
              </View>

              {/* The span a shopper is actually deciding inside. One price with
                  no range says nothing about whether it is a good one. */}
              {priceSpread ? (
                <Text className="mt-2 text-[14px] leading-5 text-ink-600">
                  {priceSpread}
                </Text>
              ) : null}

              {/* Rendered only when there is a choice. An empty axis list still
                  drew its divider and its padding, so a product with one variant
                  carried a blank band where its options would have been. */}
              {selectableOptions.length > 0 ? (
                <View className={`mt-5 gap-4 border-t border-line pt-5 ${resolvingOption ? 'opacity-50' : ''}`}>
                  {selectableOptions.map((option) => {
                    const effective = selectionFor(detail?.selected ?? [], option.name)
                    return (
                      <View key={option.name}>
                        {/* The chosen value is already the filled-in chip. Repeating
                            it beside the label says the same thing twice. */}
                        <Text className="mb-2 text-[14px] font-semibold leading-5 text-ink-950">{option.name}</Text>
                        <View role="radiogroup" aria-label={option.name} className="flex-row flex-wrap gap-2">
                          {option.values.map((value) => {
                            const selected = Boolean(effective && sameSelectedValue(effective, value))
                            const unavailable = value.available === false || value.exists === false
                            const key = `${option.name}:${value.id ?? value.label}`
                            return (
                              <Pressable
                                key={key}
                                accessibilityRole="radio"
                                // The chip's text alone reads as a bare value out
                                // of context. Naming the axis makes "Blue" and
                                // "256gb" tell a screen reader what they set.
                                accessibilityLabel={`${option.name}: ${value.label}${unavailable ? ' (unavailable)' : ''}`}
                                accessibilityState={{ checked: selected, disabled: unavailable || Boolean(resolvingOption) }}
                                aria-checked={selected}
                                disabled={unavailable || Boolean(resolvingOption)}
                                onPress={() => void selectOption(option.name, value)}
                                className={`min-h-11 justify-center rounded-lg border px-3.5 py-2 ${
                                  selected
                                    ? 'border-ink-950 bg-ink-950'
                                    : 'border-line-strong bg-white'
                                } ${unavailable ? 'opacity-40' : ''}`}
                              >
                                <Text className={`text-[13px] font-semibold leading-[18px] ${selected ? 'text-white' : 'text-ink-800'}`}>
                                  {value.label}
                                </Text>
                              </Pressable>
                            )
                          })}
                        </View>
                      </View>
                    )
                  })}
                </View>
              ) : null}

              {/* Price, shop and stock read as one fact, and the buttons sit
                  beside them rather than under them. Two stacked full-width bars
                  turned a £389 decision into a landing-page call to action and
                  pushed the actual product detail off the first screen. */}
              <View className="mt-5 rounded-2xl border border-line p-4 md:p-5">
                <Text className="text-[13px] leading-[18px] text-ink-600">{offersLabel}</Text>
                <View className="mt-1 flex-row flex-wrap items-end justify-between gap-3">
                  <View className="min-w-0">
                    <View className="flex-row items-baseline gap-2">
                      <Text className="text-[28px] font-bold leading-9 tracking-[-0.6px] text-ink-950">{priceLine}</Text>
                      {showRange && highestOffer?.price ? (
                        <Text className="text-[15px] leading-5 text-ink-400">to {formatMoney(highestOffer.price)}</Text>
                      ) : null}
                    </View>
                    {bestOffer ? (
                      <View className="mt-1.5 flex-row flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge tone={bestOffer.availability === 'in_stock' ? 'positive' : 'neutral'}>
                          {availabilityLabel(bestOffer.availability)}
                        </Badge>
                      </View>
                    ) : null}
                  </View>

                  {bestOffer ? (
                    <View className="flex-row items-center gap-2">
                      <Button
                        variant="outline"
                        disabled={!canCheckoutBestOffer}
                        icon={addedKey === bestOffer.key ? 'check' : 'cart'}
                        onPress={() => addOffer(bestOffer)}
                      >
                        {addedKey === bestOffer.key ? 'Added' : bestInCart ? 'In cart' : 'Add to cart'}
                      </Button>
                      <Button
                        variant="accent"
                        disabled={!canCheckoutBestOffer}
                        loading={buyingKey === bestOffer.key}
                        icon="lock"
                        onPress={() => void startCheckout(bestOffer)}
                      >
                        {bestOffer.availability === 'out_of_stock' ? 'Out of stock' : exactConfigurationReady ? 'Buy now' : chooseLabel}
                      </Button>
                    </View>
                  ) : null}
                </View>
              </View>

              {selectionMessage ? (
                <View className="mt-4"><Notice icon="alert">{selectionMessage}</Notice></View>
              ) : null}
              {error ? <View className="mt-4"><Notice tone="danger" icon="alert">{error}</Notice></View> : null}
              {variantUnconfirmed ? (
                <View className="mt-4">
                  <Notice>
                    The shop does not have that exact one, so these are the ones it does sell.
                  </Notice>
                </View>
              ) : null}

              {description ? (
                <View className="mt-6">
                  <Text
                    {...(descriptionOpen ? {} : { numberOfLines: desktop ? 5 : 3 })}
                    className="text-[15px] leading-6 text-ink-600"
                  >
                    {description}
                  </Text>
                  {description.length > 180 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={descriptionOpen ? 'Show less of this description' : 'Read the full description'}
                      accessibilityState={{ expanded: descriptionOpen }}
                      onPress={() => setDescriptionOpen((open) => !open)}
                      className="mt-1.5 min-h-9 justify-center self-start"
                    >
                      <Text className="text-[14px] font-semibold leading-5 text-arro-700">
                        {descriptionOpen ? 'Show less' : 'Read more'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>

          {detail?.highlights?.length ? (
            <Appear className="mt-10 border-t border-line pt-8">
              <Heading level={2} className="text-[20px] font-bold leading-7 text-ink-950 md:text-2xl md:leading-8">
                Key features
              </Heading>
              <View className="mt-4 gap-2.5 md:flex-row md:flex-wrap">
                {detail.highlights.slice(0, 8).map((highlight) => (
                  <View key={highlight} className="flex-row gap-2.5 md:w-[48%]">
                    <View className="mt-1.5"><Icon name="check" size={14} color={color.positive} /></View>
                    <Text className="min-w-0 flex-1 text-[14px] leading-5 text-ink-800">{highlight}</Text>
                  </View>
                ))}
              </View>
            </Appear>
          ) : null}

          <Appear className="mt-10 border-t border-line pt-8 md:mt-14">
            <View className="mb-4 flex-row items-end justify-between gap-4">
              <View className="min-w-0 flex-1">
                <Heading level={2} className="text-[20px] font-bold leading-7 text-ink-950 md:text-2xl md:leading-8">
                  {displayOffers.length > 1 ? 'Compare offers' : 'Where to buy'}
                </Heading>
                {displayOffers.length === 0 ? (
                  <Text className="mt-1 text-[13px] leading-5 text-ink-600">
                    No shop sells this exact combination. Change an option to see who does.
                  </Text>
                ) : null}
                {comparablePrices && highestOffer?.price && bestOffer?.price ? (
                  <Text className="mt-1 text-[13px] leading-5 text-ink-600">
                    {`${formatMoney({ amountMinor: highestOffer.price.amountMinor - bestOffer.price.amountMinor, currency: bestOffer.price.currency })} between the cheapest and dearest shop`}
                  </Text>
                ) : null}
              </View>
              {displayOffers.length > 1 ? (
                <Text className="text-[13px] font-medium leading-[18px] text-ink-400">
                  {displayOffers.length} offers
                </Text>
              ) : null}
            </View>

            <View>
              {displayOffers.map((offer, index) => {
                const merchant = offer.seller?.name || offer.seller?.domain || offer.businessName
                const lowest = index === 0 && comparablePrices
                const sellable = offer.availability !== 'out_of_stock' && exactConfigurationReady &&
                  (selectableOptions.length === 0 || Boolean(offer.variantId))
                return (
                  <View key={offer.key} className="border-t border-line py-4">
                    <View className={desktop ? 'flex-row items-center gap-6' : 'gap-3'}>
                      <View className="min-w-0 flex-1 gap-1">
                        <View className="flex-row flex-wrap items-center gap-2">
                          <Text className="text-[16px] font-semibold leading-6 text-ink-950">{merchant}</Text>
                          {lowest ? <Badge tone="positive" icon="trendingDown">Lowest price</Badge> : null}
                        </View>
                        {offer.options ? (
                          <Text numberOfLines={2} className="text-[13px] leading-[18px] text-ink-800">
                            {offer.options}
                          </Text>
                        ) : null}
                        <Text className="text-[13px] leading-[18px] text-ink-600">
                          {availabilityLabel(offer.availability)}
                          {offer.condition === 'unknown' ? '' : ` · ${conditionLabel(offer.condition)}`}
                          {` · ${freshnessLabel(offer.fetchedAt).toLowerCase()}`}
                        </Text>
                      </View>
                      <View className={desktop ? 'min-w-[300px] flex-row items-center justify-end gap-4' : 'flex-row items-center justify-between gap-3'}>
                        <Text className="text-[20px] font-bold leading-6 text-ink-950">
                          {offer.price ? formatMoney(offer.price) : '--'}
                        </Text>
                        <View className="flex-row items-center gap-2">
                          <Tappable
                            accessibilityLabel={`Add ${merchant} offer to cart`}
                            disabled={!sellable}
                            onPress={() => addOffer(offer)}
                            className={`h-9 w-9 items-center justify-center rounded-full border border-line ${sellable ? '' : 'opacity-40'}`}
                          >
                            <Icon
                              name={addedKey === offer.key ? 'check' : 'cart'}
                              size={16}
                              color={addedKey === offer.key ? color.positive : color.ink800}
                            />
                          </Tappable>
                          <Button
                            size="sm"
                            disabled={!sellable}
                            loading={buyingKey === offer.key}
                            onPress={() => void startCheckout(offer)}
                          >
                            {offer.availability === 'out_of_stock' ? 'Out of stock' : exactConfigurationReady ? 'Buy' : chooseLabel}
                          </Button>
                        </View>
                      </View>
                    </View>
                  </View>
                )
              })}
              <View className="border-t border-line" />
            </View>
          </Appear>


          {specRows.length > 0 ? (
            <View className="mt-10 border-t border-line pt-8">
              <Heading level={2} className="text-[20px] font-bold leading-7 text-ink-950 md:text-2xl md:leading-8">
                Specifications
              </Heading>
              <View className="mt-4">
                {specRows.map(([label, value]) => (
                  <View key={label} className="flex-row gap-4 border-b border-line py-3">
                    <Text className="w-[38%] text-[14px] leading-5 text-ink-400 md:w-[240px]">{label}</Text>
                    <Text className="min-w-0 flex-1 text-[14px] leading-5 text-ink-800">{value}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {related.length > 0 ? (
            <View className="mt-10 border-t border-line pt-8">
              <Heading level={2} className="text-[20px] font-bold leading-7 text-ink-950 md:text-2xl md:leading-8">
                Keep looking
              </Heading>
              <View className="mt-4 flex-row flex-wrap gap-2">
                {related.map((item) => (
                  <ProductLink
                    key={item.query}
                    href={searchHref(item.query)}
                    className="arro-card min-h-10 justify-center rounded-full border border-line bg-white px-4"
                  >
                    <Text className="text-[14px] font-medium leading-5 text-ink-800">{item.label}</Text>
                  </ProductLink>
                ))}
              </View>
            </View>
          ) : null}

          <View className="mt-10 border-t border-line pt-8">
            <Heading level={2} className="text-[20px] font-bold leading-7 text-ink-950 md:text-2xl md:leading-8">
              Where these prices come from
            </Heading>
            <View className="mt-4 gap-2.5 md:flex-row">
              {([
                ['store', 'Sold by', soldByLabel(bestOffer?.seller?.name || bestOffer?.businessName || product.businessName, merchantCount)],
                ['clock', 'Last checked', freshnessLabel(product.sourceLabel.fetchedAt).replace('Checked ', '')],
                ['shield', 'At checkout', 'Shop confirms the final total']
              ] as const).map(([icon, label, value]) => (
                <View key={label} className="flex-1 rounded-2xl bg-fill-soft p-4">
                  <View className="flex-row items-center gap-2">
                    <Icon name={icon} size={16} color={color.ink600} />
                    <Text className="text-[12px] font-semibold uppercase leading-4 tracking-[0.6px] text-ink-400">{label}</Text>
                  </View>
                  <Text className="mt-1.5 text-[15px] font-semibold leading-5 text-ink-950">{value}</Text>
                </View>
              ))}
            </View>
            <Text className="mt-3 max-w-[620px] text-[13px] leading-5 text-ink-400">
              Shipping, tax and final availability are settled by the shop at checkout.
            </Text>
          </View>

          {detail?.warnings.length ? (
            <View className="mt-10 border-t border-line pt-8">
              <Heading level={2} className="text-[20px] font-bold leading-7 text-ink-950 md:text-2xl md:leading-8">
                Before you buy
              </Heading>
              <View className="mt-4 gap-2.5">
                {detail.warnings.slice(0, 4).map((warning) => (
                  <Notice key={warning.code} tone="warning" icon="alert">{warningCopy(warning.code)}</Notice>
                ))}
              </View>
            </View>
          ) : null}
        </Shell>

        <SiteFooter className="mt-14" />
      </ScrollView>

      <HandoffSheet
        purchase={handoff}
        fallbackName={bestOffer?.seller?.name || bestOffer?.businessName || product.businessName}
        onClose={() => setHandoff(undefined)}
      />

      {!desktop && bestOffer ? (
        <View className="absolute bottom-0 left-0 right-0 flex-row items-center gap-3 border-t border-line bg-white px-4 pb-5 pt-3">
          <View className="min-w-0 flex-1">
            <Text className="text-[12px] leading-4 text-ink-400">
              {showRange ? 'Lowest price' : 'Selected offer'}
            </Text>
            <Text className="text-[18px] font-bold leading-6 text-ink-950">{priceLine}</Text>
          </View>
          <Tappable
            accessibilityLabel={`Add ${product.title} to cart`}
            disabled={!canCheckoutBestOffer}
            onPress={() => addOffer(bestOffer)}
            className={`h-12 w-12 items-center justify-center rounded-full border border-line-strong ${canCheckoutBestOffer ? '' : 'opacity-40'}`}
          >
            <Icon
              name={addedKey === bestOffer.key ? 'check' : 'cart'}
              size={19}
              color={addedKey === bestOffer.key ? color.positive : color.ink950}
            />
          </Tappable>
          <Button
            variant="accent"
            size="lg"
            disabled={!canCheckoutBestOffer}
            loading={buyingKey === bestOffer.key}
            onPress={() => void startCheckout(bestOffer)}
          >
            {bestOffer.availability === 'out_of_stock' ? 'Out of stock' : exactConfigurationReady ? 'Buy now' : chooseLabel}
          </Button>
        </View>
      ) : null}
    </View>
  )
}
