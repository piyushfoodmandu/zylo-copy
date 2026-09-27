import { useLoaderData, useLocalSearchParams, type ErrorBoundaryProps } from 'expo-router'
import { useIsFocused } from 'expo-router/react-navigation'
import type { GenerateMetadataFunction } from 'expo-server'
import { Platform, View } from 'react-native'
import { JsonLd } from '../../components/JsonLd'
import { CatalogRouteError } from '../../components/CatalogRouteError'
import { groupCatalogProducts } from '../../lib/product-groups'
import { isCuratedSearchQuery } from '../../lib/categories'
import { productHref, queryFromSearchSlug, searchHref } from '../../lib/product-url'
import { CatalogDataError, loadSearchDocument } from '../../lib/catalog-server-data'
import { setCatalogRouteFailure, setPublicCatalogCache } from '../../lib/server-cache'
import { breadcrumbStructuredData, collectionPageStructuredData, pageMetadata, siteName } from '../../lib/seo'
import { ResultsScreen } from '../../screens/ResultsScreen'
import type { SearchResponse } from '../../types/catalog'

type LoaderResult = {
  query: string
  response?: SearchResponse
  failure?: 'missing' | 'unavailable'
}

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <CatalogRouteError {...props} />
}

const queryFrom = (params: Record<string, string | string[]> | undefined) => {
  const raw = params?.query
  const value = Array.isArray(raw) ? raw[0] : raw
  return value ? queryFromSearchSlug(value) : ''
}

const loadResults = async (params: Record<string, string | string[]> | undefined): Promise<LoaderResult> => {
  const query = queryFrom(params)
  if (!query) return { query: '', failure: 'missing' }
  try {
    // Unfiltered relevance only. Filter and sort permutations are shopper state,
    // not separate documents, so they stay on the client and off the index.
    const response = await loadSearchDocument(query)
    return { query, response }
  } catch (error) {
    return {
      query,
      failure: error instanceof CatalogDataError && error.status === 404
        ? 'missing'
        : 'unavailable'
    }
  }
}

export async function loader(_request: unknown, params: Record<string, string | string[]>) {
  const result = await loadResults(params)
  if (result.failure) setCatalogRouteFailure()
  else setPublicCatalogCache((result.response?.items ?? []).map((item) => item.sourceLabel))
  return result
}

export const generateMetadata: GenerateMetadataFunction = (_request, params) => {
  const query = queryFrom(params)

  if (!query) {
    return pageMetadata({
      title: `Search · ${siteName}`,
      description: 'Search products and compare live offers from real shops.',
      path: '/search',
      robots: { index: false, follow: true }
    })
  }

  const indexable = isCuratedSearchQuery(query)
  return pageMetadata({
    title: `${query} — compare prices · ${siteName}`,
    description: `Compare live offers for ${query} from real shops, with the source and freshness of every price.`,
    path: searchHref(query),
    robots: indexable
      ? 'index, follow, max-snippet:-1, max-image-preview:large'
      : 'noindex, follow'
  })
}

export default function SearchRoute() {
  const params = useLocalSearchParams<{ query?: string | string[]; compare?: string | string[] }>()
  const data = Platform.OS === 'web'
    ? useLoaderData<typeof loader>() as LoaderResult | undefined
    : undefined
  const focused = useIsFocused()
  const response = data?.response
  const query = data?.query || queryFrom(params as Record<string, string | string[]>)
  const compareParam = Array.isArray(params.compare) ? params.compare[0] : params.compare
  const groups = groupCatalogProducts(response?.items ?? [])

  if (Platform.OS === 'web' && !focused) return null

  if (data?.failure) {
    return (
      <CatalogRouteError
        error={new Error(data.failure === 'missing' ? 'Search not found.' : 'Search is temporarily unavailable.')}
      />
    )
  }

  const category = response?.interpretedQuery?.detectedCategories?.[0]
  const listItems = groups.map((group) => ({
    title: group.product.title,
    path: productHref({
      businessId: group.product.businessId,
      productId: group.product.productId,
      title: group.product.title
    })
  }))

  return (
    <View className="flex-1">
      {query && groups.length > 0 ? (
        <>
          <JsonLd data={collectionPageStructuredData({
            name: `${query} — offers across shops`,
            description: `Live offers for ${query} from real shops, each labelled with its source and when the price was last checked.`,
            path: searchHref(query),
            ...(category ? { about: category } : {}),
            items: listItems,
            // Source fetch time, not render time. The page is exactly as fresh
            // as the prices on it.
            ...(response?.items[0]?.sourceLabel.fetchedAt
              ? { dateModified: response.items[0]!.sourceLabel.fetchedAt }
              : {})
          })} />
          {/* The same trail the page renders. Structured data that describes a
              path the document never shows is a claim it cannot back. */}
          <JsonLd data={breadcrumbStructuredData([
            { name: 'Home', path: '/' },
            ...(category ? [{ name: category, path: searchHref(category) }] : []),
            { name: query, path: searchHref(query) }
          ])} />
        </>
      ) : null}
      <ResultsScreen
        {...(response ? { initialResponse: response } : {})}
        {...(query ? { initialQuery: query } : {})}
        compareMode={compareParam === '1'}
      />
    </View>
  )
}
