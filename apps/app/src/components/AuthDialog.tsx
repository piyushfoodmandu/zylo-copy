import { useEffect, useRef } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { AuthPanel } from './AuthPanel'
import { Icon } from './Icon'
import { color } from '../lib/theme'

/**
 * Signing in is a detour, not a destination.
 *
 * Sending someone to a page loses whatever they were looking at. A dialog keeps
 * the product, the cart or the checkout underneath, so signing in costs nothing.
 *
 * The composition is deliberately narrow and centred: a welcome, the ways in,
 * and the terms. Anything else — a bordered card, a form standing open before
 * anyone chose email — turns thirty seconds of work into a page of admin.
 */
export function AuthDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const closeButton = useRef<View>(null)

  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => {
      ;(closeButton.current as unknown as { focus?: () => void } | null)?.focus?.()
    }, 0)
    return () => clearTimeout(timer)
  }, [visible])

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      accessibilityLabel="Sign in to Arro"
      aria-label="Sign in to Arro"
      onRequestClose={onClose}
    >
      <View className="flex-1 items-center justify-center p-4">
        <Pressable
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          aria-hidden
          focusable={false}
          tabIndex={-1}
          onPress={onClose}
          className="absolute inset-0 bg-black/40"
        />
        <View className="w-full max-w-[420px] overflow-hidden rounded-3xl bg-white">
          <View className="flex-row justify-end px-3 pt-3">
            <Pressable
              ref={closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close sign in"
              onPress={onClose}
              hitSlop={8}
              className="h-9 w-9 items-center justify-center rounded-full"
            >
              <Icon name="close" size={20} color={color.ink950} />
            </Pressable>
          </View>
          <ScrollView className="max-h-[76vh]" showsVerticalScrollIndicator={false}>
            <View className="px-7 pb-8">
              <Text className="text-center text-[28px] font-bold leading-9 tracking-[-0.6px] text-ink-950">
                Welcome
              </Text>
              <Text className="mx-auto mt-2 max-w-[320px] text-center text-[14px] leading-5 text-ink-600">
                Sign in to keep your lists and price alerts, or create an account in seconds.
              </Text>
              <View className="mt-6">
                <AuthPanel onSignedIn={onClose} />
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}
