import type { ReactNode } from 'react'
import { useCallback, useState } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { AuthPanel } from '../components/AuthPanel'
import { Breadcrumb } from '../components/Breadcrumb'
import { Carousel } from '../components/Carousel'
import { ProductCard, railCardWidth } from '../components/ProductCard'
import { Icon, type IconName } from '../components/Icon'
import { Appear, Tappable } from '../components/motion'
import { Shell } from '../components/Page'
import { Heading } from '../components/semantic'
import { SiteFooter } from '../components/SiteFooter'
import { Button, Field } from '../components/ui'
import { logoutAccount } from '../api/client'
import { cartItemCount } from '../lib/cart'
import { useDocumentTitle } from '../lib/document-title'
import { formatMoney } from '../lib/money'
import { useLayoutMode } from '../lib/layout'
import { singleProductGroup } from '../lib/product-groups'
import { color } from '../lib/theme'
import { useAccountStore } from '../store/useAccountStore'
import { useCartStore } from '../store/useCartStore'
import { useOrdersStore, type OrderRecord } from '../store/useOrdersStore'
import { useSavedStore } from '../store/useSavedStore'
import { useShopperStore } from '../store/useShopperStore'

const Section = ({
  title,
  description,
  action,
  children
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
}) => (
  <View className="mt-9">
    <View className="mb-3 flex-row items-end justify-between gap-4">
      <View className="min-w-0 flex-1">
        <Heading level={2} className="text-[18px] font-bold leading-6 text-ink-950">{title}</Heading>
        {description ? (
          <Text className="mt-1 max-w-[560px] text-[13px] leading-5 text-ink-600">{description}</Text>
        ) : null}
      </View>
      {action}
    </View>
    {children}
  </View>
)

type AccountTab = 'overview' | 'orders' | 'details' | 'data'

const accountTabs: ReadonlyArray<{ id: AccountTab; label: string; icon: IconName }> = [
  { id: 'overview', label: 'Overview', icon: 'person' },
  { id: 'orders', label: 'Orders', icon: 'truck' },
  { id: 'details', label: 'Details', icon: 'store' },
  { id: 'data', label: 'Privacy', icon: 'shield' }
]

const orderStatus: Record<OrderRecord['outcome'], { label: string; tone: string; icon: IconName }> = {
  placed: { label: 'Order confirmed', tone: 'text-positive', icon: 'check' },
  continued: { label: 'Continued at the shop', tone: 'text-ink-600', icon: 'external' },
  canceled: { label: 'Canceled', tone: 'text-ink-400', icon: 'close' }
}

const orderDate = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * The page a shopper opens to answer three questions: who am I to Arro, what
 * have I got in flight, and what does Arro hold about me. Anything that cannot
 * answer one of those does not belong here.
 *
 * The contact block is the one piece of data Arro stores for its own use: the
 * details UCP puts on a checkout, kept so they are not retyped at every shop.
 * There is deliberately no address and no card — the shop's own checkout owns
 * those, and Arro storing them would make it a payments processor.
 */
export function AccountScreen() {
  const { compact, desktop } = useLayoutMode()
  const router = useRouter()

  const email = useShopperStore((state) => state.email)
  const firstName = useShopperStore((state) => state.firstName)
  const lastName = useShopperStore((state) => state.lastName)
  const phone = useShopperStore((state) => state.phone)
  const setDetails = useShopperStore((state) => state.set)
  const clearDetails = useShopperStore((state) => state.clear)

  const cartCount = useCartStore((state) => cartItemCount(state.lines))
  const clearCart = useCartStore((state) => state.clear)
  const savedCount = useSavedStore((state) => state.items.length)
  const recentCount = useSavedStore((state) => state.recentQueries.length)
  const recentlyViewed = useSavedStore((state) => state.recent)
  const clearSaved = useSavedStore((state) => state.clear)
  const clearQueries = useSavedStore((state) => state.clearQueries)

  const orders = useOrdersStore((state) => state.orders)
  const clearOrders = useOrdersStore((state) => state.clear)

  const account = useAccountStore((state) => state.account)
  const endSession = useAccountStore((state) => state.signOut)

  useDocumentTitle('Your account · Arro')

  /**
   * One long scroll made every part of the account equally important, which
   * meant the shopper skimmed past the part they came for. These are genuinely
   * different errands — check an order, fix a delivery detail, clear what the
   * browser is holding — so each gets its own view and its own URL fragment.
   */
  const [tab, setTab] = useState<AccountTab>('overview')

  const signOut = useCallback(async () => {
    endSession()
    await logoutAccount()
  }, [endSession])

  const contactFilled = Boolean(email.trim() || firstName.trim() || lastName.trim() || phone.trim())

  const activity = [
    { icon: 'heart' as IconName, label: 'Saved', count: savedCount, href: '/saved' as const },
    { icon: 'cart' as IconName, label: 'Cart', count: cartCount, href: '/cart' as const },
  ]

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <Shell className="max-w-[880px] flex-1 pb-16 pt-4 md:pt-8">
        <Breadcrumb className="mb-3" trail={[{ name: 'Home', href: '/' }, { name: 'Account' }]} />

        {/* Identity first. Signed out, the panel is the page's whole job. */}
        <Appear>
          {account ? (
            <View className="flex-row items-center gap-4">
              <View className="h-16 w-16 items-center justify-center rounded-full bg-arro-50">
                <Text className="text-[24px] font-bold leading-8 text-arro-700">
                  {(account.displayName || account.email).trim().charAt(0).toUpperCase()}
                </Text>
              </View>
              <View className="min-w-0 flex-1">
                <Heading
                  level={1}
                  className="text-[24px] font-bold leading-8 tracking-[-0.5px] text-ink-950 md:text-[30px] md:leading-9"
                >
                  {account.displayName || account.email.split('@')[0]}
                </Heading>
                <Text numberOfLines={1} className="mt-0.5 text-[14px] leading-5 text-ink-600">
                  {`${account.email} · with Arro since ${new Date(account.createdAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`}
                </Text>
              </View>
              {desktop ? (
                <Button size="sm" variant="outline" onPress={() => void signOut()}>Sign out</Button>
              ) : null}
            </View>
          ) : (
            <View>
              <Heading
                level={1}
                className="text-[26px] font-bold leading-8 tracking-[-0.6px] text-ink-950 md:text-[32px] md:leading-10"
              >
                Your account
              </Heading>
              <Text className="mt-1.5 max-w-[560px] text-[15px] leading-[22px] text-ink-600">
                Sign in to carry your cart and saved products between devices. Everything below works without one.
              </Text>
              <View className="mt-5"><AuthPanel /></View>
            </View>
          )}
        </Appear>

        {/* One tappable row per list, with the count as the reason to tap. */}
        <View className={`mt-7 gap-2.5 ${desktop ? 'flex-row' : ''}`}>
          {activity.map((entry) => (
            <Tappable
              key={entry.label}
              accessibilityRole="link"
              accessibilityLabel={`${entry.label}, ${entry.count} ${entry.count === 1 ? 'item' : 'items'}`}
              onPress={() => router.push(entry.href)}
              className="flex-1 flex-row items-center gap-3 rounded-2xl border border-line px-4 py-3.5"
            >
              <Icon name={entry.icon} size={18} color={color.ink800} />
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] font-semibold leading-5 text-ink-950">{entry.label}</Text>
                <Text className="text-[13px] leading-[18px] text-ink-600">
                  {entry.count === 0 ? 'Nothing yet' : `${entry.count} ${entry.count === 1 ? 'item' : 'items'}`}
                </Text>
              </View>
              <Icon name="chevronRight" size={16} color={color.ink400} />
            </Tappable>
          ))}
        </View>

        {/* Sub-navigation, not a second menu: Overview is everything at a glance,
            the rest are the errands people actually arrive with. */}
        <View className="mt-8 flex-row gap-1 border-b border-line">
          {accountTabs.map((entry) => {
            const active = tab === entry.id
            return (
              <Tappable
                key={entry.id}
                accessibilityRole="button"
                accessibilityLabel={entry.label}
                accessibilityState={{ selected: active }}
                onPress={() => setTab(entry.id)}
                className={`min-h-11 flex-row items-center gap-2 px-3 ${active ? 'border-b-2 border-ink-950' : ''}`}
              >
                {compact ? null : (
                  <Icon name={entry.icon} size={16} color={active ? color.ink950 : color.ink600} />
                )}
                <Text className={`text-[14px] leading-5 ${active ? 'font-semibold text-ink-950' : 'text-ink-600'}`}>
                  {entry.label}
                </Text>
              </Tappable>
            )
          })}
        </View>

        {tab === 'overview' || tab === 'orders' ? (
        <Section
          title="Orders"
          description="Checkouts you started through Arro. A shop's own confirmation email is always the real record."
          action={orders.length > 0 ? (
            <Button size="sm" variant="ghost" onPress={clearOrders}>Clear</Button>
          ) : undefined}
        >
          {orders.length === 0 ? (
            <View className="items-start rounded-2xl border border-dashed border-line-strong px-5 py-7">
              <Icon name="truck" size={20} color={color.ink400} />
              <Text className="mt-2.5 text-[15px] font-semibold leading-5 text-ink-950">No orders yet</Text>
              <Text className="mt-1 max-w-[420px] text-[13px] leading-5 text-ink-600">
                When you buy through Arro the shop, price and date land here.
              </Text>
              <View className="mt-4">
                <Button size="sm" variant="outline" icon="search" onPress={() => router.push('/')}>
                  Start comparing
                </Button>
              </View>
            </View>
          ) : (
            <View className="rounded-2xl border border-line">
              {orders.map((order, index) => {
                const status = orderStatus[order.outcome]
                return (
                  <View
                    key={order.key}
                    className={`flex-row items-center gap-4 px-4 py-3.5 ${index > 0 ? 'border-t border-line' : ''}`}
                  >
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={1} className="text-[15px] font-semibold leading-5 text-ink-950">
                        {order.title}
                      </Text>
                      <Text numberOfLines={1} className="mt-0.5 text-[13px] leading-[18px] text-ink-600">
                        {`${order.shop} · ${orderDate(order.recordedAt)}`}
                        {order.reference ? ` · ${order.reference}` : ''}
                      </Text>
                      <View className="mt-1.5 flex-row items-center gap-1.5">
                        <Icon name={status.icon} size={13} color={order.outcome === 'placed' ? color.positive : color.ink400} />
                        <Text className={`text-[12px] font-medium leading-4 ${status.tone}`}>{status.label}</Text>
                      </View>
                    </View>
                    {order.price ? (
                      <Text className="text-[15px] font-bold leading-5 text-ink-950">{formatMoney(order.price)}</Text>
                    ) : null}
                  </View>
                )
              })}
            </View>
          )}
        </Section>
        ) : null}

        {tab === 'overview' && recentlyViewed.length > 0 ? (
          <Section title="Recently viewed">
            <Carousel
              label="Recently viewed"
              data={recentlyViewed}
              keyExtractor={(product) => `${product.businessId}:${product.productId}`}
              itemWidth={desktop ? 220 : railCardWidth}
              gap={16}
              renderItem={(product) => (
                <ProductCard group={singleProductGroup(product)} showCompare={false} />
              )}
            />
          </Section>
        ) : null}

        {tab === 'overview' || tab === 'details' ? (
        <Section
          title="Checkout details"
          description="Sent to the shop with an order so it can reach you about it. Saved as you type, on this device only."
          action={contactFilled ? (
            <Button size="sm" variant="ghost" onPress={clearDetails}>Clear</Button>
          ) : undefined}
        >
          <View className="gap-3 rounded-2xl border border-line p-4 md:p-5">
            <View className={desktop ? 'flex-row gap-3' : 'gap-3'}>
              <View className="min-w-0 flex-1 gap-1.5">
                <Text className="text-[13px] font-medium leading-[18px] text-ink-600">First name</Text>
                <Field
                  value={firstName}
                  onChangeText={(v) => setDetails({ firstName: v })}
                  placeholder="First name"
                  accessibilityLabel="First name"
                  autoComplete="given-name"
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>
              <View className="min-w-0 flex-1 gap-1.5">
                <Text className="text-[13px] font-medium leading-[18px] text-ink-600">Last name</Text>
                <Field
                  value={lastName}
                  onChangeText={(v) => setDetails({ lastName: v })}
                  placeholder="Last name"
                  accessibilityLabel="Last name"
                  autoComplete="family-name"
                  autoCapitalize="words"
                  returnKeyType="next"
                />
              </View>
            </View>
            <View className={desktop ? 'flex-row gap-3' : 'gap-3'}>
              <View className="min-w-0 flex-1 gap-1.5">
                <Text className="text-[13px] font-medium leading-[18px] text-ink-600">Email</Text>
                <Field
                  value={email}
                  onChangeText={(v) => setDetails({ email: v })}
                  placeholder="you@example.com"
                  accessibilityLabel="Email"
                  keyboardType="email-address"
                  autoComplete="email"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                />
              </View>
              <View className="min-w-0 flex-1 gap-1.5">
                <Text className="text-[13px] font-medium leading-[18px] text-ink-600">Phone</Text>
                <Field
                  value={phone}
                  onChangeText={(v) => setDetails({ phone: v })}
                  placeholder="Optional"
                  accessibilityLabel="Phone"
                  keyboardType="phone-pad"
                  autoComplete="tel"
                  returnKeyType="done"
                />
              </View>
            </View>
          </View>
        </Section>

        ) : null}

        {tab === 'overview' || tab === 'data' ? (
        <Section
          title="Data on this device"
          description="Your cart, lists and searches stay in this browser. Clearing them here removes them straight away."
        >
          <View className="rounded-2xl border border-line">
            {([
              ['Cart', cartCount, clearCart],
              ['Saved products', savedCount, clearSaved],
              ['Recent searches', recentCount, clearQueries],
              ['Order history', orders.length, clearOrders]
            ] as const).map(([label, count, clear], index) => (
              <View
                key={label}
                className={`flex-row items-center justify-between gap-3 px-4 py-3 ${index > 0 ? 'border-t border-line' : ''}`}
              >
                <Text className="min-w-0 flex-1 text-[14px] leading-5 text-ink-800">{label}</Text>
                <Text className="text-[13px] leading-[18px] text-ink-400">{count}</Text>
                <Button size="sm" variant="ghost" disabled={count === 0} onPress={clear}>Clear</Button>
              </View>
            ))}
          </View>

          <View className="mt-3 flex-row items-start gap-2.5 rounded-2xl bg-fill-soft p-4">
            <Icon name="shield" size={16} color={color.ink600} />
            <Text className="min-w-0 flex-1 text-[13px] leading-5 text-ink-600">
              Arro never stores card details. Each order is placed by the shop that sells the item, and that shop stays
              the seller of record.
            </Text>
          </View>
        </Section>
        ) : null}

        {account && !desktop ? (
          <View className="mt-8">
            <Button fullWidth variant="outline" onPress={() => void signOut()}>Sign out</Button>
          </View>
        ) : null}
      </Shell>

      <SiteFooter className="mt-10" />
    </ScrollView>
  )
}
