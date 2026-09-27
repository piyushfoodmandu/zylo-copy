import type {
  AutonomousPurchaseJob,
  PurchasePaymentActionResponse,
  PurchasePaymentActionResult,
  PurchaseResponse
} from '@arro/contracts'
import type {
  AutonomousPurchaseJobClaim,
  AutonomousPurchaseJobRepository
} from './autonomous-purchase-jobs.ts'
import type { CommercePrincipal } from './commerce-principal.ts'
import type {
  PurchaseMandate,
  PurchaseMandateRecord,
  PurchaseMandateRepository
} from './purchase-mandate.ts'
import type { PurchaseOrchestrator } from './purchase-orchestrator.ts'
import type { PurchaseStepUpAction, PurchaseStepUpRepository } from './purchase-step-up.ts'
import type { AutonomousCandidateResolver } from './autonomous-candidate-resolver.ts'

export type PrimaryAutonomousRoute = 'trusted_host'

export type AutonomousPaymentExecutor = {
  approvePaymentAction(input: {
    job: AutonomousPurchaseJobClaim
    principal: CommercePrincipal
    mandate: PurchaseMandate
    purchase: PurchaseResponse
    paymentAction: PurchasePaymentActionResponse
    route: PrimaryAutonomousRoute
  }): Promise<{
    result: PurchasePaymentActionResult
    idempotencyKey?: string
  }>
}

export type AutonomousPurchaseWorkerRunResult =
  | { status: 'idle' }
  | { status: 'completed'; job: AutonomousPurchaseJob; purchase: PurchaseResponse }
  | { status: 'waiting_for_condition'; job: AutonomousPurchaseJob; errorCode: string }
  | { status: 'waiting_for_step_up'; job: AutonomousPurchaseJob; errorCode: string; purchase?: PurchaseResponse; stepUp?: PurchaseStepUpAction }
  | { status: 'reconciliation_required'; job: AutonomousPurchaseJob; errorCode: string; purchase?: PurchaseResponse }
  | { status: 'failed'; job: AutonomousPurchaseJob; errorCode: string }

const principalFromJob = (job: AutonomousPurchaseJobClaim): CommercePrincipal => ({
  keyId: job.ownerKeyId,
  ownerPrincipal: `autonomous-purchase-job:${job.jobId}`,
  ownerPrincipalHash: job.ownerPrincipalHash,
  integrationId: job.integrationId,
  agentActionScope: 'write:complete_purchase',
  agentAllowedActionScopes: ['read:purchase', 'write:purchase', 'write:complete_purchase'],
  ...(job.agentSessionId ? { agentSessionId: job.agentSessionId } : {})
})

const idempotencyKey = (job: AutonomousPurchaseJobClaim, label: string) =>
  `${job.jobId}:${label}:v${job.mandateVersion}`

const exactAllowedMerchantOrigin = (mandate: PurchaseMandate) => {
  const origins = mandate.merchantPolicy.allowedMerchantOrigins ?? []
  return origins.length === 1 ? origins[0] : undefined
}

const merchantProfileUrlFor = (merchantOrigin: string) => {
  const url = new URL(merchantOrigin)
  return `${url.origin}/.well-known/ucp`
}

const exactSelectedVariantFor = (mandate: PurchaseMandate) => {
  const variants = mandate.intent.allowedVariants ?? []
  if (variants.length === 1) return variants[0]
  const products = mandate.intent.productIds ?? []
  return variants.length === 0 && products.length === 1 ? products[0] : undefined
}

const quantityFor = (mandate: PurchaseMandate) =>
  Math.max(1, mandate.intent.intendedQuantity ?? 1)

const retryAtForAttempt = (attemptCount: number) =>
  new Date(Date.now() + Math.min(5 * 60_000, 5_000 * (2 ** Math.min(attemptCount, 6)))).toISOString()

const safeErrorCode = (error: unknown) => {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[a-z0-9_:-]{1,120}$/.test(error.code)) {
    return error.code
  }
  if (error instanceof Error && /^[a-z0-9_:-]{1,120}$/.test(error.message)) return error.message
  return 'autonomous_execution_failed'
}

const retryableErrorCodes = new Set([
  'ucp_upstream_unavailable',
  'ucp_upstream_timeout',
  'ucp_checkout_temporarily_unavailable',
  'payment_result_tokenize_failed',
  'autonomous_execution_failed'
])

const mandateStillExecutable = (
  job: AutonomousPurchaseJobClaim,
  record: PurchaseMandateRecord,
  primaryAutonomousRoute: PrimaryAutonomousRoute
) => {
  const mandate = record.mandate
  if (job.authorizationRoute !== primaryAutonomousRoute) return 'autonomous_route_mismatch'
  if (mandate.version !== job.mandateVersion) return 'mandate_version_mismatch'
  if (mandate.status !== 'active') return 'mandate_not_active'
  if (new Date(mandate.expiresAt).getTime() <= Date.now()) return 'mandate_expired'
  if (record.useCount >= mandate.financialPolicy.useLimit) return 'mandate_use_exhausted'
  return undefined
}

const prepareInputFor = (
  job: AutonomousPurchaseJobClaim,
  mandate: PurchaseMandate,
  principal: CommercePrincipal
) => {
  const merchantOrigin = exactAllowedMerchantOrigin(mandate)
  const selectedVariant = exactSelectedVariantFor(mandate)
  if (!merchantOrigin) return { errorCode: 'mandate_merchant_unresolved' as const }
  if (!selectedVariant) return { errorCode: 'mandate_product_unresolved' as const }
  const productId = mandate.intent.productIds?.length === 1
    ? mandate.intent.productIds[0]!
    : selectedVariant

  return {
    input: {
      principal,
      merchantProfileUrl: merchantProfileUrlFor(merchantOrigin),
      selectedOffer: {
        productId,
        variantId: selectedVariant,
        itemId: selectedVariant,
        title: mandate.intent.description,
        quantity: quantityFor(mandate)
      },
      context: {
        autonomousJobId: job.jobId,
        mandateId: job.mandateId,
        mandateVersion: job.mandateVersion,
        authorizationRoute: job.authorizationRoute
      },
      idempotencyKey: idempotencyKey(job, 'prepare')
    }
  }
}

export const createAutonomousPurchaseWorker = ({
  jobs,
  mandates,
  purchases,
  primaryAutonomousRoute,
  paymentExecutor,
  stepUps,
  candidateResolver
}: {
  jobs: AutonomousPurchaseJobRepository
  mandates: PurchaseMandateRepository
  purchases: PurchaseOrchestrator
  primaryAutonomousRoute: PrimaryAutonomousRoute
  paymentExecutor?: AutonomousPaymentExecutor
  stepUps?: PurchaseStepUpRepository
  candidateResolver?: AutonomousCandidateResolver
}) => ({
  async runOnce({
    leaseOwner = 'arro-autonomous-purchase-worker',
    leaseSeconds = 60
  }: {
    leaseOwner?: string
    leaseSeconds?: number
  } = {}): Promise<AutonomousPurchaseWorkerRunResult> {
    const job = await jobs.claimNext({
      leaseOwner,
      leaseSeconds
    })
    if (!job) return { status: 'idle' }

    const fail = async (errorCode: string): Promise<AutonomousPurchaseWorkerRunResult> => ({
      status: 'failed',
      errorCode,
      job: await jobs.fail({
        jobId: job.jobId,
        safeErrorCode: errorCode
      })
    })

    if (job.status === 'reconciliation_required') {
      if (!job.purchaseId) {
        const reconciliation = await jobs.markReconciliationRequired({
          jobId: job.jobId,
          safeErrorCode: 'reconciliation_purchase_missing',
          nextAttemptAt: retryAtForAttempt(job.attemptCount)
        })
        return { status: 'reconciliation_required', errorCode: 'reconciliation_purchase_missing', job: reconciliation }
      }
      const purchase = await purchases.getPurchase(job.purchaseId, principalFromJob(job)).catch(() => undefined)
      if (purchase?.state === 'completed') {
        const completed = await jobs.complete({ jobId: job.jobId, purchaseId: purchase.purchaseId })
        return { status: 'completed', job: completed, purchase }
      }
      const reconciliation = await jobs.markReconciliationRequired({
        jobId: job.jobId,
        safeErrorCode: 'merchant_completion_outcome_unresolved',
        nextAttemptAt: retryAtForAttempt(job.attemptCount)
      })
      return {
        status: 'reconciliation_required',
        errorCode: 'merchant_completion_outcome_unresolved',
        job: reconciliation,
        ...(purchase ? { purchase } : {})
      }
    }

    if (!paymentExecutor) return fail('autonomous_payment_executor_unavailable')

    const principal = principalFromJob(job)
    let purchase: PurchaseResponse | undefined
    let paymentAction: PurchasePaymentActionResponse | undefined
    let providerResultRecorded = false

    try {
      const mandateRecord = await mandates.read(job.mandateId, principal)
      if (!mandateRecord) return fail('mandate_not_found')
      const mandateError = mandateStillExecutable(job, mandateRecord, primaryAutonomousRoute)
      if (mandateError) return fail(mandateError)

      const resolvedCandidate = candidateResolver
        ? await candidateResolver.resolve({ job, mandate: mandateRecord.mandate })
        : undefined
      const prepare = resolvedCandidate?.state === 'selected'
        ? {
            input: {
              principal,
              ...(resolvedCandidate.candidate.merchantProfileUrl
                ? { merchantProfileUrl: resolvedCandidate.candidate.merchantProfileUrl }
                : { merchantDomain: resolvedCandidate.candidate.merchantDomain }),
              selectedOffer: {
                productId: resolvedCandidate.candidate.productId,
                variantId: resolvedCandidate.candidate.variantId,
                itemId: resolvedCandidate.candidate.variantId,
                title: resolvedCandidate.candidate.title,
                ...(resolvedCandidate.candidate.productUrl ? { url: resolvedCandidate.candidate.productUrl } : {}),
                quantity: resolvedCandidate.candidate.quantity
              },
              context: {
                autonomousJobId: job.jobId,
                mandateId: job.mandateId,
                mandateVersion: job.mandateVersion,
                authorizationRoute: job.authorizationRoute,
                candidateEvidence: resolvedCandidate.candidate.evidence
              },
              idempotencyKey: idempotencyKey(job, 'prepare')
            }
          }
        : resolvedCandidate?.state === 'no_candidate'
          ? { errorCode: resolvedCandidate.reasonCode }
          : prepareInputFor(job, mandateRecord.mandate, principal)
      if ('errorCode' in prepare) {
        if (job.trigger.type === 'condition') {
          const waiting = await jobs.markWaitingForCondition({
            jobId: job.jobId,
            safeErrorCode: prepare.errorCode,
            nextAttemptAt: new Date(Date.now() + 5 * 60_000).toISOString()
          })
          return { status: 'waiting_for_condition', errorCode: prepare.errorCode, job: waiting }
        }
        return fail(prepare.errorCode)
      }

      purchase = job.purchaseId
        ? await purchases.getPurchase(job.purchaseId, principal)
        : await purchases.preparePurchase(prepare.input)
      if (purchase.state === 'completed') {
        const completed = await jobs.complete({ jobId: job.jobId, purchaseId: purchase.purchaseId })
        return { status: 'completed', job: completed, purchase }
      }
      await jobs.markCheckoutPrepared({
        jobId: job.jobId,
        purchaseId: purchase.purchaseId
      })
      await jobs.renewLease({ jobId: job.jobId, leaseOwner, leaseSeconds })

      const mandateEvaluation = await purchases.evaluateMandate({
        id: purchase.purchaseId,
        principal,
        mandateId: job.mandateId
      })
      purchase = mandateEvaluation.purchase
      if (mandateEvaluation.evaluation.decision === 'fail') {
        return fail(mandateEvaluation.evaluation.failReasons[0] ?? 'mandate_constraint_failed')
      }
      if (mandateEvaluation.evaluation.decision === 'step_up') {
        const existing = stepUps
          ? await stepUps.readPendingForJob({
              jobId: job.jobId,
              purchaseId: purchase.purchaseId,
              mandateId: job.mandateId,
              mandateVersion: job.mandateVersion
            })
          : undefined
        const exactApproved = existing &&
          existing.checkoutSnapshotHash === mandateEvaluation.checkoutSnapshotHash &&
          (existing.status === 'approved' || existing.status === 'challenge_satisfied')
        if (!exactApproved) {
          if (!stepUps) {
            const waiting = await jobs.markWaitingForStepUp({
              jobId: job.jobId,
              purchaseId: purchase.purchaseId,
              safeErrorCode: 'conditional_step_up_store_unavailable'
            })
            return {
              status: 'waiting_for_step_up',
              errorCode: 'conditional_step_up_store_unavailable',
              job: waiting,
              purchase
            }
          }
          if (existing && existing.checkoutSnapshotHash !== mandateEvaluation.checkoutSnapshotHash) {
            await stepUps.invalidateForPurchase({
              purchaseId: purchase.purchaseId,
              reason: 'checkout_changed'
            })
          }
          const reasonCode = mandateEvaluation.evaluation.stepUpReasons[0] ?? 'conditional_step_up_required'
          const stepUp = await stepUps.create({
            principal,
            purchaseId: purchase.purchaseId,
            jobId: job.jobId,
            mandateId: job.mandateId,
            mandateVersion: job.mandateVersion,
            merchantOrigin: mandateEvaluation.merchantOrigin,
            checkoutId: mandateEvaluation.checkoutId,
            checkoutSnapshotHash: mandateEvaluation.checkoutSnapshotHash,
            amountMinor: mandateEvaluation.evaluation.amountMinor,
            currency: mandateEvaluation.evaluation.currency,
            items: purchase.items,
            reasonCode,
            requestedAction: 'approve_current_checkout',
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
          })
          const waiting = await jobs.markWaitingForStepUp({
            jobId: job.jobId,
            purchaseId: purchase.purchaseId,
            safeErrorCode: reasonCode
          })
          return {
            status: 'waiting_for_step_up',
            errorCode: reasonCode,
            job: waiting,
            purchase,
            stepUp
          }
        }
      }

      paymentAction = await purchases.createPaymentAction({
        id: purchase.purchaseId,
        principal,
        preference: {
          mode: 'host_supplied'
        },
        executionDownscope: {
          allowedPresentationModes: ['host_native'],
          preferredPaymentProviderKinds: ['trusted_host'],
          autonomousExecutionAllowed: true
        },
        idempotencyKey: idempotencyKey(job, 'payment-action')
      })
      await jobs.markExecuting({
        jobId: job.jobId,
        purchaseId: purchase.purchaseId
      })
      await jobs.renewLease({ jobId: job.jobId, leaseOwner, leaseSeconds })
      if (!paymentAction.actionToken) {
        const waiting = await jobs.markWaitingForStepUp({
          jobId: job.jobId,
          purchaseId: purchase.purchaseId,
          safeErrorCode: 'payment_action_token_missing'
        })
        return {
          status: 'waiting_for_step_up',
          errorCode: 'payment_action_token_missing',
          job: waiting,
          purchase
        }
      }

      const approval = await paymentExecutor.approvePaymentAction({
        job,
        principal,
        mandate: mandateRecord.mandate,
        purchase,
        paymentAction,
        route: primaryAutonomousRoute
      })
      purchase = await purchases.recordPaymentActionResult({
        actionToken: paymentAction.actionToken,
        result: approval.result,
        idempotencyKey: approval.idempotencyKey ?? idempotencyKey(job, 'payment-result')
      })
      providerResultRecorded = true

      const confirmed = await purchases.confirmPurchase({
        id: paymentAction.purchaseId,
        principal,
        mandateId: job.mandateId,
        autonomousJobId: job.jobId,
        idempotencyKey: idempotencyKey(job, 'confirm')
      })
      purchase = confirmed
      if (confirmed.state !== 'completed') {
        const waiting = await jobs.markWaitingForStepUp({
          jobId: job.jobId,
          purchaseId: confirmed.purchaseId,
          safeErrorCode: 'merchant_completion_not_confirmed'
        })
        return {
          status: 'waiting_for_step_up',
          errorCode: 'merchant_completion_not_confirmed',
          job: waiting,
          purchase: confirmed
        }
      }

      const completed = await jobs.complete({
        jobId: job.jobId,
        purchaseId: confirmed.purchaseId
      })
      return {
        status: 'completed',
        job: completed,
        purchase: confirmed
      }
    } catch (error) {
      const errorCode = safeErrorCode(error)
      if (providerResultRecorded) {
        const reconciliation = await jobs.markReconciliationRequired({
          jobId: job.jobId,
          safeErrorCode: errorCode
        })
        return {
          status: 'reconciliation_required',
          errorCode,
          job: reconciliation,
          ...(purchase ? { purchase } : {})
        }
      }
      if (paymentAction) {
        const waiting = await jobs.markWaitingForStepUp({
          jobId: job.jobId,
          purchaseId: paymentAction.purchaseId,
          safeErrorCode: errorCode
        })
        return {
          status: 'waiting_for_step_up',
          errorCode,
          job: waiting,
          ...(purchase ? { purchase } : {})
        }
      }
      if (retryableErrorCodes.has(errorCode)) {
        return {
          status: 'failed',
          errorCode,
          job: await jobs.fail({
            jobId: job.jobId,
            safeErrorCode: errorCode,
            nextAttemptAt: retryAtForAttempt(job.attemptCount)
          })
        }
      }
      return fail(errorCode)
    }
  }
})

export type AutonomousPurchaseWorker = ReturnType<typeof createAutonomousPurchaseWorker>
