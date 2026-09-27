import { describe, expect, it, vi } from 'vitest'
import {
  createCachedDnsResolver,
  createDnsLookup
} from './dns-resolver.ts'

describe('connector DNS resolver cache', () => {
  it('reuses hostname resolutions inside the configured TTL', async () => {
    let nowMs = 1_000
    const resolver = vi.fn(async () => [{ address: '203.0.113.10' }])
    const cachedResolver = createCachedDnsResolver({
      ttlMs: 30_000,
      maxEntries: 10,
      resolver,
      nowMs: () => nowMs
    })

    await expect(cachedResolver('Merchant.Example.com')).resolves.toEqual([
      { address: '203.0.113.10' }
    ])
    await expect(cachedResolver('merchant.example.com')).resolves.toEqual([
      { address: '203.0.113.10' }
    ])
    nowMs += 30_001
    await expect(cachedResolver('merchant.example.com')).resolves.toEqual([
      { address: '203.0.113.10' }
    ])

    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it('does not cache IP literals', async () => {
    const resolver = vi.fn(async (hostname: string) => [{ address: hostname }])
    const cachedResolver = createCachedDnsResolver({ resolver })

    await cachedResolver('203.0.113.10')
    await cachedResolver('203.0.113.10')

    expect(resolver).toHaveBeenCalledTimes(2)
  })

  it('adapts the cached resolver for Undici connector lookup', async () => {
    const resolver = vi.fn(async () => [
      { address: '203.0.113.10', family: 4 as const },
      { address: '2001:db8::10', family: 6 as const }
    ])
    const lookup = createDnsLookup(resolver)

    await new Promise<void>((resolve, reject) => {
      lookup('merchant.example.com', { all: true }, (error, addresses) => {
        if (error) {
          reject(error)
          return
        }

        expect(addresses).toEqual([
          { address: '203.0.113.10', family: 4 },
          { address: '2001:db8::10', family: 6 }
        ])
        resolve()
      })
    })

    await new Promise<void>((resolve, reject) => {
      lookup('merchant.example.com', { all: false, family: 6 }, (error, address, family) => {
        if (error) {
          reject(error)
          return
        }

        expect(address).toBe('2001:db8::10')
        expect(family).toBe(6)
        resolve()
      })
    })

    expect(resolver).toHaveBeenCalledWith('merchant.example.com')
  })
})
