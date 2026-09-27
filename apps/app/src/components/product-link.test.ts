import type { MouseEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProductLink } from './ProductLink.web'

const router = vi.hoisted(() => ({ prefetch: vi.fn(), push: vi.fn() }))
vi.mock('expo-router', () => ({ useRouter: () => router, usePathname: () => '/' }))
vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useCallback: (callback: unknown) => callback,
  useEffect: vi.fn(),
  useRef: () => ({ current: undefined })
}))

const link = () => ProductLink({ href: '/c/kids', label: 'Browse Kids' }).props

describe('catalog link intent', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks() })
  afterEach(() => vi.useRealTimers())

  it('prefetches the destination after sustained hover without navigating', () => {
    const props = link()
    expect(props.href).toBe('/c/kids')
    props.onMouseEnter()
    vi.advanceTimersByTime(89)
    expect(router.prefetch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(router.prefetch).toHaveBeenCalledExactlyOnceWith('/c/kids')
    expect(router.push).not.toHaveBeenCalled()
  })

  it('does not fetch links the pointer just passes over', () => {
    const props = link()
    props.onMouseEnter()
    props.onMouseLeave()
    vi.runAllTimers()
    expect(router.prefetch).not.toHaveBeenCalled()
  })

  it.each(['onFocus', 'onTouchStart'] as const)('prefetches immediately on %s', (event) => {
    link()[event]()
    expect(router.prefetch).toHaveBeenCalledExactlyOnceWith('/c/kids')
  })

  it('opens category previews for keyboard users too', () => {
    const onIntent = vi.fn()
    ProductLink({ href: '/c/kids', onIntent }).props.onFocus()
    expect(onIntent).toHaveBeenCalledOnce()
  })

  it('leaves modified clicks to the browser', () => {
    const preventDefault = vi.fn()
    link().onClick({ ctrlKey: true, button: 0, preventDefault } as unknown as MouseEvent<HTMLAnchorElement>)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(router.push).not.toHaveBeenCalled()
  })

  it('cancels pending intent and navigates exactly once on click', () => {
    const props = link()
    props.onMouseEnter()
    props.onClick({ button: 0, preventDefault: vi.fn() } as unknown as MouseEvent<HTMLAnchorElement>)
    vi.runAllTimers()
    expect(router.prefetch).not.toHaveBeenCalled()
    expect(router.push).toHaveBeenCalledExactlyOnceWith('/c/kids')
  })
})
