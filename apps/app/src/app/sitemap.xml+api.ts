import { browseCategories } from '../lib/categories'
import { categoryHref, searchHref } from '../lib/product-url'
import { siteOrigin } from '../lib/seo'

const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

/**
 * Only surfaces Arro can serve durable content for. Product pages are not
 * enumerated: their identity comes from live source responses, so a static list
 * would either go stale or invent URLs the catalog no longer answers for.
 * Crawlers reach products through the category and search pages listed here.
 */
const entries = [...new Set([
  '/',
  ...browseCategories.map((category) => categoryHref(category.query)),
  // Sub-categories are the queries the sources actually answer, so they are the
  // pages that carry products for a crawler to reach.
  ...browseCategories.flatMap((category) => category.children.map((child) => searchHref(child.query)))
])]

export function GET() {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((path) => `  <url>
    <loc>${escapeXml(`${siteOrigin}${path}`)}</loc>
  </url>`).join('\n')}
</urlset>
`

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  })
}
