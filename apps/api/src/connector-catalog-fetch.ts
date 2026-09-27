import { createHash } from 'node:crypto'
import {
  catalogSearchRequestIdentity,
  CatalogProductValidationError,
  validateCatalogProductsForSource,
  type CatalogSource,
  type CatalogProductFetcher,
  type CatalogProductFetchResult,
  type CatalogProductFetchStatus
} from '@arro/connectors'
import type {
  CatalogProductSearchInput,
  CatalogSearchRequest,
  PlainStatusMessage
} from '@arro/contracts'

export type ConnectorCatalogFetchSummary = {
  requestedSourceCount: number
  dispatchedSourceCount: number
  skippedSourceCount: number
  coalescedSourceCount: number
  fetchedSourceCount: number
  timeoutSourceCount: number
  unavailableSourceCount: number
  invalidResponseSourceCount: number
  errorSourceCount: number
  resultProductCount: number
  latencyMs: number
}

export type ConnectorCatalogFetchResultDetail = {
  sourceId: string
  sourceType: CatalogSource['sourceType']
  status: CatalogProductFetchStatus
  latencyMs: number
  cacheLayer?: CatalogProductFetchResult['cacheLayer']
  pagination?: CatalogProductFetchResult['pagination']
  validationErrorCode?: string
}

export type ConnectorCatalogFetchOutcome = {
  products: CatalogProductSearchInput[]
  messages: PlainStatusMessage[]
  summary: ConnectorCatalogFetchSummary
  fetchResults: ConnectorCatalogFetchResultDetail[]
}

type FetchConnectorCatalogProductsOptions = {
  requestId: string
  correlationId: string
  searchRequest: CatalogSearchRequest
  sources: CatalogSource[]
  fetcher: CatalogProductFetcher
  timeoutMs: number
  now: Date
  signal?: AbortSignal
  maxSourcesPerRequest?: number
  maxConcurrencyPerRequest?: number
  coalescingWindowMs?: number
  sourceCursors?: ReadonlyMap<string, string>
}

const failureResult = ({
  source,
  now
}: {
  source: CatalogSource
  now: Date
}): CatalogProductFetchResult => ({
  sourceId: source.businessId,
  sourceName: source.displayName,
  status: 'error',
  products: [],
  fetchedAt: now.toISOString(),
  latencyMs: 0,
  messages: [
    {
      severity: 'warning',
      code: 'connector_catalog_fetch_failed',
      text: 'A connector-backed catalog source could not be queried.',
      nextAction: 'Inspect the source adapter and keep the result unavailable until product facts validate.'
    }
  ]
})

const emptySummary = (): ConnectorCatalogFetchSummary => ({
  requestedSourceCount: 0,
  dispatchedSourceCount: 0,
  skippedSourceCount: 0,
  coalescedSourceCount: 0,
  fetchedSourceCount: 0,
  timeoutSourceCount: 0,
  unavailableSourceCount: 0,
  invalidResponseSourceCount: 0,
  errorSourceCount: 0,
  resultProductCount: 0,
  latencyMs: 0
})

const incrementStatus = (
  summary: ConnectorCatalogFetchSummary,
  status: CatalogProductFetchStatus
) => {
  if (status === 'fetched') summary.fetchedSourceCount += 1
  else if (status === 'timeout') summary.timeoutSourceCount += 1
  else if (status === 'unavailable') summary.unavailableSourceCount += 1
  else if (status === 'invalid_response') summary.invalidResponseSourceCount += 1
  else summary.errorSourceCount += 1
}

const failedSourceCount = (summary: ConnectorCatalogFetchSummary) =>
  summary.timeoutSourceCount +
  summary.unavailableSourceCount +
  summary.invalidResponseSourceCount +
  summary.errorSourceCount

const partialResultsMessage = (): PlainStatusMessage => ({
  severity: 'warning',
  code: 'connector_catalog_partial_results',
  text: 'Some connector-backed catalog sources were unavailable for this search.',
  nextAction: 'Use only the returned source-labeled products and inspect connector health before expanding traffic.'
})

const allSourcesUnavailableMessage = (): PlainStatusMessage => ({
  severity: 'warning',
  code: 'connector_catalog_sources_unavailable',
  text: 'Connector-backed catalog sources were eligible, but none returned valid product facts for this search.',
  nextAction: 'Keep results unavailable until at least one connector-backed source returns contract-valid product facts.'
})

const sourceBudgetLimitedMessage = ({
  requestedSourceCount,
  dispatchedSourceCount
}: {
  requestedSourceCount: number
  dispatchedSourceCount: number
}): PlainStatusMessage => ({
  severity: 'warning',
  code: 'connector_catalog_source_budget_limited',
  text: `Only ${dispatchedSourceCount} of ${requestedSourceCount} eligible connector-backed catalog sources were queried because this request reached the configured fan-out budget.`,
  nextAction: 'Use the returned source-labeled products, refine the request, or raise the connector source budget only after load testing.'
})

const positiveIntegerOrDefault = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback

const nonNegativeIntegerOrDefault = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback

const mapWithConcurrency = async <Input, Output>(
  inputs: Input[],
  concurrency: number,
  mapper: (input: Input) => Promise<Output>
): Promise<Output[]> => {
  const results = new Array<Output>(inputs.length)
  let nextIndex = 0

  const workerCount = Math.min(Math.max(concurrency, 1), inputs.length)
  const workers: Array<Promise<void>> = []

  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    workers.push((async () => {
      while (nextIndex < inputs.length) {
        const currentIndex = nextIndex
        nextIndex += 1
        results[currentIndex] = await mapper(inputs[currentIndex]!)
      }
    })())
  }

  await Promise.all(workers)

  return results
}

type SourceFetchResult = {
  result: CatalogProductFetchResult
  coalesced: boolean
}

type CoalescedSourceFetchEntry = {
  expiresAtMs: number
  promise: Promise<CatalogProductFetchResult>
  controller: AbortController
  activeWaiters: number
  settled: boolean
}

const maxCoalescedSourceFetchEntries = 1024
const coalescedSourceFetches = new Map<string, CoalescedSourceFetchEntry>()

const coalescedSourceFetchKey = ({
  source,
  searchRequest
}: {
  source: CatalogSource
  searchRequest: CatalogSearchRequest
}) => createHash('sha256')
  .update(catalogSearchRequestIdentity({ source, searchRequest }))
  .digest('hex')

const sourceFetchWithCoalescing = async ({
  key,
  windowMs,
  signal,
  fetch
}: {
  key: string
  windowMs: number
  signal?: AbortSignal
  fetch: (signal?: AbortSignal) => Promise<CatalogProductFetchResult>
}): Promise<SourceFetchResult> => {
  if (windowMs <= 0) return { result: await fetch(signal), coalesced: false }

  const nowMs = Date.now()
  const existing = coalescedSourceFetches.get(key)
  if (existing && existing.expiresAtMs > nowMs) {
    return {
      result: await waitForCoalescedSourceFetch(existing, signal),
      coalesced: true
    }
  }
  if (existing) coalescedSourceFetches.delete(key)

  pruneExpiredCoalescedSourceFetches(nowMs)
  if (coalescedSourceFetches.size >= maxCoalescedSourceFetchEntries) {
    return { result: await fetch(signal), coalesced: false }
  }

  const controller = new AbortController()
  const entry: CoalescedSourceFetchEntry = {
    expiresAtMs: Number.POSITIVE_INFINITY,
    promise: fetch(controller.signal),
    controller,
    activeWaiters: 0,
    settled: false
  }
  coalescedSourceFetches.set(key, entry)
  entry.promise.finally(() => {
    entry.settled = true
    entry.expiresAtMs = Date.now() + windowMs
    const cleanup = setTimeout(() => {
      if (coalescedSourceFetches.get(key) === entry) coalescedSourceFetches.delete(key)
    }, windowMs)
    cleanup.unref()
  }).catch(() => undefined)

  return {
    result: await waitForCoalescedSourceFetch(entry, signal),
    coalesced: false
  }
}

const coalescedFetchCancelledError = () =>
  new Error('Connector catalog coalesced fetch no longer has active waiters.')

const pruneExpiredCoalescedSourceFetches = (nowMs: number) => {
  for (const [entryKey, entry] of coalescedSourceFetches) {
    if (entry.expiresAtMs <= nowMs) coalescedSourceFetches.delete(entryKey)
  }
}

const waitForCoalescedSourceFetch = async (
  entry: CoalescedSourceFetchEntry,
  signal?: AbortSignal
) => {
  entry.activeWaiters += 1
  let released = false
  let abortListener: (() => void) | undefined
  let rejectAbort: ((error: unknown) => void) | undefined

  const release = () => {
    if (released) return

    released = true
    entry.activeWaiters = Math.max(entry.activeWaiters - 1, 0)
    if (entry.activeWaiters === 0 && !entry.settled && !entry.controller.signal.aborted) {
      entry.controller.abort(coalescedFetchCancelledError())
    }
  }

  try {
    if (!signal) return await entry.promise

    const callerAbort = new Promise<never>((_, reject) => {
      rejectAbort = reject
    })
    abortListener = () => {
      rejectAbort?.(signal.reason ?? coalescedFetchCancelledError())
    }

    if (signal.aborted) abortListener()
    else signal.addEventListener('abort', abortListener, { once: true })

    return await Promise.race([entry.promise, callerAbort])
  } finally {
    if (abortListener) signal?.removeEventListener('abort', abortListener)
    release()
  }
}

export const fetchConnectorCatalogProducts = async ({
  requestId,
  correlationId,
  searchRequest,
  sources,
  fetcher,
  timeoutMs,
  now,
  signal,
  maxSourcesPerRequest,
  maxConcurrencyPerRequest,
  coalescingWindowMs,
  sourceCursors
}: FetchConnectorCatalogProductsOptions): Promise<ConnectorCatalogFetchOutcome> => {
  const startedAt = Date.now()
  const summary = emptySummary()
  summary.requestedSourceCount = sources.length
  const sourceLimit = positiveIntegerOrDefault(maxSourcesPerRequest, sources.length || 1)
  const dispatchSources = sources.slice(0, sourceLimit)
  summary.dispatchedSourceCount = dispatchSources.length
  summary.skippedSourceCount = Math.max(sources.length - dispatchSources.length, 0)
  const concurrencyLimit = Math.min(
    positiveIntegerOrDefault(maxConcurrencyPerRequest, dispatchSources.length || 1),
    dispatchSources.length || 1
  )
  const sourceCoalescingWindowMs = nonNegativeIntegerOrDefault(coalescingWindowMs, 0)

  const sourceFetches = await mapWithConcurrency(
    dispatchSources,
    concurrencyLimit,
    async (source) => {
      let fetchResult: SourceFetchResult
      const sourceCursor = sourceCursors?.get(source.businessId)
      const sourceSearchRequest: CatalogSearchRequest = sourceCursor
        ? {
            ...searchRequest,
            pagination: {
              ...(searchRequest.pagination ?? {}),
              cursor: sourceCursor
            }
          }
        : searchRequest

      try {
        fetchResult = await sourceFetchWithCoalescing({
          key: coalescedSourceFetchKey({ source, searchRequest: sourceSearchRequest }),
          windowMs: sourceCoalescingWindowMs,
          ...(signal ? { signal } : {}),
          fetch: async (fetchSignal) => {
            try {
              return await fetcher({
                requestId,
                correlationId,
                source,
                searchRequest: sourceSearchRequest,
                timeoutMs,
                now,
                ...(fetchSignal ? { signal: fetchSignal } : {})
              })
            } catch {
              return failureResult({ source, now })
            }
          }
        })
      } catch {
        fetchResult = {
          result: failureResult({ source, now }),
          coalesced: false
        }
      }

      return {
        source,
        ...fetchResult
      }
    }
  )

  const products: CatalogProductSearchInput[] = []
  const messages: PlainStatusMessage[] = []
  const fetchResults: ConnectorCatalogFetchResultDetail[] = []

  if (summary.skippedSourceCount > 0) {
    messages.push(sourceBudgetLimitedMessage({
      requestedSourceCount: summary.requestedSourceCount,
      dispatchedSourceCount: summary.dispatchedSourceCount
    }))
  }

  for (const { source, result, coalesced } of sourceFetches) {
    if (coalesced) summary.coalescedSourceCount += 1
    messages.push(...result.messages)

    if (result.status !== 'fetched') {
      incrementStatus(summary, result.status)
      fetchResults.push({
        sourceId: source.businessId,
        sourceType: source.sourceType,
        status: result.status,
        latencyMs: result.latencyMs
      })
      continue
    }

    try {
      const validatedProducts = validateCatalogProductsForSource({
        source,
        products: result.products
      })
      products.push(...validatedProducts)
      incrementStatus(summary, 'fetched')
      fetchResults.push({
        sourceId: source.businessId,
        sourceType: source.sourceType,
        status: 'fetched',
        latencyMs: result.latencyMs,
        ...(result.cacheLayer
          ? { cacheLayer: result.cacheLayer }
          : coalesced
            ? { cacheLayer: 'coalesced' as const }
            : {}),
        ...(result.pagination ? { pagination: result.pagination } : {})
      })
    } catch (error) {
      const validationErrorCode = error instanceof CatalogProductValidationError
        ? error.code
        : 'connector_catalog_invalid_response'
      summary.invalidResponseSourceCount += 1
      fetchResults.push({
        sourceId: source.businessId,
        sourceType: source.sourceType,
        status: 'invalid_response',
        latencyMs: result.latencyMs,
        validationErrorCode
      })
      messages.push({
        severity: 'warning',
        code: validationErrorCode,
        text: 'A connector-backed catalog source returned product facts that failed the search input contract.',
        nextAction: 'Reject the source response and inspect adapter validation before enabling these products.'
      })
    }
  }

  summary.resultProductCount = products.length
  summary.latencyMs = Math.max(Date.now() - startedAt, 0)

  if (summary.fetchedSourceCount > 0 && failedSourceCount(summary) > 0) {
    messages.push(partialResultsMessage())
  }

  if (summary.requestedSourceCount > 0 && summary.fetchedSourceCount === 0 && failedSourceCount(summary) > 0) {
    messages.push(allSourcesUnavailableMessage())
  }

  return {
    products,
    messages,
    summary,
    fetchResults
  }
}
