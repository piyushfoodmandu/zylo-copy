import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { productGroupKey } from '../lib/product-groups'
import { deviceStorage } from '../lib/storage'
import type { CatalogProductSummary } from '../types/catalog'

export type SavedItem = {
  key: string
  /** The offer snapshot as it was when saved, so a delisted product still renders. */
  product: CatalogProductSummary
  savedAt: string
  /** The search that led here. Answers "why is this on my list?" months later. */
  query?: string
  /** Which list it belongs to. Absent means the default list. */
  listId?: string
}

export type SavedList = {
  id: string
  name: string
  createdAt: string
}

/**
 * One list is a wishlist; several are how people actually shop. A kitchen
 * refit, a birthday and an idle "maybe one day" are different decisions, and
 * pouring them into one list makes each of them harder to finish.
 *
 * The default list is not a row in the collection — it is the absence of one, so
 * a shopper who never makes a second list never has to know lists exist.
 */
export const defaultListId = 'favourites'
export const defaultListName = 'My favourites'

type SavedState = {
  items: SavedItem[]
  lists: SavedList[]
  recent: CatalogProductSummary[]
  recentQueries: string[]
  toggle: (product: CatalogProductSummary, options?: { query?: string; listId?: string }) => void
  remove: (key: string) => void
  clear: () => void
  createList: (name: string) => string | undefined
  renameList: (id: string, name: string) => void
  deleteList: (id: string) => void
  /** Moves a saved product between lists without losing why it was saved. */
  moveToList: (key: string, listId: string) => void
  /** Records a product as recently viewed. Local only, and capped. */
  view: (product: CatalogProductSummary) => void
  recordQuery: (query: string) => void
  clearQueries: () => void
}

const recentLimit = 12
const queryLimit = 8

/**
 * Saved products are decision state, not a wishlist widget. The scope rules are
 * explicit: keep the reason it was saved, keep the last-known snapshot when a
 * source stops answering for it, and never turn the list into a feed.
 */
export const useSavedStore = create<SavedState>()(persist(
  (set) => ({
    items: [],
    lists: [],
    recent: [],
    recentQueries: [],

    toggle: (product, options) => set((state) => {
      const key = productGroupKey(product)
      if (state.items.some((item) => item.key === key)) {
        return { items: state.items.filter((item) => item.key !== key) }
      }
      return {
        items: [{
          key,
          product,
          savedAt: new Date().toISOString(),
          ...(options?.query ? { query: options.query } : {}),
          ...(options?.listId && options.listId !== defaultListId ? { listId: options.listId } : {})
        }, ...state.items]
      }
    }),

    createList: (name) => {
      const trimmed = name.trim().slice(0, 60)
      if (!trimmed) return undefined
      const id = `list_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
      set((state) => ({ lists: [...state.lists, { id, name: trimmed, createdAt: new Date().toISOString() }] }))
      return id
    },

    renameList: (id, name) => set((state) => {
      const trimmed = name.trim().slice(0, 60)
      if (!trimmed) return state
      return { lists: state.lists.map((list) => (list.id === id ? { ...list, name: trimmed } : list)) }
    }),

    // Deleting a list keeps its products. Someone tidying their lists is not
    // asking to throw away the things they saved.
    deleteList: (id) => set((state) => ({
      lists: state.lists.filter((list) => list.id !== id),
      items: state.items.map((item) => (item.listId === id ? { ...item, listId: undefined } : item))
    })),

    moveToList: (key, listId) => set((state) => ({
      items: state.items.map((item) => (item.key === key
        ? { ...item, listId: listId === defaultListId ? undefined : listId }
        : item))
    })),

    remove: (key) => set((state) => ({ items: state.items.filter((item) => item.key !== key) })),

    clear: () => set({ items: [] }),

    view: (product) => set((state) => {
      const key = productGroupKey(product)
      const rest = state.recent.filter((entry) => productGroupKey(entry) !== key)
      return { recent: [product, ...rest].slice(0, recentLimit) }
    }),

    recordQuery: (query) => set((state) => {
      const next = query.trim()
      if (!next) return state
      const rest = state.recentQueries.filter((entry) => entry.toLowerCase() !== next.toLowerCase())
      return { recentQueries: [next, ...rest].slice(0, queryLimit) }
    }),

    clearQueries: () => set({ recentQueries: [] })
  }),
  {
    name: 'arro.saved.v1',
    version: 1,
    storage: createJSONStorage(() => deviceStorage),
    partialize: (state) => ({
      items: state.items,
      lists: state.lists,
      recent: state.recent,
      recentQueries: state.recentQueries
    }),
    skipHydration: true
  }
))
