import { describe, expect, it } from 'vitest'
import { publicCatalogCacheControl } from './server-cache'

const nowMs = Date.parse('2026-08-25T10:00:00.000Z')

describe('public catalogue response cache policy', () => {
  it('does not cache a page without source-backed facts', () => {
    expect(publicCatalogCacheControl([], nowMs)).toBe('no-store')
  })

  it('uses a short shared-cache window while browsers revalidate', () => {
    expect(publicCatalogCacheControl([
      { fetchedAt: '2026-08-25T09:59:50.000Z' }
    ], nowMs)).toBe('public, max-age=0, s-maxage=30, must-revalidate')
  })

  it('never outlives the earliest source expiry', () => {
    expect(publicCatalogCacheControl([
      {
        fetchedAt: '2026-08-25T09:59:50.000Z',
        expiresAt: '2026-08-25T10:00:12.900Z'
      },
      {
        fetchedAt: '2026-08-25T09:59:40.000Z',
        expiresAt: '2026-08-25T10:02:00.000Z'
      }
    ], nowMs)).toBe('public, max-age=0, s-maxage=12, must-revalidate')
  })

  it('does not cache expired or malformed source state', () => {
    expect(publicCatalogCacheControl([
      {
        fetchedAt: '2026-08-25T09:59:00.000Z',
        expiresAt: '2026-08-25T10:00:00.000Z'
      }
    ], nowMs)).toBe('no-store')

    expect(publicCatalogCacheControl([
      { fetchedAt: 'not-a-timestamp' }
    ], nowMs)).toBe('no-store')
  })
})
