/**
 * Guest shopping state — the cart, the saved list, recently viewed — belongs to
 * the browser until someone explicitly signs in or hands it off.
 *
 * Every call is guarded twice. The server renders this bundle with no `window`
 * at all, and a browser in private mode or with storage blocked throws on
 * access rather than returning null. Losing a cart is bad; failing the render
 * that shows the cart is worse.
 */
const store = () => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

export const deviceStorage = {
  getItem: (key: string) => {
    try {
      return store()?.getItem(key) ?? null
    } catch {
      return null
    }
  },
  setItem: (key: string, value: string) => {
    try {
      store()?.setItem(key, value)
    } catch {
      // A full or blocked quota is not worth breaking an interaction over.
    }
  },
  removeItem: (key: string) => {
    try {
      store()?.removeItem(key)
    } catch {
      // Same: the state is device convenience, never the source of truth.
    }
  }
}
