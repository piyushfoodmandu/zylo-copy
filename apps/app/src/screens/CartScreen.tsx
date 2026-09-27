import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native'
import { getProductDetail, prepareCartPurchase } from '../api/client'
import { Breadcrumb } from '../components/Breadcrumb'
import { HandoffSheet } from '../components/HandoffSheet'
import { Icon } from '../components/Icon'
import { Appear, Swap, Tappable } from '../components/motion'
import { ProductImage } from '../components/ProductImage'
import { Shell } from '../components/Page'
import { ProductLink } from '../components/ProductLink'
import { SiteFooter } from '../components/SiteFooter'
import { Heading } from '../components/semantic'
import { LineItemSkeleton } from '../components/skeletons'
import { Badge, Button, EstimateNote, Notice, QuantityStepper } from '../components/ui'
import {
  cartEstimate,
  cartItemCount,
  checkFromDetail,
  groupCartByMerchant,
  lineBlocked,
  priceChange,
  type CartLine,
  type CartLineCheck,
  type CartMerchantGroup
} from '../lib/cart'
import { popularSearches } from '../lib/categories'
import { useDocumentTitle } from '../lib/document-title'
import { useLayoutMode } from '../lib/layout'
import { formatMoney } from '../lib/money'
import { availabilityLabel, freshnessLabel } from '../lib/product-display'
import { productHref, searchHref } from '../lib/product-url'
import { isPreparedCheckout } from '../lib/purchase-capability'
import { shopperErrorText } from '../lib/shopper-copy'
import { color } from '../lib/theme'
import { useCartStore } from '../store/useCartStore'
import { useCheckoutStore } from '../store/useCheckoutStore'
import { useSavedStore } from '../store/useSavedStore'
import { buyerFromDetails, useShopperStore } from '../store/useShopperStore'
import type { PurchaseResponse } from '../types/purchase'

const detailKeyOf = (line: CartLine) =>
  `${line.product.businessId}|${line.product.productId}|${line.product.variantId ?? ''}`

function LineRow({
  line,
  check,
  onQuantity,
  onRemove,
  onSave
}: {
  line: CartLine
  check: CartLineCheck | undefined
  onQuantity: (quantity: number) => void
  onRemove: () => void
  onSave: () => void
}) {
  const product = line.product
  const change = priceChange(line, check)
  const blocked = lineBlocked(check)
  const current = check?.price ?? product.price
  const href = productHref({
    businessId: product.businessId,
    productId: product.productId,
    title: product.title,
    ...(product.variantId ? { variantId: product.variantId } : {})
  })

  return (
    <View className="flex-row gap-3.5 border-t border-line py-4">
      <ProductLink href={href} label={product.title} className="arro-product h-[84px] w-[84px] items-center justify-center overflow-hidden rounded-2xl bg-fill-soft p-2">
        {product.imageUrl ? (
          <ProductImage uri={product.imageUrl} alt={product.title} width={84} className="h-full w-full" />
        ) : (
          <Icon name="store" size={22} color={color.ink400} />
        )}
      </ProductLink>

      <View className="min-w-0 flex-1">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <ProductLink href={href} label={product.title}>
              <Text numberOfLines={2} className="text-[15px] font-medium leading-5 text-ink-950">
                {product.title}
              </Text>
            </ProductLink>
            <Text className="mt-1 text-[12px] leading-4 text-ink-400">
              {blocked
                ? 'This shop can no longer sell this item'
                : `${availabilityLabel(check?.availability ?? product.availability)}${check ? ` · ${freshnessLabel(check.checkedAt).toLowerCase()}` : ''}`}
            </Text>
          </View>
          <View className="items-end">
            <Swap value={current ? `${current.currency}${current.amountMinor}` : 'none'}>
              <Text className="text-[16px] font-bold leading-6 text-ink-950">
                {current ? formatMoney(current) : '--'}
              </Text>
            </Swap>
            {change ? (
              <View className="mt-1">
                <Badge
                  tone={change.direction === 'down' ? 'positive' : 'warning'}
                  icon={change.direction === 'down' ? 'trendingDown' : 'trendingUp'}
                >
                  {`was ${formatMoney(change.before)}`}
                </Badge>
              </View>
            ) : null}
          </View>
        </View>

        <View className="mt-3 flex-row flex-wrap items-center gap-2">
          <QuantityStepper
            quantity={line.quantity}
            onChange={onQuantity}
            onRemove={onRemove}
            label={product.title}
            disabled={blocked}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Save ${product.title} for later`}
            onPress={onSave}
            className="min-h-10 flex-row items-center gap-1.5 rounded-full px-2"
          >
            <Icon name="heart" size={15} color={color.ink600} />
            <Text className="text-[13px] font-medium leading-[18px] text-ink-600">Save for later</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${product.title} from cart`}
            onPress={onRemove}
            className="min-h-10 justify-center px-2"
          >
            <Text className="text-[13px] leading-[18px] text-ink-400">Remove</Text>
          </Pressable>
        </View>

        {line.query ? (
          <Text className="mt-2 text-[12px] leading-4 text-ink-400">Added from “{line.query}”</Text>
        ) : null}
      </View>
    </View>
  )
}

export function CartScreen() {
  const router = useRouter()
  const { desktop } = useLayoutMode()
  const lines = useCartStore((state) => state.lines)
  const setQuantity = useCartStore((state) => state.setQuantity)
  const remove = useCartStore((state) => state.remove)
  const toggleSaved = useSavedStore((state) => state.toggle)
  const setPrepared = useCheckoutStore((state) => state.setPrepared)
  const activePurchaseId = useCheckoutStore((state) => state.activePurchaseId)
  const shopper = useShopperStore((state) => state)
  const [checks, setChecks] = useState<Record<string, CartLineCheck>>({})
  const [checking, setChecking] = useState(false)
  const [checkedAt, setCheckedAt] = useState<string>()
  const [error, setError] = useState<string>()
  const [busyMerchant, setBusyMerchant] = useState<string>()
  const [handoff, setHandoff] = useState<{ purchase: PurchaseResponse; shop: string }>()
  const revalidated = useRef(false)

  useDocumentTitle(lines.length ? `Cart (${cartItemCount(lines)}) · Arro` : 'Cart · Arro')

  const resumeCheckout = activePurchaseId ? (
    <Tappable
      accessibilityLabel="Resume your active checkout"
      onPress={() => router.push({ pathname: '/checkout', params: { id: activePurchaseId } })}
      className="min-h-14 w-full flex-row items-center gap-3 rounded-2xl border border-arro-200 bg-arro-50 px-4 py-3"
    >
      <View className="h-9 w-9 items-center justify-center rounded-full bg-white">
        <Icon name="cart" size={17} color={color.arro700} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[14px] font-semibold leading-5 text-ink-950">Continue your checkout</Text>
        <Text className="text-[12px] leading-4 text-ink-600">Your shop checkout is saved on this device.</Text>
      </View>
      <Icon name="chevronRight" size={16} color={color.arro700} />
    </Tappable>
  ) : null

  const revalidate = useCallback(async (currentLines: CartLine[]) => {
    if (currentLines.length === 0) return
    setChecking(true)
    setError(undefined)
    try {
      // One detail call per distinct product, not per line: two quantities of
      // the same offer are one question for the source.
      const unique = new Map<string, CartLine>()
      for (const line of currentLines) unique.set(detailKeyOf(line), line)

      const results = await Promise.all([...unique.entries()].map(async ([key, line]) => {
        try {
          const response = await getProductDetail({
            businessId: line.product.businessId,
            productId: line.product.productId,
            ...(line.product.variantId ? { variantId: line.product.variantId } : {})
          })
          return [key, response.product] as const
        } catch {
          // A source that cannot answer right now is not evidence the offer is
          // gone, so the line keeps its last known state instead of going red.
          return [key, undefined] as const
        }
      }))

      const answered = new Map(results)
      const successfulProductCount = results.filter(([, detail]) => Boolean(detail)).length
      const next: Record<string, CartLineCheck> = {}
      const successfulChecks: string[] = []
      for (const line of currentLines) {
        const detail = answered.get(detailKeyOf(line))
        if (!detail) continue
        const sourceCheckedAt = detail.sourceLabel.fetchedAt
        next[line.key] = checkFromDetail(line, detail, sourceCheckedAt)
        successfulChecks.push(sourceCheckedAt)
      }
      if (successfulChecks.length === 0) {
        setChecks({})
        setCheckedAt(undefined)
        setError('The shops did not answer this recheck. The cart still shows the last prices Arro saw.')
        return
      }
      setChecks(next)
      // Show the oldest successful source timestamp. Saying the whole cart was
      // checked as recently as its fastest shop would overstate the evidence.
      setCheckedAt(successfulChecks.reduce((oldest, value) =>
        new Date(value).getTime() < new Date(oldest).getTime() ? value : oldest))
      if (successfulProductCount < unique.size) {
        setError('Some shops did not answer. Rechecked prices are marked; the other lines keep their last known amount.')
      }
    } catch (caught) {
      setError(shopperErrorText(caught, 'We could not recheck these prices. The amounts below are the last ones Arro saw.'))
    } finally {
      setChecking(false)
    }
  }, [])

  // The scope rule is explicit: a saved or carried-over decision is revalidated
  // when it is reopened, because price, stock and checkout readiness all move.
  useEffect(() => {
    if (revalidated.current || lines.length === 0) return
    revalidated.current = true
    void revalidate(lines)
  }, [lines, revalidate])

  const groups = useMemo(
    () => groupCartByMerchant(lines, (line) => checks[line.key]?.price ?? line.product.price),
    [checks, lines]
  )
  const total = useMemo(() => cartEstimate(groups), [groups])
  const itemCount = cartItemCount(lines)
  const blockedCount = lines.filter((line) => lineBlocked(checks[line.key])).length
  const changedCount = lines.filter((line) => priceChange(line, checks[line.key])).length

  const checkout = useCallback(async (group: CartMerchantGroup) => {
    const sellable = group.lines.filter((line) => !lineBlocked(checks[line.key]))
    if (sellable.length === 0) return
    try {
      setBusyMerchant(group.key)
      setError(undefined)
      const purchase = await prepareCartPurchase(sellable.map((line) => ({
        offer: {
          productId: line.product.productId,
          ...(line.product.variantId ? { variantId: line.product.variantId } : {}),
          title: line.product.title,
          businessName: line.product.businessName,
          ...(line.product.seller ? { seller: line.product.seller } : {}),
          ...(line.product.productUrl ? { productUrl: line.product.productUrl } : {}),
          ...(line.product.handoff ? { handoff: line.product.handoff } : {})
        },
        quantity: line.quantity,
        ...(line.product.imageUrl ? { imageUrl: line.product.imageUrl } : {})
      })), buyerFromDetails(shopper))
      if (!isPreparedCheckout(purchase)) {
        setHandoff({ purchase, shop: group.name })
        return
      }
      setPrepared(purchase)
      router.push({ pathname: '/checkout', params: { id: purchase.purchaseId } })
    } catch (caught) {
      setError(shopperErrorText(caught, 'Checkout could not start with this shop. Try again.'))
    } finally {
      setBusyMerchant(undefined)
    }
  }, [checks, router, setPrepared, shopper])

  if (lines.length === 0) {
    return (
      <ScrollView showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1 }}>
        <Shell className="max-w-[720px] flex-1 py-12">
          <Appear className="items-center">
            <View className="h-16 w-16 items-center justify-center rounded-full bg-fill">
              <Icon name="cart" size={26} color={color.ink600} />
            </View>
            <Heading level={1} className="mt-5 text-[24px] font-bold leading-8 text-ink-950">Your cart is empty</Heading>
            <Text className="mt-2 max-w-[460px] text-center text-[15px] leading-6 text-ink-600">
              Add items from any shop Arro can reach. The cart keeps them together; each shop still confirms and ships
              its own order.
            </Text>
            <View className="mt-6"><Button variant="accent" onPress={() => router.push('/')}>Start searching</Button></View>

            {resumeCheckout ? <View className="mt-8 w-full">{resumeCheckout}</View> : null}

            <View className="mt-10 w-full border-t border-line pt-8">
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
          </Appear>
        </Shell>

        <SiteFooter className="mt-10" />
      </ScrollView>
    )
  }

  /**
   * One quiet row per shop, not nine identical primary buttons.
   *
   * A cart spanning nine merchants produced nine full-width accent CTAs stacked
   * down the page, which is a wall of identical decisions and tells the shopper
   * nothing about which to press first. Grouping by merchant with one calm,
   * tappable row each — shop, subtotal, chevron — keeps every checkout one tap
   * away while letting the total and the estimate note carry the emphasis.
   */
  const summary = (
    <View className="gap-4 rounded-3xl border border-line p-5">
      <View>
        <Text className="text-[15px] font-bold leading-5 text-ink-950">Checkout by shop</Text>
        <Text className="mt-1 text-[12px] leading-4 text-ink-400">
          {`${groups.length} shop${groups.length === 1 ? '' : 's'}, each with its own order`}
        </Text>
      </View>

      <View>
        {groups.map((group, index) => {
          const blocked = group.lines.every((line) => lineBlocked(checks[line.key]))
          return (
            <Tappable
              key={group.key}
              accessibilityLabel={`Checkout with ${group.name}`}
              disabled={blocked || Boolean(busyMerchant)}
              onPress={() => void checkout(group)}
              className={`min-h-14 flex-row items-center gap-3 border-line py-3 ${index > 0 ? 'border-t' : ''} ${blocked ? 'opacity-40' : ''}`}
            >
              <View className="h-8 w-8 items-center justify-center rounded-full bg-fill">
                <Icon name="store" size={15} color={color.ink800} />
              </View>
              <View className="min-w-0 flex-1">
                <Text numberOfLines={1} className="text-[14px] font-medium leading-5 text-ink-950">
                  {group.name}
                </Text>
                <Text className="text-[12px] leading-4 text-ink-400">
                  {`${group.itemCount} item${group.itemCount === 1 ? '' : 's'}`}
                </Text>
              </View>
              <Text className="text-[14px] font-semibold leading-5 text-ink-950">
                {group.estimate ? formatMoney(group.estimate) : '--'}
              </Text>
              {busyMerchant === group.key ? (
                <ActivityIndicator size="small" color={color.arro600} />
              ) : (
                <Icon name="chevronRight" size={16} color={color.ink400} />
              )}
            </Tappable>
          )
        })}
      </View>

      <View className="gap-2 border-t border-line pt-4">
        {total.estimate ? (
          <View className="flex-row items-baseline justify-between gap-3">
            <Text className="text-[14px] font-medium leading-5 text-ink-600">Estimated total</Text>
            <Swap value={total.estimate.amountMinor}>
              <Text className="text-[24px] font-bold leading-8 text-ink-950">{formatMoney(total.estimate)}</Text>
            </Swap>
          </View>
        ) : null}
        <EstimateNote>
          {total.estimate
            ? 'Estimate. Each shop confirms its own total at checkout.'
            : 'Different currencies, so Arro does not add these into one number.'}
        </EstimateNote>
      </View>
    </View>
  )

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ flexGrow: 1 }}>
      <Shell className="flex-1 pb-16 pt-4 md:pt-8">
        <Breadcrumb className="mb-3" trail={[{ name: 'Home', href: '/' }, { name: 'Cart' }]} />

        <Appear className="flex-row items-end justify-between gap-4">
          <View className="min-w-0 flex-1">
            <Heading level={1} className="text-[24px] font-bold leading-8 tracking-[-0.5px] text-ink-950 md:text-[32px] md:leading-10">
              Your cart
            </Heading>
            <Text className="mt-1 text-[14px] leading-5 text-ink-600">
              {itemCount} item{itemCount === 1 ? '' : 's'} across {groups.length} shop{groups.length === 1 ? '' : 's'}
              {checkedAt ? ` · prices ${freshnessLabel(checkedAt).toLowerCase()}` : ''}
            </Text>
          </View>
          <Tappable
            accessibilityLabel="Recheck prices and availability"
            disabled={checking}
            onPress={() => void revalidate(lines)}
            className="min-h-10 flex-row items-center gap-2 rounded-full border border-line px-3.5"
          >
            <Icon name="refresh" size={15} color={color.ink800} />
            <Text className="text-[13px] font-semibold leading-[18px] text-ink-800">
              {checking ? 'Checking' : 'Recheck'}
            </Text>
          </Tappable>
        </Appear>

        <View className="mt-4 gap-2.5">
          {resumeCheckout}
          {error ? <Notice tone="warning" icon="alert">{error}</Notice> : null}
          {blockedCount > 0 ? (
            <Notice tone="warning" icon="alert" title="Some items are no longer available">
              {`${blockedCount} item${blockedCount === 1 ? '' : 's'} cannot be bought from that shop right now. Remove them, or open the product to see other shops.`}
            </Notice>
          ) : null}
          {changedCount > 0 ? (
            <Notice tone="accent" icon="tag" title="Prices changed since you added these">
              {`${changedCount} price${changedCount === 1 ? '' : 's'} moved at the shop. The amounts shown are the ones Arro just rechecked.`}
            </Notice>
          ) : null}
        </View>

        <View className={desktop ? 'mt-6 flex-row items-start gap-8' : 'mt-6 gap-6'}>
          <View className="min-w-0 flex-1 gap-5">
            {groups.map((group, index) => (
              <Appear key={group.key} delay={index * 40} className="rounded-3xl border border-line p-4 md:p-5">
                <View className="flex-row items-center justify-between gap-3 pb-1">
                  <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
                    <View className="h-9 w-9 items-center justify-center rounded-full bg-fill">
                      <Icon name="store" size={17} color={color.ink800} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text numberOfLines={1} className="text-[16px] font-bold leading-5 text-ink-950">{group.name}</Text>
                      <Text className="text-[12px] leading-4 text-ink-400">
                        {group.itemCount} item{group.itemCount === 1 ? '' : 's'}
                        {group.estimate ? ` · est. ${formatMoney(group.estimate)}` : ''}
                      </Text>
                    </View>
                  </View>
                </View>

                {checking && Object.keys(checks).length === 0 ? (
                  <View className="gap-5 border-t border-line pt-4">
                    {group.lines.map((line) => <LineItemSkeleton key={line.key} />)}
                  </View>
                ) : (
                  group.lines.map((line) => (
                    <LineRow
                      key={line.key}
                      line={line}
                      check={checks[line.key]}
                      onQuantity={(quantity) => setQuantity(line.key, quantity)}
                      onRemove={() => remove(line.key)}
                      onSave={() => {
                        toggleSaved(line.product, line.query ? { query: line.query } : undefined)
                        remove(line.key)
                      }}
                    />
                  ))
                )}

                {desktop ? null : (
                  <View className="mt-4 border-t border-line pt-4">
                    <Button
                      fullWidth
                      variant="accent"
                      loading={busyMerchant === group.key}
                      disabled={group.lines.every((line) => lineBlocked(checks[line.key]))}
                      onPress={() => void checkout(group)}
                    >
                      {`Checkout with ${group.name}`}
                    </Button>
                  </View>
                )}
              </Appear>
            ))}
          </View>

          {desktop ? <View className="w-[340px]">{summary}</View> : (
            <View className="border-t border-line pt-6">
              {total.estimate ? (
                <View className="flex-row items-baseline justify-between gap-3">
                  <Text className="text-[14px] font-medium leading-5 text-ink-600">Estimated total</Text>
                  <Text className="text-[22px] font-bold leading-7 text-ink-950">{formatMoney(total.estimate)}</Text>
                </View>
              ) : null}
              <View className="mt-2">
                <EstimateNote>
                  {total.estimate
                    ? 'Estimate. Each shop confirms its own total at checkout.'
                    : 'Different currencies, so Arro does not add these into one number.'}
                </EstimateNote>
              </View>
            </View>
          )}
        </View>
      </Shell>

      <SiteFooter className="mt-10" />

      <HandoffSheet
        purchase={handoff?.purchase}
        fallbackName={handoff?.shop ?? 'this shop'}
        onClose={() => setHandoff(undefined)}
      />
    </ScrollView>
  )
}
