import {
  Agent,
  request as undiciRequest,
  type Dispatcher
} from 'undici'
import {
  createDnsLookup,
  type ConnectorDnsResolver
} from './dns-resolver.ts'

type UndiciRequest = typeof undiciRequest
type UndiciRequestOptions = NonNullable<Parameters<UndiciRequest>[1]>

export type ConnectorHttpUrl = Parameters<UndiciRequest>[0]
export type ConnectorHttpHeaders = {
  get(name: string): string | null
}

export type ConnectorHttpResponseBody = Dispatcher.ResponseData<unknown>['body']

export type ConnectorHttpResponse = {
  status: number
  ok: boolean
  headers: ConnectorHttpHeaders
  body: ConnectorHttpResponseBody
}

export type ConnectorHttpRequestInit = {
  method?: UndiciRequestOptions['method']
  headers?: UndiciRequestOptions['headers']
  body?: UndiciRequestOptions['body']
  signal?: UndiciRequestOptions['signal']
}

export type ConnectorHttpFetcher = (
  input: ConnectorHttpUrl,
  init?: ConnectorHttpRequestInit
) => Promise<ConnectorHttpResponse>

export type ConnectorHttpFetcherOptions = {
  maxConnectionsPerOrigin?: number
  request?: UndiciRequest
  dispatcher?: Dispatcher
  dnsResolver?: ConnectorDnsResolver
  userAgent?: string
}

/**
 * Merchant storefronts sit behind bot protection that answers an unidentified
 * client with an HTML challenge, so a request without a User-Agent gets a 403
 * and never reaches the UCP profile at all. UCP is a protocol between named
 * agents, so the honest fix is to say who is calling rather than to imitate a
 * browser.
 */
const defaultUserAgent = 'Arro/0.1 (+https://ucp.dev; agentic commerce client)'

const withUserAgent = (
  headers: UndiciRequestOptions['headers'],
  userAgent: string
): NonNullable<UndiciRequestOptions['headers']> => {
  if (!headers) return { 'user-agent': userAgent }
  if (Array.isArray(headers)) {
    const declared = headers.some((entry, index) => index % 2 === 0 && String(entry).toLowerCase() === 'user-agent')
    return declared ? headers : [...headers, 'user-agent', userAgent]
  }
  if (typeof headers === 'object') {
    const record = headers as Record<string, unknown>
    const declared = Object.keys(record).some((name) => name.toLowerCase() === 'user-agent')
    return declared ? headers : { ...record, 'user-agent': userAgent } as NonNullable<UndiciRequestOptions['headers']>
  }
  return headers
}

export const createConnectorHttpFetcher = ({
  maxConnectionsPerOrigin = 64,
  request = undiciRequest,
  dispatcher,
  dnsResolver,
  userAgent = defaultUserAgent
}: ConnectorHttpFetcherOptions = {}): ConnectorHttpFetcher => {
  const ownedDispatcher = dispatcher ?? new Agent({
    connections: maxConnectionsPerOrigin,
    ...(dnsResolver ? { connect: { lookup: createDnsLookup(dnsResolver) } } : {})
  })

  return async (input, init) => {
    const requestOptions: UndiciRequestOptions = {
      method: init?.method ?? 'GET',
      dispatcher: ownedDispatcher,
      headers: withUserAgent(init?.headers, userAgent)
    }
    if (init?.body !== undefined) requestOptions.body = init.body
    if (init?.signal) requestOptions.signal = init.signal

    const { body, statusCode, headers } = await request(input, requestOptions)
    return {
      status: statusCode,
      ok: statusCode > 199 && statusCode < 300,
      body,
      headers: {
        get: (name) => {
          const value = headers[name]
          if (Array.isArray(value)) return value.join(', ')
          return value ?? null
        }
      }
    }
  }
}
