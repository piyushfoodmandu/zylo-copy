import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Animated,
  Platform,
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent
} from 'react-native'
import { color } from '../lib/theme'
import { Icon } from './Icon'
import { Tappable } from './motion'
import { Section } from './semantic'

type Indicator = 'auto' | 'dots' | 'bar' | 'none'

export type CarouselProps<T> = {
  data: readonly T[]
  renderItem: (item: T, index: number) => ReactNode
  keyExtractor: (item: T, index: number) => string
  label: string
  /** Cell width in points, or `page` for one full-width cell at a time. */
  itemWidth: number | 'page'
  gap?: number
  indicator?: Indicator
  /** Side controls. Pointer devices get them; touch gets the swipe. */
  arrows?: boolean
  /** Controlled position, for a gallery whose thumbnails drive the rail. */
  activeIndex?: number
  onIndexChange?: (index: number) => void
  className?: string
  /** Horizontal inset so the first cell lines up with the page gutter. */
  edgePadding?: number
}

/**
 * A rail that behaves the same way everywhere: swipe on touch, snap to cells,
 * arrows on a pointer device, and a position indicator so the shopper can tell
 * how much is left. Every cell stays in the document — a rail of products is a
 * set of real links, and virtualising them would hide them from a crawler.
 *
 * Scrolling drives an `Animated.Value` rather than component state. A rail that
 * re-rendered its cells on every scroll frame would repaint a row of product
 * cards sixty times a second to move a four-pixel progress bar; only the page
 * index, which changes a handful of times per swipe, is allowed to re-render.
 */
export function Carousel<T>({
  data,
  renderItem,
  keyExtractor,
  label,
  itemWidth,
  gap = 12,
  indicator = 'auto',
  arrows = true,
  activeIndex,
  onIndexChange,
  className = '',
  edgePadding = 0
}: CarouselProps<T>) {
  const scroller = useRef<ScrollView>(null)
  const offset = useRef(0)
  const scrollX = useRef(new Animated.Value(0)).current
  const [railWidth, setRailWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const [index, setIndex] = useState(0)

  const cellWidth = itemWidth === 'page' ? Math.max(railWidth - edgePadding * 2, 1) : itemWidth
  const step = cellWidth + gap
  const maxOffset = Math.max(contentWidth - railWidth, 0)
  // Layout measurement arrives a frame late, and on the server it never arrives
  // at all. Until then the rail renders from what it does know: how many items
  // it was given.
  const measured = railWidth > 0 && contentWidth > 0
  const pages = measured && step > 0
    ? Math.max(1, Math.ceil((maxOffset + cellWidth) / step))
    : Math.max(1, data.length)

  const stepRef = useRef(step)
  stepRef.current = step

  const onScroll = useMemo(() => Animated.event(
    [{ nativeEvent: { contentOffset: { x: scrollX } } }],
    {
      useNativeDriver: false,
      listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        const x = event.nativeEvent.contentOffset.x
        offset.current = x
        const next = stepRef.current > 0 ? Math.round(x / stepRef.current) : 0
        setIndex((current) => current === next ? current : next)
      }
    }
  ), [scrollX])

  const onRailLayout = useCallback((event: LayoutChangeEvent) => {
    setRailWidth(event.nativeEvent.layout.width)
  }, [])

  const onContentLayout = useCallback((event: LayoutChangeEvent) => {
    setContentWidth(event.nativeEvent.layout.width)
  }, [])

  const scrollTo = useCallback((x: number) => {
    const clamped = Math.max(0, Math.min(x, maxOffset))
    offset.current = clamped
    scroller.current?.scrollTo({ x: clamped, animated: true })
  }, [maxOffset])

  // A controlled index scrolls the rail; a scrolled rail reports its index.
  useEffect(() => {
    if (activeIndex === undefined || step <= 0 || activeIndex === index) return
    // Before the rail reports its size there is no end to clamp against, and
    // clamping to a zero maximum would pin every jump to the first cell.
    const wanted = activeIndex * step
    setIndex(activeIndex)
    offset.current = wanted
    scroller.current?.scrollTo({
      x: maxOffset > 0 ? Math.min(wanted, maxOffset) : wanted,
      animated: true
    })
    // `index` is deliberately absent: it is the value this effect writes, and
    // reacting to it would make the rail chase its own scroll animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, maxOffset, step])

  const reported = useRef(index)
  useEffect(() => {
    if (reported.current === index) return
    reported.current = index
    onIndexChange?.(index)
  }, [index, onIndexChange])

  const atStart = index <= 0
  const atEnd = index >= pages - 1
  const scrollable = maxOffset > 1
  // A rail of products shows its position by peeking the next card and by its
  // arrows. A progress bar under it reads as a scrollbar someone forgot to
  // hide, which is most of why the old rail looked dated.
  const mode: Exclude<Indicator, 'auto'> = indicator === 'auto'
    ? (measured && !scrollable ? 'none' : data.length <= 6 ? 'dots' : 'none')
    : indicator
  // Arrow controls are a pointer affordance. On touch the swipe is the control,
  // and a button parked over the content is one more thing to mis-tap.
  const showArrows = arrows && measured && scrollable && Platform.OS === 'web'

  const barWidth = measured ? Math.max(0.12, railWidth / contentWidth) : 0
  const barStyle = useMemo(() => ({
    width: `${Math.round(barWidth * 100)}%` as const,
    transform: [{
      translateX: maxOffset > 0
        ? scrollX.interpolate({
            inputRange: [0, maxOffset],
            outputRange: [0, Math.max(railWidth * (1 - barWidth), 0)],
            extrapolate: 'clamp' as const
          })
        : 0
    }]
  }), [barWidth, maxOffset, railWidth, scrollX])

  return (
    <Section label={label} className={className}>
      <View onLayout={onRailLayout}>
        <ScrollView
          ref={scroller}
          horizontal
          onScroll={onScroll}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={step}
          snapToAlignment="start"
          disableIntervalMomentum
          className="arro-rail arro-snap"
        >
          {/* Measured here rather than through `onContentSizeChange`, so the
              rail depends on one layout mechanism instead of two. */}
          <View
            onLayout={onContentLayout}
            className="arro-snap-items flex-row"
            style={{ gap, paddingHorizontal: edgePadding }}
          >
            {data.map((item, itemIndex) => (
              <View key={keyExtractor(item, itemIndex)} style={{ width: cellWidth }}>
                {renderItem(item, itemIndex)}
              </View>
            ))}
          </View>
        </ScrollView>

        {showArrows ? (
          <>
            <View className="absolute inset-y-0 left-0 justify-center" style={{ pointerEvents: 'box-none' }}>
              <Tappable
                accessibilityLabel={`Previous ${label}`}
                disabled={atStart}
                onPress={() => scrollTo(offset.current - Math.max(step, railWidth - step))}
                className={`arro-raise -ml-4 h-10 w-10 items-center justify-center rounded-full bg-white ${atStart ? 'opacity-0' : ''}`}
              >
                <Icon name="chevronLeft" size={18} color={color.ink950} />
              </Tappable>
            </View>
            <View className="absolute inset-y-0 right-0 justify-center" style={{ pointerEvents: 'box-none' }}>
              <Tappable
                accessibilityLabel={`Next ${label}`}
                disabled={atEnd}
                onPress={() => scrollTo(offset.current + Math.max(step, railWidth - step))}
                className={`arro-raise -mr-4 h-10 w-10 items-center justify-center rounded-full bg-white ${atEnd ? 'opacity-0' : ''}`}
              >
                <Icon name="chevronRight" size={18} color={color.ink950} />
              </Tappable>
            </View>
          </>
        ) : null}
      </View>

      {mode === 'dots' ? (
        // Fixed geometry. An active dot that grows wider re-lays-out the whole
        // row on every swipe, which is the stutter — colour and scale do not.
        <View className="mt-3 flex-row items-center justify-center gap-2" aria-hidden>
          {Array.from({ length: pages }, (_, page) => (
            <View
              key={page}
              className={`h-1.5 w-1.5 rounded-full ${page === index ? 'bg-arro-600' : 'bg-line-strong'}`}
              style={{ transform: [{ scale: page === index ? 1.5 : 1 }] }}
            />
          ))}
        </View>
      ) : null}

      {mode === 'bar' && measured ? (
        <View className="mt-3 h-1 overflow-hidden rounded-full bg-fill" aria-hidden>
          <Animated.View className="h-full rounded-full bg-ink-800" style={barStyle} />
        </View>
      ) : null}
    </Section>
  )
}
