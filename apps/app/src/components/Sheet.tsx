import type { PropsWithChildren, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Modal, PanResponder, Platform, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLayoutMode } from '../lib/layout'
import { duration, easing, useReducedMotion } from '../lib/motion'
import { color } from '../lib/theme'
import { Icon } from './Icon'

type SheetProps = PropsWithChildren<{
  visible: boolean
  title: string
  onClose: () => void
  footer?: ReactNode
  maxHeight?: number | `${number}%`
  dismissible?: boolean
}>

const nativeDriver = Platform.OS !== 'web'
const enterDuration = duration.slow
const exitDuration = duration.base

/**
 * One overlay, two shapes.
 *
 * A phone gets a bottom sheet, because the thumb is at the bottom and the sheet
 * arrives from the edge it will be dismissed towards. A pointer gets a centred
 * dialog, because a panel pinned to the bottom of a 1400px window is a phone
 * pattern wearing a desktop coat: it puts the content furthest from the cursor
 * and leaves most of the screen doing nothing.
 */
export function Sheet({
  visible,
  title,
  onClose,
  children,
  footer,
  maxHeight = '86%',
  dismissible = true
}: SheetProps) {
  const { compact } = useLayoutMode()
  const insets = useSafeAreaInsets()
  const reduced = useReducedMotion()
  const [mounted, setMounted] = useState(visible)
  const backdrop = useRef(new Animated.Value(visible ? 1 : 0)).current
  const panel = useRef(new Animated.Value(visible ? 1 : 0)).current
  const closeButton = useRef<View>(null)
  /** Live drag offset, in points, while a downward swipe is in progress. */
  const drag = useRef(new Animated.Value(0)).current

  /**
   * Swipe down to dismiss. A sheet that arrives from the bottom edge should
   * leave the same way — closing it by hunting for a small × is the difference
   * between a panel that feels attached to your thumb and one that does not.
   *
   * Only vertical drags are claimed, so a horizontal rail inside the sheet
   * keeps its own scrolling, and only a real throw or a drag past a third of
   * the way closes it; anything less springs back.
   */
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) =>
      dismissible && compact && gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.5,
    onPanResponderMove: (_event, gesture) => {
      if (gesture.dy > 0) drag.setValue(gesture.dy)
    },
    onPanResponderRelease: (_event, gesture) => {
      const dismissed = gesture.dy > 120 || gesture.vy > 0.8
      if (dismissed) {
        Animated.timing(drag, {
          toValue: 600,
          duration: duration.base,
          easing: easing.exit,
          useNativeDriver: nativeDriver
        }).start(onClose)
        return
      }
      Animated.spring(drag, { toValue: 0, useNativeDriver: nativeDriver, speed: 30, bounciness: 6 }).start()
    },
    onPanResponderTerminate: () => {
      Animated.spring(drag, { toValue: 0, useNativeDriver: nativeDriver, speed: 30, bounciness: 6 }).start()
    }
  }), [compact, dismissible, drag, onClose])

  useEffect(() => {
    if (visible) drag.setValue(0)
  }, [drag, visible])

  useEffect(() => {
    if (visible) setMounted(true)
  }, [visible])

  useEffect(() => {
    if (!visible || !mounted) return
    const timer = setTimeout(() => {
      ;(closeButton.current as unknown as { focus?: () => void } | null)?.focus?.()
    }, 0)
    return () => clearTimeout(timer)
  }, [mounted, visible])

  useEffect(() => {
    if (!mounted) return

    backdrop.stopAnimation()
    panel.stopAnimation()

    const toValue = visible ? 1 : 0
    if (reduced) {
      backdrop.setValue(toValue)
      panel.setValue(toValue)
    } else {
      const time = visible ? enterDuration : exitDuration
      const curve = visible ? easing.enter : easing.exit
      Animated.parallel([
        Animated.timing(backdrop, { toValue, duration: time, easing: curve, useNativeDriver: nativeDriver }),
        Animated.timing(panel, { toValue, duration: time, easing: curve, useNativeDriver: nativeDriver })
      ]).start()
    }

    if (visible) return
    // Unmount on a timer rather than the animation callback: animation progress
    // depends on frames, and a backgrounded tab stops producing them, which
    // would otherwise leave a dismissed panel mounted over the page.
    const timer = setTimeout(() => setMounted(false), reduced ? 0 : exitDuration)
    return () => clearTimeout(timer)
  }, [backdrop, mounted, panel, reduced, visible])

  if (!mounted) return null

  const backdropOpacity = backdrop.interpolate({ inputRange: [0, 1], outputRange: [0, compact ? 0.34 : 0.28] })
  const motion = compact
    ? {
        transform: [{
          translateY: Animated.add(
            panel.interpolate({ inputRange: [0, 1], outputRange: [48, 0] }),
            drag
          )
        }]
      }
    : {
        opacity: panel,
        transform: [{ scale: panel.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }]
      }

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      accessibilityLabel={title}
      aria-label={title}
      onRequestClose={() => dismissible && onClose()}
    >
      <View className={`flex-1 ${compact ? 'justify-end' : 'items-center justify-center p-6'}`}>
        <Animated.View
          className="absolute inset-0 bg-black"
          style={{ opacity: backdropOpacity, pointerEvents: 'none' }}
        />
        <Pressable
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          aria-hidden
          focusable={false}
          tabIndex={-1}
          disabled={!dismissible}
          onPress={onClose}
          className="absolute inset-0"
        />
        <Animated.View
          className={compact
            ? 'w-full overflow-hidden rounded-t-3xl bg-white'
            : 'w-full max-w-[520px] overflow-hidden rounded-3xl border border-line bg-white'}
          style={[{ maxHeight }, motion]}
        >
          {compact ? (
            <View className="items-center pt-3" {...pan.panHandlers}>
              <View className="h-1 w-9 rounded-full bg-line-strong" />
              {/* The grab area is the handle plus the header strip above the
                  content, which is what a thumb actually reaches for. */}
            </View>
          ) : null}
          <View
            {...(compact ? pan.panHandlers : {})}
            className={`flex-row items-center justify-between gap-3 px-5 pb-3 ${compact ? 'pt-3' : 'pt-5'}`}
          >
            <Text className="min-w-0 flex-1 text-[18px] font-bold leading-6 text-ink-950">{title}</Text>
            <Pressable
              ref={closeButton}
              accessibilityRole="button"
              accessibilityLabel={`Close ${title}`}
              accessibilityState={{ disabled: !dismissible }}
              disabled={!dismissible}
              hitSlop={8}
              onPress={onClose}
              className={`h-9 w-9 items-center justify-center rounded-full bg-fill ${dismissible ? '' : 'opacity-40'}`}
            >
              <Icon name="close" size={17} color={color.ink800} />
            </Pressable>
          </View>
          {children}
          {footer ? (
            <View
              className="border-t border-line bg-white px-5 pt-3"
              style={{ paddingBottom: compact ? Math.max(insets.bottom, 20) : 20 }}
            >
              {footer}
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  )
}
