import type { ConnectorHttpResponse } from './http-transport.ts'

type ReadLimitedBodyOptions = {
  tooLargeMessage: string
}

type ReadJsonPayloadOptions = ReadLimitedBodyOptions & {
  invalidContentTypeMessage: string
}

export const discardResponseBody = ({ body }: ConnectorHttpResponse) => {
  void body.dump().catch(() => undefined)
}

export const readLimitedBody = async (
  response: ConnectorHttpResponse,
  maxBytes: number,
  { tooLargeMessage }: ReadLimitedBodyOptions
) => {
  const declaredBytes = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    response.body.destroy()
    throw new Error(tooLargeMessage)
  }

  const chunks: Buffer[] = []
  let responseBytes = 0

  for await (const chunk of response.body) {
    const buffer = typeof chunk === 'string'
      ? Buffer.from(chunk)
      : Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)

    responseBytes += buffer.byteLength
    if (responseBytes > maxBytes) {
      response.body.destroy()
      throw new Error(tooLargeMessage)
    }

    chunks.push(buffer)
  }

  if (chunks.length === 0) return ''
  if (chunks.length === 1) return chunks[0]!.toString('utf8')

  return Buffer.concat(chunks, responseBytes).toString('utf8')
}

export const readJsonPayload = async (
  response: ConnectorHttpResponse,
  maxBytes: number,
  options: ReadJsonPayloadOptions
) => {
  const contentType = response.headers.get('content-type')?.toLowerCase()
  if (!contentType?.includes('json')) {
    discardResponseBody(response)
    throw new Error(options.invalidContentTypeMessage)
  }

  const body = await readLimitedBody(response, maxBytes, options)
  return JSON.parse(body) as unknown
}
