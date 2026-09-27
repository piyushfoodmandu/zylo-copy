import { describe, expect, it, vi } from 'vitest'
import { createConnectorHttpFetcher } from './http-transport.ts'

const undiciBody = (payload: string) => ({
  text: vi.fn(async () => payload),
  json: vi.fn(async () => JSON.parse(payload) as unknown),
  bytes: vi.fn(async () => new TextEncoder().encode(payload)),
  dump: vi.fn(async () => undefined)
})

describe('connector HTTP transport', () => {
  it('uses undici.request behind the connector HTTP adapter', async () => {
    const request = vi.fn(async () => ({
      statusCode: 200,
      headers: {
        'content-type': 'application/json'
      },
      body: undiciBody('{"ok":true}')
    }))
    const fetcher = createConnectorHttpFetcher({
      request: request as never,
      maxConnectionsPerOrigin: 2
    })
    const response = await fetcher('https://merchant.example.com/catalog', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: '{"query":"shoe"}'
    })

    expect(request).toHaveBeenCalledWith(
      'https://merchant.example.com/catalog',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          accept: 'application/json',
          'content-type': 'application/json'
        }),
        body: '{"query":"shoe"}'
      })
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.body.json()).toEqual({ ok: true })
  })

  it('uses undici.request as the default connector transport', async () => {
    const request = vi.fn(async () => ({
      statusCode: 204,
      headers: {},
      body: null
    }))
    const fetcher = createConnectorHttpFetcher({ request: request as never })

    const response = await fetcher('https://merchant.example.com/health')

    expect(request).toHaveBeenCalledWith(
      'https://merchant.example.com/health',
      expect.objectContaining({
        method: 'GET'
      })
    )
    expect(response.status).toBe(204)
  })
})
