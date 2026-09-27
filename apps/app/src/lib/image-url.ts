/**
 * Merchant media is served from the shop's own CDN and Arro renders it directly
 * rather than proxy-copying it. That leaves exactly one safe optimisation: ask
 * the CDN for the size the layout will actually paint.
 *
 * The transform is only applied to hosts whose resizing contract is published.
 * Appending a guessed parameter to an unknown host either does nothing or
 * breaks the image, and a broken product photo is worse than a large one.
 */
const resizableHosts = new Set([
  'cdn.shopify.com',
  'cdn.shopifycdn.net'
])

/** Rendered widths a product image is ever asked for, smallest first. */
export const imageWidths = [160, 240, 320, 480, 640, 960, 1280] as const

const parse = (url: string) => {
  try {
    const parsed = new URL(url)
    return resizableHosts.has(parsed.hostname) ? parsed : undefined
  } catch {
    return undefined
  }
}

export const sizedImageUrl = (url: string, width: number) => {
  const parsed = parse(url)
  if (!parsed) return url
  // Shopify's CDN takes `width` and returns the original when it is larger than
  // the source, so asking for more than exists is safe.
  parsed.searchParams.set('width', String(Math.round(width)))
  return parsed.toString()
}

export const imageSrcSet = (url: string) => {
  if (!parse(url)) return undefined
  return imageWidths.map((width) => `${sizedImageUrl(url, width)} ${width}w`).join(', ')
}

/**
 * The rendered width of a grid tile at each breakpoint, mirroring the column
 * counts in `lib/layout.ts`. Without this the browser assumes a full-width
 * image and downloads the largest candidate for a 180px tile.
 */
export const gridImageSizes =
  '(min-width: 1400px) 17vw, (min-width: 1080px) 21vw, (min-width: 760px) 29vw, (min-width: 380px) 45vw, 92vw'

export const heroImageSizes = '(min-width: 1024px) 46vw, 92vw'

export const thumbImageSizes = '72px'
