import { createHash, randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import type { UcpCheckout, UcpOrder } from '@arro/contracts'
import type { CommercePrincipal } from './commerce-principal.ts'
import { stableJsonStringify } from './stable-json.ts'
import type { Queryable } from './target-business-repository.ts'

export const purchaseMandateAuthorizationActionPrefix = 'arro_ma_'

export type MinorUnitAmount = string

export type PurchaseMandateStatus =
  | 'draft'
  | 'pending_authorization'
  | 'active'
  | 'suspended'
  | 'revoked'
  | 'expired'
  | 'exhausted'

export type PurchaseMandate = {
  mandateId: string
  ownerId: string
  integrationId: string
  version: number
  status: PurchaseMandateStatus
  authorizationProvider:
    | 'user_approval_action'
    | 'passkey_webauthn'
    | 'ap2_trusted_surface'
    | 'trusted_host_signature'
  intent: {
    description: string
    productIds?: string[]
    productQueries?: string[]
    categories?: string[]
    requiredAttributes?: Record<string, string | string[]>
    prohibitedAttributes?: Record<string, string | string[]>
    allowedVariants?: string[]
    intendedQuantity?: number
    quantityMaximum?: number
    substitutionPolicy: 'forbidden' | 'equivalent_only' | 'within_constraints'
  }
  merchantPolicy: {
    allowedMerchantOrigins?: string[]
    deniedMerchantOrigins?: string[]
    allowedCountries?: string[]
    authorizedSellerRequired?: boolean
  }
  financialPolicy: {
    currency: string
    maximumPerTransactionMinor: MinorUnitAmount
    maximumTotalSpendMinor: MinorUnitAmount
    maximumTaxMinor?: MinorUnitAmount
    maximumShippingMinor?: MinorUnitAmount
    maximumFeesMinor?: MinorUnitAmount
    useLimit: number
    frequencyLimit?: {
      count: number
      windowSeconds: number
    }
  }
  fulfillmentPolicy: {
    destinationId?: string
    latestDeliveryAt?: string
    allowedFulfillmentTypes?: Array<'shipping' | 'pickup' | 'digital'>
  }
  executionPolicy: {
    humanConfirmation: 'never_within_mandate' | 'always' | 'above_threshold' | 'on_material_change'
    confirmationThresholdMinor?: MinorUnitAmount
    stepUpAllowed: boolean
    challengeBehavior: 'request_user' | 'skip_candidate' | 'cancel'
  }
  validFrom: string
  expiresAt: string
  authorization?: {
    scheme: string
    issuer: string
    subject: string
    evidenceHash: string
    authorizationHash: string
    mode: PurchaseMandate['authorizationProvider']
    providerContextHash?: string
    authorizedAt: string
    externalReference?: string
  }
}

export type PurchaseMandateAuthorization = NonNullable<PurchaseMandate['authorization']>

export type MandateEvaluation = {
  decision: 'pass' | 'fail' | 'step_up'
  passReasons: string[]
  failReasons: string[]
  stepUpReasons: string[]
  amountMinor: MinorUnitAmount
  currency: string
  merchantOrigin: string
  checkoutId: string
  checkoutSnapshotHash: string
}

export type PurchaseMandateRecord = {
  mandate: PurchaseMandate
  totalReservedMinor: MinorUnitAmount
  totalCommittedMinor: MinorUnitAmount
  useCount: number
}

export type PurchaseMandateAuthorizationAction = {
  actionId: string
  mandateId: string
  mandateVersion: number
  ownerKeyId: string
  ownerPrincipalHash: string
  integrationId: string
  authorizationHash: string
  mode: PurchaseMandate['authorizationProvider']
  status: 'pending' | 'consumed' | 'revoked' | 'expired'
  expiresAt: string
  consumedAt?: string
}

export type PurchaseMandateAuthorizationActionLookup = Pick<
  PurchaseMandateAuthorizationAction,
  'actionId' | 'mandateId' | 'mandateVersion' | 'authorizationHash' | 'mode' | 'status' | 'expiresAt'
>

type MandateRow = QueryResultRow & {
  mandate_json: PurchaseMandate
  total_reserved_minor: string
  total_committed_minor: string
  use_count: number
}

type AuthorizationActionRow = QueryResultRow & {
  action_id: string
  mandate_id: string
  mandate_version: number
  owner_key_id: string
  owner_principal_hash: string
  integration_id: string
  authorization_hash: string
  mode: PurchaseMandate['authorizationProvider']
  status: PurchaseMandateAuthorizationAction['status']
  expires_at: string | Date
  consumed_at: string | Date | null
}

const moneyPattern = /^[0-9]+$/
const currencyPattern = /^[A-Z]{3}$/

export class PurchaseMandateError extends Error {
  readonly code: 'mandate_invalid'
    | 'mandate_not_found'
    | 'mandate_not_active'
    | 'mandate_authorization_required'
    | 'mandate_authorization_invalid'
    | 'mandate_authorization_replayed'
    | 'mandate_constraint_failed'
    | 'mandate_budget_unavailable'
    | 'mandate_reservation_not_found'
  readonly details?: unknown

  constructor(
    code:
      | 'mandate_invalid'
      | 'mandate_not_found'
      | 'mandate_not_active'
      | 'mandate_authorization_required'
      | 'mandate_authorization_invalid'
      | 'mandate_authorization_replayed'
      | 'mandate_constraint_failed'
      | 'mandate_budget_unavailable'
      | 'mandate_reservation_not_found',
    message: string,
    details?: unknown
  ) {
    super(message)
    this.name = 'PurchaseMandateError'
    this.code = code
    this.details = details
  }
}

const normalizeMinorUnitAmount = (value: string): MinorUnitAmount => {
  if (!moneyPattern.test(value)) {
    throw new PurchaseMandateError(
      'mandate_invalid',
      'Minor-unit amounts must be base-10 non-negative integer strings.'
    )
  }
  return BigInt(value).toString()
}

const assertCurrency = (currency: string) => {
  if (!currencyPattern.test(currency)) {
    throw new PurchaseMandateError('mandate_invalid', 'Currency must be an ISO 4217 uppercase code.')
  }
}

const amountBigInt = (value: string | number | undefined) => {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new PurchaseMandateError('mandate_invalid', 'Checkout amounts must be safe non-negative integer minor units.')
    }
    return BigInt(value)
  }
  return BigInt(normalizeMinorUnitAmount(value ?? '0'))
}

const amountString = (value: bigint) => value.toString()

const sha256 = (value: string) =>
  `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`

const evidenceHashFor = (value: unknown) =>
  sha256(stableJsonStringify(value))

const checkoutTotal = (checkout: UcpCheckout, type: string) =>
  checkout.totals.find((entry) => entry.type === type)?.amount

const checkoutTotalBigInt = (checkout: UcpCheckout, types: string[]) =>
  types.reduce((sum, type) => sum + amountBigInt(checkoutTotal(checkout, type)), 0n)

const checkoutAmount = (checkout: UcpCheckout) =>
  amountString(amountBigInt(checkoutTotal(checkout, 'total')))

const checkoutLineItems = (checkout: UcpCheckout) => checkout.line_items ?? []

const checkoutItemIds = (checkout: UcpCheckout) =>
  checkoutLineItems(checkout).flatMap((lineItem) => {
    const ids = [lineItem.item.id]
    const itemRecord = lineItem.item as unknown as Record<string, unknown>
    const variantId = typeof itemRecord.variant_id === 'string' ? itemRecord.variant_id : undefined
    if (variantId) ids.push(variantId)
    return ids
  })

const checkoutQuantity = (checkout: UcpCheckout) =>
  checkoutLineItems(checkout).reduce((sum, lineItem) => sum + lineItem.quantity, 0)

const checkoutAttributeRecord = (checkout: UcpCheckout) => {
  const attributes: Record<string, string[]> = {}
  for (const lineItem of checkoutLineItems(checkout)) {
    const item = lineItem.item as unknown as Record<string, unknown>
    const itemAttributes = item.attributes && typeof item.attributes === 'object' && !Array.isArray(item.attributes)
      ? item.attributes as Record<string, unknown>
      : {}
    for (const [name, value] of Object.entries(itemAttributes)) {
      const values = Array.isArray(value)
        ? value.flatMap((entry) => typeof entry === 'string' ? [entry] : [])
        : typeof value === 'string'
          ? [value]
          : []
      if (values.length > 0) {
        attributes[name] = [...(attributes[name] ?? []), ...values]
      }
    }
  }
  return attributes
}

const checkoutItemRecords = (checkout: UcpCheckout) =>
  checkoutLineItems(checkout).map((lineItem) => lineItem.item as unknown as Record<string, unknown>)

const normalizedText = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : undefined

const checkoutMerchantCountry = (checkout: UcpCheckout) => {
  const record = checkout as unknown as Record<string, unknown>
  const context = record.context && typeof record.context === 'object' && !Array.isArray(record.context)
    ? record.context as Record<string, unknown>
    : {}
  const signals = record.signals && typeof record.signals === 'object' && !Array.isArray(record.signals)
    ? record.signals as Record<string, unknown>
    : {}
  const fulfillment = record.fulfillment && typeof record.fulfillment === 'object' && !Array.isArray(record.fulfillment)
    ? record.fulfillment as Record<string, unknown>
    : {}
  const value = context.merchant_country ?? context.merchantCountry ?? signals.merchant_country ??
    signals.merchantCountry ?? fulfillment.merchant_country ?? fulfillment.merchantCountry
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : undefined
}

const checkoutFulfillment = (checkout: UcpCheckout) => {
  const value = (checkout as unknown as Record<string, unknown>).fulfillment
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

const checkoutFulfillmentMethods = (checkout: UcpCheckout) => {
  const methods = checkoutFulfillment(checkout).methods
  return Array.isArray(methods)
    ? methods.filter((method): method is Record<string, unknown> =>
        Boolean(method) && typeof method === 'object' && !Array.isArray(method))
    : []
}

const checkoutFulfillmentTypes = (checkout: UcpCheckout) =>
  [...new Set(checkoutFulfillmentMethods(checkout)
    .map((method) => normalizedText(method.type))
    .filter((value): value is string => Boolean(value)))]

const checkoutDestinationIds = (checkout: UcpCheckout) =>
  [...new Set(checkoutFulfillmentMethods(checkout)
    .map((method) => method.selected_destination_id)
    .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
    .map((value) => value.trim()))]

const checkoutLatestDeliveryAt = (checkout: UcpCheckout) => {
  const deliveryTimes = checkoutFulfillmentMethods(checkout).flatMap((method) => {
    const groups = Array.isArray(method.groups) ? method.groups : []
    return groups.flatMap((groupValue) => {
      if (!groupValue || typeof groupValue !== 'object' || Array.isArray(groupValue)) return []
      const group = groupValue as Record<string, unknown>
      const selectedOptionId = typeof group.selected_option_id === 'string'
        ? group.selected_option_id
        : undefined
      if (!selectedOptionId || !Array.isArray(group.options)) return []
      const selected = group.options.find((optionValue) => {
        if (!optionValue || typeof optionValue !== 'object' || Array.isArray(optionValue)) return false
        return (optionValue as Record<string, unknown>).id === selectedOptionId
      })
      if (!selected || typeof selected !== 'object' || Array.isArray(selected)) return []
      const value = (selected as Record<string, unknown>).latest_fulfillment_time
      return typeof value === 'string' && !Number.isNaN(new Date(value).getTime()) ? [value] : []
    })
  })
  return deliveryTimes.sort((left, right) =>
    new Date(right).getTime() - new Date(left).getTime())[0]
}

const authorizedSellerEvidence = (checkout: UcpCheckout) => {
  const items = checkoutItemRecords(checkout)
  if (items.length === 0) return 'missing' as const
  let unknown = false
  for (const item of items) {
    const seller = item.seller && typeof item.seller === 'object' && !Array.isArray(item.seller)
      ? item.seller as Record<string, unknown>
      : {}
    const evidence = item.authorized_seller ?? item.authorizedSeller ?? seller.authorized ?? seller.is_authorized
    if (evidence === false) return 'denied' as const
    if (evidence !== true) unknown = true
  }
  return unknown ? 'missing' as const : 'verified' as const
}

const checkoutMatchesAnyQuery = (checkout: UcpCheckout, queries: string[]) => {
  const searchable = checkoutItemRecords(checkout).flatMap((item) => [
    normalizedText(item.id),
    normalizedText(item.title),
    normalizedText(item.description)
  ]).filter((value): value is string => Boolean(value)).join(' ')
  return queries.some((query) => searchable.includes(query.trim().toLowerCase()))
}

const checkoutMatchesAnyCategory = (checkout: UcpCheckout, categories: string[]) => {
  const actual = checkoutItemRecords(checkout).flatMap((item) => {
    const values = [item.category, item.category_id, item.categoryId]
    if (Array.isArray(item.categories)) values.push(...item.categories)
    return values.flatMap((value) => typeof value === 'string' ? [value.trim().toLowerCase()] : [])
  })
  return categories.some((category) => actual.includes(category.trim().toLowerCase()))
}

const containsRequiredAttributes = (
  checkout: UcpCheckout,
  required: Record<string, string | string[]> | undefined
) => {
  if (!required) return []
  const attributes = checkoutAttributeRecord(checkout)
  const missing: string[] = []
  for (const [name, expected] of Object.entries(required)) {
    const expectedValues = Array.isArray(expected) ? expected : [expected]
    const actualValues = attributes[name] ?? []
    if (!expectedValues.every((value) => actualValues.includes(value))) {
      missing.push(name)
    }
  }
  return missing
}

const containsProhibitedAttributes = (
  checkout: UcpCheckout,
  prohibited: Record<string, string | string[]> | undefined
) => {
  if (!prohibited) return []
  const attributes = checkoutAttributeRecord(checkout)
  const present: string[] = []
  for (const [name, denied] of Object.entries(prohibited)) {
    const deniedValues = Array.isArray(denied) ? denied : [denied]
    const actualValues = attributes[name] ?? []
    if (deniedValues.some((value) => actualValues.includes(value))) {
      present.push(name)
    }
  }
  return present
}

const rowToRecord = (row: MandateRow): PurchaseMandateRecord => ({
  mandate: row.mandate_json,
  totalReservedMinor: normalizeMinorUnitAmount(row.total_reserved_minor),
  totalCommittedMinor: normalizeMinorUnitAmount(row.total_committed_minor),
  useCount: row.use_count
})

const rowToAuthorizationAction = (row: AuthorizationActionRow): PurchaseMandateAuthorizationAction => ({
  actionId: row.action_id,
  mandateId: row.mandate_id,
  mandateVersion: row.mandate_version,
  ownerKeyId: row.owner_key_id,
  ownerPrincipalHash: row.owner_principal_hash,
  integrationId: row.integration_id,
  authorizationHash: row.authorization_hash,
  mode: row.mode,
  status: row.status,
  expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : new Date(row.expires_at).toISOString(),
  ...(row.consumed_at ? { consumedAt: row.consumed_at instanceof Date ? row.consumed_at.toISOString() : new Date(row.consumed_at).toISOString() } : {})
})

const ownerIdFor = (principal: CommercePrincipal) =>
  `${principal.keyId}:${principal.ownerPrincipalHash}`

const validateMandate = (mandate: PurchaseMandate) => {
  if (!mandate.mandateId || !mandate.ownerId || !mandate.integrationId) {
    throw new PurchaseMandateError('mandate_invalid', 'Mandate requires identity fields.')
  }
  assertCurrency(mandate.financialPolicy.currency)
  for (const value of [
    mandate.financialPolicy.maximumPerTransactionMinor,
    mandate.financialPolicy.maximumTotalSpendMinor,
    mandate.financialPolicy.maximumTaxMinor,
    mandate.financialPolicy.maximumShippingMinor,
    mandate.financialPolicy.maximumFeesMinor,
    mandate.executionPolicy.confirmationThresholdMinor
  ]) {
    if (value !== undefined) normalizeMinorUnitAmount(value)
  }
  if (!Number.isInteger(mandate.financialPolicy.useLimit) || mandate.financialPolicy.useLimit < 1) {
    throw new PurchaseMandateError('mandate_invalid', 'Mandate useLimit must be a positive integer.')
  }
  if (
    mandate.intent.intendedQuantity !== undefined &&
    (!Number.isInteger(mandate.intent.intendedQuantity) || mandate.intent.intendedQuantity < 1)
  ) {
    throw new PurchaseMandateError('mandate_invalid', 'Mandate intendedQuantity must be a positive integer.')
  }
  if (
    mandate.intent.quantityMaximum !== undefined &&
    (!Number.isInteger(mandate.intent.quantityMaximum) || mandate.intent.quantityMaximum < 1)
  ) {
    throw new PurchaseMandateError('mandate_invalid', 'Mandate quantityMaximum must be a positive integer.')
  }
  if (
    mandate.intent.intendedQuantity !== undefined &&
    mandate.intent.quantityMaximum !== undefined &&
    mandate.intent.intendedQuantity > mandate.intent.quantityMaximum
  ) {
    throw new PurchaseMandateError('mandate_invalid', 'Mandate intendedQuantity cannot exceed quantityMaximum.')
  }
  const frequency = mandate.financialPolicy.frequencyLimit
  if (frequency && (
    !Number.isInteger(frequency.count) || frequency.count < 1 ||
    !Number.isInteger(frequency.windowSeconds) || frequency.windowSeconds < 1
  )) {
    throw new PurchaseMandateError('mandate_invalid', 'Mandate frequency limit requires positive integer count and windowSeconds.')
  }
  if (new Date(mandate.validFrom).getTime() >= new Date(mandate.expiresAt).getTime()) {
    throw new PurchaseMandateError('mandate_invalid', 'Mandate validity window is invalid.')
  }
  if (mandate.status === 'active' && !mandate.authorization) {
    throw new PurchaseMandateError(
      'mandate_authorization_required',
      'An active mandate must contain verified authorization evidence.'
    )
  }
  return mandate
}

export const purchaseMandateAuthorizationHash = ({
  mandate,
  providerContext = {}
}: {
  mandate: PurchaseMandate
  providerContext?: unknown
}) =>
  evidenceHashFor({
    ownerId: mandate.ownerId,
    integrationId: mandate.integrationId,
    mandateId: mandate.mandateId,
    version: mandate.version,
    constraints: {
      intent: mandate.intent,
      merchantPolicy: mandate.merchantPolicy,
      financialPolicy: mandate.financialPolicy,
      fulfillmentPolicy: mandate.fulfillmentPolicy,
      executionPolicy: mandate.executionPolicy
    },
    validityWindow: {
      validFrom: mandate.validFrom,
      expiresAt: mandate.expiresAt
    },
    providerContext
  })

export const draftPurchaseMandate = ({
  principal,
  intentDescription,
  merchantOrigin,
  productId,
  variantId,
  intendedQuantity = 1,
  currency,
  maximumPerTransactionMinor,
  maximumTotalSpendMinor,
  useLimit = 1,
  validFrom = new Date().toISOString(),
  expiresAt,
  authorizationProvider = 'trusted_host_signature'
}: {
  principal: CommercePrincipal
  intentDescription: string
  merchantOrigin: string
  productId?: string
  variantId?: string
  intendedQuantity?: number
  currency: string
  maximumPerTransactionMinor: MinorUnitAmount
  maximumTotalSpendMinor: MinorUnitAmount
  useLimit?: number
  validFrom?: string
  expiresAt: string
  authorizationProvider?: PurchaseMandate['authorizationProvider']
}): PurchaseMandate => validateMandate({
  mandateId: `pm_${randomUUID()}`,
  ownerId: ownerIdFor(principal),
  integrationId: principal.integrationId,
  version: 1,
  status: 'draft',
  authorizationProvider,
  intent: {
    description: intentDescription,
    ...(productId ? { productIds: [productId] } : {}),
    ...(variantId ? { allowedVariants: [variantId] } : {}),
    intendedQuantity,
    quantityMaximum: intendedQuantity,
    substitutionPolicy: 'forbidden'
  },
  merchantPolicy: {
    allowedMerchantOrigins: [merchantOrigin]
  },
  financialPolicy: {
    currency,
    maximumPerTransactionMinor: normalizeMinorUnitAmount(maximumPerTransactionMinor),
    maximumTotalSpendMinor: normalizeMinorUnitAmount(maximumTotalSpendMinor),
    useLimit
  },
  fulfillmentPolicy: {},
  executionPolicy: {
    humanConfirmation: 'never_within_mandate',
    stepUpAllowed: true,
    challengeBehavior: 'request_user'
  },
  validFrom,
  expiresAt,
})

export const buildPurchaseMandateAuthorization = ({
  mandate,
  mode,
  issuer,
  subject,
  evidence,
  providerContext = {},
  externalReference,
  authorizedAt = new Date().toISOString()
}: {
  mandate: PurchaseMandate
  mode: PurchaseMandate['authorizationProvider']
  issuer: string
  subject: string
  evidence: unknown
  providerContext?: unknown
  externalReference?: string
  authorizedAt?: string
}): PurchaseMandateAuthorization => {
  const authorizationHash = purchaseMandateAuthorizationHash({ mandate, providerContext })
  return {
    scheme: 'arro-purchase-mandate-authorization-v1',
    issuer,
    subject,
    evidenceHash: evidenceHashFor(evidence),
    authorizationHash,
    mode,
    providerContextHash: evidenceHashFor(providerContext),
    authorizedAt,
    ...(externalReference ? { externalReference } : {})
  }
}

export const evaluatePurchaseMandate = ({
  mandate,
  checkout,
  merchantOrigin,
  checkoutSnapshotHash,
  previousCheckoutSnapshotHash,
  providerChallengeRequired = false,
  now = new Date()
}: {
  mandate: PurchaseMandate
  checkout: UcpCheckout
  merchantOrigin: string
  checkoutSnapshotHash: string
  previousCheckoutSnapshotHash?: string
  providerChallengeRequired?: boolean
  now?: Date
}): MandateEvaluation => {
  const passReasons: string[] = []
  const failReasons: string[] = []
  const stepUpReasons: string[] = []
  const amountMinor = checkoutAmount(checkout)
  const amount = BigInt(amountMinor)
  const currency = checkout.currency
  assertCurrency(currency)
  const escalate = (reason: string) => {
    if (mandate.executionPolicy.stepUpAllowed) stepUpReasons.push(reason)
    else failReasons.push(reason)
  }

  if (mandate.status !== 'active') failReasons.push(`mandate_${mandate.status}`)
  if (new Date(mandate.validFrom).getTime() > now.getTime()) failReasons.push('mandate_not_yet_valid')
  if (new Date(mandate.expiresAt).getTime() <= now.getTime()) failReasons.push('mandate_expired')
  if (currency !== mandate.financialPolicy.currency) failReasons.push('currency_mismatch')
  if (amount > BigInt(mandate.financialPolicy.maximumPerTransactionMinor)) escalate('amount_exceeds_limit')
  const tax = checkoutTotalBigInt(checkout, ['tax'])
  const shipping = checkoutTotalBigInt(checkout, ['shipping'])
  const fees = checkoutTotalBigInt(checkout, ['fee', 'fees', 'service_fee'])
  if (mandate.financialPolicy.maximumTaxMinor !== undefined && tax > BigInt(mandate.financialPolicy.maximumTaxMinor)) {
    escalate('tax_exceeds_limit')
  }
  if (mandate.financialPolicy.maximumShippingMinor !== undefined && shipping > BigInt(mandate.financialPolicy.maximumShippingMinor)) {
    escalate('shipping_exceeds_limit')
  }
  if (mandate.financialPolicy.maximumFeesMinor !== undefined && fees > BigInt(mandate.financialPolicy.maximumFeesMinor)) {
    escalate('fees_exceed_limit')
  }

  const allowedOrigins = mandate.merchantPolicy.allowedMerchantOrigins ?? []
  if (allowedOrigins.length > 0 && !allowedOrigins.includes(merchantOrigin)) failReasons.push('merchant_not_allowed')
  if (mandate.merchantPolicy.deniedMerchantOrigins?.includes(merchantOrigin)) failReasons.push('merchant_denied')
  const merchantCountry = checkoutMerchantCountry(checkout)
  if (mandate.merchantPolicy.allowedCountries?.length) {
    if (!merchantCountry) escalate('merchant_country_evidence_unavailable')
    else if (!mandate.merchantPolicy.allowedCountries.includes(merchantCountry)) failReasons.push('merchant_country_not_allowed')
  }
  if (mandate.merchantPolicy.authorizedSellerRequired) {
    const sellerEvidence = authorizedSellerEvidence(checkout)
    if (sellerEvidence === 'denied') failReasons.push('seller_not_authorized')
    if (sellerEvidence === 'missing') escalate('authorized_seller_evidence_unavailable')
  }

  const itemIds = checkoutItemIds(checkout)
  if (mandate.intent.productIds && !mandate.intent.productIds.some((id) => itemIds.includes(id))) {
    failReasons.push('product_not_authorized')
  }
  if (mandate.intent.allowedVariants && !mandate.intent.allowedVariants.some((id) => itemIds.includes(id))) {
    failReasons.push('variant_not_authorized')
  }
  if (mandate.intent.productQueries?.length && !checkoutMatchesAnyQuery(checkout, mandate.intent.productQueries)) {
    escalate('product_query_evidence_mismatch')
  }
  if (mandate.intent.categories?.length && !checkoutMatchesAnyCategory(checkout, mandate.intent.categories)) {
    escalate('product_category_evidence_mismatch')
  }
  if (mandate.intent.intendedQuantity !== undefined && checkoutQuantity(checkout) !== mandate.intent.intendedQuantity) {
    escalate('quantity_differs_from_intent')
  }
  if (mandate.intent.quantityMaximum !== undefined && checkoutQuantity(checkout) > mandate.intent.quantityMaximum) {
    escalate('quantity_exceeds_limit')
  }
  for (const missing of containsRequiredAttributes(checkout, mandate.intent.requiredAttributes)) {
    failReasons.push(`required_attribute_missing:${missing}`)
  }
  for (const present of containsProhibitedAttributes(checkout, mandate.intent.prohibitedAttributes)) {
    failReasons.push(`prohibited_attribute_present:${present}`)
  }
  if (mandate.executionPolicy.humanConfirmation === 'always') escalate('human_confirmation_required')
  if (
    mandate.executionPolicy.humanConfirmation === 'above_threshold' &&
    mandate.executionPolicy.confirmationThresholdMinor &&
    amount > BigInt(mandate.executionPolicy.confirmationThresholdMinor)
  ) {
    escalate('confirmation_threshold_exceeded')
  }
  if (
    mandate.executionPolicy.humanConfirmation === 'on_material_change' &&
    previousCheckoutSnapshotHash &&
    previousCheckoutSnapshotHash !== checkoutSnapshotHash
  ) {
    escalate('material_checkout_change')
  }
  if (providerChallengeRequired) {
    if (mandate.executionPolicy.challengeBehavior === 'request_user') escalate('provider_challenge_required')
    else failReasons.push(mandate.executionPolicy.challengeBehavior === 'skip_candidate'
      ? 'provider_challenge_candidate_skipped'
      : 'provider_challenge_cancelled')
  }
  const destinationIds = checkoutDestinationIds(checkout)
  if (
    mandate.fulfillmentPolicy.destinationId &&
    !destinationIds.includes(mandate.fulfillmentPolicy.destinationId)
  ) {
    escalate(destinationIds.length > 0 ? 'destination_mismatch' : 'destination_evidence_unavailable')
  }
  const fulfillmentTypes = checkoutFulfillmentTypes(checkout)
  if (mandate.fulfillmentPolicy.allowedFulfillmentTypes?.length) {
    if (fulfillmentTypes.length === 0) escalate('fulfillment_type_evidence_unavailable')
    else if (fulfillmentTypes.some((type) =>
      !mandate.fulfillmentPolicy.allowedFulfillmentTypes!.includes(type as 'shipping' | 'pickup' | 'digital'))
    ) {
      failReasons.push('fulfillment_type_not_allowed')
    }
  }
  if (mandate.fulfillmentPolicy.latestDeliveryAt) {
    const latestDelivery = checkoutLatestDeliveryAt(checkout)
    if (!latestDelivery) escalate('delivery_evidence_unavailable')
    else if (new Date(latestDelivery).getTime() > new Date(mandate.fulfillmentPolicy.latestDeliveryAt).getTime()) {
      escalate('delivery_after_deadline')
    }
  }

  if (failReasons.length === 0) passReasons.push('merchant_checkout_matches_mandate_identity')
  if (failReasons.length === 0 && stepUpReasons.length === 0) passReasons.push('amount_and_use_constraints_passed')

  return {
    decision: failReasons.length > 0 ? 'fail' : stepUpReasons.length > 0 ? 'step_up' : 'pass',
    passReasons,
    failReasons,
    stepUpReasons,
    amountMinor,
    currency,
    merchantOrigin,
    checkoutId: checkout.id,
    checkoutSnapshotHash
  }
}

export const createPurchaseMandateRepository = ({ client }: { client: Queryable }) => ({
  async createDraft(mandate: PurchaseMandate, principal: CommercePrincipal) {
    validateMandate(mandate)
    await client.query(
      `
        insert into purchase_mandates (
          mandate_id,
          owner_key_id,
          owner_principal_hash,
          integration_id,
          version,
          status,
          authorization_provider,
          mandate_json
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      `,
      [
        mandate.mandateId,
        principal.keyId,
        principal.ownerPrincipalHash,
        principal.integrationId,
        mandate.version,
        mandate.status,
        mandate.authorizationProvider,
        JSON.stringify(mandate)
      ]
    )
    return mandate
  },

  async activate(mandateId: string, principal: CommercePrincipal) {
    throw new PurchaseMandateError(
      'mandate_authorization_required',
      'Mandates must be activated through authorize() with consumed approval evidence.'
    )
  },

  async createAuthorizationAction(input: {
    mandate: PurchaseMandate
    principal: CommercePrincipal
    authorizationHash: string
    mode: PurchaseMandate['authorizationProvider']
    expiresAt: string
  }) {
    const actionId = `${purchaseMandateAuthorizationActionPrefix}${randomUUID()}`
    const row = await client.query<AuthorizationActionRow>(
      `
        insert into purchase_mandate_authorization_actions (
          action_id,
          mandate_id,
          mandate_version,
          owner_key_id,
          owner_principal_hash,
          integration_id,
          authorization_hash,
          mode,
          status,
          expires_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9::timestamptz)
        returning *
      `,
      [
        actionId,
        input.mandate.mandateId,
        input.mandate.version,
        input.principal.keyId,
        input.principal.ownerPrincipalHash,
        input.principal.integrationId,
        input.authorizationHash,
        input.mode,
        input.expiresAt
      ]
    )
    if (!row.rows[0]) throw new PurchaseMandateError('mandate_authorization_invalid', 'Mandate authorization action could not be created.')
    return rowToAuthorizationAction(row.rows[0])
  },

  async authorize(input: {
    mandateId: string
    principal: CommercePrincipal
    actionId: string
    authorization: PurchaseMandateAuthorization
  }) {
    const row = await client.query<MandateRow>(
      `
        with consumed_action as (
          update purchase_mandate_authorization_actions
          set status = 'consumed',
              consumed_at = now(),
              updated_at = now()
          where action_id = $5
            and mandate_id = $1
            and owner_key_id = $2
            and owner_principal_hash = $3
            and integration_id = $4
            and authorization_hash = $6
            and mode = $7
            and status = 'pending'
            and expires_at > now()
          returning action_id
        ),
        updated_mandate as (
          update purchase_mandates
          set status = 'active',
              authorization_provider = $7,
              mandate_json = jsonb_set(
                jsonb_set(mandate_json, '{status}', to_jsonb('active'::text), false),
                '{authorization}',
                $8::jsonb,
                true
              ),
              authorized_at = now(),
              activated_at = now(),
              updated_at = now()
          where mandate_id = $1
            and owner_key_id = $2
            and owner_principal_hash = $3
            and integration_id = $4
            and status in ('draft', 'pending_authorization')
            and exists (select 1 from consumed_action)
          returning *
        )
        select * from updated_mandate
      `,
      [
        input.mandateId,
        input.principal.keyId,
        input.principal.ownerPrincipalHash,
        input.principal.integrationId,
        input.actionId,
        input.authorization.authorizationHash,
        input.authorization.mode,
        JSON.stringify(input.authorization)
      ]
    )
    if (!row.rows[0]) {
      throw new PurchaseMandateError(
        'mandate_authorization_replayed',
        'Mandate authorization action was missing, expired, replayed, or mismatched.'
      )
    }
    return rowToRecord(row.rows[0]).mandate
  },

  async readAuthorizationAction(input: {
    actionId: string
    mandateId: string
    principal: CommercePrincipal
  }): Promise<PurchaseMandateAuthorizationActionLookup | undefined> {
    const row = await client.query<AuthorizationActionRow>(
      `
        select *
        from purchase_mandate_authorization_actions
        where action_id = $1
          and mandate_id = $2
          and owner_key_id = $3
          and owner_principal_hash = $4
          and integration_id = $5
        limit 1
      `,
      [
        input.actionId,
        input.mandateId,
        input.principal.keyId,
        input.principal.ownerPrincipalHash,
        input.principal.integrationId
      ]
    )
    return row.rows[0] ? rowToAuthorizationAction(row.rows[0]) : undefined
  },

  async read(mandateId: string, principal: CommercePrincipal) {
    const row = await client.query<MandateRow>(
      `
        select *
        from purchase_mandates
        where mandate_id = $1
          and owner_key_id = $2
          and owner_principal_hash = $3
          and integration_id = $4
        limit 1
      `,
      [mandateId, principal.keyId, principal.ownerPrincipalHash, principal.integrationId]
    )
    return row.rows[0] ? rowToRecord(row.rows[0]) : undefined
  },

  async reserve(input: {
    mandate: PurchaseMandate
    principal: CommercePrincipal
    transactionId: string
    evaluation: MandateEvaluation
  }) {
    if (input.evaluation.decision !== 'pass') {
      throw new PurchaseMandateError(
        'mandate_constraint_failed',
        'Mandate evaluation did not pass.',
        input.evaluation
      )
    }
    const amount = normalizeMinorUnitAmount(input.evaluation.amountMinor)
    const existing = await client.query<{ reservation_id: string }>(
      `
        select r.reservation_id
        from purchase_mandate_reservations r
        join purchase_mandates m
          on m.mandate_id = r.mandate_id
        where r.mandate_id = $1
          and r.transaction_id = $2
          and r.mandate_version = $3
          and m.owner_key_id = $4
          and m.owner_principal_hash = $5
          and m.integration_id = $6
        limit 1
      `,
      [
        input.mandate.mandateId,
        input.transactionId,
        input.mandate.version,
        input.principal.keyId,
        input.principal.ownerPrincipalHash,
        input.principal.integrationId
      ]
    )
    if (existing.rows[0]) return existing.rows[0].reservation_id

    const reservationId = `pmr_${randomUUID()}`
    const row = await client.query<{ reservation_id: string }>(
      `
        with locked_mandate as (
          select mandate_id
          from purchase_mandates
          where mandate_id = $1
            and owner_key_id = $2
            and owner_principal_hash = $3
            and integration_id = $4
            and version = $6
            and status = 'active'
            and (total_reserved_minor + total_committed_minor + $5::numeric) <= (mandate_json #>> '{financialPolicy,maximumTotalSpendMinor}')::numeric
            and use_count < (mandate_json #>> '{financialPolicy,useLimit}')::integer
            and (
              (mandate_json #> '{financialPolicy,frequencyLimit}') is null
              or (
                select count(*)
                from purchase_mandate_reservations frequency_reservation
                where frequency_reservation.mandate_id = purchase_mandates.mandate_id
                  and frequency_reservation.status in ('reserved', 'execution_in_progress', 'reconciliation_required', 'committed')
                  and frequency_reservation.created_at > now() - (
                    (mandate_json #>> '{financialPolicy,frequencyLimit,windowSeconds}') || ' seconds'
                  )::interval
              ) < (mandate_json #>> '{financialPolicy,frequencyLimit,count}')::integer
            )
            and not exists (
              select 1
              from purchase_mandate_reservations
              where mandate_id = $1
                and transaction_id = $8
            )
          for update
        ),
        inserted as (
          insert into purchase_mandate_reservations (
            reservation_id,
            mandate_id,
            mandate_version,
            transaction_id,
            checkout_id,
            checkout_snapshot_hash,
            amount_minor,
            reserved_amount_minor,
            currency,
            reserved_currency,
            status,
            evaluation_json
          )
          select $7, mandate_id, $6, $8, $9, $10, $5::numeric, $5::numeric, $11, $11, 'reserved', $12::jsonb
          from locked_mandate
          on conflict (mandate_id, transaction_id) do nothing
          returning reservation_id, mandate_id, reserved_amount_minor
        ),
        updated as (
          update purchase_mandates m
          set total_reserved_minor = total_reserved_minor + i.reserved_amount_minor,
              use_count = use_count + 1,
              updated_at = now(),
              status = case
                when use_count + 1 >= (mandate_json #>> '{financialPolicy,useLimit}')::integer then 'exhausted'
                else status
              end,
              exhausted_at = case
                when use_count + 1 >= (mandate_json #>> '{financialPolicy,useLimit}')::integer then now()
                else exhausted_at
              end
          from inserted i
          where m.mandate_id = i.mandate_id
          returning i.reservation_id
        )
        select reservation_id from updated
      `,
      [
        input.mandate.mandateId,
        input.principal.keyId,
        input.principal.ownerPrincipalHash,
        input.principal.integrationId,
        amount,
        input.mandate.version,
        reservationId,
        input.transactionId,
        input.evaluation.checkoutId,
        input.evaluation.checkoutSnapshotHash,
        input.evaluation.currency,
        JSON.stringify(input.evaluation)
      ]
    )
    if (row.rows[0]) return row.rows[0].reservation_id

    const racedExisting = await client.query<{ reservation_id: string }>(
      `
        select r.reservation_id
        from purchase_mandate_reservations r
        join purchase_mandates m
          on m.mandate_id = r.mandate_id
        where r.mandate_id = $1
          and r.transaction_id = $2
          and r.mandate_version = $3
          and m.owner_key_id = $4
          and m.owner_principal_hash = $5
          and m.integration_id = $6
        limit 1
      `,
      [
        input.mandate.mandateId,
        input.transactionId,
        input.mandate.version,
        input.principal.keyId,
        input.principal.ownerPrincipalHash,
        input.principal.integrationId
      ]
    )
    if (racedExisting.rows[0]) return racedExisting.rows[0].reservation_id

    {
      throw new PurchaseMandateError(
        'mandate_budget_unavailable',
        'Mandate budget, use count, status, version, or idempotent reservation constraint prevented reservation.'
      )
    }
  },

  async markExecutionInProgress(input: {
    reservationId: string
    completionOperationId: string
    paymentActionId?: string
    providerReference?: string
  }) {
    const row = await client.query<{ reservation_id: string }>(
      `
        update purchase_mandate_reservations
        set status = 'execution_in_progress',
            execution_started_at = coalesce(execution_started_at, now()),
            completion_operation_id = coalesce(completion_operation_id, $2),
            payment_action_id = coalesce(payment_action_id, $3),
            provider_reference = coalesce(provider_reference, $4)
        where reservation_id = $1
          and status = 'reserved'
        returning reservation_id
      `,
      [
        input.reservationId,
        input.completionOperationId,
        input.paymentActionId ?? null,
        input.providerReference ?? null
      ]
    )
    if (!row.rows[0]) {
      throw new PurchaseMandateError('mandate_reservation_not_found', 'Mandate reservation could not enter execution.')
    }
  },

  async markReconciliationRequired(input: {
    reservationId: string
    failureEvidence: unknown
  }) {
    const row = await client.query<{ reservation_id: string }>(
      `
        update purchase_mandate_reservations
        set status = 'reconciliation_required',
            reconciliation_state = 'required',
            reconciliation_required_at = coalesce(reconciliation_required_at, now()),
            failure_evidence_json = $2::jsonb
        where reservation_id = $1
          and status in ('execution_in_progress', 'reserved')
        returning reservation_id
      `,
      [input.reservationId, JSON.stringify(input.failureEvidence)]
    )
    if (!row.rows[0]) {
      throw new PurchaseMandateError('mandate_reservation_not_found', 'Mandate reservation could not enter reconciliation.')
    }
  },

  async commit(input: {
    reservationId: string
    order: UcpOrder
    actualAmountMinor?: MinorUnitAmount
  }) {
    const actualAmount = normalizeMinorUnitAmount(input.actualAmountMinor ?? String(input.order.totals.find((entry) => entry.type === 'total')?.amount ?? 0))
    assertCurrency(input.order.currency)
    const alreadyCommitted = await client.query<{ reservation_id: string }>(
      `
        select reservation_id
        from purchase_mandate_reservations
        where reservation_id = $1
          and status = 'committed'
          and checkout_id = $2
          and actual_order_amount_minor = $3::numeric
          and actual_order_currency = $4
        limit 1
      `,
      [input.reservationId, input.order.checkout_id, actualAmount, input.order.currency]
    )
    if (alreadyCommitted.rows[0]) return

    const row = await client.query<{ mandate_id: string }>(
      `
        with locked_mandate as (
          -- Lock the mandate before its reservation. reserve() holds the mandate
          -- row while it settles a reservation, so taking these two locks in the
          -- other order here would deadlock concurrent reserve/commit on one mandate.
          select m.mandate_id, m.mandate_json, m.total_committed_minor
          from purchase_mandates m
          where m.mandate_id = (
            select mandate_id
            from purchase_mandate_reservations
            where reservation_id = $1
          )
          for update
        ),
        eligible as (
          select
            r.reservation_id,
            r.mandate_id,
            r.reserved_amount_minor,
            r.reserved_currency
          from purchase_mandate_reservations r
          join locked_mandate m
            on m.mandate_id = r.mandate_id
          where r.reservation_id = $1
            and r.status in ('reserved', 'execution_in_progress', 'reconciliation_required')
            and r.checkout_id = $4
            and r.reserved_currency = $3
            and $3 = (m.mandate_json #>> '{financialPolicy,currency}')
            and $2::numeric <= (m.mandate_json #>> '{financialPolicy,maximumPerTransactionMinor}')::numeric
            and (m.total_committed_minor + $2::numeric) <= (m.mandate_json #>> '{financialPolicy,maximumTotalSpendMinor}')::numeric
          for update of r
        ),
        reservation as (
          update purchase_mandate_reservations
          set status = 'committed',
              committed_at = coalesce(committed_at, now()),
              amount_minor = $2::numeric,
              actual_order_amount_minor = $2::numeric,
              actual_order_currency = $3
          from eligible e
          where purchase_mandate_reservations.reservation_id = e.reservation_id
          returning e.mandate_id, e.reserved_amount_minor
        )
        update purchase_mandates m
        set total_reserved_minor = greatest(0, total_reserved_minor - r.reserved_amount_minor),
            total_committed_minor = total_committed_minor + $2::numeric,
            updated_at = now()
        from reservation r
        where m.mandate_id = r.mandate_id
        returning m.mandate_id
      `,
      [input.reservationId, actualAmount, input.order.currency, input.order.checkout_id]
    )
    if (!row.rows[0]) throw new PurchaseMandateError('mandate_reservation_not_found', 'Mandate reservation could not be committed.')
  },

  async release(reservationId: string) {
    const row = await client.query<{ mandate_id: string }>(
      `
        with locked_mandate as (
          -- Same mandate-before-reservation lock order as commit() and reserve().
          select m.mandate_id
          from purchase_mandates m
          where m.mandate_id = (
            select mandate_id
            from purchase_mandate_reservations
            where reservation_id = $1
          )
          for update
        ),
        reservation as (
          update purchase_mandate_reservations r
          set status = 'released',
              released_at = now()
          from locked_mandate lm
          where r.reservation_id = $1
            and r.status = 'reserved'
            and r.mandate_id = lm.mandate_id
          returning r.mandate_id, r.reserved_amount_minor
        )
        update purchase_mandates m
        set total_reserved_minor = greatest(0, total_reserved_minor - r.reserved_amount_minor),
            use_count = greatest(0, use_count - 1),
            status = case when status = 'exhausted' then 'active' else status end,
            exhausted_at = case when status = 'exhausted' then null else exhausted_at end,
            updated_at = now()
        from reservation r
        where m.mandate_id = r.mandate_id
        returning m.mandate_id
      `,
      [reservationId]
    )
    if (!row.rows[0]) throw new PurchaseMandateError('mandate_reservation_not_found', 'Mandate reservation could not be released.')
  },

  async revoke(mandateId: string, principal: CommercePrincipal) {
    await client.query(
      `
        update purchase_mandates
        set status = 'revoked',
            mandate_json = jsonb_set(mandate_json, '{status}', to_jsonb('revoked'::text), false),
            revoked_at = now(),
            updated_at = now()
        where mandate_id = $1
          and owner_key_id = $2
          and owner_principal_hash = $3
          and integration_id = $4
          and status in ('draft', 'pending_authorization', 'active', 'suspended')
      `,
      [mandateId, principal.keyId, principal.ownerPrincipalHash, principal.integrationId]
    )
  }
})

export type PurchaseMandateRepository = ReturnType<typeof createPurchaseMandateRepository>
