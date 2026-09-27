import { UCP_STABLE_VERSION } from './ucp-version.ts'
import type { PurchaseAction } from './purchase.ts'

export type EmbeddedCheckoutPresentation = Extract<NonNullable<PurchaseAction['presentation']>, { type: 'ucp_embedded' }>

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** A business profile alone does not enable embedding for an individual checkout. */
export const embeddedCheckoutPresentation = (value: unknown): EmbeddedCheckoutPresentation | undefined => {
  const checkout = record(value)
  const ucp = record(checkout.ucp)
  const services = record(ucp.services)['dev.ucp.shopping']
  if (ucp.version !== UCP_STABLE_VERSION || typeof checkout.id !== 'string' || !checkout.id) return
  if (typeof checkout.continue_url !== 'string') return
  try {
    if (new URL(checkout.continue_url).protocol !== 'https:') return
  } catch { return }
  if (!Array.isArray(services) || !services.some((value) => {
    const service = record(value)
    const delegates = record(service.config).delegate
    return service.transport === 'embedded' && service.version === ucp.version &&
      Array.isArray(delegates) && delegates.every((entry) => typeof entry === 'string')
  })) return
  return { type: 'ucp_embedded', version: UCP_STABLE_VERSION, checkoutId: checkout.id }
}

export const embeddedCheckoutUrl = (url: string, presentation: EmbeddedCheckoutPresentation): string => {
  const target = new URL(url)
  if (target.protocol !== 'https:') throw new Error('Embedded checkout requires an HTTPS merchant URL.')
  target.searchParams.set('ec_version', presentation.version)
  // Arro's direct payment flow owns native wallet execution. This embedded
  // surface delegates no payment/address work: the merchant renders those UI.
  target.searchParams.set('ec_delegate', '')
  return target.toString()
}

export type EmbeddedCheckoutRequest = {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: unknown
}

export type EmbeddedCheckoutResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string }
}

export type EmbeddedCheckoutEvent = {
  request: EmbeddedCheckoutRequest
  response?: EmbeddedCheckoutResponse
  event?: 'ready' | 'start' | 'change' | 'complete' | 'error'
  message?: string
  recoveryUrl?: string
}

export const parseEmbeddedCheckoutMessage = (input: unknown): EmbeddedCheckoutRequest => {
  const message = record(typeof input === 'string' ? JSON.parse(input) : input)
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || !message.method ||
    ('id' in message && message.id !== null && typeof message.id !== 'string' &&
      (typeof message.id !== 'number' || !Number.isFinite(message.id)))) {
    throw new Error('Invalid embedded checkout message.')
  }
  return message as EmbeddedCheckoutRequest
}

/** Shared by the web iframe, native WebView, and server-side host relay. */
export const processEmbeddedCheckoutMessage = (
  presentation: EmbeddedCheckoutPresentation,
  input: unknown
): EmbeddedCheckoutEvent => {
  const request = parseEmbeddedCheckoutMessage(input)
  const params = record(request.params)
  const result: EmbeddedCheckoutEvent = { request }
  const fail = (message: string): EmbeddedCheckoutEvent => ({
    request,
    event: 'error',
    message,
    ...(request.id === undefined ? {} : {
      response: {
        jsonrpc: '2.0', id: request.id,
        result: {
          ucp: { version: presentation.version, status: 'error' },
          messages: [{ type: 'error', code: 'not_supported_error', content: message, severity: 'unrecoverable' }]
        }
      }
    })
  })

  if (request.method === 'ec.ready') {
    if (request.id === undefined) return fail('The shop did not request a checkout handshake.')
    if (!Array.isArray(params.delegate) || params.delegate.length !== 0) {
      return fail('The shop requested checkout controls that were not agreed for this session.')
    }
    if (params.auth !== undefined) return fail('This shop requires an additional checkout sign-in. Continue on its site.')
    return {
      request, event: 'ready',
      response: { jsonrpc: '2.0', id: request.id, result: { ucp: { version: presentation.version, status: 'success' } } }
    }
  }

  if (request.method === 'ec.auth') return fail('This shop requires an additional checkout sign-in. Continue on its site.')

  if (request.id !== undefined) {
    return { request, response: { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found.' } } }
  }

  if (request.method === 'ec.error') {
    const error = record(params.error)
    const messages = Array.isArray(error.messages) ? error.messages.map(record) : []
    const content = messages.find((entry) => typeof entry.content === 'string')?.content
    let recoveryUrl: string | undefined
    try {
      if (typeof error.continue_url === 'string' && new URL(error.continue_url).protocol === 'https:') {
        recoveryUrl = error.continue_url
      }
    } catch { /* Keep the original merchant continuation when no valid recovery link is supplied. */ }
    return { request, event: 'error', message: typeof content === 'string' ? content : 'The shop could not continue this checkout here.', ...(recoveryUrl ? { recoveryUrl } : {}) }
  }

  const event = request.method === 'ec.start' ? 'start'
    : request.method === 'ec.complete' ? 'complete'
      : /^ec\.[a-z_]+\.change$/.test(request.method) ? 'change' : undefined
  if (!event) return result
  if (record(params.checkout).id !== presentation.checkoutId) return fail('The shop returned a different checkout session.')
  // Client events trigger reconciliation, never payment completion or an Order write.
  return { request, event }
}
