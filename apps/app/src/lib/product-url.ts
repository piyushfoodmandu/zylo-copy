import type { CatalogProductSummary } from '../types/catalog'

export type ProductIdentity = {
  businessId: string
  productId: string
  variantId?: string
}

const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

// Encoded by hand rather than through Buffer or btoa: the same identity has to
// round-trip identically in the Node server that renders the page, the browser
// that hydrates it, and the native runtime that has neither API.
const bytesToBase64Url = (bytes: number[]) => {
  let output = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!
    const second = bytes[index + 1]
    const third = bytes[index + 2]
    output += base64Alphabet[first >> 2]
    output += base64Alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)]
    if (second === undefined) break
    output += base64Alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)]
    if (third === undefined) break
    output += base64Alphabet[third & 63]
  }
  return output
}

const base64UrlToBytes = (value: string) => {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const character of value) {
    const index = base64Alphabet.indexOf(character)
    if (index < 0) return undefined
    buffer = (buffer << 6) | index
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return bytes
}

const utf8Encode = (value: string) => {
  const bytes: number[] = []
  for (const character of value) {
    let code = character.codePointAt(0)!
    if (code < 0x80) bytes.push(code)
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    else if (code < 0x10000) bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
      code = 0
    }
  }
  return bytes
}

const utf8Decode = (bytes: number[]) => {
  let output = ''
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index]!
    let code: number
    let width: number
    if (first < 0x80) { code = first; width = 1 }
    else if (first < 0xe0) { code = first & 31; width = 2 }
    else if (first < 0xf0) { code = first & 15; width = 3 }
    else { code = first & 7; width = 4 }
    for (let offset = 1; offset < width; offset += 1) {
      const next = bytes[index + offset]
      if (next === undefined) return undefined
      code = (code << 6) | (next & 63)
    }
    output += String.fromCodePoint(code)
    index += width
  }
  return output
}

// An explicit escape rather than a literal control character: the delimiter has
// to survive editors, diffs and copy-paste to stay a stable part of every
// canonical product URL.
const identityDelimiter = '\u0000'

export const encodeProductIdentity = (identity: ProductIdentity) => bytesToBase64Url(utf8Encode([
  identity.businessId,
  identity.productId,
  identity.variantId ?? ''
].join(identityDelimiter)))

export const decodeProductIdentity = (value: string): ProductIdentity | undefined => {
  const bytes = base64UrlToBytes(value)
  if (!bytes) return undefined
  const decoded = utf8Decode(bytes)
  if (!decoded) return undefined
  const [businessId, productId, variantId] = decoded.split(identityDelimiter)
  if (!businessId || !productId) return undefined
  return { businessId, productId, ...(variantId ? { variantId } : {}) }
}

/**
 * The slug is decoration for people and search engines; the identity segment is
 * what actually resolves the product. A stale or hand-edited slug therefore
 * still loads the right page, and the canonical link corrects it.
 */
export const slugify = (value: string) => value
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 72)
  .replace(/-+$/g, '') || 'product'

/**
 * One crawlable document per source product. A merchant variant may seed the
 * detail screen, cart, or comparison state, but it must not split links and
 * structured data across several competing canonical identities.
 */
export const productHref = (
  product: Pick<CatalogProductSummary, 'businessId' | 'productId' | 'title'> & { variantId?: string }
) => `/p/${slugify(product.title)}/${encodeProductIdentity({
  businessId: product.businessId,
  productId: product.productId
})}`

/**
 * Search results live at a real path so they are indexable and their loader data
 * is keyed by something the router can resolve. The segment is a plain slug
 * rather than a percent-encoded string: an encoded space does not survive the
 * round trip between the URL and the loader key, and a hyphenated term reads
 * better in a search result anyway. Filters and sort stay in session state
 * rather than multiplying the URL space.
 */
export const searchSlug = (query: string) => query
  .trim()
  .toLowerCase()
  .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80)
  .replace(/-+$/g, '')

export const queryFromSearchSlug = (slug: string) => {
  // Router params are decoded in some Expo render paths and still escaped in
  // others. Normalise both without letting a malformed pasted URL break the
  // search document.
  let decoded = slug
  try {
    decoded = decodeURIComponent(slug)
  } catch {
    // Preserve the literal input; search remains usable and the canonical link
    // will replace unsupported punctuation with a plain slug.
  }
  return decoded.replace(/-+/g, ' ').trim()
}

export const searchHref = (query: string) => {
  const slug = searchSlug(query)
  return slug ? `/search/${slug}` : '/search'
}

/**
 * Categories get their own pages rather than a search for their own name. A
 * broad word like "toys" is not a query any catalogue answers well — the shops
 * sell board games and building sets, not "toys" — so the category page asks
 * the questions the sources can actually answer and lets the shopper pick.
 */
export const categoryHref = (categoryQuery: string) => `/c/${searchSlug(categoryQuery)}`
