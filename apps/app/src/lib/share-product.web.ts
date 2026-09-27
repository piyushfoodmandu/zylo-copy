import { canonical } from './seo'

type ShareProductResult = 'shared' | 'copied' | 'cancelled'

const copyText = async (value: string) => {
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(value)
    return
  }

  const field = document.createElement('textarea')
  field.value = value
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  const copied = document.execCommand('copy')
  field.remove()
  if (!copied) throw new Error('The browser could not copy this link.')
}

export const shareProduct = async ({ title, path }: { title: string; path: string }): Promise<ShareProductResult> => {
  const url = canonical(path)
  if (typeof globalThis.navigator?.share === 'function') {
    try {
      await globalThis.navigator.share({ title, text: title, url })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // A browser may expose Web Share but reject it outside a supported
      // context. Copying the canonical URL is still a useful, deterministic
      // fallback.
    }
  }

  await copyText(url)
  return 'copied'
}
