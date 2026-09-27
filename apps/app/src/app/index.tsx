import { useLoaderData } from 'expo-router'
import { useIsFocused } from 'expo-router/react-navigation'
import { useEffect, useState } from 'react'
import type { GenerateMetadataFunction } from 'expo-server'
import { Platform, View } from 'react-native'
import { JsonLd } from '../components/JsonLd'
import { DiscoverScreen } from '../screens/DiscoverScreen'
import { loadHomeRails, type HomeRails } from '../lib/catalog-page-data'
import { catalogDeadlineMs, withCatalogDeadline } from '../lib/catalog-deadline'
import { productHref } from '../lib/product-url'
import { setPublicCatalogCache } from '../lib/server-cache'
import {
  itemListStructuredData,
  organizationStructuredData,
  pageMetadata,
  siteName,
  websiteStructuredData
} from '../lib/seo'

/**
 * The home page leads with what Arro can actually prove, not with a shelf of
 * arbitrary searches.
 *
 * The seeds are a sampling method, not the story: everything they return is
 * pooled, grouped by product identity, and then ranked twice — by the spread
 * between the cheapest and dearest shop selling the same thing, and by how many
 * people reviewed it. Both numbers come from the sources; neither is paid,
 * invented, or a claim about a price in the past.
 */
export async function loader() {
  const result = await withCatalogDeadline((signal) => loadHomeRails(signal))
  setPublicCatalogCache([...result.popular, ...result.rated].map((product) => product.sourceLabel))
  return result
}

export const generateMetadata: GenerateMetadataFunction = () => pageMetadata({
  title: `${siteName} — compare prices across real shops`,
  description: 'Search once and see live prices from real shops side by side, each with the shop it came from and when the price was last checked.',
  path: '/'
})

export default function HomeRoute() {
  // Expo SDK 57 data loaders only exist on web. Installed apps reuse the same
  // bounded data function instead of asking a nonexistent /_expo/loaders URL.
  const serverData = Platform.OS === 'web'
    ? useLoaderData<typeof loader>() as HomeRails | undefined
    : undefined
  const [nativeData, setNativeData] = useState<HomeRails>()
  const focused = useIsFocused()

  useEffect(() => {
    if (Platform.OS === 'web' || serverData || nativeData) return
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), catalogDeadlineMs)
    let active = true
    void loadHomeRails(controller.signal).then((result) => { if (active) setNativeData(result) })
    return () => {
      active = false
      clearTimeout(timeout)
      controller.abort()
    }
  }, [nativeData, serverData])

  // A Stack renders prefetched routes off-screen so their loader data can warm.
  // Do not mount the actual page until it owns focus: page effects and JSON-LD
  // describe the visible document, not speculative navigation.
  if (Platform.OS === 'web' && !focused) return null

  const data = serverData ?? nativeData
  return (
    <View className="flex-1">
      <JsonLd data={organizationStructuredData()} />
      <JsonLd data={websiteStructuredData()} />
      {(data?.popular.length ?? 0) > 0 ? (
        <JsonLd data={itemListStructuredData({
          name: 'Popular on Arro',
          path: '/',
          items: (data?.popular ?? []).map((product) => ({
            title: product.title,
            path: productHref({
              businessId: product.businessId,
              productId: product.productId,
              title: product.title
            })
          }))
        })} />
      ) : null}
      <DiscoverScreen
        popular={data?.popular ?? []}
        rated={data?.rated ?? []}
        loading={Platform.OS !== 'web' && !data}
        unavailable={Boolean(data?.unreachable)}
      />
    </View>
  )
}
