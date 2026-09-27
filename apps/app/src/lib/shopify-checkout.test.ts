import { beforeEach, expect, it, vi } from 'vitest'

const kit = vi.hoisted(() => ({
  listeners: new Map<string, (event?: unknown) => void>(),
  present: vi.fn(), dismiss: vi.fn(), preload: vi.fn()
}))
vi.mock('@shopify/checkout-sheet-kit', () => ({
  ShopifyCheckoutSheet: class {
    present = kit.present
    dismiss = kit.dismiss
    preload = kit.preload
    addEventListener(event: string, listener: (event?: unknown) => void) {
      kit.listeners.set(event, listener)
      return { remove: () => kit.listeners.delete(event) }
    }
  }
}))
import { openShopifyCheckout } from './shopify-checkout.native'

beforeEach(() => { vi.clearAllMocks(); kit.listeners.clear() })

it('cleans up callbacks on dismissal without claiming an order', async () => {
  const completion = openShopifyCheckout('https://merchant.example/checkout/1')
  kit.listeners.get('close')?.()
  await expect(completion).resolves.toBe('dismissed')
  expect(kit.listeners.size).toBe(0)
})

it('leaves recoverable SDK errors in the sheet and dismisses it for terminal errors', async () => {
  const completion = openShopifyCheckout('https://merchant.example/checkout/1')
  kit.listeners.get('error')?.({ recoverable: true })
  expect(kit.dismiss).not.toHaveBeenCalled()
  expect(kit.listeners.size).toBe(3)
  kit.listeners.get('error')?.({ recoverable: false })
  await expect(completion).rejects.toThrow('could not open inside Arro')
  expect(kit.dismiss).toHaveBeenCalledOnce()
  expect(kit.listeners.size).toBe(0)
})
