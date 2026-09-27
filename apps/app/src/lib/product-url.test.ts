import { describe, expect, it } from 'vitest'
import { queryFromSearchSlug, searchHref } from './product-url'

describe('search URLs', () => {
  it('builds a readable canonical path', () => {
    expect(searchHref('Roborock Qrevo Edge 2')).toBe('/search/roborock-qrevo-edge-2')
  })

  it('accepts both canonical and browser-escaped route params', () => {
    expect(queryFromSearchSlug('roborock-qrevo-edge-2')).toBe('roborock qrevo edge 2')
    expect(queryFromSearchSlug('Roborock%20Qrevo%20Edge%202')).toBe('Roborock Qrevo Edge 2')
  })

  it('does not throw for a malformed pasted escape', () => {
    expect(queryFromSearchSlug('save-20%')).toBe('save 20%')
  })
})
