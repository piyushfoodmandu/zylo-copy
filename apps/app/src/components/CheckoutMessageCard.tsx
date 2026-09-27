import { Pressable, Text, View } from 'react-native'
import { color } from '../lib/theme'
import type { PurchaseResponse } from '../types/purchase'
import { Icon } from './Icon'
import { ProductImage } from './ProductImage'

export type CheckoutMessage = PurchaseResponse['messages'][number]

export const checkoutMessagePathIncludes = (
  message: CheckoutMessage,
  ...segments: string[]
) => {
  const path = (message.path ?? '').toLocaleLowerCase().replace(/[^a-z0-9]/g, '')
  return Boolean(path && segments.some((segment) =>
    path.includes(segment.toLocaleLowerCase().replace(/[^a-z0-9]/g, ''))
  ))
}

export const checkoutMessageLineItemIndex = (message: CheckoutMessage) => {
  const match = message.path?.match(/^\$\.line_items\[(\d+)](?:\.|$)/)
  return match ? Number(match[1]) : undefined
}

const readableMessage = (message: CheckoutMessage) => {
  // Keep disclosures and specific merchant errors intact. Translate this
  // protocol-only escalation instruction into the action the shopper can take.
  if (message.presentation !== 'disclosure' &&
    message.text === 'An extension interaction is required to complete the checkout.') {
    return 'Continue with the shop to finish checkout.'
  }
  if (message.contentType !== 'markdown') return message.text
  return message.text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(^|\s)[#>*_~`-]+(?=\S)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function CheckoutMessageCard({
  message,
  onOpen,
  action
}: {
  message: CheckoutMessage
  onOpen: (url: string) => void
  action?: { label: string; onPress: () => void }
}) {
  const disclosure = message.presentation === 'disclosure'
  const tone = message.severity === 'blocked'
    ? { surface: 'bg-danger-soft', tint: color.danger }
    : message.severity === 'warning'
      ? { surface: 'bg-warning-soft', tint: color.warning }
      : { surface: 'bg-fill-soft', tint: color.ink600 }
  const imageLabel = message.code
    ? `${message.code.replaceAll('_', ' ')} information from the shop`
    : 'Additional information from the shop'

  return (
    <View
      role={message.severity === 'info' ? 'status' : 'alert'}
      accessibilityLiveRegion={message.severity === 'info' ? 'polite' : 'assertive'}
      className={`rounded-2xl p-4 ${tone.surface}`}
    >
      <View className="flex-row items-start gap-3">
        <Icon name={message.severity === 'info' ? 'info' : 'alert'} size={18} color={tone.tint} />
        <View className="min-w-0 flex-1">
          {disclosure ? (
            <Text className="mb-1 text-[13px] font-semibold leading-[18px] text-ink-950">Important information</Text>
          ) : null}
          <Text className="text-[14px] leading-5 text-ink-800">{readableMessage(message)}</Text>
          {action ? (
            <Pressable accessibilityRole="button" onPress={action.onPress} className="mt-1 min-h-11 justify-center self-start">
              <Text className="text-[13px] font-semibold leading-[18px] text-arro-700">{action.label}</Text>
            </Pressable>
          ) : null}
          {message.url ? (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="Learn more from the shop. Opens shop website"
              onPress={() => onOpen(message.url!)}
              className="mt-2 min-h-11 flex-row items-center gap-1.5 self-start"
            >
              <Text className="text-[13px] font-semibold leading-[18px] text-arro-700">Learn more</Text>
              <Icon name="external" size={14} color={color.arro700} />
            </Pressable>
          ) : null}
        </View>
      </View>
      {message.imageUrl ? (
        <View className="mt-3 overflow-hidden rounded-xl bg-white p-2">
          <ProductImage
            uri={message.imageUrl}
            alt={imageLabel}
            width={640}
            className="h-36 w-full"
          />
        </View>
      ) : null}
    </View>
  )
}
