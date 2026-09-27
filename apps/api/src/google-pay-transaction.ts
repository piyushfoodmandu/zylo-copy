import {
  moneyMinorToDecimalString,
  type UcpCheckout
} from '@arro/contracts'
import { explicitMerchantCountryFromCheckout } from './checkout-signals.ts'

export type GooglePayTransactionInfo = {
  totalPriceStatus: 'FINAL'
  totalPrice: string
  currencyCode: string
  countryCode?: string
}

export const googlePayTransactionInfoFromCheckout = (
  checkout: UcpCheckout
): GooglePayTransactionInfo | undefined => {
  const total = checkout.totals.find((entry) => entry.type === 'total')
  if (!total || (total.currency && total.currency !== checkout.currency)) return undefined
  const totalPrice = moneyMinorToDecimalString({
    amountMinor: total.amount,
    currency: checkout.currency
  })
  if (!totalPrice) return undefined
  const countryCode = explicitMerchantCountryFromCheckout(checkout)
  return {
    totalPriceStatus: 'FINAL',
    totalPrice,
    currencyCode: checkout.currency,
    ...(countryCode ? { countryCode } : {})
  }
}
