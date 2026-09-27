import { describe, expect, it } from 'vitest'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { UCP_STABLE_VERSION } from './ucp.ts'
import { PurchaseActionSchema } from './purchase.ts'
import { embeddedCheckoutPresentation, embeddedCheckoutUrl, processEmbeddedCheckoutMessage } from './embedded-checkout.ts'

const checkout = {
  id: 'checkout_1',
  continue_url: 'https://merchant.example/checkout?key=merchant-session',
  ucp: {
    version: UCP_STABLE_VERSION,
    services: { 'dev.ucp.shopping': [{ version: UCP_STABLE_VERSION, transport: 'embedded', config: { delegate: ['payment.credential'] } }] }
  }
}
const presentation = embeddedCheckoutPresentation(checkout)!

describe('shared embedded checkout contract', () => {
  it('requires an explicit per-checkout binding, not just a checkout URL', () => {
    expect(presentation).toEqual({ type: 'ucp_embedded', version: UCP_STABLE_VERSION, checkoutId: checkout.id })
    expect(embeddedCheckoutPresentation({ ...checkout, ucp: { version: UCP_STABLE_VERSION, services: {} } })).toBeUndefined()
    expect(embeddedCheckoutPresentation({ ...checkout, ucp: { version: UCP_STABLE_VERSION, services: { 'dev.ucp.shopping': [{ transport: 'embedded', version: UCP_STABLE_VERSION }] } } })).toBeUndefined()
    expect(embeddedCheckoutPresentation({ ...checkout, continue_url: 'javascript:alert(1)' })).toBeUndefined()
  })

  it('carries the presentation on the public action and preserves merchant URL parameters', () => {
    expect(TypeCompiler.Compile(PurchaseActionSchema).Check({ type: 'continue_on_merchant', label: 'Checkout', url: checkout.continue_url, presentation })).toBe(true)
    const url = new URL(embeddedCheckoutUrl(`${checkout.continue_url}&ec_delegate=payment.credential`, presentation))
    expect(url.searchParams.get('key')).toBe('merchant-session')
    expect(url.searchParams.get('ec_version')).toBe(UCP_STABLE_VERSION)
    expect(url.searchParams.get('ec_delegate')).toBe('')
    expect(url.searchParams.has('ec_auth')).toBe(false)
  })

  it('acknowledges ready with the negotiated UCP envelope', () => {
    expect(processEmbeddedCheckoutMessage(presentation, JSON.stringify({ jsonrpc: '2.0', id: 'ready-1', method: 'ec.ready', params: { delegate: [] } }))).toMatchObject({
      event: 'ready', response: { jsonrpc: '2.0', id: 'ready-1', result: { ucp: { version: UCP_STABLE_VERSION, status: 'success' } } }
    })
  })

  it('does not promise unimplemented delegation or expose a platform credential as merchant auth', () => {
    for (const params of [{ delegate: ['payment.credential'] }, { delegate: [], auth: { type: 'oauth' } }]) {
      expect(processEmbeddedCheckoutMessage(presentation, { jsonrpc: '2.0', id: 1, method: 'ec.ready', params })).toMatchObject({
        event: 'error', response: { result: { ucp: { status: 'error' } } }
      })
    }
  })

  it.each(['ec.start', 'ec.complete', 'ec.totals.change', 'ec.fulfillment.change'])('never responds to %s notifications', (method) => {
    const result = processEmbeddedCheckoutMessage(presentation, { jsonrpc: '2.0', method, params: { checkout } })
    expect(result.response).toBeUndefined()
    expect(result.event).toBeDefined()
    expect(result).not.toHaveProperty('order')
  })

  it('rejects a completion from another checkout without acknowledging the notification', () => {
    const result = processEmbeddedCheckoutMessage(presentation, { jsonrpc: '2.0', method: 'ec.complete', params: { checkout: { id: 'another-checkout' } } })
    expect(result.event).toBe('error')
    expect(result.response).toBeUndefined()
  })

  it('returns transport errors only for unknown requests, not notifications', () => {
    expect(processEmbeddedCheckoutMessage(presentation, { jsonrpc: '2.0', id: 0, method: 'ec.unknown' }).response).toMatchObject({ id: 0, error: { code: -32601 } })
    expect(processEmbeddedCheckoutMessage(presentation, { jsonrpc: '2.0', method: 'ec.unknown' }).response).toBeUndefined()
  })

  it('uses the merchant error recovery link without accepting executable URL schemes', () => {
    const input = { jsonrpc: '2.0', method: 'ec.error', params: { error: { continue_url: 'https://merchant.example/recover' } } }
    expect(processEmbeddedCheckoutMessage(presentation, input)).toMatchObject({ event: 'error', recoveryUrl: input.params.error.continue_url })
    input.params.error.continue_url = 'javascript:alert(1)'
    expect(processEmbeddedCheckoutMessage(presentation, input).recoveryUrl).toBeUndefined()
  })
})
