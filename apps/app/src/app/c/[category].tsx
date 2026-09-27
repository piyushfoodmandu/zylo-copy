import { Redirect, useLoaderData, useLocalSearchParams, type ErrorBoundaryProps } from 'expo-router'
import { useIsFocused } from 'expo-router/react-navigation'
import { useEffect, useState } from 'react'
import type { GenerateMetadataFunction } from 'expo-server'
import { Platform, View } from 'react-native'
import { JsonLd } from '../../components/JsonLd'
import { CatalogRouteError } from '../../components/CatalogRouteError'
import { CategoryScreen } from '../../screens/CategoryScreen'
import { categoryBySlug } from '../../lib/categories'
import { loadCategoryRails, type CategoryRails } from '../../lib/catalog-page-data'
import { catalogDeadlineMs } from '../../lib/catalog-deadline'
import { CatalogDataError, loadCategoryDocument } from '../../lib/catalog-server-data'
import { categoryHref, productHref } from '../../lib/product-url'
import { setCatalogRouteFailure, setPublicCatalogCache } from '../../lib/server-cache'
import { breadcrumbStructuredData, collectionPageStructuredData, pageMetadata, siteName } from '../../lib/seo'
import { groupCatalogProducts } from '../../lib/product-groups'

export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <CatalogRouteError {...props} />
}

/**
 * Bounded fan-out. A landing page is not a licence to open ten source calls.
 *
 * Two separate things used to make a stocked category look dead. Only the first
 * three sub-categories were ever probed, so a category whose first three happen
 * to be thin rendered empty while its other rails had plenty. And a rail that
 * came back with nothing was treated as proof the category is empty, when a
 * throttled or timed-out source returns exactly the same shape — measured on
 * this catalogue, Mobility and DIY rendered "No products here yet" during a
 * burst and 24 and 22 products a minute later, from the same URLs.
 *
 * So: probe the first three, and only reach further when they do not fill the
 * page. The burst stays the same size in the normal case, which matters because
 * the burst is what provokes the throttling in the first place.
 */
const slugFrom = (params: Record<string, string | string[]> | undefined) => {
  const raw = params?.category
  const value = Array.isArray(raw) ? raw[0] : raw
  return value?.trim() ?? ''
}

type CategoryLoaderResult = CategoryRails & { failure?: 'missing' | 'unavailable' }

const loadCategory = async (params: Record<string, string | string[]> | undefined): Promise<CategoryLoaderResult> => {
  const slug = slugFrom(params)
  if (!slug) return { slug: '', rails: [], unreachable: false, failure: 'missing' }
  try {
    return await loadCategoryDocument(slug)
  } catch (error) {
    return {
      slug,
      rails: [],
      unreachable: false,
      failure: error instanceof CatalogDataError && error.status === 404
        ? 'missing'
        : 'unavailable'
    }
  }
}

export async function loader(_request: unknown, params: Record<string, string | string[]>) {
  const result = await loadCategory(params)
  if (result.failure) setCatalogRouteFailure()
  else setPublicCatalogCache(result.rails.flatMap((rail) => rail.items.map((item) => item.sourceLabel)))
  return result
}

export const generateMetadata: GenerateMetadataFunction = (_request, params) => {
  const slug = slugFrom(params)
  const category = slug ? categoryBySlug(slug) : undefined
  if (!category) {
    return pageMetadata({
      title: `Category not found · ${siteName}`,
      description: 'Browse the categories Arro compares prices across.',
      path: '/',
      robots: { index: false, follow: true },
      canonicalize: false
    })
  }

  const topics = category.children.slice(0, 3).map((child) => child.label.toLowerCase())
  const description = `Compare ${category.label.toLowerCase()} prices across real shops, including ${topics.join(', ')}. Every offer shows its source and freshness.`

  return pageMetadata({
    title: `${category.label} — compare prices · ${siteName}`,
    description,
    path: categoryHref(category.query),
    robots: 'index, follow, max-snippet:-1, max-image-preview:large'
  })
}

export default function CategoryRoute() {
  const params = useLocalSearchParams<{ category?: string | string[] }>()
  const serverData = Platform.OS === 'web'
    ? useLoaderData<typeof loader>() as CategoryLoaderResult | undefined
    : undefined
  const routeSlug = slugFrom(params as Record<string, string | string[]>)
  const [nativeData, setNativeData] = useState<CategoryLoaderResult>()
  const [missing, setMissing] = useState(false)
  const focused = useIsFocused()

  useEffect(() => {
    if (Platform.OS === 'web' || serverData || nativeData || missing || !routeSlug) return
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), catalogDeadlineMs)
    let active = true
    void loadCategoryRails(routeSlug, controller.signal)
      .then((result) => {
        if (!active) return
        if (result) setNativeData(result)
        else setMissing(true)
      })
      .catch(() => {
        if (active) setNativeData({ slug: routeSlug, rails: [], unreachable: true })
      })
    return () => {
      active = false
      clearTimeout(timeout)
      controller.abort()
    }
  }, [missing, nativeData, routeSlug, serverData])

  if (Platform.OS === 'web' && !focused) return null

  const data = serverData ?? nativeData
  if (data?.failure) {
    return (
      <CatalogRouteError
        error={new Error(data.failure === 'missing' ? 'Category not found.' : 'Category offers are temporarily unavailable.')}
      />
    )
  }
  const slug = data?.slug || routeSlug
  const category = categoryBySlug(slug)
  if (!category || missing) return <Redirect href="/not-found" />
  const rails = data?.rails ?? []

  const listItems = rails.flatMap((rail) =>
    groupCatalogProducts(rail.items).map((group) => ({
      title: group.product.title,
      path: productHref({
        businessId: group.product.businessId,
        productId: group.product.productId,
        title: group.product.title
      })
    })))

  return (
    <View className="flex-1">
      {rails.length > 0 ? (
        <>
          <JsonLd data={collectionPageStructuredData({
            name: `${category.label} — compare prices`,
            description: `Live offers across ${category.label.toLowerCase()}, each labelled with its shop and when the price was last checked.`,
            path: categoryHref(category.query),
            about: category.label,
            items: listItems,
            ...(data?.fetchedAt ? { dateModified: data.fetchedAt } : {})
          })} />
          <JsonLd data={breadcrumbStructuredData([
            { name: 'Home', path: '/' },
            { name: category.label, path: categoryHref(category.query) }
          ])} />
        </>
      ) : null}
      <CategoryScreen
        category={category}
        rails={rails}
        loading={Platform.OS !== 'web' && !data}
        unreachable={Boolean(data?.unreachable)}
      />
    </View>
  )
}
