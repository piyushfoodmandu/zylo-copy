import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { deviceStorage } from '../lib/storage'

export type ShopperDetails = {
  email: string
  firstName: string
  lastName: string
  phone: string
}

type ShopperState = ShopperDetails & {
  set: (details: Partial<ShopperDetails>) => void
  clear: () => void
}

const empty: ShopperDetails = { email: '', firstName: '', lastName: '', phone: '' }

/**
 * The contact details a shopper would otherwise retype at every merchant.
 *
 * They stay on the device and leave it only as the `buyer` block of a checkout
 * the shopper themselves started — which is the one field UCP actually defines
 * for this, and the only place these details can do any work. Arro holds no
 * account for them, and no payment credential ever lands here.
 */
export const useShopperStore = create<ShopperState>()(persist(
  (set) => ({
    ...empty,
    set: (details) => set(details),
    clear: () => set(empty)
  }),
  {
    name: 'arro.shopper.v1',
    version: 1,
    storage: createJSONStorage(() => deviceStorage),
    partialize: ({ email, firstName, lastName, phone }) => ({ email, firstName, lastName, phone }),
    skipHydration: true
  }
))

/** The UCP `buyer` block, or nothing when there is nothing worth sending. */
export const buyerFromDetails = (details: ShopperDetails) => {
  const buyer = {
    ...(details.email.trim() ? { email: details.email.trim() } : {}),
    ...(details.firstName.trim() ? { first_name: details.firstName.trim() } : {}),
    ...(details.lastName.trim() ? { last_name: details.lastName.trim() } : {}),
    ...(details.phone.trim() ? { phone_number: details.phone.trim() } : {})
  }
  return Object.keys(buyer).length > 0 ? buyer : undefined
}
