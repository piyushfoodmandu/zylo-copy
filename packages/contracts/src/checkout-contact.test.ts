import { describe, expect, it } from 'vitest'
import { normalizeCheckoutPhone } from './checkout-contact.ts'

describe('checkout phone input', () => {
  it.each([
    ['+1 (212) 555-0123', '+12125550123'],
    [' +977 980-000-0000 ', '+9779800000000'],
    ['+442079460000', '+442079460000'],
    ['', '']
  ])('normalizes display formatting in %s', (value, expected) => {
    expect(normalizeCheckoutPhone(value)).toBe(expected)
  })
  it.each(['2125550123', '+1 212 555 0123 ext 4', '+0123', '+1234567890123456', '+1abc2125550123'])('does not guess or silently discard invalid input %s', (value) => {
    expect(() => normalizeCheckoutPhone(value)).toThrow('country code')
  })
})
