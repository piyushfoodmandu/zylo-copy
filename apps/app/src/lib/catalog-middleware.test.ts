import { describe, expect, it } from 'vitest'
import catalogMiddleware from '../app/+middleware'

const run = async (url: string) => {
  const request = new Request(url) as unknown as Parameters<typeof catalogMiddleware>[0]
  const response = await catalogMiddleware(request)
  if (!(response instanceof Response)) throw new Error('Expected middleware to stop the invalid route.')
  return response
}

describe('catalog middleware', () => {
  it('returns a real 404 document for an invalid catalogue URL', async () => {
    const response = await run('https://arro.example/c/not-a-real-category')

    expect(response.status).toBe(404)
    await expect(response.text()).resolves.toContain('We could not find this page')
  })

  it('protects client loader endpoints with the same route semantics', async () => {
    const response = await run('https://arro.example/_expo/loaders/c/not-a-real-category')

    expect(response.status).toBe(404)
    expect(response.headers.get('x-robots-tag')).toBe('noindex, follow')
  })
})
