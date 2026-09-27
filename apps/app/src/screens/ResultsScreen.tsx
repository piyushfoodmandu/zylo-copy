import { useRouter } from 'expo-router'
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import { searchProducts } from '../api/client'
import { Sheet } from '../components/Sheet'
import { Breadcrumb } from '../components/Breadcrumb'
import { EmptyResults } from '../components/EmptyResults'
import { FilterOptionSheet } from '../components/FilterOptionSheet'
import { FilterRail } from '../components/FilterRail'
import { Heading } from '../components/semantic'
import { Icon } from '../components/Icon'
import { Appear } from '../components/motion'
import { ProductCard } from '../components/ProductCard'
import { SiteFooter } from '../components/SiteFooter'
import { Shell, shellClass } from '../components/Page'
import { ResultsGridSkeleton } from '../components/skeletons'
import { Badge, Button, Chip, Field, Notice } from '../components/ui'
import {
  applyFilters,
  conditionLabel,
  deriveFacets,
  emptyFilters,
  hasActiveFilters,
  type ShopperFilters
} from '../lib/facets'
import { useDocumentTitle } from '../lib/document-title'
import { gridColumns, useLayoutMode } from '../lib/layout'
import { searchHref } from '../lib/product-url'
import { freshnessLabel } from '../lib/product-display'
import { groupCatalogProducts, type CatalogProductGroup } from '../lib/product-groups'
import { shopperErrorText, shopperSearchNotice } from '../lib/shopper-copy'
import { color } from '../lib/theme'
import { useSavedStore } from '../store/useSavedStore'
import { useShopStore } from '../store/useShopStore'
import type { CatalogProductSummary, SearchResponse } from '../types/catalog'

type Sort = 'relevance' | 'price_asc' | 'price_desc'
type SheetName = 'sort' | 'price' | 'shop' | 'brand' | 'rating' | 'condition' | 'currency'

const sortOptions: ReadonlyArray<readonly [Sort, string]> = [
  ['relevance', 'Best match'],
  ['price_asc', 'Lowest price'],
  ['price_desc', 'Highest price']
]

const ratingOptions = [4.5, 4, 3.5] as const

/** The pointer layout's filter column, and the space between it and the grid. */
const railColumn = 260
const railGap = 32
/** Matches `lg:px-10` in the page shell. */
const gutter = 40

/**
 * Ordering is applied to what is on screen, always. The previous version bailed
 * out whenever the page held more than one currency and silently left the grid
 * in source order — the control moved, nothing else did.
 *
 * Mixed currencies are still not compared numerically. Offers in the majority
 * currency sort against each other; everything else keeps its relative order
 * and sits after them, which is the same rule the product page already uses.
 */
const sortGroups = (groups: CatalogProductGroup[], sort: Sort) => {
  if (sort === 'relevance') return groups

  const counts = new Map<string, number>()
  for (const group of groups) {
    const currency = group.product.price?.currency
    if (currency) counts.set(currency, (counts.get(currency) ?? 0) + 1)
  }
  let primary: string | undefined
  let best = 0
  for (const [currency, count] of counts) {
    if (count > best) { primary = currency; best = count }
  }

  const comparable = (group: CatalogProductGroup) =>
    Boolean(group.product.price && group.product.price.currency === primary)

  return [...groups].sort((left, right) => {
    if (comparable(left) !== comparable(right)) return comparable(left) ? -1 : 1
    if (!comparable(left)) return 0
    const leftPrice = left.product.price!.amountMinor
    const rightPrice = right.product.price!.amountMinor
    return sort === 'price_asc' ? leftPrice - rightPrice : rightPrice - leftPrice
  })
}

const offerIdentity = (product: CatalogProductSummary) => [
  product.businessId,
  product.productId,
  product.seller?.domain || product.seller?.id || product.businessId,
  product.variantId ?? ''
].join(' ')

const appendSearchPage = (current: SearchResponse, next: SearchResponse): SearchResponse => {
  const items = [...current.items]
  const seen = new Set(items.map(offerIdentity))
  for (const item of next.items) {
    const identity = offerIdentity(item)
    if (seen.has(identity)) continue
    seen.add(identity)
    items.push(item)
  }

  const messages = [...current.messages]
  const messageKeys = new Set(messages.map((message) => `${message.code}:${message.text}`))
  for (const message of next.messages) {
    const key = `${message.code}:${message.text}`
    if (messageKeys.has(key)) continue
    messageKeys.add(key)
    messages.push(message)
  }

  return { ...next, items, messages }
}

const SheetOption = ({
  label,
  detail,
  selected,
  disabled = false,
  onPress
}: {
  label: string
  detail?: string
  selected: boolean
  disabled?: boolean
  onPress: () => void
}) => (
  <Pressable
    accessibilityRole="radio"
    accessibilityLabel={label}
    accessibilityState={{ checked: selected, disabled }}
    aria-checked={selected}
    aria-disabled={disabled}
    disabled={disabled}
    onPress={onPress}
    className={`min-h-14 flex-row items-center gap-3 border-b border-line ${disabled ? 'opacity-40' : ''}`}
  >
    <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] leading-5 text-ink-950">{label}</Text>
    {detail ? <Text className="text-[13px] leading-[18px] text-ink-400">{detail}</Text> : null}
    {selected ? <Icon name="check" size={18} color={color.arro600} /> : null}
  </Pressable>
)

/** Row of cards. Memoised on the group so a filter change re-renders one row. */
const GridRow = memo(function GridRow({
  item,
  index,
  columns,
  query,
  showCompare,
  onCompare
}: {
  item: CatalogProductGroup
  index: number
  columns: number
  query: string
  showCompare: boolean
  onCompare?: (product: CatalogProductSummary) => void
}) {
  return (
    <View className={columns > 1 ? 'flex-1' : 'w-full'}>
      <ProductCard
        group={item}
        priority={index < columns}
        query={query}
        showCompare={showCompare}
        onCompare={onCompare}
        headingLevel={2}
      />
    </View>
  )
})

export type ResultsScreenProps = {
  /** Server-rendered first page, so a crawler and a cold visitor both get products. */
  initialResponse?: SearchResponse | undefined
  initialQuery?: string | undefined
  /** Search was opened from Compare and selecting a card should complete that journey. */
  compareMode?: boolean | undefined
}

export function ResultsScreen({ initialResponse, initialQuery, compareMode = false }: ResultsScreenProps = {}) {
  const router = useRouter()
  const routeQuery = initialQuery?.trim() ?? ''
  const { columns, compact, desktop, width } = useLayoutMode()

  const submittedQuery = useShopStore((state) => state.submittedQuery)
  const sort = useShopStore((state) => state.sort)
  const setSort = useShopStore((state) => state.setSort)
  const minPrice = useShopStore((state) => state.minPrice)
  const maxPrice = useShopStore((state) => state.maxPrice)
  const setPriceRange = useShopStore((state) => state.setPriceRange)
  const recordQuery = useSavedStore((state) => state.recordQuery)
  const searchQuery = routeQuery || submittedQuery

  const [response, setResponse] = useState<SearchResponse | undefined>(initialResponse)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()
  const [loadMoreError, setLoadMoreError] = useState<string>()
  const [filters, setFilters] = useState<ShopperFilters>(emptyFilters)
  const [openSheet, setOpenSheet] = useState<SheetName>()
  const [minValue, setMinValue] = useState(minPrice?.toString() ?? '')
  const [maxValue, setMaxValue] = useState(maxPrice?.toString() ?? '')
  const searchGeneration = useRef(0)

  const currencyFilter = filters.currency
  const brandFilter = filters.brand
  // Currency only reaches the request when it changes what the source filters on,
  // so switching currency for display alone does not cost a round trip.
  const priceCurrency = currencyFilter ?? 'USD'
  const priceRequestCurrency = minPrice !== undefined || maxPrice !== undefined ? priceCurrency : undefined

  const serverAnsweredQuery = initialResponse && (initialQuery ?? '') === searchQuery
  const [serverResultsUsed, setServerResultsUsed] = useState(Boolean(serverAnsweredQuery))

  useDocumentTitle(searchQuery ? `${searchQuery} — compare prices · Arro` : 'Search · Arro')

  // A query that reached this screen was really run, whichever surface sent it.
  useEffect(() => {
    if (searchQuery) recordQuery(searchQuery)
  }, [recordQuery, searchQuery])

  useEffect(() => {
    if (!searchQuery) return
    const generation = ++searchGeneration.current
    // The server rendered this exact query with no filters applied, so the first
    // client pass has nothing new to ask for.
    if (
      serverResultsUsed &&
      serverAnsweredQuery &&
      sort === 'relevance' &&
      minPrice === undefined &&
      maxPrice === undefined &&
      !brandFilter
    ) {
      return
    }
    setServerResultsUsed(false)
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setLoadingMore(false)
    setResponse(undefined)
    setError(undefined)
    setLoadMoreError(undefined)

    searchProducts(searchQuery, {
      sort,
      ...(minPrice !== undefined ? { minPrice } : {}),
      ...(maxPrice !== undefined ? { maxPrice } : {}),
      ...(priceRequestCurrency ? { priceCurrency: priceRequestCurrency } : {}),
      ...(brandFilter ? { brands: [brandFilter] } : {})
    }, controller.signal)
      .then((nextResponse) => {
        if (active && generation === searchGeneration.current) setResponse(nextResponse)
      })
      .catch((reason: unknown) => {
        if (!active || generation !== searchGeneration.current || (reason instanceof Error && reason.name === 'AbortError')) return
        setError(shopperErrorText(reason, 'We could not load search results. Try again.'))
      })
      .finally(() => {
        if (active && generation === searchGeneration.current) setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [brandFilter, maxPrice, minPrice, priceRequestCurrency, searchQuery, serverAnsweredQuery, serverResultsUsed, sort])

  const nextCursor = response?.pageInfo?.nextCursor

  const loadMore = useCallback(async () => {
    if (!searchQuery || !nextCursor || loadingMore || !response) return
    const generation = searchGeneration.current
    setLoadingMore(true)
    setLoadMoreError(undefined)
    try {
      // A client-side filter can hide an entire fetched page, which is how the
      // button came to do visibly nothing. Keep pulling pages until something
      // new survives the filters, bounded so a narrow filter cannot walk the
      // whole catalogue.
      let cursor: string | undefined = nextCursor
      let merged = response
      let visibleCount = applyFilters(groupCatalogProducts(merged.items), filters).length
      for (let page = 0; page < 3 && cursor; page += 1) {
        const nextResponse: SearchResponse = await searchProducts(searchQuery, {
          sort,
          cursor,
          ...(minPrice !== undefined ? { minPrice } : {}),
          ...(maxPrice !== undefined ? { maxPrice } : {}),
          ...(priceRequestCurrency ? { priceCurrency: priceRequestCurrency } : {}),
          ...(brandFilter ? { brands: [brandFilter] } : {})
        })

        if (generation !== searchGeneration.current) return
        const nextMerged = appendSearchPage(merged, nextResponse)
        const nextVisibleCount = applyFilters(groupCatalogProducts(nextMerged.items), filters).length
        const foundVisibleProduct = nextVisibleCount > visibleCount
        merged = nextMerged
        visibleCount = nextVisibleCount

        cursor = nextResponse.pageInfo?.hasNextPage ? nextResponse.pageInfo.nextCursor : undefined
        if (foundVisibleProduct) break
      }
      if (generation === searchGeneration.current) setResponse(merged)
    } catch (reason) {
      if (generation === searchGeneration.current) {
        setLoadMoreError(shopperErrorText(reason, 'We could not load more products. Try again.'))
      }
    } finally {
      if (generation === searchGeneration.current) setLoadingMore(false)
    }
  }, [brandFilter, filters, loadingMore, maxPrice, minPrice, nextCursor, priceRequestCurrency, response, searchQuery, sort])

  const groups = useMemo(() => groupCatalogProducts(response?.items ?? []), [response])
  const derivedFacets = useMemo(() => deriveFacets(groups), [groups])
  const facets = useMemo(() => {
    if (!brandFilter || derivedFacets.brands.some(([brand]) => brand === brandFilter)) return derivedFacets
    return { ...derivedFacets, brands: [[brandFilter, groups.length] as [string, number]] }
  }, [brandFilter, derivedFacets, groups.length])
  const currencyOptions = useMemo(
    () => facets.currencies.map(([value, count]) => ({ value, label: value, count })),
    [facets.currencies]
  )
  const shopOptions = useMemo(
    () => facets.shops.map(([value, count]) => ({ value, label: value, count })),
    [facets.shops]
  )
  const brandOptions = useMemo(
    () => facets.brands.map(([value, count]) => ({ value, label: value, count })),
    [facets.brands]
  )
  const conditionOptions = useMemo(
    () => facets.conditions.map(([value, count]) => ({ value, label: conditionLabel(value), count })),
    [facets.conditions]
  )
  // Rebuilding a long grid is the expensive half of toggling a filter. Deferring
  // it lets the control that was tapped repaint immediately and the grid catch
  // up, instead of the whole interaction waiting on the list.
  const deferredFilters = useDeferredValue(filters)
  const filtered = useMemo(() => applyFilters(groups, deferredFilters), [groups, deferredFilters])
  const visibleGroups = useMemo(() => sortGroups(filtered, sort), [filtered, sort])

  const visibleCurrencies = useMemo(
    () => new Set(visibleGroups.flatMap((group) => group.product.price ? [group.product.price.currency] : [])),
    [visibleGroups]
  )
  // Price ordering needs prices, nothing more. Mixed currencies are handled by
  // the comparator rather than by disabling the control.
  const priceSortAvailable = visibleGroups.some((group) => Boolean(group.product.price))

  const source = response?.items[0]?.sourceLabel
  const shopCount = useMemo(
    () => new Set((response?.items ?? []).map((item) => item.seller?.domain || item.businessId)).size,
    [response]
  )
  const detectedCategory = response?.interpretedQuery?.detectedCategories?.[0]
  const notice = shopperSearchNotice(response)
  const filtersActive = hasActiveFilters(filters, minPrice, maxPrice)

  const resetAll = useCallback(() => {
    setFilters(emptyFilters)
    setMinValue('')
    setMaxValue('')
    setPriceRange(undefined, undefined)
  }, [setPriceRange])

  const openComparison = useCallback(() => {
    router.replace('/compare')
  }, [router])

  const applyPriceRange = useCallback(() => {
    const min = minValue.trim() ? Number(minValue) : undefined
    const max = maxValue.trim() ? Number(maxValue) : undefined
    setPriceRange(
      min !== undefined && Number.isFinite(min) && min >= 0 ? min : undefined,
      max !== undefined && Number.isFinite(max) && max >= 0 ? max : undefined
    )
    setOpenSheet(undefined)
  }, [maxValue, minValue, setPriceRange])

  const priceLabel = minPrice !== undefined || maxPrice !== undefined
    ? `${minPrice ?? 0} to ${maxPrice ?? 'any'}`
    : 'Price'
  const sortLabel = sortOptions.find(([value]) => value === sort)?.[1] ?? 'Best match'

  const summary = loading
    ? ''
    : filtersActive
      ? `${visibleGroups.length} of ${groups.length} products`
      : `${groups.length} product${groups.length === 1 ? '' : 's'}${shopCount ? ` from ${shopCount} shop${shopCount === 1 ? '' : 's'}` : ''}`

  const header = (
    <View className="gap-4 pb-5">
      <Appear className="gap-1.5 pt-4">
        <Breadcrumb
          className="mb-1"
          trail={[
            { name: 'Home', href: '/' },
            ...(detectedCategory ? [{ name: detectedCategory, href: searchHref(detectedCategory) }] : []),
            { name: searchQuery || 'Search results' }
          ]}
        />
        <View className="flex-row flex-wrap items-center gap-2">
          <Heading level={1} className="text-[26px] font-bold leading-8 tracking-[-0.6px] text-ink-950 md:text-[32px] md:leading-9">
            {searchQuery || 'Search results'}
          </Heading>
          {detectedCategory ? <Badge tone="accent">{detectedCategory}</Badge> : null}
        </View>
        {summary ? <Text className="text-[14px] leading-5 text-ink-600">{summary}</Text> : null}
      </Appear>

      {groups.length === 0 ? null : desktop ? (
        // The rail owns the filters here, so the bar keeps only the two controls
        // that belong above the results: ordering, and a way out of a filter.
        <View className="flex-row items-center gap-2">
          {sortOptions.map(([value, label]) => (
            <Chip
              key={value}
              active={sort === value}
              disabled={value !== 'relevance' && !priceSortAvailable}
              onPress={() => setSort(value)}
            >
              {label}
            </Chip>
          ))}
          {filtersActive ? (
            <Chip icon="close" onPress={resetAll} accessibilityLabel="Clear all filters">Clear filters</Chip>
          ) : null}
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="arro-rail -mx-4 md:-mx-8 lg:-mx-10"
          contentContainerStyle={{ gap: 8, paddingHorizontal: compact ? 16 : 32 }}
        >
          <Chip icon="sort" iconRight="chevronDown" active={sort !== 'relevance'} onPress={() => setOpenSheet('sort')}>
            {sortLabel}
          </Chip>
          <Chip
            iconRight="chevronDown"
            active={minPrice !== undefined || maxPrice !== undefined}
            onPress={() => setOpenSheet('price')}
          >
            {priceLabel}
          </Chip>
          {facets.currencies.length > 0 ? (
            <Chip iconRight="chevronDown" active={Boolean(currencyFilter)} onPress={() => setOpenSheet('currency')}>
              {currencyFilter ?? 'Currency'}
            </Chip>
          ) : null}
          {facets.shops.length > 0 ? (
            <Chip iconRight="chevronDown" active={Boolean(filters.shop)} onPress={() => setOpenSheet('shop')}>
              {filters.shop ?? 'Shop'}
            </Chip>
          ) : null}
          {facets.brands.length > 0 ? (
            <Chip iconRight="chevronDown" active={Boolean(brandFilter)} onPress={() => setOpenSheet('brand')}>
              {brandFilter ?? 'Brand'}
            </Chip>
          ) : null}
          {facets.showRating ? (
            <Chip iconRight="chevronDown" active={filters.minRating !== undefined} onPress={() => setOpenSheet('rating')}>
              {filters.minRating ? `${filters.minRating}+ stars` : 'Rating'}
            </Chip>
          ) : null}
          {facets.conditions.length > 0 ? (
            <Chip iconRight="chevronDown" active={Boolean(filters.condition)} onPress={() => setOpenSheet('condition')}>
              {filters.condition ? conditionLabel(filters.condition) : 'Condition'}
            </Chip>
          ) : null}
          {facets.showAvailability ? (
            <Chip
              active={filters.inStockOnly}
              {...(filters.inStockOnly ? { icon: 'check' as const } : {})}
              onPress={() => setFilters((current) => ({ ...current, inStockOnly: !current.inStockOnly }))}
            >
              In stock
            </Chip>
          ) : null}
          {filtersActive ? (
            <Chip icon="close" onPress={resetAll} accessibilityLabel="Clear all filters">Clear</Chip>
          ) : null}
        </ScrollView>
      )}

      {error ? <Notice tone="danger" icon="alert" title="We could not load these results">{error}</Notice> : null}
      {!error && compareMode && groups.length > 0 ? (
        <Notice icon="compare" title="Pick a product to compare">
          Use the compare control on any result. Arro will keep your first pick and take you back to the side-by-side view.
        </Notice>
      ) : null}
      {!error && notice && groups.length > 0 ? <Notice>{notice}</Notice> : null}
      {!error && !loading && visibleCurrencies.size > 1 ? (
        <Notice>
          These shops price in {[...visibleCurrencies].join(', ')}. Price sorting keeps the most common currency together;
          choose one currency for a direct comparison.
        </Notice>
      ) : null}
    </View>
  )

  const empty = loading ? (
    <ResultsGridSkeleton columns={columns} rows={2} />
  ) : error ? null : (
    <EmptyResults query={searchQuery} filtered={groups.length > 0} onClearFilters={resetAll} />
  )

  const sheets = (
    <>
    <Sheet visible={openSheet === 'sort'} title="Sort" onClose={() => setOpenSheet(undefined)}>
      <View className="px-5 pb-6">
        {!priceSortAvailable && visibleGroups.length > 0 ? (
          <Text className="py-3 text-[13px] leading-[18px] text-ink-600">
            These results do not include a comparable price yet.
          </Text>
        ) : null}
        <View role="radiogroup" aria-label="Sort">
        {sortOptions.map(([value, label]) => (
          <SheetOption
            key={value}
            label={label}
            selected={sort === value}
            disabled={value !== 'relevance' && !priceSortAvailable}
            onPress={() => {
              setSort(value)
              setOpenSheet(undefined)
            }}
          />
        ))}
        </View>
      </View>
    </Sheet>

    <Sheet
      visible={openSheet === 'price'}
      title="Price"
      onClose={() => setOpenSheet(undefined)}
      footer={<Button fullWidth onPress={applyPriceRange}>Apply price</Button>}
    >
      <View className="gap-3 px-5 pb-5">
        <Text className="text-[13px] leading-[18px] text-ink-600">
          Applied at the source in {currencyFilter ?? facets.singleCurrency ?? priceCurrency}.
        </Text>
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Field value={minValue} onChangeText={setMinValue} placeholder="Min" accessibilityLabel="Minimum price" keyboardType="numeric" />
          </View>
          <View className="flex-1">
            <Field value={maxValue} onChangeText={setMaxValue} placeholder="Max" accessibilityLabel="Maximum price" keyboardType="numeric" />
          </View>
        </View>
      </View>
    </Sheet>

    <FilterOptionSheet
      visible={openSheet === 'currency'}
      title="Currency"
      allLabel="Any currency"
      options={currencyOptions}
      selected={currencyFilter}
      onSelect={(currency) => setFilters((current) => ({ ...current, currency }))}
      onClose={() => setOpenSheet(undefined)}
    />

    <FilterOptionSheet
      visible={openSheet === 'shop'}
      title="Shop"
      allLabel="All shops"
      options={shopOptions}
      selected={filters.shop}
      onSelect={(shop) => setFilters((current) => ({ ...current, shop }))}
      onClose={() => setOpenSheet(undefined)}
      searchLabel="shops"
    />

    <FilterOptionSheet
      visible={openSheet === 'brand'}
      title="Brand"
      allLabel="All brands"
      options={brandOptions}
      selected={brandFilter}
      onSelect={(brand) => setFilters((current) => ({ ...current, brand }))}
      onClose={() => setOpenSheet(undefined)}
      searchLabel="brands"
    />

    <Sheet visible={openSheet === 'rating'} title="Rating" onClose={() => setOpenSheet(undefined)}>
      <View className="px-5 pb-6">
        <View role="radiogroup" aria-label="Rating">
        <SheetOption
          label="Any rating"
          selected={filters.minRating === undefined}
          onPress={() => {
            setFilters((current) => ({ ...current, minRating: undefined }))
            setOpenSheet(undefined)
          }}
        />
        {ratingOptions.map((value) => (
          <SheetOption
            key={value}
            label={`${value} stars and up`}
            selected={filters.minRating === value}
            onPress={() => {
              setFilters((current) => ({ ...current, minRating: value }))
              setOpenSheet(undefined)
            }}
          />
        ))}
        </View>
      </View>
    </Sheet>

    <FilterOptionSheet
      visible={openSheet === 'condition'}
      title="Condition"
      allLabel="Any condition"
      options={conditionOptions}
      selected={filters.condition}
      onSelect={(condition) => setFilters((current) => ({ ...current, condition }))}
      onClose={() => setOpenSheet(undefined)}
    />
    </>
  )

  // The pointer layout draws its own grid. A crawler needs every card in the
  // document anyway, so the list on web is already unvirtualised — dropping the
  // FlatList here buys the page a single scroll container, which is what lets
  // the title, the filter column and the first card share one left edge.
  const gridColumnCount = desktop ? gridColumns(width - railColumn - railGap - gutter * 2) : columns

  const desktopGrid = (
    <View className="-mx-2 flex-row flex-wrap" role="list">
      {visibleGroups.map((group, index) => (
        <View
          key={group.key}
          style={{ width: `${100 / gridColumnCount}%` }}
          className="px-2 pb-9"
        >
          <ProductCard
            group={group}
            priority={index < gridColumnCount}
            query={searchQuery}
            showCompare={compareMode}
            onCompare={compareMode ? openComparison : undefined}
            headingLevel={2}
          />
        </View>
      ))}
    </View>
  )

  if (desktop) {
    return (
      <View className="flex-1 bg-white">
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ flexGrow: 1 }}
        >
          <Shell className="flex-1 pt-5">
            {header}

            <View className="flex-1 flex-row items-start gap-8">
              {groups.length > 0 || loading ? (
                <View className="arro-sticky" style={{ width: railColumn }}>
                  <FilterRail
                    facets={facets}
                    filters={filters}
                    onFilters={setFilters}
                    minValue={minValue}
                    maxValue={maxValue}
                    onMin={setMinValue}
                    onMax={setMaxValue}
                    onApplyPrice={applyPriceRange}
                    priceCurrency={currencyFilter ?? facets.singleCurrency ?? priceCurrency}
                    active={filtersActive}
                    onReset={resetAll}
                  />
                </View>
              ) : null}

              <View className="min-w-0 flex-1">
                {loading ? (
                  <ResultsGridSkeleton columns={gridColumnCount} rows={2} />
                ) : (
                  <>
                    {visibleGroups.length === 0 ? empty : desktopGrid}
                    {response?.pageInfo?.hasNextPage || loadMoreError ? (
                    <View className="items-center gap-3 pt-4">
                      {response?.pageInfo?.hasNextPage && nextCursor ? (
                        <Button variant="outline" loading={loadingMore} onPress={() => void loadMore()}>
                          {loadingMore ? 'Loading' : visibleGroups.length === 0 ? 'Check more products' : 'Show more products'}
                        </Button>
                      ) : null}
                      {loadMoreError ? (
                        <Text className="text-center text-[13px] leading-[18px] text-danger">{loadMoreError}</Text>
                      ) : null}
                    </View>
                    ) : null}
                  </>
                )}
              </View>
            </View>
          </Shell>

          <SiteFooter className="mt-16" />
        </ScrollView>

        {sheets}
      </View>
    )
  }

  return (
    <View className="flex-1 bg-white">
      <FlatList
        key={`grid-${columns}`}
        data={visibleGroups}
        numColumns={columns}
        keyExtractor={(group) => group.key}
        renderItem={({ item, index }) => (
          <GridRow
            item={item}
            index={index}
            columns={columns}
            query={searchQuery}
            showCompare={compareMode}
            onCompare={compareMode ? openComparison : undefined}
          />
        )}
        {...(columns > 1 ? { columnWrapperStyle: { gap: 16 } } : {})}
        role="list"
        contentContainerClassName={shellClass}
        contentContainerStyle={{ flexGrow: 1 }}
        ItemSeparatorComponent={() => <View className="h-8" />}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        ListFooterComponent={
          <>
            {response?.pageInfo?.hasNextPage || loadMoreError ? (
              <View className="items-center gap-3 pt-9">
                {response?.pageInfo?.hasNextPage && nextCursor ? (
                  <Button variant="outline" loading={loadingMore} onPress={() => void loadMore()}>
                    {loadingMore ? 'Loading' : visibleGroups.length === 0 ? 'Check more products' : 'Show more products'}
                  </Button>
                ) : null}
                {loadMoreError ? (
                  <Text className="text-center text-[13px] leading-[18px] text-danger">{loadMoreError}</Text>
                ) : null}
              </View>
            ) : null}
            {/* Pulled back out of the list's gutter so it reads as the end of the
                page rather than another row of results. */}
            <SiteFooter className="-mx-4 mt-16 md:-mx-8 lg:-mx-10" />
          </>
        }
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="automatic"
        initialNumToRender={Platform.OS === 'web' ? Math.max(visibleGroups.length, 1) : columns * 4}
        {...(Platform.OS === 'web' ? { disableVirtualization: true } : { windowSize: 7 })}
      />

      {sheets}
    </View>
  )
}
