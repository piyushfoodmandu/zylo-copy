export class RequestTimeoutError extends Error {
  readonly code = 'request_timeout'
  readonly statusCode = 504

  constructor(timeoutMs: number) {
    super(`Request exceeded the ${timeoutMs}ms timeout budget.`)
    this.name = 'RequestTimeoutError'
  }
}

export type RequestTimeoutGuard = {
  signal: AbortSignal
  run: <T>(operation: () => Promise<T>) => Promise<T>
  throwIfTimedOut: () => void
  cleanup: () => void
}

export const isRequestTimeoutError = (error: unknown): error is RequestTimeoutError =>
  error instanceof RequestTimeoutError

export const createRequestTimeoutGuard = ({
  timeoutMs,
  parentSignal
}: {
  timeoutMs: number
  parentSignal?: AbortSignal
}): RequestTimeoutGuard => {
  const normalizedTimeoutMs = Math.max(timeoutMs, 1)
  const controller = new AbortController()
  let timeout: NodeJS.Timeout | undefined
  let parentAbortListener: (() => void) | undefined
  let timeoutError: RequestTimeoutError | undefined
  let timeoutResolved = false
  let resolveTimeout!: (error: RequestTimeoutError) => void

  const timeoutPromise = new Promise<RequestTimeoutError>((resolve) => {
    resolveTimeout = resolve
  })

  const timeoutExpired = () => {
    if (timeoutResolved) return

    timeoutResolved = true
    timeoutError = new RequestTimeoutError(normalizedTimeoutMs)
    controller.abort(timeoutError)
    resolveTimeout(timeoutError)
  }

  timeout = setTimeout(timeoutExpired, normalizedTimeoutMs)
  timeout.unref()

  if (parentSignal) {
    parentAbortListener = () => {
      controller.abort(parentSignal.reason)
    }

    if (parentSignal.aborted) parentAbortListener()
    else parentSignal.addEventListener('abort', parentAbortListener, { once: true })
  }

  const cleanup = () => {
    if (timeout) {
      clearTimeout(timeout)
      timeout = undefined
    }

    if (parentAbortListener) {
      parentSignal?.removeEventListener('abort', parentAbortListener)
      parentAbortListener = undefined
    }
  }

  return {
    signal: controller.signal,
    run: async <T>(operation: () => Promise<T>) => {
      const operationPromise = operation()
      operationPromise.catch(() => undefined)

      return Promise.race([
        operationPromise,
        timeoutPromise.then((error) => {
          throw error
        })
      ])
    },
    throwIfTimedOut: () => {
      if (timeoutError) throw timeoutError
    },
    cleanup
  }
}
