export const catalogDeadlineMs = 12_000

/** Bound a public catalogue fan-out so one stalled upstream cannot hold SSR. */
export const withCatalogDeadline = async <T>(
  load: (signal: AbortSignal) => Promise<T>,
  timeoutMs = catalogDeadlineMs
) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await load(controller.signal)
  } finally {
    clearTimeout(timeout)
  }
}
