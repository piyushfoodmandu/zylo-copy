import { describe, expect, it, vi } from 'vitest'
import {
  UCP_STABLE_VERSION,
  type PortablePaymentCapability,
  type UcpCheckout,
  type UcpPaymentHandlerDeclaration
} from '@arro/contracts'
import {
  PortablePaymentError,
  createHttpPortablePaymentChallengeClient,
  exchangePortablePaymentResult,
  mppProtocolVersion,
  x402ProtocolVersion,
  arroCheckoutBindingExtension
} from './portable-payment.ts'
import { jcsCanonicalize } from './ap2-mandate.ts'

const checkout: UcpCheckout = {
  ucp: { version: UCP_STABLE_VERSION, status: 'success' },
  id: 'checkout_open_1',
  status: 'ready_for_complete',
  currency: 'USD',
  line_items: [{
    id: 'line_1',
    item: { id: 'sku_1', title: 'Product' },
    quantity: 1,
    totals: [{ type: 'total', amount: 1500, currency: 'USD' }]
  }],
  totals: [{ type: 'total', amount: 1500, currency: 'USD' }]
}

const snapshot = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const merchantOrigin = 'https://merchant.example'
const binding = {
  merchant_origin: merchantOrigin,
  checkout_id: checkout.id,
  checkout_snapshot_hash: snapshot,
  amount: 1500,
  currency: 'USD'
}

const x402Requirement = {
  scheme: 'exact',
  network: 'eip155:8453',
  amount: '1500000',
  asset: '0xUSDC',
  payTo: '0xMerchant',
  maxTimeoutSeconds: 120
}

const x402Required = {
  x402Version: 2,
  resource: { url: 'https://merchant.example/payment-challenges/x402' },
  accepts: [x402Requirement],
  extensions: {
    [arroCheckoutBindingExtension]: {
      info: binding,
      schema: { type: 'object' }
    }
  }
}

const x402Declaration: UcpPaymentHandlerDeclaration = {
  id: 'merchant_x402_1',
  version: '2026-08-25',
  spec: 'https://merchant.example/specs/x402',
  schema: 'https://merchant.example/schemas/x402.json',
  config: {
    protocol_version: x402ProtocolVersion,
    challenge_url: 'https://merchant.example/payment-challenges/x402',
    schemes: ['exact'],
    networks: ['eip155:8453'],
    assets: ['0xUSDC']
  }
}

const x402Capability: PortablePaymentCapability = {
  protocol: 'x402',
  version: x402ProtocolVersion,
  methods: ['exact'],
  networks: ['eip155:8453'],
  assets: ['0xUSDC']
}

const base64url = (value: unknown) => Buffer.from(jcsCanonicalize(value), 'utf8').toString('base64url')

describe('portable payment protocols', () => {
  it('acquires and exchanges an exact x402 v2 merchant challenge', async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 402,
      headers: {
        'PAYMENT-REQUIRED': base64url(x402Required),
        'Cache-Control': 'no-store'
      }
    })) as unknown as typeof fetch
    const challenge = await createHttpPortablePaymentChallengeClient({ fetch: fetcher }).acquire({
      protocol: 'x402',
      declaration: x402Declaration,
      checkout,
      checkoutSnapshotHash: snapshot,
      merchantOrigin,
      capability: x402Capability,
      idempotencyKey: 'portable-x402-action-1'
    })
    const paymentPayload = {
      x402Version: 2 as const,
      resource: x402Required.resource,
      accepted: x402Requirement,
      payload: { signature: '0xsigned', authorization: { nonce: '0xnonce' } },
      extensions: x402Required.extensions
    }
    const exchanged = exchangePortablePaymentResult({
      result: { type: 'x402_payment_payload', paymentPayload },
      actionPayload: {
        kind: 'portable_payment_action',
        protocol: 'x402',
        version: x402ProtocolVersion,
        expiresAt: challenge.expiresAt,
        challenge: challenge.challenge,
        capability: x402Capability
      },
      handlerId: 'merchant_x402_1',
      checkout,
      checkoutSnapshotHash: snapshot,
      merchantOrigin
    })

    expect(exchanged.instrument).toMatchObject({
      handler_id: 'merchant_x402_1',
      type: 'x402',
      credential: {
        type: 'X402_PAYMENT_PAYLOAD_V2',
        reusable: false,
        scope: binding
      }
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('keeps x402 requirement selection inside the capability bound to the signed action', () => {
    const otherRequirement = {
      ...x402Requirement,
      network: 'eip155:1',
      asset: '0xOTHER'
    }
    expect(() => exchangePortablePaymentResult({
      result: {
        type: 'x402_payment_payload',
        paymentPayload: {
          x402Version: 2,
          resource: x402Required.resource,
          accepted: otherRequirement,
          payload: { signature: '0xother' },
          extensions: x402Required.extensions
        }
      },
      actionPayload: {
        kind: 'portable_payment_action',
        protocol: 'x402',
        version: x402ProtocolVersion,
        expiresAt: '2099-07-13T12:00:00.000Z',
        challenge: { ...x402Required, accepts: [x402Requirement, otherRequirement] },
        capability: x402Capability
      },
      handlerId: 'merchant_x402_1',
      checkout,
      checkoutSnapshotHash: snapshot,
      merchantOrigin
    })).toThrowError(/capability bound into the signed action/)
  })

  it('acquires and exchanges an exact MPP Payment credential', async () => {
    const challengeRequest = base64url({
      amount: '1500',
      currency: 'USD',
      arro_checkout: binding
    })
    const challenge = {
      id: 'challenge_1234567890',
      realm: 'merchant.example',
      method: 'tempo',
      intent: 'charge',
      request: challengeRequest,
      expires: '2099-07-13T12:00:00.000Z'
    }
    const header = `Payment id="${challenge.id}", realm="${challenge.realm}", method="${challenge.method}", intent="${challenge.intent}", request="${challenge.request}", expires="${challenge.expires}"`
    const fetcher = vi.fn(async () => new Response(null, {
      status: 402,
      headers: { 'WWW-Authenticate': header, 'Cache-Control': 'no-store' }
    })) as unknown as typeof fetch
    const acquired = await createHttpPortablePaymentChallengeClient({ fetch: fetcher }).acquire({
      protocol: 'mpp',
      declaration: {
        id: 'merchant_mpp_1',
        version: '2026-08-25',
        config: {
          protocol_version: mppProtocolVersion,
          challenge_url: 'https://merchant.example/payment-challenges/mpp',
          methods: ['tempo'],
          intents: ['charge']
        }
      },
      checkout,
      checkoutSnapshotHash: snapshot,
      merchantOrigin,
      capability: { protocol: 'mpp', version: mppProtocolVersion, methods: ['tempo'], intents: ['charge'] },
      idempotencyKey: 'portable-mpp-action-1'
    })
    const authorization = `Payment ${base64url({ challenge, source: 'did:key:test', payload: { proof: 'signed' } })}`
    const exchanged = exchangePortablePaymentResult({
      result: { type: 'mpp_payment_credential', authorization },
      actionPayload: {
        kind: 'portable_payment_action',
        protocol: 'mpp',
        version: mppProtocolVersion,
        expiresAt: acquired.expiresAt,
        challenge: acquired.challenge,
        capability: { protocol: 'mpp', version: mppProtocolVersion, methods: ['tempo'], intents: ['charge'] }
      },
      handlerId: 'merchant_mpp_1',
      checkout,
      checkoutSnapshotHash: snapshot,
      merchantOrigin
    })

    expect(exchanged.instrument).toMatchObject({
      handler_id: 'merchant_mpp_1',
      type: 'mpp',
      credential: {
        type: 'MPP_PAYMENT_CREDENTIAL_DRAFT',
        authorization,
        reusable: false,
        scope: binding
      }
    })
    const requestHeaders = new Headers(fetcher.mock.calls[0]?.[1]?.headers)
    expect(requestHeaders.get('Accept-Payment')).toBe('tempo/charge')
  })

  it('rejects capability mismatch and Checkout mutation', async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 402,
      headers: { 'PAYMENT-REQUIRED': base64url(x402Required), 'Cache-Control': 'no-store' }
    })) as unknown as typeof fetch
    await expect(createHttpPortablePaymentChallengeClient({ fetch: fetcher }).acquire({
      protocol: 'x402',
      declaration: x402Declaration,
      checkout,
      checkoutSnapshotHash: snapshot,
      merchantOrigin,
      capability: { ...x402Capability, networks: ['eip155:1'] },
      idempotencyKey: 'portable-mismatch-1'
    })).rejects.toMatchObject<Partial<PortablePaymentError>>({ code: 'portable_payment_capability_mismatch' })

    expect(() => exchangePortablePaymentResult({
      result: {
        type: 'x402_payment_payload',
        paymentPayload: {
          x402Version: 2,
          resource: x402Required.resource,
          accepted: x402Requirement,
          payload: { signature: '0xsigned' },
          extensions: x402Required.extensions
        }
      },
      actionPayload: {
        kind: 'portable_payment_action',
        protocol: 'x402',
        version: x402ProtocolVersion,
        expiresAt: '2099-07-13T12:00:00.000Z',
        challenge: x402Required,
        capability: x402Capability
      },
      handlerId: 'merchant_x402_1',
      checkout,
      checkoutSnapshotHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      merchantOrigin
    })).toThrowError(/exact current merchant Checkout/)
  })
})
