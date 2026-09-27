import type { GenerateMetadataFunction } from 'expo-server'
import { SavedScreen } from '../screens/SavedScreen'
import { pageMetadata, siteName } from '../lib/seo'

// Saved products are this device's decision state, not a public page.
export const generateMetadata: GenerateMetadataFunction = () => pageMetadata({
  title: `Saved · ${siteName}`,
  description: 'Products you saved, rechecked for current price and availability.',
  path: '/saved',
  robots: { index: false, follow: true }
})

export default SavedScreen
