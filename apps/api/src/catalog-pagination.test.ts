import { describe, expect, it } from 'vitest'
import {
  decodeCatalogContinuation,
  encodeCatalogContinuation
} from './catalog-pagination.ts'

describe('catalog pagination cursor', () => {
  it('round-trips an opaque source continuation without exposing it as the API cursor', () => {
    const sourceCursor = 'eyJzaG9waWZ5Ijoib3BhcXVlIn0='
    const cursor = encodeCatalogContinuation({
      sourceId: 'shopify-global-catalog',
      sourceCursor
    })

    expect(cursor).toMatch(/^arro_c1\./)
    expect(cursor).not.toContain(sourceCursor)
    expect(decodeCatalogContinuation(cursor)).toEqual({
      sourceId: 'shopify-global-catalog',
      sourceCursor
    })
  })

  it('rejects malformed and unsupported cursors', () => {
    expect(() => decodeCatalogContinuation('shopify-raw-cursor')).toThrow('catalog_pagination_cursor_invalid')
    expect(() => decodeCatalogContinuation('arro_c1.not-json')).toThrow('catalog_pagination_cursor_invalid')
  })
})
