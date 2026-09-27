import { useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter, usePathname } from 'expo-router'
import { Icon, type IconName } from './Icon'
import { ProductImage } from './ProductImage'
import { cartItemCount } from '../lib/cart'
import { formatMoney } from '../lib/money'
import { productHref } from '../lib/product-url'
import { productMoney } from '../lib/product-display'
import { color } from '../lib/theme'
import { useCartStore } from '../store/useCartStore'
import { defaultListId, defaultListName, useSavedStore } from '../store/useSavedStore'
import { useAlertsStore } from '../store/useAlertsStore'

type Tab = 'lists' | 'alerts' | 'cart'

const tabs: ReadonlyArray<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'lists', label: 'My lists', icon: 'heart' },
  { id: 'alerts', label: 'Price alerts', icon: 'bell' },
  { id: 'cart', label: 'Cart', icon: 'cart' }
]

/**
 * Saved and cart, parked in the corner instead of the header.
 *
 * A comparison engine's header has one job — search — and every utility icon
 * competing beside it makes that job harder to see. These two are things the
 * shopper accumulates rather than navigates to, so they sit out of the way and
 * open on demand, which is also where a shopper's eye already goes for a list
 * that follows them around the site.
 */
export function QuickPanel() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('lists')
  // Which list is open. Undefined is the index of lists.
  const [openList, setOpenList] = useState<string>()
  const closeButtonRef = useRef<View>(null)
  const triggerRef = useRef<View>(null)
  const hadOpened = useRef(false)

  const saved = useSavedStore((state) => state.items)
  const lines = useCartStore((state) => state.lines)
  const lists = useSavedStore((state) => state.lists)
  const alerts = useAlertsStore((state) => state.alerts)
  const cartCount = cartItemCount(lines)

  useEffect(() => {
    const timer = setTimeout(() => {
      const target = open ? closeButtonRef.current : hadOpened.current ? triggerRef.current : null
      ;(target as unknown as { focus?: () => void } | null)?.focus?.()
      hadOpened.current = open
    }, 0)
    return () => clearTimeout(timer)
  }, [open])

  // The panel is the shopper's own state; on the pages that *are* that state it
  // would be a duplicate of what they are already looking at.
  if (pathname === '/saved' || pathname === '/cart' || pathname === '/checkout' || pathname === '/compare') {
    return null
  }

  const total = saved.length + cartCount

  const allLists = [{ id: defaultListId, name: defaultListName }, ...lists]
  const itemsIn = (listId: string) => saved.filter((item) => (item.listId ?? defaultListId) === listId)

  const productRow = (product: { title: string; imageUrl?: string; seller?: { name?: string }; businessName?: string }, key: string, meta: string) => ({
    key,
    title: product.title,
    imageUrl: product.imageUrl,
    meta,
    price: productMoney(product as never),
    href: productHref(product as never)
  })

  const rows = tab === 'cart'
    ? lines.slice(0, 8).map((line) => productRow(
      line.product,
      line.key,
      `${line.quantity} × ${line.product.seller?.name || line.product.businessName}`
    ))
    : tab === 'alerts'
      ? alerts.slice(0, 8).map((alert) => productRow(
        alert.product,
        alert.key,
        alert.watchedPrice ? `Watching from ${formatMoney(alert.watchedPrice)}` : 'Watching'
      ))
      : openList
        ? itemsIn(openList).slice(0, 8).map((item) => productRow(
          item.product,
          item.key,
          item.product.seller?.name || item.product.businessName || ''
        ))
        : []

  return (
    <View className="absolute bottom-0 right-0 z-40 w-[340px] max-w-[92vw]" style={{ zIndex: 40 }}>
      {open ? (
        <View
          nativeID="quick-panel-dialog"
          role="dialog"
          accessibilityLabel="My products"
          aria-label="My products"
          aria-modal={false}
          className="mb-0 overflow-hidden rounded-t-2xl border border-b-0 border-line bg-white shadow-lg"
        >
          {/* A quiet chrome row that never changes, then a heading that names
              what you are looking at. Putting the panel's identity and the
              section's identity on one line made the title flicker between
              "My products" and a list name every time the shopper drilled in. */}
          <View className="flex-row items-center border-b border-line px-2 py-2">
            <View className="w-8">
              {tab === 'lists' && openList ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to my lists"
                  onPress={() => setOpenList(undefined)}
                  hitSlop={8}
                  className="h-8 w-8 items-center justify-center rounded-full"
                >
                  <Icon name="chevronLeft" size={18} color={color.ink800} />
                </Pressable>
              ) : null}
            </View>
            <Text className="min-w-0 flex-1 text-center text-[14px] font-medium leading-5 text-ink-600">
              My products
            </Text>
            <Pressable
              ref={closeButtonRef}
              accessibilityRole="button"
              accessibilityLabel="Close my products"
              onPress={() => setOpen(false)}
              hitSlop={8}
              className="h-8 w-8 items-center justify-center rounded-full"
            >
              <Icon name="close" size={18} color={color.ink950} />
            </Pressable>
          </View>

          <View className="flex-row items-end justify-between gap-3 px-4 pb-1 pt-3.5">
            <Text numberOfLines={1} className="min-w-0 flex-1 text-[19px] font-bold leading-6 tracking-[-0.3px] text-ink-950">
              {tab === 'cart'
                ? 'Cart'
                : tab === 'alerts'
                  ? 'Price alerts'
                  : openList
                    ? allLists.find((list) => list.id === openList)?.name ?? defaultListName
                    : 'My lists'}
            </Text>
            {tab === 'lists' && !openList && saved.length > 0 ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel="Open all lists"
                onPress={() => { setOpen(false); router.push('/saved') }}
                className="min-h-8 flex-row items-center gap-1"
              >
                <Text className="text-[13px] font-semibold leading-5 text-ink-950 underline">All lists</Text>
                <Icon name="arrowRight" size={14} color={color.ink950} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            role="region"
            accessibilityLabel={`${tab === 'cart' ? 'Cart' : tab === 'alerts' ? 'Price alerts' : 'My lists'} content`}
            className="max-h-[340px]"
            showsVerticalScrollIndicator={false}
          >
            {tab === 'lists' && !openList ? (
              // The index of lists. Drilling in here rather than jumping to the
              // page keeps the shopper on whatever they were reading.
              allLists.map((list) => {
                const contents = itemsIn(list.id)
                return (
                  <Pressable
                    key={list.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${list.name}, ${contents.length} saved product${contents.length === 1 ? '' : 's'}`}
                    onPress={() => setOpenList(list.id)}
                    className="flex-row items-center gap-3.5 px-4 py-3"
                  >
                    <View className="h-14 w-14 items-center justify-center overflow-hidden rounded-xl bg-fill-soft">
                      {contents[0]?.product.imageUrl ? (
                        <ProductImage uri={contents[0].product.imageUrl!} alt="" sizes="56px" className="h-full w-full" />
                      ) : (
                        <Icon name="heart" size={18} color={color.ink400} />
                      )}
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={1} className="text-[15px] font-semibold leading-5 text-ink-950">{list.name}</Text>
                      <Text className="mt-0.5 text-[13px] leading-[18px] text-ink-600">
                        {`${contents.length} saved product${contents.length === 1 ? '' : 's'}`}
                      </Text>
                    </View>
                    <Icon name="arrowRight" size={17} color={color.ink950} />
                  </Pressable>
                )
              })
            ) : rows.length === 0 ? (
              <View className="items-start px-4 py-7">
                <Icon name={tab === 'cart' ? 'cart' : tab === 'alerts' ? 'bell' : 'heart'} size={20} color={color.ink400} />
                <Text className="mt-2 text-[14px] font-semibold leading-5 text-ink-950">
                  {tab === 'cart' ? 'Your cart is empty' : tab === 'alerts' ? 'No price alerts' : 'This list is empty'}
                </Text>
                <Text className="mt-1 text-[13px] leading-5 text-ink-600">
                  {tab === 'cart'
                    ? 'Add a product from any offer to start a cart.'
                    : tab === 'alerts'
                      ? 'Watch a price and Arro tells you what changed since you last looked.'
                      : 'Save a product with the heart and choose this list.'}
                </Text>
              </View>
            ) : (
              rows.map((row) => (
                <Pressable
                  key={row.key}
                  accessibilityRole="link"
                  accessibilityLabel={row.title}
                  onPress={() => { setOpen(false); router.push(row.href) }}
                  className="flex-row items-center gap-3 border-b border-line px-3 py-2.5"
                >
                  <View className="h-11 w-11 items-center justify-center overflow-hidden rounded-lg bg-fill-soft">
                    {row.imageUrl ? (
                      <ProductImage uri={row.imageUrl} alt={row.title} sizes="44px" className="h-full w-full" />
                    ) : (
                      <Icon name="store" size={16} color={color.ink400} />
                    )}
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className="text-[13px] font-medium leading-[18px] text-ink-950">{row.title}</Text>
                    <Text numberOfLines={1} className="text-[12px] leading-4 text-ink-400">{row.meta}</Text>
                  </View>
                  <Text className="shrink-0 text-[13px] font-bold leading-[18px] text-ink-950">{row.price}</Text>
                </Pressable>
              ))
            )}
          </ScrollView>

          {rows.length > 0 ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={tab === 'cart' ? 'Open cart' : 'Open saved products'}
              onPress={() => { setOpen(false); router.push(tab === 'cart' ? '/cart' : '/saved') }}
              className="flex-row items-center justify-between gap-3 border-b border-line px-4 py-3"
            >
              <Text className="text-[14px] font-semibold leading-5 text-arro-700">
                {tab === 'cart' ? 'Open cart' : tab === 'alerts' ? 'Open saved' : 'Show list'}
              </Text>
              <Icon name="arrowRight" size={15} color={color.arro700} />
            </Pressable>
          ) : null}

          <View className="flex-row">
            {tabs.map((entry) => {
              const active = tab === entry.id
              const count = entry.id === 'lists' ? saved.length : entry.id === 'alerts' ? alerts.length : cartCount
              return (
                <Pressable
                  key={entry.id}
                  accessibilityRole="button"
                  accessibilityLabel={count > 0 ? `${entry.label}, ${count}` : entry.label}
                  accessibilityState={{ selected: active }}
                  aria-pressed={active}
                  onPress={() => { setTab(entry.id); setOpenList(undefined) }}
                  className={`min-h-[54px] flex-1 items-center justify-center gap-1 border-t-2 ${active ? 'border-ink-950 bg-fill-soft' : 'border-transparent'}`}
                >
                  <View>
                    <Icon name={entry.icon} size={18} color={active ? color.ink950 : color.ink600} />
                    {count > 0 ? (
                      <View className="absolute -right-2.5 -top-1 min-w-[16px] items-center justify-center rounded-full bg-arro-600 px-1">
                        <Text className="text-[9px] font-bold leading-4 text-white">{count > 99 ? '99+' : count}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text className={`text-[11px] font-semibold leading-[14px] ${active ? 'text-ink-950' : 'text-ink-600'}`}>
                    {entry.label}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>
      ) : null}

      {open ? null : (
        <Pressable
          ref={triggerRef}
          accessibilityRole="button"
          accessibilityLabel={total > 0 ? `My products, ${total} items` : 'My products'}
          accessibilityState={{ expanded: false }}
          aria-expanded={false}
          aria-controls="quick-panel-dialog"
          onPress={() => setOpen(true)}
          // Collapsed, this is a tab on the edge of the page, not a floating
          // pill that hovers over the last row of products. A fixed 44px keeps
          // it the same size whether the shopper has one saved product or forty.
          className="ml-auto mr-4 h-11 flex-row items-center justify-between gap-3 rounded-t-xl bg-ink-950 px-4 shadow-lg"
        >
          <Text className="text-[13px] font-semibold leading-5 text-white">My products</Text>
          <View className="flex-row items-center gap-2">
            {total > 0 ? (
              <View className="min-w-[20px] items-center justify-center rounded-full bg-arro-600 px-1.5">
                <Text className="text-[11px] font-bold leading-[18px] text-white">{total > 99 ? '99+' : total}</Text>
              </View>
            ) : null}
            <Icon name="chevronUp" size={15} color={color.white} />
          </View>
        </Pressable>
      )}
    </View>
  )
}
