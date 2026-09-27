const homepageTitle = 'Arro Universal Commerce API'

export const isCanonicalDiscoveryHomepage = (html: string, publicBaseUrl: string) => {
  const baseUrl = normalizePublicBaseUrl(publicBaseUrl)
  return html.includes(`<title>${homepageTitle}</title>`) &&
    html.includes(`<link rel="canonical" href="${baseUrl}/">`) &&
    html.includes('merchant retaining merchant-of-record and Order authority')
}
const homepageDescription =
  'Source-backed commerce discovery and purchase orchestration for authenticated agents, with the participating merchant retaining merchant-of-record and Order authority.'

import { deflateSync } from 'node:zlib'

export const scoredAgentUserAgents = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'Amazonbot',
  'meta-externalagent',
  'UCPCheckerBot'
] as const

export const ucpCheckerUserAgent =
  'UCPCheckerBot/1.0 (+https://ucpchecker.com/methodology)'

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const escapeXml = escapeHtml

const jsonForHtml = (value: unknown) => JSON.stringify(value)
  .replaceAll('<', '\\u003c')
  .replaceAll('>', '\\u003e')
  .replaceAll('&', '\\u0026')

export const normalizePublicBaseUrl = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('publicBaseUrl must not be empty.')

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('publicBaseUrl must be an absolute HTTP or HTTPS URL.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('publicBaseUrl must use HTTP or HTTPS.')
  }
  if (url.username || url.password) {
    throw new Error('publicBaseUrl must not contain credentials.')
  }

  if (url.search || url.hash || !/^\/*$/.test(url.pathname)) {
    throw new Error('publicBaseUrl must be an origin without a path, query, or fragment.')
  }

  return url.origin
}

export const buildOrganizationStructuredDataJson = (publicBaseUrl: string) => {
  const baseUrl = normalizePublicBaseUrl(publicBaseUrl)
  return jsonForHtml({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Arro Universal Commerce',
    url: baseUrl,
    description: homepageDescription,
    knowsAbout: [
      'Universal Commerce Protocol',
      'Source-backed product discovery',
      'Agentic commerce orchestration'
    ]
  })
}

export const buildDiscoveryCss = () => `:root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #071712; color: #f3fff9; }
main { width: min(44rem, calc(100% - 3rem)); padding: 4rem 0; }
p { color: #b8d2c7; font-size: 1.125rem; line-height: 1.7; }
ul { padding-left: 1.25rem; line-height: 1.9; }
a { color: #72f1b8; }
.eyebrow { color: #72f1b8; font-size: .75rem; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; }
h1 { margin: .75rem 0 1rem; font-size: clamp(2.5rem, 7vw, 5rem); line-height: .95; letter-spacing: -.045em; }
`

export const buildApiServiceDescriptor = (publicBaseUrl: string) => {
  const baseUrl = normalizePublicBaseUrl(publicBaseUrl)

  return {
    name: homepageTitle,
    description: homepageDescription,
    role: 'commerce_orchestration_platform',
    authority: {
      source: 'Arro preserves source evidence and capability boundaries.',
      checkout: 'Checkout operations are bound to the participating merchant capability.',
      order: 'The participating merchant remains authoritative for the Order and its lifecycle.',
      merchant_of_record: 'The participating merchant remains the merchant of record.'
    },
    interfaces: {
      ucp_platform_profile: `${baseUrl}/.well-known/ucp`,
      mcp: `${baseUrl}/v1/mcp`,
      openapi: `${baseUrl}/openapi.json`,
      agent_card: `${baseUrl}/.well-known/agent-card.json`,
      x402_discovery: `${baseUrl}/.well-known/x402`,
      llms: `${baseUrl}/llms.txt`
    },
    transport_notes: {
      mcp: 'Arro agent tools over Streamable HTTP.',
      rest: 'Arro API operations documented by the linked OpenAPI document.',
      ucp: 'This profile describes Arro as a UCP platform; it is not a merchant business or raw merchant Checkout server.'
    }
  } as const
}

export const buildApiHomepageHtml = (publicBaseUrl: string) => {
  const baseUrl = normalizePublicBaseUrl(publicBaseUrl)
  const escapedBaseUrl = escapeHtml(baseUrl)
  const ogImageUrl = `${baseUrl}/og-card.png`
  const escapedOgImageUrl = escapeHtml(ogImageUrl)
  const structuredData = buildOrganizationStructuredDataJson(baseUrl)

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${homepageTitle}</title>
  <meta name="description" content="${escapeHtml(homepageDescription)}">
  <link rel="canonical" href="${escapedBaseUrl}/">
  <link rel="stylesheet" href="${escapedBaseUrl}/discovery.css">
  <meta property="og:title" content="${homepageTitle}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${escapedBaseUrl}/">
  <meta property="og:description" content="${escapeHtml(homepageDescription)}">
  <meta property="og:image" content="${escapedOgImageUrl}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Arro Universal Commerce API — source-backed agentic commerce orchestration">
  <meta property="og:site_name" content="Arro Universal Commerce">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${homepageTitle}">
  <meta name="twitter:description" content="${escapeHtml(homepageDescription)}">
  <meta name="twitter:image" content="${escapedOgImageUrl}">
  <meta name="twitter:image:alt" content="Arro Universal Commerce API — source-backed agentic commerce orchestration">
  <script type="application/ld+json">${structuredData}</script>
</head>
<body>
  <main>
    <div class="eyebrow">API and agent discovery</div>
    <h1>Universal commerce, with authority intact.</h1>
    <p>${escapeHtml(homepageDescription)}</p>
    <nav aria-label="Public API discovery">
      <ul>
        <li><a href="${escapedBaseUrl}/v1">API service descriptor</a></li>
        <li><a href="${escapedBaseUrl}/.well-known/ucp">UCP platform profile</a></li>
        <li><a href="${escapedBaseUrl}/openapi.json">OpenAPI document</a></li>
        <li><a href="${escapedBaseUrl}/.well-known/agent-card.json">Agent card</a></li>
        <li><a href="${escapedBaseUrl}/llms.txt">Agent-readable overview</a></li>
      </ul>
    </nav>
  </main>
</body>
</html>`
}

export const buildRobotsTxt = (publicBaseUrl: string) => {
  const baseUrl = normalizePublicBaseUrl(publicBaseUrl)
  const namedAgents = scoredAgentUserAgents.flatMap((userAgent) => [
    `User-agent: ${userAgent}`,
    'Allow: /',
    'Allow: /.well-known/ucp',
    ''
  ])

  return [
    ...namedAgents,
    'User-agent: *',
    'Allow: /',
    'Allow: /.well-known/ucp',
    '',
    `Sitemap: ${baseUrl}/sitemap.xml`,
    ''
  ].join('\n')
}

export const buildSitemapXml = (publicBaseUrl: string) => {
  const baseUrl = normalizePublicBaseUrl(publicBaseUrl)
  const publicDiscoveryUrls = [
    `${baseUrl}/`,
    `${baseUrl}/v1`,
    `${baseUrl}/.well-known/ucp`,
    `${baseUrl}/.well-known/agent-card.json`,
    `${baseUrl}/openapi.json`,
    `${baseUrl}/llms.txt`
  ]
  const entries = publicDiscoveryUrls
    .map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>\n`
}

export const buildOgCardSvg = () => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title description">
  <title id="title">Arro Universal Commerce API</title>
  <desc id="description">Source-backed agentic commerce orchestration with merchant authority intact.</desc>
  <defs>
    <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#071712"/>
      <stop offset="1" stop-color="#113d30"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.77" cy="0.18" r="0.65">
      <stop offset="0" stop-color="#72f1b8" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#72f1b8" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#background)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <path d="M80 88h1040" stroke="#72f1b8" stroke-opacity="0.35"/>
  <g fill="#72f1b8" font-family="ui-sans-serif, system-ui, sans-serif" font-size="22" font-weight="700" letter-spacing="4">
    <text x="80" y="145">ARRO UNIVERSAL COMMERCE</text>
  </g>
  <g fill="#f3fff9" font-family="ui-sans-serif, system-ui, sans-serif" font-weight="700">
    <text x="80" y="300" font-size="78">Commerce orchestration.</text>
    <text x="80" y="392" font-size="78">Authority intact.</text>
  </g>
  <text x="80" y="500" fill="#b8d2c7" font-family="ui-sans-serif, system-ui, sans-serif" font-size="28">Source-backed discovery · authenticated agents · merchant-authoritative Orders</text>
  <circle cx="1080" cy="512" r="38" fill="none" stroke="#72f1b8" stroke-width="3"/>
  <path d="M1064 512h32m-16-16v32" stroke="#72f1b8" stroke-width="3" stroke-linecap="round"/>
</svg>\n`

const pngCrcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return crc >>> 0
})

const pngCrc32 = (value: Uint8Array) => {
  let crc = 0xffffffff
  for (const byte of value) crc = pngCrcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const pngChunk = (type: string, data: Uint8Array) => {
  const typeBytes = Buffer.from(type, 'ascii')
  const body = Buffer.from(data)
  const chunk = Buffer.allocUnsafe(12 + body.length)
  chunk.writeUInt32BE(body.length, 0)
  typeBytes.copy(chunk, 4)
  body.copy(chunk, 8)
  chunk.writeUInt32BE(pngCrc32(Buffer.concat([typeBytes, body])), 8 + body.length)
  return chunk
}

let cachedOgCardPng: Uint8Array | undefined

/** A dependency-free raster fallback for link-preview clients that do not render SVG. */
export const buildOgCardPng = () => {
  if (cachedOgCardPng) return cachedOgCardPng

  const width = 1200
  const height = 630
  const stride = 1 + width * 3
  const pixels = Buffer.allocUnsafe(stride * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * stride
    pixels[row] = 0
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3
      const glowDistance = Math.hypot((x - 920) / 720, (y - 120) / 470)
      const glow = Math.max(0, 1 - glowDistance) * 54
      const diagonal = Math.round((x / width + y / height) * 8)
      pixels[offset] = Math.min(255, 7 + diagonal + Math.round(glow * 0.2))
      pixels[offset + 1] = Math.min(255, 23 + diagonal * 2 + Math.round(glow * 1.5))
      pixels[offset + 2] = Math.min(255, 18 + diagonal + Math.round(glow))
      if ((y >= 86 && y <= 89) || (x >= 78 && x <= 81 && y >= 86 && y <= 544)) {
        pixels[offset] = 114
        pixels[offset + 1] = 241
        pixels[offset + 2] = 184
      }
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  cachedOgCardPng = Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ])
  return cachedOgCardPng
}
