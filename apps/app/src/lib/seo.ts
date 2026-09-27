import type { Metadata } from 'expo-server'
import type { CatalogProductDetail, CatalogProductSummary, Money } from '../types/catalog'

export const siteName = 'Arro'

/**
 * The origin the canonical links and structured data point at. It is separate
 * from the API origin because the crawlable site and the commerce API can be
 * hosted independently.
 */
const configuredSiteOrigin = process.env.EXPO_PUBLIC_ARRO_SITE_URL?.trim()

const resolveSiteOrigin = () => {
  const value = configuredSiteOrigin || 'http://localhost:8081'
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('EXPO_PUBLIC_ARRO_SITE_URL must be a valid absolute URL.')
  }

  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('EXPO_PUBLIC_ARRO_SITE_URL must be an origin without credentials, a path, a query, or a fragment.')
  }

  if (process.env.NODE_ENV === 'production') {
    const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
    const nonPublicHost = !hostname || hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')
    if (!configuredSiteOrigin || url.protocol !== 'https:' || nonPublicHost) {
      throw new Error('EXPO_PUBLIC_ARRO_SITE_URL is required for production builds and must be a public HTTPS origin.')
    }
  }

  return url.origin
}

export const siteOrigin = resolveSiteOrigin()

export const canonical = (path: string) => `${siteOrigin}${path.startsWith('/') ? path : `/${path}`}`

const clamp = (value: string, length: number) =>
  value.length <= length ? value : `${value.slice(0, length - 1).trimEnd()}…`

export const priceText = (money: Money | undefined) =>
  money ? `${money.currency} ${(money.amountMinor / 100).toFixed(2)}` : undefined

type PageMetadataInput = {
  title: string
  description: string
  path: string
  images?: string[]
  robots?: Metadata['robots']
  type?: 'website' | 'article' | 'product'
  /** Alt text for the social card image. Read aloud by screen readers on X and Mastodon. */
  imageAlt?: string
  /** Error documents should not claim a valid page as their canonical self. */
  canonicalize?: boolean
}

/**
 * Link-card readers want a title, a description, an image and an alt. Bluesky,
 * X and Mastodon all fetch `og:image` and size the card themselves.
 *
 * Dimensions are deliberately not declared. Merchant images arrive at whatever
 * size the shop published, so stating 1200x630 would be a machine-readable
 * claim Arro cannot back — the same mistake as structured data that outruns the
 * visible page. A card reader that measures the real image renders it correctly;
 * one told the wrong size letterboxes it.
 */
const socialCardImage = (url: string, alt: string | undefined) => ({
  url,
  ...(alt ? { alt } : {})
})

export const pageMetadata = ({
  title,
  description,
  path,
  images,
  robots,
  type = 'website',
  imageAlt,
  canonicalize = true
}: PageMetadataInput): Metadata => {
  const url = canonical(path)
  const trimmedTitle = clamp(title, 65)
  const trimmedDescription = clamp(description, 165)
  // One card image per URL. A repeated `og:image` gives a crawler two identical
  // candidates and wastes the slots a second real angle could have used.
  const cardImages = [...new Set(images ?? [])].slice(0, 4).map((image) => socialCardImage(image, imageAlt))

  return {
    title: trimmedTitle,
    description: trimmedDescription,
    applicationName: siteName,
    ...(canonicalize ? { alternates: { canonical: url } } : {}),
    // Search engines are told what they may show, not just whether to index.
    // The directives are written into the main robots value rather than a
    // googlebot-only tag, because that is the form every engine reads and the
    // one that actually survives serialization.
    robots: robots ?? 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1',
    openGraph: {
      title: trimmedTitle,
      description: trimmedDescription,
      ...(canonicalize ? { url } : {}),
      siteName,
      type,
      locale: 'en_US',
      ...(cardImages.length ? { images: cardImages } : {})
    },
    twitter: {
      card: cardImages.length ? 'summary_large_image' : 'summary',
      title: trimmedTitle,
      description: trimmedDescription,
      ...(cardImages.length ? { images: cardImages } : {})
    },
    // The tab icon belongs to metadata, not to a custom document. Replacing
    // Expo's `+html` shell to add a `<link>` also removes the head Expo injects
    // the stylesheet into, which ships the page unstyled and re-styles it once
    // the bundle lands — the flash that reads as the page stuttering on load.
    icons: {
      icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
      apple: [{ url: '/favicon.svg' }]
    },
    other: {
      'theme-color': '#cc2963',
      'color-scheme': 'light'
    }
  }
}

const availabilityUrl = (availability: CatalogProductSummary['availability']) => ({
  in_stock: 'https://schema.org/InStock',
  limited: 'https://schema.org/LimitedAvailability',
  out_of_stock: 'https://schema.org/OutOfStock',
  unknown: undefined
}[availability])

const conditionUrl = (condition: CatalogProductSummary['condition']) => ({
  new: 'https://schema.org/NewCondition',
  refurbished: 'https://schema.org/RefurbishedCondition',
  open_box: undefined,
  used: 'https://schema.org/UsedCondition',
  unknown: undefined
}[condition])

export type StructuredOffer = {
  price?: Money
  availability: CatalogProductSummary['availability']
  condition: CatalogProductSummary['condition']
  sellerName: string
  url?: string
}

/**
 * A source that states when its answer stops being valid is stating a price
 * validity window, and `priceValidUntil` is the field consumers read for it.
 * It is emitted only when the source actually supplied one — an invented date
 * would be exactly the kind of claim that outruns the page.
 */
const priceValidUntil = (expiresAt: string | undefined) => {
  if (!expiresAt) return undefined
  const parsed = new Date(expiresAt)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : undefined
}

const structuredOffer = (offer: StructuredOffer, validUntil: string | undefined) => {
  const availability = availabilityUrl(offer.availability)
  const condition = conditionUrl(offer.condition)
  return {
    '@type': 'Offer',
    priceCurrency: offer.price!.currency,
    price: (offer.price!.amountMinor / 100).toFixed(2),
    ...(availability ? { availability } : {}),
    ...(condition ? { itemCondition: condition } : {}),
    ...(validUntil ? { priceValidUntil: validUntil } : {}),
    seller: { '@type': 'Organization', name: offer.sellerName },
    ...(offer.url ? { url: offer.url } : {})
  }
}

/**
 * Schema.org output is generated only from facts the source actually returned.
 * A machine-readable claim that outruns the visible page teaches agents the
 * wrong answer, which is worse than publishing nothing.
 */
export const productStructuredData = ({
  product,
  offers,
  path
}: {
  product: CatalogProductDetail | CatalogProductSummary
  offers: StructuredOffer[]
  path: string
}) => {
  const validUntil = priceValidUntil(product.sourceLabel.expiresAt)
  const priced = offers.filter((offer) => offer.price)
  const currencies = new Set(priced.map((offer) => offer.price!.currency))
  const comparable = currencies.size === 1 ? priced : []
  const amounts = comparable.map((offer) => offer.price!.amountMinor)
  const currency = comparable[0]?.price?.currency

  const offerData = comparable.length > 1 && currency
    ? {
        '@type': 'AggregateOffer',
        priceCurrency: currency,
        lowPrice: (Math.min(...amounts) / 100).toFixed(2),
        highPrice: (Math.max(...amounts) / 100).toFixed(2),
        offerCount: comparable.length,
        offers: comparable.map((offer) => structuredOffer(offer, validUntil))
      }
    : priced[0]
      ? structuredOffer(priced[0], validUntil)
      : undefined

  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    url: canonical(path),
    ...(product.description ? { description: clamp(product.description, 900) } : {}),
    ...(product.imageUrl ? { image: [product.imageUrl] } : {}),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    ...(product.rating
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.rating.value,
            bestRating: product.rating.scaleMax,
            ratingCount: product.rating.count
          }
        }
      : {}),
    ...(offerData ? { offers: offerData } : {})
  }
}

export const breadcrumbStructuredData = (trail: Array<{ name: string; path: string }>) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: trail.map((entry, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: entry.name,
    item: canonical(entry.path)
  }))
})

const itemListNode = ({
  name,
  path,
  items
}: {
  name: string
  path: string
  items: Array<{ title: string; path: string }>
}) => ({
  '@type': 'ItemList',
  name,
  url: canonical(path),
  numberOfItems: items.length,
  itemListElement: items.slice(0, 40).map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.title,
    url: canonical(item.path)
  }))
})

export const itemListStructuredData = (input: {
  name: string
  path: string
  items: Array<{ title: string; path: string }>
}) => ({ '@context': 'https://schema.org', ...itemListNode(input) })

/**
 * A results page is a collection, and the two facts an answer engine needs from
 * Arro that a bare `ItemList` cannot carry are when the underlying prices were
 * checked and what the page is about. `dateModified` here is the source fetch
 * time, not a render timestamp: a page that claims to be fresh because it was
 * rendered a second ago would be the machine-readable version of a lie.
 */
export const collectionPageStructuredData = ({
  name,
  description,
  path,
  about,
  items,
  dateModified
}: {
  name: string
  description: string
  path: string
  about?: string
  items: Array<{ title: string; path: string }>
  dateModified?: string
}) => ({
  '@context': 'https://schema.org',
  '@type': 'CollectionPage',
  name,
  description,
  url: canonical(path),
  isPartOf: { '@type': 'WebSite', name: siteName, url: siteOrigin },
  ...(about ? { about: { '@type': 'Thing', name: about } } : {}),
  ...(dateModified && Number.isFinite(new Date(dateModified).getTime())
    ? { dateModified: new Date(dateModified).toISOString() }
    : {}),
  mainEntity: itemListNode({ name, path, items })
})

export const organizationStructuredData = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: siteName,
  url: siteOrigin,
  description: 'Arro compares live offers from real shops and keeps checkout with the shop that sells the item.'
})


/**
 * Declares how to search Arro. Google uses it for the sitelinks search box, and
 * an answer engine reading the page learns the query URL shape without guessing.
 */
export const websiteStructuredData = () => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: siteName,
  url: siteOrigin,
  potentialAction: {
    '@type': 'SearchAction',
    target: {
      '@type': 'EntryPoint',
      urlTemplate: `${siteOrigin}/search/{search_term_string}`
    },
    'query-input': 'required name=search_term_string'
  }
})
