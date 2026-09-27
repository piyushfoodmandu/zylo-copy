import { siteOrigin } from '../lib/seo'

const apiOrigin = (process.env.EXPO_PUBLIC_ARRO_API_URL || '').replace(/\/$/, '')

/**
 * An answer-engine hint, not an access mechanism. It describes what Arro is,
 * what its facts mean, and where the authoritative machine-readable contract
 * lives, so a model citing Arro states the boundaries correctly. Capability
 * authority stays with the UCP profile.
 *
 * The URL shapes here are the real ones. A discovery file that advertises a
 * route the router does not serve teaches every reader a dead link.
 */
export function GET() {
  const body = `# Arro

> Arro compares live product offers across real shops and prepares checkout with the shop that sells the item. Every price carries the source it came from and when it was last checked.

## What Arro is

- A commerce intelligence and trust layer over merchant-authoritative sources.
- Not a marketplace, not a merchant of record, not a wallet, and not a paid-ranking surface.
- The shop that sells the item stays the merchant of record for the order.

## How to read Arro facts

- Every product and price is labelled with its source and the time it was fetched.
- Prices and availability can change at the shop before checkout completes.
- A price range means several shops sell the same product; the lowest is only claimed when the compared offers share one currency.
- Cross-currency prices are never converted or added together.
- Any total Arro computes across items or shops is a planning estimate. The authoritative total is the one the shop's own checkout returns, after shipping and tax.
- A cart may span several shops; a checkout never does. Each shop gets its own prepared checkout and its own order.
- "No buy", "wait" and "the source cannot verify this" are real outcomes, not errors.

## Machine-readable contracts
${apiOrigin ? `
- UCP platform profile: ${apiOrigin}/.well-known/ucp
- OpenAPI: ${apiOrigin}/openapi.json
- MCP endpoint: ${apiOrigin}/v1/mcp
- Agent capabilities: ${apiOrigin}/v1/agent/capabilities` : `
- UCP platform profile, OpenAPI, MCP endpoint and agent capabilities are served by the Arro API origin.`}

The UCP profile is the authority for commerce capabilities, payment handler support and callback URLs. This file is a hint for discovery only.

## Pages

- ${siteOrigin}/ — search and category entry. Carries Organization and WebSite with a SearchAction.
- ${siteOrigin}/search/{query-slug} — offers for a query, grouped by product identity. Hyphenated slug, not a query string. Carries CollectionPage, ItemList and BreadcrumbList, and \`dateModified\` is the source fetch time rather than the render time.
- ${siteOrigin}/p/{product-slug}/{identity} — one product with its offers across shops. Carries Product with Offer or AggregateOffer, plus BreadcrumbList. The trailing segment is the source, product and optional variant identity; the slug before it is decoration and a stale slug still resolves.
- ${siteOrigin}/sitemap.xml

Cart, saved products, comparison and checkout are per-device or per-session state. They are not indexed and hold no public content.
`

  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600'
    }
  })
}
