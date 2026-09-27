import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { deviceStorage } from '../lib/storage'
import type { PurchaseResponse } from '../types/purchase'

type CheckoutState = {
  /**
   * The purchase as `prepare` just returned it. The checkout screen renders
   * from this instead of re-reading the same purchase over the network, which
   * removes a round trip from the slowest moment in the flow.
   */
  prepared: PurchaseResponse | undefined
  /** Durable pointer only; merchant checkout state is always refreshed. */
  activePurchaseId: string | undefined
  setPrepared: (purchase: PurchaseResponse | undefined) => void
  clearActive: (purchaseId: string) => void
}

export const useCheckoutStore = create<CheckoutState>()(persist(
  (set) => ({
    prepared: undefined,
    activePurchaseId: undefined,
    setPrepared: (prepared) => set((state) => ({
      prepared,
      activePurchaseId: prepared?.purchaseId ?? state.activePurchaseId
    })),
    clearActive: (purchaseId) => set((state) =>
      state.activePurchaseId === purchaseId
        ? { activePurchaseId: undefined, prepared: undefined }
        : state)
  }),
  {
    name: 'arro.checkout.v1',
    version: 1,
    storage: createJSONStorage(() => deviceStorage),
    partialize: ({ activePurchaseId }) => ({ activePurchaseId }),
    skipHydration: true
  }
))
