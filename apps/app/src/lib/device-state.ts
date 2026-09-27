import { useEffect, useState } from 'react'
import { useAlertsStore } from '../store/useAlertsStore'
import { useCartStore } from '../store/useCartStore'
import { useCheckoutStore } from '../store/useCheckoutStore'
import { useOrdersStore } from '../store/useOrdersStore'
import { useAccountStore } from '../store/useAccountStore'
import { useSavedStore } from '../store/useSavedStore'
import { useShopperStore } from '../store/useShopperStore'
import { useShopStore } from '../store/useShopStore'

/**
 * Device-local shopping state is read once, on the client, after the first
 * paint. The server renders an empty cart and an empty saved list because that
 * is genuinely all it knows; hydrating from storage during render would either
 * crash the server bundle or publish markup the browser instantly contradicts.
 *
 * Nothing waits on this. The header badge and the cart page simply appear once
 * the read resolves, which on both platforms is the same tick or the next one.
 */
export function useDeviceState() {
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    let active = true
    void Promise.all([
      useCartStore.persist.rehydrate(),
      useCheckoutStore.persist.rehydrate(),
      useSavedStore.persist.rehydrate(),
      useShopperStore.persist.rehydrate(),
      useAccountStore.persist.rehydrate(),
      useOrdersStore.persist.rehydrate(),
      useAlertsStore.persist.rehydrate(),
      useShopStore.persist.rehydrate()
    ]).finally(() => { if (active) setHydrated(true) })
    return () => { active = false }
  }, [])

  return hydrated
}
