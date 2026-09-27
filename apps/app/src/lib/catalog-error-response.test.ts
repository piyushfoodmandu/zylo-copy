import { describe, expect, it } from 'vitest'
import { catalogErrorResponse } from './catalog-error-response'

describe('catalogErrorResponse', () => {
  it.each([404, 503] as const)('preserves the %s status and crawler-safe headers', async (status) => {
    const response = catalogErrorResponse(status, 'Unavailable', 'Try again shortly.')

    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, follow')
    await expect(response.text()).resolves.toContain(`<div class="code">${status}</div>`)
  })
})
