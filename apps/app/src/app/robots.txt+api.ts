import { siteOrigin } from '../lib/seo'

/**
 * Crawlers get the browse surfaces and nothing that is session or device state.
 * The disallow list is deliberately short: a rule that blocks a page Arro wants
 * cited is more expensive than one that lets a useless page be crawled.
 *
 * Answer-engine crawlers are named explicitly and allowed. Arro's value is
 * being cited correctly — source-labelled prices with a stated freshness — and
 * a model that cannot read the page will answer about Arro from somewhere else.
 * `Google-Extended` is a training/grounding control rather than a crawl
 * control, so it is listed on its own terms.
 */
const answerEngines = [
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
  'meta-externalagent'
]

const disallowed = [
  '/checkout',
  '/compare',
  '/cart',
  '/saved',
  '/account',
  '/_sitemap'
]

export function GET() {
  const block = (agent: string) => [
    `User-agent: ${agent}`,
    'Allow: /',
    ...disallowed.map((path) => `Disallow: ${path}`),
    ''
  ]

  const body = [
    ...block('*'),
    ...answerEngines.flatMap(block),
    `Sitemap: ${siteOrigin}/sitemap.xml`,
    ''
  ].join('\n')

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  })
}
