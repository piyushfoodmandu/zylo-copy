import { setResponseHeaders } from 'expo-server'

export type CatalogFreshness = {
  fetchedAt: string
  expiresAt?: string
}

const maximumSharedAgeSeconds = 30
const noStore = 'no-store'

/**
 * Public catalogue documents contain no account or device state, so a shared
 * cache may reuse them briefly. The cache window is deliberately smaller than
 * the API reuse window and is clipped to the earliest source expiry. A page
 * with no source facts, an invalid timestamp, or an already-expired answer is
 * never cached.
 *
 * `max-age=0` keeps browser navigation revalidating. `s-maxage` is the bounded
 * CDN/shared-cache window, and `must-revalidate` prevents a cache from serving
 * an expired price merely because the origin is temporarily unreachable.
 */
export const publicCatalogCacheControl = (
  freshness: readonly CatalogFreshness[],
  nowMs = Date.now()
) => {
  if (freshness.length === 0 || !Number.isFinite(nowMs)) return noStore

  let sharedAgeSeconds = maximumSharedAgeSeconds
  for (const source of freshness) {
    const fetchedAtMs = Date.parse(source.fetchedAt)
    if (!Number.isFinite(fetchedAtMs)) return noStore

    if (source.expiresAt) {
      const expiresAtMs = Date.parse(source.expiresAt)
      if (!Number.isFinite(expiresAtMs)) return noStore
      const remainingSeconds = Math.floor((expiresAtMs - nowMs) / 1000)
      if (remainingSeconds <= 0) return noStore
      sharedAgeSeconds = Math.min(sharedAgeSeconds, remainingSeconds)
    }
  }

  return `public, max-age=0, s-maxage=${sharedAgeSeconds}, must-revalidate`
}

export const setPublicCatalogCache = (freshness: readonly CatalogFreshness[]) => {
  setResponseHeaders({
    'cache-control': publicCatalogCacheControl(freshness)
  })
}

/** Last-resort loader fallback; middleware supplies the actual 404/503 status. */
export const setCatalogRouteFailure = () => {
  setResponseHeaders({
    'cache-control': noStore,
    'x-robots-tag': 'noindex, follow'
  })
}
