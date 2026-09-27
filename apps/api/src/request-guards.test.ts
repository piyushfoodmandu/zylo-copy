import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  applySecurityHeaders,
  enforceContentLength,
  enforceJsonContentType
} from './request-guards.ts'
import { buildOrganizationStructuredDataJson } from './public-discovery.ts'

describe('request guards', () => {
  it('applies baseline browser-facing security headers', () => {
    const headers: Record<string, string> = {}

    applySecurityHeaders(headers)

    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['content-security-policy']).toContain("default-src 'self'")
    expect(headers['content-security-policy']).toContain("style-src 'self'")
    expect(headers['content-security-policy']).toMatch(/script-src 'self' 'sha256-[A-Za-z0-9+/]+=*'/)
    expect(headers['content-security-policy']).not.toContain("'unsafe-inline'")
  })

  it('binds the JSON-LD CSP hash to an injected public origin', () => {
    const first: Record<string, string> = {}
    const second: Record<string, string> = {}
    applySecurityHeaders(first, 'https://first.example')
    applySecurityHeaders(second, 'https://second.example')

    expect(first['content-security-policy']).not.toBe(second['content-security-policy'])
    const expectedHash = createHash('sha256')
      .update(buildOrganizationStructuredDataJson('https://first.example'))
      .digest('base64')
    expect(first['content-security-policy']).toContain(`'sha256-${expectedHash}'`)
  })

  it('rejects mutating requests without application/json content type', () => {
    const request = new Request('http://localhost/v1/ucp/discover', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: 'domain=example.com'
    })

    const rejection = enforceJsonContentType(request, 'req-guard')

    expect(rejection?.status).toBe(415)
    expect(rejection?.reasonCode).toBe('unsupported_media_type')
    expect(rejection?.body.error.requestId).toBe('req-guard')
  })

  it('allows application/json with structured suffix parameters', () => {
    const request = new Request('http://localhost/v1/ucp/discover', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ domain: 'example.com' })
    })

    expect(enforceJsonContentType(request, 'req-guard')).toBeUndefined()
  })

  it('rejects requests whose declared body length exceeds the configured limit', () => {
    const request = new Request('http://localhost/v1/ucp/discover', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '2048'
      },
      body: '{}'
    })

    const rejection = enforceContentLength(request, 'req-guard', 1024)

    expect(rejection?.status).toBe(413)
    expect(rejection?.reasonCode).toBe('payload_too_large')
    expect(rejection?.body.error.requestId).toBe('req-guard')
  })
})
