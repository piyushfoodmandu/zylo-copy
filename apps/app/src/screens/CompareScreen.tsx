import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { compareProducts, getProductDetail } from '../api/client'
import { Breadcrumb } from '../components/Breadcrumb'
import { Icon } from '../components/Icon'
import { Appear, Tappable } from '../components/motion'
import { Shell } from '../components/Page'
import { ProductImage } from '../components/ProductImage'
import { SiteFooter } from '../components/SiteFooter'
import { SaveButton } from '../components/SaveButton'
import { SearchField } from '../components/SearchField'
import { Badge, Button, Notice } from '../components/ui'
import { conditionLabel, shopName } from '../lib/facets'
import { useDocumentTitle } from '../lib/document-title'
import { useLayoutMode } from '../lib/layout'
import { decodeProductIdentity, encodeProductIdentity, productHref, searchHref } from '../lib/product-url'
import { availabilityLabel, productMoney } from '../lib/product-display'
import { shareProduct } from '../lib/share-product'
import { shopperErrorText } from '../lib/shopper-copy'
import { color } from '../lib/theme'
import { useCartStore } from '../store/useCartStore'
import { Heading } from '../components/semantic'
import { useShopStore } from '../store/useShopStore'
import type { CatalogProductSummary, CompareResponse } from '../types/catalog'

type Assessment = CompareResponse['assessments'][number]

const productKey = (product: CatalogProductSummary) =>
  `${product.businessId}:${product.productId}:${product.variantId ?? ''}`

const comparisonTone = (state: Assessment['comparisonState']) =>
  state === 'stronger' ? 'positive' as const
    : state === 'risky' ? 'warning' as const
      : state === 'unavailable' ? 'neutral' as const
        : 'accent' as const

const comparisonLabel = (state: Assessment['comparisonState']) => ({
  stronger: 'Strong option',
  viable: 'Worth considering',
  risky: 'Check before buying',
  unavailable: 'Not enough information'
}[state])

const attributeRows = [
  { label: 'Price', value: (product: CatalogProductSummary) => productMoney(product) },
  {
    label: 'Rating',
    value: (product: CatalogProductSummary) => product.rating
      ? `${product.rating.value.toFixed(1)} / ${product.rating.scaleMax} (${product.rating.count})`
      : '--'
  },
  { label: 'Availability', value: (product: CatalogProductSummary) => availabilityLabel(product.availability) },
  { label: 'Condition', value: (product: CatalogProductSummary) => conditionLabel(product.condition) },
  { label: 'Brand', value: (product: CatalogProductSummary) => product.brand || '--' },
  { label: 'Shop', value: shopName }
] as const

const AssessmentLine = ({ text, positive }: { text: string; positive: boolean }) => (
  <View className="mt-2 flex-row items-start gap-2">
    <Icon name={positive ? 'check' : 'info'} size={15} color={positive ? color.positive : color.warning} />
    <Text className="min-w-0 flex-1 text-[13px] leading-5 text-ink-600">{text}</Text>
  </View>
)

export function CompareScreen({ initialProducts = [] }: { initialProducts?: CatalogProductSummary[] } = {}) {
  const router = useRouter()
  const params = useLocalSearchParams<{ items?: string | string[] }>()
  const { desktop } = useLayoutMode()
  const storedCompare = useShopStore((state) => state.compare)
  const clearCompare = useShopStore((state) => state.clearCompare)
  const setCompare = useShopStore((state) => state.setCompare)
  const toggleCompare = useShopStore((state) => state.toggleCompare)
  const selectProduct = useShopStore((state) => state.selectProduct)
  const addToCart = useCartStore((state) => state.add)
  const [response, setResponse] = useState<CompareResponse>()
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [error, setError] = useState<string>()
  const [shareFeedback, setShareFeedback] = useState<string>()
  const [storeHydrated, setStoreHydrated] = useState(() => useShopStore.persist.hasHydrated())
  const restoredParam = useRef<string | undefined>(undefined)
  const restoringParam = useRef<string | undefined>(undefined)
  const rawItems = Array.isArray(params.items) ? params.items[0] : params.items
  const hasUnappliedServerSelection = Boolean(
    rawItems && initialProducts.length > 0 && restoredParam.current !== rawItems
  )
  // A shared URL is the explicit navigation intent, so its server-resolved
  // products remain on screen until device-state hydration has finished. Only
  // then are they written over the older persisted comparison.
  const compare = hasUnappliedServerSelection ? initialProducts : storedCompare

  const comparisonParam = useMemo(
    () => compare.map((product) => encodeProductIdentity(product)).join(','),
    [compare]
  )

  useDocumentTitle(compare.length ? `Compare ${compare.length} products · Arro` : 'Compare products · Arro')

  useEffect(() => {
    if (useShopStore.persist.hasHydrated()) {
      setStoreHydrated(true)
      return
    }
    return useShopStore.persist.onFinishHydration(() => setStoreHydrated(true))
  }, [])

  useEffect(() => {
    if (!storeHydrated || !hasUnappliedServerSelection || !rawItems) return
    setCompare(initialProducts)
    restoredParam.current = rawItems
  }, [hasUnappliedServerSelection, initialProducts, rawItems, setCompare, storeHydrated])

  // The URL makes a comparison reloadable and shareable. Only opaque catalogue
  // identities travel in it; current price and availability are re-fetched.
  useEffect(() => {
    if (
      !storeHydrated ||
      !rawItems ||
      initialProducts.length > 0 ||
      restoredParam.current === rawItems ||
      restoringParam.current === rawItems
    ) return
    const identities = rawItems
      .split(',')
      .slice(0, 4)
      .map(decodeProductIdentity)
      .filter((identity): identity is NonNullable<typeof identity> => Boolean(identity))
    restoringParam.current = rawItems
    setCompare([])
    if (identities.length === 0) {
      restoredParam.current = rawItems
      restoringParam.current = undefined
      setError('This comparison link does not contain any valid products.')
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12_000)
    let active = true
    setRestoring(true)
    setError(undefined)
    void Promise.all(identities.map(async (identity) => {
      try {
        return await getProductDetail(identity, controller.signal)
      } catch {
        return undefined
      }
    }))
      .then((responses) => {
        if (!active) return
        const products = responses.flatMap((response) => response?.product
          ? [{ ...response.product, matchReasons: [] }]
          : [])
        if (products.length > 0) setCompare(products)
        else setError('These products are no longer available to compare.')
      })
      .finally(() => {
        clearTimeout(timeout)
        if (!active) return
        restoredParam.current = rawItems
        restoringParam.current = undefined
        setRestoring(false)
      })

    return () => {
      active = false
      clearTimeout(timeout)
      if (restoringParam.current === rawItems) restoringParam.current = undefined
      controller.abort()
    }
  }, [initialProducts.length, rawItems, setCompare, storeHydrated])

  useEffect(() => {
    if (rawItems && restoredParam.current !== rawItems) return
    if (!comparisonParam || comparisonParam === rawItems) return
    restoredParam.current = comparisonParam
    router.setParams({ items: comparisonParam })
  }, [comparisonParam, rawItems, router])

  useEffect(() => {
    if (compare.length < 2) {
      setResponse(undefined)
      return
    }
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError(undefined)
    // Assessments describe the exact current set. Keeping the previous response
    // while another set loads can attach an old “strong option” judgment to a
    // product whose peers have changed.
    setResponse(undefined)

    compareProducts(compare, controller.signal)
      .then((nextResponse) => { if (active) setResponse(nextResponse) })
      .catch((reason: unknown) => {
        if (!active || (reason instanceof Error && reason.name === 'AbortError')) return
        setError(shopperErrorText(reason, 'We could not compare these products right now. Try again.'))
      })
      .finally(() => { if (active) setLoading(false) })

    return () => {
      active = false
      controller.abort()
    }
  }, [compare])

  const assessments = useMemo(
    () => new Map(response?.assessments.map((item) => [
      `${item.businessId}:${item.productId}:${item.variantId ?? ''}`,
      item
    ]) ?? []),
    [response]
  )

  // Only meaningful when everything on screen is priced in one currency;
  // otherwise "cheapest" would be a comparison between different units.
  const lowestPriceKey = useMemo(() => {
    const priced = compare.filter((product) => product.price)
    const currencies = new Set(priced.map((product) => product.price!.currency))
    if (priced.length < 2 || currencies.size !== 1) return undefined
    return productKey(priced.reduce((left, right) =>
      right.price!.amountMinor < left.price!.amountMinor ? right : left))
  }, [compare])

  const openProduct = (product: CatalogProductSummary) => {
    selectProduct(product)
    router.push(productHref({
      businessId: product.businessId,
      productId: product.productId,
      title: product.title,
      ...(product.variantId ? { variantId: product.variantId } : {})
    }))
  }

  const removeProduct = (product: CatalogProductSummary) => {
    const lastProduct = compare.length === 1
    toggleCompare(product)
    if (lastProduct) {
      restoredParam.current = undefined
      router.replace('/compare')
    }
  }

  const clear = () => {
    clearCompare()
    restoredParam.current = undefined
    router.replace('/compare')
  }

  const shareComparison = async () => {
    if (!comparisonParam) return
    setShareFeedback(undefined)
    try {
      const result = await shareProduct({
        title: `Compare ${compare.length} products on Arro`,
        path: `/compare?items=${encodeURIComponent(comparisonParam)}`
      })
      setShareFeedback(result === 'copied' ? 'Comparison link copied' : result === 'shared' ? 'Comparison shared' : undefined)
    } catch {
      setShareFeedback('Could not share this comparison')
    }
  }

  if (compare.length < 2) {
    // Arriving from a product page means one slot is already filled. Showing
    // that product beside an empty slot with a search in it makes the missing
    // half the obvious next move, instead of a dead end that says "pick two".
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <Shell className="flex-1 pb-16 pt-4 md:pt-8">
          <Breadcrumb className="mb-3" trail={[{ name: 'Home', href: '/' }, { name: 'Compare' }]} />
          <Heading level={1} className="text-[24px] font-bold leading-8 tracking-[-0.5px] text-ink-950 md:text-[30px]">
            Compare products
          </Heading>
          <Text className="mt-1.5 max-w-[520px] text-[14px] leading-5 text-ink-600">
            {compare.length === 1
              ? 'One picked. Find the product you are weighing it against.'
              : 'Pick two products and Arro puts their price, rating, shop and availability side by side.'}
          </Text>

          {restoring ? <ActivityIndicator className="mt-5 self-start" color={color.ink600} /> : null}
          {!restoring && error ? <View className="mt-5"><Notice tone="warning">{error}</Notice></View> : null}

          <View className={`mt-6 gap-4 ${desktop ? 'flex-row items-start' : ''}`}>
            {compare.map((product) => (
              <View key={productKey(product)} className="min-w-0 flex-1 rounded-2xl border border-line p-4">
                <View className="flex-row items-center gap-3">
                  <View className="h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-fill-soft">
                    {product.imageUrl ? (
                      <ProductImage uri={product.imageUrl} alt={product.title} sizes="64px" className="h-full w-full" />
                    ) : (
                      <Icon name="store" size={18} color={color.ink400} />
                    )}
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={2} className="text-[14px] font-semibold leading-5 text-ink-950">{product.title}</Text>
                    <Text className="mt-0.5 text-[13px] leading-[18px] text-ink-600">{productMoney(product)}</Text>
                  </View>
                  <Tappable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${product.title} from comparison`}
                    onPress={() => removeProduct(product)}
                    className="h-11 w-11 items-center justify-center rounded-full"
                  >
                    <Icon name="close" size={16} color={color.ink600} />
                  </Tappable>
                </View>
              </View>
            ))}

            <View className="min-w-0 flex-1 rounded-2xl border border-dashed border-line-strong p-4">
              <Text className="text-[14px] font-semibold leading-5 text-ink-950">
                {compare.length === 1 ? 'Add the second product' : 'Add a product'}
              </Text>
              <Text className="mt-1 text-[13px] leading-[18px] text-ink-600">
                Search for it, then pick it from the results.
              </Text>
              <View className="mt-3">
                <SearchField
                  onSubmit={(next) => router.push(`${searchHref(next)}?compare=1`)}
                  onSelectProduct={(product) => {
                    if (compare.some((candidate) => productKey(candidate) === productKey(product))) return
                    setCompare([...compare, product])
                  }}
                  placeholder="Search products"
                />
              </View>
            </View>
          </View>
        </Shell>

        <SiteFooter className="mt-10" />
      </ScrollView>
    )
  }

  const labelWidth = desktop ? 168 : 116
  const columnWidth = desktop ? 232 : 168

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <Shell className="flex-1 pb-16 pt-5 md:pt-8">
        <Breadcrumb className="mb-3" trail={[{ name: 'Home', href: '/' }, { name: 'Compare' }]} />

        <Appear className="flex-row items-start justify-between gap-4">
          <View className="min-w-0 flex-1">
            <Text className="text-[13px] font-medium leading-[18px] text-ink-400">Side by side</Text>
            <Heading level={1} className="mt-1 text-[24px] font-bold leading-8 tracking-[-0.5px] text-ink-950 md:text-[32px] md:leading-10">
              Compare products
            </Heading>
          </View>
          <View className="flex-row gap-2">
            <Button size={desktop ? 'sm' : 'md'} variant="outline" icon="share" onPress={() => void shareComparison()}>Share</Button>
            <Button size={desktop ? 'sm' : 'md'} variant="outline" onPress={clear}>Clear</Button>
            {desktop ? <Button size="sm" variant="outline" onPress={() => router.back()}>Back</Button> : null}
          </View>
        </Appear>

        {shareFeedback ? (
          <Text accessibilityLiveRegion="polite" className="mt-3 text-[13px] leading-[18px] text-ink-600">
            {shareFeedback}
          </Text>
        ) : null}

        {loading ? <ActivityIndicator className="mt-6" color={color.ink600} /> : null}
        {error ? <View className="mt-5"><Notice tone="danger">{error}</Notice></View> : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          className="arro-rail -mx-4 mt-6 md:-mx-8 lg:-mx-10"
          contentContainerStyle={{ paddingHorizontal: desktop ? 40 : 16 }}
        >
          <View role="table" accessibilityLabel="Product comparison">
            <View role="row" className="flex-row gap-3">
              <View role="columnheader" accessibilityLabel="Product" style={{ width: labelWidth }} />
              {compare.map((product) => {
                const key = productKey(product)
                const assessment = assessments.get(key)
                return (
                  <View
                    key={key}
                    role="columnheader"
                    accessibilityLabel={product.title}
                    style={{ width: columnWidth }}
                    className="gap-3"
                  >
                    <View className="relative">
                      <Pressable
                        accessibilityRole="link"
                        accessibilityLabel={`Open ${product.title}`}
                        onPress={() => openProduct(product)}
                      >
                        <View className="aspect-square w-full items-center justify-center overflow-hidden rounded-2xl bg-fill-soft p-3">
                          {product.imageUrl ? (
                            <ProductImage
                              uri={product.imageUrl}
                              alt={product.title}
                              width={columnWidth}
                              className="h-full w-full"
                            />
                          ) : (
                            <Icon name="store" size={26} color={color.ink400} />
                          )}
                        </View>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${product.title} from comparison`}
                        onPress={() => removeProduct(product)}
                        hitSlop={6}
                        className="absolute right-2 top-2 h-10 w-10 items-center justify-center rounded-full bg-white/90"
                      >
                        <Icon name="close" size={16} color={color.ink800} />
                      </Pressable>
                      <View className="absolute left-2 top-2">
                        <SaveButton product={product} />
                      </View>
                    </View>

                    <Pressable
                      accessibilityRole="link"
                      accessibilityLabel={`Open ${product.title}`}
                      onPress={() => openProduct(product)}
                      className="gap-1"
                    >
                      <Text numberOfLines={1} className="text-[12px] leading-4 text-ink-400">{shopName(product)}</Text>
                      <Text numberOfLines={2} className="text-[14px] font-medium leading-5 text-ink-800">
                        {product.title}
                      </Text>
                    </Pressable>

                    <View className="flex-row flex-wrap gap-1.5">
                      {lowestPriceKey === key ? <Badge tone="positive" icon="trendingDown">Cheapest</Badge> : null}
                      {assessment ? (
                        <Badge tone={comparisonTone(assessment.comparisonState)}>
                          {comparisonLabel(assessment.comparisonState)}
                        </Badge>
                      ) : null}
                    </View>

                    <Button
                      fullWidth
                      size="sm"
                      variant="outline"
                      icon="cart"
                      disabled={product.availability === 'out_of_stock'}
                      onPress={() => addToCart(product)}
                      accessibilityLabel={`Add ${product.title} to cart`}
                    >
                      Add to cart
                    </Button>
                  </View>
                )
              })}
            </View>

            <View role="rowgroup" className="mt-5 overflow-hidden rounded-2xl border border-line">
              {attributeRows.map((row, rowIndex) => (
                <View role="row" key={row.label} className={`flex-row gap-3 ${rowIndex > 0 ? 'border-t border-line' : ''}`}>
                  <View role="rowheader" style={{ width: labelWidth }} className="bg-fill-soft px-4 py-3">
                    <Text className="text-[13px] font-semibold leading-[18px] text-ink-600">{row.label}</Text>
                  </View>
                  {compare.map((product) => (
                    <View role="cell" key={`${row.label}:${productKey(product)}`} style={{ width: columnWidth }} className="py-3">
                      <Text
                        accessibilityLabel={`${product.title}, ${row.label}: ${row.value(product)}`}
                        numberOfLines={2}
                        className="text-[14px] leading-5 text-ink-800"
                      >
                        {row.value(product)}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </View>
        </ScrollView>

        <View className="mt-8 gap-3 md:flex-row">
          {compare.map((product) => {
            const item = assessments.get(productKey(product))
            if (!item || (item.strengths.length === 0 && item.risks.length === 0)) return null
            return (
              <View key={`assessment:${productKey(product)}`} className="flex-1 rounded-2xl bg-fill-soft p-4">
                <Text numberOfLines={2} className="text-[15px] font-semibold leading-5 text-ink-950">
                  {product.title}
                </Text>
                {item.strengths.length > 0 ? (
                  <Text className="mt-3 text-[12px] font-semibold uppercase leading-4 tracking-[0.6px] text-positive">
                    Good for
                  </Text>
                ) : null}
                {item.strengths.slice(0, 3).map((strength) => (
                  <AssessmentLine key={strength} text={strength} positive />
                ))}
                {item.risks.length > 0 ? (
                  <Text className="mt-3 text-[12px] font-semibold uppercase leading-4 tracking-[0.6px] text-warning">
                    Watch out for
                  </Text>
                ) : null}
                {item.risks.slice(0, 3).map((risk) => (
                  <AssessmentLine key={risk} text={risk} positive={false} />
                ))}
              </View>
            )
          })}
        </View>
      </Shell>

      <SiteFooter className="mt-10" />
    </ScrollView>
  )
}
