import { describe, expect, it } from 'vitest'
import { RequestLifecycle } from './request-lifecycle.ts'

describe('request lifecycle', () => {
  it('tracks active requests and makes finish idempotent', () => {
    const lifecycle = new RequestLifecycle()
    const beginResult = lifecycle.beginRequest()

    expect(beginResult.accepted).toBe(true)
    expect(lifecycle.activeRequestCount).toBe(1)

    if (beginResult.accepted) {
      beginResult.ticket.finish()
      beginResult.ticket.finish()
    }

    expect(lifecycle.activeRequestCount).toBe(0)
  })

  it('rejects new work during drain while allowing explicit bypass requests', () => {
    const lifecycle = new RequestLifecycle()

    lifecycle.startDraining()

    expect(lifecycle.acceptsNewRequests).toBe(false)
    expect(lifecycle.isDraining).toBe(true)
    expect(lifecycle.beginRequest().accepted).toBe(false)

    const bypass = lifecycle.beginRequest({ allowDuringDrain: true })

    expect(bypass.accepted).toBe(true)
    if (bypass.accepted) bypass.ticket.finish()
    expect(lifecycle.activeRequestCount).toBe(0)
  })

  it('waits for active requests to finish during drain', async () => {
    const lifecycle = new RequestLifecycle()
    const beginResult = lifecycle.beginRequest()

    expect(beginResult.accepted).toBe(true)
    lifecycle.startDraining()

    const drainPromise = lifecycle.waitForDrain(1000)
    if (beginResult.accepted) beginResult.ticket.finish()

    await expect(drainPromise).resolves.toMatchObject({
      outcome: 'completed',
      startedActiveRequestCount: 1,
      activeRequestCount: 0,
      abandonedRequestCount: 0
    })
  })

  it('reports timed-out drain attempts without forcing request completion', async () => {
    const lifecycle = new RequestLifecycle()
    const beginResult = lifecycle.beginRequest()

    expect(beginResult.accepted).toBe(true)
    lifecycle.startDraining()

    await expect(lifecycle.waitForDrain(0)).resolves.toMatchObject({
      outcome: 'timed_out',
      startedActiveRequestCount: 1,
      activeRequestCount: 1,
      abandonedRequestCount: 1
    })

    if (beginResult.accepted) beginResult.ticket.finish()
    expect(lifecycle.activeRequestCount).toBe(0)
  })
})