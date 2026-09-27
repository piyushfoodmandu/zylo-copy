/** Remove display punctuation without guessing a country code or changing digits. */
export const normalizeCheckoutPhone = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const normalized = trimmed.replace(/[\s().-]/g, '')
  if (!/^\+[1-9][0-9]{1,14}$/.test(normalized)) {
    throw new Error('Enter a phone number with its country code, for example +1 212 555 0123.')
  }
  return normalized
}
