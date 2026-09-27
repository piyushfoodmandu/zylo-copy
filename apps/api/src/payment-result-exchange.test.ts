import { createSign, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { UCP_STABLE_VERSION, type UcpCheckout, type UcpProfile } from '@arro/contracts'
import {
  createHttpPaymentCredentialProvider,
  createTokenizerCredentialResolver,
  PaymentResultExchangeError,
  exchangePaymentProviderResult,
  parsePaymentHandlerSpecConfig,
  processorTokenizerPaymentHandlersFromSpecConfig
} from './payment-result-exchange.ts'
import { createTrustedHostPaymentVerifier } from './trusted-host-payment.ts'

const version = UCP_STABLE_VERSION
const handlerName = 'com.example.processor_tokenizer'
const handlerId = 'merchant_processor_tokenizer'
const handlerSpec = 'https://example.com/ucp/handlers/com.example.processor_tokenizer'
const handlerSchema = 'https://example.com/ucp/handlers/com.example.processor_tokenizer/schema.json'
const googlePayHandlerName = 'com.google.pay'
const googlePayHandlerId = 'merchant_google_pay'
const googlePaySpec = 'https://pay.google.com/gp/p/ucp/2026-01-23/'
const googlePaySchema = 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json'
const googlePayHandlerConfig = {
  api_version: 2,
  api_version_minor: 0,
  environment: 'TEST',
  merchant_info: {
    merchant_id: '12345678901234567890',
    merchant_name: 'Example Merchant',
    merchant_origin: 'merchant.example'
  },
  allowed_payment_methods: [
    {
      type: 'CARD',
      parameters: {
        allowed_auth_methods: ['PAN_ONLY'],
        allowed_card_networks: ['VISA']
      },
      tokenization_specification: {
        type: 'PAYMENT_GATEWAY',
        parameters: {
          gateway: 'example',
          gatewayMerchantId: 'exampleGatewayMerchantId'
        }
      }
    }
  ]
}
const googlePayPaymentRequest = {
  apiVersion: 2,
  apiVersionMinor: 0,
  environment: 'TEST',
  merchantInfo: {
    merchantId: '12345678901234567890',
    merchantName: 'Example Merchant'
  },
  allowedPaymentMethods: [{
    type: 'CARD',
    parameters: {
      allowedAuthMethods: ['PAN_ONLY'],
      allowedCardNetworks: ['VISA']
    },
    tokenizationSpecification: {
      type: 'PAYMENT_GATEWAY',
      parameters: {
        gateway: 'example',
        gatewayMerchantId: 'exampleGatewayMerchantId'
      }
    }
  }],
  transactionInfo: {
    totalPriceStatus: 'FINAL',
    totalPrice: '0.00',
    currencyCode: 'USD'
  }
}
const handlerSpecs = [
  {
    adapterKind: 'processor_tokenizer' as const,
    handlerName,
    platformHandlerId: 'arro_processor_tokenizer_client',
    versions: [version],
    specification: handlerSpec,
    schema: handlerSchema,
    lifecyclePolicy: {
      rejectReusable: true,
      requiresCheckoutScope: true,
      requiresMerchantOriginScope: true,
      requiresExpiry: true
    }
  }
]
const googlePayHandlerSpecs = [
  ...handlerSpecs,
  {
    adapterKind: 'google_pay' as const,
    handlerName: googlePayHandlerName,
    platformHandlerId: 'arro_google_pay_client',
    versions: ['2026-01-23'],
    specification: googlePaySpec,
    schema: googlePaySchema,
    environment: 'TEST',
    handlerConfig: googlePayHandlerConfig,
    lifecyclePolicy: {
      rejectReusable: true,
      requiresCheckoutScope: true,
      requiresMerchantOriginScope: true,
      requiresExpiry: true
    }
  }
]

const businessProfile: UcpProfile = {
  ucp: {
    version,
    services: {},
    capabilities: {},
    payment_handlers: {
      [handlerName]: [
        {
          id: handlerId,
          version,
          spec: handlerSpec,
          schema: handlerSchema,
          available_instruments: [{ type: 'card' }],
          config: {
            endpoint: 'https://merchant.example/ucp/payment-handlers/com.example.processor_tokenizer/tokenize',
            environment: 'TEST',
            credential_type: 'opaque_reference',
            identity: {
              access_token: 'merchant_001'
            }
          }
        }
      ]
    }
  }
}

const googlePayBusinessProfile: UcpProfile = {
  ucp: {
    ...businessProfile.ucp,
    payment_handlers: {
      [googlePayHandlerName]: [
        {
          id: googlePayHandlerId,
          version: '2026-01-23',
          spec: googlePaySpec,
          schema: googlePaySchema,
          available_instruments: [{ type: 'card' }],
          config: googlePayHandlerConfig
        }
      ]
    }
  }
}

const checkout: UcpCheckout = {
  ucp: {
    version,
    status: 'success'
  },
  id: 'chk_1',
  status: 'ready_for_complete',
  currency: 'USD',
  line_items: [],
  totals: [],
  links: []
}

const base64UrlJson = (value: unknown) =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

const signCompactJws = ({
  privateKey,
  header,
  payload
}: {
  privateKey: ReturnType<typeof generateKeyPairSync>['privateKey']
  header: Record<string, unknown>
  payload: Record<string, unknown>
}) => {
  const protectedHeader = base64UrlJson(header)
  const body = base64UrlJson(payload)
  const signingInput = `${protectedHeader}.${body}`
  const signer = createSign('sha256')
  signer.update(signingInput)
  signer.end()
  return `${signingInput}.${signer.sign(privateKey).toString('base64url')}`
}

describe('exchangePaymentProviderResult', () => {
  it('exchanges a provider result through the handler-declared Processor Tokenizer', async () => {
    const credentialProvider = {
      tokenize: vi.fn().mockResolvedValue({
        id: 'pi_1',
        handler_id: handlerId,
        type: 'card',
        selected: true,
        display: {
          brand: 'visa',
          last_digits: '4242'
        },
        credential: {
          type: 'token',
          token: 'checkout-scoped-token'
        }
      })
    }

    const exchanged = await exchangePaymentProviderResult({
      provider: handlerName,
      expectedHandlerId: handlerId,
      businessProfile,
      checkout,
      merchantOrigin: 'https://merchant.example',
      credentialProvider,
      handlerSpecs,
      result: {
        type: 'processor_tokenizer_result',
        provider: handlerName,
        credentialReference: { reference: 'ptr_opaque_provider_signature_0001', proof: 'proof_opaque_provider_signature_0001' }
      }
    })

    expect(credentialProvider.tokenize).toHaveBeenCalledWith(expect.objectContaining({
      provider: handlerName,
      handlerName,
      handlerId,
      checkout
    }))
    expect(exchanged).toMatchObject({
      provider: handlerName,
      handlerName,
      handlerId,
      instrument: {
        handler_id: handlerId,
        type: 'card',
        selected: true,
        display: {
          brand: 'visa',
          last_digits: '4242'
        },
        credential: {
          type: 'token',
          token: 'checkout-scoped-token'
        }
      }
    })
    expect(exchanged.resultFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('verifies and redeems a trusted host-native attestation through an opaque reference', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const publicJwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>
    publicJwk.kid = 'hermes-test-key-1'
    const paymentActionNonceHash = 'sha256:1111111111111111111111111111111111111111111111111111111111111111'
    const checkoutSnapshotHash = 'sha256:2222222222222222222222222222222222222222222222222222222222222222'
    const capabilityId = `trusted_host:${handlerName}:${handlerId}`
    const nowSeconds = Math.floor(Date.now() / 1000)
    const attestation = signCompactJws({
      privateKey,
      header: {
        alg: 'ES256',
        kid: 'hermes-test-key-1',
        typ: 'JWT'
      },
      payload: {
        iss: 'https://hermes.example',
        aud: 'https://arro.example',
        jti: 'host-native-jti-1',
        iat: nowSeconds,
        exp: nowSeconds + 300,
        host_id: 'hermes-desktop-test',
        integration_id: 'hermes_agent',
        action_id: 'arro_pa_host_native_1',
        transaction_id: 'txn_host_native_1',
        checkout_id: checkout.id,
        checkout_snapshot_hash: checkoutSnapshotHash,
        payment_action_nonce_hash: paymentActionNonceHash,
        merchant_origin: 'https://merchant.example',
        handler_name: handlerName,
        handler_id: handlerId,
        capability_id: capabilityId,
        credential_reference: 'opaque-host-reference-1'
      }
    })
    const redemptionFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        credential_reference: 'opaque-host-reference-1',
        action_id: 'arro_pa_host_native_1',
        checkout_id: checkout.id,
        merchant_origin: 'https://merchant.example',
        handler_name: handlerName,
        handler_id: handlerId
      })
      return Response.json({
        ap2: {
          checkout_mandate: 'trusted-surface-checkout-mandate'
        },
        instrument: {
          id: 'pi_host_1',
          handler_id: handlerId,
          type: 'card',
          selected: true,
          display: {
            brand: 'visa',
            last_digits: '4242'
          },
          credential: {
            type: 'HOST_NATIVE_REFERENCE',
            token: 'checkout-scoped-host-token',
            reusable: false,
            scope: {
              checkout_id: checkout.id,
              merchant_origin: 'https://merchant.example'
            },
            expires_at: '2099-07-11T12:00:00.000Z'
          }
        }
      })
    }) as typeof fetch
    const trustedHostPaymentVerifier = createTrustedHostPaymentVerifier({
      fetch: redemptionFetch,
      configs: [
        {
          hostId: 'hermes-desktop-test',
          integrationId: 'hermes_agent',
          issuer: 'https://hermes.example',
          audience: 'https://arro.example',
          redemptionEndpoint: 'https://hermes.example/arro/payment/redeem',
          jwks: [publicJwk]
        }
      ]
    })

    const exchanged = await exchangePaymentProviderResult({
      provider: handlerName,
      expectedHandlerId: handlerId,
      businessProfile,
      checkout,
      merchantOrigin: 'https://merchant.example',
      result: {
        type: 'trusted_host_attestation',
        attestation
      },
      trustedHostPaymentVerifier,
      trustedHostExpectedBinding: {
        provider: handlerName,
        expectedHandlerId: handlerId,
        merchantOrigin: 'https://merchant.example',
        transactionId: 'txn_host_native_1',
        actionId: 'arro_pa_host_native_1',
        checkoutSnapshotHash,
        capabilityId,
        paymentActionNonceHash,
        checkout
      }
    })

    expect(exchanged).toMatchObject({
      provider: handlerName,
      handlerName,
      handlerId,
      instrument: {
        handler_id: handlerId,
        credential: {
          reusable: false
        }
      },
      ap2CheckoutMandate: 'trusted-surface-checkout-mandate'
    })
    expect(redemptionFetch).toHaveBeenCalledOnce()
    expect(exchanged.resultFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('rejects raw card fields instead of sending them to a tokenizer', async () => {
    await expect(
      exchangePaymentProviderResult({
        provider: 'processor_tokenizer',
        businessProfile,
        checkout,
        merchantOrigin: 'https://merchant.example',
        credentialProvider: {
          tokenize: vi.fn()
        },
        result: {
          type: 'processor_tokenizer_result',
          provider: 'processor_tokenizer',
          credentialReference: { reference: 'ptr_raw_card_probe_0001', proof: 'proof_raw_card_probe_0001', pan: '4111111111111111', cvv: '123' }
        } as never
      })
    ).rejects.toThrow(PaymentResultExchangeError)
  })

  it('rejects reusable tokenizer credentials', async () => {
    await expect(
      exchangePaymentProviderResult({
        provider: handlerName,
        expectedHandlerId: handlerId,
        businessProfile,
        checkout,
        merchantOrigin: 'https://merchant.example',
        handlerSpecs,
        credentialProvider: {
          tokenize: vi.fn().mockResolvedValue({
            id: 'pi_reusable',
            handler_id: handlerId,
            type: 'card',
            credential: {
              type: 'token',
              token: 'vault-reusable-token',
              reusable: true,
              scope: {
                checkout_id: 'chk_1',
                merchant_origin: 'https://merchant.example'
              },
              expires_at: '2099-07-11T12:00:00.000Z'
            }
          })
        },
        result: {
          type: 'processor_tokenizer_result',
          provider: handlerName,
          credentialReference: { reference: 'ptr_opaque_provider_token_0001', proof: 'proof_opaque_provider_token_0001' }
        }
      })
    ).rejects.toMatchObject({
      code: 'payment_result_reusable_token_rejected'
    })
  })

  it('does not fuzzy-match undeclared tokenizer handlers', async () => {
    await expect(
      exchangePaymentProviderResult({
        provider: 'processor_tokenizer',
        businessProfile,
        checkout,
        merchantOrigin: 'https://merchant.example',
        credentialProvider: {
          tokenize: vi.fn()
        },
        result: {
          type: 'processor_tokenizer_result',
          provider: 'processor_tokenizer',
          credentialReference: { reference: 'ptr_opaque_provider_token_0001', proof: 'proof_opaque_provider_token_0001' }
        }
      })
    ).rejects.toMatchObject({
      code: 'payment_result_provider_unsupported'
    })
  })

  it('does not route Google Pay payment data through the generic Processor Tokenizer path', async () => {
    await expect(
      exchangePaymentProviderResult({
        provider: 'com.google.pay',
        businessProfile,
        checkout,
        merchantOrigin: 'https://merchant.example',
        handlerSpecs,
        paymentActionPayload: {
          kind: 'google_pay',
          presentation: 'external_action',
          paymentRequest: googlePayPaymentRequest
        },
        credentialProvider: {
          tokenize: vi.fn()
        },
        result: {
          type: 'google_pay_payment_data',
          source: 'web',
          paymentData: {
            apiVersion: 2,
            apiVersionMinor: 0,
            paymentMethodData: {
              type: 'CARD',
              tokenizationData: {
                type: 'PAYMENT_GATEWAY',
                token: '{"signature":"google-pay-test-signature","protocolVersion":"ECv2","signedMessage":"opaque"}'
              }
            }
          }
        }
      })
    ).rejects.toMatchObject({
      code: 'payment_result_provider_unsupported'
    })
  })

  it('converts native Google Pay paymentData into the exact handler credential shape', async () => {
    const exchanged = await exchangePaymentProviderResult({
      provider: googlePayHandlerName,
      expectedHandlerId: googlePayHandlerId,
      businessProfile: googlePayBusinessProfile,
      checkout,
      merchantOrigin: 'https://merchant.example',
      handlerSpecs: googlePayHandlerSpecs,
      paymentActionPayload: {
        kind: 'google_pay',
        presentation: 'host_native',
        paymentRequest: googlePayPaymentRequest
      },
      result: {
        type: 'google_pay_payment_data',
        source: 'native',
        paymentData: {
          apiVersion: 2,
          apiVersionMinor: 0,
          paymentMethodData: {
            type: 'CARD',
            info: {
              cardNetwork: 'VISA',
              cardDetails: '4242'
            },
            tokenizationData: {
              type: 'PAYMENT_GATEWAY',
              token: '{"signature":"google-pay-test-signature","protocolVersion":"ECv2","signedMessage":"opaque"}'
            }
          }
        }
      }
    })

    expect(exchanged).toMatchObject({
      provider: googlePayHandlerName,
      handlerName: googlePayHandlerName,
      handlerId: googlePayHandlerId,
      instrument: {
        handler_id: googlePayHandlerId,
        type: 'card',
        display: {
          brand: 'VISA',
          last_digits: '4242'
        },
        credential: {
          type: 'PAYMENT_GATEWAY',
          token: '{"signature":"google-pay-test-signature","protocolVersion":"ECv2","signedMessage":"opaque"}'
        }
      }
    })
    expect(exchanged.instrument).not.toHaveProperty('selected')
    expect(Object.keys(exchanged.instrument.credential ?? {})).toEqual(['type', 'token'])
    expect(exchanged.resultFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('rejects Google Pay results whose source does not match the signed presentation', async () => {
    await expect(exchangePaymentProviderResult({
      provider: googlePayHandlerName,
      expectedHandlerId: googlePayHandlerId,
      businessProfile: googlePayBusinessProfile,
      checkout,
      merchantOrigin: 'https://merchant.example',
      handlerSpecs: googlePayHandlerSpecs,
      paymentActionPayload: {
        kind: 'google_pay',
        presentation: 'external_action'
      },
      result: {
        type: 'google_pay_payment_data',
        source: 'native',
        paymentData: {
          apiVersion: 2,
          apiVersionMinor: 0,
          paymentMethodData: {
            type: 'CARD',
            tokenizationData: {
              type: 'PAYMENT_GATEWAY',
              token: '{"signature":"google-pay-test-signature","protocolVersion":"ECv2","signedMessage":"opaque"}'
            }
          }
        }
      }
    })).rejects.toMatchObject({
      code: 'payment_result_scope_invalid'
    })
  })

  it('rejects a custom Processor Tokenizer provider that returns a non-token credential', async () => {
    await expect(
      exchangePaymentProviderResult({
        provider: handlerName,
        expectedHandlerId: handlerId,
        businessProfile,
        checkout,
        merchantOrigin: 'https://merchant.example',
        handlerSpecs,
        credentialProvider: {
          tokenize: vi.fn().mockResolvedValue({
            handler_id: handlerId,
            type: 'card',
            credential: {
              type: 'legacy_processor_token',
              token: 'checkout-scoped-token'
            }
          })
        },
        result: {
          type: 'processor_tokenizer_result',
          provider: handlerName,
          credentialReference: { reference: 'ptr_opaque_provider_token_0001', proof: 'proof_opaque_provider_token_0001' }
        }
      })
    ).rejects.toMatchObject({
      code: 'payment_result_instrument_invalid'
    })
  })

  it('sends authenticated checkout and identity binding to the Processor Tokenizer endpoint', async () => {
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tokenizer-auth')
      expect(JSON.parse(String(init?.body))).toEqual({
        credential: {
          type: 'opaque_reference',
          reference: 'provider-reference'
        },
        binding: {
          type: 'dev.ucp.shopping.checkout',
          id: 'chk_1',
          merchant_origin: 'https://merchant.example',
          snapshot_hash: `sha256:${'c'.repeat(64)}`,
          action_id: 'arro_pa_tokenizer_1'
        },
        identity: {
          access_token: 'merchant_001'
        }
      })
      return Response.json({
        token: 'checkout-scoped-token'
      })
    }) as typeof fetch
    const provider = createHttpPaymentCredentialProvider({
      fetch: fetcher,
      credentialResolver: createTokenizerCredentialResolver([
        {
          merchantOrigin: 'https://merchant.example',
          provider: handlerName,
          handlerId,
          tokenizeEndpoint: 'https://merchant.example/ucp/payment-handlers/com.example.processor_tokenizer/tokenize',
          environment: 'TEST',
          bearerToken: 'tokenizer-auth'
        }
      ])
    })

    await expect(provider.tokenize({
      provider: handlerName,
      handlerName,
      handlerId,
      handlerSpecification: handlerSpec,
      handlerSchema,
      declaration: businessProfile.ucp.payment_handlers![handlerName]![0]!,
      result: { reference: 'provider-reference' },
      checkout,
      businessProfile,
      merchantOrigin: 'https://merchant.example',
      checkoutSnapshotHash: `sha256:${'c'.repeat(64)}`,
      paymentActionId: 'arro_pa_tokenizer_1'
    })).resolves.toMatchObject({
      credential: {
        type: 'token',
        token: 'checkout-scoped-token'
      }
    })
  })

  it('executes a merchant-owned Stripe-backed Processor Tokenizer reference path', async () => {
    const stripeHandlerName = 'com.merchant.stripe_processor_tokenizer'
    const stripeHandlerId = 'merchant_stripe_tokenizer_1'
    const stripeHandlerSpec = 'https://merchant.example/ucp/handlers/com.merchant.stripe_processor_tokenizer'
    const stripeHandlerSchema = 'https://merchant.example/ucp/handlers/com.merchant.stripe_processor_tokenizer/schema.json'
    const stripeTokenizeUrl = 'https://merchant.example/ucp/payment-handlers/stripe/tokenize'
    const stripeBusinessProfile: UcpProfile = {
      ucp: {
        ...businessProfile.ucp,
        payment_handlers: {
          [stripeHandlerName]: [
            {
              id: stripeHandlerId,
              version,
              spec: stripeHandlerSpec,
              schema: stripeHandlerSchema,
              available_instruments: [{ type: 'card' }],
              config: {
                environment: 'TEST',
                gateway: 'stripe',
                endpoint: stripeTokenizeUrl,
                credential_type: 'stripe_payment_method_reference',
                identity: {
                  access_token: 'acct_reference_merchant'
                }
              }
            }
          ]
        }
      }
    }
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(headers.get('authorization')).toBe('Bearer merchant-stripe-tokenizer-secret')
      expect(headers.get('stripe-account')).toBe('acct_reference_merchant')
      expect(JSON.parse(String(init?.body))).toEqual({
        credential: {
          type: 'stripe_payment_method_reference',
          proof: 'merchant_source_credential_proof',
          reference: 'src_merchant_owned_stripe_payment_method_reference'
        },
        binding: {
          type: 'dev.ucp.shopping.checkout',
          id: checkout.id,
          merchant_origin: 'https://merchant.example'
        },
        identity: {
          access_token: 'acct_reference_merchant'
        }
      })
      return Response.json({
        token: 'pm_test_checkout_scoped_opaque_reference'
      })
    }) as typeof fetch
    const provider = createHttpPaymentCredentialProvider({
      fetch: fetcher,
      credentialResolver: createTokenizerCredentialResolver([
        {
          merchantOrigin: 'https://merchant.example',
          provider: stripeHandlerName,
          handlerId: stripeHandlerId,
          tokenizeEndpoint: stripeTokenizeUrl,
          environment: 'TEST',
          headers: {
            Authorization: 'Bearer merchant-stripe-tokenizer-secret',
            'Stripe-Account': 'acct_reference_merchant'
          }
        }
      ])
    })

    await expect(provider.tokenize({
      provider: stripeHandlerName,
      handlerName: stripeHandlerName,
      handlerId: stripeHandlerId,
      handlerSpecification: stripeHandlerSpec,
      handlerSchema: stripeHandlerSchema,
      declaration: stripeBusinessProfile.ucp.payment_handlers![stripeHandlerName]![0]!,
      result: {
        reference: 'src_merchant_owned_stripe_payment_method_reference',
        proof: 'merchant_source_credential_proof'
      },
      checkout,
      businessProfile: stripeBusinessProfile,
      merchantOrigin: 'https://merchant.example'
    })).resolves.toMatchObject({
      handler_id: stripeHandlerId,
      type: 'card',
      credential: {
        type: 'token',
        token: 'pm_test_checkout_scoped_opaque_reference'
      }
    })
  })

  it('rejects ambiguous same-name handler declarations without the selected merchant instance id', async () => {
    const ambiguousProfile: UcpProfile = {
      ucp: {
        ...businessProfile.ucp,
        payment_handlers: {
          [handlerName]: [
            businessProfile.ucp.payment_handlers![handlerName]![0]!,
            {
              ...businessProfile.ucp.payment_handlers![handlerName]![0]!,
              id: 'merchant_processor_tokenizer_alt'
            }
          ]
        }
      }
    }

    await expect(exchangePaymentProviderResult({
      provider: handlerName,
      businessProfile: ambiguousProfile,
      checkout,
      merchantOrigin: 'https://merchant.example',
      handlerSpecs,
      credentialProvider: {
        tokenize: vi.fn()
      },
      result: {
        type: 'processor_tokenizer_result',
        provider: handlerName,
        credentialReference: { reference: 'ptr_opaque_provider_token_0001', proof: 'proof_opaque_provider_token_0001' }
      }
    })).rejects.toMatchObject({
      code: 'payment_result_provider_unsupported'
    })
  })

  it('requires explicit adapter kind and refuses operator-relaxed direct-payment safety', () => {
    expect(() => parsePaymentHandlerSpecConfig([
      {
        handlerName,
        platformHandlerId: 'arro_processor_tokenizer_client',
        specification: handlerSpec,
        schema: handlerSchema
      }
    ])).toThrow('adapterKind')

    expect(() => parsePaymentHandlerSpecConfig([
      {
        adapterKind: 'processor_tokenizer',
        handlerName,
        platformHandlerId: 'arro_processor_tokenizer_client',
        versions: [version],
        specification: handlerSpec,
        schema: handlerSchema,
        lifecyclePolicy: {
          requiresExpiry: false
        }
      }
    ])).toThrow('non-relaxable')
  })

  it('requires explicit handler versions and accepts only v2026-08-25 Constraint Expressions', () => {
    expect(() => parsePaymentHandlerSpecConfig([{
      adapterKind: 'processor_tokenizer',
      handlerName,
      platformHandlerId: 'arro_processor_tokenizer_client',
      specification: handlerSpec,
      schema: handlerSchema
    }])).toThrow('must declare explicit handler versions')

    const [handler] = parsePaymentHandlerSpecConfig([{
      adapterKind: 'processor_tokenizer',
      handlerName,
      platformHandlerId: 'arro_processor_tokenizer_client',
      versions: [version],
      specification: handlerSpec,
      schema: handlerSchema,
      availableInstruments: [{
        type: 'card',
        constraints: {
          properties: {
            brand: { enum: ['visa', 'mastercard'] }
          }
        }
      }]
    }])
    expect(handler?.availableInstruments?.[0]?.constraints).toEqual({
      properties: {
        brand: { enum: ['visa', 'mastercard'] }
      }
    })

    expect(() => parsePaymentHandlerSpecConfig([{
      adapterKind: 'processor_tokenizer',
      handlerName,
      platformHandlerId: 'arro_processor_tokenizer_client',
      versions: [version],
      specification: handlerSpec,
      schema: handlerSchema,
      availableInstruments: [{
        type: 'card',
        constraints: { brands: ['visa'] }
      }]
    }])).toThrow('Constraint Expression shape')
  })

  it('normalizes explicit payment Action origins and rejects path-based allowlists', () => {
    const [handler] = parsePaymentHandlerSpecConfig([{
      adapterKind: 'processor_tokenizer',
      handlerName,
      platformHandlerId: 'arro_processor_tokenizer_client',
      versions: [version],
      specification: handlerSpec,
      schema: handlerSchema,
      actionOrigins: ['https://acs.example', 'https://acs.example/']
    }])

    expect(handler?.actionOrigins).toEqual(['https://acs.example'])
    expect(() => parsePaymentHandlerSpecConfig([{
      adapterKind: 'processor_tokenizer',
      handlerName,
      platformHandlerId: 'arro_processor_tokenizer_client',
      versions: [version],
      specification: handlerSpec,
      schema: handlerSchema,
      actionOrigins: ['https://acs.example/challenge']
    }])).toThrow('must contain only an origin')

    expect(() => parsePaymentHandlerSpecConfig([{
      adapterKind: 'processor_tokenizer',
      handlerName,
      platformHandlerId: 'arro_processor_tokenizer_client',
      versions: [version],
      specification: handlerSpec,
      schema: handlerSchema,
      actionOrigins: Array.from({ length: 33 }, (_, index) => `https://acs-${index}.example`)
    }])).toThrow('at most 32')
  })

  it('does not publish non-tokenizer handler definitions as Processor Tokenizer capabilities', () => {
    const handlers = processorTokenizerPaymentHandlersFromSpecConfig(parsePaymentHandlerSpecConfig([
      {
        adapterKind: 'processor_tokenizer',
        handlerName,
        platformHandlerId: 'arro_processor_tokenizer_client',
        versions: [version],
        specification: handlerSpec,
        schema: handlerSchema
      },
      {
        adapterKind: 'google_pay',
        handlerName: 'com.google.pay',
        platformHandlerId: 'arro_google_pay_client',
        versions: ['2026-01-23'],
        specification: 'https://pay.google.com/gp/p/ucp/2026-01-23/',
        schema: 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json',
        environment: 'TEST',
        handlerConfig: {
          api_version: 2,
          api_version_minor: 0,
          environment: 'TEST',
          merchant_info: {
            merchant_id: '12345678901234567890',
            merchant_name: 'Example Merchant',
            merchant_origin: 'merchant.example'
          },
          allowed_payment_methods: [{
            type: 'CARD',
            parameters: {
              allowed_auth_methods: ['PAN_ONLY'],
              allowed_card_networks: ['VISA']
            },
            tokenization_specification: {
              type: 'PAYMENT_GATEWAY',
              parameters: { gateway: 'example' }
            }
          }]
        }
      }
    ]))

    expect(Object.keys(handlers)).toEqual([handlerName])
    expect(handlers).not.toHaveProperty('com.google.pay')
  })
})
