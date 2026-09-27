import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { adoptShopperSession, type ShopperAccount } from '../api/client'
import { deviceStorage } from '../lib/storage'
import type { ShopperSessionResponse } from '../types/purchase'

type AccountState = {
  account: ShopperAccount | undefined
  session: ShopperSessionResponse | undefined
  signIn: (account: ShopperAccount, session: ShopperSessionResponse) => void
  signOut: () => void
}

/**
 * An account is optional, so this store is allowed to be empty forever.
 *
 * The session token is persisted alongside the account because it *is* the
 * credential — losing it on reload would sign someone out every time they
 * refreshed. It carries no password and expires on its own.
 */
export const useAccountStore = create<AccountState>()(persist(
  (set) => ({
    account: undefined,
    session: undefined,
    signIn: (account, session) => set({ account, session }),
    signOut: () => set({ account: undefined, session: undefined })
  }),
  {
    name: 'arro.account.v1',
    version: 1,
    storage: createJSONStorage(() => deviceStorage),
    partialize: (state) => ({ account: state.account, session: state.session }),
    skipHydration: true,
    // The API client holds the active session in module state, so a rehydrated
    // token has to be handed back to it or the first purchase call would run
    // anonymously despite the UI showing someone signed in.
    onRehydrateStorage: () => (state) => {
      if (state?.session) adoptShopperSession(state.session)
    }
  }
))
