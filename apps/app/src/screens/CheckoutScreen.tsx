import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppState, BackHandler, Platform, Pressable, ScrollView, Text, View } from 'react-native'
import type { EmbeddedCheckoutPresentation } from '@arro/contracts'
import { EmbeddedCheckout } from '../checkout/EmbeddedCheckout'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArroApiError,
  cancelPurchase,
  confirmPurchase,
  createPurchasePaymentAction,
  getPurchase,
  updatePurchaseReview
} from '../api/client'
import {
  CheckoutReview,
  type CheckoutReviewChanges,
  type CheckoutReviewHandle
} from '../components/CheckoutReview'
import {
  CheckoutMessageCard,
  checkoutMessageLineItemIndex,
  checkoutMessagePathIncludes
} from '../components/CheckoutMessageCard'
import { Icon } from '../components/Icon'
import { Appear, Swap, Tappable } from '../components/motion'
import { narrowShellClass } from '../components/Page'
import { ProductImage } from '../components/ProductImage'
import { CheckoutSkeleton } from '../components/skeletons'
import { Heading } from '../components/semantic'
import { Badge, Button, Notice } from '../components/ui'
import { useDocumentTitle } from '../lib/document-title'
import {
  openExactExternalStep,
  openMerchantStep,
  openPaymentStep
} from '../lib/external-step'
import { useLayoutMode } from '../lib/layout'
import { formatMoney } from '../lib/money'
import { shopperErrorText } from '../lib/shopper-copy'
import { checkoutHasInputErrors, checkoutMessageTarget, checkoutMessageHasEditor, groupCheckoutInputMessages } from '../lib/checkout-message-target'
import { color } from '../lib/theme'
import {
  executePreparedPaymentAction,
  negotiateCheckoutPaymentSession,
  preparePaymentAction,
  type CheckoutPaymentSession
} from '../payments'
import { GooglePayActionButton } from '../payments/google-pay-action-button'
import { openNativeCheckout, preloadNativeCheckout } from '../payments/checkout-presentation'
import { useCartStore } from '../store/useCartStore'
import { useCheckoutStore } from '../store/useCheckoutStore'
import { useOrdersStore, type OrderOutcome } from '../store/useOrdersStore'
import { useSavedStore } from '../store/useSavedStore'
import { useShopStore } from '../store/useShopStore'
import type { PurchaseResponse } from '../types/purchase'

type PaymentSessionState =
  | {
      key: string
      status: 'preparing'
    }
  | {
      key: string
      status: 'ready'
      session: CheckoutPaymentSession
    }
  | {
      key: string
      status: 'failed'
    }

/**
 * Arro records what it can actually observe. A confirmed order is a fact the
 * shop reported; a handoff is only that the shopper left for the shop's own
 * checkout, and inventing an order from that would put a purchase in someone's
 * history that may never have happened.
 */
const orderRecordFor = (purchase: PurchaseResponse, outcome: OrderOutcome) => {
  const total = purchase.totals?.find((entry) => entry.type === 'total') ?? purchase.totals?.[0]
  const item = purchase.items[0]
  const reference = purchase.pendingActions
    ?.map((action) => action.artifact?.reference)
    .find((value): value is string => Boolean(value))
  return {
    key: purchase.purchaseId,
    title: item?.title || 'Your order',
    shop: merchantName(purchase),
    outcome,
    ...(item?.url ? { href: item.url } : {}),
    ...(total?.currency
      ? { price: { amountMinor: total.amount, currency: total.currency } }
      : {}),
    ...(reference ? { reference } : {})
  }
}

const merchantName = (purchase: PurchaseResponse) =>
  purchase.merchant.displayName ||
  purchase.merchant.canonicalOrigin.replace(/^https?:\/\//, '').replace(/\/$/, '')

/**
 * A total with no stated currency cannot be formatted, and it cannot even be
 * given a decimal point: how many minor units a number carries is a property of
 * the currency. Guessing one would put an invented number in front of someone
 * about to pay, so the shop's own checkout stays the place that states it.
 */
const formatCheckoutMoney = (amount: number, currency: string | undefined) =>
  currency ? formatMoney({ amountMinor: amount, currency }) : 'Stated at the shop'

const totalLabel = (entry: NonNullable<PurchaseResponse['totals']>[number]) =>
  entry.display_text || entry.type.replaceAll('_', ' ')

const totalFor = (purchase: PurchaseResponse) =>
  purchase.totals?.find((total) => total.type === 'total') ?? purchase.totals?.at(-1)

const hasInAppContinuation = (purchase: PurchaseResponse) =>
  purchase.nextAction?.presentation?.type === 'ucp_embedded' ||
  (Platform.OS !== 'web' && purchase.nextAction?.presentation?.type === 'native_checkout')

const checkoutStateCopy = (purchase: PurchaseResponse) => {
  switch (purchase.state) {
    case 'completed':
      return { title: 'Order placed', body: `Your order with ${merchantName(purchase)} is confirmed.` }
    case 'payment_action_required':
      return { title: 'Complete payment', body: 'The shop needs one payment step before the order can be placed.' }
    case 'merchant_continuation_required':
      return {
        title: 'Review your checkout',
        body: hasInAppContinuation(purchase)
          ? `Check your details here, then open ${merchantName(purchase)}’s checkout inside Arro for delivery and payment.`
          : `Check your details here, then open ${merchantName(purchase)}’s checkout for delivery and payment.`
      }
    case 'ready_for_autonomous_completion':
      return { title: 'Ready to place your order', body: 'Check the order once more, then confirm when you are ready.' }
    case 'canceled':
      return { title: 'Checkout canceled', body: 'Nothing else will happen in this checkout.' }
    case 'unavailable':
      return { title: 'Checkout is not available here', body: 'Go back and choose another offer or shop.' }
    default:
      if (purchase.nextAction?.type === 'review_purchase') {
        return {
          title: 'Complete your details',
          body: `${merchantName(purchase)} needs a few details before payment.`
        }
      }
      return purchase.nextAction?.type === 'confirm_purchase'
        ? { title: 'Review your order', body: 'Check the shop, items and total before placing the order.' }
        : { title: 'Checkout in progress', body: 'Arro is waiting for the shop to confirm the next step.' }
  }
}

const stateTone = (purchase: PurchaseResponse) => {
  if (purchase.state === 'completed') return 'positive' as const
  if (purchase.state === 'canceled' || purchase.state === 'unavailable') return 'neutral' as const
  if (purchase.state === 'payment_action_required' || purchase.state === 'merchant_continuation_required') {
    return 'warning' as const
  }
  return 'accent' as const
}

const stateBadge = (purchase: PurchaseResponse) => ({
  review_required: 'Review',
  completed: 'Order confirmed',
  payment_action_required: 'Payment step',
  merchant_continuation_required: 'Shop step',
  ready_for_autonomous_completion: 'Ready',
  canceled: 'Canceled',
  unavailable: 'Unavailable'
}[purchase.state])

const primaryActionLabel = (purchase: PurchaseResponse) => {
  if (purchase.state === 'completed') return purchase.nextAction?.url ? 'View order' : 'Back to shopping'
  if (purchase.state === 'merchant_continuation_required') return hasInAppContinuation(purchase) ? 'Open secure checkout' : 'Continue with shop'
  if (purchase.state === 'ready_for_autonomous_completion' || purchase.nextAction?.type === 'confirm_purchase') {
    return 'Place order'
  }
  if (purchase.nextAction?.type === 'review_purchase') return 'Complete checkout details'
  if (purchase.state === 'payment_action_required') return 'Complete payment'
  if (purchase.state === 'canceled' || purchase.state === 'unavailable') return 'Back to shopping'
  if (purchase.nextAction?.type === 'refresh_purchase') return 'Check status'
  return 'Continue'
}

const primaryActionIcon = (purchase: PurchaseResponse) => {
  if (purchase.state === 'completed') return 'check' as const
  if (purchase.state === 'merchant_continuation_required') return hasInAppContinuation(purchase) ? 'lock' as const : 'external' as const
  if (purchase.nextAction?.type === 'review_purchase') return 'person' as const
  return 'lock' as const
}

const steps = ['Review', 'Payment', 'Order'] as const

/** Where the merchant's own state machine has actually reached. */
const stepIndex = (purchase: PurchaseResponse) => {
  if (purchase.state === 'completed') return 2
  if (purchase.state === 'payment_action_required') return 1
  return 0
}

const needsPaymentAction = (purchase: PurchaseResponse | undefined) => Boolean(
  purchase && (
    purchase.state === 'payment_action_required' ||
    purchase.nextAction?.type === 'provide_payment'
  )
)

const paymentSessionKeyFor = (purchase: PurchaseResponse) => [
  purchase.purchaseId,
  purchase.checkoutSnapshotHash ?? 'no-snapshot',
  purchase.state,
  purchase.nextAction?.type ?? 'no-action'
].join(':')

function Stepper({ current }: { current: number }) {
  return (
    <View className="flex-row items-center gap-2" accessibilityLabel={`Step ${current + 1} of ${steps.length}: ${steps[current]}`}>
      {steps.map((step, index) => {
        const done = index < current
        const active = index === current
        return (
          <View key={step} className="flex-1 flex-row items-center gap-2">
            <View className={`h-6 w-6 items-center justify-center rounded-full ${done ? 'bg-positive' : active ? 'bg-ink-950' : 'bg-fill'}`}>
              {done ? (
                <Icon name="check" size={12} color={color.white} />
              ) : (
                <Text className={`text-[11px] font-bold leading-4 ${active ? 'text-white' : 'text-ink-400'}`}>
                  {index + 1}
                </Text>
              )}
            </View>
            <Text
              numberOfLines={1}
              className={`min-w-0 flex-1 text-[12px] leading-4 ${active ? 'font-semibold text-ink-950' : 'text-ink-400'}`}
            >
              {step}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

function CheckoutPurchaseScreen({ purchaseId }: { purchaseId: string }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { desktop } = useLayoutMode()
  const cartLines = useCartStore((state) => state.lines)
  const prepared = useCheckoutStore((state) => state.prepared)
  const clearPrepared = useCheckoutStore((state) => state.setPrepared)
  const clearActive = useCheckoutStore((state) => state.clearActive)
  const recordOrder = useOrdersStore((state) => state.record)
  const recent = useSavedStore((state) => state.recent)
  const selectedOffers = useShopStore((state) => state.selectedOffers)
  // `prepare` already returned the whole purchase a moment ago. Rendering from
  // it removes a round trip from the slowest point in the flow, and a deep link
  // that arrives without it still reads from the API below.
  const initialPurchase = useRef(
    prepared && prepared.purchaseId === purchaseId ? prepared : undefined
  ).current
  const [purchase, setPurchase] = useState<PurchaseResponse | undefined>(initialPurchase)
  const [loading, setLoading] = useState(!initialPurchase)
  const [working, setWorking] = useState(false)
  const [reviewEditing, setReviewEditing] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [embedded, setEmbedded] = useState<{ url: string; presentation: EmbeddedCheckoutPresentation }>()
  const [continuationRecoveryUrl, setContinuationRecoveryUrl] = useState<string>()
  const [paymentSession, setPaymentSession] = useState<PaymentSessionState>()
  const awaitingExternalRefresh = useRef(false)
  const watcher = useRef<ReturnType<typeof setInterval>>(undefined)
  const scrollView = useRef<ScrollView>(null)
  const review = useRef<CheckoutReviewHandle>(null)
  const reviewUpdateLock = useRef(false)
  const mutationInFlight = useRef(false)
  const refreshGeneration = useRef(0)
  const refreshInFlight = useRef(false)
  const merchantRetryAt = useRef(0)
  const paymentPreparationGeneration = useRef(0)
  const externalOnlyPaymentKeys = useRef(new Set<string>())
  const paymentSessionRequests = useRef(new Map<string, Promise<CheckoutPaymentSession>>())

  /**
   * The merchant's line items are the authority for what is being bought, and
   * they carry no media. The picture beside each line is the one Arro already
   * showed this shopper for that item — presentation only, matched on the item
   * identity the checkout itself returned, and absent when nothing matches.
   */
  const knownImages = useMemo(() => {
    const map = new Map<string, string>()
    const remember = (product: { productId: string; variantId?: string; imageUrl?: string }) => {
      if (!product.imageUrl) return
      if (product.variantId) map.set(product.variantId, product.imageUrl)
      map.set(product.productId, product.imageUrl)
    }
    for (const line of cartLines) remember(line.product)
    for (const product of recent) remember(product)
    for (const offer of selectedOffers) remember(offer)
    return map
  }, [cartLines, recent, selectedOffers])

  const activePaymentSessionKey = purchase && needsPaymentAction(purchase)
    ? paymentSessionKeyFor(purchase)
    : undefined

  useDocumentTitle(purchase ? `${checkoutStateCopy(purchase).title} · Arro` : 'Checkout · Arro')

  const beginMutation = useCallback(() => {
    if (mutationInFlight.current) return false
    mutationInFlight.current = true
    // Any GET already in flight describes state from before this mutation.
    // Invalidating it prevents a late response from replacing the mutation's
    // authoritative Purchase response.
    refreshGeneration.current += 1
    setWorking(true)
    return true
  }, [])

  const endMutation = useCallback(() => {
    mutationInFlight.current = false
    setWorking(false)
  }, [])

  const load = useCallback(async (allowDuringMutation = false) => {
    if (!purchaseId) {
      setError('That checkout link did not work. Go back and try again.')
      setLoading(false)
      return
    }
    if (mutationInFlight.current && !allowDuringMutation) return
    if (refreshInFlight.current || Date.now() < merchantRetryAt.current) return

    const generation = ++refreshGeneration.current
    refreshInFlight.current = true
    try {
      setError(undefined)
      const refreshed = await getPurchase(purchaseId)
      if (generation !== refreshGeneration.current) return
      if (mutationInFlight.current && !allowDuringMutation) return
      setPurchase(refreshed)
    } catch (caught) {
      if (generation !== refreshGeneration.current) return
      if (caught instanceof ArroApiError && caught.status === 404) clearActive(purchaseId)
      if (caught instanceof ArroApiError && caught.status === 429) {
        clearInterval(watcher.current)
        merchantRetryAt.current = Date.now() + Math.max(1, caught.retryAfterSeconds ?? 60) * 1000
      }
      setError(shopperErrorText(caught, 'We could not load this checkout. Try again.'))
    } finally {
      refreshInFlight.current = false
      if (generation === refreshGeneration.current) setLoading(false)
    }
  }, [clearActive, purchaseId])

  useEffect(() => {
    if (initialPurchase) {
      // Consumed once. Leaving it in the store would show a stale purchase the
      // next time this screen opens for a different one.
      clearPrepared(undefined)
      setLoading(false)
      return
    }
    void load()
  }, [clearPrepared, initialPurchase, load])

  useEffect(() => {
    if (purchase?.state === 'completed') {
      clearInterval(watcher.current)
      setNotice(undefined)
      recordOrder(orderRecordFor(purchase, 'placed'))
      clearActive(purchase.purchaseId)
    } else if (purchase?.state === 'canceled') {
      clearInterval(watcher.current)
      clearActive(purchase.purchaseId)
    }
  }, [clearActive, purchase, recordOrder])

  const prepareCheckoutPayment = useCallback(async (
    key: string,
    activePurchaseId: string,
    forceFresh = false
  ) => {
    const generation = ++paymentPreparationGeneration.current
    const externalOnly = externalOnlyPaymentKeys.current.has(key)
    setError(undefined)
    setPaymentSession({ key, status: 'preparing' })

    try {
      let request = forceFresh ? undefined : paymentSessionRequests.current.get(key)
      if (!request) {
        request = negotiateCheckoutPaymentSession(
          activePurchaseId,
          {
            createAction: createPurchasePaymentAction,
            prepareAction: preparePaymentAction,
            onNativeUnavailable: () => {
              externalOnlyPaymentKeys.current.add(key)
            }
          },
          externalOnly ? 'external_only' : 'native_preferred'
        )
        paymentSessionRequests.current.set(key, request)
      }
      const session = await request
      if (generation !== paymentPreparationGeneration.current) return undefined
      if (session.externalOnly) externalOnlyPaymentKeys.current.add(key)
      setPaymentSession({ key, status: 'ready', session })
      return session
    } catch (caught) {
      if (generation !== paymentPreparationGeneration.current) return undefined
      paymentSessionRequests.current.delete(key)
      const message = shopperErrorText(caught, 'Payment could not be prepared. Try again.')
      setPaymentSession({
        key,
        status: 'failed'
      })
      setError(message)
      return undefined
    }
  }, [])

  useEffect(() => {
    if (!activePaymentSessionKey || !purchase) {
      paymentPreparationGeneration.current += 1
      paymentSessionRequests.current.clear()
      setPaymentSession(undefined)
      return
    }

    for (const key of paymentSessionRequests.current.keys()) {
      if (key !== activePaymentSessionKey) paymentSessionRequests.current.delete(key)
    }

    void prepareCheckoutPayment(activePaymentSessionKey, purchase.purchaseId)
    return () => {
      paymentPreparationGeneration.current += 1
    }
  }, [activePaymentSessionKey, prepareCheckoutPayment, purchase?.purchaseId])

  useEffect(() => {
    if (Platform.OS === 'web') return
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !awaitingExternalRefresh.current) return
      awaitingExternalRefresh.current = false
      void load()
    })
    return () => subscription.remove()
  }, [load])

  useEffect(() => {
    if (purchase?.state === 'merchant_continuation_required') preloadNativeCheckout(purchase.nextAction)
  }, [purchase?.state, purchase?.nextAction?.url, purchase?.nextAction?.presentation?.type])

  useEffect(() => {
    setEmbedded(undefined)
    setContinuationRecoveryUrl(undefined)
  }, [purchaseId])

  useEffect(() => {
    if (!embedded || Platform.OS === 'web') return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setEmbedded(undefined)
      void load()
      return true
    })
    return () => subscription.remove()
  }, [embedded, load])

  /**
   * Polls while the shopper is finishing on the merchant's own page. Bounded:
   * a checkout nobody comes back to must not leave a timer running forever.
   */
  const startWatching = useCallback(() => {
    clearInterval(watcher.current)
    let ticks = 0
    watcher.current = setInterval(() => {
      ticks += 1
      if (ticks > 40) {
        clearInterval(watcher.current)
        return
      }
      void load()
    }, 6000)
  }, [load])

  useEffect(() => () => clearInterval(watcher.current), [])

  const openExternalStep = useCallback(async (url: string) => {
    if (Platform.OS === 'web') {
      const outcome = await openMerchantStep(url)
      // If an opener keeps this page alive, it can keep watching the purchase.
      if (outcome === 'dismissed') startWatching()
      return
    }
    // The in-app browser resolves when the shopper closes it, so the purchase
    // can be re-read straight away instead of waiting for the app to come back
    // to the foreground. The foreground listener stays as the fallback for the
    // case where the OS browser was used instead.
    awaitingExternalRefresh.current = true
    const outcome = await openMerchantStep(url)
    if (outcome === 'dismissed') {
      awaitingExternalRefresh.current = false
      await load(true)
    }
  }, [load, startWatching])

  /**
   * Signed provider/action URLs and order permalinks must remain exact. They do
   * not receive affiliate parameters; doing so can invalidate a signature or
   * change the resource the merchant intended the shopper to open.
   */
  const openExactStep = useCallback(async (
    url: string,
    opener: (value: string) => Promise<'dismissed' | 'left'> = openExactExternalStep
  ) => {
    if (Platform.OS === 'web') {
      const outcome = await opener(url)
      if (outcome === 'dismissed') startWatching()
      return
    }
    awaitingExternalRefresh.current = true
    const outcome = await opener(url)
    if (outcome === 'dismissed') {
      awaitingExternalRefresh.current = false
      await load(true)
    }
  }, [load, startWatching])

  const openMessageUrl = useCallback((url: string) => {
    void openExactStep(url).catch((caught) => {
      setError(shopperErrorText(caught, 'That shop link could not open. Try again.'))
    })
  }, [openExactStep])

  const runPreparedPayment = useCallback(async (
    session: CheckoutPaymentSession,
    key: string,
    activePurchaseId: string
  ) => {
    const outcome = await executePreparedPaymentAction(session.prepared)
    if (outcome.status === 'canceled') {
      setNotice('Payment was canceled. Your checkout is still here and no order was placed.')
      return
    }
    if (outcome.status === 'failed') throw new Error(outcome.message)
    if (outcome.status === 'external_action_required') {
      await openExactStep(outcome.actionUrl, openPaymentStep)
      return
    }
    if (outcome.status === 'result_submitted') {
      // The wallet authorization is deliberate approval of the displayed
      // merchant total. Only the merchant's later Purchase response can turn
      // that credential into an order.
      let updated = outcome.purchase
      // Persist the merchant's post-credential state before the optional
      // completion call. If completion fails, the next tap must resume from
      // this state instead of reopening a native payment sheet for another credential.
      setPurchase(updated)
      if (updated.state !== 'completed' && updated.nextAction?.type === 'confirm_purchase') {
        updated = await confirmPurchase(updated)
      }
      setPurchase(updated)
      if (updated.state === 'completed') recordOrder(orderRecordFor(updated, 'placed'))
      return
    }
    if (outcome.fallback === 'request_external_action' && !session.externalOnly) {
      // Readiness can change between preflight and tap. Cache that loss for
      // this checkout and prepare one explicit external action. Do not launch a
      // browser as a surprise from a native payment control.
      externalOnlyPaymentKeys.current.add(key)
      await prepareCheckoutPayment(key, activePurchaseId, true)
      setNotice('Native payment is no longer available. Continue with the shop’s secure payment step.')
      return
    }
    throw new Error(outcome.reason)
  }, [openExactStep, prepareCheckoutPayment, recordOrder])

  const nativePaymentAction = useCallback(async () => {
    if (
      !purchase ||
      working ||
      mutationInFlight.current ||
      !activePaymentSessionKey ||
      paymentSession?.key !== activePaymentSessionKey ||
      paymentSession.status !== 'ready' ||
      paymentSession.session.prepared.status !== 'native_ready'
    ) return

    try {
      if (!beginMutation()) return
      setError(undefined)
      setNotice(undefined)
      await runPreparedPayment(
        paymentSession.session,
        activePaymentSessionKey,
        purchase.purchaseId
      )
    } catch (caught) {
      setError(shopperErrorText(caught, 'Payment could not continue. Try again.'))
    } finally {
      endMutation()
    }
  }, [activePaymentSessionKey, beginMutation, endMutation, paymentSession, purchase, runPreparedPayment, working])

  const primaryAction = useCallback(async () => {
    if (!purchase || working || mutationInFlight.current) return
    const nextUrl = purchase.nextAction?.url || purchase.cart?.continueUrl

    if (purchase.nextAction?.type === 'review_purchase') {
      setError(undefined)
      setNotice(undefined)
      if (!review.current?.openRequiredStep()) {
        scrollView.current?.scrollToEnd({ animated: true })
        setNotice('Choose the highlighted delivery or pickup option, then continue.')
      }
      return
    }

    try {
      if (!beginMutation()) return
      setError(undefined)
      setNotice(undefined)

      if (purchase.state === 'completed' || purchase.state === 'canceled') clearInterval(watcher.current)

      if (purchase.state === 'canceled' || purchase.state === 'unavailable') {
        router.back()
        return
      }

      if (purchase.state === 'completed') {
        recordOrder(orderRecordFor(purchase, 'placed'))
        if (nextUrl) await openExactStep(nextUrl)
        else router.back()
        return
      }

      if (purchase.nextAction?.type === 'complete_ucp_action') {
        if (!nextUrl) {
          throw new Error('This shop returned a payment action this app cannot present yet. Your checkout is unchanged.')
        }
        await openExactStep(nextUrl, openPaymentStep)
        return
      }

      if (purchase.state === 'merchant_continuation_required') {
        if (!nextUrl) throw new Error('The shop did not provide a checkout link.')
        recordOrder(orderRecordFor(purchase, 'continued'))
        setContinuationRecoveryUrl(undefined)
        const action = purchase.nextAction
        if (action?.presentation?.type === 'ucp_embedded') {
          clearInterval(watcher.current)
          setEmbedded({ url: nextUrl, presentation: action.presentation })
          return
        }
        try {
          const native = action && openNativeCheckout(action)
          if (native) {
            await native
            await load(true)
          } else {
            await openExactStep(nextUrl)
          }
        } catch (caught) {
          setContinuationRecoveryUrl(nextUrl)
          throw caught
        }
        return
      }

      if (purchase.state === 'ready_for_autonomous_completion' || purchase.nextAction?.type === 'confirm_purchase') {
        setPurchase(await confirmPurchase(purchase))
        return
      }

      if (purchase.state === 'payment_action_required' || purchase.nextAction?.type === 'provide_payment') {
        if (!activePaymentSessionKey) return
        if (
          paymentSession?.key !== activePaymentSessionKey ||
          paymentSession.status === 'failed'
        ) {
          await prepareCheckoutPayment(activePaymentSessionKey, purchase.purchaseId)
          return
        }
        if (paymentSession.status === 'preparing') return
        // A host-native action is deliberately absent from this generic path.
        // It is executed only by its explicit native payment control below.
        if (paymentSession.session.prepared.status === 'native_ready') return
        await runPreparedPayment(
          paymentSession.session,
          activePaymentSessionKey,
          purchase.purchaseId
        )
        return
      }

      if (nextUrl) {
        await openExternalStep(nextUrl)
        return
      }

      await load(true)
    } catch (caught) {
      setError(shopperErrorText(caught, 'Checkout could not continue. Try again.'))
    } finally {
      endMutation()
    }
  }, [
    activePaymentSessionKey,
    beginMutation,
    endMutation,
    load,
    openExactStep,
    openExternalStep,
    paymentSession,
    prepareCheckoutPayment,
    purchase,
    router,
    runPreparedPayment,
    working
  ])

  const cancel = useCallback(async () => {
    if (!purchase || working || mutationInFlight.current || purchase.state === 'completed' || purchase.state === 'canceled') return
    try {
      if (!beginMutation()) return
      setError(undefined)
      setPurchase(await cancelPurchase(purchase.purchaseId))
    } catch (caught) {
      setError(shopperErrorText(caught, 'We could not cancel this checkout. Try again.'))
    } finally {
      endMutation()
    }
  }, [beginMutation, endMutation, purchase, working])

  const updateReview = useCallback(async (changes: CheckoutReviewChanges) => {
    if (!purchase) throw new Error('This checkout is not loaded yet.')
    if (Date.now() < merchantRetryAt.current) {
      throw new Error('This shop is temporarily limiting checkout updates. Wait before trying again, or continue with the shop.')
    }
    if (working || mutationInFlight.current || reviewUpdateLock.current) {
      throw new Error('Another checkout update is still finishing. Try again in a moment.')
    }
    if (!purchase.checkoutSnapshotHash) {
      const missingSnapshot = new Error('Refresh this checkout before changing its details.')
      throw missingSnapshot
    }

    if (!beginMutation()) {
      throw new Error('Another checkout update is still finishing. Try again in a moment.')
    }
    reviewUpdateLock.current = true
    try {
      setError(undefined)
      setNotice(undefined)
      const updated = await updatePurchaseReview(purchase.purchaseId, {
        checkoutSnapshotHash: purchase.checkoutSnapshotHash,
        ...changes
      })
      setPurchase(updated)
      setNotice(checkoutHasInputErrors(updated) ? undefined : 'Checkout details updated. Review the refreshed total before payment.')
      return updated
    } catch (caught) {
      let message = shopperErrorText(caught, 'These checkout details could not be updated. Try again.')
      if (caught instanceof ArroApiError && caught.status === 429) {
        clearInterval(watcher.current)
        merchantRetryAt.current = Date.now() + Math.max(1, caught.retryAfterSeconds ?? 60) * 1000
      }
      if (caught instanceof Error && 'status' in caught && caught.status === 409) {
        await load(true)
        message = 'The shop changed this checkout while you were editing. It has been refreshed; review it and try again.'
      } else if (caught instanceof ArroApiError && caught.code === 'ucp_review_rejected') {
        await load(true)
      }
      // The form that submitted this update owns its error. Showing it here
      // as well repeats the same failure behind the open dialog.
      throw new Error(message)
    } finally {
      reviewUpdateLock.current = false
      endMutation()
    }
  }, [beginMutation, endMutation, load, purchase, working])

  const copy = purchase ? checkoutStateCopy(purchase) : undefined
  const total = purchase ? totalFor(purchase) : undefined
  const checkoutCurrency = total?.currency ?? purchase?.totals?.find((entry) => entry.currency)?.currency
  const primaryLabel = useMemo(() => purchase ? primaryActionLabel(purchase) : 'Continue', [purchase])
  const settled = purchase
    ? purchase.state === 'completed' || purchase.state === 'canceled' || purchase.state === 'unavailable'
    : false
  const itemCount = purchase?.items.reduce((count, item) => count + (item.quantity ?? 1), 0) ?? 0
  const visibleMessages = useMemo(() => {
    if (!purchase) return []
    const belongsBesideContent = (message: PurchaseResponse['messages'][number]) => {
      if (checkoutMessageHasEditor(message, purchase)) return true
      if (purchase.state === 'merchant_continuation_required' &&
        message.code === 'extension_interaction_required' &&
        message.presentation !== 'disclosure' && !message.url && !message.imageUrl) return true
      if (message.presentation !== 'disclosure') return false
      const lineItemIndex = checkoutMessageLineItemIndex(message)
      if (lineItemIndex !== undefined && purchase.items[lineItemIndex]) return true
      if (checkoutMessagePathIncludes(message, 'buyer')) return true
      if (checkoutMessagePathIncludes(message, 'fulfillment')) return true
      if (checkoutMessagePathIncludes(message, 'policies', 'links')) return true
      return Boolean(message.code && purchase.policies?.some((policy) => policy.type === message.code))
    }
    const required = purchase.messages.filter((message) =>
      !belongsBesideContent(message) && (
        message.presentation === 'disclosure' || message.severity !== 'info'
      )
    )
    const informational = purchase.messages.filter((message) =>
      !belongsBesideContent(message) && message.presentation !== 'disclosure' && message.severity === 'info'
    )
    return groupCheckoutInputMessages([...required, ...informational])
  }, [purchase])

  if (loading) {
    return (
      <ScrollView contentInsetAdjustmentBehavior="automatic" className="flex-1 bg-fill-soft">
        <CheckoutSkeleton desktop={desktop} />
      </ScrollView>
    )
  }

  if (!purchase) {
    return (
      <View className="flex-1 items-center justify-center bg-fill-soft px-6">
        <View className="h-14 w-14 items-center justify-center rounded-full bg-white">
          <Icon name="alert" size={24} color={color.ink800} />
        </View>
        <Heading level={1} className="mt-4 text-[20px] font-bold leading-7 text-ink-950">
          Checkout could not open
        </Heading>
        <Text className="mt-2 max-w-[400px] text-center text-[14px] leading-5 text-ink-600">
          {error || 'Open the product again and choose an offer.'}
        </Text>
        <View className="mt-5"><Button variant="outline" onPress={() => router.back()}>Go back</Button></View>
      </View>
    )
  }

  if (embedded) {
    return (
      <View className="flex-1 bg-white" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
        <EmbeddedCheckout
          key={`${purchaseId}:${embedded.url}`}
          {...embedded}
          merchantName={merchantName(purchase)}
          onClose={() => { setEmbedded(undefined); void load() }}
          onComplete={() => {
            setEmbedded(undefined)
            setNotice('Confirming your order with the shop…')
            void load()
            startWatching()
          }}
          onOpenBrowser={(url) => {
            setEmbedded(undefined)
            void openExactStep(url).catch((caught) => {
              setError(shopperErrorText(caught, 'The shop’s checkout could not open. Try again.'))
            })
          }}
        />
      </View>
    )
  }

  const nativePaymentSession = activePaymentSessionKey &&
    paymentSession?.key === activePaymentSessionKey &&
    paymentSession.status === 'ready' &&
    paymentSession.session.prepared.status === 'native_ready'
    ? paymentSession.session
    : undefined
  const nativeGooglePaySession =
    nativePaymentSession?.prepared.status === 'native_ready' &&
    nativePaymentSession.prepared.nativeProvider === 'google_pay'
      ? nativePaymentSession
      : undefined
  const nativeStripeSession =
    nativePaymentSession?.prepared.status === 'native_ready' &&
    nativePaymentSession.prepared.nativeProvider === 'stripe'
      ? nativePaymentSession
      : undefined
  const paymentPreparing = Boolean(
    activePaymentSessionKey &&
    paymentSession?.key === activePaymentSessionKey &&
    paymentSession.status === 'preparing'
  )
  const paymentPreparationFailed = Boolean(
    activePaymentSessionKey &&
    paymentSession?.key === activePaymentSessionKey &&
    paymentSession.status === 'failed'
  )

  const actions = (
    <View className="gap-1">
      {continuationRecoveryUrl && purchase.state === 'merchant_continuation_required' ? (
        <Button fullWidth variant="outline" onPress={() => {
          void openExactStep(continuationRecoveryUrl).catch((caught) => {
            setError(shopperErrorText(caught, 'The shop’s checkout could not open. Try again.'))
          })
        }}>Continue on the shop’s site</Button>
      ) : null}
      {nativeGooglePaySession &&
      nativeGooglePaySession.prepared.status === 'native_ready' &&
      nativeGooglePaySession.prepared.nativeProvider === 'google_pay' ? (
        <GooglePayActionButton
          request={nativeGooglePaySession.prepared.request}
          disabled={working}
          onPress={() => void nativePaymentAction()}
        />
      ) : nativeStripeSession ? (
        <Button
          fullWidth
          size="lg"
          variant="accent"
          loading={working}
          icon="payments"
          onPress={() => void nativePaymentAction()}
        >
          Pay securely
        </Button>
      ) : (
        <Button
          fullWidth
          size="lg"
          variant={purchase.state === 'completed' ? 'primary' : 'accent'}
          loading={working || paymentPreparing}
          icon={primaryActionIcon(purchase)}
          onPress={() => void primaryAction()}
        >
          {paymentPreparing
            ? 'Preparing payment'
            : paymentPreparationFailed
              ? 'Try payment again'
              : primaryLabel}
        </Button>
      )}
      {settled ? null : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check checkout status"
            accessibilityState={{ disabled: working }}
            disabled={working}
            onPress={() => void load()}
            className={`min-h-11 flex-row items-center justify-center gap-2 ${working ? 'opacity-40' : ''}`}
          >
            <Icon name="refresh" size={16} color={color.ink600} />
            <Text className="text-[14px] font-medium leading-5 text-ink-600">Check checkout status</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel this checkout"
            disabled={working}
            onPress={() => void cancel()}
            className="min-h-11 items-center justify-center"
          >
            <Text className="text-[13px] leading-[18px] text-ink-400">Cancel checkout</Text>
          </Pressable>
        </>
      )}
    </View>
  )

  return (
    <View className="flex-1 bg-fill-soft">
      <ScrollView
        ref={scrollView}
        contentInsetAdjustmentBehavior={Platform.OS === 'web' ? 'automatic' : 'never'}
        contentContainerStyle={{
          paddingTop: Platform.OS === 'web' ? 0 : insets.top,
          paddingBottom: (desktop ? 48 : 176) + insets.bottom
        }}
      >
        <View className={`${narrowShellClass} py-4 md:py-8`}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            className="mb-4 min-h-9 flex-row items-center gap-1 self-start"
          >
            <Icon name="chevronLeft" size={17} color={color.ink600} />
            <Text className="text-[14px] font-medium leading-5 text-ink-600">Back</Text>
          </Pressable>

          <View className={desktop ? 'flex-row items-start gap-6' : 'gap-4'}>
            <View className="min-w-0 flex-1 rounded-3xl bg-white p-5 md:p-7">
              {settled && purchase.state !== 'completed' ? null : (
                <View className="mb-6"><Stepper current={stepIndex(purchase)} /></View>
              )}

              <Appear key={purchase.state} className="gap-1.5">
                <View className="flex-row items-center gap-2.5">
                  {purchase.state === 'completed' ? (
                    <View className="h-9 w-9 items-center justify-center rounded-full bg-positive-soft">
                      <Icon name="check" size={19} color={color.positive} />
                    </View>
                  ) : null}
                  {purchase.state !== 'merchant_continuation_required' ? <Badge tone={stateTone(purchase)}>{stateBadge(purchase)}</Badge> : null}
                </View>
                <Heading level={1} className="mt-2 text-[22px] font-bold leading-7 tracking-[-0.4px] text-ink-950 md:text-[28px] md:leading-9">
                  {copy?.title}
                </Heading>
                <Text className="text-[15px] leading-6 text-ink-600">{copy?.body}</Text>
              </Appear>

              <View className="mt-6 flex-row items-center gap-3 border-t border-line pt-5">
                <View className="h-10 w-10 items-center justify-center rounded-full bg-fill">
                  <Icon name="store" size={18} color={color.ink800} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-[12px] font-semibold uppercase leading-4 tracking-[0.6px] text-ink-400">Shop</Text>
                  <Text numberOfLines={1} className="text-[17px] font-semibold leading-6 text-ink-950">
                    {merchantName(purchase)}
                  </Text>
                </View>
              </View>

              <View className="mt-5">
                <Text className="mb-3 text-[12px] font-semibold uppercase leading-4 tracking-[0.6px] text-ink-400">
                  {itemCount} item{itemCount === 1 ? '' : 's'}
                </Text>
                <View className="gap-4">
                  {purchase.items.map((item, itemIndex) => {
                    const image = knownImages.get(item.itemId)
                    const disclosures = purchase.messages.filter((message) =>
                      message.presentation === 'disclosure' &&
                      checkoutMessageLineItemIndex(message) === itemIndex
                    )
                    return (
                      <View key={`${item.itemId}:${item.lineItemId ?? ''}`} className="gap-2">
                        <View className="flex-row items-center gap-3.5">
                          <View className="h-[68px] w-[68px] items-center justify-center overflow-hidden rounded-2xl bg-fill-soft p-1.5">
                            {image ? (
                              <ProductImage uri={image} alt="" width={68} className="h-full w-full" />
                            ) : (
                              <Icon name="store" size={20} color={color.ink400} />
                            )}
                          </View>
                          <View className="min-w-0 flex-1">
                            <Text numberOfLines={2} className="text-[15px] font-medium leading-5 text-ink-950">
                              {item.title || 'Selected item'}
                            </Text>
                            <Text className="mt-1 text-[13px] leading-[18px] text-ink-400">
                              Quantity {item.quantity ?? 1}
                            </Text>
                          </View>
                        </View>
                        {disclosures.map((message, index) => (
                          <CheckoutMessageCard
                            key={`${message.code ?? 'item-disclosure'}:${message.path ?? ''}:${index}`}
                            message={message}
                            onOpen={openMessageUrl}
                          />
                        ))}
                      </View>
                    )
                  })}
                </View>
              </View>

              {purchase.totals?.length ? (
                <View className="mt-6 gap-2 border-t border-line pt-5">
                  {purchase.totals.map((entry) => {
                    const isTotal = entry.type === 'total'
                    return (
                      <View
                        key={`${entry.type}:${entry.display_text ?? ''}`}
                        className="flex-row items-center justify-between gap-4"
                      >
                        <Text className={isTotal ? 'text-[15px] font-semibold leading-5 text-ink-950' : 'text-[14px] leading-5 text-ink-600'}>
                          {totalLabel(entry)}
                        </Text>
                        <Text className={isTotal ? 'text-[18px] font-bold leading-6 text-ink-950' : 'text-[14px] font-medium leading-5 text-ink-800'}>
                          {formatCheckoutMoney(entry.amount, entry.currency ?? checkoutCurrency)}
                        </Text>
                      </View>
                    )
                  })}
                </View>
              ) : null}

              <CheckoutReview
                ref={review}
                purchase={purchase}
                disabled={settled || purchase.checkoutStatus === 'complete_in_progress'}
                working={working}
                onUpdate={updateReview}
                onEditingChange={setReviewEditing}
              />

              {visibleMessages.length ? (
                <View className="mt-5 gap-2">
                  {visibleMessages.map((message, index) => {
                    const target = checkoutMessageTarget(message)
                    const editable = !settled && !working && purchase.checkoutStatus !== 'complete_in_progress'
                    const canEdit = target === 'buyer' || (target === 'fulfillment' && (
                      purchase.canAddShippingAddress || purchase.fulfillment?.methods?.some((method) => method.type === 'shipping' && method.id)
                    ))
                    return (
                      <CheckoutMessageCard
                        key={`${message.code ?? message.severity}:${message.path ?? ''}:${index}`}
                        message={message}
                        onOpen={openMessageUrl}
                        {...(target && canEdit && editable && message.presentation !== 'disclosure' ? {
                          action: {
                            label: target === 'buyer' ? 'Edit contact details' : 'Edit delivery address',
                            onPress: () => { review.current?.openStep(target) }
                          }
                        } : {})}
                      />
                    )
                  })}
                </View>
              ) : null}
            </View>

            <View className={desktop ? 'w-[340px] gap-4' : 'gap-4'}>
              <View className="rounded-3xl bg-white p-5">
                {total ? (
                  <View className="mb-4 flex-row items-end justify-between gap-3">
                    <Text className="text-[14px] font-medium leading-5 text-ink-600">Total</Text>
                    <Swap value={total.amount}>
                      <Text className="text-[24px] font-bold leading-8 text-ink-950">
                        {formatCheckoutMoney(total.amount, total.currency ?? checkoutCurrency)}
                      </Text>
                    </Swap>
                  </View>
                ) : null}

                <View className="flex-row items-start gap-2.5 rounded-2xl bg-fill-soft p-3.5">
                  <Icon name="lock" size={15} color={color.ink600} />
                  <Text className="min-w-0 flex-1 text-[12px] leading-4 text-ink-600">
                    {merchantName(purchase)} is the seller of record and confirms this total.
                  </Text>
                </View>

                {error && !reviewEditing ? <View className="mt-4"><Notice tone="danger" icon="alert">{error}</Notice></View> : null}
                {notice ? <View className="mt-4"><Notice tone="neutral" icon="info">{notice}</Notice></View> : null}

                {desktop ? <View className="mt-4">{actions}</View> : null}
              </View>

              {purchase.state === 'completed' ? (
                <Tappable
                  accessibilityLabel="Back to shopping"
                  onPress={() => router.push('/')}
                  className="min-h-11 flex-row items-center justify-center gap-2 rounded-full border border-line bg-white"
                >
                  <Icon name="compass" size={16} color={color.ink800} />
                  <Text className="text-[14px] font-semibold leading-5 text-ink-800">Keep shopping</Text>
                </Tappable>
              ) : null}
            </View>
          </View>
        </View>
      </ScrollView>

      {desktop ? null : (
        <View
          className="absolute bottom-0 left-0 right-0 border-t border-line bg-white px-4 pt-3"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          {actions}
        </View>
      )}
    </View>
  )
}

/** A changed deep-link ID is a different checkout, not new data for the old screen. */
export function CheckoutScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>()
  const purchaseId = (Array.isArray(params.id) ? params.id[0] : params.id)?.trim() ?? ''
  return <CheckoutPurchaseScreen key={purchaseId || 'missing'} purchaseId={purchaseId} />
}
