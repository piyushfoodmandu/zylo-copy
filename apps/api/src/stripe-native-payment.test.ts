import { describe, expect, it, vi } from 'vitest'
import {
  UCP_STABLE_VERSION,
  type UcpCheckout,
  type UcpPaymentHandlerDeclaration
} from '@arro/contracts'
import type { TokenizerCredentialResolver } from './payment-result-exchange.ts'
import {
  createHttpStripeNativePaymentSessionClient,
  StripeNativePaymentError
} from './stripe-native-payment.ts'
import type { UcpPaymentActionRecord } from './ucp-checkout-store.ts'

const sessionUrl = 'https://merchant.example/ucp/payment-handlers/stripe/native-session'
const handlerName = 'com.merchant.stripe_processor_tokenizer'
const handlerId = 'merchant_stripe_processor_1'
const handlerSpecification = 'https://merchant.example/ucp/handlers/stripe'
const handlerSchema = 'https://merchant.example/ucp/handlers/stripe/schema.json'

const checkout: UcpCheckout = {
  ucp: {
    version: UCP_STABLE_VERSION,
    status: 'success'
  },
  id: 'checkout_live_stripe_1',
  status: 'ready_for_complete',
  currency: 'USD',
  line_items: [],
  totals: [{ type: 'total', amount: 1495, currency: 'USD' }],
  links: []
}

const action: UcpPaymentActionRecord = {
  actionId: 'arro_pa_live_stripe_1',
  transactionId: 'ucptx_live_stripe_1',
  integrationId: 'first-party:arro-shopper',
  merchantOrigin: 'https://merchant.example',
  checkoutId: checkout.id,
  checkoutSnapshotHash: `sha256:${'a'.repeat(64)}`,
  handlerId,
  handlerName,
  handlerVersion: UCP_STABLE_VERSION,
  handlerSpecification,
  handlerSchema,
  provider: handlerName,
  route: 'processor_tokenizer',
  presentation: 'host_native',
  actionType: 'processor_tokenizer',
  status: 'pending_user_approval',
  amount: 1495,
  currency: 'USD',
  tokenNonceHash: `sha256:${'b'.repeat(64)}`,
  actionPayload: {
    kind: 'stripe_payment_sheet',
    presentation: 'host_native'
  },
  expiresAt: '2099-01-02T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z'
}

const declaration = (
  overrides: Record<string, unknown> = {}
): UcpPaymentHandlerDeclaration => ({
  id: handlerId,
  version: UCP_STABLE_VERSION,
  spec: handlerSpecification,
  schema: handlerSchema,
  available_instruments: [{ type: 'card' }],
  config: {
    environment: 'PRODUCTION',
    gateway: 'stripe',
    credential_type: 'stripe_payment_intent',
    merchant_info: {
      account_reference: 'merchant-owned-stripe-account'
    },
    endpoints: {
      native_session: sessionUrl
    },
    ...overrides
  }
})

const liveSession = (overrides: Record<string, unknown> = {}) => ({
  provider: 'stripe',
  livemode: true,
  publishable_key: 'pk_live_merchant_publishable_123',
  payment_intent_client_secret: 'pi_live_checkout_123_secret_checkout_456',
  payment_intent_id: 'pi_live_checkout_123',
  stripe_account_id: 'acct_merchant_123',
  merchant_display_name: 'Merchant Example',
  merchant_country_code: 'US',
  currency: 'USD',
  amount: 1495,
  capture_method: 'manual',
  payment_method_types: ['card'],
  expires_at: '2099-01-01T00:00:00.000Z',
  ...overrides
})

describe('merchant-owned Stripe native payment sessions', () => {
  it('binds an authenticated live manual-capture session to the exact action and checkout', async () => {
    const resolve = vi.fn<TokenizerCredentialResolver['resolve']>(async () => ({
      headers: {
        Authorization: 'Bearer merchant-runtime-secret',
        'Stripe-Account': 'acct_merchant_123'
      }
    }))
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(sessionUrl)
      expect(init?.method).toBe('POST')
      expect(init?.redirect).toBe('manual')
      const headers = new Headers(init?.headers)
      expect(headers.get('accept')).toBe('application/json')
      expect(headers.get('content-type')).toBe('application/json')
      expect(headers.get('cache-control')).toBe('no-store')
      expect(headers.get('idempotency-key')).toBe(`${action.actionId}:stripe-session`)
      expect(headers.get('authorization')).toBe('Bearer merchant-runtime-secret')
      expect(headers.get('stripe-account')).toBe('acct_merchant_123')
      expect(JSON.parse(String(init?.body))).toEqual({
        provider: 'stripe',
        environment: 'PRODUCTION',
        binding: {
          type: 'dev.ucp.shopping.checkout',
          id: checkout.id,
          snapshot_hash: action.checkoutSnapshotHash,
          action_id: action.actionId,
          merchant_origin: action.merchantOrigin
        },
        amount: 1495,
        currency: 'USD',
        capture_method: 'manual',
        payment_method_types: ['card'],
        allowed_card_brands: ['visa', 'mastercard'],
        expires_at: action.expiresAt,
        return_url: 'arro://checkout',
        merchant: {
          account_reference: 'merchant-owned-stripe-account'
        }
      })
      return Response.json(liveSession())
    }) as typeof fetch

    const client = createHttpStripeNativePaymentSessionClient({
      fetch: fetcher,
      credentialResolver: { resolve }
    })

    await expect(client.create({ action, checkout, declaration: declaration() })).resolves.toEqual({
      provider: 'stripe',
      livemode: true,
      publishableKey: 'pk_live_merchant_publishable_123',
      paymentIntentClientSecret: 'pi_live_checkout_123_secret_checkout_456',
      paymentIntentId: 'pi_live_checkout_123',
      stripeAccountId: 'acct_merchant_123',
      merchantDisplayName: 'Merchant Example',
      merchantCountryCode: 'US',
      currency: 'USD',
      amount: 1495,
      captureMethod: 'manual',
      paymentMethodTypes: ['card'],
      allowedCardBrands: ['visa', 'mastercard'],
      expiresAt: '2099-01-01T00:00:00.000Z'
    })
    expect(resolve).toHaveBeenCalledWith({
      merchantOrigin: action.merchantOrigin,
      provider: handlerName,
      handlerName,
      handlerId,
      declarationId: handlerId,
      declarationVersion: UCP_STABLE_VERSION,
      handlerSpecification,
      handlerSchema,
      tokenizeEndpoint: sessionUrl,
      environment: 'PRODUCTION'
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['provider', { provider: 'another-processor' }],
    ['amount', { amount: 1496 }],
    ['currency', { currency: 'EUR' }],
    ['capture method', { capture_method: 'automatic' }],
    ['livemode', { livemode: false, publishable_key: 'pk_test_merchant_123' }]
  ])('rejects a response with mismatched %s', async (_field, responseOverrides) => {
    const fetcher = vi.fn(async () => Response.json(liveSession(responseOverrides))) as typeof fetch
    const client = createHttpStripeNativePaymentSessionClient({
      fetch: fetcher,
      credentialResolver: {
        async resolve() { return { headers: { Authorization: 'Bearer runtime-secret' } } }
      }
    })

    await expect(client.create({ action, checkout, declaration: declaration() })).rejects.toMatchObject({
      name: 'StripeNativePaymentError',
      code: 'stripe_native_session_invalid'
    } satisfies Partial<StripeNativePaymentError>)
  })

  it('rejects a TEST handler before resolving credentials or calling the merchant', async () => {
    const resolve = vi.fn<TokenizerCredentialResolver['resolve']>()
    const fetcher = vi.fn() as unknown as typeof fetch
    const client = createHttpStripeNativePaymentSessionClient({
      fetch: fetcher,
      credentialResolver: { resolve }
    })

    await expect(client.create({
      action,
      checkout,
      declaration: declaration({ environment: 'TEST' })
    })).rejects.toMatchObject({
      name: 'StripeNativePaymentError',
      code: 'stripe_native_handler_invalid'
    } satisfies Partial<StripeNativePaymentError>)
    expect(resolve).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
