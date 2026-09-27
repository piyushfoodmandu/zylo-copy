import { describe, expect, it } from 'vitest'
import { UCP_STABLE_VERSION } from '@arro/contracts'
import type { CommercePrincipal } from './commerce-principal.ts'
import {
  createPurchaseMandateRepository,
  draftPurchaseMandate,
  evaluatePurchaseMandate,
  purchaseMandateAuthorizationHash
} from './purchase-mandate.ts'

const principal: CommercePrincipal = {
  keyId: 'test-key',
  ownerPrincipal: 'owner:test',
  ownerPrincipalHash: `sha256:${'1'.repeat(64)}`,
  integrationId: 'agent:test-key:hermes',
  agentSessionId: 'session_1',
  agentActionScope: 'write:purchase',
  agentAllowedActionScopes: ['write:purchase']
}

const checkout = {
  ucp: { version: UCP_STABLE_VERSION, status: 'success' as const },
  id: 'chk_1',
  status: 'ready_for_complete' as const,
  currency: 'USD',
  line_items: [
    {
      id: 'li_1',
      item: {
        id: 'sku_65w_charger',
        title: '65W USB-C Charger',
        attributes: {
          watts: '65',
          connector: 'usb-c'
        }
      },
      quantity: 1,
      totals: [{ type: 'subtotal', amount: 2999, currency: 'USD' }]
    }
  ],
  totals: [
    { type: 'subtotal', amount: 2999, currency: 'USD' },
    { type: 'tax', amount: 300, currency: 'USD' },
    { type: 'total', amount: 3299, currency: 'USD' }
  ],
  links: []
}

describe('purchase mandate evaluation', () => {
  it('creates drafts without pre-authorized evidence and hashes the authorization ceremony constraints', () => {
    const mandate = draftPurchaseMandate({
      principal,
      intentDescription: 'Buy one USB-C 65W charger.',
      merchantOrigin: 'https://merchant.example',
      productId: 'sku_65w_charger',
      currency: 'USD',
      maximumPerTransactionMinor: '5000',
      maximumTotalSpendMinor: '5000',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      authorizationProvider: 'user_approval_action'
    })

    expect(mandate.status).toBe('draft')
    expect('authorization' in mandate).toBe(false)
    expect(purchaseMandateAuthorizationHash({
      mandate,
      providerContext: {
        approvalActionId: 'approval-action-1',
        route: 'user_approval_action'
      }
    })).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('passes exact product, merchant, currency, quantity, and amount constraints using integer minor units', () => {
    const mandate = {
      ...draftPurchaseMandate({
        principal,
        intentDescription: 'Buy one USB-C 65W charger.',
        merchantOrigin: 'https://merchant.example',
        productId: 'sku_65w_charger',
        currency: 'USD',
        maximumPerTransactionMinor: '05000',
        maximumTotalSpendMinor: '5000',
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }),
      status: 'active' as const,
      intent: {
        description: 'Buy one USB-C 65W charger.',
        productIds: ['sku_65w_charger'],
        requiredAttributes: {
          watts: '65',
          connector: 'usb-c'
        },
        quantityMaximum: 1,
        substitutionPolicy: 'forbidden' as const
      }
    }

    expect(evaluatePurchaseMandate({
      mandate,
      checkout,
      merchantOrigin: 'https://merchant.example',
      checkoutSnapshotHash: `sha256:${'2'.repeat(64)}`
    })).toMatchObject({
      decision: 'pass',
      amountMinor: '3299',
      currency: 'USD',
      failReasons: [],
      stepUpReasons: []
    })
  })

  it('returns step-up instead of pass when checkout amount exceeds delegated threshold', () => {
    const mandate = {
      ...draftPurchaseMandate({
        principal,
        intentDescription: 'Buy one USB-C 65W charger.',
        merchantOrigin: 'https://merchant.example',
        productId: 'sku_65w_charger',
        currency: 'USD',
        maximumPerTransactionMinor: '3000',
        maximumTotalSpendMinor: '5000',
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }),
      status: 'active' as const
    }

    expect(evaluatePurchaseMandate({
      mandate,
      checkout,
      merchantOrigin: 'https://merchant.example',
      checkoutSnapshotHash: `sha256:${'2'.repeat(64)}`
    })).toMatchObject({
      decision: 'step_up',
      stepUpReasons: ['amount_exceeds_limit']
    })
  })

  it('keeps direct repository activation unavailable outside consumed authorization actions', async () => {
    const repository = createPurchaseMandateRepository({
      client: {
        async query() {
          throw new Error('activate must not query')
        }
      }
    })

    await expect(repository.activate('pm_1', principal)).rejects.toMatchObject({
      code: 'mandate_authorization_required'
    })
  })

  it('marks unknown-outcome reservations for reconciliation without releasing delegated budget', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = []
    const repository = createPurchaseMandateRepository({
      client: {
        async query(text: string, values?: unknown[]) {
          queries.push({ text, values })
          return { rows: [{ reservation_id: 'pmr_unknown_outcome' }] }
        }
      }
    })

    await repository.markReconciliationRequired({
      reservationId: 'pmr_unknown_outcome',
      failureEvidence: {
        code: 'merchant_response_lost_after_submit'
      }
    })

    expect(queries).toHaveLength(1)
    expect(queries[0]?.text).toContain("status = 'reconciliation_required'")
    expect(queries[0]?.text).toContain("status in ('execution_in_progress', 'reserved')")
    expect(queries[0]?.text).not.toContain("status = 'released'")
    expect(queries[0]?.values?.[1]).toBe(JSON.stringify({
      code: 'merchant_response_lost_after_submit'
    }))
  })

  it('returns an existing reservation on semantic retry without mutating mandate counters again', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = []
    const repository = createPurchaseMandateRepository({
      client: {
        async query(text: string, values?: unknown[]) {
          queries.push({ text, values })
          return { rows: [{ reservation_id: 'pmr_existing' }] }
        }
      }
    })
    const mandate = {
      ...draftPurchaseMandate({
        principal,
        intentDescription: 'Buy one USB-C 65W charger.',
        merchantOrigin: 'https://merchant.example',
        productId: 'sku_65w_charger',
        currency: 'USD',
        maximumPerTransactionMinor: '5000',
        maximumTotalSpendMinor: '5000',
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      }),
      status: 'active' as const
    }

    const reservationId = await repository.reserve({
      mandate,
      principal,
      transactionId: 'purchase_1',
      evaluation: evaluatePurchaseMandate({
        mandate,
        checkout,
        merchantOrigin: 'https://merchant.example',
        checkoutSnapshotHash: `sha256:${'2'.repeat(64)}`
      })
    })

    expect(reservationId).toBe('pmr_existing')
    expect(queries).toHaveLength(1)
    expect(queries[0]?.text).toContain('select r.reservation_id')
    expect(queries[0]?.text).not.toContain('total_reserved_minor = total_reserved_minor +')
  })

  it('persists reserved amount separately from actual merchant order amount when committing', async () => {
    const queries: Array<{ text: string; values?: unknown[] }> = []
    const repository = createPurchaseMandateRepository({
      client: {
        async query(text: string, values?: unknown[]) {
          queries.push({ text, values })
          if (queries.length === 1) return { rows: [] }
          return { rows: [{ mandate_id: 'pm_1' }] }
        }
      }
    })

    await repository.commit({
      reservationId: 'pmr_1',
      order: {
        ...checkout,
        id: 'ord_1',
        checkout_id: checkout.id,
        permalink_url: 'https://merchant.example/orders/ord_1',
        fulfillment: { type: 'shipping', status: 'pending' }
      },
      actualAmountMinor: '3399'
    })

    expect(queries).toHaveLength(2)
    expect(queries[1]?.text).toContain('reserved_amount_minor')
    expect(queries[1]?.text).toContain('actual_order_amount_minor = $2::numeric')
    expect(queries[1]?.text).toContain('actual_order_currency = $3')
    expect(queries[1]?.text).toContain('r.checkout_id = $4')
    expect(queries[1]?.text).toContain('total_reserved_minor - r.reserved_amount_minor')
    expect(queries[1]?.text).toContain('total_committed_minor = total_committed_minor + $2::numeric')
    expect(queries[1]?.values).toEqual(['pmr_1', '3399', 'USD', 'chk_1'])
  })
})
