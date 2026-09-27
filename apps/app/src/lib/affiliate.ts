/**
 * Attribution on outbound merchant links.
 *
 * When Arro cannot complete a checkout it sends the shopper to the shop, and
 * that hand-off is the moment attribution has to survive — a referral that
 * arrives without its parameters is a referral the network cannot credit.
 *
 * Rules that keep this honest rather than parasitic:
 *
 *  - Parameters the merchant already put on the URL are never overwritten. An
 *    aggregated catalogue often ships its own attribution (Shopify's `_gsid`),
 *    and clobbering it would steal a credit that is not Arro's.
 *  - Nothing is invented. If no network is configured, the URL leaves untouched.
 *  - No shopper identifiers are attached. Attribution identifies Arro, not the
 *    person, and a referral parameter is not a place to smuggle a user ID.
 *
 * Commercial isolation still holds: this changes who gets paid for a click, and
 * never what Arro showed, ranked, warned about, or charged.
 */
const parseParams = (raw: string | undefined): Array<[string, string]> => {
  if (!raw?.trim()) return []
  return raw.split(',').flatMap((pair) => {
    const index = pair.indexOf('=')
    if (index <= 0) return []
    const key = pair.slice(0, index).trim()
    const value = pair.slice(index + 1).trim()
    return key && value ? [[key, value] as [string, string]] : []
  })
}

/** e.g. `EXPO_PUBLIC_ARRO_AFFILIATE_PARAMS=utm_source=arro,ref=arro` */
const affiliateParams = parseParams(process.env.EXPO_PUBLIC_ARRO_AFFILIATE_PARAMS)

export const affiliateUrl = (url: string) => {
  if (affiliateParams.length === 0) return url
  try {
    const parsed = new URL(url)
    for (const [key, value] of affiliateParams) {
      if (parsed.searchParams.has(key)) continue
      parsed.searchParams.set(key, value)
    }
    return parsed.toString()
  } catch {
    // A URL Arro cannot parse is a URL it must not rewrite.
    return url
  }
}

/**
 * The `attribution` block UCP carries on a prepared checkout, so a merchant that
 * reads it can credit the referral without depending on query parameters
 * surviving a redirect chain.
 */
export const attributionPayload = () => {
  const source = process.env.EXPO_PUBLIC_ARRO_AFFILIATE_SOURCE?.trim()
  return source ? { source, channel: 'arro' } : undefined
}
