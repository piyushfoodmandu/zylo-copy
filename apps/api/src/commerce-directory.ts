import { TypeCompiler } from '@sinclair/typebox/compiler'
import { UcpProfileSchema, type UcpBusinessProfile } from '@arro/contracts'
import type { Queryable } from './target-business-repository.ts'

const ucpProfileValidator = TypeCompiler.Compile(UcpProfileSchema)

export type MerchantResolveInput = {
  merchantProfileUrl?: string
  merchantDomain?: string
  selectedOffer?: unknown
}

export type MerchantRefreshInput = {
  profileUrl: string
}

export type MerchantTransactionRefreshInput = MerchantResolveInput

export type CommerceMerchant = {
  merchantId: string
  canonicalOrigin: string
  profileUrl: string
  displayName?: string
  platform?: string
  advisoryScore?: number
  staleCacheFallback?: boolean
  /** Already-fetched live profile; checkout negotiation revalidates it. */
  businessProfile?: UcpBusinessProfile
  discoveryState: 'discovered' | 'profile_valid' | 'profile_invalid' | 'authentication_required' | 'temporarily_unavailable'
  source: 'explicit_profile' | 'direct_domain' | 'selected_offer' | 'ucp_checker_registry'
}

export interface CommerceDirectoryProvider {
  resolve(input: MerchantResolveInput): Promise<CommerceMerchant | undefined>
  refresh(input: MerchantRefreshInput): Promise<CommerceMerchant>
}

export type LiveUcpProfileCommerceDirectoryProviderOptions = {
  fetch?: typeof fetch
  cacheTtlMs?: number
  now?: () => Date
}

export type UcpCheckerRegistryDirectoryProviderOptions = {
  client: Queryable
  registryUrl: string
  fetch?: typeof fetch
  cacheTtlMs?: number
  staleCacheTtlMs?: number
  pageSize?: number
  now?: () => Date
}

export interface CommerceDirectory {
  resolve(input: MerchantResolveInput): Promise<CommerceMerchant>
  refreshForTransaction(input: MerchantTransactionRefreshInput): Promise<CommerceMerchant>
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const profileFromOrigin = (origin: string) => `${origin.replace(/\/$/, '')}/.well-known/ucp`

const urlFromMaybeDomain = (value: string) => {
  const raw = value.trim()
  if (!raw) return undefined
  try {
    return new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`)
  } catch {
    return undefined
  }
}

const isProbablyProfileUrl = (url: URL) =>
  url.pathname === '/.well-known/ucp' || url.pathname.endsWith('/.well-known/ucp')

const merchantFromUrl = ({
  value,
  source,
  displayName
}: {
  value: string
  source: CommerceMerchant['source']
  displayName?: string | undefined
}): CommerceMerchant | undefined => {
  const url = urlFromMaybeDomain(value)
  if (!url || (url.protocol !== 'https:' && url.hostname !== 'localhost')) return undefined
  if (url.username || url.password) return undefined

  const canonicalOrigin = url.origin
  const profileUrl = isProbablyProfileUrl(url) ? url.href : profileFromOrigin(canonicalOrigin)
  const hostname = url.hostname.toLowerCase()

  return {
    merchantId: canonicalOrigin,
    canonicalOrigin,
    profileUrl,
    displayName: displayName ?? hostname,
    ...(hostname.includes('myshopify.com') || hostname.endsWith('shopify.com') ? { platform: 'shopify' } : {}),
    discoveryState: 'discovered',
    source
  }
}

const nestedRecord = (record: Record<string, unknown>, key: string) => asRecord(record[key])

const nestedArrayRecords = (record: Record<string, unknown>, key: string) =>
  Array.isArray(record[key])
    ? (record[key] as unknown[]).map(asRecord)
    : []

const domainHint = (
  value: unknown,
  source: CommerceMerchant['source'],
  displayName?: string
) => ({
  value: stringValue(value),
  source,
  ...(displayName ? { displayName } : {})
})

const selectedOfferMerchantHints = (selectedOffer: unknown) => {
  const offer = asRecord(selectedOffer)
  const seller = nestedRecord(offer, 'seller')
  const merchant = nestedRecord(offer, 'merchant')
  const shop = nestedRecord(offer, 'shop')
  const store = nestedRecord(offer, 'store')
  const source = nestedRecord(offer, 'source')
  const listing = nestedRecord(offer, 'listing')
  const offerRecords = nestedArrayRecords(offer, 'offers')

  return [
    domainHint(offer.merchantProfileUrl, 'explicit_profile'),
    domainHint(offer.merchant_profile_url, 'explicit_profile'),
    domainHint(seller.ucpProfileUrl ?? seller.ucp_profile_url, 'explicit_profile', stringValue(seller.name)),
    domainHint(merchant.ucpProfileUrl ?? merchant.ucp_profile_url, 'explicit_profile', stringValue(merchant.name)),
    domainHint(offer.sellerDomain ?? offer.seller_domain, 'selected_offer'),
    domainHint(seller.domain, 'selected_offer', stringValue(seller.name)),
    domainHint(seller.shopifyDomain ?? seller.shopify_domain, 'selected_offer', stringValue(seller.name)),
    domainHint(seller.storefrontDomain ?? seller.storefront_domain, 'selected_offer', stringValue(seller.name)),
    domainHint(seller.url, 'selected_offer', stringValue(seller.name)),
    domainHint(merchant.domain ?? merchant.url, 'selected_offer', stringValue(merchant.name)),
    domainHint(shop.domain ?? shop.shopifyDomain ?? shop.shopify_domain ?? shop.url, 'selected_offer', stringValue(shop.name)),
    domainHint(store.domain ?? store.shopifyDomain ?? store.shopify_domain ?? store.url, 'selected_offer', stringValue(store.name)),
    domainHint(source.sellerDomain ?? source.seller_domain, 'selected_offer'),
    domainHint(listing.sellerDomain ?? listing.seller_domain, 'selected_offer'),
    ...offerRecords.flatMap((entry) => {
      const entrySeller = nestedRecord(entry, 'seller')
      return [
        domainHint(entrySeller.domain, 'selected_offer', stringValue(entrySeller.name)),
        domainHint(entrySeller.shopifyDomain ?? entrySeller.shopify_domain, 'selected_offer', stringValue(entrySeller.name)),
        domainHint(entry.merchantDomain ?? entry.merchant_domain, 'selected_offer')
      ]
    }),
    domainHint(offer.merchantDomain ?? offer.merchant_domain, 'selected_offer'),
    domainHint(offer.shopDomain ?? offer.shop_domain, 'selected_offer'),
    domainHint(offer.storeDomain ?? offer.store_domain, 'selected_offer'),
    domainHint(offer.checkoutUrl ?? offer.checkout_url, 'selected_offer'),
    domainHint(offer.productUrl ?? offer.product_url, 'selected_offer'),
    domainHint(offer.url, 'selected_offer')
  ]
}

const commerceProfile = (profile: unknown): UcpBusinessProfile | undefined => {
  if (!ucpProfileValidator.Check(profile)) return undefined
  const validated = profile as UcpBusinessProfile
  const capabilities = validated.ucp.capabilities ?? {}
  return Boolean(
    capabilities['dev.ucp.shopping.products'] ||
    capabilities['dev.ucp.shopping.catalog.search'] ||
    capabilities['dev.ucp.shopping.catalog.lookup'] ||
    capabilities['dev.ucp.shopping.cart'] ||
    capabilities['dev.ucp.shopping.checkout']
  ) ? validated : undefined
}

export const createLiveUcpProfileCommerceDirectoryProvider = ({
  fetch: fetcher = fetch,
  cacheTtlMs = 10 * 60 * 1000,
  now = () => new Date()
}: LiveUcpProfileCommerceDirectoryProviderOptions = {}): CommerceDirectoryProvider => {
  const cache = new Map<string, { expiresAt: number; merchant?: CommerceMerchant }>()

  const resolveDomain = async (
    rawValue: string | undefined,
    source: CommerceMerchant['source'],
    displayName?: string
  ) => {
    if (!rawValue) return undefined
    const candidate = merchantFromUrl({ value: rawValue, source, ...(displayName ? { displayName } : {}) })
    if (!candidate) return undefined
    const cached = cache.get(candidate.canonicalOrigin)
    if (cached && cached.expiresAt > now().getTime()) return cached.merchant

    try {
      const response = await fetcher(candidate.profileUrl, {
        headers: { Accept: 'application/json' },
        redirect: 'manual'
      })
      if (!response.ok) {
        const merchant = { ...candidate, discoveryState: 'profile_invalid' as const }
        cache.set(candidate.canonicalOrigin, { expiresAt: now().getTime() + cacheTtlMs, merchant })
        return undefined
      }
      const profile = commerceProfile(await response.json() as unknown)
      const merchant = profile
        ? { ...candidate, businessProfile: profile, discoveryState: 'profile_valid' as const }
        : { ...candidate, discoveryState: 'profile_invalid' as const }
      cache.set(candidate.canonicalOrigin, { expiresAt: now().getTime() + cacheTtlMs, merchant })
      return merchant.discoveryState === 'profile_valid' ? merchant : undefined
    } catch {
      cache.set(candidate.canonicalOrigin, { expiresAt: now().getTime() + cacheTtlMs })
      return undefined
    }
  }

  return {
    async resolve(input) {
      if (input.merchantProfileUrl) {
        const merchant = await resolveDomain(input.merchantProfileUrl, 'explicit_profile')
        if (merchant) return merchant
      }
      if (input.merchantDomain) {
        const merchant = await resolveDomain(input.merchantDomain, 'direct_domain')
        if (merchant) return merchant
      }
      for (const hint of selectedOfferMerchantHints(input.selectedOffer)) {
        const merchant = await resolveDomain(hint.value, hint.source, hint.displayName)
        if (merchant) return merchant
      }
      return undefined
    },

    async refresh(input) {
      const merchant = await resolveDomain(input.profileUrl, 'explicit_profile')
      if (!merchant) throw new Error('commerce_directory_profile_url_invalid')
      return merchant
    }
  }
}

type RegistryMerchantRow = {
  canonical_origin: string
  domain: string
  profile_url: string
  display_name: string | null
  platform: string | null
  advisory_score: number | null
  capabilities_json: unknown
  stale_after: Date | string
  refreshed_at: Date | string
}

const dateMs = (value: Date | string) => value instanceof Date ? value.getTime() : new Date(value).getTime()

const rowToRegistryMerchant = (
  row: RegistryMerchantRow,
  now: Date
): CommerceMerchant => ({
  merchantId: row.canonical_origin,
  canonicalOrigin: row.canonical_origin,
  profileUrl: row.profile_url,
  ...(row.display_name ? { displayName: row.display_name } : {}),
  ...(row.platform ? { platform: row.platform } : {}),
  ...(typeof row.advisory_score === 'number' ? { advisoryScore: row.advisory_score } : {}),
  staleCacheFallback: dateMs(row.stale_after) <= now.getTime(),
  discoveryState: dateMs(row.stale_after) <= now.getTime()
    ? 'temporarily_unavailable'
    : 'discovered',
  source: 'ucp_checker_registry'
})

const registryEntriesFromBody = (body: unknown) => {
  if (Array.isArray(body)) {
    return {
      entries: body,
      nextCursor: undefined
    }
  }
  const record = asRecord(body)
  return {
    entries: Array.isArray(record.merchants)
      ? record.merchants
      : Array.isArray(record.results)
        ? record.results
        : Array.isArray(record.data)
          ? record.data
          : [],
    nextCursor:
      stringValue(record.next_cursor) ??
      stringValue(record.nextCursor) ??
      stringValue(asRecord(record.pagination).next_cursor) ??
      stringValue(asRecord(record.pagination).nextCursor)
  }
}

const registryEntryToMerchant = (entry: unknown) => {
  const record = asRecord(entry)
  const domain =
    stringValue(record.domain) ??
    stringValue(record.merchant_domain) ??
    stringValue(record.merchantDomain) ??
    stringValue(record.host) ??
    stringValue(record.url)
  const profileUrl =
    stringValue(record.profile_url) ??
    stringValue(record.profileUrl) ??
    stringValue(record.ucp_profile_url) ??
    stringValue(record.ucpProfileUrl)
  const candidate = profileUrl
    ? merchantFromUrl({
        value: profileUrl,
        source: 'ucp_checker_registry',
        displayName: stringValue(record.display_name) ?? stringValue(record.displayName) ?? stringValue(record.name)
      })
    : domain
      ? merchantFromUrl({
          value: domain,
          source: 'ucp_checker_registry',
          displayName: stringValue(record.display_name) ?? stringValue(record.displayName) ?? stringValue(record.name)
        })
      : undefined
  if (!candidate) return undefined
  return {
    ...candidate,
    advisoryScore: typeof record.score === 'number'
      ? record.score
      : typeof record.ucp_score === 'number'
        ? record.ucp_score
        : undefined,
    capabilities: Array.isArray(record.capabilities)
      ? record.capabilities
      : Object.keys(asRecord(record.capabilities)).length > 0
        ? record.capabilities
        : [],
    sourceRef: stringValue(record.source_ref) ?? stringValue(record.sourceRef) ?? stringValue(record.id)
  }
}

export const createUcpCheckerRegistryDirectoryProvider = ({
  client,
  registryUrl,
  fetch: fetcher = fetch,
  cacheTtlMs = 6 * 60 * 60 * 1000,
  staleCacheTtlMs = 7 * 24 * 60 * 60 * 1000,
  pageSize = 500,
  now = () => new Date()
}: UcpCheckerRegistryDirectoryProviderOptions): CommerceDirectoryProvider => {
  let pendingRefresh: Promise<void> | undefined

  const cachedMerchant = async (candidate: CommerceMerchant | undefined) => {
    if (!candidate) return undefined
    const row = await client.query<RegistryMerchantRow>(
      `
        select *
        from ucp_checker_registry_merchants
        where canonical_origin = $1
          and stale_after > $2::timestamptz - ($3::text || ' milliseconds')::interval
        limit 1
      `,
      [candidate.canonicalOrigin, now().toISOString(), String(staleCacheTtlMs)]
    )
    return row.rows[0] ? rowToRegistryMerchant(row.rows[0], now()) : undefined
  }

  const upsertMerchant = async (merchant: NonNullable<ReturnType<typeof registryEntryToMerchant>>) => {
    const refreshedAt = now()
    const staleAfter = new Date(refreshedAt.getTime() + cacheTtlMs)
    await client.query(
      `
        insert into ucp_checker_registry_merchants (
          canonical_origin,
          domain,
          profile_url,
          display_name,
          platform,
          advisory_score,
          capabilities_json,
          provider,
          source_ref,
          refreshed_at,
          stale_after
        )
        values ($1, $2, $3, $4, $5, $6, $7::jsonb, 'ucp_checker', $8, $9::timestamptz, $10::timestamptz)
        on conflict (canonical_origin) do update
        set domain = excluded.domain,
            profile_url = excluded.profile_url,
            display_name = coalesce(excluded.display_name, ucp_checker_registry_merchants.display_name),
            platform = coalesce(excluded.platform, ucp_checker_registry_merchants.platform),
            advisory_score = excluded.advisory_score,
            capabilities_json = excluded.capabilities_json,
            provider = excluded.provider,
            source_ref = excluded.source_ref,
            refreshed_at = excluded.refreshed_at,
            stale_after = excluded.stale_after
      `,
      [
        merchant.canonicalOrigin,
        new URL(merchant.canonicalOrigin).hostname,
        merchant.profileUrl,
        merchant.displayName ?? null,
        merchant.platform ?? null,
        merchant.advisoryScore ?? null,
        JSON.stringify(merchant.capabilities),
        merchant.sourceRef ?? null,
        refreshedAt.toISOString(),
        staleAfter.toISOString()
      ]
    )
  }

  const refresh = async () => {
    let cursor: string | undefined
    do {
      const url = new URL(registryUrl)
      url.searchParams.set('limit', String(pageSize))
      if (cursor) url.searchParams.set('cursor', cursor)
      const response = await fetcher(url, {
        headers: { Accept: 'application/json' },
        redirect: 'manual'
      })
      if (!response.ok) throw new Error('ucp_checker_registry_unavailable')
      const body = await response.json() as unknown
      const { entries, nextCursor } = registryEntriesFromBody(body)
      const merchants = entries
        .map(registryEntryToMerchant)
        .filter((merchant): merchant is NonNullable<ReturnType<typeof registryEntryToMerchant>> => Boolean(merchant))
      const deduped = new Map<string, NonNullable<ReturnType<typeof registryEntryToMerchant>>>()
      for (const merchant of merchants) {
        const existing = deduped.get(merchant.canonicalOrigin)
        if (!existing || (merchant.advisoryScore ?? -1) > (existing.advisoryScore ?? -1)) {
          deduped.set(merchant.canonicalOrigin, merchant)
        }
      }
      for (const merchant of deduped.values()) await upsertMerchant(merchant)
      cursor = nextCursor
    } while (cursor)
  }

  const refreshIfDue = async () => {
    const latest = await client.query<{ latest: Date | string | null }>(
      'select max(refreshed_at) as latest from ucp_checker_registry_merchants',
      []
    )
    const latestMs = latest.rows[0]?.latest ? dateMs(latest.rows[0].latest) : 0
    if (latestMs > now().getTime() - cacheTtlMs) return
    pendingRefresh ??= refresh().finally(() => {
      pendingRefresh = undefined
    })
    await pendingRefresh
  }

  const cachedByMerchant = async (input: MerchantResolveInput) => {
    const candidates = [
      ...(input.merchantProfileUrl ? [merchantFromUrl({ value: input.merchantProfileUrl, source: 'explicit_profile' })] : []),
      ...(input.merchantDomain ? [merchantFromUrl({ value: input.merchantDomain, source: 'direct_domain' })] : []),
      ...selectedOfferMerchantHints(input.selectedOffer).flatMap((hint) =>
        hint.value
          ? [merchantFromUrl({ value: hint.value, source: hint.source, ...(hint.displayName ? { displayName: hint.displayName } : {}) })]
          : []
      )
    ]
    for (const candidate of candidates) {
      const cached = await cachedMerchant(candidate)
      if (cached) return cached
    }
    return undefined
  }

  return {
    async resolve(input) {
      await refreshIfDue().catch(() => undefined)
      return cachedByMerchant(input)
    },

    async refresh(input) {
      await refresh().catch(async () => {
        const cached = await cachedMerchant(merchantFromUrl({
          value: input.profileUrl,
          source: 'explicit_profile'
        }))
        if (cached) return
        throw new Error('ucp_checker_registry_unavailable')
      })
      const cached = await cachedMerchant(merchantFromUrl({
        value: input.profileUrl,
        source: 'explicit_profile'
      }))
      if (!cached) throw new Error('commerce_directory_profile_url_invalid')
      return cached
    }
  }
}

export const createDirectCommerceDirectoryProvider = (): CommerceDirectoryProvider => ({
  async resolve(input) {
    if (input.merchantProfileUrl) {
      const merchant = merchantFromUrl({
        value: input.merchantProfileUrl,
        source: 'explicit_profile'
      })
      if (merchant) return merchant
    }

    if (input.merchantDomain) {
      const merchant = merchantFromUrl({
        value: input.merchantDomain,
        source: 'direct_domain'
      })
      if (merchant) return merchant
    }

    for (const hint of selectedOfferMerchantHints(input.selectedOffer)) {
      const value = hint.value
      if (!value) continue
      const merchant = merchantFromUrl({
        value,
        source: hint.source,
        ...(hint.displayName ? { displayName: hint.displayName } : {})
      })
      if (merchant) return merchant
    }

    return undefined
  },

  async refresh(input) {
    const merchant = merchantFromUrl({
      value: input.profileUrl,
      source: 'explicit_profile'
    })
    if (!merchant) {
      throw new Error('commerce_directory_profile_url_invalid')
    }
    return merchant
  }
})

export const createCommerceDirectory = (
  providers: CommerceDirectoryProvider[] = [createDirectCommerceDirectoryProvider()]
): CommerceDirectory => ({
  async resolve(input) {
    for (const provider of providers) {
      const merchant = await provider.resolve(input)
      if (merchant) return merchant
    }
    throw new Error('commerce_directory_merchant_unresolved')
  },

  async refreshForTransaction(input) {
    return this.resolve(input)
  }
})
