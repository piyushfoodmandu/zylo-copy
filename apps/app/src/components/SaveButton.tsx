import { useEffect, useRef } from 'react'
import { Animated, Platform, Pressable } from 'react-native'
import { duration, easing, useReducedMotion } from '../lib/motion'
import { productGroupKey } from '../lib/product-groups'
import { color } from '../lib/theme'
import { useSavedStore } from '../store/useSavedStore'
import type { CatalogProductSummary } from '../types/catalog'
import { Icon } from './Icon'

const nativeDriver = Platform.OS !== 'web'

/**
 * Saving is the smallest commitment a shopper makes, and the only feedback it
 * can give is the control itself. The heart fills, kicks once and settles — the
 * whole point being that the shopper knows it landed without looking anywhere
 * else on the page.
 */
export function SaveButton({
  product,
  query,
  size = 'md',
  surface = 'floating'
}: {
  product: CatalogProductSummary
  /** The search that led here, kept as the reason the item was saved. */
  query?: string
  size?: 'sm' | 'md'
  surface?: 'floating' | 'plain' | 'outline'
  /** @deprecated Saving no longer opens the list-and-alert popover. */
  showAlert?: boolean
}) {
  const key = productGroupKey(product)
  const saved = useSavedStore((state) => state.items.some((item) => item.key === key))
  const toggle = useSavedStore((state) => state.toggle)
  const reduced = useReducedMotion()
  const pop = useRef(new Animated.Value(1)).current
  const previous = useRef(saved)

  useEffect(() => {
    const became = saved && !previous.current
    previous.current = saved
    if (!became || reduced) return
    const animation = Animated.sequence([
      Animated.timing(pop, { toValue: 1.3, duration: duration.fast, easing: easing.enter, useNativeDriver: nativeDriver }),
      Animated.spring(pop, { toValue: 1, useNativeDriver: nativeDriver, speed: 24, bounciness: 12 })
    ])
    animation.start()
    return () => animation.stop()
  }, [pop, reduced, saved])

  const box = size === 'sm' ? 'h-9 w-9' : 'h-10 w-10'
  const chrome = surface === 'floating'
    ? 'bg-white/95'
    : surface === 'outline'
      ? 'border border-line bg-white'
      : ''

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={saved ? `Remove ${product.title} from saved products` : `Save ${product.title}`}
      accessibilityState={{ selected: saved }}
      hitSlop={6}
      onPress={() => toggle(product, query ? { query } : undefined)}
      android_ripple={{ color: color.fillStrong, borderless: true }}
      style={({ pressed }) => ({ opacity: pressed ? 0.68 : 1 })}
      className={`items-center justify-center rounded-full ${box} ${chrome}`}
    >
      <Animated.View style={{ transform: [{ scale: pop }] }}>
        <Icon
          name={saved ? 'heartFill' : 'heart'}
          size={size === 'sm' ? 16 : 18}
          color={saved ? color.arro600 : color.ink800}
        />
      </Animated.View>
    </Pressable>
  )
}
