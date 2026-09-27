import type {
  CatalogProductDetail,
  CatalogProductSelection,
  CatalogProductSelectedOption,
  CatalogProductVariant,
  PlainStatusMessage
} from '@arro/contracts'

export type ProductDetailQualityState = 'ready' | 'limited' | 'blocked'

export type ProductDetailQualityAssessment = {
  state: ProductDetailQualityState
  purchaseReady: boolean
  variantResolvable: boolean
  checks: {
    hasCurrentPrice: boolean
    hasConcreteAvailability: boolean
    hasMedia: boolean
    hasSafeHandoff: boolean
    hasResolvableVariant: boolean
    selectedVariantAvailable: boolean
  }
  messages: PlainStatusMessage[]
}

export type ProductDetailQualityOptions = {
  selectedVariantId?: string
  requestedSelected?: CatalogProductSelection[]
}

const safeHttpsUrl = (value: string | undefined) => {
  if (!value) return false

  return /^https:\/\/[^\s/?#]+[^\s]*$/i.test(value)
}

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

const normalizedOption = (value: string) => value.trim().toLocaleLowerCase()

const sameSelection = (
  left: Pick<CatalogProductSelection, 'label' | 'id'>,
  right: Pick<CatalogProductSelectedOption, 'label' | 'id'>
) => {
  if (left.id && right.id) return left.id === right.id
  return normalizedOption(left.label) === normalizedOption(right.label)
}

const selectionFor = <T extends { name: string }>(items: T[], name: string) =>
  items.find((item) => normalizedOption(item.name) === normalizedOption(name))

const configurableOptionNames = (product: CatalogProductDetail) => product.options.flatMap((option) => {
  const values = new Set(
    option.values.map((value) => normalizedOption(value.label))
  )
  return values.size > 1 ? [option.name] : []
})

/**
 * An axis only needs a decision when there is something to decide, and only the
 * caller's own choices count as decisions. A source default is not intent: UCP
 * answers a request carrying no selection with the featured variant's values,
 * so treating those as chosen would let a catalogue default be bought as though
 * someone picked it. An axis whose alternatives are all unsellable offers no
 * choice at all, so the effective selection settles it on its own.
 *
 * Availability is relative to the current effective selection and moves when
 * another axis changes, so this is recomputed against each response rather than
 * latched: an axis that was uniquely determined can become a real choice again.
 */
const chosenSelections = (requested: CatalogProductSelection[] | undefined) =>
  (requested ?? []).filter((selection) => selection.chosen !== false)

const selectableValues = (product: CatalogProductDetail, name: string) => {
  const option = selectionFor(product.options, name)
  return (option?.values ?? []).filter((value) => value.available !== false && value.exists !== false)
}

const selectionSettled = (
  product: CatalogProductDetail,
  requested: CatalogProductSelection[] | undefined
) => {
  const chosen = chosenSelections(requested)
  const honoured = chosen.every((wanted) => {
    const effective = selectionFor(product.selected, wanted.name)
    return Boolean(effective && sameSelection(wanted, effective))
  })
  if (!honoured) return false

  return configurableOptionNames(product).every((name) => {
    if (selectionFor(chosen, name)) return true
    return Boolean(selectionFor(product.selected, name)) && selectableValues(product, name).length <= 1
  })
}

const variantMatchesSelection = (
  variant: CatalogProductVariant,
  selected: CatalogProductSelectedOption[]
) => selected.length > 0 && selected.every((effective) => {
  const actual = selectionFor(variant.selectedOptions, effective.name)
  return Boolean(actual && sameSelection(effective, actual))
})

const selectedVariant = (
  product: CatalogProductDetail,
  selectedVariantId: string | undefined
) => {
  if (selectedVariantId) {
    return product.variants.find((variant) => variant.variantId === selectedVariantId)
  }

  if (product.selected.length > 0) {
    const selected = product.variants.find((variant) => variantMatchesSelection(variant, product.selected))
    if (selected) return selected
  }

  if (product.variantId) {
    const selected = product.variants.find((variant) => variant.variantId === product.variantId)
    if (selected) return selected
  }

  return product.variants.length === 1 ? product.variants[0] : undefined
}

const hasResolvableVariant = (
  product: CatalogProductDetail,
  selected: CatalogProductVariant | undefined,
  explicitSelectionConfirmed: boolean
) => {
  if (!explicitSelectionConfirmed) return false
  if (selected) return product.options.length === 0 || selected.selectedOptions.length > 0
  if (product.variantId && product.options.length === 0) return true
  if (product.variants.length === 0 && product.options.length === 0) return Boolean(product.variantId)

  return false
}

export const assessProductDetailQuality = (
  product: CatalogProductDetail,
  options: ProductDetailQualityOptions = {}
): ProductDetailQualityAssessment => {
  const selected = selectedVariant(product, options.selectedVariantId)
  const explicitSelectionConfirmed = Boolean(options.selectedVariantId) ||
    selectionSettled(product, options.requestedSelected)
  const hasCurrentPrice = Boolean(selected?.price ?? product.price)
  const hasConcreteAvailability = product.availability !== 'unknown'
  const hasMedia = product.media.some((media) => safeHttpsUrl(media.url))
  const hasSafeHandoff = safeHttpsUrl(selected?.handoff?.url) ||
    safeHttpsUrl(selected?.productUrl) ||
    safeHttpsUrl(product.handoff?.url) ||
    safeHttpsUrl(product.productUrl) ||
    safeHttpsUrl(product.seller?.url)
  const selectedVariantAvailable = selected
    ? selected.availability === 'in_stock' || selected.availability === 'limited'
    : product.availability === 'in_stock' || product.availability === 'limited'
  const resolvableVariant = hasResolvableVariant(product, selected, explicitSelectionConfirmed)
  const messages: PlainStatusMessage[] = []

  if (!hasCurrentPrice) {
    messages.push(message(
      'warning',
      'product_price_missing',
      'Product detail does not include a source-confirmed current price.',
      'Fetch richer product detail or revalidate through a transaction-capable connector before checkout-impacting use.'
    ))
  }

  if (!hasConcreteAvailability) {
    messages.push(message(
      'warning',
      'product_availability_unknown',
      'Product detail does not include concrete source-confirmed availability.',
      'Revalidate availability through product detail, cart, or checkout before purchase preparation.'
    ))
  }

  if (!hasMedia) {
    messages.push(message(
      'info',
      'product_media_missing',
      'Product detail does not include safe source-confirmed media.',
      'Treat the product as usable for data checks but incomplete for rich product intelligence.'
    ))
  }

  if (!hasSafeHandoff) {
    messages.push(message(
      'warning',
      'product_handoff_missing',
      'Product detail does not include a safe source-confirmed product, seller, cart, or checkout handoff URL.',
      'Keep transaction preparation unavailable until the connector returns source-authoritative handoff data.'
    ))
  }

  if (!resolvableVariant) {
    messages.push(message(
      'warning',
      'product_variant_ambiguous',
      'Product detail does not identify a shopper-selected, transaction-ready variant with source-confirmed option mapping.',
      'Resolve every configurable option to an exact source-confirmed variant before purchase preparation.'
    ))
  }

  if (!selectedVariantAvailable) {
    messages.push(message(
      'warning',
      'product_variant_unavailable',
      'The selected or implied product variant is not currently available for transaction preparation.',
      'Offer supported alternatives or revalidate later instead of preparing a transaction.'
    ))
  }

  const purchaseReady = hasCurrentPrice &&
    hasConcreteAvailability &&
    hasSafeHandoff &&
    resolvableVariant &&
    selectedVariantAvailable
  const state: ProductDetailQualityState = purchaseReady
    ? messages.some((entry) => entry.severity === 'info') ? 'limited' : 'ready'
    : 'blocked'

  return {
    state,
    purchaseReady,
    variantResolvable: resolvableVariant,
    checks: {
      hasCurrentPrice,
      hasConcreteAvailability,
      hasMedia,
      hasSafeHandoff,
      hasResolvableVariant: resolvableVariant,
      selectedVariantAvailable
    },
    messages
  }
}