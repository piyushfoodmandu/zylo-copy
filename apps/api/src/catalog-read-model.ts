import { createHash } from 'node:crypto'
import type {
  CatalogProductFetcher,
  CatalogProductFetchRequest,
  CatalogProductFetchResult
} from '@arro/connectors'
import { catalogSearchRequestIdentity } from '@arro/connectors'

export type CatalogReadModelClient = {
  get(key: string): Promise<string | null>
  set(key: string, value: string, options: { PX: number; NX?: boolean }): Promise<unknown>
}

export type CatalogReadModelOptions = {
  getClient: () => Promise<CatalogReadModelClient>
  freshForMs: number
  operationTimeoutMs?: number
  nowMs?: () => number
}

type StoredCatalogResult = {
  version: 1
  storedAtMs: number
  result: CatalogProductFetchResult
}

const keyPrefix = 'arro:catalog-read-model:v1:'
// Redis accelerates browsing; it must never consume a meaningful part of the
// upstream catalog deadline when it is degraded or reconnecting.
const defaultOperationTimeoutMs = 100
const refreshLeaseMs = 30_000

const readModelKey = (request: CatalogProductFetchRequest) => `${keyPrefix}${createHash('sha256')
  .update(catalogSearchRequestIdentity(request))
  .digest('hex')}`

const storedResult = (value: string | null): StoredCatalogResult | undefined => {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value) as Partial<StoredCatalogResult>
    if (
      parsed.version !== 1 ||
      typeof parsed.storedAtMs !== 'number' ||
      !Number.isSafeInteger(parsed.storedAtMs) ||
      !parsed.result ||
      parsed.result.status !== 'fetched' ||
      !Array.isArray(parsed.result.products) ||
      !Array.isArray(parsed.result.messages)
    ) return undefined
    return parsed as StoredCatalogResult
  } catch {
    return undefined
  }
}

const resultExpiryMs = (result: CatalogProductFetchResult) => {
  const expiries = result.products
    .map((product) => product.sourceLabel.expiresAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter(Number.isFinite)
  return expiries.length > 0 ? Math.min(...expiries) : undefined
}

const within = async <T>(operation: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('catalog_read_model_timeout')), timeoutMs)
        timer.unref()
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Redis is Arro's small current catalog projection. A successful source answer
 * survives API restarts and is served until its own source-declared expiry.
 * Once the short freshness window passes, the current answer is returned
 * immediately and one process-local refresh runs in the background. Checkout
 * still revalidates the selected item with the merchant before money moves.
 */
export const createCatalogReadModelFetcher = (
  fetcher: CatalogProductFetcher,
  {
    getClient,
    freshForMs,
    operationTimeoutMs = defaultOperationTimeoutMs,
    nowMs = () => Date.now()
  }: CatalogReadModelOptions
): CatalogProductFetcher => {
  if (freshForMs <= 0) return fetcher

  const refreshing = new Map<string, Promise<unknown>>()

  const write = async (
    client: CatalogReadModelClient,
    key: string,
    result: CatalogProductFetchResult
  ) => {
    if (result.status !== 'fetched') return
    const storedAtMs = nowMs()
    const expiresAtMs = resultExpiryMs(result) ?? storedAtMs + freshForMs
    const retentionMs = Math.max(Math.floor(expiresAtMs - storedAtMs), 0)
    if (retentionMs <= 0) return
    const value = JSON.stringify({ version: 1, storedAtMs, result } satisfies StoredCatalogResult)
    await within(client.set(key, value, { PX: retentionMs }), operationTimeoutMs)
  }

  const refresh = (
    client: CatalogReadModelClient,
    key: string,
    request: CatalogProductFetchRequest
  ) => {
    if (refreshing.has(key)) return
    const { signal: _signal, now: _now, ...backgroundRequest } = request
    const pending = within(
      client.set(`${key}:refresh`, String(nowMs()), { NX: true, PX: refreshLeaseMs }),
      operationTimeoutMs
    )
      .then((lease) => lease === 'OK'
        ? fetcher({ ...backgroundRequest, now: new Date() })
          .then((result) => write(client, key, result))
        : undefined)
      .catch(() => undefined)
      .finally(() => {
        if (refreshing.get(key) === pending) refreshing.delete(key)
      })
    refreshing.set(key, pending)
  }

  return async (request) => {
    const key = readModelKey(request)
    let client: CatalogReadModelClient | undefined
    try {
      client = await within(getClient(), operationTimeoutMs)
      const cached = storedResult(await within(client.get(key), operationTimeoutMs))
      if (cached) {
        const expiresAtMs = resultExpiryMs(cached.result)
        if (!expiresAtMs || expiresAtMs > nowMs()) {
          if (nowMs() - cached.storedAtMs >= freshForMs) refresh(client, key, request)
          return { ...cached.result, latencyMs: 0, cacheLayer: 'projection' }
        }
      }
    } catch {
      // Catalog reads fail over to the source; Redis is an accelerator, not a
      // second availability dependency for browsing.
    }

    const result = await fetcher(request)
    // Persisting the projection is best effort and never extends a shopper's
    // source request. A later request can retry if this write does not land.
    if (client) void write(client, key, result).catch(() => undefined)
    return result
  }
}
