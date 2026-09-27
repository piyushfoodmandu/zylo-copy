import { useLocalSearchParams, useLoaderData, type ErrorBoundaryProps } from 'expo-router'
import { useIsFocused } from 'expo-router/react-navigation'
import type { GenerateMetadataFunction } from 'expo-server'
import { Platform, View } from 'react-native'
import { JsonLd } from '../../../components/JsonLd'
import { CatalogRouteError } from '../../../components/CatalogRouteError'
import { DetailScreen } from '../../../screens/DetailScreen'
import { productBrowseTrail } from '../../../lib/categories'
import {
  CatalogDataError,
  loadProductDocument,
  type ProductDocument
} from '../../../lib/catalog-server-data'
import { categoryHref, decodeProductIdentity, productHref, searchHref } from '../../../lib/product-url'
import { setCatalogRouteFailure, setPublicCatalogCache } from '../../../lib/server-cache'
import {
  breadcrumbStructuredData,
  pageMetadata,
  productStructuredData,
  siteName,
  type StructuredOffer
} from '../../../lib/seo'
import type { CatalogProductDetail } from '../../../types/catalog'

type DetailSuccess = ProductDocument
type LoaderResult = DetailSuccess | { failure: 'missing' | 'unavailable' }

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <CatalogRouteError {...props} />
}

const identityFrom = (params: Record<string, string | string[]>) => {
  const raw = params.id
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim()
  return value ? decodeProductIdentity(value) : undefined
}

const loadDetail = async (params: Record<string, string | string[]>): Promise<DetailSuccess> => {
  return loadProductDocument(identityFrom(params))
}

export async function loader(_request: unknown, params: Record<string, string | string[]>) {
  try {
    const result = await loadDetail(params)
    setPublicCatalogCache([result.detail.sourceLabel])
    return result
  } catch (error) {
    setCatalogRouteFailure()
    return {
      failure: error instanceof CatalogDataError && error.status === 404
        ? 'missing' as const
        : 'unavailable' as const
    }
  }
}

const pathFor = (params: Record<string, string | string[]>, title: string) => {
  const identity = identityFrom(params)
  return identity
    ? productHref({ businessId: identity.businessId, productId: identity.productId, title })
    : '/'
}

const offerSummary = (detail: CatalogProductDetail): StructuredOffer[] => {
  const fromVariants = detail.variants
    .filter((variant) => variant.seller)
    .map((variant) => ({
      ...(variant.price ? { price: variant.price } : {}),
      availability: variant.availability,
      condition: variant.condition ?? detail.condition,
      sellerName: variant.seller?.name || variant.seller?.domain || detail.businessName,
      ...(variant.productUrl ? { url: variant.productUrl } : {})
    }))

  if (fromVariants.length > 0) return fromVariants
  return [{
    ...(detail.price ? { price: detail.price } : {}),
    availability: detail.availability,
    condition: detail.condition,
    sellerName: detail.seller?.name || detail.businessName,
    ...(detail.productUrl ? { url: detail.productUrl } : {})
  }]
}

export const generateMetadata: GenerateMetadataFunction = async (_request, params) => {
  try {
    const { detail } = await loadDetail(params)
    const offers = offerSummary(detail)
    const images = [detail.imageUrl, ...detail.media.filter((media) => media.type === 'image').map((media) => media.url)]
      .filter((value): value is string => Boolean(value))

    return pageMetadata({
      title: `${detail.title} — compare prices · ${siteName}`,
      description: detail.description?.slice(0, 160)
        ?? `Compare live offers for ${detail.title} from real shops, with the source and freshness of every price.`,
      path: pathFor(params, detail.title),
      type: 'product',
      images,
      imageAlt: detail.title
    })
  } catch {
    return pageMetadata({
      title: `Product unavailable · ${siteName}`,
      description: 'Search Arro for live product offers from real shops.',
      path: '/',
      robots: { index: false, follow: true },
      canonicalize: false
    })
  }
}

export default function ProductRoute() {
  const params = useLocalSearchParams<{ slug?: string | string[]; id?: string | string[] }>()
  const data = Platform.OS === 'web'
    ? useLoaderData<typeof loader>() as LoaderResult | undefined
    : undefined
  const focused = useIsFocused()
  const identity = identityFrom(params as Record<string, string | string[]>)
  if (Platform.OS === 'web' && !focused) return null
  if (data && 'failure' in data) {
    return (
      <CatalogRouteError
        error={new Error(data.failure === 'missing' ? 'Product not found.' : 'Product details are temporarily unavailable.')}
      />
    )
  }
  const detail = data?.detail

  return (
    <View className="flex-1">
      {detail ? (
        <>
          <JsonLd data={productStructuredData({
            product: detail,
            offers: offerSummary(detail),
            path: pathFor(params as Record<string, string | string[]>, detail.title)
          })} />
          <JsonLd data={breadcrumbStructuredData([
            { name: 'Home', path: '/' },
            ...productBrowseTrail(detail.title, detail.categoryPath).map((item) => ({
              name: item.name,
              path: item.kind === 'category' ? categoryHref(item.query) : searchHref(item.query)
            })),
            { name: detail.title, path: pathFor(params as Record<string, string | string[]>, detail.title) }
          ])} />
        </>
      ) : null}
      <DetailScreen
        identity={identity}
        {...(detail ? { initialDetail: detail } : {})}
        {...(data?.variantUnconfirmed ? { initialVariantUnconfirmed: true } : {})}
      />
    </View>
  )
}
