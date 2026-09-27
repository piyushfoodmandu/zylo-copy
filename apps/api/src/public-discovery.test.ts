import { describe, expect, it } from 'vitest'
import {
  buildApiHomepageHtml,
  buildApiServiceDescriptor,
  buildDiscoveryCss,
  buildOgCardPng,
  buildOgCardSvg,
  buildRobotsTxt,
  buildSitemapXml,
  isCanonicalDiscoveryHomepage,
  normalizePublicBaseUrl,
  scoredAgentUserAgents,
  ucpCheckerUserAgent
} from './public-discovery.ts'

const publicBaseUrl = 'https://api.example.test'

describe('public API discovery builders', () => {
  it('normalizes an absolute HTTP origin and rejects unsafe base URLs', () => {
    expect(normalizePublicBaseUrl('  https://api.example.test///  '))
      .toBe('https://api.example.test')
    expect(normalizePublicBaseUrl('http://localhost:3000/')).toBe('http://localhost:3000')
    expect(() => normalizePublicBaseUrl('')).toThrowError(/must not be empty/)
    expect(() => normalizePublicBaseUrl('api.example.test')).toThrowError(/absolute HTTP or HTTPS/)
    expect(() => normalizePublicBaseUrl('ftp://api.example.test')).toThrowError(/HTTP or HTTPS/)
    expect(() => normalizePublicBaseUrl('https://user:secret@api.example.test')).toThrowError(/credentials/)
    expect(() => normalizePublicBaseUrl('https://api.example.test/base')).toThrowError(/without a path/)
    expect(() => normalizePublicBaseUrl('https://api.example.test/?query=yes')).toThrowError(/without a path/)
    expect(() => normalizePublicBaseUrl('https://api.example.test/#fragment')).toThrowError(/without a path/)
  })

  it('describes only real Arro discovery and protocol surfaces with explicit authority boundaries', () => {
    const descriptor = buildApiServiceDescriptor(`${publicBaseUrl}/`)

    expect(descriptor).toMatchObject({
      role: 'commerce_orchestration_platform',
      authority: {
        order: expect.stringContaining('merchant remains authoritative'),
        merchant_of_record: expect.stringContaining('merchant of record')
      },
      interfaces: {
        ucp_platform_profile: `${publicBaseUrl}/.well-known/ucp`,
        mcp: `${publicBaseUrl}/v1/mcp`,
        openapi: `${publicBaseUrl}/openapi.json`
      }
    })
    expect(descriptor.transport_notes.ucp).toContain('not a merchant business or raw merchant Checkout server')
  })

  it('builds a canonical HTML homepage with complete social metadata and Organization JSON-LD', () => {
    const html = buildApiHomepageHtml(`${publicBaseUrl}/`)

    expect(isCanonicalDiscoveryHomepage(html, publicBaseUrl)).toBe(true)
    expect(isCanonicalDiscoveryHomepage(
      '<html><head><meta name="viewport" content="width=device-width"></head><body>Challenge</body></html>',
      publicBaseUrl
    )).toBe(false)

    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
    expect(html).toContain(`<link rel="canonical" href="${publicBaseUrl}/">`)
    expect(html).toContain(`<link rel="stylesheet" href="${publicBaseUrl}/discovery.css">`)
    expect(html).not.toContain('<style>')
    expect(html).toContain(`<meta property="og:image" content="${publicBaseUrl}/og-card.png">`)
    expect(html).toContain('<meta property="og:image:type" content="image/png">')
    for (const property of ['og:title', 'og:type', 'og:url', 'og:description', 'og:image', 'og:image:alt', 'og:site_name']) {
      expect(html).toContain(`property="${property}"`)
    }
    for (const name of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt']) {
      expect(html).toContain(`name="${name}"`)
    }

    const jsonLdMatch = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)
    expect(jsonLdMatch?.[1]).toBeDefined()
    expect(JSON.parse(jsonLdMatch?.[1] ?? '{}')).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Arro Universal Commerce',
      url: publicBaseUrl
    })
    expect(html).toContain('merchant retaining merchant-of-record and Order authority')
  })

  it('serves homepage styling as same-origin CSS', () => {
    const css = buildDiscoveryCss()
    expect(css).toContain('color-scheme: dark')
    expect(css).not.toContain('<style>')
  })

  it('explicitly permits every scored agent and advertises the canonical sitemap', () => {
    const robots = buildRobotsTxt(`${publicBaseUrl}/`)

    for (const userAgent of scoredAgentUserAgents) {
      expect(robots).toContain(`User-agent: ${userAgent}\nAllow: /\nAllow: /.well-known/ucp`)
    }
    expect(ucpCheckerUserAgent).toBe(
      'UCPCheckerBot/1.0 (+https://ucpchecker.com/methodology)'
    )
    expect(robots).toContain('User-agent: *\nAllow: /\nAllow: /.well-known/ucp')
    expect(robots).toContain(`Sitemap: ${publicBaseUrl}/sitemap.xml`)
    expect(robots).not.toContain('Disallow:')
  })

  it('lists canonical public GET discovery surfaces in valid sitemap-shaped XML', () => {
    const sitemap = buildSitemapXml(`${publicBaseUrl}/`)

    expect(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    for (const path of ['/', '/v1', '/.well-known/ucp', '/.well-known/agent-card.json', '/openapi.json', '/llms.txt']) {
      expect(sitemap).toContain(`<loc>${publicBaseUrl}${path}</loc>`)
    }
    expect(sitemap).not.toContain('/v1/mcp</loc>')
  })

  it('builds a self-contained, accessible 1200 by 630 SVG social card', () => {
    const svg = buildOgCardSvg()

    expect(svg).toContain('width="1200" height="630"')
    expect(svg).toContain('role="img" aria-labelledby="title description"')
    expect(svg).toContain('<title id="title">Arro Universal Commerce API</title>')
    expect(svg).toContain('<desc id="description">')
    expect(svg).not.toMatch(/(?:href|src)="https?:\/\//)
  })

  it('builds a real 1200 by 630 PNG social-card fallback', () => {
    const png = buildOgCardPng()
    expect(Buffer.from(png.subarray(0, 8))).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(Buffer.from(png).readUInt32BE(16)).toBe(1200)
    expect(Buffer.from(png).readUInt32BE(20)).toBe(630)
  })
})
