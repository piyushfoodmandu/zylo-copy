import { TypeCompiler } from '@sinclair/typebox/compiler'
import { describe, expect, it } from 'vitest'
import {
  MoneySchema,
  currencyFractionDigits,
  formatMoney,
  formatMoneyParts,
  moneyDecimalStringToMinor,
  moneyFormatterCacheSize,
  moneyFromDecimalString,
  moneyMinorToDecimalString
} from './money.ts'

const moneyValidator = TypeCompiler.Compile(MoneySchema)

describe('money contract and presentation', () => {
  it('accepts only canonical safe integer minor-unit money', () => {
    expect(moneyValidator.Check({ amountMinor: 0, currency: 'USD' })).toBe(true)
    expect(moneyValidator.Check({ amountMinor: Number.MAX_SAFE_INTEGER, currency: 'USD' })).toBe(true)
    expect(moneyValidator.Check({ amountMinor: Number.MAX_SAFE_INTEGER + 1, currency: 'USD' })).toBe(false)
    expect(moneyValidator.Check({ amountMinor: 1.5, currency: 'USD' })).toBe(false)
    expect(moneyValidator.Check({ amountMinor: -1, currency: 'USD' })).toBe(false)
    expect(moneyValidator.Check({ amount: 9.99, currency: 'USD' })).toBe(false)
    expect(moneyValidator.Check({ amountMinor: 999, amount: 9.99, currency: 'USD' })).toBe(false)
    expect(moneyValidator.Check({ amountMinor: 999, currency: 'usd' })).toBe(false)
  })

  it('parses decimal strings without assuming every currency has two fraction digits', () => {
    expect(moneyFromDecimalString({ amount: '30.95', currency: 'eur' })).toEqual({
      amountMinor: 3095,
      currency: 'EUR'
    })
    expect(moneyFromDecimalString({ amount: '999', currency: 'JPY' })).toEqual({
      amountMinor: 999,
      currency: 'JPY'
    })
    expect(moneyFromDecimalString({ amount: '3.456', currency: 'KWD' })).toEqual({
      amountMinor: 3456,
      currency: 'KWD'
    })
    expect(moneyDecimalStringToMinor({ amount: '30.955', currency: 'EUR' })).toBeUndefined()
    expect(moneyDecimalStringToMinor({ amount: '999.1', currency: 'JPY' })).toBeUndefined()
  })

  it('serializes safe minor units to exact currency-aware decimal strings', () => {
    expect(moneyMinorToDecimalString({ amountMinor: 3095, currency: 'EUR' })).toBe('30.95')
    expect(moneyMinorToDecimalString({ amountMinor: 999, currency: 'JPY' })).toBe('999')
    expect(moneyMinorToDecimalString({ amountMinor: 3456, currency: 'KWD' })).toBe('3.456')
    expect(moneyMinorToDecimalString({ amountMinor: 5, currency: 'USD' })).toBe('0.05')
    expect(moneyMinorToDecimalString({ amountMinor: -1, currency: 'USD' })).toBeUndefined()
    expect(moneyMinorToDecimalString({ amountMinor: 1.5, currency: 'USD' })).toBeUndefined()
    expect(moneyMinorToDecimalString({ amountMinor: Number.MAX_SAFE_INTEGER + 1, currency: 'USD' })).toBeUndefined()
  })

  it('formats shopper-facing values through Intl.NumberFormat only', () => {
    expect(currencyFractionDigits('USD', 'en-US')).toBe(2)
    expect(currencyFractionDigits('JPY', 'ja-JP')).toBe(0)
    expect(currencyFractionDigits('KWD', 'en-US')).toBe(3)
    expect(formatMoney({ amountMinor: 3095, currency: 'EUR' }, 'de-DE')).toBe('30,95\u00a0\u20ac')
    expect(formatMoney({ amountMinor: 999, currency: 'JPY' }, 'ja-JP')).toBe('\uffe5999')
    expect(formatMoney({ amountMinor: 3456, currency: 'KWD' }, 'en-US')).toBe('KWD\u00a03.456')
    expect(formatMoney({ amountMinor: 0, currency: 'USD' }, 'en-US')).toBe('$0.00')
    expect(formatMoney({ amountMinor: -123, currency: 'USD' }, 'en-US')).toBe('-$1.23')
  })

  it('returns structured Intl parts without changing authority values', () => {
    const money = { amountMinor: 12345, currency: 'USD' }
    const before = { ...money }
    const parts = formatMoneyParts(money, 'en-US')
    expect(parts?.some((part) => part.type === 'currency' && part.value === '$')).toBe(true)
    expect(money).toEqual(before)
  })

  it('falls back for unsupported locale and bounds formatter cache growth', () => {
    expect(formatMoney({ amountMinor: 123, currency: 'USD' }, 'bad-locale')).toContain('$1.23')
    for (let index = 0; index < 256; index += 1) {
      formatMoney({ amountMinor: index, currency: index % 2 === 0 ? 'USD' : 'EUR' }, `en-US-x-${index}`)
    }
    expect(moneyFormatterCacheSize()).toBeLessThanOrEqual(128)
  })
})
