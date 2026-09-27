import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ScrollView, Text, TextInput, View } from 'react-native'
import { getProductDetail } from '../api/client'
import { Breadcrumb } from '../components/Breadcrumb'
import { Carousel } from '../components/Carousel'
import { Icon } from '../components/Icon'
import { Appear, Tappable } from '../components/motion'
import { ProductCard, railCardWidth } from '../components/ProductCard'
import { Shell } from '../components/Page'
import { ProductLink } from '../components/ProductLink'
import { SiteFooter } from '../components/SiteFooter'
import { Heading } from '../components/semantic'
import { Badge, Button, Notice } from '../components/ui'
import { popularSearches } from '../lib/categories'
import { useDocumentTitle } from '../lib/document-title'
import { gridColumns, useLayoutMode } from '../lib/layout'
import { formatMoney } from '../lib/money'
import { relativeTime } from '../lib/product-display'
import { singleProductGroup } from '../lib/product-groups'
import { searchHref } from '../lib/product-url'
import { color } from '../lib/theme'
import { defaultListId, defaultListName, useSavedStore, type SavedItem } from '../store/useSavedStore'
import { useShopStore } from '../store/useShopStore'
import type { CatalogProductSummary, Money } from '../types/catalog'

type SavedCheck = {
  price?: Money
  availability: CatalogProductSummary['availability']
  /** The shop answered, and this product is not in its catalogue any more. */
  gone?: boolean
}

/**
 * Opening a saved list used to ask for every product at once, which is enough
 * concurrent traffic to make a shop start refusing — and a refusal came back
 * looking exactly like a delisting. Measured on this catalogue: thirteen items
 * checked one after another reported nothing missing, the same thirteen fired
 * together reported four "no longer sold here", every one of them an HTTP
 * error rather than an answer.
 */
const revalidateConcurrency = 4

const mapWithLimit = async <T, R>(
  values: T[],
  limit: number,
  run: (value: T) => Promise<R>
): Promise<R[]> => {
  const results = new Array<R>(values.length)
  let next = 0

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++
      results[index] = await run(values[index]!)
    }
  }))

  return results
}

/** Mirrors `shellClass`, whose horizontal padding is `px-4 md:px-8 lg:px-10`. */
const shellMaxWidth = 1680
const shellGutter = (width: number) => (width >= 1024 ? 40 : width >= 768 ? 32 : 16)

export function SavedScreen() {
  const router = useRouter()
  const { columns, width, desktop } = useLayoutMode()
  // No filter rail sits beside this grid, so it measures the shell it actually
  // gets rather than reusing the window-wide count the results page needs.
  const gridColumnCount = desktop
    ? gridColumns(Math.min(width, shellMaxWidth) - shellGutter(width) * 2)
    : columns
  const allItems = useSavedStore((state) => state.items)
  const lists = useSavedStore((state) => state.lists)
  const createList = useSavedStore((state) => state.createList)
  const deleteList = useSavedStore((state) => state.deleteList)
  const moveToList = useSavedStore((state) => state.moveToList)
  const compare = useShopStore((state) => state.compare)
  const toggleCompare = useShopStore((state) => state.toggleCompare)
  const [activeList, setActiveList] = useState<string>(defaultListId)
  const [newListName, setNewListName] = useState('')
  const [creating, setCreating] = useState(false)

  const items = useMemo(
    () => allItems.filter((item) => (item.listId ?? defaultListId) === activeList),
    [activeList, allItems]
  )
  const recent = useSavedStore((state) => state.recent)
  const clear = useSavedStore((state) => state.clear)
  const [checks, setChecks] = useState<Record<string, SavedCheck>>({})
  const [checking, setChecking] = useState(false)
  const lastRevalidatedList = useRef<string | undefined>(undefined)

  useDocumentTitle(items.length ? `Saved (${items.length}) · Arro` : 'Saved · Arro')

  const revalidate = useCallback(async (current: SavedItem[]) => {
    if (current.length === 0) return
    setChecking(true)
    try {
      const results = await mapWithLimit(current, revalidateConcurrency, async (item) => {
        try {
          const response = await getProductDetail({
            businessId: item.product.businessId,
            productId: item.product.productId,
            ...(item.product.variantId ? { variantId: item.product.variantId } : {})
          })
          if (!response.product) {
            // Only a shop that answered can prove it stopped selling something.
            // A source that errored has told us nothing, so the item keeps the
            // snapshot it was saved with rather than being called delisted.
            return [item.key, response.state === 'unavailable'
              ? undefined
              : { availability: 'unknown' as const, gone: true }] as const
          }
          return [item.key, {
            ...(response.product.price ? { price: response.product.price } : {}),
            availability: response.product.availability
          }] as const
        } catch {
          // Unreachable is not the same as delisted, so an unanswered product
          // simply keeps the snapshot it was saved with.
          return [item.key, undefined] as const
        }
      })

      const next: Record<string, SavedCheck> = {}
      for (const [key, value] of results) if (value) next[key] = value
      setChecks(next)
    } finally {
      setChecking(false)
    }
  }, [])

  /**
   * Reopening a saved list revalidates it. Prices, stock and whether the shop
   * still lists the product all move while the list sits there, and a saved
   * item that quietly shows a three-week-old price is worse than no list.
   */
  useEffect(() => {
    if (lastRevalidatedList.current === activeList || items.length === 0) return
    lastRevalidatedList.current = activeList
    setChecks({})
    void revalidate(items)
  }, [activeList, items, revalidate])

  // Two different facts, so two different counts. A shop that dropped a product
  // and a shop that has it but is out of stock are not the same news, and
  // reporting them as one number produced a warning that fit neither.
  const goneCount = useMemo(
    () => items.filter((item) => checks[item.key]?.gone).length,
    [checks, items]
  )
  const outOfStockCount = useMemo(
    () => items.filter((item) => checks[item.key]?.availability === 'out_of_stock').length,
    [checks, items]
  )
  // An item the shop never answered for keeps its saved snapshot. Saying so is
  // the difference between a stale price and a price presented as current.
  const uncheckedCount = useMemo(
    () => (Object.keys(checks).length === 0
      ? 0
      : items.filter((item) => !checks[item.key]).length),
    [checks, items]
  )

  if (allItems.length === 0) {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1 }}>
        <Shell className="max-w-[840px] flex-1 py-12">
          <Appear className="items-center">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-arro-50">
              <Icon name="heart" size={26} color={color.arro600} />
            </View>
            <Heading level={1} className="mt-5 text-[24px] font-bold leading-8 text-ink-950">Nothing saved yet</Heading>
            <Text className="mt-2 max-w-[460px] text-center text-[15px] leading-6 text-ink-600">
              Use the heart on any product to keep it here. Arro remembers the search it came from and rechecks the
              price and stock every time you come back.
            </Text>
            <View className="mt-6"><Button variant="accent" onPress={() => router.push('/')}>Find something</Button></View>
          </Appear>

          {recent.length > 0 ? (
            <Appear delay={80} className="mt-12 border-t border-line pt-8">
              <View className="mb-3 flex-row items-center gap-2">
                <Icon name="history" size={16} color={color.ink400} />
                <Heading level={2} className="text-[15px] font-bold leading-5 text-ink-950">Recently viewed</Heading>
              </View>
              <Carousel
                label="Recently viewed"
                data={recent}
                keyExtractor={(product) => `${product.businessId}:${product.productId}`}
                itemWidth={railCardWidth}
                renderItem={(product) => <ProductCard group={singleProductGroup(product)} showCompare={false} />}
              />
            </Appear>
          ) : (
            <View className="mt-12 border-t border-line pt-8">
              <Text className="mb-3 text-[12px] font-semibold uppercase leading-4 tracking-[0.6px] text-ink-400">
                Popular right now
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {popularSearches.slice(0, 6).map((item) => (
                  <ProductLink key={item} href={searchHref(item)} className="min-h-10 justify-center rounded-full bg-fill px-4">
                    <Text className="text-[13px] font-medium leading-[18px] text-ink-800">{item}</Text>
                  </ProductLink>
                ))}
              </View>
            </View>
          )}
        </Shell>

        <SiteFooter className="mt-10" />
      </ScrollView>
    )
  }

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1 }}>
      <Shell className="flex-1 pb-16 pt-4 md:pt-8">
        <Breadcrumb className="mb-3" trail={[{ name: 'Home', href: '/' }, { name: 'Saved' }]} />

        <Appear className="flex-row items-end justify-between gap-4">
          <View className="min-w-0 flex-1">
            <Heading level={1} className="text-[24px] font-bold leading-8 tracking-[-0.5px] text-ink-950 md:text-[32px] md:leading-10">
              {activeList === defaultListId
                ? defaultListName
                : lists.find((list) => list.id === activeList)?.name ?? defaultListName}
            </Heading>
            <Text className="mt-1 text-[14px] leading-5 text-ink-600">
              {items.length} product{items.length === 1 ? '' : 's'}{checking ? ' · rechecking' : ''}
            </Text>
          </View>
          <View className="flex-row gap-2">
            <Tappable
              accessibilityLabel="Recheck saved products"
              disabled={checking}
              onPress={() => void revalidate(items)}
              className="min-h-10 flex-row items-center gap-2 rounded-full border border-line px-3.5"
            >
              <Icon name="refresh" size={15} color={color.ink800} />
              <Text className="text-[13px] font-semibold leading-[18px] text-ink-800">Recheck</Text>
            </Tappable>
            {compare.length >= 2 ? (
              <Button size="sm" variant="accent" icon="compare" onPress={() => router.push('/compare')}>
                {`Compare ${compare.length}`}
              </Button>
            ) : null}
            {desktop ? (
              <Button size="sm" variant="outline" onPress={clear}>Clear all</Button>
            ) : null}
          </View>
        </Appear>

        {/* The list switcher. It only appears once a second list exists, so a
            shopper who never wanted lists never sees the machinery for them. */}
        <View className="mt-5 flex-row flex-wrap items-center gap-2">
          {[{ id: defaultListId, name: defaultListName }, ...lists].map((list) => {
            const active = list.id === activeList
            const count = allItems.filter((item) => (item.listId ?? defaultListId) === list.id).length
            return (
              <Tappable
                key={list.id}
                accessibilityRole="button"
                accessibilityLabel={`${list.name}, ${count} product${count === 1 ? '' : 's'}`}
                accessibilityState={{ selected: active }}
                onPress={() => setActiveList(list.id)}
                className={`min-h-9 flex-row items-center gap-2 rounded-full border px-3.5 ${active
                  ? 'border-ink-950 bg-ink-950'
                  : 'border-line bg-white'}`}
              >
                <Text className={`text-[13px] font-semibold leading-[18px] ${active ? 'text-white' : 'text-ink-800'}`}>
                  {list.name}
                </Text>
                <Text className={`text-[12px] leading-4 ${active ? 'text-white/70' : 'text-ink-400'}`}>{count}</Text>
              </Tappable>
            )
          })}

          {creating ? (
            <View className="flex-row items-center gap-2">
              <TextInput
                value={newListName}
                onChangeText={setNewListName}
                autoFocus
                placeholder="List name"
                placeholderTextColor={color.ink400}
                accessibilityLabel="New list name"
                onSubmitEditing={() => {
                  const id = createList(newListName)
                  if (id) setActiveList(id)
                  setNewListName('')
                  setCreating(false)
                }}
                className="min-h-9 min-w-[140px] rounded-full border border-line-strong bg-white px-3.5 text-[13px] text-ink-950"
              />
              <Tappable
                accessibilityRole="button"
                accessibilityLabel="Cancel new list"
                onPress={() => { setCreating(false); setNewListName('') }}
                className="h-9 w-9 items-center justify-center rounded-full"
              >
                <Icon name="close" size={15} color={color.ink600} />
              </Tappable>
            </View>
          ) : (
            <Tappable
              accessibilityRole="button"
              accessibilityLabel="Create a new list"
              onPress={() => setCreating(true)}
              className="min-h-9 flex-row items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3.5"
            >
              <Icon name="plus" size={14} color={color.ink600} />
              <Text className="text-[13px] font-semibold leading-[18px] text-ink-600">New list</Text>
            </Tappable>
          )}

          {activeList !== defaultListId ? (
            <Tappable
              accessibilityRole="button"
              accessibilityLabel="Delete this list"
              onPress={() => { deleteList(activeList); setActiveList(defaultListId) }}
              className="min-h-9 flex-row items-center gap-1.5 rounded-full px-3"
            >
              <Icon name="trash" size={14} color={color.ink600} />
              <Text className="text-[13px] leading-[18px] text-ink-600">Delete list</Text>
            </Tappable>
          ) : null}
        </View>

        {goneCount > 0 || outOfStockCount > 0 ? (
          <View className="mt-4">
            <Notice
              tone="warning"
              icon="alert"
              title={goneCount > 0
                ? goneCount === 1 ? 'One saved product moved on' : `${goneCount} saved products moved on`
                : outOfStockCount === 1 ? 'One saved product is out of stock' : `${outOfStockCount} saved products are out of stock`}
            >
              {goneCount > 0
                ? `The shop ${goneCount === 1 ? 'it was' : 'they were'} saved from stopped selling ${goneCount === 1 ? 'it' : 'them'}. Arro keeps showing the last price it saw rather than deleting ${goneCount === 1 ? 'it' : 'them'}.`
                : `The shop still lists ${outOfStockCount === 1 ? 'it' : 'them'}, so the price stays here until stock comes back.`}
            </Notice>
          </View>
        ) : null}

        {!checking && uncheckedCount > 0 ? (
          <Text className="mt-3 text-[13px] leading-5 text-ink-600">
            {uncheckedCount === 1
              ? 'One shop did not answer just now, so that price is the last one Arro saw.'
              : `${uncheckedCount} shops did not answer just now, so those prices are the last ones Arro saw.`}
          </Text>
        ) : null}

        {items.length === 0 ? (
          // An empty list is a list waiting for something, not an empty account.
          // The switcher above stays, so getting back to a full list is one tap.
          <View className="mt-6 items-start rounded-2xl border border-dashed border-line-strong px-5 py-8">
            <Icon name="heart" size={20} color={color.ink400} />
            <Text className="mt-2.5 text-[15px] font-semibold leading-5 text-ink-950">This list is empty</Text>
            <Text className="mt-1 max-w-[420px] text-[13px] leading-5 text-ink-600">
              Save a product with the heart and choose this list, or move one across from another list.
            </Text>
            <View className="mt-4">
              <Button size="sm" variant="outline" icon="search" onPress={() => router.push('/')}>
                Find something
              </Button>
            </View>
          </View>
        ) : (
          // Every cell is exactly one column wide. `flex-1` here made cards grow
          // to fill whatever space their row had left, so a last row of five
          // rendered far wider than a full row of eight above it.
          <View className="-mx-2 mt-6 flex-row flex-wrap" role="list">
            {items.map((item, index) => {
              const check = checks[item.key]
              const gone = Boolean(check?.gone)
              const outOfStock = check?.availability === 'out_of_stock'
              const moved = check?.price && item.product.price &&
                check.price.currency === item.product.price.currency &&
                check.price.amountMinor !== item.product.price.amountMinor
              const product = check?.price ? { ...item.product, price: check.price } : item.product

              return (
                <View
                  key={item.key}
                  className="px-2 pb-8"
                  style={{ width: `${100 / gridColumnCount}%` }}
                >
                  <ProductCard
                    group={singleProductGroup(product)}
                    priority={index < gridColumnCount}
                    showCompare
                    {...(item.query ? { query: item.query } : {})}
                    footer={
                      <View className="mt-1.5 gap-1.5">
                        {gone ? (
                          <View className="self-start"><Badge tone="warning" icon="alert">No longer sold here</Badge></View>
                        ) : outOfStock ? (
                          <View className="self-start"><Badge tone="neutral">Out of stock</Badge></View>
                        ) : null}
                        {moved && item.product.price ? (
                          <View className="self-start">
                            <Badge
                              tone={check!.price!.amountMinor < item.product.price.amountMinor ? 'positive' : 'neutral'}
                              icon={check!.price!.amountMinor < item.product.price.amountMinor ? 'trendingDown' : 'trendingUp'}
                            >
                              {`was ${formatMoney(item.product.price)}`}
                            </Badge>
                          </View>
                        ) : null}
                        <Text numberOfLines={1} className="text-[11px] leading-4 text-ink-400">
                          {item.query ? `From “${item.query}” · ` : ''}{relativeTime(item.savedAt)}
                        </Text>
                        {lists.length > 0 ? (
                          <View className="flex-row flex-wrap gap-1.5">
                            {[{ id: defaultListId, name: defaultListName }, ...lists]
                              .filter((list) => list.id !== activeList)
                              .slice(0, 3)
                              .map((list) => (
                                <Tappable
                                  key={list.id}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Move ${item.product.title} to ${list.name}`}
                                  onPress={() => moveToList(item.key, list.id)}
                                  className="min-h-7 justify-center rounded-full bg-fill px-2.5"
                                >
                                  <Text numberOfLines={1} className="text-[11px] font-medium leading-4 text-ink-600">
                                    {`Move to ${list.name}`}
                                  </Text>
                                </Tappable>
                              ))}
                          </View>
                        ) : null}
                      </View>
                    }
                  />
                </View>
              )
            })}
          </View>
        )}

        {recent.length > 0 ? (
          <Appear className="arro-defer mt-14 border-t border-line pt-8">
            <View className="mb-3 flex-row items-center gap-2">
              <Icon name="history" size={16} color={color.ink400} />
              <Heading level={2} className="text-[15px] font-bold leading-5 text-ink-950">Recently viewed</Heading>
            </View>
            <Carousel
              label="Recently viewed"
              data={recent}
              keyExtractor={(product) => `${product.businessId}:${product.productId}`}
              itemWidth={railCardWidth}
              renderItem={(product) => <ProductCard group={singleProductGroup(product)} showCompare={false} />}
            />
          </Appear>
        ) : null}
      </Shell>

      <SiteFooter className="mt-10" />
    </ScrollView>
  )
}
