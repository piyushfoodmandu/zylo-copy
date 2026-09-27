import type { UcpCheckout } from '@arro/contracts'

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const isoCountryCode = (value: unknown) => {
  const country = stringValue(value)?.toUpperCase()
  return country && /^[A-Z]{2}$/.test(country) ? country : undefined
}

/**
 * Reads only an explicit merchant/processing-country signal. Delivery country
 * is intentionally excluded because it is not Google Pay's transaction country.
 */
export const explicitMerchantCountryFromCheckout = (checkout: UcpCheckout) => {
  const context = asRecord((checkout as unknown as Record<string, unknown>).context)
  const signals = asRecord((checkout as unknown as Record<string, unknown>).signals)
  return isoCountryCode(context.merchant_country) ??
    isoCountryCode(context.merchantCountry) ??
    isoCountryCode(signals.merchant_country) ??
    isoCountryCode(signals.merchantCountry)
}
