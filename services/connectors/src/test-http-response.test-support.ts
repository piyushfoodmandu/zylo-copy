import { Readable } from 'node:stream'
import type { ConnectorHttpResponse } from './http-transport.ts'

const responseBody = (payload: string, onDump?: () => void) => {
  const body = Readable.from(payload.length > 0 ? [Buffer.from(payload)] : []) as ConnectorHttpResponse['body']
  body.dump = async () => {
    onDump?.()
    body.destroy()
  }
  body.text = async () => payload
  body.json = async () => JSON.parse(payload) as unknown
  body.bytes = async () => new TextEncoder().encode(payload)
  return body
}

export const connectorHttpResponse = (
  payload: string,
  status: number,
  headers: Record<string, string>,
  onDump?: () => void
): ConnectorHttpResponse => ({
  status,
  ok: status >= 200 && status < 300,
  headers: {
    get: (name) => headers[name] ?? null
  },
  body: responseBody(payload, onDump)
})

export const connectorJsonResponse = (body: unknown, status = 200) =>
  connectorHttpResponse(JSON.stringify(body), status, {
    'content-type': 'application/json'
  })

export const discardableConnectorResponse = ({
  status,
  contentType = 'application/json',
  payload = '{"error":true}'
}: {
  status: number
  contentType?: string
  payload?: string
}) => {
  let discarded = false

  return {
    response: connectorHttpResponse(payload, status, {
      'content-type': contentType
    }, () => {
      discarded = true
    }),
    discarded: () => discarded
  }
}
