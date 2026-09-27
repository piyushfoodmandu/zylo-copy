import { useEffect, useRef, useState } from 'react'
import { searchProducts } from '../api/client'
import type { CatalogProductSummary } from '../types/catalog'

export type Suggestion = {
  product: CatalogProductSummary
  key: string
}

/**
 * Live results while the shopper types.
 *
 * A comparison engine that waits for Enter makes the shopper guess whether their
 * spelling found anything. The delay is long enough that a fast typist sends one
 * request rather than one per keystroke, and every superseded request is aborted
 * so a slow early query can never overwrite a newer answer — the bug that makes
 * a suggestion list flicker back to stale results.
 */
const debounceMs = 220
const minLength = 2
const limit = 6

export function useSearchSuggestions(query: string, enabled = true) {
  const [items, setItems] = useState<Suggestion[]>([])
  const [loading, setLoading] = useState(false)
  const request = useRef<AbortController | null>(null)
  const latest = useRef(0)

  useEffect(() => {
    const trimmed = query.trim()

    if (!enabled || trimmed.length < minLength) {
      request.current?.abort()
      setItems([])
      setLoading(false)
      return
    }

    const ticket = ++latest.current
    // A new query owns a new suggestion set. Retaining the previous products
    // makes ArrowDown + Enter capable of selecting a result for text that is no
    // longer in the field while the replacement request is in flight.
    setItems([])
    setLoading(true)

    const timer = setTimeout(() => {
      request.current?.abort()
      const controller = new AbortController()
      request.current = controller

      void searchProducts(trimmed, { sort: 'relevance', limit }, controller.signal)
        .then((response) => {
          if (ticket !== latest.current) return
          setItems(response.items.slice(0, limit).map((product) => ({
            product,
            key: `${product.businessId}:${product.productId}`
          })))
        })
        .catch(() => {
          if (ticket !== latest.current) return
          // A failed lookup shows nothing rather than an error under the field:
          // the shopper can still press Enter and get the full results page.
          setItems([])
        })
        .finally(() => {
          if (ticket === latest.current) setLoading(false)
        })
    }, debounceMs)

    return () => clearTimeout(timer)
  }, [enabled, query])

  useEffect(() => () => request.current?.abort(), [])

  return { items, loading }
}
