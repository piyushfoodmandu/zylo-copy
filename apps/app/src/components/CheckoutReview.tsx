import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { normalizeCheckoutPhone } from '@arro/contracts/checkout-contact'
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View
} from 'react-native'
import { openExactExternalStep } from '../lib/external-step'
import { useLayoutMode } from '../lib/layout'
import { formatMoney } from '../lib/money'
import { color } from '../lib/theme'
import { checkoutHasInputErrors, checkoutMessageTarget, type CheckoutMessageTarget } from '../lib/checkout-message-target'
import type {
  PurchaseResponse,
  PurchaseReviewUpdateRequest,
  PurchaseShippingDestinationInput,
  UcpBuyer,
  UcpDescription,
  UcpFulfillmentDestination,
  UcpFulfillmentMethod,
  UcpFulfillmentOption,
  UcpPostalAddress,
  UcpShippingDestination
} from '../types/purchase'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { Badge, Button, Field, Notice } from './ui'
import {
  CheckoutMessageCard,
  checkoutMessagePathIncludes
} from './CheckoutMessageCard'

export type CheckoutReviewChanges = Pick<
  PurchaseReviewUpdateRequest,
  'buyer' | 'fulfillment'
>

export type CheckoutReviewHandle = {
  /** Opens the most useful editor for the merchant's current recoverable error. */
  openRequiredStep: () => boolean
  openStep: (target: CheckoutMessageTarget) => boolean
}

type CheckoutReviewProps = {
  purchase: PurchaseResponse
  disabled: boolean
  working: boolean
  onUpdate: (changes: CheckoutReviewChanges) => Promise<PurchaseResponse>
  onEditingChange: (editing: boolean) => void
}

type BuyerDraft = Required<Pick<UcpBuyer, 'email' | 'first_name' | 'last_name' | 'phone_number'>>

type AddressField = Exclude<keyof PurchaseShippingDestinationInput, 'id' | 'type'>
type AddressDraft = Record<AddressField, string>
type AddressEditor = {
  methodId?: string
  existingId?: string
  draft: AddressDraft
}

const emptyBuyer: BuyerDraft = {
  email: '',
  first_name: '',
  last_name: '',
  phone_number: ''
}

const addressFields: readonly AddressField[] = [
  'first_name',
  'last_name',
  'phone_number',
  'street_address',
  'extended_address',
  'address_locality',
  'address_region',
  'postal_code',
  'address_country'
]

const emptyAddress = (): AddressDraft => ({
  first_name: '',
  last_name: '',
  phone_number: '',
  street_address: '',
  extended_address: '',
  address_locality: '',
  address_region: '',
  postal_code: '',
  address_country: ''
})

const cleanText = (value: string | undefined) => value?.trim() ?? ''

const buyerDraftFrom = (buyer: UcpBuyer | undefined): BuyerDraft => ({
  email: cleanText(buyer?.email),
  first_name: cleanText(buyer?.first_name),
  last_name: cleanText(buyer?.last_name),
  phone_number: cleanText(buyer?.phone_number)
})

const addressDraftFrom = (address: UcpShippingDestination | undefined): AddressDraft => {
  const draft = emptyAddress()
  for (const field of addressFields) draft[field] = cleanText(address?.[field])
  return draft
}

const compactRecord = <T extends Record<string, string>>(record: T) =>
  Object.fromEntries(
    Object.entries(record)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => Boolean(value))
  ) as Partial<T>

const trimmedRecord = <T extends Record<string, string>>(record: T) =>
  Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, value.trim()])
  ) as T

const normalizePath = (value: string | undefined) =>
  // Array indexes are structural noise for field matching. Keeping them made
  // normal JSONPaths such as `destinations[0].first_name` fail to light up the
  // corresponding required field.
  (value ?? '').toLocaleLowerCase().replace(/[^a-z]/g, '')

const pathMentions = (path: string | undefined, ...names: string[]) => {
  const normalized = normalizePath(path)
  return Boolean(normalized && names.some((name) => normalized.includes(normalizePath(name))))
}

const humanize = (value: string) => {
  const finalSegment = value.split('.').at(-1) ?? value
  const words = finalSegment.replaceAll('_', ' ').replaceAll('-', ' ').trim()
  return words ? words.charAt(0).toLocaleUpperCase() + words.slice(1) : 'Option'
}

const methodTitle = (type: string) => {
  const normalized = type.toLocaleLowerCase()
  if (normalized.includes('ship') || normalized.includes('deliver')) return 'Delivery'
  if (normalized.includes('pickup') || normalized.includes('collect')) return 'Pickup'
  if (normalized.includes('digital')) return 'Digital delivery'
  return humanize(type)
}

/** Only text explicitly supplied as plain text or Markdown is shown. */
const descriptionText = (description: UcpDescription | undefined) => {
  if (description?.plain?.trim()) return description.plain.trim()
  const markdown = description?.markdown?.trim()
  if (markdown) {
    return markdown
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(^|\s)[#>*_~`-]+(?=\S)/g, '$1')
      .replace(/[*_~`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }
  const html = description?.html?.trim()
  if (!html) return undefined
  return html
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

const buyerSummary = (buyer: UcpBuyer | undefined) => {
  const name = [buyer?.first_name, buyer?.last_name].filter(Boolean).join(' ')
  return [name, buyer?.email, buyer?.phone_number].filter(Boolean).join(' · ')
}

const addressLines = (address: UcpPostalAddress | UcpShippingDestination | undefined) => {
  if (!address) return []
  const name = [address.first_name, address.last_name].filter(Boolean).join(' ')
  const locality = [address.address_locality, address.address_region, address.postal_code]
    .filter(Boolean)
    .join(', ')
  return [
    name,
    address.street_address,
    address.extended_address,
    locality,
    address.address_country,
    address.phone_number
  ].filter((value): value is string => Boolean(value?.trim()))
}

const isShippingDestination = (destination: UcpFulfillmentDestination) =>
  destination.type === 'shipping_address' || (
    destination.type !== 'business_location' &&
    'street_address' in destination
  )

const shippingDestination = (destination: UcpFulfillmentDestination | undefined) =>
  destination && isShippingDestination(destination)
    ? destination as UcpShippingDestination
    : undefined

const businessLocation = (destination: UcpFulfillmentDestination) =>
  destination.type === 'business_location'
    ? destination as { id: string; type: 'business_location'; name: string; address?: UcpPostalAddress }
    : undefined

const destinationId = (destination: UcpFulfillmentDestination) =>
  typeof destination.id === 'string' ? destination.id : undefined

const destinationName = (destination: UcpFulfillmentDestination) => {
  const business = businessLocation(destination)
  if (business) return business.name
  const shipping = shippingDestination(destination)
  if (shipping) {
    const lines = addressLines(shipping)
    return lines[0] || 'Delivery address'
  }
  return typeof destination.type === 'string' && destination.type.length > 0
    ? humanize(destination.type)
    : 'Destination'
}

const destinationDetails = (destination: UcpFulfillmentDestination) => {
  const business = businessLocation(destination)
  if (business) return addressLines(business.address).join(' · ')
  return addressLines(shippingDestination(destination)).join(' · ')
}

const selectedDestination = (method: UcpFulfillmentMethod) =>
  method.destinations?.find((destination) => destinationId(destination) === method.selected_destination_id)

const selectedOption = (method: UcpFulfillmentMethod) =>
  method.groups?.flatMap((group) => group.options ?? [])
    .find((option) => method.groups?.some((group) => group.selected_option_id === option.id))

const methodSummary = (method: UcpFulfillmentMethod) => {
  const destination = selectedDestination(method)
  const option = selectedOption(method)
  return [destination ? destinationName(destination) : undefined, option?.title]
    .filter(Boolean)
    .join(' · ')
}

const dateLabel = (value: string | undefined, includeTime = false) => {
  if (!value) return undefined
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return undefined
  const currentYear = new Date().getFullYear()
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== currentYear ? { year: 'numeric' as const } : {}),
    ...(includeTime ? { hour: 'numeric' as const, minute: '2-digit' as const } : {})
  }).format(date)
}

const timingLabel = (option: UcpFulfillmentOption) => {
  const earliest = dateLabel(option.earliest_fulfillment_time, true)
  const latest = dateLabel(option.latest_fulfillment_time, true)
  if (earliest && latest && earliest !== latest) return `${earliest}–${latest}`
  if (latest) return `By ${latest}`
  return earliest
}

const optionPrice = (option: UcpFulfillmentOption, checkoutCurrency: string | undefined) => {
  const total = option.totals.find((entry) => entry.type === 'total') ?? option.totals.at(-1)
  if (!total) return undefined
  if (total.amount === 0) return 'Free'
  const currency = total.currency ?? checkoutCurrency
  return currency ? formatMoney({ amountMinor: total.amount, currency }) : undefined
}

const availableMethodTiming = (value: string | null | undefined) => {
  if (!value) return undefined
  if (value === 'now') return 'Available now'
  const date = dateLabel(value)
  return date ? `Available ${date}` : undefined
}

const linkTitle = (type: string, title: string | undefined) => {
  if (title?.trim()) return title.trim()
  const normalized = type.toLocaleLowerCase()
  if (normalized.includes('privacy')) return 'Privacy policy'
  if (normalized.includes('refund') || normalized.includes('return')) return 'Returns & refunds'
  if (normalized.includes('shipping') || normalized.includes('delivery')) return 'Shipping policy'
  if (normalized.includes('term')) return 'Terms'
  if (normalized.includes('faq') || normalized.includes('help')) return 'Help & FAQs'
  return humanize(type)
}

function RequiredLabel({ needed }: { needed: boolean }) {
  return needed ? <Badge tone="warning">Needed by shop</Badge> : null
}

function LabeledField({
  label,
  value,
  placeholder,
  needed,
  onChangeText,
  keyboardType,
  autoCapitalize = 'sentences',
  autoComplete
}: {
  label: string
  value: string
  placeholder: string
  needed: boolean
  onChangeText: (value: string) => void
  keyboardType?: 'default' | 'email-address' | 'phone-pad'
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  autoComplete?: React.ComponentProps<typeof Field>['autoComplete']
}) {
  return (
    <View className="min-w-0 flex-1 gap-1.5">
      <View className="min-h-5 flex-row items-center justify-between gap-2">
        <Text className="text-[13px] font-medium leading-[18px] text-ink-800">{label}</Text>
        <RequiredLabel needed={needed} />
      </View>
      <Field
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        accessibilityLabel={`${label}${needed ? '. Needed by shop' : ''}`}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        autoComplete={autoComplete}
      />
    </View>
  )
}

function RadioMark({ selected }: { selected: boolean }) {
  return (
    <View className={`h-5 w-5 items-center justify-center rounded-full border ${selected ? 'border-arro-600' : 'border-line-strong'}`}>
      {selected ? <View className="h-2.5 w-2.5 rounded-full bg-arro-600" /> : null}
    </View>
  )
}

function OptionRow({
  option,
  selected,
  disabled,
  currency,
  onSelect
}: {
  option: UcpFulfillmentOption
  selected: boolean
  disabled: boolean
  currency: string | undefined
  onSelect: () => void
}) {
  const description = descriptionText(option.description)
  const timing = timingLabel(option)
  const price = optionPrice(option, currency)
  const detail = [option.carrier, timing].filter(Boolean).join(' · ')
  const accessibleDetail = [description, detail, price].filter(Boolean).join('. ')

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${option.title}${accessibleDetail ? `. ${accessibleDetail}` : ''}`}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onSelect}
      className={`min-h-11 flex-row items-start gap-3 rounded-2xl border p-3.5 ${selected ? 'border-arro-600 bg-arro-50' : 'border-line bg-white'} ${disabled ? 'opacity-50' : ''}`}
    >
      <View className="pt-0.5"><RadioMark selected={selected} /></View>
      <View className="min-w-0 flex-1">
        <View className="flex-row items-start justify-between gap-3">
          <Text className="min-w-0 flex-1 text-[14px] font-semibold leading-5 text-ink-950">{option.title}</Text>
          {price ? <Text className="text-[14px] font-semibold leading-5 text-ink-950">{price}</Text> : null}
        </View>
        {description ? <Text className="mt-0.5 text-[13px] leading-[18px] text-ink-600">{description}</Text> : null}
        {detail ? <Text className="mt-1 text-[12px] leading-4 text-ink-400">{detail}</Text> : null}
      </View>
    </Pressable>
  )
}

function DestinationRow({
  destination,
  selected,
  disabled,
  onSelect,
  onEdit
}: {
  destination: UcpFulfillmentDestination
  selected: boolean
  disabled: boolean
  onSelect?: () => void
  onEdit?: () => void
}) {
  const title = destinationName(destination)
  const details = destinationDetails(destination)
  const selectable = Boolean(onSelect)

  return (
    <View className={`flex-row items-stretch rounded-2xl border ${selected ? 'border-arro-600 bg-arro-50' : 'border-line bg-white'} ${disabled ? 'opacity-50' : ''}`}>
      <Pressable
        accessibilityRole={selectable ? 'radio' : 'text'}
        accessibilityLabel={`${title}${details ? `. ${details}` : ''}`}
        accessibilityState={selectable ? { checked: selected, disabled } : undefined}
        disabled={disabled || !selectable}
        onPress={onSelect}
        className="min-h-11 min-w-0 flex-1 flex-row items-start gap-3 p-3.5"
      >
        {selectable ? <View className="pt-0.5"><RadioMark selected={selected} /></View> : null}
        <View className="min-w-0 flex-1">
          <Text className="text-[14px] font-semibold leading-5 text-ink-950">{title}</Text>
          {details ? <Text className="mt-0.5 text-[12px] leading-4 text-ink-600">{details}</Text> : null}
        </View>
      </Pressable>
      {onEdit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${title}`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          hitSlop={4}
          onPress={onEdit}
          className="min-h-11 min-w-11 items-center justify-center border-l border-line px-3"
        >
          <Text className="text-[13px] font-semibold leading-[18px] text-arro-700">Edit</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export const CheckoutReview = forwardRef<CheckoutReviewHandle, CheckoutReviewProps>(function CheckoutReview({
  purchase,
  disabled,
  working,
  onUpdate,
  onEditingChange
}, ref) {
  const { compact } = useLayoutMode()
  const [buyerOpen, setBuyerOpen] = useState(false)
  const [buyerDraft, setBuyerDraft] = useState<BuyerDraft>(emptyBuyer)
  const [contactMethod, setContactMethod] = useState<'email' | 'phone'>('email')
  const [addressEditor, setAddressEditor] = useState<AddressEditor>()
  const [editorError, setEditorError] = useState<string>()
  const [selectionError, setSelectionError] = useState<string>()
  const [linkError, setLinkError] = useState<string>()
  const [attempted, setAttempted] = useState(false)
  const editing = buyerOpen || Boolean(addressEditor)
  useEffect(() => {
    onEditingChange(editing)
    return () => onEditingChange(false)
  }, [editing, onEditingChange])

  const inputMessages = useMemo(() => purchase.messages.filter((message) =>
    (
      message.resolution === 'recoverable' ||
      message.resolution === 'requires_buyer_input' ||
      message.resolution === 'requires_buyer_review'
    )
  ), [purchase.messages])
  const buyerMessages = inputMessages.filter((message) => checkoutMessageTarget(message) === 'buyer')
  const fulfillmentMessages = inputMessages.filter((message) => checkoutMessageTarget(message) === 'fulfillment')
  const buyerDisclosures = purchase.messages.filter((message) =>
    message.presentation === 'disclosure' && checkoutMessagePathIncludes(message, 'buyer')
  )
  const fulfillmentDisclosures = purchase.messages.filter((message) =>
    message.presentation === 'disclosure' && checkoutMessagePathIncludes(message, 'fulfillment')
  )
  const policyTypes = new Set((purchase.policies ?? []).map((policy) => policy.type))
  const shopDisclosures = purchase.messages.filter((message) =>
    message.presentation === 'disclosure' && (
      checkoutMessagePathIncludes(message, 'policies', 'links') ||
      Boolean(!message.path && message.code && policyTypes.has(message.code))
    )
  )
  const methods = purchase.fulfillment?.methods ?? []
  const availableMethods = purchase.fulfillment?.available_methods ?? []
  const summary = buyerSummary(purchase.buyer)
  const checkoutCurrency = purchase.currency ?? purchase.totals?.find((entry) => entry.currency)?.currency
  const editDisabled = disabled || working
  const buyerNeeds = (field: keyof BuyerDraft) => buyerMessages.some((message) =>
    pathMentions(message.path, `buyer.${field}`) || message.code === `buyer_identity_${field}_required`
  )
  const showBuyerNames = buyerNeeds('first_name') || buyerNeeds('last_name')
  const showEmail = contactMethod === 'email' || buyerNeeds('email')
  const showPhone = contactMethod === 'phone' || buyerNeeds('phone_number')

  const openBuyer = useCallback(() => {
    if (editDisabled) return
    setEditorError(undefined)
    setAttempted(false)
    setBuyerDraft(buyerDraftFrom(purchase.buyer))
    setContactMethod(purchase.buyer?.email || !purchase.buyer?.phone_number ? 'email' : 'phone')
    setBuyerOpen(true)
  }, [editDisabled, purchase.buyer])

  const saveBuyer = async () => {
    if (editDisabled) return
    setAttempted(true)
    try {
      setEditorError(undefined)
      const email = buyerDraft.email.trim()
      if (showEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setEditorError('Enter a valid email address.')
        return
      }
      const phone = showPhone ? normalizeCheckoutPhone(buyerDraft.phone_number) : undefined
      if (showPhone && !phone) {
        setEditorError('Enter a phone number with its country code.')
        return
      }
      const updated = await onUpdate({ buyer: {
        ...(showEmail ? { email } : {}),
        ...(phone ? { phone_number: phone } : {}),
        ...(showBuyerNames ? {
          first_name: buyerDraft.first_name.trim(),
          last_name: buyerDraft.last_name.trim()
        } : {})
      } })
      if (!checkoutHasInputErrors(updated, 'buyer')) setBuyerOpen(false)
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'Contact details could not be saved. Try again.')
    }
  }

  const openAddress = useCallback((
    method?: UcpFulfillmentMethod,
    destination?: UcpShippingDestination
  ) => {
    if (editDisabled || (method ? !method.id : !purchase.canAddShippingAddress)) return
    setEditorError(undefined)
    setAttempted(false)
    setAddressEditor({
      ...(method?.id ? { methodId: method.id } : {}),
      ...(destination?.id ? { existingId: destination.id } : {}),
      draft: {
        ...addressDraftFrom(destination),
        first_name: cleanText(destination?.first_name ?? purchase.buyer?.first_name),
        last_name: cleanText(destination?.last_name ?? purchase.buyer?.last_name),
        phone_number: cleanText(destination?.phone_number ?? purchase.buyer?.phone_number)
      }
    })
  }, [editDisabled, purchase.canAddShippingAddress, purchase.buyer])

  const saveAddress = async () => {
    if (editDisabled || !addressEditor) return
    setAttempted(true)
    const trimmed = trimmedRecord(addressEditor.draft)
    const values = addressEditor.existingId ? trimmed : compactRecord(trimmed)
    if (!Object.values(values).some(Boolean)) {
      setEditorError('Add at least one address or contact detail.')
      return
    }
    const country = values.address_country
    if (country && !/^[a-z]{2}$/i.test(country)) {
      setEditorError('Enter a two-letter country code, such as US or NP.')
      return
    }
    const destination: PurchaseShippingDestinationInput = {
      ...(addressEditor.existingId ? { id: addressEditor.existingId } : {}),
      type: 'shipping_address',
      ...values,
      ...(country
        ? { address_country: country.toUpperCase() }
        : {})
    }
    try {
      setEditorError(undefined)
      if (destination.phone_number) destination.phone_number = normalizeCheckoutPhone(destination.phone_number)
      const updated = await onUpdate({
        fulfillment: {
          methods: [{
            ...(addressEditor.methodId ? { id: addressEditor.methodId } : { type: 'shipping' as const }),
            ...(addressEditor.existingId
              ? { selected_destination_id: addressEditor.existingId }
              : {}),
            destinations: [destination]
          }]
        }
      })
      if (!checkoutHasInputErrors(updated, 'fulfillment')) setAddressEditor(undefined)
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'Delivery address could not be saved. Try again.')
    }
  }

  const selectDestination = (
    method: UcpFulfillmentMethod,
    destination: UcpFulfillmentDestination
  ) => {
    const id = destinationId(destination)
    if (editDisabled || !method.id || !id || id === method.selected_destination_id) return
    setSelectionError(undefined)
    void onUpdate({
      fulfillment: {
        methods: [{ id: method.id, selected_destination_id: id }]
      }
    }).catch((error) => {
      setSelectionError(error instanceof Error ? error.message : 'That destination could not be selected. Try again.')
    })
  }

  const selectOption = (method: UcpFulfillmentMethod, groupId: string, optionId: string) => {
    if (editDisabled || !method.id) return
    const group = method.groups?.find((entry) => entry.id === groupId)
    if (group?.selected_option_id === optionId) return
    setSelectionError(undefined)
    void onUpdate({
      fulfillment: {
        methods: [{
          id: method.id,
          groups: [{ id: groupId, selected_option_id: optionId }]
        }]
      }
    }).catch((error) => {
      setSelectionError(error instanceof Error ? error.message : 'That option could not be selected. Try again.')
    })
  }

  const openLink = (url: string) => {
    setLinkError(undefined)
    void openExactExternalStep(url).catch(() => {
      setLinkError('That shop link could not open. Try again.')
    })
  }

  useImperativeHandle(ref, () => ({
    openStep: (target) => {
      if (editDisabled) return false
      if (target === 'buyer') { openBuyer(); return true }
      const method = methods.find((candidate) => candidate.type === 'shipping' && candidate.id)
      if (!method && !purchase.canAddShippingAddress) return false
      openAddress(method, method ? shippingDestination(selectedDestination(method)) : undefined)
      return true
    },
    openRequiredStep: () => {
      if (editDisabled) return false
      if (buyerMessages.length > 0) {
        openBuyer()
        return true
      }
      if (purchase.canAddShippingAddress) {
        openAddress()
        return true
      }
      const addressMessage = fulfillmentMessages.some((message) => pathMentions(
        message.path,
        'destination',
        'address',
        'street',
        'locality',
        'region',
        'postal',
        'country'
      ))
      const method = methods.find((candidate) => {
        if (candidate.type !== 'shipping') return false
        return addressMessage || !selectedDestination(candidate)
      })
      if (method) {
        openAddress(method, shippingDestination(selectedDestination(method)))
        return true
      }
      if (!summary && methods.length === 0) {
        openBuyer()
        return true
      }
      return false
    }
  }), [buyerMessages.length, editDisabled, fulfillmentMessages, methods, openAddress, openBuyer, purchase.canAddShippingAddress, summary])

  return (
    <>
      <View className="mt-6 gap-4 border-t border-line pt-5">
        <View className="flex-row items-start justify-between gap-4">
          <View className="min-w-0 flex-1">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-[15px] font-semibold leading-5 text-ink-950">Contact</Text>
            </View>
            <Text className={`mt-1 text-[13px] leading-[18px] ${summary ? 'text-ink-600' : 'text-ink-400'}`}>
              {summary || 'Email or phone for order updates.'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${summary ? 'Edit' : 'Add'} contact details${buyerMessages.length ? '. The shop needs more information' : ''}`}
            accessibilityState={{ disabled: editDisabled }}
            disabled={editDisabled}
            hitSlop={6}
            onPress={openBuyer}
            className={`min-h-11 min-w-11 items-center justify-center ${editDisabled ? 'opacity-40' : ''}`}
          >
            <Text className="text-[14px] font-semibold leading-5 text-arro-700">{summary ? 'Edit' : 'Add'}</Text>
          </Pressable>
        </View>
        {buyerDisclosures.map((message, index) => (
          <CheckoutMessageCard
            key={`${message.code ?? 'buyer-disclosure'}:${message.path ?? ''}:${index}`}
            message={message}
            onOpen={openLink}
          />
        ))}

        {methods.length || availableMethods.length || fulfillmentDisclosures.length || purchase.canAddShippingAddress ? (
          <View className="gap-3 border-t border-line pt-5">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-[15px] font-semibold leading-5 text-ink-950">
                {methods.some((method) => method.type !== 'shipping') ? 'Delivery or pickup' : 'Delivery'}
              </Text>
            </View>
            {selectionError ? <Notice tone="danger" icon="alert">{selectionError}</Notice> : null}
            {purchase.canAddShippingAddress ? (
              <View className="gap-3">
                <Button variant="outline" size="sm" disabled={editDisabled} onPress={() => openAddress()}>
                  Add delivery address
                </Button>
              </View>
            ) : null}
            {fulfillmentDisclosures.map((message, index) => (
              <CheckoutMessageCard
                key={`${message.code ?? 'fulfillment-disclosure'}:${message.path ?? ''}:${index}`}
                message={message}
                onOpen={openLink}
              />
            ))}

            {methods.map((method, methodIndex) => {
              const selected = methodSummary(method)
              const destinations = method.destinations ?? []
              const hasShippingDestination = destinations.some(isShippingDestination)
              const isShippingMethod = method.type === 'shipping'
              const canEditMethod = Boolean(method.id) && !editDisabled

              return (
                <View key={method.id ?? `${method.type}:${methodIndex}`} className="gap-3 rounded-2xl bg-fill-soft p-4">
                  <View className="flex-row items-start gap-3">
                    <View className="h-9 w-9 items-center justify-center rounded-full bg-white">
                      <Icon name={isShippingMethod ? 'truck' : 'store'} size={17} color={color.ink800} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[14px] font-semibold leading-5 text-ink-950">{methodTitle(method.type)}</Text>
                      <Text className={`mt-0.5 text-[12px] leading-4 ${selected ? 'text-ink-600' : 'text-ink-400'}`}>
                        {selected || 'Choose the details below.'}
                      </Text>
                    </View>
                  </View>

                  {destinations.length ? (
                    <View accessibilityRole="radiogroup" className="gap-2">
                      {destinations.map((destination, destinationIndex) => {
                        const id = destinationId(destination)
                        const shipping = shippingDestination(destination)
                        return (
                          <DestinationRow
                            key={id ?? `${destination.type}:${destinationIndex}`}
                            destination={destination}
                            selected={Boolean(id && id === method.selected_destination_id)}
                            disabled={!canEditMethod}
                            {...(id ? { onSelect: () => selectDestination(method, destination) } : {})}
                            {...(isShippingMethod && shipping
                              ? { onEdit: () => openAddress(method, shipping) }
                              : {})}
                          />
                        )
                      })}
                    </View>
                  ) : null}

                  {isShippingMethod && !hasShippingDestination ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!canEditMethod}
                      onPress={() => openAddress(method)}
                    >
                      Add delivery address
                    </Button>
                  ) : null}

                  {method.groups?.map((group, groupIndex) => {
                    const itemNames = (group.line_item_ids ?? [])
                      .map((lineId) => purchase.items.find((item) => item.lineItemId === lineId)?.title)
                      .filter((value): value is string => Boolean(value))
                    return (
                      <View key={group.id} className="gap-2">
                        <Text className="text-[12px] font-semibold uppercase leading-4 tracking-[0.5px] text-ink-400">
                          {itemNames.length ? `For ${itemNames.join(', ')}` : method.groups!.length > 1 ? `Package ${groupIndex + 1}` : 'Speed'}
                        </Text>
                        <View accessibilityRole="radiogroup" className="gap-2">
                          {(group.options ?? []).map((option) => (
                            <OptionRow
                              key={option.id}
                              option={option}
                              selected={group.selected_option_id === option.id}
                              disabled={!canEditMethod}
                              currency={checkoutCurrency}
                              onSelect={() => selectOption(method, group.id, option.id)}
                            />
                          ))}
                        </View>
                      </View>
                    )
                  })}
                </View>
              )
            })}

            {availableMethods.length ? (
              <View className="gap-2 border-t border-line pt-3">
                <Text className="text-[12px] font-semibold uppercase leading-4 tracking-[0.5px] text-ink-400">Other availability</Text>
                {availableMethods.map((method, index) => {
                  const detail = method.description || availableMethodTiming(method.fulfillable_on)
                  return (
                    <View key={`${method.type}:${index}`} className="min-h-11 flex-row items-center gap-3 rounded-xl px-1">
                      <Icon name="info" size={15} color={color.ink400} />
                      <View className="min-w-0 flex-1">
                        <Text className="text-[13px] font-medium leading-[18px] text-ink-800">{methodTitle(method.type)}</Text>
                        {detail ? <Text className="text-[12px] leading-4 text-ink-400">{detail}</Text> : null}
                      </View>
                    </View>
                  )
                })}
              </View>
            ) : null}
          </View>
        ) : null}

        {purchase.links.length || purchase.policies?.length || shopDisclosures.length ? (
          <View className="gap-2 border-t border-line pt-5">
            <Text className="mb-1 text-[15px] font-semibold leading-5 text-ink-950">Shop information</Text>
            {shopDisclosures.map((message, index) => (
              <CheckoutMessageCard
                key={`${message.code ?? 'shop-disclosure'}:${message.path ?? ''}:${index}`}
                message={message}
                onOpen={openLink}
              />
            ))}
            {purchase.links.map((link, index) => (
              <Pressable
                key={`${link.type}:${link.url}:${index}`}
                accessibilityRole="link"
                accessibilityLabel={`${linkTitle(link.type, link.title)}. Opens shop website`}
                onPress={() => openLink(link.url)}
                className="min-h-11 flex-row items-center justify-between gap-3 rounded-xl px-1"
              >
                <Text className="min-w-0 flex-1 text-[14px] font-medium leading-5 text-ink-800">{linkTitle(link.type, link.title)}</Text>
                <Icon name="external" size={15} color={color.ink400} />
              </Pressable>
            ))}
            {purchase.policies?.map((policy, index) => {
              const title = linkTitle(policy.type, undefined)
              const description = descriptionText(policy.description)
              const content = (
                <>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[14px] font-medium leading-5 text-ink-800">{title}</Text>
                    {description ? <Text className="mt-0.5 text-[12px] leading-4 text-ink-600">{description}</Text> : null}
                  </View>
                  {policy.url ? <Icon name="external" size={15} color={color.ink400} /> : null}
                </>
              )
              return policy.url ? (
                <Pressable
                  key={`${policy.type}:${policy.url}:${index}`}
                  accessibilityRole="link"
                  accessibilityLabel={`${title}${description ? `. ${description}` : ''}. Opens shop website`}
                  onPress={() => openLink(policy.url!)}
                  className="min-h-11 flex-row items-center justify-between gap-3 rounded-xl px-1 py-2"
                >
                  {content}
                </Pressable>
              ) : (
                <View key={`${policy.type}:${index}`} className="min-h-11 flex-row items-start gap-3 px-1 py-2">
                  {content}
                </View>
              )
            })}
          </View>
        ) : null}
        {linkError ? <Notice tone="danger" icon="alert">{linkError}</Notice> : null}
      </View>

      <Sheet
        visible={buyerOpen}
        title="Contact details"
        dismissible={!working}
        onClose={() => !working && setBuyerOpen(false)}
        maxHeight="92%"
        footer={(
          <Button fullWidth loading={working} disabled={disabled} onPress={() => void saveBuyer()}>
            Save contact details
          </Button>
        )}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="shrink">
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, gap: 14 }}
          >
            {editorError ? <Notice tone="danger" icon="alert">{editorError}</Notice> : attempted && buyerMessages.length ? (
              <Notice tone="warning" icon="alert">
                {buyerMessages.map((message) => message.text).join('\n')}
              </Notice>
            ) : null}
            {showBuyerNames ? <View className={compact ? 'gap-3' : 'flex-row gap-3'}>
              <LabeledField
                label="First name"
                value={buyerDraft.first_name}
                placeholder="First name"
                needed={buyerNeeds('first_name')}
                onChangeText={(first_name) => setBuyerDraft((current) => ({ ...current, first_name }))}
                autoCapitalize="words"
                autoComplete="given-name"
              />
              <LabeledField
                label="Last name"
                value={buyerDraft.last_name}
                placeholder="Last name"
                needed={buyerNeeds('last_name')}
                onChangeText={(last_name) => setBuyerDraft((current) => ({ ...current, last_name }))}
                autoCapitalize="words"
                autoComplete="family-name"
              />
            </View> : null}
            {showEmail ? <LabeledField
              label="Email"
              value={buyerDraft.email}
              placeholder="you@example.com"
              needed={buyerNeeds('email')}
              onChangeText={(email) => setBuyerDraft((current) => ({ ...current, email }))}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            /> : null}
            {showPhone ? <LabeledField
              label="Phone"
              value={buyerDraft.phone_number}
              placeholder="+1 555 000 0000"
              needed={buyerNeeds('phone_number')}
              onChangeText={(phone_number) => setBuyerDraft((current) => ({ ...current, phone_number }))}
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoComplete="tel"
            /> : null}
            {!buyerNeeds('email') && !buyerNeeds('phone_number') ? (
              <Button variant="ghost" size="sm" disabled={working} onPress={() => {
                setContactMethod((current) => current === 'email' ? 'phone' : 'email')
                setEditorError(undefined)
              }}>
                {contactMethod === 'email' ? 'Use phone instead' : 'Use email instead'}
              </Button>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      </Sheet>

      <Sheet
        visible={Boolean(addressEditor)}
        title="Delivery address"
        dismissible={!working}
        onClose={() => !working && setAddressEditor(undefined)}
        maxHeight="94%"
        footer={(
          <Button fullWidth loading={working} disabled={disabled} onPress={() => void saveAddress()}>
            Save delivery address
          </Button>
        )}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="shrink">
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20, gap: 14 }}
          >
            {editorError ? <Notice tone="danger" icon="alert">{editorError}</Notice> : attempted && fulfillmentMessages.length ? (
              <Notice tone="warning" icon="alert">
                {fulfillmentMessages.map((message) => message.text).join('\n')}
              </Notice>
            ) : null}
            <View className={compact ? 'gap-3' : 'flex-row gap-3'}>
              <LabeledField
                label="First name"
                value={addressEditor?.draft.first_name ?? ''}
                placeholder="First name"
                needed={inputMessages.some((message) => pathMentions(message.path, 'fulfillmentfirstname', 'destinationsfirstname'))}
                onChangeText={(first_name) => setAddressEditor((current) => current ? ({ ...current, draft: { ...current.draft, first_name } }) : current)}
                autoCapitalize="words"
                autoComplete="given-name"
              />
              <LabeledField
                label="Last name"
                value={addressEditor?.draft.last_name ?? ''}
                placeholder="Last name"
                needed={inputMessages.some((message) => pathMentions(message.path, 'fulfillmentlastname', 'destinationslastname'))}
                onChangeText={(last_name) => setAddressEditor((current) => current ? ({ ...current, draft: { ...current.draft, last_name } }) : current)}
                autoCapitalize="words"
                autoComplete="family-name"
              />
            </View>
            <LabeledField
              label="Street address"
              value={addressEditor?.draft.street_address ?? ''}
              placeholder="Street and number"
              needed={inputMessages.some((message) => pathMentions(message.path, 'streetaddress'))}
              onChangeText={(street_address) => setAddressEditor((current) => current ? ({ ...current, draft: { ...current.draft, street_address } }) : current)}
              autoComplete="street-address"
            />
            <LabeledField
              label="Apartment, suite or unit"
              value={addressEditor?.draft.extended_address ?? ''}
              placeholder="Optional"
              needed={inputMessages.some((message) => pathMentions(message.path, 'extendedaddress'))}
              onChangeText={(extended_address) => setAddressEditor((current) => current ? ({ ...current, draft: { ...current.draft, extended_address } }) : current)}
              autoComplete="address-line2"
            />
            <View className={compact ? 'gap-3' : 'flex-row gap-3'}>
              <LabeledField
                label="City or locality"
                value={addressEditor?.draft.address_locality ?? ''}
                placeholder="City"
                needed={inputMessages.some((message) => pathMentions(message.path, 'addresslocality'))}
                onChangeText={(address_locality) => setAddressEditor((current) => current ? ({ ...current, draft: { ...current.draft, address_locality } }) : current)}
                autoComplete="postal-address-locality"
              />
              <LabeledField
                label="State or region"
                value={addressEditor?.draft.address_region ?? ''}
                placeholder="State or region"
                needed={inputMessages.some((message) => pathMentions(message.path, 'addressregion'))}
                onChangeText={(address_region) => setAddressEditor((current) => current ? ({ ...current, draft: { ...current.draft, address_region } }) : current)}
                autoComplete="postal-address-region"
              />
            </View>
            <View className={compact ? 'gap-3' : 'flex-row gap-3'}>
              <LabeledField
                label="Postal code"
                value={addressEditor?.draft.postal_code ?? ''}
                placeholder="Postal code"
                needed={inputMessages.some((message) => pathMentions(message.path, 'postalcode'))}
                onChangeText={(postal_code) => setAddressEditor((current) => current ? ({ ...current, draft: { ...current.draft, postal_code } }) : current)}
                autoCapitalize="characters"
                autoComplete="postal-code"
              />
              <LabeledField
                label="Country or region"
                value={addressEditor?.draft.address_country ?? ''}
                placeholder="Two-letter code, e.g. US or NP"
                needed={inputMessages.some((message) => pathMentions(message.path, 'addresscountry'))}
                onChangeText={(address_country) => setAddressEditor((current) => current ? ({ ...current, draft: { ...current.draft, address_country } }) : current)}
                autoCapitalize="characters"
                autoComplete="postal-address-country"
              />
            </View>
            <LabeledField
              label="Phone"
              value={addressEditor?.draft.phone_number ?? ''}
              placeholder="+1 555 000 0000"
              needed={inputMessages.some((message) => pathMentions(message.path, 'fulfillmentphone', 'destinationsphone'))}
              onChangeText={(phone_number) => setAddressEditor((current) => current ? ({ ...current, draft: { ...current.draft, phone_number } }) : current)}
              keyboardType="phone-pad"
              autoCapitalize="none"
              autoComplete="tel"
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Sheet>
    </>
  )
})
