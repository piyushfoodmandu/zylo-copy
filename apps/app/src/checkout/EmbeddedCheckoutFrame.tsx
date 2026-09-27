import type { ReactNode } from 'react'
import { ActivityIndicator, Text, View } from 'react-native'
import { Button, Notice } from '../components/ui'
import { color } from '../lib/theme'
import type { EmbeddedCheckoutProps } from './useEmbeddedCheckout'

export const EmbeddedCheckoutFrame = ({
  merchantName, onClose, onOpenBrowser, active, failure, recoveryUrl, children
}: EmbeddedCheckoutProps & {
  active: boolean
  failure?: string
  recoveryUrl: string
  children: ReactNode
}) => (
  <View className="flex-1 bg-white">
    <View className="flex-row items-center justify-between gap-3 border-b border-line px-4 py-3">
      <View className="flex-1">
        <Text accessibilityRole="header" className="text-[17px] font-semibold text-ink-950">Checkout with {merchantName}</Text>
        <Text className="mt-0.5 text-[12px] text-ink-600">The shop securely handles your payment and order.</Text>
      </View>
      <Button variant="ghost" size="sm" onPress={onClose}>Close</Button>
    </View>
    {failure ? (
      <View className="flex-1 justify-center gap-4 p-6">
        <Notice tone="warning">{failure}</Notice>
        <Button fullWidth onPress={() => onOpenBrowser(recoveryUrl)}>Continue on the shop’s site</Button>
        <Button fullWidth variant="outline" onPress={onClose}>Back to checkout</Button>
      </View>
    ) : (
      <>
        {!active && (
          <View accessibilityRole="progressbar" accessibilityLabel="Opening the shop’s checkout" className="flex-row items-center justify-center gap-2 py-3">
            <ActivityIndicator size="small" color={color.ink600} />
            <Text className="text-[13px] text-ink-600">Opening secure checkout…</Text>
          </View>
        )}
        {children}
      </>
    )}
  </View>
)
