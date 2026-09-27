import { createElement } from 'react'
import { imageSrcSet, sizedImageUrl } from '../lib/image-url'
import type { ProductImageProps } from './ProductImage'

/**
 * React Native Web draws images as a CSS background with an invisible, empty-alt
 * `<img>` behind it. That is fine for a native-feeling app and useless for the
 * web: no alt text for Google Images, no native lazy loading, no intrinsic size
 * for the browser to reserve, and no way to offer responsive candidates. On web
 * the product image is a real `<img>`.
 *
 * `srcset` is only emitted for CDNs whose resizing contract is published, so the
 * browser picks a candidate that matches the tile instead of downloading a
 * 2000px merchant export into a 180px grid cell.
 */
export const ProductImage = ({
  uri,
  alt,
  className,
  width,
  height,
  sizes,
  priority = false
}: ProductImageProps) => {
  const srcSet = imageSrcSet(uri)

  return createElement('img', {
    src: width ? sizedImageUrl(uri, width * 2) : uri,
    alt,
    className,
    ...(srcSet ? { srcSet } : {}),
    ...(srcSet && sizes ? { sizes } : {}),
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    loading: priority ? 'eager' : 'lazy',
    decoding: priority ? 'sync' : 'async',
    ...(priority ? { fetchPriority: 'high' } : {}),
    style: { objectFit: 'contain', maxWidth: '100%', maxHeight: '100%' }
  })
}
