import { describe, expect, it } from 'vitest'
import {
  GooglePayWebConfigError,
  normalizeGooglePayUcpConfig
} from './google-pay-web.ts'

const config = () => ({
  api_version: 2,
  api_version_minor: 0,
  environment: 'TEST',
  merchant_info: {
    merchant_id: '01234567890123456789',
    merchant_name: 'Reference Merchant',
    merchant_origin: 'merchant.example'
  },
  allowed_payment_methods: [{
    type: 'CARD',
    parameters: {
      allowed_auth_methods: ['PAN_ONLY'],
      allowed_card_networks: ['VISA', 'MASTERCARD'],
      billing_address_required: true,
      billing_address_parameters: {
        format: 'FULL',
        phone_number_required: false
      }
    },
    tokenization_specification: {
      type: 'PAYMENT_GATEWAY',
      parameters: {
        gateway: 'example',
        gatewayMerchantId: 'reference-merchant'
      }
    }
  }]
})

describe('Google Pay UCP 2026-01-23 configuration', () => {
  it('maps an exact handler configuration to the Google Pay request shape', () => {
    expect(normalizeGooglePayUcpConfig({
      config: config(),
      merchantOrigin: 'https://merchant.example',
      expectedEnvironment: 'TEST'
    })).toMatchObject({
      apiVersion: 2,
      apiVersionMinor: 0,
      environment: 'TEST',
      merchantInfo: {
        merchantId: '01234567890123456789',
        merchantName: 'Reference Merchant'
      },
      allowedPaymentMethods: [{
        parameters: {
          allowedAuthMethods: ['PAN_ONLY'],
          allowedCardNetworks: ['VISA', 'MASTERCARD'],
          billingAddressParameters: {
            format: 'FULL',
            phoneNumberRequired: false
          }
        }
      }]
    })
  })

  it.each([
    ['an auth method not defined by this handler', (value: ReturnType<typeof config>) => {
      value.allowed_payment_methods[0]!.parameters.allowed_auth_methods = ['CRYPTOGRAM_3DS']
    }],
    ['an unknown card network', (value: ReturnType<typeof config>) => {
      value.allowed_payment_methods[0]!.parameters.allowed_card_networks = ['NOT_A_NETWORK']
    }],
    ['a URL instead of the schema-defined merchant hostname', (value: ReturnType<typeof config>) => {
      value.merchant_info.merchant_origin = 'https://merchant.example'
    }],
    ['an unknown card parameter', (value: ReturnType<typeof config>) => {
      Object.assign(value.allowed_payment_methods[0]!.parameters, { invented_option: true })
    }],
    ['an invalid billing address format', (value: ReturnType<typeof config>) => {
      value.allowed_payment_methods[0]!.parameters.billing_address_parameters.format = 'EVERYTHING'
    }]
  ])('rejects %s', (_label, mutate) => {
    const value = config()
    mutate(value)
    expect(() => normalizeGooglePayUcpConfig({
      config: value,
      merchantOrigin: 'https://merchant.example',
      expectedEnvironment: 'TEST'
    })).toThrow(GooglePayWebConfigError)
  })
})
