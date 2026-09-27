import type { Money } from '../types/catalog'

const defaultLocale = 'en-US'
const cache = new Map<string, { formatter: Intl.NumberFormat; fractionDigits: number }>()

const getFormatter = (currency: string, locale = defaultLocale) => {
  const normalizedCurrency = currency.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) return undefined
  const key = `${locale}:${normalizedCurrency}`
  const cached = cache.get(key)
  if (cached) return cached

  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: normalizedCurrency
    })
    const resolved = formatter.resolvedOptions()
    const entry = {
      formatter,
      fractionDigits: resolved.maximumFractionDigits ?? resolved.minimumFractionDigits ?? 2
    }
    cache.set(key, entry)
    return entry
  } catch {
    return undefined
  }
}

export const currencyFractionDigits = (currency: string) =>
  getFormatter(currency)?.fractionDigits ?? 2

export const majorToMinor = (amount: number, currency: string) => {
  if (!Number.isFinite(amount) || amount < 0) return undefined
  const minor = Math.round(amount * (10 ** currencyFractionDigits(currency)))
  return Number.isSafeInteger(minor) ? minor : undefined
}

export const formatMoney = (money: Money, locale = defaultLocale) => {
  const entry = getFormatter(money.currency, locale)
  if (!entry || !Number.isSafeInteger(money.amountMinor)) {
    return `${money.currency.toUpperCase()} ${money.amountMinor}`
  }

  return entry.formatter.format(money.amountMinor / (10 ** entry.fractionDigits))
}
