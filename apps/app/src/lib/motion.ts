import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { AccessibilityInfo, Animated, Easing, Platform } from 'react-native'

/**
 * One motion scale for the whole app. A sheet, a card and a price update all
 * move on the same curve, so the interface reads as one object rather than a
 * pile of independently animated widgets.
 */
export const duration = {
  /** Press and hover feedback. Fast enough to feel like a physical response. */
  fast: 120,
  /** The default for anything appearing, moving or crossfading. */
  base: 200,
  /** Sheets and overlays, which travel further and deserve more time. */
  slow: 320
} as const

export const easing = {
  /** Decelerating: things entering the screen arrive and settle. */
  enter: Easing.bezier(0.22, 0.61, 0.36, 1),
  /** Accelerating: things leaving get out of the way. */
  exit: Easing.bezier(0.4, 0, 1, 1)
} as const

/** The CSS mirror of `easing.enter`, used by the web-only stylesheet. */
export const cssEase = 'cubic-bezier(0.22, 0.61, 0.36, 1)'

/**
 * Entrance delay for the nth item in a list. Capped, because a stagger that
 * keeps growing turns the twentieth card into a wait rather than a flourish.
 */
export const stagger = (index: number, step = 28, cap = 10) => Math.min(Math.max(index, 0), cap) * step

/**
 * The motion preference is a property of the device, not of a component, so it
 * is read once into a module-level store. A results grid renders a hundred
 * pressables; giving each one its own media-query listener and its own state
 * would put a hundred subscriptions behind a value that can only ever have one
 * answer.
 */
let reducedMotion = false
const motionListeners = new Set<() => void>()

const publishMotion = (value: boolean) => {
  if (value === reducedMotion) return
  reducedMotion = value
  for (const listener of motionListeners) listener()
}

const subscribeMotion = (listener: () => void) => {
  motionListeners.add(listener)
  if (motionListeners.size === 1) startWatchingMotion()
  return () => {
    motionListeners.delete(listener)
    if (motionListeners.size === 0) stopWatchingMotion()
  }
}

let stopWatching: (() => void) | undefined

const startWatchingMotion = () => {
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (event: MediaQueryListEvent) => publishMotion(event.matches)
    query.addEventListener('change', onChange)
    // Applied after subscription rather than at read time: the first render has
    // to match the server, which cannot know the preference.
    publishMotion(query.matches)
    stopWatching = () => query.removeEventListener('change', onChange)
    return
  }

  let active = true
  void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) publishMotion(value) })
  const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', publishMotion)
  stopWatching = () => {
    active = false
    subscription.remove()
  }
}

const stopWatchingMotion = () => {
  stopWatching?.()
  stopWatching = undefined
}

// The server has no motion preference, so it renders the animated tree and the
// client corrects it. A hydration mismatch is worse than one frame of movement.
const serverSnapshot = () => false

export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, () => reducedMotion, serverSnapshot)
}

/**
 * Every native skeleton on screen reads from this one driver, so a grid of
 * twenty placeholders costs one animation rather than twenty. The loop only
 * runs while something is subscribed; nothing animates behind an empty screen.
 * Web skeletons use a CSS keyframe instead and cost nothing at all.
 */
const pulse = new Animated.Value(0)
let subscribers = 0
let loop: Animated.CompositeAnimation | undefined

const still = { opacity: 1 } as const

export function useSkeletonPulse() {
  const reduced = useReducedMotion()
  const animate = !reduced && Platform.OS !== 'web'

  useEffect(() => {
    if (!animate) return
    subscribers += 1
    if (subscribers === 1) {
      loop = Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 760, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 760, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
      ]))
      loop.start()
    }
    return () => {
      subscribers -= 1
      if (subscribers > 0) return
      loop?.stop()
      loop = undefined
      pulse.setValue(0)
    }
  }, [animate])

  return useMemo(
    () => animate
      ? { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }) }
      : still,
    [animate]
  )
}
