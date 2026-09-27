import { lookup } from 'node:dns/promises'
import {
  isIP,
  type LookupFunction
} from 'node:net'

export type ResolverAddress = { address: string; family?: 4 | 6 }
export type ConnectorDnsResolver = (hostname: string) => Promise<ResolverAddress[]>

export type CachedDnsResolverOptions = {
  enabled?: boolean
  ttlMs?: number
  maxEntries?: number
  resolver?: ConnectorDnsResolver
  nowMs?: () => number
}

const defaultTtlMs = 30_000
const defaultMaxEntries = 512

export const createNodeLookupResolver = (): ConnectorDnsResolver =>
  async (hostname) => {
    const addresses = await lookup(hostname, { all: true })
    return addresses.map(({ address, family }) => ({
      address,
      family: family === 6 ? 6 : 4
    }))
  }

const addressFamily = (address: ResolverAddress): 4 | 6 =>
  address.family ?? (isIP(address.address) === 6 ? 6 : 4)

export const createDnsLookup = (resolver: ConnectorDnsResolver): LookupFunction =>
  (hostname, options, callback) => {
    void resolver(hostname)
      .then((addresses) => {
        const requestedFamily = options.family === 4 || options.family === 6
          ? options.family
          : undefined
        const resolvedAddresses = addresses
          .map((address) => ({
            address: address.address,
            family: addressFamily(address)
          }))
          .filter((address) => requestedFamily === undefined || address.family === requestedFamily)

        if (resolvedAddresses.length === 0) {
          const error = new Error(`No DNS addresses resolved for ${hostname}.`) as NodeJS.ErrnoException
          error.code = 'ENOTFOUND'
          callback(error, options.all ? [] : '', requestedFamily)
          return
        }

        if (options.all) {
          callback(null, resolvedAddresses)
          return
        }

        const firstAddress = resolvedAddresses[0]!
        callback(null, firstAddress.address, firstAddress.family)
      })
      .catch((error: NodeJS.ErrnoException) => {
        callback(error, options.all ? [] : '', undefined)
      })
  }

export const createCachedDnsResolver = ({
  enabled = true,
  ttlMs = defaultTtlMs,
  maxEntries = defaultMaxEntries,
  resolver = createNodeLookupResolver(),
  nowMs = Date.now
}: CachedDnsResolverOptions = {}): ConnectorDnsResolver => {
  if (!enabled) return resolver

  const cache = new Map<string, { addresses: ResolverAddress[]; expiresAtMs: number }>()
  const normalizedTtlMs = Math.max(Math.trunc(ttlMs), 1)
  const normalizedMaxEntries = Math.max(Math.trunc(maxEntries), 1)

  const prune = (currentMs: number) => {
    for (const [key, entry] of cache) {
      if (entry.expiresAtMs <= currentMs) cache.delete(key)
    }

    while (cache.size > normalizedMaxEntries) {
      const firstKey = cache.keys().next().value as string | undefined
      if (!firstKey) break
      cache.delete(firstKey)
    }
  }

  return async (hostname) => {
    const normalizedHostname = hostname.trim().toLowerCase()
    if (!normalizedHostname || isIP(normalizedHostname)) return resolver(hostname)

    const currentMs = nowMs()
    const cached = cache.get(normalizedHostname)
    if (cached && cached.expiresAtMs > currentMs) return cached.addresses

    const addresses = await resolver(hostname)
    prune(currentMs)
    cache.set(normalizedHostname, {
      addresses,
      expiresAtMs: currentMs + normalizedTtlMs
    })
    prune(currentMs)

    return addresses
  }
}
