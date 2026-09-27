import type { ComponentHealthCheck } from '@arro/contracts'
import { describe, expect, it } from 'vitest'
import { createSingleFlightReadinessLoader } from './readiness.ts'

const healthyChecks: ComponentHealthCheck[] = [{
  name: 'dependency',
  status: 'ok',
  required: true,
  message: 'ready'
}]

describe('readiness dependency loading', () => {
  it('coalesces concurrent unauthenticated probes into one dependency evaluation', async () => {
    let calls = 0
    let resolveLoad!: (checks: ComponentHealthCheck[]) => void
    const load = createSingleFlightReadinessLoader(() => {
      calls += 1
      return new Promise<ComponentHealthCheck[]>((resolve) => {
        resolveLoad = resolve
      })
    })

    const first = load()
    const second = load()
    expect(calls).toBe(1)

    resolveLoad(healthyChecks)
    await expect(first).resolves.toBe(healthyChecks)
    await expect(second).resolves.toBe(healthyChecks)
    expect(calls).toBe(1)
  })

  it('reuses a short snapshot and refreshes it after expiry', async () => {
    let calls = 0
    let now = 1_000
    const load = createSingleFlightReadinessLoader(async () => {
      calls += 1
      return healthyChecks
    }, {
      ttlMs: 1_000,
      now: () => now
    })

    await expect(load()).resolves.toBe(healthyChecks)
    now = 1_999
    await expect(load()).resolves.toBe(healthyChecks)
    expect(calls).toBe(1)

    now = 2_000
    await expect(load()).resolves.toBe(healthyChecks)
    expect(calls).toBe(2)
  })
})
