import type { PropsWithChildren, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Animated, Platform, Pressable } from 'react-native'
import { duration, easing, useReducedMotion } from '../lib/motion'

const AnimatedPressable = Animated.createAnimatedComponent(Pressable)

// Transform and opacity are the only two properties the native driver can own,
// which is exactly why every animation in this file is built from them.
const nativeDriver = Platform.OS !== 'web'

/**
 * Fade and rise on mount. Used for page sections, rows and the first screenful
 * of a grid — never for an unbounded list, where a stagger stops reading as a
 * flourish and starts reading as lag.
 */
export const Appear = ({
  children,
  className,
  delay = 0,
  distance = 10
}: PropsWithChildren<{ className?: string; delay?: number; distance?: number }>) => {
  const reduced = useReducedMotion()
  // Server-rendered content must be useful before JavaScript arrives. Starting
  // a web tree at opacity zero hid headings, products and recovery copy from a
  // slow/no-JS visit and caused a needless paint shift during hydration.
  // Native still gets the short entrance motion where there is no SSR document.
  const progress = useRef(new Animated.Value(Platform.OS === 'web' ? 1 : 0)).current

  useEffect(() => {
    if (Platform.OS === 'web' || reduced) {
      progress.setValue(1)
      return
    }
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: duration.slow,
      delay,
      easing: easing.enter,
      useNativeDriver: nativeDriver
    })
    animation.start()
    return () => animation.stop()
  }, [delay, progress, reduced])

  // Rebuilt only when the distance changes. An inline style object would hand
  // Animated a new node on every parent render and re-attach the driver.
  const style = useMemo(() => ({
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }]
  }), [distance, progress])

  return (
    <Animated.View {...(className ? { className } : {})} style={style}>
      {children}
    </Animated.View>
  )
}

/**
 * A pressable that acknowledges the touch before the navigation resolves. The
 * spring is the whole point: a control that only changes on release feels like
 * a picture of a button, and the delay a route change costs is exactly the gap
 * this fills.
 */
export const Tappable = ({
  children,
  onPress,
  onLongPress,
  className,
  scale = 0.97,
  disabled = false,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  hitSlop,
  tooltip
}: PropsWithChildren<{
  onPress?: () => void
  onLongPress?: () => void
  className?: string
  scale?: number
  disabled?: boolean
  accessibilityLabel?: string
  accessibilityRole?: 'button' | 'link' | 'tab'
  accessibilityState?: { selected?: boolean; disabled?: boolean; expanded?: boolean }
  hitSlop?: number
  /**
   * A hover tooltip on the web. `accessibilityLabel` reaches a screen reader but
   * never a pointer, so an icon-only control stays a guess for the sighted
   * shopper who is unsure what it does. Defaults to the accessible name so the
   * two can never drift apart.
   */
  tooltip?: string
}>) => {
  const reduced = useReducedMotion()
  const press = useRef(new Animated.Value(0)).current
  // Compact 36px pills keep the visual rhythm, while native still receives the
  // 44px effective touch target people expect from platform controls.
  const resolvedHitSlop = hitSlop ?? (Platform.OS === 'web' ? undefined : 4)

  const settle = useCallback((toValue: number) => {
    if (reduced) return
    Animated.spring(press, {
      toValue,
      useNativeDriver: nativeDriver,
      speed: 42,
      bounciness: 0
    }).start()
  }, [press, reduced])

  const pressIn = useCallback(() => settle(1), [settle])
  const pressOut = useCallback(() => settle(0), [settle])

  const style = useMemo(() => ({
    transform: [{ scale: press.interpolate({ inputRange: [0, 1], outputRange: [1, scale] }) }],
    opacity: press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] })
  }), [press, scale])

  // React Native exposes selected/expanded state to native assistive tech, but
  // React Native Web does not consistently translate every combination. Emit
  // the matching ARIA state explicitly so toggle chips and tabs do not become
  // unnamed plain buttons in the server-rendered document.
  const webAccessibilityState = Platform.OS === 'web' ? {
    ...(accessibilityRole === 'tab' && accessibilityState?.selected !== undefined
      ? { 'aria-selected': accessibilityState.selected }
      : {}),
    ...(accessibilityRole === 'button' && accessibilityState?.selected !== undefined
      ? { 'aria-pressed': accessibilityState.selected }
      : {}),
    ...(accessibilityState?.expanded !== undefined
      ? { 'aria-expanded': accessibilityState.expanded }
      : {}),
    ...(accessibilityState?.disabled !== undefined
      ? { 'aria-disabled': accessibilityState.disabled }
      : {})
  } : {}

  return (
    <AnimatedPressable
      accessibilityRole={accessibilityRole}
      {...(accessibilityLabel ? { accessibilityLabel } : {})}
      {...(Platform.OS === 'web' && (tooltip ?? accessibilityLabel)
        ? ({ title: tooltip ?? accessibilityLabel } as object)
        : {})}
      {...(accessibilityState ? { accessibilityState } : {})}
      {...webAccessibilityState}
      {...(resolvedHitSlop ? { hitSlop: resolvedHitSlop } : {})}
      {...(onLongPress ? { onLongPress } : {})}
      disabled={disabled}
      onPress={onPress}
      onPressIn={pressIn}
      onPressOut={pressOut}
      {...(className ? { className } : {})}
      style={style}
    >
      {children}
    </AnimatedPressable>
  )
}

/**
 * Crossfades whenever `value` changes. Used where a number is replaced rather
 * than edited — a revalidated price, a running total — so the change registers
 * as an event instead of silently swapping under the shopper's eyes.
 */
export const Swap = ({ value, children }: { value: string | number; children: ReactNode }) => {
  const reduced = useReducedMotion()
  const progress = useRef(new Animated.Value(1)).current
  const previous = useRef(value)

  useEffect(() => {
    if (previous.current === value) return
    previous.current = value
    if (reduced) return
    progress.setValue(0)
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: duration.base,
      easing: easing.enter,
      useNativeDriver: nativeDriver
    })
    animation.start()
    return () => animation.stop()
  }, [progress, reduced, value])

  const style = useMemo(() => ({
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }]
  }), [progress])

  return <Animated.View style={style}>{children}</Animated.View>
}
