import {
  isCanonicalDiscoveryHomepage,
  scoredAgentUserAgents,
  ucpCheckerUserAgent
} from './public-discovery.ts'

const baseUrlValue = process.env.PUBLIC_BASE_URL?.trim() || 'http://localhost:3000'
const requestBaseUrlValue = process.env.VERIFY_PUBLIC_DISCOVERY_REQUEST_BASE_URL?.trim() || baseUrlValue
const timeoutMs = Number.parseInt(process.env.DEPENDENCY_CHECK_TIMEOUT_MS ?? '5000', 10)
const failures: string[] = []

const assert = (condition: boolean, message: string) => {
  if (!condition) failures.push(message)
}

let baseUrl: URL
let requestBaseUrl: URL
try {
  baseUrl = new URL(baseUrlValue.endsWith('/') ? baseUrlValue : `${baseUrlValue}/`)
  requestBaseUrl = new URL(
    requestBaseUrlValue.endsWith('/') ? requestBaseUrlValue : `${requestBaseUrlValue}/`
  )
} catch {
  console.error('PUBLIC_BASE_URL and VERIFY_PUBLIC_DISCOVERY_REQUEST_BASE_URL must be valid absolute URLs.')
  process.exit(1)
}

const request = (path: string, accept: string, userAgent?: string) => fetch(
  new URL(path.replace(/^\//, ''), requestBaseUrl),
  {
    headers: {
      accept,
      ...(userAgent ? { 'user-agent': userAgent } : {})
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5_000)
  }
)

const responseRedirects = (response: Response) =>
  response.redirected ||
  (response.status >= 300 && response.status < 400) ||
  response.headers.has('location')

const get = async (path: string, accept: string) => {
  const response = await request(path, accept)
  const body = await response.text()
  assert(response.status === 200, `${path} must return HTTP 200, received ${response.status}.`)
  assert(!responseRedirects(response), `${path} must not redirect.`)
  return { response, body }
}

const getBytes = async (path: string, accept: string) => {
  const response = await request(path, accept)
  const body = new Uint8Array(await response.arrayBuffer())
  assert(response.status === 200, `${path} must return HTTP 200, received ${response.status}.`)
  assert(!responseRedirects(response), `${path} must not redirect.`)
  return { response, body }
}

const runCheck = async (label: string, check: () => Promise<void>) => {
  try {
    await check()
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unexpected error'
    failures.push(`${label} failed: ${detail}`)
  }
}

const scoredCrawlerRoutes = [
  { path: '/', accept: 'text/html' },
  { path: '/robots.txt', accept: 'text/plain' },
  { path: '/sitemap.xml', accept: 'application/xml' },
  { path: '/.well-known/ucp', accept: 'application/json' }
] as const

await Promise.all(scoredCrawlerRoutes.flatMap(({ path, accept }) =>
  scoredAgentUserAgents.map(async (userAgent) => {
    const requestUserAgent = userAgent === 'UCPCheckerBot' ? ucpCheckerUserAgent : userAgent
    const label = `${path} for User-Agent ${requestUserAgent}`
    try {
      const response = await request(path, accept, requestUserAgent)
      const body = await response.text()
      assert(response.status === 200, `${label} must return HTTP 200, received ${response.status}.`)
      assert(!responseRedirects(response), `${label} must not redirect.`)
      const contentType = response.headers.get('content-type') ?? ''
      if (path === '/') {
        assert(contentType.includes('text/html'), `${label} must return HTML, received ${contentType || 'no content type'}.`)
        assert(
          isCanonicalDiscoveryHomepage(body, baseUrl.origin),
          `${label} must return the canonical Arro discovery homepage rather than an edge challenge.`
        )
      } else if (path === '/robots.txt') {
        assert(contentType.includes('text/plain'), `${label} must return plain-text robots policy.`)
        assert(!/Disallow:\s*\/$/m.test(body), `${label} must not receive a root Disallow rule.`)
        assert(body.includes(`User-agent: ${userAgent}`), `${label} must receive its explicit origin user-agent policy.`)
        assert(body.includes('Allow: /'), `${label} must receive an origin Allow rule.`)
      } else if (path === '/sitemap.xml') {
        assert(contentType.includes('xml'), `${label} must return XML, received ${contentType || 'no content type'}.`)
        assert(
          body.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">') &&
            body.includes(`<loc>${baseUrl.origin}/</loc>`),
          `${label} must return the canonical Arro sitemap rather than an edge challenge.`
        )
      } else {
        assert(contentType.includes('application/json'), `${label} must return the JSON UCP profile.`)
        try {
          const profile = JSON.parse(body) as Record<string, unknown>
          assert(Boolean(profile.ucp), `${label} must return the Arro UCP profile rather than an edge response.`)
        } catch {
          failures.push(`${label} did not return valid profile JSON.`)
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'unexpected error'
      failures.push(`${label} could not be fetched: ${detail}`)
    }
  })
))

await runCheck('/ semantic checks', async () => {
  const homepage = await get('/', 'text/html')
  assert(homepage.response.headers.get('content-type')?.includes('text/html') === true, '/ must return HTML.')
  assert(homepage.body.includes('<meta name="viewport"'), '/ must include viewport metadata.')
  for (const property of ['og:title', 'og:type', 'og:url', 'og:description', 'og:image', 'og:image:alt', 'og:site_name']) {
    assert(homepage.body.includes(`property="${property}"`), `/ must include ${property}.`)
  }
  assert(
    homepage.body.includes(`<link rel="stylesheet" href="${baseUrl.origin}/discovery.css">`),
    '/ must link the canonical discovery stylesheet.'
  )
  assert(
    homepage.body.includes(`<meta property="og:image" content="${baseUrl.origin}/og-card.png">`),
    '/ must use the canonical PNG social card.'
  )
  const jsonLdText = homepage.body.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1]
  let jsonLd: Record<string, unknown> | undefined
  try {
    jsonLd = jsonLdText ? JSON.parse(jsonLdText) as Record<string, unknown> : undefined
  } catch {
    failures.push('/ Organization JSON-LD is not valid JSON.')
  }
  assert(jsonLd?.['@type'] === 'Organization', '/ must publish Organization JSON-LD.')
  assert(jsonLd?.url === baseUrl.origin, '/ Organization JSON-LD must use PUBLIC_BASE_URL origin.')
})

await runCheck('/v1 semantic checks', async () => {
  const descriptor = await get('/v1', 'application/json')
  assert(descriptor.response.headers.get('content-type')?.includes('application/json') === true, '/v1 must return JSON.')
  try {
    const body = JSON.parse(descriptor.body) as Record<string, any>
    assert(body.role === 'commerce_orchestration_platform', '/v1 must declare Arro platform role.')
    assert(body.interfaces?.ucp_platform_profile === new URL('/.well-known/ucp', baseUrl).toString(), '/v1 UCP profile URL must match the public origin.')
    assert(body.interfaces?.mcp === new URL('/v1/mcp', baseUrl).toString(), '/v1 MCP URL must match the public origin.')
  } catch {
    failures.push('/v1 is not valid JSON.')
  }
})

await runCheck('/robots.txt semantic checks', async () => {
  const robots = await get('/robots.txt', 'text/plain')
  assert(robots.response.headers.get('content-type')?.includes('text/plain') === true, '/robots.txt must return plain text.')
  for (const agent of scoredAgentUserAgents) {
    assert(robots.body.includes(`User-agent: ${agent}`), `/robots.txt must declare ${agent}.`)
  }
  assert(!/Disallow:\s*\/$/m.test(robots.body), '/robots.txt must not block the public origin.')
  assert(robots.body.includes(`Sitemap: ${new URL('/sitemap.xml', baseUrl).toString()}`), '/robots.txt must link the canonical sitemap.')
})

await runCheck('/sitemap.xml semantic checks', async () => {
  const sitemap = await get('/sitemap.xml', 'application/xml')
  assert(sitemap.response.headers.get('content-type')?.includes('xml') === true, '/sitemap.xml must return XML.')
  assert(sitemap.body.includes(`<loc>${baseUrl.origin}/</loc>`), '/sitemap.xml must contain the canonical homepage.')
  assert(!sitemap.body.includes('localhost') || baseUrl.hostname === 'localhost', '/sitemap.xml must not leak localhost URLs.')
})

await runCheck('/llms.txt semantic checks', async () => {
  const llms = await get('/llms.txt', 'text/plain')
  assert(llms.body.includes(new URL('/.well-known/ucp', baseUrl).toString()), '/llms.txt must link the UCP profile.')
})

await runCheck('/discovery.css semantic checks', async () => {
  const stylesheet = await get('/discovery.css', 'text/css')
  assert(stylesheet.response.headers.get('content-type')?.includes('text/css') === true, '/discovery.css must return CSS.')
  assert(stylesheet.body.includes(':root') && stylesheet.body.includes('body'), '/discovery.css must contain the public discovery styles.')
})

await runCheck('/og-card.svg semantic checks', async () => {
  const ogCard = await get('/og-card.svg', 'image/svg+xml')
  assert(ogCard.response.headers.get('content-type')?.includes('image/svg+xml') === true, '/og-card.svg must return SVG.')
  assert(ogCard.body.includes('width="1200" height="630"'), '/og-card.svg must use the declared social-card dimensions.')
})

await runCheck('/og-card.png semantic checks', async () => {
  const ogCard = await getBytes('/og-card.png', 'image/png')
  assert(ogCard.response.headers.get('content-type')?.includes('image/png') === true, '/og-card.png must return PNG.')

  const expectedSignature = [137, 80, 78, 71, 13, 10, 26, 10]
  assert(
    expectedSignature.every((byte, index) => ogCard.body[index] === byte),
    '/og-card.png must contain a valid PNG signature.'
  )
  if (ogCard.body.byteLength >= 24) {
    const view = new DataView(ogCard.body.buffer, ogCard.body.byteOffset, ogCard.body.byteLength)
    assert(view.getUint32(16) === 1200 && view.getUint32(20) === 630, '/og-card.png must be 1200 by 630 pixels.')
  } else {
    failures.push('/og-card.png is too short to contain a PNG IHDR chunk.')
  }
})

if (failures.length > 0) {
  console.error(
    `Public discovery verification failed for ${requestBaseUrl.origin} (canonical origin ${baseUrl.origin})`
  )
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(
  `Public discovery verification passed for ${requestBaseUrl.origin} (canonical origin ${baseUrl.origin})`
)
