import { normalizeCheckoutPhone } from '@arro/contracts'
import type {
  PurchaseAction,
  PurchaseConfirmRequest,
  PurchaseExecutionLevel,
  PurchasePaymentActionCreateRequest,
  PurchasePaymentActionResponse,
  PurchasePaymentActionResult,
  PurchasePaymentActionResultRequest,
  PurchasePrepareRequest,
  PurchaseReviewUpdateRequest,
  PurchaseResponse,
  PurchaseState,
  PurchaseUpdateRequest,
  StripePaymentActionSession,
  UcpCheckout,
  UcpCheckoutCreateRequest,
  UcpCheckoutUpdateRequest,
  UcpLineItemRequest,
  UcpOrder
} from '@arro/contracts'
import type { CommercePrincipal } from './commerce-principal.ts'
import {
  createCommerceDirectory,
  type CommerceDirectory
} from './commerce-directory.ts'
import {
  UcpCheckoutServiceError,
  type UcpCheckoutService
} from './ucp-checkout-service.ts'
import {
  PurchaseMandateError,
  evaluatePurchaseMandate,
  type MandateEvaluation,
  type PurchaseMandateRecord,
  type PurchaseMandateRepository
} from './purchase-mandate.ts'
import {
  checkoutDefaultsFromBuyerProfile,
  type CommerceBuyerProfileStore
} from './commerce-buyer-profile.ts'
import type { PurchaseStepUpRepository } from './purchase-step-up.ts'
import type { PaymentExecutionAuthority } from './payment-credential-vault.ts'
import { prepareUcpCheckoutActions } from './ucp-actions.ts'
import { checkoutPresentation } from './checkout-presentation.ts'

type PurchaseOrchestratorOptions = {
  service?: UcpCheckoutService
  directory?: CommerceDirectory
  mandates?: PurchaseMandateRepository
  buyerProfiles?: CommerceBuyerProfileStore
  stepUps?: PurchaseStepUpRepository
}

type PurchaseUpdateInput = PurchaseUpdateRequest & {
  id: string
  principal: CommercePrincipal
}

type PurchaseReviewUpdateInput = Omit<PurchaseReviewUpdateRequest, 'idempotencyKey'> & {
  id: string
  principal: CommercePrincipal
  idempotencyKey: string
}

type PurchaseConfirmInput = PurchaseConfirmRequest & {
  id: string
  principal: CommercePrincipal
  autonomousJobId?: string
}

type PurchasePaymentResultInput = {
  id: string
  provider?: string
  result?: PurchasePaymentActionResult
  principal: CommercePrincipal
  idempotencyKey: string
}

type PurchaseCancelInput = {
  id: string
  principal: CommercePrincipal
  reason?: string
  idempotencyKey?: string
}

type PurchaseCreateEmbeddedCheckoutSessionInput = {
  id: string
  principal: CommercePrincipal
  allowedOrigin: string
}

type PurchaseEmbeddedCheckoutMessageInput = {
  id: string
  principal: CommercePrincipal
  sessionToken: string
  origin: string
  message: unknown
}

type PurchaseCreatePaymentActionInput = PurchasePaymentActionCreateRequest & {
  id: string
  principal: CommercePrincipal
}

type PurchasePaymentActionResultInput = Omit<PurchasePaymentActionResultRequest, 'idempotencyKey'> & {
  actionToken: string
  idempotencyKey: string
}

type PurchasePrepareInput = PurchasePrepareRequest & {
  principal: CommercePrincipal
}

export type PurchaseMandateEvaluationResult = {
  purchase: PurchaseResponse
  evaluation: MandateEvaluation
  checkoutId: string
  checkoutSnapshotHash: string
  merchantOrigin: string
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : []

const stringValue = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined

const integerValue = (value: unknown) => Number.isInteger(value) ? value as number : undefined

const requireService = (service: UcpCheckoutService | undefined): UcpCheckoutService => {
  if (service) return service
  throw new UcpCheckoutServiceError(
    'ucp_runtime_store_required',
    'Purchase orchestration requires the UCP checkout runtime store.',
    503
  )
}

const checkoutFromSelectedOffer = (input: PurchasePrepareRequest): UcpCheckoutCreateRequest => {
  const selectedOffer = asRecord(input.selectedOffer)
  const itemId =
    stringValue(selectedOffer.variantId) ??
    stringValue(selectedOffer.itemId) ??
    stringValue(selectedOffer.productId)
  if (!itemId) {
    throw new UcpCheckoutServiceError(
      'ucp_invalid_request',
      'prepare_purchase requires checkout.line_items or a selectedOffer product, variant, or item ID.',
      422
    )
  }

  const quantity = integerValue(selectedOffer.quantity) ?? 1
  const title = stringValue(selectedOffer.title)
  const url = stringValue(selectedOffer.url)
  const item: UcpLineItemRequest['item'] = {
    id: itemId,
    ...(title ? { title } : {}),
    ...(url ? { url } : {})
  }

  return {
    line_items: [
      {
        item,
        quantity
      }
    ],
    ...(input.buyer ? { buyer: input.buyer } : {}),
    ...(input.fulfillment ? { fulfillment: input.fulfillment } : {}),
    ...(input.context ? { context: input.context } : {}),
    ...(input.signals ? { signals: input.signals } : {}),
    ...(input.attribution ? { attribution: input.attribution } : {})
  }
}

const checkoutFromPrepareInput = (input: PurchasePrepareRequest): UcpCheckoutCreateRequest => {
  if (!input.checkout) return checkoutFromSelectedOffer(input)

  // `checkout` owns the line items; the top-level fields are the convenience
  // inputs shared by single-offer and multi-line callers. Do not silently drop
  // the shopper's contact, locale, fulfillment, or attribution on cart buys.
  return {
    ...input.checkout,
    ...(input.buyer ? { buyer: input.buyer } : {}),
    ...(input.fulfillment ? { fulfillment: input.fulfillment } : {}),
    ...(input.context ? { context: input.context } : {}),
    ...(input.signals ? { signals: input.signals } : {}),
    ...(input.attribution ? { attribution: input.attribution } : {})
  }
}

const transactionIdFromResponse = (response: unknown) =>
  stringValue(asRecord(response).transactionId) ??
  stringValue(asRecord(asRecord(response).session).transactionId)

const checkoutFromResponse = (response: unknown) => asRecord(asRecord(response).checkout)

const cartFromResponse = (response: unknown) => asRecord(asRecord(response).cart)

const sessionFromResponse = (response: unknown) => asRecord(asRecord(response).session)

const primaryActionFromResponse = (response: unknown) => asRecord(asRecord(response).primaryAction)

const paymentActionFromResponse = (response: unknown) => asRecord(asRecord(response).paymentAction)

const reviewConflict = (message: string, details?: unknown): never => {
  throw new UcpCheckoutServiceError(
    'ucp_checkout_confirmation_mismatch',
    message,
    409,
    details
  )
}

const checkoutUpdateLineItems = (checkout: Record<string, unknown>): UcpCheckoutUpdateRequest['line_items'] =>
  asArray(checkout.line_items).map((entry, index) => {
    const lineItem = asRecord(entry)
    const item = asRecord(lineItem.item)
    const id = stringValue(lineItem.id)
    const itemId = stringValue(item.id)
    const quantity = integerValue(lineItem.quantity)
    if (!id || !itemId || quantity === undefined || quantity < 1) {
      return reviewConflict(
        'The merchant Checkout no longer contains request-applicable line-item identity and quantity. Refresh or continue with the merchant.',
        { path: `$.line_items[${index}]` }
      )
    }
    const quantityUnit = isRecord(item.quantity_unit) ? item.quantity_unit : undefined
    const parentId = stringValue(lineItem.parent_id)
    return {
      id,
      item: {
        id: itemId,
        ...(quantityUnit ? { quantity_unit: quantityUnit } : {})
      },
      quantity,
      ...(parentId ? { parent_id: parentId } : {})
    }
  })

const copyStringFields = (
  source: Record<string, unknown>,
  fields: readonly string[]
): Record<string, string> => {
  const projected: Record<string, string> = {}
  for (const field of fields) {
    const value = stringValue(source[field])
    if (value) projected[field] = value
  }
  return projected
}

const buyerFields = ['email', 'first_name', 'last_name', 'phone_number'] as const

const reviewPhone = (value: string) => {
  try {
    return normalizeCheckoutPhone(value)
  } catch (error) {
    throw new UcpCheckoutServiceError('ucp_review_rejected', (error as Error).message, 422)
  }
}

const reviewBuyer = (
  checkout: Record<string, unknown>,
  requested: PurchaseReviewUpdateRequest['buyer']
) => {
  const current = copyStringFields(asRecord(checkout.buyer), buyerFields)
  if (requested === undefined) return Object.keys(current).length > 0 ? current : undefined
  const patch = asRecord(requested)
  for (const field of buyerFields) {
    if (Object.hasOwn(patch, field) && typeof patch[field] === 'string') {
      const value = field === 'phone_number'
        ? reviewPhone(patch[field])
        : patch[field].trim()
      if (value) current[field] = value
      else delete current[field]
    }
  }
  return Object.keys(current).length > 0 ? current : undefined
}

const shippingDestinationFields = [
  'id',
  'extended_address',
  'street_address',
  'address_locality',
  'address_region',
  'address_country',
  'postal_code',
  'first_name',
  'last_name',
  'phone_number'
] as const

const shippingDestination = (value: unknown) => {
  const destination = asRecord(value)
  const type = stringValue(destination.type)
  if (type && type !== 'shipping_address') return undefined
  const projected: Record<string, unknown> = copyStringFields(destination, shippingDestinationFields)
  if (type === 'shipping_address') projected.type = type
  return Object.keys(projected).length > 0 ? projected : undefined
}

const mergeShippingDestination = (
  existing: Record<string, unknown> | undefined,
  patch: Record<string, unknown>
) => {
  const merged: Record<string, unknown> = existing ? { ...existing } : {}
  const id = stringValue(patch.id)
  if (id) merged.id = id
  if (patch.type === 'shipping_address') merged.type = 'shipping_address'
  for (const field of shippingDestinationFields) {
    if (field === 'id' || !Object.hasOwn(patch, field) || typeof patch[field] !== 'string') continue
    const value = field === 'phone_number' ? reviewPhone(patch[field]) : patch[field].trim()
    if (value) merged[field] = value
    else delete merged[field]
  }
  return merged
}

const uniqueById = (
  values: Array<Record<string, unknown>>,
  label: string
) => {
  const byId = new Map<string, Record<string, unknown>>()
  for (const value of values) {
    const id = stringValue(value.id)
    if (!id) continue
    if (byId.has(id)) {
      throw new UcpCheckoutServiceError(
        'ucp_invalid_request',
        `${label} contains duplicate ID ${id}.`,
        422,
        { id }
      )
    }
    byId.set(id, value)
  }
  return byId
}

const mergeShippingDestinations = (
  currentMethod: Record<string, unknown>,
  requestedMethod: Record<string, unknown>
) => {
  const current = asArray(currentMethod.destinations)
    .flatMap((entry) => {
      const projected = shippingDestination(entry)
      return projected ? [projected] : []
    })
  if (!Object.hasOwn(requestedMethod, 'destinations')) return current

  const currentById = uniqueById(current, 'Merchant shipping destinations')
  const requestedRaw = asArray(requestedMethod.destinations).map(asRecord)
  uniqueById(requestedRaw, 'Shipping destinations')
  const merged = [...current]
  for (const patch of requestedRaw) {
    const type = stringValue(patch.type)
    if (type && type !== 'shipping_address') {
      throw new UcpCheckoutServiceError(
        'ucp_invalid_request',
        'Shipping methods accept only shipping-address destination facts.',
        422
      )
    }
    const id = stringValue(patch.id)
    const existing = id ? currentById.get(id) : undefined
    const next = mergeShippingDestination(existing, patch)
    const hasAddressFacts = Object.keys(next).some((field) => field !== 'id' && field !== 'type')
    if (!hasAddressFacts && !id) {
      throw new UcpCheckoutServiceError(
        'ucp_invalid_request',
        'A new shipping destination needs a business-scoped destination ID or at least one address/contact field.',
        422,
        id ? { destinationId: id } : undefined
      )
    }
    if (!existing) {
      merged.push(next)
      continue
    }
    const index = merged.indexOf(existing)
    merged[index] = next
  }
  return merged
}

// A shipping destination can be submitted before a merchant has issued a
// method ID. This is an input preference, not a claim that shipping is available.
const canAddShippingAddress = (checkout: Record<string, unknown>) => {
  if (asArray(asRecord(checkout.fulfillment).methods).length > 0) return false
  const capabilities = asRecord(asRecord(checkout.ucp).capabilities)
  return asArray(capabilities['dev.ucp.shopping.fulfillment']).some((entry) =>
    asArray(asRecord(asRecord(entry).config).method_combinations).some((combination) =>
      Array.isArray(combination) && combination.length === 1 && combination[0] === 'shipping'
    )
  )
}

const fulfillmentForReview = (
  checkout: Record<string, unknown>,
  requested: PurchaseReviewUpdateRequest['fulfillment']
): UcpCheckoutUpdateRequest['fulfillment'] | undefined => {
  const fulfillment = asRecord(checkout.fulfillment)
  const currentMethods = asArray(fulfillment.methods).map(asRecord)
  const requestedMethods = asArray(asRecord(requested).methods).map(asRecord)
  const requestedById = uniqueById(requestedMethods, 'Fulfillment methods')
  const currentById = uniqueById(currentMethods, 'Merchant fulfillment methods')

  const initialMethods = requestedMethods.filter((method) => !stringValue(method.id))
  if (initialMethods.length > 0) {
    if (!canAddShippingAddress(checkout) || requestedMethods.length !== 1 || initialMethods[0]?.type !== 'shipping') {
      throw new UcpCheckoutServiceError('ucp_invalid_request', 'This checkout does not accept a new shipping method.', 422)
    }
    const lineItemIds = asArray(checkout.line_items).map((line) => stringValue(asRecord(line).id))
    if (lineItemIds.length === 0 || lineItemIds.some((id) => !id)) {
      return reviewConflict('Refresh checkout before adding a delivery address.')
    }
    return { methods: [{
      type: 'shipping',
      line_item_ids: lineItemIds as string[],
      destinations: mergeShippingDestinations({}, initialMethods[0]!)
    }] }
  }

  for (const requestedId of requestedById.keys()) {
    if (!currentById.has(requestedId)) {
      throw new UcpCheckoutServiceError(
        'ucp_invalid_request',
        `Fulfillment method ${requestedId} is not part of the current merchant Checkout.`,
        422,
        { methodId: requestedId }
      )
    }
  }

  if (currentMethods.length === 0) {
    return undefined
  }

  const methods = currentMethods.map((method, methodIndex) => {
    const id = stringValue(method.id)
    const type = stringValue(method.type)
    const lineItemIds = asArray(method.line_item_ids)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
    if (!id || !type || !Array.isArray(method.line_item_ids)) {
      return reviewConflict(
        'The merchant Checkout returned fulfillment without stable method identity, type, or line-item binding.',
        { path: `$.fulfillment.methods[${methodIndex}]` }
      )
    }

    const requestedMethod = requestedById.get(id) ?? {}
    if (Object.hasOwn(requestedMethod, 'destinations') && type !== 'shipping') {
      throw new UcpCheckoutServiceError(
        'ucp_invalid_request',
        'Only shipping methods accept shopper-provided destinations. Pickup and business locations must be selected by merchant-issued destination ID.',
        422,
        { methodId: id, methodType: type }
      )
    }

    const currentGroups = asArray(method.groups).map(asRecord)
    const requestedGroups = asArray(requestedMethod.groups).map(asRecord)
    const requestedGroupsById = uniqueById(requestedGroups, `Fulfillment method ${id} groups`)
    const currentGroupsById = uniqueById(currentGroups, `Merchant fulfillment method ${id} groups`)
    for (const requestedGroupId of requestedGroupsById.keys()) {
      if (!currentGroupsById.has(requestedGroupId)) {
        throw new UcpCheckoutServiceError(
          'ucp_invalid_request',
          `Fulfillment group ${requestedGroupId} is not part of method ${id}.`,
          422,
          { methodId: id, groupId: requestedGroupId }
        )
      }
    }

    const groups = currentGroups.map((group, groupIndex) => {
      const groupId = stringValue(group.id)
      if (!groupId) {
        return reviewConflict(
          'The merchant Checkout returned a fulfillment group without stable identity.',
          { path: `$.fulfillment.methods[${methodIndex}].groups[${groupIndex}]` }
        )
      }
      const requestedGroup = requestedGroupsById.get(groupId)
      const requestedSelection = requestedGroup && Object.hasOwn(requestedGroup, 'selected_option_id')
        ? requestedGroup.selected_option_id
        : group.selected_option_id
      if (typeof requestedGroup?.selected_option_id === 'string') {
        const optionIds = new Set(
          asArray(group.options).flatMap((option) => {
            const optionId = stringValue(asRecord(option).id)
            return optionId ? [optionId] : []
          })
        )
        if (!optionIds.has(requestedGroup.selected_option_id)) {
          throw new UcpCheckoutServiceError(
            'ucp_invalid_request',
            `Fulfillment option ${requestedGroup.selected_option_id} is not part of group ${groupId}.`,
            422,
            { methodId: id, groupId, optionId: requestedGroup.selected_option_id }
          )
        }
      }
      return {
        id: groupId,
        ...(typeof requestedSelection === 'string' || requestedSelection === null
          ? { selected_option_id: requestedSelection }
          : {})
      }
    })

    const currentSelection = method.selected_destination_id
    const selectedDestinationId = Object.hasOwn(requestedMethod, 'selected_destination_id')
      ? requestedMethod.selected_destination_id
      : currentSelection
    const destinations = type === 'shipping'
      ? mergeShippingDestinations(method, requestedMethod)
      : []
    return {
      id,
      type,
      line_item_ids: lineItemIds,
      ...(typeof selectedDestinationId === 'string' || selectedDestinationId === null
        ? { selected_destination_id: selectedDestinationId }
        : {}),
      ...(destinations.length > 0 ? { destinations } : {}),
      ...(groups.length > 0 ? { groups } : {})
    }
  })

  return { methods }
}

const checkoutReviewReplacement = (
  checkout: Record<string, unknown>,
  request: PurchaseReviewUpdateRequest
): UcpCheckoutUpdateRequest => {
  const buyer = reviewBuyer(checkout, request.buyer)
  const fulfillment = fulfillmentForReview(checkout, request.fulfillment)
  const context = isRecord(checkout.context) ? checkout.context : undefined
  const signals = isRecord(checkout.signals) ? checkout.signals : undefined
  const attribution = isRecord(checkout.attribution) ? checkout.attribution : undefined
  return {
    line_items: checkoutUpdateLineItems(checkout),
    ...(buyer ? { buyer } : {}),
    ...(fulfillment ? { fulfillment } : {}),
    ...(context ? { context } : {}),
    ...(signals ? { signals } : {}),
    ...(attribution ? { attribution } : {})
  }
}

const merchantFromResponse = (response: unknown) => {
  const session = sessionFromResponse(response)
  const profileUrl = stringValue(session.merchantProfileUrl) ?? 'unknown'
  const origin = stringValue(session.merchantOrigin) ?? (() => {
    try {
      return new URL(profileUrl).origin
    } catch {
      return 'unknown'
    }
  })()

  return {
    merchantId: origin,
    canonicalOrigin: origin,
    profileUrl,
    ...(origin !== 'unknown' ? { displayName: new URL(origin).hostname } : {})
  }
}

const quantityFromLineItem = (lineItem: Record<string, unknown>) => {
  const quantity = lineItem.quantity
  if (typeof quantity === 'number') return quantity
  if (quantity && typeof quantity === 'object') return integerValue((quantity as { total?: unknown }).total)
  return undefined
}

const itemsFromCheckout = (checkout: Record<string, unknown>): PurchaseResponse['items'] =>
  asArray(checkout.line_items).map((entry) => {
    const lineItem = asRecord(entry)
    const item = asRecord(lineItem.item)
    const lineItemId = stringValue(lineItem.id)
    const itemId = stringValue(item.id) ?? 'unknown-item'
    const title = stringValue(item.title)
    const quantity = quantityFromLineItem(lineItem)
    const url = stringValue(item.url)

    return {
      ...(lineItemId ? { lineItemId } : {}),
      itemId,
      ...(title ? { title } : {}),
      ...(quantity !== undefined ? { quantity } : {}),
      ...(url ? { url } : {})
    }
  })

const cartSummaryFromResponse = (response: unknown): PurchaseResponse['cart'] | undefined => {
  const cart = cartFromResponse(response)
  const session = sessionFromResponse(response)
  const cartId = stringValue(cart.id) ?? stringValue(session.cartId)
  const status = stringValue(cart.status)
  const checkoutId = stringValue(cart.checkout_id) ?? stringValue(session.checkoutId)
  const continueUrl = stringValue(cart.continue_url)
  const snapshotHash = stringValue(session.cartSnapshotHash)
  if (!cartId && !status && !checkoutId && !continueUrl && !snapshotHash) return undefined

  return {
    ...(cartId ? { cartId } : {}),
    ...(status ? { status } : {}),
    ...(checkoutId ? { checkoutId } : {}),
    ...(continueUrl ? { continueUrl } : {}),
    ...(snapshotHash ? { snapshotHash } : {})
  }
}

const hostedAction = (response: unknown): PurchaseAction | undefined => {
  const primaryAction = primaryActionFromResponse(response)
  const action = stringValue(primaryAction.action)
  const url = stringValue(primaryAction.url)
  if (action === 'continue_on_merchant' && url) {
    return {
      type: 'continue_on_merchant',
      label: stringValue(primaryAction.label) ?? 'Continue on merchant',
      url,
      presentation: checkoutPresentation(checkoutFromResponse(response)),
      reason: 'The merchant owns payment, shipping, tax, and final checkout confirmation.'
    }
  }
  return undefined
}

const stateFromCheckout = (
  checkout: Record<string, unknown>,
  response: unknown,
  paymentHandlers: unknown,
  session: Record<string, unknown>
): {
  state: PurchaseState
  executionLevel: PurchaseExecutionLevel
  nextAction: PurchaseAction
  pendingActions?: PurchaseResponse['pendingActions']
} => {
  const status = stringValue(checkout.status)
  const cart = cartFromResponse(response)
  const cartStatus = stringValue(cart.status)
  const cartContinueUrl = stringValue(cart.continue_url)
  const orderUrl = stringValue(asRecord(checkout.order).permalink_url) ?? stringValue(session.orderPermalinkUrl)
  const orderId = stringValue(asRecord(checkout.order).id) ?? stringValue(session.orderId)
  const completedByArro = asRecord(response).paymentCompletedByArro === true
  if (orderId || orderUrl) {
    return {
      state: 'completed',
      executionLevel: completedByArro ? 'direct_payment' : 'discovery_only',
      nextAction: {
        type: 'view_order',
        label: 'View merchant order',
        ...(orderUrl ? { url: orderUrl } : {})
      }
    }
  }

  if (status === 'completed') {
    return {
      state: 'review_required',
      executionLevel: completedByArro ? 'direct_payment' : 'discovery_only',
      nextAction: {
        type: 'refresh_purchase',
        label: 'Refresh merchant order',
        reason: 'The merchant accepted completion but has not returned an Order. Arro will not claim completion until merchant Order continuity is available.'
      }
    }
  }

  if (status === 'canceled') {
    return {
      state: 'canceled',
      executionLevel: 'discovery_only',
      nextAction: {
        type: 'refresh_purchase',
        label: 'Refresh merchant checkout state',
        reason: 'The merchant checkout reports canceled. Arro does not claim refund or return state unless the merchant order reports it.'
      }
    }
  }

  const merchantOrigin = stringValue(session.merchantOrigin) ?? merchantFromResponse(response).canonicalOrigin
  const pendingActions = prepareUcpCheckoutActions({
    checkout: checkout as unknown as UcpCheckout,
    paymentHandlers,
    merchantOrigin
  })
  const executableAction = pendingActions.find((action) => action.executable)
  const hosted = hostedAction(response)
  if (pendingActions.length > 0) {
    if (executableAction) {
      const label = executableAction.presentation === 'hidden_browser'
        ? 'Run payment device verification'
        : executableAction.presentation === 'visible_browser'
          ? 'Complete payment authentication'
          : 'Complete payment in your payment app'
      return {
        state: 'payment_action_required',
        executionLevel: 'direct_payment',
        pendingActions,
        nextAction: {
          type: 'complete_ucp_action',
          label,
          ...(executableAction.url ? { url: executableAction.url } : {}),
          reason: 'This is outstanding merchant-defined work. Completing its surface does not prove payment success; refresh the merchant Checkout afterward.'
        }
      }
    }

    if (hosted) {
      return {
        state: 'merchant_continuation_required',
        executionLevel: 'hosted_checkout',
        nextAction: hosted
      }
    }

    return {
      state: 'review_required',
      executionLevel: 'direct_payment',
      pendingActions,
      nextAction: {
        type: 'refresh_purchase',
        label: 'Refresh or continue with the merchant',
        reason: pendingActions[0]?.reason ?? 'The merchant returned an Action that this Arro runtime cannot execute safely.'
      }
    }
  }

  if (status === 'complete_in_progress') {
    return {
      state: 'review_required',
      executionLevel: 'direct_payment',
      nextAction: {
        type: 'refresh_purchase',
        label: 'Check payment status',
        reason: 'The merchant is already completing this checkout. Arro will reconcile that attempt instead of requesting another payment.'
      }
    }
  }

  if (status === 'requires_escalation') {
    if (hosted) {
      return {
        state: 'merchant_continuation_required',
        executionLevel: 'hosted_checkout',
        pendingActions,
        nextAction: hosted
      }
    }
    return {
      state: 'review_required',
      executionLevel: 'hosted_checkout',
      nextAction: {
        type: 'refresh_purchase',
        label: 'Refresh merchant checkout',
        reason: 'The merchant requires an external continuation but did not return a usable destination.'
      }
    }
  }

  if (status === 'incomplete') {
    return {
      state: 'review_required',
      executionLevel: 'direct_payment',
      nextAction: {
        type: 'review_purchase',
        label: 'Complete checkout details',
        reason: 'The merchant still needs buyer or fulfillment details before payment can begin.'
      }
    }
  }

  const supportedHandlers = asArray(asRecord(paymentHandlers).paymentHandlers)
    .map(asRecord)
    .filter((handler) => handler.supported === true)
  const directHandler = supportedHandlers.find((handler) => stringValue(handler.executionMode) !== 'merchant_hosted')
  if (status === 'ready_for_complete' && directHandler) {
    const handlerName = stringValue(directHandler.handlerName)
    const portable = handlerName === 'dev.arro.payment.x402' || handlerName === 'dev.arro.payment.mpp'
    return {
      state: 'payment_action_required',
      executionLevel: 'direct_payment',
      nextAction: {
        type: 'provide_payment',
        label: portable ? `Pay with ${handlerName!.endsWith('x402') ? 'x402' : 'MPP'}` : 'Approve payment with provider',
        reason: portable
          ? 'The merchant Checkout accepts a payment protocol the agent can execute without browser handoff.'
          : 'Arro can continue after the provider returns a checkout-scoped payment instrument.'
      }
    }
  }

  if (status === 'ready_for_complete' && hosted) {
    return {
      state: 'merchant_continuation_required',
      executionLevel: 'hosted_checkout',
      nextAction: hosted
    }
  }

  if (cartStatus && cartStatus !== 'canceled' && cartContinueUrl) {
    return {
      state: 'merchant_continuation_required',
      executionLevel: 'cart_permalink',
      nextAction: {
        type: 'review_cart',
        label: 'Review merchant cart',
        url: cartContinueUrl,
        reason: 'The merchant cart is prepared. Continue on the merchant surface to verify shipping, tax, final price, and payment before purchase.'
      }
    }
  }

  if (status === 'ready_for_complete') {
    return {
      state: 'review_required',
      executionLevel: 'direct_payment',
      nextAction: {
        type: 'confirm_purchase',
        label: 'Review and confirm purchase',
        reason: 'The merchant checkout is ready, but Arro still needs explicit buyer approval and payment instrument proof.'
      }
    }
  }

  return {
    state: status === 'canceled' ? 'canceled' : 'review_required',
    executionLevel: 'discovery_only',
    nextAction: {
      type: 'refresh_purchase',
      label: 'Refresh merchant checkout state',
      reason: 'The merchant did not provide direct payment, hosted checkout, cart, or product continuation in this response.'
    }
  }
}

const boundedString = (value: unknown, maxLength: number) => {
  const text = stringValue(value)
  return text ? text.slice(0, maxLength) : undefined
}

const purchaseMessagesFromCheckout = (
  checkout: Record<string, unknown>
): PurchaseResponse['messages'] =>
  asArray(checkout.messages).flatMap((entry) => {
    const message = asRecord(entry)
    const text = boundedString(message.content, 2_000)
    if (!text) return []
    const type = stringValue(message.type)
    const severity: PurchaseResponse['messages'][number]['severity'] = type === 'info'
      ? 'info'
      : type === 'error' && message.severity === 'unrecoverable'
        ? 'blocked'
        : 'warning'
    const code = boundedString(message.code, 256)
    const path = boundedString(message.path, 512)
    const presentation = boundedString(message.presentation, 80)
    const url = boundedString(message.url, 2_048)
    const resolution = boundedString(message.severity, 80)
    const contentType = boundedString(message.content_type, 80)
    const imageUrl = boundedString(message.image_url, 2_048)
    return [{
      severity,
      text,
      ...(code ? { code } : {}),
      ...(path ? { path } : {}),
      ...(resolution && ['recoverable', 'requires_buyer_input', 'requires_buyer_review', 'unrecoverable'].includes(resolution)
        ? { resolution: resolution as 'recoverable' | 'requires_buyer_input' | 'requires_buyer_review' | 'unrecoverable' }
        : {}),
      ...(contentType === 'plain' || contentType === 'markdown' ? { contentType } : {}),
      ...(presentation ? { presentation } : {}),
      ...(url ? { url } : {}),
      ...(imageUrl ? { imageUrl } : {})
    }]
  })

const linksFromCheckout = (checkout: Record<string, unknown>): PurchaseResponse['links'] =>
  asArray(checkout.links).flatMap((entry) => {
    const link = asRecord(entry)
    const type = stringValue(link.type)
    const url = stringValue(link.url)
    if (!type || !url) return []
    const title = stringValue(link.title)
    return [{ type, url, ...(title ? { title } : {}) }]
  })

const toPurchaseResponse = (
  response: unknown,
  paymentHandlers?: unknown,
  extraMessages: PurchaseResponse['messages'] = []
): PurchaseResponse => {
  const checkout = checkoutFromResponse(response)
  const session = sessionFromResponse(response)
  const mapped = stateFromCheckout(checkout, response, paymentHandlers, session)
  const paymentCompletedByArro = mapped.state === 'completed' && asRecord(response).paymentCompletedByArro === true
  const purchaseId = transactionIdFromResponse(response) ?? 'unknown-purchase'
  const selectedPaymentHandlerId = stringValue(session.selectedPaymentHandlerId)
  const paymentAction = paymentActionFromResponse(response)
  const checkoutStatus = stringValue(checkout.status)
  const checkoutSnapshotHash = stringValue(session.checkoutSnapshotHash)
  const cart = cartSummaryFromResponse(response)
  const buyer = isRecord(checkout.buyer)
    ? checkout.buyer as NonNullable<PurchaseResponse['buyer']>
    : undefined
  const links = linksFromCheckout(checkout)
  const policies = Array.isArray(checkout.policies)
    ? checkout.policies as NonNullable<PurchaseResponse['policies']>
    : undefined
  const merchantMessages = purchaseMessagesFromCheckout(checkout)
  const merchantErrorMessages = purchaseMessagesFromCheckout(
    asRecord(asRecord(response).ucpError)
  )
  // UCP declares the currency once on the Checkout and lets each money amount
  // omit it. Passing the totals through untouched leaves a consumer holding
  // integers in unknown minor units, which cannot be formatted and cannot even
  // be given a decimal point — the exponent is a property of the currency. The
  // currency is filled in from the same checkout object, never inferred.
  const checkoutCurrency = stringValue(checkout.currency)
  const totals = Array.isArray(checkout.totals)
    ? (checkoutCurrency
        ? checkout.totals.map((entry) => {
            const amount = asRecord(entry)
            return stringValue(amount.currency) ? entry : { ...amount, currency: checkoutCurrency }
          })
        : checkout.totals) as NonNullable<PurchaseResponse['totals']>
    : undefined
  const fulfillment = checkout.fulfillment && typeof checkout.fulfillment === 'object'
    ? checkout.fulfillment as NonNullable<PurchaseResponse['fulfillment']>
    : undefined
  const payment: NonNullable<PurchaseResponse['payment']> = {
    completedByArro: paymentCompletedByArro,
    executionLevel: mapped.executionLevel
  }
  const acceptedCapabilities = asArray(asRecord(paymentHandlers).paymentHandlers)
    .map(asRecord)
    .filter((handler) => handler.supported === true && stringValue(handler.executionMode) !== 'merchant_hosted')
    .flatMap((handler) => {
      const handlerName = stringValue(handler.handlerName)
      const declaration = asRecord(handler.declaration)
      const config = asRecord(declaration.config)
      if (!handlerName) return []
      const protocol = handlerName === 'dev.arro.payment.x402'
        ? 'x402'
        : handlerName === 'dev.arro.payment.mpp'
          ? 'mpp'
          : handlerName
      return [{
        protocol,
        ...(stringValue(config.protocol_version) ? { version: stringValue(config.protocol_version)! } : {}),
        ...(asArray(config.methods ?? config.schemes).length > 0 ? { methods: asArray(config.methods ?? config.schemes).filter((value): value is string => typeof value === 'string') } : {}),
        ...(asArray(config.intents).length > 0 ? { intents: asArray(config.intents).filter((value): value is string => typeof value === 'string') } : {}),
        ...(asArray(config.networks).length > 0 ? { networks: asArray(config.networks).filter((value): value is string => typeof value === 'string') } : {}),
        ...(asArray(config.assets).length > 0 ? { assets: asArray(config.assets).filter((value): value is string => typeof value === 'string') } : {}),
        autonomous: protocol === 'x402' || protocol === 'mpp'
      }]
    })
  if (acceptedCapabilities.length > 0) payment.acceptedCapabilities = acceptedCapabilities
  if (selectedPaymentHandlerId) {
    payment.selectedHandlerId = selectedPaymentHandlerId
  }
  const paymentActionId = stringValue(paymentAction.actionId)
  const paymentActionStatus = stringValue(paymentAction.status)
  const paymentActionProvider = stringValue(paymentAction.provider)
  const paymentActionCapabilityId = stringValue(paymentAction.capabilityId)
  if (paymentActionId) {
    payment.actionId = paymentActionId
  }
  if (paymentActionStatus) {
    payment.actionStatus = paymentActionStatus
  }
  if (paymentActionProvider) {
    payment.provider = paymentActionProvider
  }
  if (paymentActionCapabilityId) {
    payment.capabilityId = paymentActionCapabilityId
  }

  return {
    purchaseId,
    state: mapped.state,
    executionLevel: mapped.executionLevel,
    merchant: merchantFromResponse(response),
    items: itemsFromCheckout(checkout),
    ...(checkoutCurrency ? { currency: checkoutCurrency } : {}),
    ...(buyer ? { buyer } : {}),
    ...(totals ? { totals } : {}),
    ...(fulfillment ? { fulfillment } : {}),
    links,
    canAddShippingAddress: canAddShippingAddress(checkout),
    ...(policies ? { policies } : {}),
    payment,
    ...(cart ? { cart } : {}),
    ...(checkoutStatus ? { checkoutStatus: checkoutStatus as NonNullable<PurchaseResponse['checkoutStatus']> } : {}),
    ...(checkoutSnapshotHash ? { checkoutSnapshotHash } : {}),
    ...(mapped.pendingActions?.length ? { pendingActions: mapped.pendingActions } : {}),
    messages: [
      ...merchantMessages,
      ...merchantErrorMessages,
      ...(checkoutStatus === 'completed' && mapped.state !== 'completed' ? [{
        severity: 'info' as const,
        code: 'order_confirmation_pending',
        text: 'The shop is confirming your order. Check its status before trying to pay again.'
      }] : []),
      ...extraMessages
    ],
    nextAction: mapped.nextAction,
    rawUcpTransactionId: purchaseId
  }
}

const completeCheckoutPayloadForAuthority = ({
  instrument,
  ap2CheckoutMandate
}: PaymentExecutionAuthority) => {
  return {
    payment: {
      instruments: [instrument]
    },
    ...(ap2CheckoutMandate
      ? {
          ap2: {
            checkout_mandate: ap2CheckoutMandate
          }
        }
      : {})
  }
}

const orderIdFromResponse = (response: unknown) =>
  stringValue(asRecord(checkoutFromResponse(response).order).id)

const totalMinorFromOrder = (order: UcpOrder | undefined) => {
  const total = order?.totals.find((entry) => entry.type === 'total')?.amount
  return typeof total === 'number' && Number.isSafeInteger(total) && total >= 0
    ? String(total)
    : undefined
}

const ap2AuthorityForMandate = (record: PurchaseMandateRecord | undefined) => {
  if (record?.mandate.authorization?.mode !== 'ap2_trusted_surface') return undefined
  const [expectedOpenCheckoutReference, expectedOpenPaymentReference, ...extra] =
    (record.mandate.authorization.externalReference ?? '').split(':')
  if (!expectedOpenCheckoutReference || !expectedOpenPaymentReference || extra.length > 0) {
    throw new UcpCheckoutServiceError(
      'ucp_invalid_request',
      'AP2 autonomous completion requires the exact open Checkout and Payment Mandate references recorded during standing authorization.',
      409
    )
  }
  return {
    canonicalMandateId: record.mandate.mandateId,
    canonicalMandateVersion: record.mandate.version,
    expectedOpenCheckoutReference,
    expectedOpenPaymentReference,
    totalAmountMinor: (BigInt(record.totalCommittedMinor) + BigInt(record.totalReservedMinor)).toString(),
    totalUses: record.useCount
  }
}

export const createPurchaseOrchestrator = ({ service, directory = createCommerceDirectory(), mandates, buyerProfiles, stepUps }: PurchaseOrchestratorOptions) => {
  const runtime = requireService(service)

  const evaluateMandateForPurchase = async ({
    id,
    principal,
    mandateId
  }: {
    id: string
    principal: CommercePrincipal
    mandateId: string
  }): Promise<PurchaseMandateEvaluationResult> => {
    if (!mandates) {
      throw new UcpCheckoutServiceError(
        'ucp_runtime_store_required',
        'Purchase mandate evaluation requires mandate persistence.',
        503
      )
    }
    const mandateRecord = await mandates.read(mandateId, principal)
    if (!mandateRecord) {
      throw new UcpCheckoutServiceError(
        'ucp_invalid_request',
        'The supplied purchase mandate was not found for this principal.',
        404
      )
    }
    const currentResponse = await runtime.getCheckout(id, principal)
    const currentCheckout = checkoutFromResponse(currentResponse) as unknown as NonNullable<Parameters<typeof evaluatePurchaseMandate>[0]['checkout']>
    const currentSession = sessionFromResponse(currentResponse)
    const merchantOrigin = stringValue(currentSession.merchantOrigin) ?? merchantFromResponse(currentResponse).canonicalOrigin
    const checkoutSnapshotHash = stringValue(currentSession.checkoutSnapshotHash) ?? stringValue((currentResponse as { checkoutSnapshotHash?: unknown }).checkoutSnapshotHash)
    if (!checkoutSnapshotHash) {
      throw new UcpCheckoutServiceError(
        'ucp_invalid_request',
        'Purchase mandate evaluation requires a current checkout snapshot hash.',
        409
      )
    }
    const evaluation = evaluatePurchaseMandate({
      mandate: mandateRecord.mandate,
      checkout: currentCheckout,
      merchantOrigin,
      checkoutSnapshotHash
    })
    const paymentHandlers = await runtime.listPaymentHandlers(id, principal).catch(() => undefined)
    return {
      purchase: toPurchaseResponse(currentResponse, paymentHandlers),
      evaluation,
      checkoutId: currentCheckout.id,
      checkoutSnapshotHash,
      merchantOrigin
    }
  }

  return {
    async preparePurchase(input: PurchasePrepareInput) {
      const merchant = await directory.refreshForTransaction(input).catch((error) => {
        throw new UcpCheckoutServiceError(
          'ucp_invalid_request',
          error instanceof Error && error.message === 'commerce_directory_merchant_unresolved'
            ? 'prepare_purchase requires a merchant profile, merchant domain, seller identity, product URL, or checkout URL that resolves to a merchant.'
            : 'prepare_purchase merchant identity could not be resolved safely.',
          422
        )
      })
      const checkout = checkoutDefaultsFromBuyerProfile(
        await buyerProfiles?.read(input.principal),
        checkoutFromPrepareInput(input)
      )
      const response = await runtime.createCheckout({
        merchantProfileUrl: merchant.profileUrl,
        ...(merchant.businessProfile ? { businessProfile: merchant.businessProfile } : {}),
        principal: input.principal,
        idempotencyKey: input.idempotencyKey ?? '',
        cart: checkout,
        checkout
      })
      const purchaseId = transactionIdFromResponse(response)
      const paymentHandlers = purchaseId
        ? await runtime.listPaymentHandlers(purchaseId, input.principal).catch(() => undefined)
        : undefined
      return toPurchaseResponse(response, paymentHandlers)
    },

    async getPurchase(purchaseId: string, principal: CommercePrincipal) {
      const response = await runtime.getCheckout(purchaseId, principal)
      const paymentHandlers = await runtime.listPaymentHandlers(purchaseId, principal).catch(() => undefined)
      return toPurchaseResponse(response, paymentHandlers)
    },

    async updatePurchase(input: PurchaseUpdateInput) {
      const response = await runtime.updateCheckout(input.id, {
        checkout: input.checkout,
        principal: input.principal,
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
      })
      const paymentHandlers = await runtime.listPaymentHandlers(input.id, input.principal).catch(() => undefined)
      return toPurchaseResponse(response, paymentHandlers, [
        {
          severity: 'info',
          text: 'Purchase review changed. Any prior human confirmation is no longer enough for completion if merchant state materially changed.'
        }
      ])
    },

    async updatePurchaseReview(input: PurchaseReviewUpdateInput) {
      const currentResponse = await runtime.getCheckout(input.id, input.principal)
      const checkout = checkoutFromResponse(currentResponse)
      const status = stringValue(checkout.status)
      if (status === 'complete_in_progress') {
        throw new UcpCheckoutServiceError(
          'ucp_checkout_completion_in_progress',
          'Checkout completion is already in progress. Refresh the purchase instead of changing its review.',
          409,
          { checkoutStatus: status, permittedOperation: 'get_checkout' }
        )
      }
      if (status === 'completed' || status === 'canceled') {
        throw new UcpCheckoutServiceError(
          'ucp_invalid_request',
          `A ${status} Checkout cannot be changed.`,
          409,
          { checkoutStatus: status }
        )
      }

      const replacement = checkoutReviewReplacement(checkout, input)
      const response = await runtime.updateCheckout(input.id, {
        checkout: replacement,
        principal: input.principal,
        idempotencyKey: input.idempotencyKey,
        idempotencyFingerprint: {
          checkoutSnapshotHash: input.checkoutSnapshotHash,
          ...(input.buyer ? { buyer: input.buyer } : {}),
          ...(input.fulfillment ? { fulfillment: input.fulfillment } : {}),
          ...(input.agentContext ? { agentContext: input.agentContext } : {})
        },
        expectedCheckoutSnapshotHash: input.checkoutSnapshotHash
      })
      const paymentHandlers = await runtime.listPaymentHandlers(input.id, input.principal).catch(() => undefined)
      const merchantRejected = Boolean(asRecord(response).ucpError)
      if (merchantRejected) {
        const messages = purchaseMessagesFromCheckout(asRecord(asRecord(response).ucpError))
        throw new UcpCheckoutServiceError(
          'ucp_review_rejected',
          messages.map((message) => message.text).join(' ').slice(0, 640) || 'The shop could not save these checkout details.',
          422
        )
      }
      return toPurchaseResponse(response, paymentHandlers)
    },

    async evaluateMandate(input: { id: string; principal: CommercePrincipal; mandateId: string }) {
      return evaluateMandateForPurchase(input)
    },

    async confirmPurchase(input: PurchaseConfirmInput) {
      const refreshed = await runtime.getCheckout(input.id, input.principal)
      const refreshedPaymentHandlers = await runtime.listPaymentHandlers(input.id, input.principal).catch(() => undefined)
      const refreshedPurchase = toPurchaseResponse(refreshed, refreshedPaymentHandlers)
      if (refreshedPurchase.state === 'completed') return refreshedPurchase

      if (!input.idempotencyKey) {
        throw new UcpCheckoutServiceError(
          'ucp_idempotency_key_required',
          'Confirming a purchase requires a stable idempotency key.',
          422
        )
      }

      const mandateRepository = mandates
      const mandateId = input.mandateId
      if (!mandateId && !input.checkoutSnapshotHash) {
        throw new UcpCheckoutServiceError(
          'ucp_invalid_request',
          'Human confirmation requires the exact checkoutSnapshotHash the buyer reviewed.',
          422
        )
      }
      if (mandateId && !mandateRepository) {
        throw new UcpCheckoutServiceError(
          'ucp_runtime_store_required',
          'Autonomous mandate confirmation requires purchase mandate persistence.',
          503
        )
      }
      const mandateRecord = mandateId && mandateRepository
        ? await mandateRepository.read(mandateId, input.principal)
        : undefined
      if (mandateId && !mandateRecord) {
        throw new UcpCheckoutServiceError(
          'ucp_invalid_request',
          'The supplied purchase mandate was not found for this principal.',
          404
        )
      }

      let reservationId: string | undefined
      let computedApprovalRef = input.approvalRef
      let computedCheckoutSnapshotHash = input.checkoutSnapshotHash
      if (mandateRecord) {
        const evaluated = await evaluateMandateForPurchase({
          id: input.id,
          principal: input.principal,
          mandateId: mandateRecord.mandate.mandateId
        })
        computedCheckoutSnapshotHash = evaluated.checkoutSnapshotHash
        const evaluation = evaluated.evaluation
        const approvedStepUp = evaluation.decision === 'step_up' && input.autonomousJobId && stepUps
          ? await stepUps.consumeApproved({
              jobId: input.autonomousJobId,
              purchaseId: input.id,
              mandateId: mandateRecord.mandate.mandateId,
              mandateVersion: mandateRecord.mandate.version,
              checkoutSnapshotHash: evaluated.checkoutSnapshotHash
            })
          : undefined
        if (evaluation.decision !== 'pass' && !approvedStepUp) {
          throw new UcpCheckoutServiceError(
            'ucp_checkout_confirmation_required',
            'The active mandate does not authorize the current merchant checkout without step-up.',
            403,
            evaluation
          )
        }
        try {
          reservationId = await mandateRepository!.reserve({
            mandate: mandateRecord.mandate,
            principal: input.principal,
            transactionId: input.id,
            evaluation
          })
        } catch (error) {
          if (error instanceof PurchaseMandateError) {
            throw new UcpCheckoutServiceError(
              'ucp_checkout_confirmation_required',
              error.message,
              409,
              { code: error.code, details: error.details }
            )
          }
          throw error
        }
        computedApprovalRef = approvedStepUp
          ? `step-up:${approvedStepUp.actionId}:${approvedStepUp.decisionRef ?? 'verified'}`
          : `mandate:${mandateRecord.mandate.mandateId}:v${mandateRecord.mandate.version}:${mandateRecord.mandate.authorization?.authorizationHash ?? 'missing_authorization'}`
      }

      if (!computedApprovalRef) {
        throw new UcpCheckoutServiceError(
          'ucp_invalid_request',
          'confirm_purchase requires approvalRef unless an active purchase mandate is supplied.',
          422
        )
      }

      await runtime.confirmCheckout(input.id, {
        approvalRef: computedApprovalRef,
        principal: input.principal,
        checkoutSnapshotHash: computedCheckoutSnapshotHash!,
        ...(input.approvedAt ? { approvedAt: input.approvedAt } : {})
      })

      let paymentAuthority: PaymentExecutionAuthority | undefined
      try {
        paymentAuthority = await runtime.readLatestPaymentExecutionAuthority(input.id, input.principal)
      } catch (error) {
        if (reservationId && mandateRepository) await mandateRepository.release(reservationId)
        throw error
      }

      if (paymentAuthority) {
        let response: unknown
        const completionOperationId = `${input.id}:${input.idempotencyKey}:${computedCheckoutSnapshotHash ?? 'no-snapshot'}`
        const ap2Authority = ap2AuthorityForMandate(mandateRecord)
        try {
          if (reservationId && mandateRepository) {
            await mandateRepository.markExecutionInProgress({
              reservationId,
              completionOperationId
            })
          }
          response = await runtime.completeCheckout(input.id, {
            idempotencyKey: input.idempotencyKey,
            principal: input.principal,
            checkout: completeCheckoutPayloadForAuthority(paymentAuthority),
            ...(ap2Authority ? { ap2Authority } : {})
          })
        } catch (error) {
          if (reservationId && mandateRepository) {
            await mandateRepository.markReconciliationRequired({
              reservationId,
              failureEvidence: {
                stage: 'complete_checkout',
                reason: error instanceof Error ? error.message : 'unknown completion failure'
              }
            })
          }
          throw error
        }
        if (reservationId && mandateRepository) {
          const orderId = orderIdFromResponse(response)
          const order = orderId ? await runtime.getOrder(orderId, input.id, input.principal).then((result) => result.order as UcpOrder).catch(() => undefined) : undefined
          if (order) {
            const actualAmountMinor = totalMinorFromOrder(order)
            await mandateRepository.commit({
              reservationId,
              order,
              ...(actualAmountMinor ? { actualAmountMinor } : {})
            })
          } else {
            await mandateRepository.markReconciliationRequired({
              reservationId,
              failureEvidence: {
                stage: 'get_order',
                reason: 'merchant order was not immediately available after completion'
              }
            })
          }
        }
        const paymentHandlers = await runtime.listPaymentHandlers(input.id, input.principal).catch(() => undefined)
        return toPurchaseResponse(response, paymentHandlers)
      }

      if (reservationId && mandateRepository) await mandateRepository.release(reservationId)
      const response = await runtime.getCheckout(input.id, input.principal)
      const paymentHandlers = await runtime.listPaymentHandlers(input.id, input.principal).catch(() => undefined)
      return toPurchaseResponse(response, paymentHandlers, [
        {
          severity: 'warning',
          text: 'Human approval is recorded. Direct completion still needs a tokenized UCP payment instrument or a merchant-hosted continuation.'
        }
      ])
    },

    async recordPaymentResult(input: PurchasePaymentResultInput) {
      const response = await runtime.recordPaymentResult(input.id, {
        principal: input.principal,
        idempotencyKey: input.idempotencyKey,
        ...(input.provider ? { provider: input.provider } : {}),
        ...(input.result !== undefined ? { result: input.result } : {})
      })
      const paymentHandlers = await runtime.listPaymentHandlers(input.id, input.principal).catch(() => undefined)
      return toPurchaseResponse(response, paymentHandlers, [
        {
          severity: 'info',
          text: 'Provider returned a tokenized payment instrument. Arro can complete only after current checkout confirmation and merchant UCP completion gates pass.'
        }
      ])
    },

    async createPaymentAction(input: PurchaseCreatePaymentActionInput): Promise<PurchasePaymentActionResponse> {
      return runtime.createPaymentAction(input.id, {
        principal: input.principal,
        ...(input.portableCapabilities ? { portableCapabilities: input.portableCapabilities } : {}),
        ...(input.clientCapabilities ? { clientCapabilities: input.clientCapabilities } : {}),
        ...(input.preference ? { preference: input.preference } : {}),
        ...(input.executionDownscope ? { executionDownscope: input.executionDownscope } : {}),
        ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
      })
    },

    async getPaymentAction(actionToken: string): Promise<PurchasePaymentActionResponse> {
      return runtime.getPaymentAction(actionToken)
    },

    async createPaymentActionSession(actionToken: string): Promise<StripePaymentActionSession> {
      return runtime.createPaymentActionSession({ actionToken })
    },

    async recordPaymentActionResult(input: PurchasePaymentActionResultInput) {
      const response = await runtime.recordPaymentActionResult({
        actionToken: input.actionToken,
        result: input.result,
        idempotencyKey: input.idempotencyKey
      })
      return toPurchaseResponse(response, undefined, [
        {
          severity: 'info',
          text: 'Payment action was approved and exchanged into a checkout-scoped credential. Confirm the current merchant checkout to complete.'
        }
      ])
    },

    async createEmbeddedCheckoutSession(input: PurchaseCreateEmbeddedCheckoutSessionInput) {
      return runtime.createEmbeddedCheckoutSession(input.id, {
        principal: input.principal,
        allowedOrigin: input.allowedOrigin
      })
    },

    async handleEmbeddedCheckoutMessage(input: PurchaseEmbeddedCheckoutMessageInput) {
      return runtime.handleEmbeddedCheckoutMessage({
        principal: input.principal,
        transactionId: input.id,
        sessionToken: input.sessionToken,
        origin: input.origin,
        message: input.message
      })
    },

    async cancelPurchase(input: PurchaseCancelInput) {
      const response = await runtime.cancelCheckout(input.id, {
        principal: input.principal,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
      })
      return toPurchaseResponse(response, undefined, [
        {
          severity: 'info',
          text: 'Cancel state is merchant-authoritative. Arro does not claim refund or return state unless the merchant order reports it.'
        }
      ])
    }
  }
}

export type PurchaseOrchestrator = ReturnType<typeof createPurchaseOrchestrator>
