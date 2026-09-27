import type { GenerateMetadataFunction } from 'expo-server'
import { CartScreen } from '../screens/CartScreen'
import { pageMetadata, siteName } from '../lib/seo'

// The cart is device-local shopping state, so there is no durable public
// document here to index.
export const generateMetadata: GenerateMetadataFunction = () => pageMetadata({
  title: `Cart · ${siteName}`,
  description: 'Items you are considering, grouped by the shop that sells them.',
  path: '/cart',
  robots: { index: false, follow: true }
})

export default CartScreen
