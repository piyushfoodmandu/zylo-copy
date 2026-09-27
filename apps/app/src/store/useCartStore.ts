import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { cartLineKey, type CartLine } from '../lib/cart'
import { deviceStorage } from '../lib/storage'
import type { CatalogProductSummary } from '../types/catalog'

/** A shop will not ship a hundred of anything on a whim, and neither will Arro. */
const maxQuantity = 20

type CartState = {
  lines: CartLine[]
  add: (product: CatalogProductSummary, options?: { quantity?: number; query?: string }) => void
  setQuantity: (key: string, quantity: number) => void
  remove: (key: string) => void
  removeMerchant: (merchantKey: string) => void
  clear: () => void
}

const clampQuantity = (value: number) => Math.max(1, Math.min(maxQuantity, Math.round(value)))

/**
 * The cart is a device-local list of merchant offers, not a server-side basket.
 * It deliberately spans shops while every checkout stays scoped to one, because
 * a merchant Order is the only thing that can complete a purchase.
 *
 * Each line keeps the offer snapshot it was added with, so the cart renders
 * before any network call and can show what changed once revalidation answers.
 */
export const useCartStore = create<CartState>()(persist(
  (set) => ({
    lines: [],

    add: (product, options) => set((state) => {
      const key = cartLineKey(product)
      const quantity = clampQuantity(options?.quantity ?? 1)
      const existing = state.lines.find((line) => line.key === key)
      if (existing) {
        return {
          lines: state.lines.map((line) => line.key === key
            ? { ...line, quantity: clampQuantity(line.quantity + quantity), product }
            : line)
        }
      }
      // Newest first: the thing just added is the thing being looked for.
      return {
        lines: [{
          key,
          product,
          quantity,
          addedAt: new Date().toISOString(),
          ...(options?.query ? { query: options.query } : {})
        }, ...state.lines]
      }
    }),

    setQuantity: (key, quantity) => set((state) => quantity < 1
      ? { lines: state.lines.filter((line) => line.key !== key) }
      : { lines: state.lines.map((line) => line.key === key ? { ...line, quantity: clampQuantity(quantity) } : line) }),

    remove: (key) => set((state) => ({ lines: state.lines.filter((line) => line.key !== key) })),

    removeMerchant: (merchantKey) => set((state) => ({
      lines: state.lines.filter((line) =>
        (line.product.seller?.domain || line.product.seller?.id || line.product.businessId) !== merchantKey)
    })),

    clear: () => set({ lines: [] })
  }),
  {
    name: 'arro.cart.v1',
    version: 1,
    storage: createJSONStorage(() => deviceStorage),
    partialize: (state) => ({ lines: state.lines }),
    // The server has no device storage, so hydration is a client step. Reading
    // it during render would either crash the server or ship a first paint the
    // browser immediately contradicts.
    skipHydration: true
  }
))
