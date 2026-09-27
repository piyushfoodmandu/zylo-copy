import { beforeEach, expect, it, vi } from 'vitest'
import type { PurchaseAction } from '@arro/contracts'

const adapters = vi.hoisted(() => ({ platform: { OS: 'ios' }, open: vi.fn(), preload: vi.fn() }))
vi.mock('react-native', () => ({ Platform: adapters.platform }))
vi.mock('../lib/shopify-checkout', () => ({ openShopifyCheckout: adapters.open, preloadShopifyCheckout: adapters.preload }))
import { openNativeCheckout, preloadNativeCheckout } from './checkout-presentation'

const action: PurchaseAction = {
  type: 'continue_on_merchant', label: 'Checkout',
  url: 'https://custom-domain.example/checkouts/1?signature=unchanged',
  presentation: { type: 'native_checkout', provider: 'shopify' }
}

beforeEach(() => { vi.clearAllMocks(); adapters.platform.OS = 'ios' })

it('preloads and opens only the explicitly selected provider, preserving the merchant URL', async () => {
  adapters.open.mockResolvedValue('dismissed')
  preloadNativeCheckout(action)
  await expect(openNativeCheckout(action)).resolves.toBe('dismissed')
  expect(adapters.preload).toHaveBeenCalledExactlyOnceWith(action.url)
  expect(adapters.open).toHaveBeenCalledExactlyOnceWith(action.url)
})

it('does not warm authentication, order, generic browser or standard embedded actions', () => {
  for (const other of [
    { ...action, type: 'view_order' as const },
    { ...action, type: 'complete_ucp_action' as const },
    { ...action, presentation: { type: 'browser' as const } },
    { ...action, presentation: { type: 'ucp_embedded' as const, version: '2026-08-25' as const, checkoutId: '1' } }
  ]) {
    preloadNativeCheckout(other)
    expect(openNativeCheckout(other)).toBeUndefined()
  }
  expect(adapters.preload).not.toHaveBeenCalled()
  expect(adapters.open).not.toHaveBeenCalled()
})

it('does not invoke a native module on web or silently downgrade a failed native presenter', async () => {
  adapters.platform.OS = 'web'
  expect(openNativeCheckout(action)).toBeUndefined()
  adapters.platform.OS = 'android'
  adapters.open.mockRejectedValue(new Error('Presentation failed'))
  await expect(openNativeCheckout(action)).rejects.toThrow('Presentation failed')
})
