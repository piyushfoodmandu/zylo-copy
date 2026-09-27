import { describe, expect, it, vi } from 'vitest'
import type { PurchaseResponse } from '@arro/contracts'
import {
  createAutonomousPurchaseWorker,
  type AutonomousPaymentExecutor
} from './autonomous-purchase-worker.ts'
import type {
  AutonomousPurchaseJobClaim,
  AutonomousPurchaseJobRepository
} from './autonomous-purchase-jobs.ts'
import type {
  PurchaseMandate,
  PurchaseMandateRepository
} from './purchase-mandate.ts'
import type { PurchaseOrchestrator } from './purchase-orchestrator.ts'
import type { PurchaseStepUpRepository } from './purchase-step-up.ts'

const job = (overrides: Partial<AutonomousPurchaseJobClaim> = {}): AutonomousPurchaseJobClaim => ({
  jobId: 'apj_worker_1',
  ownerId: 'test-key:sha256:owner',
  integrationId: 'agent:test-key:purchase-route-test',
  authorizationRoute: 'trusted_host',
  hostId: 'verify-host',
  agentSessionId: 'zas_worker_session',
  mandateId: 'pm_worker_1',
  mandateVersion: 1,
  status: 'searching',
  trigger: { type: 'immediate' },
  attemptCount: 1,
  ownerKeyId: 'test-key',
  ownerPrincipalHash: 'sha256:owner',
  ...overrides
})

const mandate = (overrides: Partial<PurchaseMandate> = {}): PurchaseMandate => ({
  mandateId: 'pm_worker_1',
  ownerId: 'test-key:sha256:owner',
  integrationId: 'agent:test-key:purchase-route-test',
  version: 1,
  status: 'active',
  authorizationProvider: 'trusted_host_signature',
  intent: {
    description: 'Buy one safe USB-C 65W charger.',
    productIds: ['sku_65w_charger'],
    allowedVariants: ['sku_65w_charger'],
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
  expiresAt: '2099-07-12T00:00:00.000Z',
  authorization: {
    scheme: 'arro-purchase-mandate-authorization-v1',
    issuer: 'verify-host',
    subject: 'shopper',
    evidenceHash: 'sha256:evidence',
    authorizationHash: 'sha256:authorization',
    mode: 'trusted_host_signature',
    authorizedAt: '2026-07-12T00:00:01.000Z'
  },
  ...overrides
})

const purchase = (state: PurchaseResponse['state'] = 'payment_action_required'): PurchaseResponse => ({
  purchaseId: 'purchase_worker_1',
  state,
  executionLevel: state === 'completed' ? 'direct_payment' : 'hosted_checkout',
  merchant: {
    merchantId: 'https://merchant.example',
    canonicalOrigin: 'https://merchant.example',
    profileUrl: 'https://merchant.example/.well-known/ucp'
  },
  items: [{ itemId: 'sku_65w_charger', quantity: 1 }],
  payment: {
    completedByArro: state === 'completed',
    executionLevel: state === 'completed' ? 'direct_payment' : 'hosted_checkout'
  },
  checkoutStatus: state === 'completed' ? 'completed' : 'ready_for_complete',
  checkoutSnapshotHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  messages: [],
  nextAction: {
    type: state === 'completed' ? 'view_order' : 'provide_payment',
    label: state === 'completed' ? 'View order' : 'Approve payment'
  }
})

const repositories = (claimedJob: AutonomousPurchaseJobClaim | undefined = job()) => {
  const jobs = {
    claimNext: vi.fn(async () => claimedJob),
    markCheckoutPrepared: vi.fn(async (input) => ({ ...claimedJob!, status: 'checkout_prepared', purchaseId: input.purchaseId })),
    markExecuting: vi.fn(async (input) => ({ ...claimedJob!, status: 'executing', purchaseId: input.purchaseId })),
    markWaitingForStepUp: vi.fn(async (input) => ({ ...claimedJob!, status: 'waiting_for_step_up', purchaseId: input.purchaseId, lastSafeErrorCode: input.safeErrorCode })),
    markWaitingForCondition: vi.fn(async (input) => ({ ...claimedJob!, status: 'waiting_for_condition', nextAttemptAt: input.nextAttemptAt, lastSafeErrorCode: input.safeErrorCode })),
    markReconciliationRequired: vi.fn(async (input) => ({ ...claimedJob!, status: 'reconciliation_required', lastSafeErrorCode: input.safeErrorCode })),
    renewLease: vi.fn(async () => claimedJob!),
    complete: vi.fn(async (input) => ({ ...claimedJob!, status: 'completed', purchaseId: input.purchaseId })),
    fail: vi.fn(async (input) => ({ ...claimedJob!, status: 'failed', lastSafeErrorCode: input.safeErrorCode }))
  } as unknown as AutonomousPurchaseJobRepository
  const mandates = {
    read: vi.fn(async () => ({
      mandate: mandate(),
      totalReservedMinor: '0',
      totalCommittedMinor: '0',
      useCount: 0
    }))
  } as unknown as PurchaseMandateRepository
  return { jobs, mandates }
}

describe('autonomous purchase worker', () => {
  it('reschedules an unmet condition and completes the same job when a qualifying candidate appears', async () => {
    const conditionJob = job({
      trigger: {
        type: 'condition',
        condition: { maximumPriceMinor: '3500', requiredAvailability: 'in_stock' }
      }
    })
    const { jobs, mandates } = repositories(conditionJob)
    vi.mocked(jobs.claimNext)
      .mockResolvedValueOnce(conditionJob)
      .mockResolvedValueOnce(conditionJob)
    const candidateResolver = {
      resolve: vi.fn()
        .mockResolvedValueOnce({
          state: 'no_candidate',
          reasonCode: 'no_qualifying_purchase_candidate',
          checkedSourceCount: 2
        })
        .mockResolvedValueOnce({
          state: 'selected',
          qualifyingCount: 1,
          candidate: {
            merchantDomain: 'merchant.example',
            merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
            productId: 'sku_65w_charger',
            variantId: 'variant_65w_black',
            title: '65W USB-C Charger',
            quantity: 1,
            evidence: {
              businessId: 'merchant-1',
              sourceId: 'source-1',
              sourceFetchedAt: '2026-07-13T00:00:00.000Z',
              priceAmountMinor: 3299,
              priceCurrency: 'USD'
            }
          }
        })
    }
    const purchases = {
      preparePurchase: vi.fn(async () => purchase()),
      evaluateMandate: vi.fn(async () => ({
        purchase: purchase(),
        evaluation: {
          decision: 'pass',
          passReasons: ['amount_and_use_constraints_passed'],
          failReasons: [],
          stepUpReasons: [],
          amountMinor: '3299',
          currency: 'USD',
          merchantOrigin: 'https://merchant.example',
          checkoutId: 'checkout_worker_1',
          checkoutSnapshotHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111'
        },
        checkoutId: 'checkout_worker_1',
        checkoutSnapshotHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        merchantOrigin: 'https://merchant.example'
      })),
      createPaymentAction: vi.fn(async () => ({
        actionId: 'arro_pa_worker_action',
        purchaseId: 'purchase_worker_1',
        status: 'pending_user_approval',
        actionType: 'host_supplied',
        provider: 'com.example.processor_tokenizer',
        handlerId: 'merchant_processor_tokenizer_1',
        handlerName: 'com.example.processor_tokenizer',
        merchantOrigin: 'https://merchant.example',
        checkoutId: 'checkout_worker_1',
        checkoutSnapshotHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        expiresAt: '2099-07-12T00:00:00.000Z',
        actionToken: 'arro_pa1_signed_action_token',
        message: 'Approve payment'
      })),
      recordPaymentActionResult: vi.fn(async () => purchase()),
      confirmPurchase: vi.fn(async () => purchase('completed'))
    } as unknown as PurchaseOrchestrator
    const worker = createAutonomousPurchaseWorker({
      jobs,
      mandates,
      purchases,
      candidateResolver,
      primaryAutonomousRoute: 'trusted_host',
      paymentExecutor: {
        approvePaymentAction: vi.fn(async () => ({
          result: { type: 'trusted_host_attestation', attestation: 'signed-attestation' }
        }))
      }
    })

    const waiting = await worker.runOnce()
    expect(waiting.status).toBe('waiting_for_condition')
    expect(jobs.markWaitingForCondition).toHaveBeenCalledWith(expect.objectContaining({
      jobId: conditionJob.jobId,
      nextAttemptAt: expect.any(String)
    }))
    expect(purchases.preparePurchase).not.toHaveBeenCalled()

    const completed = await worker.runOnce()
    expect(completed.status).toBe('completed')
    expect(purchases.preparePurchase).toHaveBeenCalledWith(expect.objectContaining({
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      selectedOffer: expect.objectContaining({ variantId: 'variant_65w_black', quantity: 1 })
    }))
  })

  it('executes the trusted-host autonomous route through purchase orchestration', async () => {
    const { jobs, mandates } = repositories()
    const purchases = {
      preparePurchase: vi.fn(async () => purchase()),
      evaluateMandate: vi.fn(async () => ({
        purchase: purchase(),
        evaluation: {
          decision: 'pass',
          passReasons: ['amount_and_use_constraints_passed'],
          failReasons: [],
          stepUpReasons: [],
          amountMinor: '3299',
          currency: 'USD',
          merchantOrigin: 'https://merchant.example',
          checkoutId: 'checkout_worker_1',
          checkoutSnapshotHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111'
        },
        checkoutId: 'checkout_worker_1',
        checkoutSnapshotHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        merchantOrigin: 'https://merchant.example'
      })),
      createPaymentAction: vi.fn(async () => ({
        actionId: 'arro_pa_worker_action',
        purchaseId: 'purchase_worker_1',
        status: 'pending_user_approval',
        actionType: 'host_supplied',
        provider: 'com.example.processor_tokenizer',
        handlerId: 'merchant_processor_tokenizer_1',
        handlerName: 'com.example.processor_tokenizer',
        merchantOrigin: 'https://merchant.example',
        checkoutId: 'checkout_worker_1',
        checkoutSnapshotHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        expiresAt: '2099-07-12T00:00:00.000Z',
        actionToken: 'arro_pa1_signed_action_token',
        message: 'Approve payment'
      })),
      recordPaymentActionResult: vi.fn(async () => purchase()),
      confirmPurchase: vi.fn(async () => purchase('completed'))
    } as unknown as PurchaseOrchestrator
    const paymentExecutor = {
      approvePaymentAction: vi.fn(async () => ({
        result: {
          type: 'trusted_host_attestation',
          attestation: 'signed-attestation'
        }
      }))
    } as AutonomousPaymentExecutor

    const result = await createAutonomousPurchaseWorker({
      jobs,
      mandates,
      purchases,
      primaryAutonomousRoute: 'trusted_host',
      paymentExecutor
    }).runOnce({ leaseOwner: 'test-worker' })

    expect(result.status).toBe('completed')
    expect(purchases.preparePurchase).toHaveBeenCalledWith(expect.objectContaining({
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      selectedOffer: expect.objectContaining({
        variantId: 'sku_65w_charger'
      })
    }))
    expect(paymentExecutor.approvePaymentAction).toHaveBeenCalled()
    expect(purchases.recordPaymentActionResult).toHaveBeenCalledWith(expect.objectContaining({
      actionToken: 'arro_pa1_signed_action_token'
    }))
    expect(purchases.confirmPurchase).toHaveBeenCalledWith(expect.objectContaining({
      mandateId: 'pm_worker_1'
    }))
    expect(jobs.complete).toHaveBeenCalledWith(expect.objectContaining({
      purchaseId: 'purchase_worker_1'
    }))
  })

  it('reconciles an unknown merchant outcome without submitting completion more than once', async () => {
    const initialJob = job()
    const reconciliationJob = job({
      status: 'reconciliation_required',
      purchaseId: 'purchase_worker_1',
      attemptCount: 2
    })
    const { jobs, mandates } = repositories(initialJob)
    vi.mocked(jobs.claimNext)
      .mockResolvedValueOnce(initialJob)
      .mockResolvedValueOnce(reconciliationJob)
      .mockResolvedValueOnce({ ...reconciliationJob, attemptCount: 3 })
    const purchases = {
      preparePurchase: vi.fn(async () => purchase()),
      getPurchase: vi.fn()
        .mockResolvedValueOnce(purchase())
        .mockResolvedValueOnce(purchase('completed')),
      evaluateMandate: vi.fn(async () => ({
        purchase: purchase(),
        evaluation: {
          decision: 'pass',
          passReasons: ['amount_and_use_constraints_passed'],
          failReasons: [],
          stepUpReasons: [],
          amountMinor: '3299',
          currency: 'USD',
          merchantOrigin: 'https://merchant.example',
          checkoutId: 'checkout_worker_1',
          checkoutSnapshotHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111'
        },
        checkoutId: 'checkout_worker_1',
        checkoutSnapshotHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        merchantOrigin: 'https://merchant.example'
      })),
      createPaymentAction: vi.fn(async () => ({
        actionId: 'arro_pa_worker_action',
        purchaseId: 'purchase_worker_1',
        status: 'pending_user_approval',
        actionType: 'host_supplied',
        provider: 'com.example.processor_tokenizer',
        handlerId: 'merchant_processor_tokenizer_1',
        handlerName: 'com.example.processor_tokenizer',
        merchantOrigin: 'https://merchant.example',
        checkoutId: 'checkout_worker_1',
        checkoutSnapshotHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
        expiresAt: '2099-07-12T00:00:00.000Z',
        actionToken: 'arro_pa1_signed_action_token',
        message: 'Approve payment'
      })),
      recordPaymentActionResult: vi.fn(async () => purchase()),
      confirmPurchase: vi.fn(async () => {
        throw new Error('merchant_completion_uncertain')
      })
    } as unknown as PurchaseOrchestrator
    const paymentExecutor = {
      approvePaymentAction: vi.fn(async () => ({
        result: {
          type: 'trusted_host_attestation' as const,
          attestation: 'signed-attestation'
        }
      }))
    } as AutonomousPaymentExecutor

    const worker = createAutonomousPurchaseWorker({
      jobs,
      mandates,
      purchases,
      primaryAutonomousRoute: 'trusted_host',
      paymentExecutor
    })

    const unknownOutcome = await worker.runOnce()
    expect(unknownOutcome.status).toBe('reconciliation_required')
    expect(jobs.markReconciliationRequired).toHaveBeenCalledWith(expect.objectContaining({
      safeErrorCode: 'merchant_completion_uncertain'
    }))

    const unresolvedProbe = await worker.runOnce()
    expect(unresolvedProbe).toMatchObject({
      status: 'reconciliation_required',
      errorCode: 'merchant_completion_outcome_unresolved'
    })

    const reconciled = await worker.runOnce()
    expect(reconciled.status).toBe('completed')
    expect(purchases.getPurchase).toHaveBeenCalledTimes(2)
    expect(purchases.preparePurchase).toHaveBeenCalledTimes(1)
    expect(paymentExecutor.approvePaymentAction).toHaveBeenCalledTimes(1)
    expect(purchases.recordPaymentActionResult).toHaveBeenCalledTimes(1)
    expect(purchases.confirmPurchase).toHaveBeenCalledTimes(1)
    expect(jobs.complete).toHaveBeenCalledTimes(1)
  })

  it('creates a durable conditional step-up before acquiring any payment credential', async () => {
    const { jobs, mandates } = repositories()
    const action = {
      actionId: 'psu_worker_1',
      purchaseId: 'purchase_worker_1',
      jobId: 'apj_worker_1',
      mandateId: 'pm_worker_1',
      mandateVersion: 1,
      merchantOrigin: 'https://merchant.example',
      checkoutId: 'checkout_worker_1',
      checkoutSnapshotHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
      amountMinor: '5299',
      currency: 'USD',
      items: purchase().items,
      reasonCode: 'amount_exceeds_confirmation_threshold',
      requestedAction: 'approve_current_checkout',
      status: 'pending' as const,
      expiresAt: '2099-07-12T00:00:00.000Z',
      display: {
        title: 'Purchase needs your approval',
        merchantOrigin: 'https://merchant.example',
        amountMinor: '5299',
        currency: 'USD',
        items: purchase().items,
        reasonCode: 'amount_exceeds_confirmation_threshold',
        decisions: ['approve', 'reject'] as Array<'approve' | 'reject'>,
        expiresAt: '2099-07-12T00:00:00.000Z'
      }
    }
    const stepUps = {
      readPendingForJob: vi.fn(async () => undefined),
      create: vi.fn(async () => action),
      invalidateForPurchase: vi.fn(async () => 0)
    } as unknown as PurchaseStepUpRepository
    const purchases = {
      preparePurchase: vi.fn(async () => purchase()),
      evaluateMandate: vi.fn(async () => ({
        purchase: purchase(),
        evaluation: {
          decision: 'step_up',
          passReasons: ['merchant_checkout_matches_mandate_identity'],
          failReasons: [],
          stepUpReasons: ['amount_exceeds_confirmation_threshold'],
          amountMinor: '5299',
          currency: 'USD',
          merchantOrigin: 'https://merchant.example',
          checkoutId: 'checkout_worker_1',
          checkoutSnapshotHash: action.checkoutSnapshotHash
        },
        checkoutId: 'checkout_worker_1',
        checkoutSnapshotHash: action.checkoutSnapshotHash,
        merchantOrigin: 'https://merchant.example'
      })),
      createPaymentAction: vi.fn()
    } as unknown as PurchaseOrchestrator

    const result = await createAutonomousPurchaseWorker({
      jobs,
      mandates,
      purchases,
      stepUps,
      primaryAutonomousRoute: 'trusted_host',
      paymentExecutor: { approvePaymentAction: vi.fn() }
    }).runOnce()

    expect(result).toMatchObject({
      status: 'waiting_for_step_up',
      errorCode: 'amount_exceeds_confirmation_threshold',
      stepUp: { actionId: 'psu_worker_1' }
    })
    expect(stepUps.create).toHaveBeenCalledWith(expect.objectContaining({
      purchaseId: 'purchase_worker_1',
      checkoutSnapshotHash: action.checkoutSnapshotHash,
      amountMinor: '5299'
    }))
    expect(purchases.createPaymentAction).not.toHaveBeenCalled()
  })

  it('resumes the same persisted purchase after an exact approved step-up', async () => {
    const claimed = job({ purchaseId: 'purchase_worker_1', status: 'searching' })
    const { jobs, mandates } = repositories(claimed)
    const approvedAction = {
      actionId: 'psu_worker_approved',
      purchaseId: 'purchase_worker_1',
      jobId: 'apj_worker_1',
      mandateId: 'pm_worker_1',
      mandateVersion: 1,
      merchantOrigin: 'https://merchant.example',
      checkoutId: 'checkout_worker_1',
      checkoutSnapshotHash: purchase().checkoutSnapshotHash!,
      amountMinor: '5299',
      currency: 'USD',
      items: purchase().items,
      reasonCode: 'amount_exceeds_confirmation_threshold',
      requestedAction: 'approve_current_checkout',
      status: 'approved' as const,
      expiresAt: '2099-07-12T00:00:00.000Z',
      display: {
        title: 'Purchase needs your approval',
        merchantOrigin: 'https://merchant.example',
        amountMinor: '5299',
        currency: 'USD',
        items: purchase().items,
        reasonCode: 'amount_exceeds_confirmation_threshold',
        decisions: ['approve', 'reject'] as Array<'approve' | 'reject'>,
        expiresAt: '2099-07-12T00:00:00.000Z'
      }
    }
    const stepUps = {
      readPendingForJob: vi.fn(async () => approvedAction)
    } as unknown as PurchaseStepUpRepository
    const purchases = {
      getPurchase: vi.fn(async () => purchase()),
      preparePurchase: vi.fn(),
      evaluateMandate: vi.fn(async () => ({
        purchase: purchase(),
        evaluation: {
          decision: 'step_up',
          passReasons: [],
          failReasons: [],
          stepUpReasons: ['amount_exceeds_confirmation_threshold'],
          amountMinor: '5299',
          currency: 'USD',
          merchantOrigin: 'https://merchant.example',
          checkoutId: 'checkout_worker_1',
          checkoutSnapshotHash: approvedAction.checkoutSnapshotHash
        },
        checkoutId: 'checkout_worker_1',
        checkoutSnapshotHash: approvedAction.checkoutSnapshotHash,
        merchantOrigin: 'https://merchant.example'
      })),
      createPaymentAction: vi.fn(async () => ({
        actionId: 'arro_pa_worker_action',
        purchaseId: 'purchase_worker_1',
        status: 'pending_user_approval',
        actionType: 'host_supplied',
        provider: 'com.example.processor_tokenizer',
        handlerId: 'merchant_processor_tokenizer_1',
        handlerName: 'com.example.processor_tokenizer',
        merchantOrigin: 'https://merchant.example',
        checkoutId: 'checkout_worker_1',
        checkoutSnapshotHash: approvedAction.checkoutSnapshotHash,
        expiresAt: '2099-07-12T00:00:00.000Z',
        actionToken: 'arro_pa1_signed_action_token',
        message: 'Approve payment'
      })),
      recordPaymentActionResult: vi.fn(async () => purchase()),
      confirmPurchase: vi.fn(async () => purchase('completed'))
    } as unknown as PurchaseOrchestrator

    const result = await createAutonomousPurchaseWorker({
      jobs,
      mandates,
      purchases,
      stepUps,
      primaryAutonomousRoute: 'trusted_host',
      paymentExecutor: {
        approvePaymentAction: vi.fn(async () => ({
          result: { type: 'trusted_host_attestation', attestation: 'signed-attestation' }
        }))
      }
    }).runOnce()

    expect(result.status).toBe('completed')
    expect(purchases.preparePurchase).not.toHaveBeenCalled()
    expect(purchases.getPurchase).toHaveBeenCalledWith('purchase_worker_1', expect.any(Object))
    expect(purchases.confirmPurchase).toHaveBeenCalledWith(expect.objectContaining({
      id: 'purchase_worker_1',
      autonomousJobId: 'apj_worker_1',
      mandateId: 'pm_worker_1'
    }))
  })
})
