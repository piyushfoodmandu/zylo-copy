import type { GenerateMetadataFunction } from 'expo-server'
import { AccountScreen } from '../screens/AccountScreen'
import { pageMetadata, siteName } from '../lib/seo'

// One shopper's own orders, lists and checkout details. Nothing public to index.
export const generateMetadata: GenerateMetadataFunction = () => pageMetadata({
  title: `Your account · ${siteName}`,
  description: 'Your orders, saved products and the details Arro sends to a shop at checkout.',
  path: '/account',
  robots: { index: false, follow: false }
})

export default AccountScreen
