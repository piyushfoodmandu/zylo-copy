import { describe, expect, it, vi } from 'vitest'
import { createTrustedHostAutonomousPaymentExecutor } from './trusted-host-autonomous-payment.ts'

const job = {
  jobId: 'apj_1',
  ownerId: 'owner-1',
  ownerKeyId: 'key-1',
  ownerPrincipalHash: 'owner-hash',
  integrationId: 'integration-1',
  authorizationRoute: 'trusted_host' as const,
  hostId: 'host-1',
  mandateId: 'mandate-1',
  mandateVersion: 2,
  status: 'executing' as const,
  trigger: { type: 'immediate' as const },
  attemptCount: 1
}

const mandate = {
  mandateId: 'mandate-1',
  version: 2
} as Parameters<ReturnType<typeof createTrustedHostAutonomousPaymentExecutor>['approvePaymentAction']>[0]['mandate']

const purchase = {
  purchaseId: 'purchase-1',
  merchant: { name: 'Merchant', domain: 'merchant.example' },
  items: [{ itemId: 'item-1', title: 'Item', quantity: 1 }],
  totals: [{ type: 'total', amountMinor: '1299', currency: 'USD' }]
} as Parameters<ReturnType<typeof createTrustedHostAutonomousPaymentExecutor>['approvePaymentAction']>[0]['purchase']

const paymentAction = {
  actionId: 'action-1',
  purchaseId: 'purchase-1',
  status: 'pending_user_approval' as const,
  actionType: 'host_supplied',
  provider: 'com.example.processor',
  handlerId: 'handler-1',
  presentation: 'host_native' as const,
  expiresAt: '2026-07-13T10:15:00.000Z',
  actionToken: 'arro_pa1_signed_action_token_value'
}

describe('trusted-host autonomous payment executor', () => {
  it('requests only a signed bounded attestation from the configured host endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      attestation: 'signed.compact.attestation.with-sufficient-length'
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }))
    const executor = createTrustedHostAutonomousPaymentExecutor({
      configs: [{
        hostId: 'host-1',
        integrationId: 'integration-1',
        issuer: 'https://host.example',
        audience: 'arro',
        redemptionEndpoint: 'https://host.example/redeem',
        authorizationEndpoint: 'https://host.example/authorize',
        jwks: [{ kid: 'key-1' }],
        headers: { Authorization: 'Bearer host-service-token' }
      }],
      fetch: fetcher
    })

    const output = await executor.approvePaymentAction({
      job,
      principal: {} as never,
      mandate,
      purchase,
      paymentAction,
      route: 'trusted_host'
    })

    expect(output.result).toEqual({
      type: 'trusted_host_attestation',
      attestation: 'signed.compact.attestation.with-sufficient-length'
    })
    expect(fetcher).toHaveBeenCalledOnce()
    const request = fetcher.mock.calls[0]!
    expect(request[0]).toBe('https://host.example/authorize')
    expect(request[1]?.headers).toMatchObject({ Authorization: 'Bearer host-service-token' })
    const body = JSON.parse(String(request[1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      protocol: 'arro.trusted_host.payment_authorization.v1',
      action_token: paymentAction.actionToken,
      mandate_id: mandate.mandateId,
      autonomous_job_id: job.jobId
    })
    expect(body).not.toHaveProperty('credential')
  })

  it('fails closed when the selected host has no authorization endpoint', async () => {
    const executor = createTrustedHostAutonomousPaymentExecutor({
      configs: [{
        hostId: 'host-1',
        integrationId: 'integration-1',
        issuer: 'https://host.example',
        audience: 'arro',
        redemptionEndpoint: 'https://host.example/redeem',
        jwks: [{ kid: 'key-1' }]
      }]
    })
    await expect(executor.approvePaymentAction({
      job,
      principal: {} as never,
      mandate,
      purchase,
      paymentAction,
      route: 'trusted_host'
    })).rejects.toMatchObject({ code: 'trusted_host_authorization_not_configured' })
  })
})
