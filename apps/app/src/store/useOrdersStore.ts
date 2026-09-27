import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { deviceStorage } from '../lib/storage'
import type { Money } from '../types/catalog'

/**
 * What Arro actually knows about a checkout, which is not always that it
 * happened. A native UCP checkout ends with the shop confirming the order, so
 * `placed` is a fact. A merchant handoff ends with the shopper leaving for the
 * shop's own checkout, and Arro is never told how that finished — calling that
 * an order would be inventing one, so it stays `continued`.
 */
export type OrderOutcome = 'placed' | 'continued' | 'canceled'

export type OrderRecord = {
  key: string
  recordedAt: string
  title: string
  shop: string
  outcome: OrderOutcome
  imageUrl?: string
  price?: Money
  href?: string
  /** The shop's own reference, when the shop returned one. */
  reference?: string
}

type OrdersState = {
  orders: OrderRecord[]
  record: (order: Omit<OrderRecord, 'recordedAt'>) => void
  clear: () => void
}

const limit = 50

export const useOrdersStore = create<OrdersState>()(persist(
  (set) => ({
    orders: [],
    record: (order) => set((state) => {
      // One checkout can report twice — handed off, then confirmed. The later
      // outcome replaces the earlier one rather than listing the same purchase
      // as two separate orders.
      const rest = state.orders.filter((existing) => existing.key !== order.key)
      return {
        orders: [{ ...order, recordedAt: new Date().toISOString() }, ...rest].slice(0, limit)
      }
    }),
    clear: () => set({ orders: [] })
  }),
  {
    name: 'arro.orders.v1',
    storage: createJSONStorage(() => deviceStorage),
    skipHydration: true
  }
))
