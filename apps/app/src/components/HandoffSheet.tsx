import { Text, View } from 'react-native'
import { openMerchantStep } from '../lib/external-step'
import { handoffMerchantName, handoffUrl } from '../lib/purchase-capability'
import { color } from '../lib/theme'
import type { PurchaseResponse } from '../types/purchase'
import { Sheet } from './Sheet'
import { Icon } from './Icon'
import { Button } from './ui'

/**
 * Shown when Arro asked to prepare a checkout and the shop turned out not to
 * support one. The scope rule is explicit: a missing capability is made plain
 * *before* the shopper reaches a checkout, not discovered as a failure inside
 * one. So this names the shop, says what Arro can and cannot do with it, and
 * makes leaving an explicit choice rather than a redirect.
 */
export function HandoffSheet({
  purchase,
  fallbackName,
  onClose
}: {
  purchase: PurchaseResponse | undefined
  fallbackName: string
  onClose: () => void
}) {
  const url = purchase ? handoffUrl(purchase) : undefined
  const shop = purchase ? handoffMerchantName(purchase, fallbackName) : fallbackName

  return (
    <Sheet visible={Boolean(purchase)} title="Finish at the shop" onClose={onClose}>
      <View className="gap-4 px-5 pb-6">
        <View className="flex-row items-center gap-3">
          <View className="h-11 w-11 items-center justify-center rounded-full bg-fill">
            <Icon name="store" size={20} color={color.ink800} />
          </View>
          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-[16px] font-semibold leading-6 text-ink-950">{shop}</Text>
            <Text className="text-[13px] leading-[18px] text-ink-600">Handles its own checkout</Text>
          </View>
        </View>

        <Text className="text-[14px] leading-5 text-ink-600">
          {url
            ? `Arro cannot complete this order for you — ${shop} has not opened checkout to Arro. You can still buy it there, and ${shop} stays the seller of record.`
            : `Arro cannot complete this order and ${shop} did not return a link to continue. Try another offer for this product.`}
        </Text>

        <View className="flex-row items-start gap-2.5 rounded-2xl bg-fill-soft p-3.5">
          <Icon name="info" size={15} color={color.ink600} />
          <Text className="min-w-0 flex-1 text-[12px] leading-4 text-ink-600">
            Prices and availability are confirmed by the shop. Nothing has been reserved or charged.
          </Text>
        </View>

        {url ? (
          <Button fullWidth size="lg" variant="accent" icon="external" onPress={() => void openMerchantStep(url)}>
            {`Continue to ${shop}`}
          </Button>
        ) : null}
        <Button fullWidth variant="ghost" onPress={onClose}>Back to offers</Button>
      </View>
    </Sheet>
  )
}
