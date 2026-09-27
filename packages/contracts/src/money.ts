import { Type, type Static } from '@sinclair/typebox'

const defaultLocale = 'en-US'
const formatterCacheMaxEntries = 128

type MoneyFormatOptions = {
  locale?: string
  signDisplay?: Intl.NumberFormatOptions['signDisplay']
}

type MoneyFormatPartsOptions = MoneyFormatOptions

type MoneyFormatCacheEntry = {
  formatter: Intl.NumberFormat
  fractionDigits: number
}

const formatterCache = new Map<string, MoneyFormatCacheEntry>()

const formatterKey = ({
  locale,
  currency,
  signDisplay
}: {
  locale: string
  currency: string
  signDisplay?: Intl.NumberFormatOptions['signDisplay']
}) => `${locale}:${currency}:${signDisplay ?? 'auto'}`

const pruneFormatterCache = () => {
  while (formatterCache.size > formatterCacheMaxEntries) {
    const firstKey = formatterCache.keys().next().value as string | undefined
    if (!firstKey) return
    formatterCache.delete(firstKey)
  }
}

export const MoneySchema = Type.Object(
  {
    amountMinor: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
    currency: Type.String({ minLength: 3, maxLength: 3, pattern: '^[A-Z]{3}$' })
  },
  { additionalProperties: false }
)

export type Money = Static<typeof MoneySchema>
export type MoneyLike = {
  amountMinor: number
  currency: string
}

export const normalizeCurrencyCode = (currency: string) => currency.trim().toUpperCase()

const normalizeLocale = (locale: string | undefined) =>
  typeof locale === 'string' && locale.trim().length > 0 ? locale.trim() : defaultLocale

const formatterFor = ({
  currency,
  locale,
  signDisplay
}: {
  currency: string
  locale?: string
  signDisplay?: Intl.NumberFormatOptions['signDisplay']
}) => {
  const normalized = normalizeCurrencyCode(currency)
  if (!/^[A-Z]{3}$/.test(normalized)) return undefined
  const normalizedLocale = normalizeLocale(locale)
  const key = formatterKey({ locale: normalizedLocale, currency: normalized, signDisplay })
  const cached = formatterCache.get(key)
  if (cached) return cached

  try {
    const formatter = new Intl.NumberFormat(normalizedLocale, {
      style: 'currency',
      currency: normalized,
      signDisplay
    })
    const resolved = formatter.resolvedOptions()
    const entry = {
      formatter,
      fractionDigits: resolved.maximumFractionDigits ?? resolved.minimumFractionDigits ?? 2
    }
    formatterCache.set(key, entry)
    pruneFormatterCache()
    return entry
  } catch {
    if (normalizedLocale === defaultLocale) return undefined
    try {
      const formatter = new Intl.NumberFormat(defaultLocale, {
        style: 'currency',
        currency: normalized,
        signDisplay
      })
      const resolved = formatter.resolvedOptions()
      const entry = {
        formatter,
        fractionDigits: resolved.maximumFractionDigits ?? resolved.minimumFractionDigits ?? 2
      }
      formatterCache.set(formatterKey({ locale: defaultLocale, currency: normalized, signDisplay }), entry)
      pruneFormatterCache()
      return entry
    } catch {
      return undefined
    }
  }
}

export const currencyFractionDigits = (currency: string, locale = defaultLocale) =>
  formatterFor({ currency, locale })?.fractionDigits

export const moneyFormatterCacheSize = () => formatterCache.size

export const moneyDecimalStringToMinor = ({
  amount,
  currency
}: {
  amount: string
  currency: string
}) => {
  const trimmed = amount.trim()
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return undefined

  const exponent = currencyFractionDigits(currency)
  if (exponent === undefined) return undefined
  const [major = '0', fraction = ''] = trimmed.split('.')
  if (fraction.length > exponent) return undefined

  const normalizedFraction = fraction.padEnd(exponent, '0')
  const minorText = `${major}${normalizedFraction}`.replace(/^0+(?=\d)/, '')
  const minor = Number.parseInt(minorText || '0', 10)
  return Number.isSafeInteger(minor) && minor >= 0 ? minor : undefined
}

export const moneyMinorToDecimalString = ({
  amountMinor,
  currency
}: {
  amountMinor: number
  currency: string
}) => {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) return undefined
  const exponent = currencyFractionDigits(currency)
  if (exponent === undefined) return undefined

  const amount = BigInt(amountMinor)
  if (exponent === 0) return amount.toString()
  const divisor = 10n ** BigInt(exponent)
  const major = amount / divisor
  const fraction = (amount % divisor).toString().padStart(exponent, '0')
  return `${major}.${fraction}`
}

export const moneyFromDecimalString = ({
  amount,
  currency
}: {
  amount: string
  currency: string
}): Money | undefined => {
  const normalizedCurrency = normalizeCurrencyCode(currency)
  const amountMinor = moneyDecimalStringToMinor({
    amount,
    currency: normalizedCurrency
  })
  return amountMinor === undefined
    ? undefined
    : {
        amountMinor,
        currency: normalizedCurrency
      }
}

const moneyToDisplayNumber = ({
  amountMinor,
  currency,
  locale
}: {
  amountMinor: number
  currency: string
  locale?: string
}) => {
  const exponent = currencyFractionDigits(currency, locale)
  if (exponent === undefined || !Number.isSafeInteger(amountMinor)) return undefined

  const factor = 10 ** exponent
  return amountMinor / factor
}

export const formatMoney = (money: MoneyLike, locale = defaultLocale, options: MoneyFormatOptions = {}) => {
  const normalizedCurrency = normalizeCurrencyCode(money.currency)
  const formatter = formatterFor({
    currency: normalizedCurrency,
    locale,
    signDisplay: options.signDisplay
  })
  const displayValue = moneyToDisplayNumber({
    amountMinor: money.amountMinor,
    currency: normalizedCurrency,
    locale
  })
  if (!formatter || displayValue === undefined) return `${normalizedCurrency} ${money.amountMinor}`

  return formatter.formatter.format(displayValue)
}

export const formatMoneyParts = (
  money: MoneyLike,
  locale = defaultLocale,
  options: MoneyFormatPartsOptions = {}
) => {
  const normalizedCurrency = normalizeCurrencyCode(money.currency)
  const formatter = formatterFor({
    currency: normalizedCurrency,
    locale,
    signDisplay: options.signDisplay
  })
  const displayValue = moneyToDisplayNumber({
    amountMinor: money.amountMinor,
    currency: normalizedCurrency,
    locale
  })
  if (!formatter || displayValue === undefined) return undefined

  return formatter.formatter.formatToParts(displayValue).map((part) => ({
    type: part.type,
    value: part.value
  }))
}
