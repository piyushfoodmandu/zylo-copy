import { createSign, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  UCP_STABLE_VERSION,
  type UcpCart,
  type UcpCheckout,
  type UcpPaymentInstrument,
  type UcpProfile
} from '@arro/contracts'
import {
  createGooglePayPaymentHandlerAdapter,
  createPaymentHandlerRegistry,
  UcpProtocolError,
  type UcpClient,
  type UcpNegotiation
} from '@arro/ucp-client'
import type { CommercePrincipal } from './commerce-principal.ts'
import {
  ucpCheckoutSnapshotHash,
  type UcpCheckoutSessionRecord,
  type UcpCheckoutStore,
  type UcpPaymentActionRecord,
  type UcpPaymentResultRecord
} from './ucp-checkout-store.ts'
import { createUcpCheckoutService } from './ucp-checkout-service.ts'
import { createMemoryPaymentCredentialVault } from './payment-credential-vault.ts'
import {
  paymentActionNonceHash,
  signPaymentActionToken,
  type PaymentActionTokenPayload
} from './payment-actions.ts'
import { createTrustedHostPaymentVerifier } from './trusted-host-payment.ts'
import { UCP_AP2_MANDATE_CAPABILITY } from './platform-profile.ts'

const version = UCP_STABLE_VERSION
const handlerName = 'com.example.processor_tokenizer'
const handlerId = 'merchant_processor_tokenizer'
const handlerSpec = 'https://example.com/ucp/handlers/com.example.processor_tokenizer'
const handlerSchema = 'https://example.com/ucp/handlers/com.example.processor_tokenizer/schema.json'
const googlePayHandlerName = 'com.google.pay'
const googlePayHandlerId = 'merchant_google_pay'
const googlePaySpec = 'https://pay.google.com/gp/p/ucp/2026-01-23/'
const googlePaySchema = 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json'
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
const googlePayHandlerSpecs = [
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
    services: {
      'dev.ucp.shopping': [
        {
          version,
          transport: 'rest',
          endpoint: 'https://merchant.example/ucp'
        }
      ]
    },
    capabilities: {
      'dev.ucp.shopping.cart': [{ version }],
      'dev.ucp.shopping.checkout': [{ version }]
    },
    payment_handlers: {
      [handlerName]: [
        {
          id: handlerId,
          version,
          spec: handlerSpec,
          schema: handlerSchema,
          available_instruments: [{ type: 'card' }],
          config: {
            environment: 'TEST',
            endpoint: 'https://merchant.example/ucp/payment-handlers/com.example.processor_tokenizer/tokenize',
            credential_type: 'opaque_reference'
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

const platformProfile: UcpProfile = {
  ucp: {
    version,
    services: {
      'dev.ucp.shopping': [
        {
          version,
          transport: 'rest',
          endpoint: 'https://arro.example/ucp'
        }
      ]
    },
    capabilities: {
      'dev.ucp.shopping.cart': [{ version }],
      'dev.ucp.shopping.checkout': [{ version }]
    }
  }
}

const negotiation: UcpNegotiation = {
  version,
  transport: 'rest',
  serviceNamespace: 'dev.ucp.shopping',
  service: {
    version,
    transport: 'rest',
    endpoint: 'https://merchant.example/ucp'
  },
  endpoint: 'https://merchant.example/ucp',
  capabilities: {
    'dev.ucp.shopping.cart': [{ version }],
    'dev.ucp.shopping.checkout': [{ version }]
  },
  paymentHandlers: {},
  businessProfile
}

const negotiationFor = (profile: UcpProfile): UcpNegotiation => ({
  ...negotiation,
  paymentHandlers: profile.ucp.payment_handlers ?? {},
  businessProfile: profile
})

const cart: UcpCart = {
  ucp: {
    version,
    status: 'success'
  },
  id: 'cart_1',
  status: 'active',
  currency: 'USD',
  continue_url: 'https://merchant.example/cart/cart_1',
  line_items: [
    {
      id: 'cart_line_1',
      item: { id: 'sku_65w_charger', title: '65W USB-C Charger' },
      quantity: 1
    }
  ],
  totals: [],
  links: []
}

const checkout: UcpCheckout = {
  ucp: {
    version,
    status: 'success'
  },
  id: 'chk_1',
  status: 'ready_for_complete',
  currency: 'USD',
  continue_url: 'https://merchant.example/checkout/chk_1',
  line_items: [
    {
      id: 'line_1',
      item: { id: 'sku_65w_charger', title: '65W USB-C Charger' },
      quantity: 1
    }
  ],
  totals: [],
  links: []
}

const principal: CommercePrincipal = {
  keyId: 'test-key',
  ownerPrincipal: 'owner:test',
  ownerPrincipalHash: `sha256:${'1'.repeat(64)}`,
  integrationId: 'api-key:test-key',
  agentSessionId: 'agent-session-test',
  agentActionScope: 'write:purchase',
  agentAllowedActionScopes: ['write:purchase', 'write:complete_purchase', 'read:purchase']
}

const trustedPaymentContext = ({
  providerKinds,
  surfaces,
  hostId = 'service-test-host',
  handlerNames = [handlerName]
}: {
  providerKinds: Array<'trusted_host' | 'google_pay' | 'processor_tokenizer' | 'merchant_hosted'>
  surfaces: Array<'host_native' | 'embedded_component' | 'external_action' | 'merchant_hosted'>
  hostId?: string
  handlerNames?: string[]
}) => {
  const hostCapabilities = {
    hostId,
    integrationId: principal.integrationId,
    surfaces,
    providerKinds,
    handlerNames,
    ...(surfaces.includes('embedded_component')
      ? {
          componentProtocols: ['arro_payment_action/v1'],
          allowedComponentOrigins: ['https://arro.example'],
          thirdPartyPaymentEmbeddingAllowed: true
        }
      : {}),
    ...(surfaces.includes('external_action')
      ? {
          allowedReturnOrigins: ['https://host.example']
        }
      : {})
  }
  return {
    hostCapabilities,
    trustedHostContext: {
      hostId,
      integrationId: principal.integrationId,
      issuer: `arro-agent-host:${hostId}`,
      audience: 'arro-commerce',
      keyId: hostId,
      capabilities: hostCapabilities,
      attestedAt: '2026-07-11T00:00:00.000Z',
      expiresAt: '2099-07-11T00:00:00.000Z'
    }
  }
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

const paymentActionSigningSecret = 'test-payment-action-signing-secret-at-least-32-chars'

const signedPaymentActionFixture = (session: UcpCheckoutSessionRecord) => {
  const nonce = 'snapshot-authority-test-nonce'
  const expiresAt = '2099-07-11T00:00:00.000Z'
  const payload: PaymentActionTokenPayload = {
    v: 1,
    actionId: `arro_pa_${session.transactionId}`,
    transactionId: session.transactionId,
    integrationId: session.integrationId,
    ...(session.ownerKeyId ? { ownerKeyId: session.ownerKeyId } : {}),
    ...(session.ownerPrincipalHash ? { ownerPrincipalHash: session.ownerPrincipalHash } : {}),
    merchantOrigin: session.merchantOrigin,
    checkoutId: session.checkoutId,
    checkoutSnapshotHash: session.checkoutSnapshotHash,
    handlerId,
    handlerName,
    provider: handlerName,
    expiresAt,
    nonce
  }
  const action: UcpPaymentActionRecord = {
    actionId: payload.actionId,
    transactionId: session.transactionId,
    integrationId: session.integrationId,
    ...(session.ownerKeyId ? { ownerKeyId: session.ownerKeyId } : {}),
    ...(session.ownerPrincipalHash ? { ownerPrincipalHash: session.ownerPrincipalHash } : {}),
    merchantOrigin: session.merchantOrigin,
    checkoutId: session.checkoutId,
    checkoutSnapshotHash: session.checkoutSnapshotHash,
    handlerId,
    handlerName,
    provider: handlerName,
    actionType: 'processor_tokenizer',
    status: 'pending_user_approval',
    tokenNonceHash: paymentActionNonceHash(nonce),
    actionPayload: {},
    expiresAt,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z'
  }
  return {
    action,
    actionToken: signPaymentActionToken(payload, paymentActionSigningSecret)
  }
}

const createStore = (): UcpCheckoutStore => ({
  async createSession(input) {
    return {
      stored: true,
      session: {
        ...input,
        createdAt: '2026-07-11T00:00:00.000Z',
        updatedAt: '2026-07-11T00:00:00.000Z'
      }
    }
  },
  async readSession() {
    return undefined
  },
  async readSessionForPrincipal() {
    return undefined
  },
  async readSessionByCheckout() {
    return undefined
  },
  async updateCheckout() {
    throw new Error('not implemented')
  },
  async updateCart() {
    throw new Error('not implemented')
  },
  async recordConfirmation() {
    throw new Error('not implemented')
  },
  async readConfirmation() {
    return undefined
  },
  async recordOperation() {},
  async recordPaymentResult(_input) {
    throw new Error('not implemented')
  },
  async readLatestPaymentResult() {
    return undefined
  },
  async revokePaymentResults() {
    return []
  },
  async createPaymentAction(input) {
    return {
      ...input,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
  },
  async readPaymentAction() {
    return undefined
  },
  async markPaymentActionApproved() {
    return undefined
  },
  async markPaymentActionCredentialReady() {
    return undefined
  },
  async consumePaymentAction() {
    return undefined
  },
  async revokeSiblingPaymentActions() {
    return 0
  },
  async markPaymentActionFailed() {
    return undefined
  },
  async revokePendingPaymentActions() {
    return 0
  },
  async claimAp2Mandate() {
    return 'claimed'
  },
  async recordAp2Authority() {},
  async invalidateAp2Authorities() {
    return 0
  },
  async consumeAp2Authorities() {
    return 0
  },
  async readAp2AuthorityForReceipt() {
    return undefined
  },
  async recordAp2ProtocolReceipt() {
    return 'recorded'
  },
  async recordEmbeddedCheckoutMessage() {},
  async recordOrder(_input) {
    throw new Error('not implemented')
  },
  async readOrder(_orderId, _merchantOrigin) {
    return undefined
  },
  async readOrderForPrincipal(_orderId, _transactionId, _principal) {
    return undefined
  },
  async recordOrderWebhook(_input) {
    throw new Error('not implemented')
  }
})

describe('createUcpCheckoutService', () => {
  const reviewRuntime = () => {
    const session = {
      transactionId: 'txn_review', integrationId: principal.integrationId,
      ownerKeyId: principal.keyId, ownerPrincipalHash: principal.ownerPrincipalHash,
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp', merchantOrigin: 'https://merchant.example',
      ucpVersion: version, checkoutId: checkout.id, cartId: cart.id, cart,
      idempotencyKeyHash: `sha256:${'2'.repeat(64)}`, requestFingerprint: `sha256:${'3'.repeat(64)}`,
      lastCheckoutStatus: checkout.status, checkoutSnapshotHash: ucpCheckoutSnapshotHash(checkout),
      checkout, businessProfile, negotiation,
      createdAt: '2026-07-11T00:00:00.000Z', updatedAt: '2026-07-11T00:00:00.000Z'
    }
    const client = {
      getCart: vi.fn(), updateCart: vi.fn(),
      getCheckout: vi.fn().mockResolvedValue(checkout), updateCheckout: vi.fn().mockResolvedValue(checkout)
    }
    const store = { ...createStore(),
      readSessionForPrincipal: vi.fn().mockResolvedValue(session), readSession: vi.fn().mockResolvedValue(session),
      updateCheckout: vi.fn().mockResolvedValue(session)
    }
    const service = createUcpCheckoutService({ client: client as unknown as UcpClient, store, platformProfile,
      platformProfileUrl: 'https://arro.example/.well-known/ucp'
    })
    return { service, client }
  }

  it('reads the converted checkout without an unnecessary source-cart request', async () => {
    const { service, client } = reviewRuntime()
    await service.getCheckout('txn_review', principal)
    expect(client.getCheckout).toHaveBeenCalledOnce()
    expect(client.getCart).not.toHaveBeenCalled()
  })

  it('updates the checkout once without mutating the converted cart first', async () => {
    const { service, client } = reviewRuntime()
    await service.updateCheckout('txn_review', { principal, checkout: { line_items: [{ id: 'line_1', item: { id: 'item_1' }, quantity: 1 }], buyer: { email: 'buyer@example.com' } } })
    expect(client.updateCheckout).toHaveBeenCalledOnce()
    expect(client.updateCart).not.toHaveBeenCalled()
  })

  it('preserves merchant throttling as 429 with its retry delay, not a 502 unsupported shop', async () => {
    const { service, client } = reviewRuntime()
    client.getCheckout.mockRejectedValue(new UcpProtocolError('HTTP error', { code: 'ucp_http_error', httpStatus: 429, retryAfterSeconds: 120 }))
    await expect(service.getCheckout('txn_review', principal)).rejects.toMatchObject({
      code: 'ucp_merchant_rate_limited', status: 429, details: { retryAfterSeconds: 120 }
    })
  })

  it('keeps invalid review parameters a recoverable form error', async () => {
    const { service, client } = reviewRuntime()
    client.updateCheckout.mockRejectedValue(new UcpProtocolError('Invalid parameters', { code: 'ucp_mcp_invalid_params' }))
    await expect(service.updateCheckout('txn_review', { principal, checkout: { line_items: [{ id: 'line_1', item: { id: 'item_1' }, quantity: 1 }], buyer: { email: 'buyer@example.com' } } })).rejects.toMatchObject({
      code: 'ucp_review_rejected', status: 422
    })
  })

  it('security-locks an AP2-negotiated UCP Checkout before merchant completion when the Checkout Mandate is absent', async () => {
    const ap2Negotiation: UcpNegotiation = {
      ...negotiation,
      capabilities: {
        ...negotiation.capabilities,
        [UCP_AP2_MANDATE_CAPABILITY]: [{ version }]
      }
    }
    const session = {
      transactionId: 'txn_ap2_security_lock',
      integrationId: principal.integrationId,
      ownerKeyId: principal.keyId,
      ownerPrincipalHash: principal.ownerPrincipalHash,
      agentSessionId: principal.agentSessionId,
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      merchantOrigin: 'https://merchant.example',
      ucpVersion: version,
      checkoutId: checkout.id,
      idempotencyKeyHash: `sha256:${'2'.repeat(64)}`,
      requestFingerprint: `sha256:${'3'.repeat(64)}`,
      lastCheckoutStatus: checkout.status,
      checkoutSnapshotHash: ucpCheckoutSnapshotHash(checkout),
      checkout,
      businessProfile,
      negotiation: ap2Negotiation,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
    const store = {
      ...createStore(),
      readSessionForPrincipal: vi.fn().mockResolvedValue(session),
      readSession: vi.fn().mockResolvedValue(session),
      readConfirmation: vi.fn().mockResolvedValue({
        checkoutId: checkout.id,
        checkoutSnapshotHash: ucpCheckoutSnapshotHash(checkout),
        approvedAt: '2026-07-13T00:00:00.000Z',
        approvalRef: 'approval-ap2-1'
      }),
      readLatestPaymentResult: vi.fn().mockResolvedValue(undefined)
    } satisfies UcpCheckoutStore
    const client = {
      completeCheckout: vi.fn()
    } as unknown as UcpClient
    const service = createUcpCheckoutService({
      client,
      store,
      platformProfile,
      platformProfileUrl: 'https://arro.example/.well-known/ucp'
    })

    await expect(service.completeCheckout('txn_ap2_security_lock', {
      principal,
      idempotencyKey: 'ap2-security-lock-complete',
      checkout: {
        payment: {
          instruments: [{
            id: 'instrument-ap2-1',
            handler_id: handlerId,
            type: 'card',
            credential: { type: 'PAYMENT_GATEWAY', token: 'opaque-token' }
          }]
        }
      }
    })).rejects.toMatchObject({
      code: 'ucp_invalid_request',
      details: { code: 'mandate_required' }
    })
    expect(client.completeCheckout).not.toHaveBeenCalled()
  })

  it('allows only Get reconciliation while Checkout completion is in progress', async () => {
    const completingCheckout: UcpCheckout = {
      ...checkout,
      status: 'complete_in_progress'
    }
    const session = {
      transactionId: 'txn_completion_in_progress',
      integrationId: principal.integrationId,
      ownerKeyId: principal.keyId,
      ownerPrincipalHash: principal.ownerPrincipalHash,
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      merchantOrigin: 'https://merchant.example',
      ucpVersion: version,
      checkoutId: completingCheckout.id,
      idempotencyKeyHash: `sha256:${'2'.repeat(64)}`,
      requestFingerprint: `sha256:${'3'.repeat(64)}`,
      lastCheckoutStatus: completingCheckout.status,
      checkoutSnapshotHash: ucpCheckoutSnapshotHash(completingCheckout),
      checkout: completingCheckout,
      businessProfile,
      negotiation,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
    const client = {
      updateCheckout: vi.fn(),
      completeCheckout: vi.fn()
    } as unknown as UcpClient
    const service = createUcpCheckoutService({
      client,
      store: {
        ...createStore(),
        readSessionForPrincipal: vi.fn().mockResolvedValue(session)
      },
      platformProfile,
      platformProfileUrl: 'https://arro.example/.well-known/ucp'
    })

    await expect(service.updateCheckout(session.transactionId, {
      principal,
      idempotencyKey: 'blocked-update-idempotency',
      checkout: { buyer: { email: 'buyer@example.com' } }
    })).rejects.toMatchObject({
      code: 'ucp_checkout_completion_in_progress',
      status: 409,
      details: {
        checkoutStatus: 'complete_in_progress',
        permittedOperation: 'get_checkout'
      }
    })
    await expect(service.completeCheckout(session.transactionId, {
      principal,
      idempotencyKey: 'blocked-complete-idempotency',
      checkout: {}
    })).rejects.toMatchObject({
      code: 'ucp_checkout_completion_in_progress',
      status: 409,
      details: {
        checkoutStatus: 'complete_in_progress',
        permittedOperation: 'get_checkout'
      }
    })
    expect(client.updateCheckout).not.toHaveBeenCalled()
    expect(client.completeCheckout).not.toHaveBeenCalled()
  })

  it('revokes local payment actions when remote cart cancellation is unsupported', async () => {
    const session = {
      transactionId: 'txn_cancel_unsupported',
      integrationId: principal.integrationId,
      ownerKeyId: principal.keyId,
      ownerPrincipalHash: principal.ownerPrincipalHash,
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      merchantOrigin: 'https://merchant.example',
      ucpVersion: version,
      cartId: cart.id,
      checkoutId: checkout.id,
      idempotencyKeyHash: `sha256:${'2'.repeat(64)}`,
      requestFingerprint: `sha256:${'3'.repeat(64)}`,
      lastCheckoutStatus: checkout.status,
      checkoutSnapshotHash: ucpCheckoutSnapshotHash(checkout),
      cart,
      checkout,
      businessProfile,
      negotiation,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
    const client = {
      cancelCart: vi.fn().mockResolvedValue({
        ucp: {
          version,
          status: 'error'
        },
        messages: [
          {
            type: 'error',
            code: 'cart_cancel_unsupported',
            content: 'Merchant cart cancellation is not supported.',
            severity: 'recoverable'
          }
        ],
        continue_url: 'https://merchant.example/cart/cart_1'
      }),
      cancelCheckout: vi.fn()
    } as unknown as UcpClient
    const revokePendingPaymentActions = vi.fn().mockResolvedValue(1)
    const revokePaymentResults = vi.fn().mockResolvedValue([])
    const service = createUcpCheckoutService({
      client,
      store: {
        ...createStore(),
        readSessionForPrincipal: vi.fn().mockResolvedValue(session),
        revokePendingPaymentActions,
        revokePaymentResults
      },
      platformProfile,
      platformProfileUrl: 'https://arro.example/.well-known/ucp'
    })

    const response = await service.cancelCheckout(session.transactionId, {
      principal,
      idempotencyKey: 'cancel-unsupported-idem',
      reason: 'buyer canceled'
    })

    expect(client.cancelCart).toHaveBeenCalled()
    expect(client.cancelCheckout).not.toHaveBeenCalled()
    expect(revokePendingPaymentActions).toHaveBeenCalledWith({
      transactionId: session.transactionId,
      reason: 'purchase_canceled'
    })
    expect(revokePaymentResults).toHaveBeenCalledWith({
      transactionId: session.transactionId,
      reason: 'purchase_canceled'
    })
    expect(response).toMatchObject({
      transactionId: session.transactionId,
      paymentCompletedByArro: false,
      primaryAction: {
        action: 'continue_on_merchant',
        url: 'https://merchant.example/cart/cart_1'
      }
    })

    vi.mocked(client.cancelCart).mockRejectedValueOnce(new Error('merchant_cancel_capability_unavailable'))
    await expect(service.cancelCheckout(session.transactionId, {
      principal,
      idempotencyKey: 'cancel-unavailable-idem',
      reason: 'buyer canceled'
    })).rejects.toBeDefined()
    expect(revokePendingPaymentActions).toHaveBeenCalledTimes(2)
    expect(revokePaymentResults).toHaveBeenCalledTimes(2)
  })

  it('resolves runtime merchant auth for UCP cart and checkout creation', async () => {
    const merchantAuth = {
      type: 'bearer' as const,
      token: 'merchant-runtime-token'
    }
    const client = {
      discover: vi.fn().mockResolvedValue(businessProfile),
      negotiate: vi.fn().mockResolvedValue(negotiation),
      createCart: vi.fn().mockResolvedValue(cart),
      createCheckout: vi.fn().mockResolvedValue(checkout)
    } as unknown as UcpClient
    const resolver = {
      resolve: vi.fn().mockResolvedValue(merchantAuth)
    }
    const service = createUcpCheckoutService({
      client,
      store: createStore(),
      platformProfile,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      merchantAuthResolver: resolver
    })

    await service.createCheckout({
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      principal,
      idempotencyKey: 'service-checkout-idem',
      cart: {
        line_items: [{ item: { id: 'sku_65w_charger' }, quantity: 1 }]
      },
      checkout: {
        line_items: [{ item: { id: 'sku_65w_charger' }, quantity: 1 }]
      }
    })

    expect(resolver.resolve).toHaveBeenCalledWith(expect.objectContaining({
      merchantOrigin: 'https://merchant.example',
      operation: 'create_cart'
    }))
    expect(resolver.resolve).toHaveBeenCalledWith(expect.objectContaining({
      merchantOrigin: 'https://merchant.example',
      operation: 'create_checkout'
    }))
    expect(client.createCart).toHaveBeenCalledWith(expect.objectContaining({
      auth: merchantAuth
    }))
    // The merchant-created cart is authoritative for both its reference and
    // line items. Shopify's deployed MCP binding requires both inside the
    // checkout object even though its published binding also documents a
    // top-level cart reference.
    expect(client.createCheckout).toHaveBeenCalledWith(expect.objectContaining({
      auth: merchantAuth,
      body: {
        cart_id: 'cart_1',
        line_items: [{
          item: {
            id: 'sku_65w_charger',
            title: '65W USB-C Charger'
          },
          quantity: 1
        }]
      }
    }))
  })

  it('stores tokenized payment results through the credential vault instead of Postgres', async () => {
    const session = {
      transactionId: 'txn_payment_1',
      integrationId: principal.integrationId,
      ownerKeyId: principal.keyId,
      ownerPrincipalHash: principal.ownerPrincipalHash,
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      merchantOrigin: 'https://merchant.example',
      ucpVersion: version,
      checkoutId: checkout.id,
      idempotencyKeyHash: `sha256:${'2'.repeat(64)}`,
      requestFingerprint: `sha256:${'3'.repeat(64)}`,
      lastCheckoutStatus: checkout.status,
      checkoutSnapshotHash: ucpCheckoutSnapshotHash(checkout),
      checkout,
      businessProfile,
      negotiation,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
    const liveInstrument: UcpPaymentInstrument = {
      id: 'pi_1',
      handler_id: handlerId,
      type: 'card',
      credential: {
        type: 'token',
        token: 'checkout-scoped-secret'
      }
    }
    let storedPaymentResult: Awaited<ReturnType<UcpCheckoutStore['readLatestPaymentResult']>>
    const store = {
      ...createStore(),
      readSessionForPrincipal: vi.fn().mockResolvedValue(session),
      readSession: vi.fn().mockResolvedValue(session),
      recordPaymentResult: vi.fn().mockImplementation(async (input) => {
        storedPaymentResult = {
          ...input,
          createdAt: '2026-07-11T00:00:00.000Z'
        }
        return {
          stored: true,
          paymentResult: storedPaymentResult
        }
      }),
      readLatestPaymentResult: vi.fn().mockImplementation(async () => storedPaymentResult),
      updateCheckout: vi.fn().mockImplementation(async (input: { checkout: UcpCheckout }) => ({
        ...session,
        checkout: input.checkout,
        checkoutSnapshotHash: ucpCheckoutSnapshotHash(input.checkout)
      }))
    }
    const service = createUcpCheckoutService({
      client: {
        getCheckout: vi.fn().mockResolvedValue(checkout)
      } as unknown as UcpClient,
      store,
      platformProfile,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      paymentCredentialVault: createMemoryPaymentCredentialVault(),
      paymentCredentialProvider: {
        tokenize: vi.fn().mockResolvedValue(liveInstrument)
      },
      paymentHandlerSpecs: handlerSpecs
    })

    const response = await service.recordPaymentResult('txn_payment_1', {
      principal,
      idempotencyKey: 'payment-result-idempotency',
      provider: handlerName,
      result: {
        type: 'processor_tokenizer_result',
        provider: handlerName,
        credentialReference: { reference: 'ptr_provider_result_0001', proof: 'proof_provider_result_0001' }
      }
    })

    expect(store.recordPaymentResult).toHaveBeenCalledWith(expect.objectContaining({
      checkoutSnapshotHash: session.checkoutSnapshotHash,
      instrument: expect.objectContaining({
        credential: expect.objectContaining({
          redacted: true,
          reference: expect.stringMatching(/^pcv_/)
        })
      })
    }))
    expect(JSON.stringify(storedPaymentResult?.instrument)).not.toContain('checkout-scoped-secret')
    await expect(service.readLatestPaymentExecutionAuthority('txn_payment_1', principal)).resolves.toMatchObject({
      instrument: {
        credential: {
          token: 'checkout-scoped-secret'
        }
      }
    })
    expect(store.readLatestPaymentResult).toHaveBeenCalledWith(
      session.transactionId,
      session.checkoutSnapshotHash
    )
    expect(response.paymentCompletedByArro).toBe(false)
  })

  it('revokes a signed payment action before provider exchange when its local checkout snapshot is stale', async () => {
    const actionSession: UcpCheckoutSessionRecord = {
      transactionId: 'txn_stale_local_action',
      integrationId: principal.integrationId,
      ownerKeyId: principal.keyId,
      ownerPrincipalHash: principal.ownerPrincipalHash,
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      merchantOrigin: 'https://merchant.example',
      ucpVersion: version,
      checkoutId: checkout.id,
      idempotencyKeyHash: `sha256:${'2'.repeat(64)}`,
      requestFingerprint: `sha256:${'3'.repeat(64)}`,
      lastCheckoutStatus: checkout.status,
      checkoutSnapshotHash: ucpCheckoutSnapshotHash(checkout),
      checkout,
      businessProfile,
      negotiation: negotiationFor(businessProfile),
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
    const changedCheckout: UcpCheckout = {
      ...checkout,
      totals: [{ type: 'total', amount: 3399, currency: checkout.currency }]
    }
    const currentSession: UcpCheckoutSessionRecord = {
      ...actionSession,
      checkout: changedCheckout,
      checkoutSnapshotHash: ucpCheckoutSnapshotHash(changedCheckout)
    }
    const { action, actionToken } = signedPaymentActionFixture(actionSession)
    const revokePendingPaymentActions = vi.fn().mockResolvedValue(1)
    const revokePaymentResults = vi.fn().mockResolvedValue([])
    const markPaymentActionApproved = vi.fn()
    const tokenize = vi.fn()
    const getCheckout = vi.fn()
    const service = createUcpCheckoutService({
      client: { getCheckout } as unknown as UcpClient,
      store: {
        ...createStore(),
        readSessionForPrincipal: vi.fn().mockResolvedValue(currentSession),
        readPaymentAction: vi.fn().mockResolvedValue(action),
        markPaymentActionApproved,
        revokePendingPaymentActions,
        revokePaymentResults
      },
      platformProfile,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      paymentActionSigningSecret,
      paymentCredentialProvider: { tokenize },
      paymentHandlerSpecs: handlerSpecs
    })

    await expect(service.recordPaymentActionResult({
      actionToken,
      idempotencyKey: 'stale-local-result',
      result: {
        type: 'processor_tokenizer_result',
        provider: handlerName,
        credentialReference: {
          reference: 'ptr_stale_local',
          proof: 'proof_stale_local'
        }
      }
    })).rejects.toMatchObject({
      code: 'ucp_payment_action_invalid',
      status: 409
    })
    expect(getCheckout).not.toHaveBeenCalled()
    expect(tokenize).not.toHaveBeenCalled()
    expect(markPaymentActionApproved).not.toHaveBeenCalled()
    expect(revokePendingPaymentActions).toHaveBeenCalledWith({
      transactionId: actionSession.transactionId,
      reason: 'checkout_changed',
      checkoutSnapshotHash: actionSession.checkoutSnapshotHash
    })
    expect(revokePaymentResults).toHaveBeenCalledWith({
      transactionId: actionSession.transactionId,
      reason: 'snapshot_mismatch',
      checkoutSnapshotHash: actionSession.checkoutSnapshotHash
    })
  })

  it('refreshes merchant authority and revokes vaulted credentials before exchanging a stale payment action', async () => {
    const actionSession: UcpCheckoutSessionRecord = {
      transactionId: 'txn_stale_merchant_action',
      integrationId: principal.integrationId,
      ownerKeyId: principal.keyId,
      ownerPrincipalHash: principal.ownerPrincipalHash,
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      merchantOrigin: 'https://merchant.example',
      ucpVersion: version,
      checkoutId: checkout.id,
      idempotencyKeyHash: `sha256:${'2'.repeat(64)}`,
      requestFingerprint: `sha256:${'3'.repeat(64)}`,
      lastCheckoutStatus: checkout.status,
      checkoutSnapshotHash: ucpCheckoutSnapshotHash(checkout),
      checkout,
      businessProfile,
      negotiation: negotiationFor(businessProfile),
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
    const merchantCheckout: UcpCheckout = {
      ...checkout,
      totals: [{ type: 'total', amount: 3499, currency: checkout.currency }]
    }
    const { action, actionToken } = signedPaymentActionFixture(actionSession)
    const stalePaymentResult: UcpPaymentResultRecord = {
      paymentResultId: 'ucppr_stale_merchant',
      transactionId: actionSession.transactionId,
      provider: handlerName,
      handlerId,
      checkoutSnapshotHash: actionSession.checkoutSnapshotHash,
      idempotencyKeyHash: `sha256:${'6'.repeat(64)}`,
      resultFingerprint: `sha256:${'7'.repeat(64)}`,
      instrument: {
        id: 'pi_stale_merchant',
        handler_id: handlerId,
        type: 'card',
        credential: {
          type: 'token',
          redacted: true,
          reference: 'pcv_stale_merchant'
        }
      },
      providerResult: { type: 'processor_tokenizer_result' },
      createdAt: '2026-07-11T00:00:00.000Z'
    }
    const revokePaymentResults = vi.fn().mockResolvedValue([stalePaymentResult])
    const revokePendingPaymentActions = vi.fn().mockResolvedValue(1)
    const markPaymentActionApproved = vi.fn()
    const tokenize = vi.fn()
    const vault = {
      put: vi.fn(),
      consume: vi.fn(),
      revoke: vi.fn().mockResolvedValue(undefined)
    }
    const store = {
      ...createStore(),
      readSessionForPrincipal: vi.fn().mockResolvedValue(actionSession),
      readPaymentAction: vi.fn().mockResolvedValue(action),
      markPaymentActionApproved,
      updateCheckout: vi.fn().mockImplementation(async ({ checkout: latest }: { checkout: UcpCheckout }) => ({
        ...actionSession,
        checkout: latest,
        checkoutSnapshotHash: ucpCheckoutSnapshotHash(latest)
      })),
      revokePendingPaymentActions,
      revokePaymentResults
    } satisfies UcpCheckoutStore
    const service = createUcpCheckoutService({
      client: {
        getCheckout: vi.fn().mockResolvedValue(merchantCheckout)
      } as unknown as UcpClient,
      store,
      platformProfile,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      paymentActionSigningSecret,
      paymentCredentialVault: vault,
      paymentCredentialProvider: { tokenize },
      paymentHandlerSpecs: handlerSpecs
    })

    await expect(service.recordPaymentActionResult({
      actionToken,
      idempotencyKey: 'stale-merchant-result',
      result: {
        type: 'processor_tokenizer_result',
        provider: handlerName,
        credentialReference: {
          reference: 'ptr_stale_merchant',
          proof: 'proof_stale_merchant'
        }
      }
    })).rejects.toMatchObject({
      code: 'ucp_payment_action_invalid',
      status: 409
    })
    expect(store.updateCheckout).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: actionSession.transactionId,
      checkout: merchantCheckout
    }))
    expect(tokenize).not.toHaveBeenCalled()
    expect(markPaymentActionApproved).not.toHaveBeenCalled()
    expect(revokePendingPaymentActions).toHaveBeenCalledWith({
      transactionId: actionSession.transactionId,
      reason: 'checkout_changed',
      checkoutSnapshotHash: actionSession.checkoutSnapshotHash
    })
    expect(vault.revoke).toHaveBeenCalledWith('pcv_stale_merchant')
  })

  it('never consumes a vaulted payment credential from another checkout snapshot', async () => {
    const currentSnapshotHash = ucpCheckoutSnapshotHash(checkout)
    const session: UcpCheckoutSessionRecord = {
      transactionId: 'txn_wrong_snapshot_authority',
      integrationId: principal.integrationId,
      ownerKeyId: principal.keyId,
      ownerPrincipalHash: principal.ownerPrincipalHash,
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      merchantOrigin: 'https://merchant.example',
      ucpVersion: version,
      checkoutId: checkout.id,
      idempotencyKeyHash: `sha256:${'2'.repeat(64)}`,
      requestFingerprint: `sha256:${'3'.repeat(64)}`,
      lastCheckoutStatus: checkout.status,
      checkoutSnapshotHash: currentSnapshotHash,
      checkout,
      businessProfile,
      negotiation: negotiationFor(businessProfile),
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
    const wrongSnapshotResult: UcpPaymentResultRecord = {
      paymentResultId: 'ucppr_wrong_snapshot',
      transactionId: session.transactionId,
      provider: handlerName,
      handlerId,
      checkoutSnapshotHash: `sha256:${'9'.repeat(64)}`,
      idempotencyKeyHash: `sha256:${'6'.repeat(64)}`,
      resultFingerprint: `sha256:${'7'.repeat(64)}`,
      instrument: {
        id: 'pi_wrong_snapshot',
        handler_id: handlerId,
        type: 'card',
        credential: {
          type: 'token',
          redacted: true,
          reference: 'pcv_wrong_snapshot'
        }
      },
      providerResult: { type: 'processor_tokenizer_result' },
      createdAt: '2026-07-11T00:00:00.000Z'
    }
    const readLatestPaymentResult = vi.fn().mockResolvedValue(wrongSnapshotResult)
    const vault = {
      put: vi.fn(),
      consume: vi.fn(),
      revoke: vi.fn().mockResolvedValue(undefined)
    }
    const service = createUcpCheckoutService({
      client: {} as unknown as UcpClient,
      store: {
        ...createStore(),
        readSessionForPrincipal: vi.fn().mockResolvedValue(session),
        readLatestPaymentResult,
        revokePaymentResults: vi.fn().mockResolvedValue([])
      },
      platformProfile,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      paymentCredentialVault: vault
    })

    await expect(service.readLatestPaymentExecutionAuthority(
      session.transactionId,
      principal
    )).rejects.toMatchObject({
      code: 'ucp_payment_result_invalid',
      status: 409
    })
    expect(readLatestPaymentResult).toHaveBeenCalledWith(
      session.transactionId,
      currentSnapshotHash
    )
    expect(vault.consume).not.toHaveBeenCalled()
    expect(vault.revoke).toHaveBeenCalledWith('pcv_wrong_snapshot')
  })

  it('creates and consumes a signed payment action through the same vaulted result path', async () => {
    const session = {
      transactionId: 'txn_action_1',
      integrationId: principal.integrationId,
      ownerKeyId: principal.keyId,
      ownerPrincipalHash: principal.ownerPrincipalHash,
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      merchantOrigin: 'https://merchant.example',
      ucpVersion: version,
      checkoutId: checkout.id,
      idempotencyKeyHash: `sha256:${'2'.repeat(64)}`,
      requestFingerprint: `sha256:${'3'.repeat(64)}`,
      lastCheckoutStatus: checkout.status,
      checkoutSnapshotHash: ucpCheckoutSnapshotHash(checkout),
      checkout,
      businessProfile,
      negotiation: negotiationFor(businessProfile),
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
    const liveInstrument: UcpPaymentInstrument = {
      id: 'pi_action_1',
      handler_id: handlerId,
      type: 'card',
      credential: {
        type: 'token',
        token: 'action-scoped-secret'
      }
    }
    let storedAction: Awaited<ReturnType<UcpCheckoutStore['readPaymentAction']>>
    let storedPaymentResult: Awaited<ReturnType<UcpCheckoutStore['readLatestPaymentResult']>>
    const store = {
      ...createStore(),
      readSessionForPrincipal: vi.fn().mockResolvedValue(session),
      readSession: vi.fn().mockResolvedValue(session),
      createPaymentAction: vi.fn().mockImplementation(async (input) => {
        storedAction = {
          ...input,
          createdAt: '2026-07-11T00:00:00.000Z',
          updatedAt: '2026-07-11T00:00:00.000Z'
        }
        return storedAction
      }),
      readPaymentAction: vi.fn().mockImplementation(async () => storedAction),
      markPaymentActionApproved: vi.fn().mockImplementation(async () => {
        storedAction = storedAction
          ? {
              ...storedAction,
              status: 'approved',
              approvedAt: '2026-07-11T00:00:00.000Z',
              updatedAt: '2026-07-11T00:00:00.000Z'
            }
          : undefined
        return storedAction
      }),
      markPaymentActionCredentialReady: vi.fn().mockImplementation(async (input) => {
        storedAction = storedAction
          ? {
              ...storedAction,
              status: 'credential_ready',
              paymentResultId: input.paymentResultId,
              resultFingerprint: input.resultFingerprint,
              credentialReadyAt: '2026-07-11T00:00:00.000Z',
              updatedAt: '2026-07-11T00:00:00.000Z'
            }
          : undefined
        return storedAction
      }),
      markPaymentActionFailed: vi.fn().mockResolvedValue(undefined),
      recordPaymentResult: vi.fn().mockImplementation(async (input) => {
        storedPaymentResult = {
          ...input,
          createdAt: '2026-07-11T00:00:00.000Z'
        }
        return {
          stored: true,
          paymentResult: storedPaymentResult
        }
      }),
      readLatestPaymentResult: vi.fn().mockImplementation(async () => storedPaymentResult),
      updateCheckout: vi.fn().mockImplementation(async (input: { checkout: UcpCheckout }) => ({
        ...session,
        checkout: input.checkout,
        checkoutSnapshotHash: ucpCheckoutSnapshotHash(input.checkout),
        selectedPaymentHandlerId: handlerId
      }))
    } satisfies UcpCheckoutStore
    const service = createUcpCheckoutService({
      client: {
        getCheckout: vi.fn().mockResolvedValue(checkout)
      } as unknown as UcpClient,
      store,
      platformProfile,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      paymentActionSigningSecret: 'test-payment-action-signing-secret-at-least-32-chars',
      publicBaseUrl: 'https://arro.example',
      paymentCredentialVault: createMemoryPaymentCredentialVault(),
      paymentCredentialProvider: {
        tokenize: vi.fn().mockResolvedValue(liveInstrument)
      },
      paymentHandlerSpecs: handlerSpecs,
      paymentHandlerRegistry: createPaymentHandlerRegistry([
        {
          adapterKind: 'processor_tokenizer',
          handlerName,
          executionMode: 'client',
          supports: () => true
        }
      ])
    })

    const action = await service.createPaymentAction('txn_action_1', {
      principal,
      idempotencyKey: 'payment-action-idempotency',
      ...trustedPaymentContext({
        providerKinds: ['processor_tokenizer'],
        surfaces: ['external_action']
      }),
      returnUrl: 'https://host.example/return'
    })

    expect(action.actionToken).toMatch(/^arro_pa1_/)
    expect(action.actionUrl).toBe(`https://arro.example/v1/payment-actions/${action.actionToken}`)
    expect(store.createPaymentAction).toHaveBeenCalledWith(expect.objectContaining({
      provider: handlerName,
      status: 'pending_user_approval',
      checkoutSnapshotHash: session.checkoutSnapshotHash
    }))

    const status = await service.getPaymentAction(action.actionToken!)
    expect(status.status).toBe('pending_user_approval')

    const recorded = await service.recordPaymentActionResult({
      actionToken: action.actionToken!,
      idempotencyKey: 'payment-action-result-idempotency',
      result: {
        type: 'processor_tokenizer_result',
        provider: handlerName,
        credentialReference: { reference: 'ptr_provider_token_0001', proof: 'proof_provider_token_0001' }
      }
    })

    expect(JSON.stringify(recorded)).not.toContain('provider-token')
    expect(store.markPaymentActionCredentialReady).toHaveBeenCalledWith(expect.objectContaining({
      actionId: action.actionId,
      paymentResultId: expect.stringMatching(/^ucppr_/)
    }))
    expect(storedPaymentResult?.instrument.credential).toMatchObject({
      redacted: true,
      reference: expect.stringMatching(/^pcv_/)
    })

    await expect(service.recordPaymentActionResult({
      actionToken: action.actionToken!,
      idempotencyKey: 'payment-action-result-replay',
      result: {
        type: 'processor_tokenizer_result',
        provider: handlerName,
        credentialReference: { reference: 'ptr_replayed_token', proof: 'ptr_replayed_proof' }
      }
    })).rejects.toMatchObject({
      code: 'ucp_payment_action_replayed',
      status: 409
    })
    expect(store.recordPaymentResult).toHaveBeenCalledTimes(1)
  })

  it('creates and consumes a Hermes-like host-native trusted payment action', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    const publicJwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>
    publicJwk.kid = 'hermes-test-key-1'
    const session = {
      transactionId: 'txn_host_native_1',
      integrationId: principal.integrationId,
      ownerKeyId: principal.keyId,
      ownerPrincipalHash: principal.ownerPrincipalHash,
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      merchantOrigin: 'https://merchant.example',
      ucpVersion: version,
      checkoutId: checkout.id,
      idempotencyKeyHash: `sha256:${'2'.repeat(64)}`,
      requestFingerprint: `sha256:${'3'.repeat(64)}`,
      lastCheckoutStatus: checkout.status,
      checkoutSnapshotHash: ucpCheckoutSnapshotHash(checkout),
      checkout,
      businessProfile,
      negotiation: negotiationFor(businessProfile),
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
    let storedAction: Awaited<ReturnType<UcpCheckoutStore['readPaymentAction']>>
    let storedPaymentResult: Awaited<ReturnType<UcpCheckoutStore['readLatestPaymentResult']>>
    const store = {
      ...createStore(),
      readSessionForPrincipal: vi.fn().mockResolvedValue(session),
      readSession: vi.fn().mockResolvedValue(session),
      createPaymentAction: vi.fn().mockImplementation(async (input) => {
        storedAction = {
          ...input,
          createdAt: '2026-07-11T00:00:00.000Z',
          updatedAt: '2026-07-11T00:00:00.000Z'
        }
        return storedAction
      }),
      readPaymentAction: vi.fn().mockImplementation(async () => storedAction),
      markPaymentActionApproved: vi.fn().mockImplementation(async () => {
        storedAction = storedAction
          ? {
              ...storedAction,
              status: 'approved',
              approvedAt: '2026-07-11T00:00:00.000Z',
              updatedAt: '2026-07-11T00:00:00.000Z'
            }
          : undefined
        return storedAction
      }),
      markPaymentActionCredentialReady: vi.fn().mockImplementation(async (input) => {
        storedAction = storedAction
          ? {
              ...storedAction,
              status: 'credential_ready',
              paymentResultId: input.paymentResultId,
              resultFingerprint: input.resultFingerprint,
              credentialReadyAt: '2026-07-11T00:00:00.000Z',
              updatedAt: '2026-07-11T00:00:00.000Z'
            }
          : undefined
        return storedAction
      }),
      markPaymentActionFailed: vi.fn().mockResolvedValue(undefined),
      recordPaymentResult: vi.fn().mockImplementation(async (input) => {
        storedPaymentResult = {
          ...input,
          createdAt: '2026-07-11T00:00:00.000Z'
        }
        return {
          stored: true,
          paymentResult: storedPaymentResult
        }
      }),
      readLatestPaymentResult: vi.fn().mockImplementation(async () => storedPaymentResult),
      updateCheckout: vi.fn().mockImplementation(async (input: { checkout: UcpCheckout }) => ({
        ...session,
        checkout: input.checkout,
        checkoutSnapshotHash: ucpCheckoutSnapshotHash(input.checkout),
        selectedPaymentHandlerId: handlerId
      }))
    } satisfies UcpCheckoutStore
    const redemptionFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        credential_reference: 'opaque-host-reference-service-1',
        action_id: storedAction?.actionId,
        checkout_id: checkout.id,
        merchant_origin: 'https://merchant.example',
        handler_name: handlerName,
        handler_id: handlerId
      })
      return Response.json({
        ap2: {
          checkout_mandate: 'trusted-surface-checkout-mandate-service'
        },
        instrument: {
          id: 'pi_host_service_1',
          handler_id: handlerId,
          type: 'card',
          credential: {
            type: 'HOST_NATIVE_REFERENCE',
            token: 'host-native-checkout-scoped-secret',
            reusable: false,
            scope: {
              checkout_id: checkout.id,
              merchant_origin: 'https://merchant.example'
            },
            expires_at: '2099-07-11T00:00:00.000Z'
          }
        }
      })
    }) as typeof fetch
    const service = createUcpCheckoutService({
      client: {
        getCheckout: vi.fn().mockResolvedValue(checkout)
      } as unknown as UcpClient,
      store,
      platformProfile,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      paymentActionSigningSecret: 'test-payment-action-signing-secret-at-least-32-chars',
      publicBaseUrl: 'https://arro.example',
      paymentCredentialVault: createMemoryPaymentCredentialVault(),
      trustedHostPaymentVerifier: createTrustedHostPaymentVerifier({
        fetch: redemptionFetch,
        configs: [
          {
            hostId: 'hermes-desktop-test',
            integrationId: principal.integrationId,
            issuer: 'https://hermes.example',
            audience: 'https://arro.example',
            redemptionEndpoint: 'https://hermes.example/arro/payment/redeem',
            jwks: [publicJwk]
          }
        ]
      }),
      paymentHandlerSpecs: handlerSpecs,
      paymentHandlerRegistry: createPaymentHandlerRegistry([
        {
          adapterKind: 'processor_tokenizer',
          handlerName,
          executionMode: 'client',
          supports: () => true
        }
      ])
    })
    const hostCapabilities = {
      hostId: 'hermes-desktop-test',
      integrationId: principal.integrationId,
      surfaces: ['host_native' as const, 'external_action' as const],
      providerKinds: ['trusted_host' as const],
      handlerNames: [handlerName],
      attestationIssuer: 'https://hermes.example',
      attestationAudience: 'https://arro.example'
    }
    const trustedHostContext = {
      hostId: hostCapabilities.hostId,
      integrationId: hostCapabilities.integrationId,
      issuer: 'https://hermes.example',
      audience: 'https://arro.example',
      keyId: 'hermes-test-key-1',
      capabilities: hostCapabilities,
      attestedAt: '2026-07-11T00:00:00.000Z',
      expiresAt: '2099-07-11T00:00:00.000Z'
    }

    const action = await service.createPaymentAction('txn_host_native_1', {
      principal,
      idempotencyKey: 'host-native-action-idempotency',
      preference: {
        mode: 'host_supplied'
      },
      hostCapabilities,
      trustedHostContext
    })

    expect(action).toMatchObject({
      presentation: 'host_native',
      actionToken: expect.stringMatching(/^arro_pa1_/)
    })
    expect(action.actionUrl).toBeUndefined()
    expect(storedAction).toMatchObject({
      actionType: 'host_supplied',
      capabilityId: `trusted_host:${handlerName}:${handlerId}`,
      actionPayload: expect.objectContaining({
        kind: 'host_supplied_payment_capability',
        presentation: 'host_native'
      })
    })
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
        jti: 'host-native-service-jti-1',
        iat: nowSeconds,
        exp: nowSeconds + 300,
        host_id: hostCapabilities.hostId,
        integration_id: principal.integrationId,
        action_id: action.actionId,
        transaction_id: 'txn_host_native_1',
        checkout_id: checkout.id,
        checkout_snapshot_hash: session.checkoutSnapshotHash,
        payment_action_nonce_hash: storedAction?.tokenNonceHash,
        merchant_origin: 'https://merchant.example',
        handler_name: handlerName,
        handler_id: handlerId,
        capability_id: `trusted_host:${handlerName}:${handlerId}`,
        credential_reference: 'opaque-host-reference-service-1'
      }
    })
    const recorded = await service.recordPaymentActionResult({
      actionToken: action.actionToken!,
      idempotencyKey: 'host-native-result-idempotency',
      result: {
        type: 'trusted_host_attestation',
        attestation
      }
    })

    expect(JSON.stringify(recorded)).not.toContain('host-native-checkout-scoped-secret')
    expect(redemptionFetch).toHaveBeenCalledOnce()
    expect(store.markPaymentActionCredentialReady).toHaveBeenCalledWith(expect.objectContaining({
      actionId: action.actionId,
      paymentResultId: expect.stringMatching(/^ucppr_/)
    }))
    expect(storedPaymentResult?.instrument.credential).toMatchObject({
      redacted: true,
      reference: expect.stringMatching(/^pcv_/)
    })
    await expect(service.readLatestPaymentExecutionAuthority('txn_host_native_1', principal)).resolves.toMatchObject({
      ap2CheckoutMandate: 'trusted-surface-checkout-mandate-service',
      instrument: {
        credential: {
          token: 'host-native-checkout-scoped-secret'
        }
      }
    })
  })

  it('creates and consumes native Google Pay for the first-party Android client without a browser action', async () => {
    const firstPartyPrincipal: CommercePrincipal = {
      ...principal,
      integrationId: 'first-party:arro-shopper'
    }
    const nativeCheckout: UcpCheckout = {
      ...checkout,
      context: {
        merchant_country: 'NL'
      },
      totals: [{ type: 'total', amount: 3299, currency: 'USD' }]
    }
    const session = {
      transactionId: 'txn_google_pay_1',
      integrationId: firstPartyPrincipal.integrationId,
      ownerKeyId: principal.keyId,
      ownerPrincipalHash: principal.ownerPrincipalHash,
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      merchantOrigin: 'https://merchant.example',
      ucpVersion: version,
      checkoutId: checkout.id,
      idempotencyKeyHash: `sha256:${'2'.repeat(64)}`,
      requestFingerprint: `sha256:${'3'.repeat(64)}`,
      lastCheckoutStatus: nativeCheckout.status,
      checkoutSnapshotHash: ucpCheckoutSnapshotHash(nativeCheckout),
      checkout: nativeCheckout,
      businessProfile: googlePayBusinessProfile,
      negotiation: negotiationFor(googlePayBusinessProfile),
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
    let storedAction: Awaited<ReturnType<UcpCheckoutStore['readPaymentAction']>>
    let storedPaymentResult: Awaited<ReturnType<UcpCheckoutStore['readLatestPaymentResult']>>
    const store = {
      ...createStore(),
      readSessionForPrincipal: vi.fn().mockResolvedValue(session),
      readSession: vi.fn().mockResolvedValue(session),
      createPaymentAction: vi.fn().mockImplementation(async (input) => {
        storedAction = {
          ...input,
          createdAt: '2026-07-11T00:00:00.000Z',
          updatedAt: '2026-07-11T00:00:00.000Z'
        }
        return storedAction
      }),
      readPaymentAction: vi.fn().mockImplementation(async () => storedAction),
      markPaymentActionApproved: vi.fn().mockImplementation(async () => {
        storedAction = storedAction
          ? {
              ...storedAction,
              status: 'approved',
              approvedAt: '2026-07-11T00:00:00.000Z',
              updatedAt: '2026-07-11T00:00:00.000Z'
            }
          : undefined
        return storedAction
      }),
      markPaymentActionCredentialReady: vi.fn().mockImplementation(async (input) => {
        storedAction = storedAction
          ? {
              ...storedAction,
              status: 'credential_ready',
              paymentResultId: input.paymentResultId,
              resultFingerprint: input.resultFingerprint,
              credentialReadyAt: '2026-07-11T00:00:00.000Z',
              updatedAt: '2026-07-11T00:00:00.000Z'
            }
          : undefined
        return storedAction
      }),
      markPaymentActionFailed: vi.fn().mockResolvedValue(undefined),
      recordPaymentResult: vi.fn().mockImplementation(async (input) => {
        storedPaymentResult = {
          ...input,
          createdAt: '2026-07-11T00:00:00.000Z'
        }
        return {
          stored: true,
          paymentResult: storedPaymentResult
        }
      }),
      readLatestPaymentResult: vi.fn().mockImplementation(async () => storedPaymentResult),
      updateCheckout: vi.fn().mockImplementation(async (input: { checkout: UcpCheckout }) => ({
        ...session,
        checkout: input.checkout,
        checkoutSnapshotHash: ucpCheckoutSnapshotHash(input.checkout),
        selectedPaymentHandlerId: googlePayHandlerId
      }))
    } satisfies UcpCheckoutStore
    const service = createUcpCheckoutService({
      client: {
        getCheckout: vi.fn().mockResolvedValue(nativeCheckout)
      } as unknown as UcpClient,
      store,
      platformProfile,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      paymentActionSigningSecret: 'test-payment-action-signing-secret-at-least-32-chars',
      publicBaseUrl: 'https://arro.example',
      paymentCredentialVault: createMemoryPaymentCredentialVault(),
      paymentHandlerSpecs: googlePayHandlerSpecs,
      paymentHandlerRegistry: createPaymentHandlerRegistry([
        createGooglePayPaymentHandlerAdapter({
          environment: 'TEST'
        })
      ])
    })
    const action = await service.createPaymentAction('txn_google_pay_1', {
      principal: firstPartyPrincipal,
      idempotencyKey: 'google-pay-action-idempotency',
      preference: {
        mode: 'google_pay'
      },
      clientCapabilities: {
        platform: 'android',
        surfaces: ['host_native'],
        providerKinds: ['google_pay'],
        handlerNames: [googlePayHandlerName]
      }
    })

    expect(action).toMatchObject({
      presentation: 'host_native',
      actionToken: expect.stringMatching(/^arro_pa1_/)
    })
    expect(action.actionUrl).toBeUndefined()
    expect(storedAction).toMatchObject({
      actionType: 'google_pay',
      presentation: 'host_native',
      actionPayload: expect.objectContaining({
        kind: 'google_pay',
        presentation: 'host_native',
        countryCode: 'NL',
        paymentRequest: expect.objectContaining({
          environment: 'TEST',
          transactionInfo: {
            totalPriceStatus: 'FINAL',
            totalPrice: '32.99',
            currencyCode: 'USD',
            countryCode: 'NL'
          },
          allowedPaymentMethods: expect.any(Array),
          merchantInfo: {
            merchantId: '12345678901234567890',
            merchantName: 'Example Merchant'
          }
        })
      })
    })

    const recorded = await service.recordPaymentActionResult({
      actionToken: action.actionToken!,
      idempotencyKey: 'google-pay-result-idempotency',
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
              token: '{"signature":"google-pay-service-signature","protocolVersion":"ECv2","signedMessage":"opaque"}'
            }
          }
        }
      }
    })

    expect(JSON.stringify(recorded)).not.toContain('google-pay-service-signature')
    expect(store.markPaymentActionCredentialReady).toHaveBeenCalledWith(expect.objectContaining({
      actionId: action.actionId,
      paymentResultId: expect.stringMatching(/^ucppr_/)
    }))
    expect(storedPaymentResult?.instrument).toMatchObject({
      handler_id: googlePayHandlerId,
      credential: {
        redacted: true,
        reference: expect.stringMatching(/^pcv_/)
      }
    })
  })

  it('creates and handles an official embedded checkout session without accepting client completion as merchant proof', async () => {
    const embeddedBusinessProfile: UcpProfile = {
      ucp: {
        ...businessProfile.ucp,
        services: {
          'dev.ucp.shopping': [
            ...businessProfile.ucp.services['dev.ucp.shopping'],
            {
              version,
              transport: 'embedded',
              endpoint: 'https://merchant.example/embedded-checkout'
            }
          ]
        }
      }
    }
    const embeddedNegotiation: UcpNegotiation = {
      ...negotiation,
      businessProfile: embeddedBusinessProfile
    }
    const embeddedCheckout: UcpCheckout = {
      ...checkout,
      continue_url: 'https://merchant.example/checkout/1',
      ucp: {
        ...checkout.ucp,
        services: { 'dev.ucp.shopping': [{ version, transport: 'embedded', config: { delegate: [] } }] }
      }
    }
    const session = {
      transactionId: 'txn_embedded_1',
      integrationId: principal.integrationId,
      ownerKeyId: principal.keyId,
      ownerPrincipalHash: principal.ownerPrincipalHash,
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      merchantOrigin: 'https://merchant.example',
      ucpVersion: version,
      checkoutId: checkout.id,
      idempotencyKeyHash: `sha256:${'2'.repeat(64)}`,
      requestFingerprint: `sha256:${'3'.repeat(64)}`,
      lastCheckoutStatus: checkout.status,
      checkoutSnapshotHash: `sha256:${'8'.repeat(64)}`,
      checkout: embeddedCheckout,
      businessProfile: embeddedBusinessProfile,
      negotiation: embeddedNegotiation,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
    const merchantCompletedCheckout: UcpCheckout = {
      ...checkout,
      status: 'completed',
      order: {
        id: 'ord_1',
        permalink_url: 'https://merchant.example/orders/ord_1'
      }
    }
    const embeddedEvents: Array<{ messageType: string; payload: unknown }> = []
    const revokePaymentResults = vi.fn().mockResolvedValue([])
    const revokeSiblingPaymentActions = vi.fn().mockResolvedValue(0)
    const consumeAp2Authorities = vi.fn().mockResolvedValue(0)
    const invalidateAp2Authorities = vi.fn().mockResolvedValue(0)
    const store = {
      ...createStore(),
      readSessionForPrincipal: vi.fn().mockResolvedValue(session),
      recordEmbeddedCheckoutMessage: vi.fn().mockImplementation(async (input) => {
        embeddedEvents.push({
          messageType: input.messageType,
          payload: input.payload
        })
      }),
      updateCheckout: vi.fn().mockImplementation(async (input: { checkout: UcpCheckout }) => ({
        ...session,
        checkout: input.checkout,
        checkoutSnapshotHash: ucpCheckoutSnapshotHash(input.checkout)
      })),
      revokePaymentResults,
      revokeSiblingPaymentActions,
      consumeAp2Authorities,
      invalidateAp2Authorities
    } satisfies UcpCheckoutStore
    const client = {
      getCheckout: vi.fn()
        .mockResolvedValueOnce(checkout)
        .mockResolvedValueOnce(merchantCompletedCheckout)
    } as unknown as UcpClient
    const service = createUcpCheckoutService({
      client,
      store,
      platformProfile,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      paymentActionSigningSecret: 'test-payment-action-signing-secret-at-least-32-chars'
    })

    const embedded = await service.createEmbeddedCheckoutSession('txn_embedded_1', {
      principal,
      allowedOrigin: 'https://host.example'
    })
    expect(embedded.embeddedCheckout.initParams).toMatchObject({
      ec_version: version,
      ec_delegate: ''
    })
    expect(embedded.embeddedCheckout.serviceConfig).toMatchObject({
      protocol: 'json-rpc-2.0',
      completionAuthority: 'merchant_checkout_state'
    })

    const ready = await service.handleEmbeddedCheckoutMessage({
      principal,
      transactionId: 'txn_embedded_1',
      sessionToken: embedded.embeddedCheckout.sessionToken,
      origin: 'https://host.example',
      message: {
        jsonrpc: '2.0',
        id: 'ready-1',
        method: 'ec.ready',
        params: { delegate: [] }
      }
    })
    expect(ready.response).toMatchObject({
      id: 'ready-1',
      result: {
        ucp: { version, status: 'success' }
      }
    })

    const changed = await service.handleEmbeddedCheckoutMessage({
      principal,
      transactionId: 'txn_embedded_1',
      sessionToken: embedded.embeddedCheckout.sessionToken,
      origin: 'https://host.example',
      message: {
        jsonrpc: '2.0',
        method: 'ec.totals.change',
        params: { checkout: embeddedCheckout }
      }
    })
    expect(changed.shouldRefreshCheckout).toBe(true)
    expect(changed.response).toBeUndefined()
    expect(client.getCheckout).toHaveBeenCalledTimes(1)

    const completed = await service.handleEmbeddedCheckoutMessage({
      principal,
      transactionId: 'txn_embedded_1',
      sessionToken: embedded.embeddedCheckout.sessionToken,
      origin: 'https://host.example',
      message: {
        jsonrpc: '2.0',
        method: 'ec.complete',
        params: { checkout: merchantCompletedCheckout }
      }
    })
    expect(completed.clientCompletionIgnored).toBe(true)
    expect(completed.response).toBeUndefined()
    expect(completed.checkout).toMatchObject({ status: 'completed', order: { id: 'ord_1' } })
    expect(revokePaymentResults).toHaveBeenCalledWith({
      transactionId: session.transactionId,
      reason: 'purchase_completed'
    })
    expect(revokeSiblingPaymentActions).toHaveBeenCalledWith({
      transactionId: session.transactionId,
      reason: 'purchase_completed'
    })
    expect(consumeAp2Authorities).not.toHaveBeenCalled()
    expect(invalidateAp2Authorities).toHaveBeenCalledWith({
      transactionId: session.transactionId,
      reason: 'checkout_changed'
    })
    expect(store.recordEmbeddedCheckoutMessage).toHaveBeenCalledWith(expect.objectContaining({
      messageType: 'ec.session.create'
    }))
    expect(embeddedEvents.map((event) => event.messageType)).toEqual([
      'ec.session.create',
      'ec.ready',
      'ec.totals.change',
      'ec.complete'
    ])
  })

  it('recovers an approved Stripe action with only its existing bound PaymentIntent', async () => {
    const stripeHandlerName = 'com.merchant.stripe'
    const stripeHandlerId = 'merchant_stripe_1'
    const stripeHandlerSpec = 'https://merchant.example/ucp/payment-handlers/com.merchant.stripe'
    const stripeHandlerSchema = `${stripeHandlerSpec}/schema.json`
    const stripeCheckout: UcpCheckout = {
      ...checkout,
      totals: [{ type: 'total', amount: 1495, currency: 'USD' }]
    }
    const stripeProfile: UcpProfile = {
      ucp: {
        ...businessProfile.ucp,
        payment_handlers: {
          [stripeHandlerName]: [{
            id: stripeHandlerId,
            version,
            spec: stripeHandlerSpec,
            schema: stripeHandlerSchema,
            available_instruments: [{ type: 'card' }],
            config: {
              environment: 'PRODUCTION',
              gateway: 'stripe',
              credential_type: 'stripe_payment_intent',
              endpoints: {
                native_session: `${stripeHandlerSpec}/native-session`,
                tokenize: `${stripeHandlerSpec}/tokenize`
              }
            }
          }]
        }
      }
    }
    const snapshotHash = ucpCheckoutSnapshotHash(stripeCheckout)
    const transactionId = 'txn_stripe_restart_recovery'
    const nonce = 'stripe-restart-recovery-nonce'
    const expiresAt = '2099-07-11T00:00:00.000Z'
    const actionId = 'arro_pa_stripe_restart_recovery'
    const session: UcpCheckoutSessionRecord = {
      transactionId,
      integrationId: principal.integrationId,
      ownerKeyId: principal.keyId,
      ownerPrincipalHash: principal.ownerPrincipalHash,
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      merchantOrigin: 'https://merchant.example',
      ucpVersion: version,
      checkoutId: stripeCheckout.id,
      idempotencyKeyHash: `sha256:${'2'.repeat(64)}`,
      requestFingerprint: `sha256:${'3'.repeat(64)}`,
      lastCheckoutStatus: stripeCheckout.status,
      checkoutSnapshotHash: snapshotHash,
      checkout: stripeCheckout,
      businessProfile: stripeProfile,
      negotiation: negotiationFor(stripeProfile),
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
    const payload: PaymentActionTokenPayload = {
      v: 1,
      actionId,
      transactionId,
      integrationId: principal.integrationId,
      ownerKeyId: principal.keyId,
      ownerPrincipalHash: principal.ownerPrincipalHash,
      merchantOrigin: session.merchantOrigin,
      checkoutId: session.checkoutId,
      checkoutSnapshotHash: snapshotHash,
      handlerId: stripeHandlerId,
      handlerName: stripeHandlerName,
      handlerVersion: version,
      handlerSpecification: stripeHandlerSpec,
      handlerSchema: stripeHandlerSchema,
      provider: stripeHandlerName,
      expiresAt,
      nonce
    }
    const storedAction: UcpPaymentActionRecord = {
      actionId,
      transactionId,
      integrationId: principal.integrationId,
      ownerKeyId: principal.keyId,
      ownerPrincipalHash: principal.ownerPrincipalHash,
      merchantOrigin: session.merchantOrigin,
      checkoutId: session.checkoutId,
      checkoutSnapshotHash: snapshotHash,
      handlerId: stripeHandlerId,
      handlerName: stripeHandlerName,
      handlerVersion: version,
      handlerSpecification: stripeHandlerSpec,
      handlerSchema: stripeHandlerSchema,
      provider: stripeHandlerName,
      route: 'processor_tokenizer',
      presentation: 'host_native',
      providerReferenceId: 'pi_checkout_restart_123',
      actionType: 'processor_tokenizer',
      status: 'approved',
      amount: 1495,
      currency: 'USD',
      tokenNonceHash: paymentActionNonceHash(nonce),
      actionPayload: { kind: 'stripe_payment_sheet', presentation: 'host_native' },
      expiresAt,
      approvedAt: '2026-07-11T00:00:00.000Z',
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    }
    const stripeSession = {
      provider: 'stripe' as const,
      livemode: true as const,
      publishableKey: 'pk_live_merchant_123',
      paymentIntentClientSecret: 'pi_checkout_restart_123_secret_checkout_456',
      paymentIntentId: 'pi_checkout_restart_123',
      merchantDisplayName: 'Merchant Example',
      merchantCountryCode: 'US',
      currency: 'USD',
      amount: 1495,
      captureMethod: 'manual' as const,
      paymentMethodTypes: ['card'] as ['card'],
      allowedCardBrands: ['visa', 'mastercard'] as ['visa', 'mastercard'],
      expiresAt: '2099-07-10T00:00:00.000Z'
    }
    const bindPaymentActionProviderReference = vi.fn().mockResolvedValue(storedAction)
    const createStripeSession = vi.fn().mockResolvedValue(stripeSession)
    const store = {
      ...createStore(),
      readSessionForPrincipal: vi.fn().mockResolvedValue(session),
      readPaymentAction: vi.fn().mockResolvedValue(storedAction),
      updateCheckout: vi.fn().mockResolvedValue(session),
      bindPaymentActionProviderReference
    } satisfies UcpCheckoutStore
    const service = createUcpCheckoutService({
      client: {
        getCheckout: vi.fn().mockResolvedValue(stripeCheckout)
      } as unknown as UcpClient,
      store,
      platformProfile,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      paymentActionSigningSecret,
      publicBaseUrl: 'https://arro.example',
      paymentHandlerRegistry: createPaymentHandlerRegistry([{
        adapterKind: 'processor_tokenizer',
        handlerName: stripeHandlerName,
        executionMode: 'client',
        supports: () => true
      }]),
      stripeNativePaymentSessionClient: {
        create: createStripeSession
      }
    })
    const actionToken = signPaymentActionToken(payload, paymentActionSigningSecret)

    await expect(service.createPaymentActionSession({ actionToken })).resolves.toEqual(stripeSession)
    expect(createStripeSession).toHaveBeenCalledWith({
      action: storedAction,
      checkout: stripeCheckout,
      declaration: stripeProfile.ucp.payment_handlers?.[stripeHandlerName]?.[0]
    })
    expect(bindPaymentActionProviderReference).not.toHaveBeenCalled()
  })
})
