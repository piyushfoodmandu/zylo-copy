import { describe, expect, it } from 'vitest'
import { shopperErrorText } from './shopper-copy'

describe('checkout error copy', () => {
  it('does not equate protocol failure with an unsupported merchant', () => {
    const error = Object.assign(new Error('Upstream failure'), { code: 'ucp_protocol_error' })
    expect(shopperErrorText(error, 'Fallback')).not.toMatch(/does not support|another offer/)
  })
  it('distinguishes temporary merchant throttling from field rejection', () => {
    expect(shopperErrorText(Object.assign(new Error('429'), { code: 'ucp_merchant_rate_limited' }), 'Fallback')).toContain('temporarily limiting')
    expect(shopperErrorText(Object.assign(new Error('Check the phone number.'), { code: 'ucp_review_rejected' }), 'Fallback')).toBe('Check the phone number.')
  })
})
