import { describe, expect, it } from 'vitest'
import {
  createRequestTimeoutGuard,
  isRequestTimeoutError,
  RequestTimeoutError
} from './request-timeout.ts'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('request timeout guard', () => {
  it('resolves operations that complete inside the timeout budget', async () => {
    const guard = createRequestTimeoutGuard({ timeoutMs: 100 })

    await expect(guard.run(async () => 'ok')).resolves.toBe('ok')
    expect(guard.signal.aborted).toBe(false)

    guard.cleanup()
  })

  it('rejects with a typed timeout error and aborts the child signal', async () => {
    const guard = createRequestTimeoutGuard({ timeoutMs: 1 })

    await expect(guard.run(async () => new Promise(() => undefined))).rejects.toBeInstanceOf(
      RequestTimeoutError
    )
    expect(guard.signal.aborted).toBe(true)
    expect(isRequestTimeoutError(guard.signal.reason)).toBe(true)

    guard.cleanup()
  })

  it('propagates parent aborts to the child signal without treating them as route timeouts', () => {
    const parent = new AbortController()
    const reason = new Error('client aborted')
    const guard = createRequestTimeoutGuard({
      timeoutMs: 100,
      parentSignal: parent.signal
    })

    parent.abort(reason)

    expect(guard.signal.aborted).toBe(true)
    expect(guard.signal.reason).toBe(reason)
    expect(() => guard.throwIfTimedOut()).not.toThrow()

    guard.cleanup()
  })

  it('cleans up idempotently without firing a late timeout', async () => {
    const guard = createRequestTimeoutGuard({ timeoutMs: 1 })

    guard.cleanup()
    guard.cleanup()
    await delay(5)

    expect(guard.signal.aborted).toBe(false)
  })
})