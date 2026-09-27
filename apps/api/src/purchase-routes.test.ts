import { describe, expect, it, vi } from 'vitest'
import { Elysia } from 'elysia'
import { buildApp } from './app.ts'
import type { PurchaseOrchestrator } from './purchase-orchestrator.ts'
import { createAgentSessionToken } from './agent-session.ts'
import type { PurchaseMandate, PurchaseMandateRepository } from './purchase-mandate.ts'
import type { CommerceBuyerProfileStore } from './commerce-buyer-profile.ts'
import type { AutonomousPurchaseJobRepository } from './autonomous-purchase-jobs.ts'
import { createAgentHostRegistry } from './agent-host-registry.ts'
import type { PurchaseStepUpRepository } from './purchase-step-up.ts'

const principal = {
  keyId: 'test-key',
  ownerPrincipal: 'purchase-route-test',
  scopes: ['write:purchase', 'read:purchase', 'write:complete_purchase'],
  environment: 'test'
}

const signingSecret = 'purchase-route-test-agent-session-signing-secret-32'
const sessionExpiresAt = () => new Date(Date.now() + 10 * 60 * 1000).toISOString()
const agentContext = (
  requestedActionScope: 'write:purchase' | 'write:complete_purchase' | 'read:purchase',
  surface: 'direct_http' | 'generic_mcp' = 'direct_http'
) => {
  const expiresAt = sessionExpiresAt()
  const issued = createAgentSessionToken({
    request: {
      integrationId: 'purchase-route-test',
      surface,
      allowedActionScopes: ['write:purchase', 'write:complete_purchase', 'read:purchase'],
      sessionExpiresAt: expiresAt,
      hostCapabilities: [
        'source_labels',
        'freshness',
        'caveats',
        'no_buy_warnings',
        'commercial_disclosures',
        'authority_limits',
        'allowed_next_actions'
      ]
    },
    signingSecret,
    maxTtlSeconds: 900
  })
  if (!issued.ok) throw new Error(issued.message)
  return {
    integrationId: 'purchase-route-test',
    surface,
    requestedActionScope,
    sessionExpiresAt: expiresAt,
    sessionToken: issued.session.sessionToken,
    hostCapabilities: [
      'source_labels',
      'freshness',
      'caveats',
      'no_buy_warnings',
      'commercial_disclosures',
      'authority_limits',
      'allowed_next_actions'
    ]
  }
}

const request = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'route-idempotency-key'
    },
    body: JSON.stringify(body)
  })

const agentHeaders = (requestedActionScope: 'write:purchase' | 'write:complete_purchase' | 'read:purchase') => {
  const context = agentContext(requestedActionScope)
  return {
    'x-arro-agent-integration-id': context.integrationId,
    'x-arro-agent-surface': context.surface,
    'x-arro-agent-session-token': context.sessionToken,
    'x-arro-agent-session-expires-at': context.sessionExpiresAt,
    'x-arro-agent-host-capabilities': context.hostCapabilities.join(',')
  }
}

const jsonRequest = (
  path: string,
  method: 'GET' | 'PUT' | 'POST' | 'PATCH',
  body?: unknown,
  headers: Record<string, string> = {}
) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  })

describe('purchase routes launch surface', () => {
  it('passes caller idempotency through unchanged across transient HTTP retry metadata', async () => {
    const idempotencyKeys: string[] = []
    const purchases = {
      preparePurchase: vi.fn().mockImplementation(async (input) => {
        idempotencyKeys.push(input.idempotencyKey)
        return {
          purchaseId: 'purchase_retry_1',
          state: 'merchant_continuation_required',
          executionLevel: 'hosted_checkout',
          merchant: {
            merchantId: 'https://merchant.example',
            canonicalOrigin: 'https://merchant.example',
            profileUrl: 'https://merchant.example/.well-known/ucp'
          },
          items: [{ itemId: 'sku_65w_charger', quantity: 1 }],
          payment: {
            completedByArro: false,
            executionLevel: 'hosted_checkout'
          },
          nextAction: {
            type: 'continue_on_merchant',
            label: 'Continue on merchant',
            url: 'https://merchant.example/checkout/chk_1'
          }
        }
      })
    } as unknown as PurchaseOrchestrator
    const app = buildApp(new Elysia(), {
      purchaseOrchestrator: purchases,
      commercePrincipalHashPepper: 'test-commerce-principal-hash-pepper-at-least-32',
      agentSessionSigningSecret: signingSecret,
      rateLimitProtectedRequest: async () => ({
        allowed: true,
        limit: 10,
        remaining: 9,
        resetAt: '2026-07-12T00:01:00.000Z'
      }),
      authenticate: async () => ({
        ok: true,
        decision: 'allowed',
        principal
      })
    })

    const body = {
      merchantDomain: 'merchant.example',
      selectedOffer: {
        itemId: 'sku_65w_charger',
        quantity: 1,
        title: '65W USB-C Charger',
        url: 'https://merchant.example/products/charger'
      },
      agentContext: agentContext('write:purchase')
    }

    for (const [requestId, correlationId, traceparent] of [
      ['http-retry-1', 'corr-retry-1', '00-11111111111111111111111111111111-1111111111111111-01'],
      ['http-retry-2', 'corr-retry-2', '00-22222222222222222222222222222222-2222222222222222-01']
    ]) {
      const response = await app.handle(new Request('http://localhost/v1/purchases/prepare', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': 'same-business-mutation',
          'x-request-id': requestId,
          'x-correlation-id': correlationId,
          traceparent
        },
        body: JSON.stringify(body)
      }))
      expect(response.status).toBe(200)
    }

    expect(idempotencyKeys).toEqual(['same-business-mutation', 'same-business-mutation'])
  })

  it('does not expose partial official Embedded Checkout routes in the active API', async () => {
    const purchases = {
      createEmbeddedCheckoutSession: vi.fn(),
      handleEmbeddedCheckoutMessage: vi.fn()
    } as unknown as PurchaseOrchestrator
    const app = buildApp(new Elysia(), {
      purchaseOrchestrator: purchases,
      commercePrincipalHashPepper: 'test-commerce-principal-hash-pepper-at-least-32',
      agentSessionSigningSecret: signingSecret,
      rateLimitProtectedRequest: async () => ({
        allowed: true,
        limit: 10,
        remaining: 9,
        resetAt: '2026-07-12T00:01:00.000Z'
      }),
      authenticate: async () => ({
        ok: true,
        decision: 'allowed',
        principal
      })
    })

    const sessionResponse = await app.handle(request('/v1/purchases/purchase_1/embedded/sessions', {
      allowedOrigin: 'https://host.example'
    }))
    expect(sessionResponse.status).toBe(404)
    expect(purchases.createEmbeddedCheckoutSession).not.toHaveBeenCalled()

    const messageResponse = await app.handle(jsonRequest('/v1/purchases/purchase_1/embedded/messages', 'POST', {
      sessionToken: 'arro_ec1_signed_embedded_session_token_1',
      message: {
        jsonrpc: '2.0',
        id: 'ready-1',
        method: 'ec.ready',
        params: {
          ec_session_id: 'ecs_1',
          ec_channel_id: 'ecc_1'
        }
      }
    }))
    expect(messageResponse.status).toBe(404)
    expect(purchases.handleEmbeddedCheckoutMessage).not.toHaveBeenCalled()
  })

  it('exposes the official Embedded Checkout HTTP lifecycle only to an authorized registered component host', async () => {
    const createEmbeddedCheckoutSession = vi.fn().mockResolvedValue({
      purchaseId: 'purchase_1',
      embeddedCheckout: {
        sessionToken: 'arro_ec1_signed_embedded_session_token_1',
        initParams: {
          ec_session_id: 'ecs_1',
          ec_channel_id: 'ecc_1',
          ec_origin: 'https://host.example',
          ec_checkout_id: 'chk_1',
          ec_merchant_origin: 'https://merchant.example'
        }
      }
    })
    const handleEmbeddedCheckoutMessage = vi.fn().mockResolvedValue({
      jsonrpc: '2.0',
      id: 'ready-1',
      result: { ready: true }
    })
    const purchases = {
      createEmbeddedCheckoutSession,
      handleEmbeddedCheckoutMessage
    } as unknown as PurchaseOrchestrator
    const app = buildApp(new Elysia(), {
      purchaseOrchestrator: purchases,
      commercePrincipalHashPepper: 'test-commerce-principal-hash-pepper-at-least-32',
      agentSessionSigningSecret: signingSecret,
      embeddedCheckoutRuntimeEnabled: true,
      agentHostRegistry: createAgentHostRegistry([{
        hostId: 'embedded-route-host',
        integrationId: 'agent:test-key:purchase-route-test',
        allowedScopes: ['read:purchase', 'write:purchase', 'write:complete_purchase'],
        presentationModes: ['embedded_component'],
        paymentProviderKinds: ['google_pay'],
        authorizationProviderKinds: ['user_approval_action'],
        componentProtocols: ['ucp.embedded_checkout.v1'],
        allowedComponentOrigins: ['https://host.example'],
        allowedReturnOrigins: ['https://host.example'],
        canReceiveAsyncPurchaseUpdates: true,
        thirdPartyPaymentEmbeddingAllowed: true,
        autonomousExecutionAllowed: false
      }]),
      rateLimitProtectedRequest: async () => ({
        allowed: true,
        limit: 10,
        remaining: 9,
        resetAt: '2026-07-12T00:01:00.000Z'
      }),
      authenticate: async () => ({
        ok: true,
        decision: 'allowed',
        principal
      })
    })
    const context = agentContext('write:purchase')
    const sessionResponse = await app.handle(request('/v1/purchases/purchase_1/embedded/sessions', {
      allowedOrigin: 'https://host.example',
      agentContext: context
    }))
    expect(sessionResponse.status).toBe(200)
    expect(createEmbeddedCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      id: 'purchase_1',
      allowedOrigin: 'https://host.example'
    }))

    const messageResponse = await app.handle(jsonRequest('/v1/purchases/purchase_1/embedded/messages', 'POST', {
      sessionToken: 'arro_ec1_signed_embedded_session_token_1',
      message: {
        jsonrpc: '2.0',
        id: 'ready-1',
        method: 'ec.ready',
        params: {
          ec_session_id: 'ecs_1',
          ec_channel_id: 'ecc_1'
        }
      },
      agentContext: context
    }, {
      'idempotency-key': 'route-idempotency-key',
      origin: 'https://host.example'
    }))
    expect(messageResponse.status, await messageResponse.clone().text()).toBe(200)
    expect(handleEmbeddedCheckoutMessage).toHaveBeenCalledWith(expect.objectContaining({
      id: 'purchase_1',
      origin: 'https://host.example',
      sessionToken: 'arro_ec1_signed_embedded_session_token_1'
    }))

    const rejectedOriginResponse = await app.handle(jsonRequest('/v1/purchases/purchase_1/embedded/messages', 'POST', {
      sessionToken: 'arro_ec1_signed_embedded_session_token_1',
      message: {
        jsonrpc: '2.0',
        id: 'ready-2',
        method: 'ec.ready',
        params: {
          ec_session_id: 'ecs_1',
          ec_channel_id: 'ecc_1'
        }
      },
      agentContext: context
    }, {
      'idempotency-key': 'route-idempotency-key-2',
      origin: 'https://attacker.example'
    }))
    expect(rejectedOriginResponse.status).toBe(403)
    expect(handleEmbeddedCheckoutMessage).toHaveBeenCalledTimes(1)
  })

  it('rejects public caller-supplied payment host authority', async () => {
    const purchases = {
      createPaymentAction: vi.fn()
    } as unknown as PurchaseOrchestrator
    const app = buildApp(new Elysia(), {
      purchaseOrchestrator: purchases,
      commercePrincipalHashPepper: 'test-commerce-principal-hash-pepper-at-least-32',
      agentSessionSigningSecret: signingSecret,
      rateLimitProtectedRequest: async () => ({
        allowed: true,
        limit: 10,
        remaining: 9,
        resetAt: '2026-07-12T00:01:00.000Z'
      }),
      authenticate: async () => ({
        ok: true,
        decision: 'allowed',
        principal
      })
    })

    const response = await app.handle(request('/v1/purchases/purchase_1/payment-actions', {
      preference: {
        mode: 'host_supplied'
      },
      agentContext: agentContext('write:purchase'),
      hostCapabilities: {
        hostId: 'fake-hermes',
        integrationId: 'api-key:test-key',
        surfaces: ['host_native'],
        providerKinds: ['trusted_host']
      },
      trustedHostContext: {
        hostId: 'fake-hermes',
        integrationId: 'api-key:test-key',
        issuer: 'https://fake-host.example',
        audience: 'https://arro.example',
        keyId: 'fake-key',
        capabilities: {
          hostId: 'fake-hermes',
          integrationId: 'api-key:test-key',
          surfaces: ['host_native'],
          providerKinds: ['trusted_host']
        },
        attestedAt: '2026-07-12T00:00:00.000Z',
        expiresAt: '2026-07-12T00:10:00.000Z'
      }
    }))

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'validation_failed'
      }
    })
    expect(purchases.createPaymentAction).not.toHaveBeenCalled()
  })

  it('creates mandate authorization actions without returning agent-held bearer approval tokens', async () => {
    const draftMandates = new Map<string, Record<string, unknown>>()
    const action = {
      actionId: 'arro_ma_route_test_action',
      mandateId: '',
      mandateVersion: 1,
      authorizationHash: '',
      mode: 'trusted_host_signature' as const,
      status: 'pending' as const,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
    }
    const mandates = {
      createDraft: vi.fn(async (mandate) => {
        draftMandates.set(mandate.mandateId, mandate as unknown as Record<string, unknown>)
        action.mandateId = mandate.mandateId
        return mandate
      }),
      createAuthorizationAction: vi.fn(async (input) => {
        action.authorizationHash = input.authorizationHash
        action.mode = input.mode
        return action
      }),
      read: vi.fn(async (mandateId) => {
        const mandate = draftMandates.get(mandateId)
        return mandate ? { mandate, totalReservedMinor: '0', totalCommittedMinor: '0', useCount: 0 } : undefined
      }),
      readAuthorizationAction: vi.fn(async () => action),
      authorize: vi.fn(async (input) => {
        const mandate = draftMandates.get(input.mandateId)!
        action.status = 'consumed' as never
        return {
          ...mandate,
          status: 'active',
          authorization: input.authorization
        }
      })
    } as unknown as PurchaseMandateRepository
    const verifier = {
      verify: vi.fn()
    }
    const app = buildApp(new Elysia(), {
      purchaseMandateRepository: mandates,
      trustedHostMandateAuthorizationVerifier: verifier,
      commercePrincipalHashPepper: 'test-commerce-principal-hash-pepper-at-least-32',
      agentSessionSigningSecret: signingSecret,
      rateLimitProtectedRequest: async () => ({
        allowed: true,
        limit: 10,
        remaining: 9,
        resetAt: '2026-07-12T00:01:00.000Z'
      }),
      authenticate: async () => ({
        ok: true,
        decision: 'allowed',
        principal
      })
    })

    const mandateAgentContext = agentContext('write:complete_purchase')
    const createResponse = await app.handle(request('/v1/purchase-mandates', {
      intentDescription: 'Buy a charger later under delegated authority.',
      merchantOrigin: 'https://merchant.example',
      productId: 'sku_65w_charger',
      currency: 'USD',
      maximumPerTransactionMinor: '5000',
      maximumTotalSpendMinor: '5000',
      useLimit: 1,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      authorizationProvider: 'trusted_host_signature',
      agentContext: mandateAgentContext
    }))
    expect(createResponse.status).toBe(200)
    const createBody = await createResponse.json() as Record<string, any>
    expect(createBody.approvalAction.actionId).toBe('arro_ma_route_test_action')
    expect(createBody.approvalAction.approvalActionToken).toBeUndefined()

    const selfAuthorizeResponse = await app.handle(request(`/v1/purchase-mandates/${createBody.mandate.mandateId}/authorize`, {
      mode: 'user_approval_action',
      approvalActionToken: 'arro_ma_agent_held_secret',
      agentContext: mandateAgentContext
    }))
    expect(selfAuthorizeResponse.status).toBe(422)

    const authorizeResponse = await app.handle(request(`/v1/purchase-mandates/${createBody.mandate.mandateId}/authorize`, {
      mode: 'trusted_host_signature',
      approvalActionId: 'arro_ma_route_test_action',
      evidence: {
        trustedHostSignature: 'signed-user-presence-proof'
      },
      agentContext: mandateAgentContext
    }))
    expect(authorizeResponse.status).toBe(200)
    expect(verifier.verify).toHaveBeenCalledWith(expect.objectContaining({
      attestation: 'signed-user-presence-proof'
    }))
  })

  it('stores and reads only safe owner-scoped buyer profile metadata', async () => {
    let saved: Awaited<ReturnType<CommerceBuyerProfileStore['upsert']>> | undefined
    const buyerProfiles = {
      read: vi.fn(async () => saved),
      upsert: vi.fn(async ({ principal, profile }) => {
        saved = {
          ownerId: principal.ownerPrincipalHash,
          ...profile
        }
        return saved
      })
    } as CommerceBuyerProfileStore
    const app = buildApp(new Elysia(), {
      commerceBuyerProfileStore: buyerProfiles,
      commercePrincipalHashPepper: 'test-commerce-principal-hash-pepper-at-least-32',
      agentSessionSigningSecret: signingSecret,
      rateLimitProtectedRequest: async () => ({
        allowed: true,
        limit: 10,
        remaining: 9,
        resetAt: '2026-07-12T00:01:00.000Z'
      }),
      authenticate: async () => ({
        ok: true,
        decision: 'allowed',
        principal
      })
    })

    const profile = {
      email: 'shopper@example.com',
      countryCode: 'US',
      shippingAddresses: [
        {
          addressId: 'home',
          recipientName: 'Arro Shopper',
          line1: '1 Market St',
          city: 'San Francisco',
          region: 'CA',
          postalCode: '94105',
          countryCode: 'US'
        }
      ],
      defaultShippingAddressId: 'home',
      safePaymentReferences: [
        {
          provider: 'trusted_host',
          referenceId: 'display-only-card-ref',
          brand: 'Visa',
          last4: '4242',
          status: 'active'
        }
      ]
    }

    const upsertResponse = await app.handle(jsonRequest(
      '/v1/buyer-profile',
      'PUT',
      profile,
      agentHeaders('write:purchase')
    ))
    expect(upsertResponse.status).toBe(200)
    const upsertBody = await upsertResponse.json() as Record<string, unknown>
    expect(upsertBody).toMatchObject({
      email: 'shopper@example.com',
      defaultShippingAddressId: 'home'
    })
    expect(JSON.stringify(upsertBody).toLowerCase()).not.toContain('cvv')
    expect(buyerProfiles.upsert).toHaveBeenCalledWith(expect.objectContaining({
      principal: expect.objectContaining({
        integrationId: 'agent:test-key:purchase-route-test'
      })
    }))

    const getResponse = await app.handle(jsonRequest('/v1/buyer-profile', 'GET'))
    expect(getResponse.status).toBe(200)
    await expect(getResponse.json()).resolves.toMatchObject({
      email: 'shopper@example.com',
      ownerId: expect.stringMatching(/^sha256:/)
    })
  })

  it('creates active-mandate jobs and supports explicit cancellation plus mandate-wide revocation', async () => {
    const activeMandateFor = (routePrincipal: Parameters<PurchaseMandateRepository['read']>[1]): PurchaseMandate => ({
      mandateId: 'pm_route_jobs',
      ownerId: `${routePrincipal.keyId}:${routePrincipal.ownerPrincipalHash}`,
      integrationId: routePrincipal.integrationId,
      version: 1,
      status: 'active',
      authorizationProvider: 'trusted_host_signature',
      intent: {
        description: 'Buy one charger when conditions pass.',
        productIds: ['sku_65w_charger'],
        quantityMaximum: 1,
        substitutionPolicy: 'forbidden'
      },
      merchantPolicy: {
        allowedMerchantOrigins: ['https://merchant.example']
      },
      financialPolicy: {
        currency: 'USD',
        maximumPerTransactionMinor: '5000',
        maximumTotalSpendMinor: '5000',
        useLimit: 1
      },
      fulfillmentPolicy: {},
      executionPolicy: {
        humanConfirmation: 'never_within_mandate',
        stepUpAllowed: true,
        challengeBehavior: 'request_user'
      },
      validFrom: '2026-07-12T00:00:00.000Z',
      expiresAt: '2099-07-12T01:00:00.000Z',
      authorization: {
        scheme: 'arro-purchase-mandate-authorization-v1',
        issuer: 'agent:test-key:purchase-route-test',
        subject: 'subject',
        evidenceHash: 'sha256:evidence',
        authorizationHash: 'sha256:authorization',
        mode: 'trusted_host_signature',
        authorizedAt: '2026-07-12T00:00:01.000Z'
      }
    })
    const mandates = {
      read: vi.fn(async (_mandateId, routePrincipal) => ({
        mandate: activeMandateFor(routePrincipal),
        totalReservedMinor: '0',
        totalCommittedMinor: '0',
        useCount: 0
      })),
      revoke: vi.fn()
    } as unknown as PurchaseMandateRepository
    const jobs = {
      create: vi.fn(async ({ mandate, trigger, authorizationRoute, hostId }) => ({
        jobId: 'apj_route_jobs',
        ownerId: mandate.ownerId,
        integrationId: mandate.integrationId,
        authorizationRoute,
        hostId,
        mandateId: mandate.mandateId,
        mandateVersion: mandate.version,
        status: 'scheduled' as const,
        trigger,
        attemptCount: 0,
        nextAttemptAt: '2026-07-12T00:00:00.000Z'
      })),
      listForMandate: vi.fn(async () => []),
      cancelJob: vi.fn(async ({ mandateId, jobId }) => ({
        jobId,
        ownerId: 'test-key:sha256:owner',
        integrationId: 'agent:test-key:purchase-route-test',
        authorizationRoute: 'trusted_host' as const,
        hostId: 'purchase-route-test-host',
        mandateId,
        mandateVersion: 1,
        status: 'cancelled' as const,
        trigger: { type: 'immediate' as const },
        attemptCount: 0
      })),
      cancelForMandate: vi.fn(async () => 1)
    } as unknown as AutonomousPurchaseJobRepository
    const app = buildApp(new Elysia(), {
      purchaseMandateRepository: mandates,
      autonomousPurchaseJobRepository: jobs,
      autonomousPurchasesEnabled: true,
      primaryAutonomousRoute: 'trusted_host',
      agentHostRegistry: createAgentHostRegistry([
        {
          hostId: 'purchase-route-test-host',
          integrationId: 'agent:test-key:purchase-route-test',
          allowedScopes: ['write:purchase', 'write:complete_purchase', 'read:purchase'],
          presentationModes: ['host_native', 'merchant_hosted'],
          paymentProviderKinds: ['trusted_host', 'merchant_hosted'],
          authorizationProviderKinds: ['trusted_host_signature'],
          handlerNames: ['com.example.processor_tokenizer'],
          canReceiveAsyncPurchaseUpdates: true,
          thirdPartyPaymentEmbeddingAllowed: false,
          autonomousExecutionAllowed: true
        }
      ]),
      commercePrincipalHashPepper: 'test-commerce-principal-hash-pepper-at-least-32',
      agentSessionSigningSecret: signingSecret,
      rateLimitProtectedRequest: async () => ({
        allowed: true,
        limit: 10,
        remaining: 9,
        resetAt: '2026-07-12T00:01:00.000Z'
      }),
      authenticate: async () => ({
        ok: true,
        decision: 'allowed',
        principal
      })
    })

    const createResponse = await app.handle(request('/v1/purchase-mandates/pm_route_jobs/jobs', {
      trigger: { type: 'immediate' },
      agentContext: agentContext('write:complete_purchase')
    }))
    expect(createResponse.status).toBe(200)
    await expect(createResponse.json()).resolves.toMatchObject({
      jobId: 'apj_route_jobs',
      mandateId: 'pm_route_jobs',
      authorizationRoute: 'trusted_host',
      hostId: 'purchase-route-test-host',
      status: 'scheduled'
    })
    expect(jobs.create).toHaveBeenCalledWith(expect.objectContaining({
      mandate: expect.objectContaining({
        status: 'active'
      }),
      trigger: { type: 'immediate' },
      authorizationRoute: 'trusted_host',
      hostId: 'purchase-route-test-host'
    }))

    const cancelResponse = await app.handle(request('/v1/purchase-mandates/pm_route_jobs/jobs/apj_route_jobs/cancel', {
      reason: 'shopper cancelled scheduled purchase',
      agentContext: agentContext('write:complete_purchase')
    }))
    expect(cancelResponse.status).toBe(200)
    await expect(cancelResponse.json()).resolves.toMatchObject({
      jobId: 'apj_route_jobs',
      mandateId: 'pm_route_jobs',
      status: 'cancelled'
    })
    expect(jobs.cancelJob).toHaveBeenCalledWith(expect.objectContaining({
      mandateId: 'pm_route_jobs',
      jobId: 'apj_route_jobs',
      principal: expect.objectContaining({
        integrationId: 'agent:test-key:purchase-route-test'
      })
    }))

    const revokeResponse = await app.handle(jsonRequest('/v1/purchase-mandates/pm_route_jobs', 'PATCH', {
      status: 'revoked',
      agentContext: agentContext('write:complete_purchase')
    }))
    expect(revokeResponse.status).toBe(200)
    await expect(revokeResponse.json()).resolves.toMatchObject({
      mandateId: 'pm_route_jobs',
      status: 'revoked',
      cancelledAutonomousJobs: 1
    })
    expect(mandates.revoke).toHaveBeenCalled()
    expect(jobs.cancelForMandate).toHaveBeenCalledWith(expect.objectContaining({
      mandateId: 'pm_route_jobs'
    }))
  })

  it('approves an exact step-up and resumes the same durable purchase job', async () => {
    const snapshotHash = `sha256:${'7'.repeat(64)}`
    const action = {
      actionId: 'psu_route_1',
      purchaseId: 'purchase_route_step_up',
      jobId: 'apj_route_step_up',
      mandateId: 'pm_route_step_up',
      mandateVersion: 1,
      merchantOrigin: 'https://merchant.example',
      checkoutId: 'checkout_route_step_up',
      checkoutSnapshotHash: snapshotHash,
      amountMinor: '5299',
      currency: 'USD',
      items: [{ itemId: 'sku_65w_charger', quantity: 1 }],
      reasonCode: 'amount_exceeds_confirmation_threshold',
      requestedAction: 'approve_current_checkout',
      status: 'pending' as const,
      expiresAt: '2099-07-12T00:00:00.000Z',
      display: {
        title: 'Purchase needs your approval',
        merchantOrigin: 'https://merchant.example',
        amountMinor: '5299',
        currency: 'USD',
        items: [{ itemId: 'sku_65w_charger', quantity: 1 }],
        reasonCode: 'amount_exceeds_confirmation_threshold',
        decisions: ['approve', 'reject'] as Array<'approve' | 'reject'>,
        expiresAt: '2099-07-12T00:00:00.000Z'
      }
    }
    const stepUps = {
      read: vi.fn(async () => action),
      decide: vi.fn(async (input) => ({
        ...action,
        status: input.decision === 'approve' ? 'approved' : 'rejected',
        decisionRef: input.decisionRef
      })),
      invalidateForPurchase: vi.fn(async () => 0)
    } as unknown as PurchaseStepUpRepository
    const jobs = {
      resumeAfterStepUp: vi.fn(async () => ({
        jobId: action.jobId,
        ownerId: 'test-key:sha256:owner',
        integrationId: 'agent:test-key:purchase-route-test',
        mandateId: action.mandateId,
        mandateVersion: 1,
        status: 'scheduled' as const,
        trigger: { type: 'immediate' as const },
        attemptCount: 2,
        purchaseId: action.purchaseId
      }))
    } as unknown as AutonomousPurchaseJobRepository
    const purchases = {
      getPurchase: vi.fn(async () => ({
        purchaseId: action.purchaseId,
        state: 'payment_action_required' as const,
        executionLevel: 'direct_payment' as const,
        merchant: {
          merchantId: 'https://merchant.example',
          canonicalOrigin: 'https://merchant.example',
          profileUrl: 'https://merchant.example/.well-known/ucp'
        },
        items: action.items,
        payment: { completedByArro: false, executionLevel: 'direct_payment' as const },
        checkoutSnapshotHash: snapshotHash,
        messages: []
      }))
    } as unknown as PurchaseOrchestrator
    const verifyStepUp = vi.fn(() => 'host-step-up-jti-1')
    const app = buildApp(new Elysia(), {
      purchaseOrchestrator: purchases,
      purchaseStepUpRepository: stepUps,
      autonomousPurchaseJobRepository: jobs,
      trustedHostMandateAuthorizationVerifier: {
        verify: vi.fn(),
        verifyStepUp
      },
      commercePrincipalHashPepper: 'test-commerce-principal-hash-pepper-at-least-32',
      agentSessionSigningSecret: signingSecret,
      rateLimitProtectedRequest: async () => ({
        allowed: true,
        limit: 10,
        remaining: 9,
        resetAt: '2026-07-12T00:01:00.000Z'
      }),
      authenticate: async () => ({
        ok: true,
        decision: 'allowed',
        principal
      })
    })

    const response = await app.handle(jsonRequest(
      `/v1/purchases/${action.purchaseId}/step-up/${action.actionId}/decision`,
      'POST',
      {
        decision: 'approve',
        evidence: { trustedHostSignature: 'signed-user-presence-attestation' },
        agentContext: agentContext('write:complete_purchase')
      }
    ))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      action: { actionId: action.actionId, status: 'approved' },
      job: { jobId: action.jobId, status: 'scheduled', purchaseId: action.purchaseId }
    })
    expect(verifyStepUp).toHaveBeenCalledWith(expect.objectContaining({
      action: expect.objectContaining({ checkoutSnapshotHash: snapshotHash }),
      decision: 'approve'
    }))
    expect(jobs.resumeAfterStepUp).toHaveBeenCalledWith(expect.objectContaining({
      jobId: action.jobId,
      purchaseId: action.purchaseId
    }))
  })

  it('wires public HTTP x402 and MCP MPP payment lifecycles without leaking handler internals', async () => {
    const completedPurchase = (purchaseId: string) => ({
      purchaseId,
      state: 'completed' as const,
      executionLevel: 'direct_payment' as const,
      merchant: { merchantId: 'https://merchant.example', canonicalOrigin: 'https://merchant.example', profileUrl: 'https://merchant.example/.well-known/ucp' },
      items: [{ itemId: 'sku_65w_charger', quantity: 1 }],
      payment: { completedByArro: true, executionLevel: 'direct_payment' as const },
      checkoutStatus: 'completed' as const,
      checkoutSnapshotHash: `sha256:${'a'.repeat(64)}`,
      messages: [{ severity: 'info' as const, text: 'Merchant returned an Order.' }],
      nextAction: { type: 'view_order' as const, label: 'View merchant order', url: `https://merchant.example/orders/order_${purchaseId}` }
    })
    const purchases = {
      createPaymentAction: vi.fn(async (input: Parameters<PurchaseOrchestrator['createPaymentAction']>[0]) => {
        const protocol = input.preference?.mode as 'x402' | 'mpp'
        return {
          actionId: `action_${protocol}`,
          purchaseId: input.id,
          status: 'pending_user_approval' as const,
          actionType: protocol,
          provider: `dev.arro.payment.${protocol}`,
          handlerId: `merchant_${protocol}`,
          handlerName: `dev.arro.payment.${protocol}`,
          merchantOrigin: 'https://merchant.example',
          checkoutId: `checkout_${input.id}`,
          checkoutSnapshotHash: `sha256:${'a'.repeat(64)}`,
          expiresAt: '2099-07-13T12:00:00.000Z',
          actionToken: `arro_pa1_${protocol}_${'1'.repeat(32)}`,
          action: { kind: 'portable_payment_action', protocol, challenge: { id: `challenge_${protocol}` } },
          message: `Provide one checkout-scoped ${protocol} credential.`
        }
      }),
      recordPaymentActionResult: vi.fn(async (input: Parameters<PurchaseOrchestrator['recordPaymentActionResult']>[0]) => {
        return completedPurchase(input.actionToken.includes('mpp') ? 'purchase_mpp' : 'purchase_x402')
      }),
      confirmPurchase: vi.fn(async (input: Parameters<PurchaseOrchestrator['confirmPurchase']>[0]) => completedPurchase(input.id))
    } as unknown as PurchaseOrchestrator
    const allowRequest = async () => ({
      allowed: true,
      limit: 100,
      remaining: 99,
      resetAt: '2026-07-12T00:01:00.000Z'
    })
    const app = buildApp(new Elysia(), {
      purchaseOrchestrator: purchases,
      commercePrincipalHashPepper: 'test-commerce-principal-hash-pepper-at-least-32',
      agentSessionSigningSecret: signingSecret,
      rateLimitProtectedRequest: allowRequest,
      rateLimitPublicRequest: allowRequest,
      authenticate: async () => ({ ok: true, decision: 'allowed', principal })
    })
    const post = async (path: string, body: unknown, key: string) => {
      const response = await app.handle(jsonRequest(path, 'POST', body, { 'idempotency-key': key }))
      return { status: response.status, body: await response.json() as Record<string, unknown> }
    }

    const x402Action = await post('/v1/purchases/purchase_x402/payment-actions', {
      portableCapabilities: [{
        protocol: 'x402',
        version: '2',
        methods: ['exact'],
        networks: ['eip155:8453'],
        assets: ['USDC']
      }],
      preference: { mode: 'x402' },
      agentContext: agentContext('write:purchase')
    }, 'x402-action')
    expect(x402Action).toMatchObject({ status: 200, body: { actionType: 'x402' } })
    const x402Result = {
      type: 'x402_payment_payload',
      paymentPayload: {
        x402Version: 2,
        accepted: {
          scheme: 'exact',
          network: 'eip155:8453',
          amount: '4999',
          asset: 'USDC',
          payTo: '0x1111111111111111111111111111111111111111',
          maxTimeoutSeconds: 300
        },
        payload: { signature: 'checkout-scoped-agent-signature' }
      }
    }
    const x402Token = String(x402Action.body.actionToken)
    expect((await post(`/v1/payment-actions/${x402Token}/result`, { result: x402Result }, 'x402-result')).status).toBe(200)
    expect(await post('/v1/purchases/purchase_x402/confirm', {
      approvalRef: 'human-present-x402',
      agentContext: agentContext('write:complete_purchase')
    }, 'x402-confirm')).toMatchObject({
      status: 200,
      body: { state: 'completed', nextAction: { type: 'view_order' } }
    })

    const mcpContext = agentContext('write:purchase', 'generic_mcp')
    const mcpCompleteContext = agentContext('write:complete_purchase', 'generic_mcp')
    let rpcId = 0
    const mcpCall = async (name: string, args: Record<string, unknown>) => {
      const response = await app.handle(jsonRequest('/v1/mcp', 'POST', {
        jsonrpc: '2.0',
        id: `portable-mcp-${++rpcId}`,
        method: 'tools/call',
        params: { name, arguments: args }
      }))
      const body = await response.json() as {
        result?: {
          isError?: boolean
          structuredContent?: { response?: Record<string, unknown> }
        }
      }
      expect(response.status).toBe(200)
      expect(body.result?.isError).toBeUndefined()
      return body.result?.structuredContent?.response ?? {}
    }
    const mppAction = await mcpCall('prepare_payment', {
      id: 'purchase_mpp',
      portableCapabilities: [{ protocol: 'mpp', version: 'draft-00', methods: ['tempo'], intents: ['charge'] }],
      preference: { mode: 'mpp' },
      agentContext: mcpContext
    })
    expect(mppAction).toMatchObject({ actionType: 'mpp', action: { protocol: 'mpp' } })
    expect(mppAction).not.toHaveProperty('handlerId')
    await mcpCall('provide_payment', {
      actionToken: mppAction.actionToken,
      result: {
        type: 'mpp_payment_credential',
        authorization: `Payment ${Buffer.from('mpp-proof').toString('base64url')}`
      },
      agentContext: mcpCompleteContext
    })
    await expect(mcpCall('confirm_purchase', {
      id: 'purchase_mpp',
      approvalRef: 'human-present-mpp',
      agentContext: mcpCompleteContext
    })).resolves.toMatchObject({ state: 'completed', nextAction: { type: 'view_order' } })
  })
})
