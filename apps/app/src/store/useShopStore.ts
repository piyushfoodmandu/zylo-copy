import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import { deviceStorage } from '../lib/storage'
import type { CatalogProductSummary } from '../types/catalog'

type Sort = 'relevance' | 'price_asc' | 'price_desc'

type ShopState = {
  query: string
  submittedQuery: string
  sort: Sort
  minPrice: number | undefined
  maxPrice: number | undefined
  compare: CatalogProductSummary[]
  selectedProduct: CatalogProductSummary | undefined
  selectedOffers: CatalogProductSummary[]
  setQuery: (query: string) => void
  submitQuery: (query?: string) => void
  setSort: (sort: Sort) => void
  setPriceRange: (minPrice?: number, maxPrice?: number) => void
  selectProduct: (product: CatalogProductSummary, offers?: CatalogProductSummary[]) => void
  setCompare: (products: CatalogProductSummary[]) => void
  toggleCompare: (product: CatalogProductSummary) => void
  clearCompare: () => void
  resetFilters: () => void
}

const sameProduct = (a: CatalogProductSummary, b: CatalogProductSummary) =>
  a.businessId === b.businessId &&
  a.productId === b.productId &&
  a.variantId === b.variantId

export const useShopStore = create<ShopState>()(persist((set) => ({
  query: '',
  submittedQuery: '',
  sort: 'relevance',
  minPrice: undefined,
  maxPrice: undefined,
  compare: [],
  selectedProduct: undefined,
  selectedOffers: [],
  setQuery: (query) => set({ query }),
  submitQuery: (query) => set((state) => {
    const submittedQuery = (query ?? state.query).trim()
    if (!submittedQuery) return state
    const isNewQuery = submittedQuery !== state.submittedQuery
    return {
      query: submittedQuery,
      submittedQuery,
      ...(isNewQuery ? { sort: 'relevance' as const, minPrice: undefined, maxPrice: undefined } : {})
    }
  }),
  setSort: (sort) => set({ sort }),
  setPriceRange: (minPrice, maxPrice) => set({ minPrice, maxPrice }),
  selectProduct: (selectedProduct, selectedOffers = [selectedProduct]) => set({
    selectedProduct,
    selectedOffers
  }),
  setCompare: (products) => set({ compare: products.slice(0, 4) }),
  toggleCompare: (product) => set((state) => {
    const exists = state.compare.some((candidate) => sameProduct(candidate, product))
    if (exists) {
      return { compare: state.compare.filter((candidate) => !sameProduct(candidate, product)) }
    }
    if (state.compare.length >= 4) return state
    return { compare: [...state.compare, product] }
  }),
  clearCompare: () => set({ compare: [] }),
  resetFilters: () => set({ sort: 'relevance', minPrice: undefined, maxPrice: undefined })
}), {
  name: 'arro.shop.v1',
  version: 1,
  storage: createJSONStorage(() => deviceStorage),
  // A comparison is a shopper decision worth surviving a reload. Search text,
  // temporary filters and the selected detail snapshot remain session state.
  partialize: (state) => ({ compare: state.compare }),
  skipHydration: true
}))
