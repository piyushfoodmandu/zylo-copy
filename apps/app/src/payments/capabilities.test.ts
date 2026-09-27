import { describe, expect, it } from 'vitest'
import { paymentClientCapabilities } from './capabilities'

describe('paymentClientCapabilities', () => {
  it('advertises native Stripe on iOS and Android, with Google Pay only on Android', () => {
    expect(paymentClientCapabilities('native_preferred', 'android')).toEqual({
      platform: 'android',
      surfaces: ['host_native', 'external_action', 'merchant_hosted'],
      providerKinds: ['google_pay', 'stripe', 'merchant_hosted']
    })

    expect(paymentClientCapabilities('native_preferred', 'ios')).toEqual({
      platform: 'ios',
      surfaces: ['host_native', 'external_action', 'merchant_hosted'],
      providerKinds: ['stripe', 'merchant_hosted']
    })
  })

  it('can downscope Android to a fresh external-only fallback action', () => {
    expect(paymentClientCapabilities('external_only', 'android')).toEqual({
      platform: 'android',
      surfaces: ['external_action', 'merchant_hosted'],
      providerKinds: ['merchant_hosted']
    })
  })
})
