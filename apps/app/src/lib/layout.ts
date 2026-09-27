import { createContext, createElement, type PropsWithChildren, useContext, useSyncExternalStore } from 'react'
import { Platform, useWindowDimensions } from 'react-native'

/**
 * Column counts are chosen so a product tile never falls below ~150px, which is
 * the point where a two-line title plus price stops being readable. It takes
 * the width of the *grid*, not the window: on a pointer layout the filter rail
 * has already taken 290 of them.
 */
export const gridColumns = (width: number) => {
  // Thresholds are the width at which the next column still leaves a tile wide
  // enough to read: ~280px on a desktop grid, ~170px on a phone. A phone at
  // 360px gets two columns, because one product per screen is a list, not a
  // comparison — and comparison is the entire point of the page.
  if (width >= 1440) return 5
  if (width >= 1120) return 4
  if (width >= 700) return 3
  if (width >= 360) return 2
  return 1
}

/**
 * The width assumed while no viewport has been measured. The server has no
 * window at all, so the document it renders has to commit to something, and the
 * desktop composition is the one that carries the most structure for a crawler,
 * a link preview and a reader-mode pass.
 */
export const defaultServerWidth = 1280
const InitialViewportWidth = createContext(defaultServerWidth)

/**
 * The web root seeds the width from request client hints (or the device UA as a
 * fallback). That keeps the server document and hydration tree on the same
 * structural breakpoint for real phones without teaching every component
 * about HTTP. Native ignores the provider because dimensions are measurable
 * before its first render.
 */
export function InitialViewportProvider({
  width,
  children
}: PropsWithChildren<{ width: number }>) {
  return createElement(InitialViewportWidth.Provider, { value: width }, children)
}

/**
 * Whether a real viewport exists yet. It flips exactly once, on the client, so
 * it lives in one module-level store rather than in per-component state: every
 * component that asks about layout would otherwise carry its own copy of a
 * single global fact and re-render on its own schedule.
 */
let measurable = Platform.OS !== 'web'
const listeners = new Set<() => void>()

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  if (!measurable) {
    measurable = true
    // Notified rather than read during render, so the tree React hydrates is
    // the tree the server sent.
    queueMicrotask(() => { for (const notify of listeners) notify() })
  }
  return () => { listeners.delete(listener) }
}

const snapshot = () => measurable
const serverSnapshot = () => false

/**
 * Two shells, not one stretched composition.
 *
 * `compact` is a phone: one thumb, no hover, navigation at the bottom where the
 * thumb already is, and every choice presented as a sheet. `desktop` is a
 * pointer and a keyboard: filters stay open beside the results instead of
 * costing a tap each, categories drop out of the header, and hover is a real
 * affordance. The band between them keeps desktop chrome at phone density.
 */
export function useLayoutMode() {
  const { width: measured, height } = useWindowDimensions()
  const initialWidth = useContext(InitialViewportWidth)
  const ready = useSyncExternalStore(subscribe, snapshot, serverSnapshot)
  const width = ready && measured > 0 ? measured : initialWidth

  return {
    width,
    height,
    compact: width < 768,
    tablet: width >= 768 && width < 1024,
    desktop: width >= 1024,
    wide: width >= 1400,
    columns: gridColumns(width)
  }
}
