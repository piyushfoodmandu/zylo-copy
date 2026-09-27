import { createElement, useCallback, useEffect, useRef, type MouseEvent, type PropsWithChildren } from 'react'
import { usePathname, useRouter } from 'expo-router'

/**
 * The gap between "the pointer is over this" and "they meant it". Under this the
 * pointer is travelling somewhere else and the fetch is waste; over it the
 * shopper has read the card and the click is coming.
 */
const intentMs = 90

/**
 * A real anchor, not a Pressable dressed as one. Expo Router's `Link` with
 * `asChild` hands the href to a `Pressable`, which renders a `<div>` — a dead
 * end that only a browser running JavaScript can follow. The crawl graph from a
 * search page into its products depends on this being an `<a href>`, so the tag
 * is created directly and the click is intercepted for client-side navigation.
 *
 * The base style is not decoration: a bare `<a>` is `display: block` with a
 * browser-blue underline, so every flex utility handed to it — `gap`,
 * `justify-center`, `items-center` — silently does nothing. Matching React
 * Native's View defaults here is what makes one `className` mean the same thing
 * on both platforms. Direction and alignment stay out of it so callers can
 * still set them.
 */
const anchorBase = {
  display: 'flex',
  // React Native Views are `position: relative`; a bare anchor is `static`, so
  // any absolutely positioned child escapes to the nearest positioned ancestor
  // and paints at that element's size instead of the link's.
  position: 'relative',
  minWidth: 0,
  textDecoration: 'none',
  color: 'inherit'
} as const

export const ProductLink = ({
  href,
  label,
  className,
  onPress,
  onIntent,
  children
}: PropsWithChildren<{
  href: string
  label?: string
  className?: string
  onPress?: () => void
  onIntent?: () => void
}>) => {
  const router = useRouter()
  const pathname = usePathname()
  const intent = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(intent.current), [href])

  /**
   * Warm the next page while the shopper is still deciding on this one.
   *
   * Expo Router's prefetch pulls the route's server data and its chunk, so the
   * click that follows renders from memory instead of waiting on a round trip —
   * which on a comparison site is the difference between reading a product and
   * watching a spinner decide whether to show one.
   */
  const prefetch = useCallback(() => {
    clearTimeout(intent.current)
    if (href === pathname) return
    router.prefetch(href)
  }, [href, pathname, router])

  const warm = useCallback(() => {
    onIntent?.()
    clearTimeout(intent.current)
    intent.current = setTimeout(prefetch, intentMs)
  }, [onIntent, prefetch])

  const warmImmediately = useCallback(() => {
    onIntent?.()
    prefetch()
  }, [onIntent, prefetch])

  const cancelWarm = useCallback(() => clearTimeout(intent.current), [])

  return createElement('a', {
    href,
    className: `arro-link ${className ?? ''}`,
    style: anchorBase,
    ...(label ? { 'aria-label': label } : {}),
    onMouseEnter: warm,
    onMouseLeave: cancelWarm,
    // Touch has no hover, so the press itself is the earliest signal.
    onTouchStart: warmImmediately,
    onFocus: warmImmediately,
    onBlur: cancelWarm,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      clearTimeout(intent.current)
      // Modified clicks and non-primary buttons belong to the browser: they open
      // tabs and windows, which is the whole point of shipping a real link.
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) {
        return
      }
      event.preventDefault()
      onPress?.()
      // Pushing the route you are already on remounts the screen and refetches
      // it, which reads as a stutter and loses scroll position for nothing.
      if (href === pathname) return
      router.push(href)
    }
  }, children)
}
