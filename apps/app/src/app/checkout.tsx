import type { GenerateMetadataFunction } from 'expo-server'
import { CheckoutScreen } from '../screens/CheckoutScreen'
import { pageMetadata, siteName } from '../lib/seo'

export const generateMetadata: GenerateMetadataFunction = () => pageMetadata({
  title: `Checkout · ${siteName}`,
  description: 'Complete your purchase with the shop that sells the item.',
  path: '/checkout',
  robots: { index: false, follow: false }
})

export default CheckoutScreen
