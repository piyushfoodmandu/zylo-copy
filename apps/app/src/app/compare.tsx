import { useLoaderData } from 'expo-router'
import type { GenerateMetadataFunction, ImmutableRequest } from 'expo-server'
import { Platform } from 'react-native'
import { getProductDetail } from '../api/client'
import { CompareScreen } from '../screens/CompareScreen'
import { decodeProductIdentity } from '../lib/product-url'
import { withCatalogDeadline } from '../lib/catalog-deadline'
import { setPublicCatalogCache } from '../lib/server-cache'
import { pageMetadata, siteName } from '../lib/seo'
import type { CatalogProductSummary } from '../types/catalog'

type LoaderResult = { products: CatalogProductSummary[] }

export async function loader(request: ImmutableRequest | undefined): Promise<LoaderResult> {
  const rawItems = request ? new URL(request.url).searchParams.get('items') : undefined
  const identities = (rawItems ?? '')
    .split(',')
    .slice(0, 4)
    .map(decodeProductIdentity)
    .filter((identity): identity is NonNullable<typeof identity> => Boolean(identity))

  const responses = await withCatalogDeadline((signal) => Promise.all(identities.map(async (identity) => {
    try {
      return await getProductDetail(identity, signal)
    } catch {
      return undefined
    }
  })))
  const products = responses.flatMap((response) => response?.product
    ? [{ ...response.product, matchReasons: [] }]
    : [])
  setPublicCatalogCache(products.map((product) => product.sourceLabel))
  return { products }
}

// The comparison URL is durable for the shopper who has it, but remains a
// utility document rather than another indexable product landing page.
export const generateMetadata: GenerateMetadataFunction = () => pageMetadata({
  title: `Compare products · ${siteName}`,
  description: 'Compare selected products side by side on price, rating, availability and shop.',
  path: '/compare',
  robots: { index: false, follow: true }
})

export default function CompareRoute() {
  const data = Platform.OS === 'web'
    ? useLoaderData<typeof loader>() as LoaderResult | undefined
    : undefined
  return <CompareScreen initialProducts={data?.products ?? []} />
}
