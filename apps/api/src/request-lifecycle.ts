export type RequestLifecycleDrainOutcome = 'completed' | 'timed_out'

export type RequestLifecycleDrainResult = {
  outcome: RequestLifecycleDrainOutcome
  startedActiveRequestCount: number
  activeRequestCount: number
  abandonedRequestCount: number
  durationMs: number
}

export type RequestLifecycleTicket = {
  finish: () => void
}

export type BeginRequestResult =
  | { accepted: true; ticket: RequestLifecycleTicket }
  | { accepted: false }

type Waiter = () => void

export class RequestLifecycle {
  private acceptingRequests = true
  private activeRequests = 0
  private readonly waiters = new Set<Waiter>()

  get acceptsNewRequests() {
    return this.acceptingRequests
  }

  get isDraining() {
    return !this.acceptingRequests
  }

  get activeRequestCount() {
    return this.activeRequests
  }

  beginRequest({ allowDuringDrain = false } = {}): BeginRequestResult {
    if (!this.acceptingRequests && !allowDuringDrain) return { accepted: false }

    this.activeRequests += 1
    let finished = false

    return {
      accepted: true,
      ticket: {
        finish: () => {
          if (finished) return
          finished = true
          this.activeRequests = Math.max(this.activeRequests - 1, 0)
          if (this.activeRequests === 0) this.notifyWaiters()
        }
      }
    }
  }

  startDraining() {
    this.acceptingRequests = false
    if (this.activeRequests === 0) this.notifyWaiters()
  }

  waitForDrain(timeoutMs: number): Promise<RequestLifecycleDrainResult> {
    const startedAt = Date.now()
    const startedActiveRequestCount = this.activeRequests

    if (this.activeRequests === 0) {
      return Promise.resolve(this.drainResult({
        outcome: 'completed',
        startedAt,
        startedActiveRequestCount
      }))
    }

    if (timeoutMs <= 0) {
      return Promise.resolve(this.drainResult({
        outcome: 'timed_out',
        startedAt,
        startedActiveRequestCount
      }))
    }

    return new Promise((resolve) => {
      let timeout: NodeJS.Timeout | undefined
      let settled = false

      const settle = (outcome: RequestLifecycleDrainOutcome) => {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        this.waiters.delete(waiter)
        resolve(this.drainResult({ outcome, startedAt, startedActiveRequestCount }))
      }

      const waiter = () => {
        if (this.activeRequests === 0) settle('completed')
      }

      this.waiters.add(waiter)
      timeout = setTimeout(() => settle('timed_out'), timeoutMs)
      timeout.unref()
      waiter()
    })
  }

  private notifyWaiters() {
    for (const waiter of this.waiters) waiter()
  }

  private drainResult({
    outcome,
    startedAt,
    startedActiveRequestCount
  }: {
    outcome: RequestLifecycleDrainOutcome
    startedAt: number
    startedActiveRequestCount: number
  }): RequestLifecycleDrainResult {
    const activeRequestCount = this.activeRequests

    return {
      outcome,
      startedActiveRequestCount,
      activeRequestCount,
      abandonedRequestCount: outcome === 'timed_out' ? activeRequestCount : 0,
      durationMs: Math.max(Date.now() - startedAt, 0)
    }
  }
}

export const runtimeRequestLifecycle = new RequestLifecycle()
