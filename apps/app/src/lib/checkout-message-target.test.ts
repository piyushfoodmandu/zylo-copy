import { describe, expect, it } from 'vitest'
import { checkoutHasInputErrors, checkoutMessageTarget, checkoutMessageHasEditor, groupCheckoutInputMessages } from './checkout-message-target'
import type { PurchaseResponse } from '../types/purchase'

describe('checkout input messages', () => {
  it('gives editable warnings one owner without hiding disclosures or uneditable failures', () => {
    const purchase = { state: 'merchant_continuation_required', canAddShippingAddress: true } as PurchaseResponse
    const warning = { code: 'delivery_city_required', text: 'Enter a city', severity: 'warning', resolution: 'recoverable' } as const
    expect(checkoutMessageHasEditor(warning, purchase)).toBe(true)
    expect(checkoutMessageHasEditor({ ...warning, presentation: 'disclosure' }, purchase)).toBe(false)
    expect(checkoutMessageHasEditor({ ...warning, severity: 'blocked' }, purchase)).toBe(false)
    expect(checkoutMessageHasEditor(warning, { ...purchase, canAddShippingAddress: false })).toBe(false)
    expect(checkoutMessageHasEditor(warning, { ...purchase, state: 'completed' })).toBe(false)
  })
  it.each([
    ['buyer_identity_contact_method_required', 'buyer'],
    ['delivery_address_required', 'fulfillment'],
    ['delivery_no_delivery_available_for_merchandise_line', 'fulfillment'],
    ['extension_interaction_required', undefined]
  ])('identifies %s without requiring an optional JSONPath', (code, target) => {
    expect(checkoutMessageTarget({ code, text: 'Merchant message', severity: 'warning' })).toBe(target)
  })

  it('uses universal field paths before provider error codes', () => {
    expect(checkoutMessageTarget({ text: 'Email missing', severity: 'warning', path: '$.buyer.email' })).toBe('buyer')
    expect(checkoutMessageTarget({ text: 'Address missing', severity: 'warning', path: '$.fulfillment.methods[0].destinations' })).toBe('fulfillment')
    expect(checkoutMessageTarget({ code: 'delivery_price', text: 'Error', severity: 'warning', path: '$.totals' })).toBeUndefined()
  })

  it('keeps the address draft open for merchant corrections, not unrelated contact errors', () => {
    const purchase = { messages: [{
      text: 'Enter a city', code: 'delivery_address_city_required', severity: 'warning', resolution: 'recoverable'
    }] } as PurchaseResponse
    expect(checkoutHasInputErrors(purchase, 'fulfillment')).toBe(true)
    expect(checkoutHasInputErrors(purchase, 'buyer')).toBe(false)
    expect(checkoutHasInputErrors(purchase)).toBe(true)
    expect(checkoutHasInputErrors({ ...purchase, messages: [] }, 'fulfillment')).toBe(false)
  })

  it('groups repeated delivery warnings without losing text or collapsing disclosures', () => {
    const messages: PurchaseResponse['messages'] = [
      { code: 'delivery_address_city_required', text: 'Enter a city', severity: 'warning' },
      { code: 'delivery_address_postal_required', text: 'Enter a postal code', severity: 'warning' },
      { code: 'delivery_terms', text: 'Delivery terms', severity: 'warning', presentation: 'disclosure' }
    ]
    const grouped = groupCheckoutInputMessages(messages)
    expect(grouped).toHaveLength(2)
    expect(grouped[0]?.text).toBe('Enter a city\nEnter a postal code')
    expect(grouped[1]).toEqual(messages[2])
    expect(messages[0]?.text).toBe('Enter a city')
  })
})
