import type { MiddlewareFunction, MiddlewareSettings } from 'expo-server'
import { catalogErrorResponse } from '../lib/catalog-error-response'
import {
  CatalogDataError,
  loadCategoryDocument,
  loadProductDocument,
  loadSearchDocument
} from '../lib/catalog-server-data'
import { decodeProductIdentity, queryFromSearchSlug } from '../lib/product-url'

export const unstable_settings: MiddlewareSettings = {
  matcher: {
    methods: ['GET', 'HEAD'],
    patterns: ['/c/[category]', '/search/[query]', '/p/[slug]/[id]']
  }
}

const routePathname = (requestUrl: string) => {
  const pathname = new URL(requestUrl).pathname
  return pathname.startsWith('/_expo/loaders/')
    ? pathname.slice('/_expo/loaders'.length).replace(/\/index$/, '/')
    : pathname
}

const segment = (value: string | undefined) => {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return ''
  }
}

const errorDocument = (error: unknown) => {
  const status = error instanceof CatalogDataError ? error.status : 503
  const missing = status === 404
  return catalogErrorResponse(
    status,
    missing ? 'We could not find this page' : 'This page is temporarily unavailable',
    missing
      ? 'The category, search or product may have moved. Search again or return to Discover.'
      : 'One or more shops did not answer in time. Nothing was changed; try again shortly.'
  )
}

/**
 * Expo 57 can attach headers to rendered loader pages but exposes no status
 * setter. Validate only the three source-backed document routes here: a
 * middleware Response preserves real 404/503 semantics, while the shared
 * promise cache lets the following metadata and loader phases reuse the work.
 */
const catalogMiddleware: MiddlewareFunction = async (request) => {
  const parts = routePathname(request.url).split('/').filter(Boolean)
  try {
    if (parts[0] === 'c') {
      await loadCategoryDocument(segment(parts[1]))
    } else if (parts[0] === 'search') {
      await loadSearchDocument(queryFromSearchSlug(segment(parts[1])))
    } else if (parts[0] === 'p') {
      await loadProductDocument(decodeProductIdentity(segment(parts[2])))
    }
  } catch (error) {
    return errorDocument(error)
  }
}

export default catalogMiddleware
