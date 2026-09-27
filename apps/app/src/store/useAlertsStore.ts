import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { productGroupKey } from '../lib/product-groups'
import { deviceStorage } from '../lib/storage'
import type { CatalogProductSummary, Money } from '../types/catalog'

export type PriceAlert = {
  key: string
  product: CatalogProductSummary
  /** The price when the alert was set. Anything below it is the news. */
  watchedPrice?: Money
  createdAt: string
}

type AlertsState = {
  alerts: PriceAlert[]
  toggle: (product: CatalogProductSummary) => void
  remove: (key: string) => void
  clear: () => void
}

/**
 * A price alert is the honest answer to "should I buy this now?" — which is
 * usually "not yet". A comparison engine that only helps at the moment of
 * purchase misses the weeks before it, and the shopper solves that by keeping a
 * tab open or forgetting entirely.
 *
 * Watching is device-local for now, so it can only tell the shopper what changed
 * since they last looked; a mailed alert needs a server-side watcher and an
 * address to send to, and promising one this side of that would be a lie.
 */
export const useAlertsStore = create<AlertsState>()(persist(
  (set) => ({
    alerts: [],

    toggle: (product) => set((state) => {
      const key = productGroupKey(product)
      if (state.alerts.some((alert) => alert.key === key)) {
        return { alerts: state.alerts.filter((alert) => alert.key !== key) }
      }
      return {
        alerts: [{
          key,
          product,
          ...(product.price ? { watchedPrice: product.price } : {}),
          createdAt: new Date().toISOString()
        }, ...state.alerts]
      }
    }),

    remove: (key) => set((state) => ({ alerts: state.alerts.filter((alert) => alert.key !== key) })),
    clear: () => set({ alerts: [] })
  }),
  {
    name: 'arro.alerts.v1',
    version: 1,
    storage: createJSONStorage(() => deviceStorage),
    skipHydration: true
  }
))
