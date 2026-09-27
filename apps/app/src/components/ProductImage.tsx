import { Image } from 'expo-image'
import { sizedImageUrl } from '../lib/image-url'

export type ProductImageProps = {
  uri: string
  alt: string
  className?: string
  /** Rendered width in points. Used to request a CDN-sized source. */
  width?: number
  height?: number
  /** Media-condition list for the web `sizes` attribute. */
  sizes?: string
  priority?: boolean
}

export const ProductImage = ({ uri, alt, className, width, priority }: ProductImageProps) => (
  <Image
    // A phone tile never needs the merchant's full-resolution export. Asking the
    // CDN for the painted size is the cheapest bandwidth win available here.
    source={{ uri: width ? sizedImageUrl(uri, width * 2) : uri }}
    contentFit="contain"
    accessibilityIgnoresInvertColors
    accessibilityLabel={alt}
    priority={priority ? 'high' : 'normal'}
    {...(className ? { className } : {})}
  />
)
