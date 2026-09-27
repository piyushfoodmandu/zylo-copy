import type {
  AutonomousPurchaseJob,
  PurchasePaymentActionResponse,
  UcpCheckout
} from '@arro/contracts'
import {
  createReferenceMerchantFetch,
  type ReferenceMerchantState
} from '@arro/ucp-client/reference-merchant.test-support'
import {
  createAp2ReferenceEnvironment,
  type Ap2ReferenceCompletionAuthority
} from './ap2-reference.ts'
import type { AutonomousPaymentExecutor } from './autonomous-purchase-worker.ts'
import type { PurchaseMandate } from './purchase-mandate.ts'
import {
  createPurchaseVerifierRuntime,
  decodePaymentActionTokenNonce,
  paymentActionNonceHash,
  signTrustedHostJwt
} from './verify-purchase-runtime-fixture.ts'
import { resolveDatabaseUrlFromEnv } from './runtime-secrets.ts'
import { UCP_AP2_MANDATE_CAPABILITY } from './platform-profile.ts'

const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message)
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const stringValue = (value: unknown) => typeof value === 'string' && value ? value : undefined

const paymentAttestation = ({
  action,
  jti
}: {
  action: Record<string, unknown>
  jti: string
}) => {
  const actionToken = stringValue(action.actionToken)
  const nonce = actionToken ? decodePaymentActionTokenNonce(actionToken) : undefined
  assert(actionToken && nonce, 'AP2 payment action must expose a signed consume-once token and nonce.')
  const nowSeconds = Math.floor(Date.now() / 1000)
  return signTrustedHostJwt({
    iss: 'https://verify-host.example',
    aud: 'https://arro.example',
    jti,
    iat: nowSeconds,
    exp: nowSeconds + 300,
    host_id: 'verify-host',
    integration_id: 'agent:verify-purchase-key:generic-mcp-preview',
    action_id: action.actionId,
    transaction_id: action.purchaseId,
    checkout_id: action.checkoutId,
    checkout_snapshot_hash: action.checkoutSnapshotHash,
    payment_action_nonce_hash: paymentActionNonceHash(nonce),
    merchant_origin: 'https://merchant.example',
    handler_name: action.handlerName,
    handler_id: action.handlerId,
    capability_id: action.capabilityId,
    credential_reference: `${jti}-opaque-reference`
  })
}

const assertExactMerchantPlacement = (
  request: unknown,
  authority: Ap2ReferenceCompletionAuthority
) => {
  const body = asRecord(request)
  const ap2 = asRecord(body.ap2)
  const payment = asRecord(body.payment)
  const instrument = asRecord(Array.isArray(payment.instruments) ? payment.instruments[0] : undefined)
  const credential = asRecord(instrument.credential)
  assert(ap2.checkout_mandate === authority.checkoutMandate, 'UCP completion must place the closed Checkout Mandate at checkout.ap2.checkout_mandate.')
  assert(!Object.hasOwn(ap2, 'payment_mandate'), 'UCP completion must not fabricate checkout.ap2.payment_mandate.')
  assert(credential.token === authority.paymentMandate, 'UCP completion must place the closed Payment Mandate in the selected instrument credential token.')
}

const createRuntime = async ({
  label,
  checkoutId,
  cartId,
  orderId
}: {
  label: string
  checkoutId: string
  cartId: string
  orderId: string
}) => {
  const ap2 = createAp2ReferenceEnvironment({ checkoutId })
  const state: ReferenceMerchantState = {
    createCalls: 0,
    completeCalls: 0,
    idempotencyKeys: []
  }
  const checkoutCache = new Map<UcpCheckout['status'], UcpCheckout>()
  let latestCheckout = ap2.checkout('ready_for_complete')
  let pendingAuthority: Ap2ReferenceCompletionAuthority | undefined
  const checkout = (status: UcpCheckout['status']) => {
    const cached = checkoutCache.get(status)
    if (cached) {
      latestCheckout = cached
      return cached
    }
    const created = ap2.checkout(status)
    checkoutCache.set(status, created)
    latestCheckout = created
    return created
  }
  const merchantFetch = createReferenceMerchantFetch(state, {
    profile: ap2.businessProfile,
    checkout,
    checkoutId,
    cartId,
    orderId,
    completeImmediately: true
  })
  const runtime = await createPurchaseVerifierRuntime({
    runLabel: label,
    merchantFetch,
    state,
    platformProfileOverride: ap2.platformProfile,
    ap2TrustedIssuers: ap2.trustedIssuers,
    hostOverrides: {
      authorizationProviderKinds: ['trusted_host_signature', 'ap2_trusted_surface']
    },
    trustedHostRedemptionFetch: async () => {
      const authority = pendingAuthority
      pendingAuthority = undefined
      if (!authority) return Response.json({ error: 'reference_authority_missing' }, { status: 409 })
      return Response.json({
        ap2: { checkout_mandate: authority.checkoutMandate },
        instrument: authority.instrument
      })
    }
  })
  const call = async (
    path: string,
    method: string,
    body?: unknown,
    idempotencyKey?: string
  ) => runtime.readJsonResponse(await runtime.app.handle(runtime.jsonRequest(path, method, body, {
    ...(idempotencyKey ? { 'Idempotency-Key': runtime.idempotencyKey(idempotencyKey) } : {})
  })))
  return {
    ...runtime,
    ap2,
    call,
    latestCheckout: () => latestCheckout,
    setPendingAuthority: (authority: Ap2ReferenceCompletionAuthority) => {
      pendingAuthority = authority
    }
  }
}

const purchasePrepareBody = (agentContext: ReturnType<Awaited<ReturnType<typeof createRuntime>>['agentContext']>) => ({
  merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
  selectedOffer: {
    productId: 'sku_65w_charger',
    variantId: 'sku_65w_charger',
    title: '65W USB-C Charger',
    quantity: 1
  },
  agentContext
})

const verifyNoRawMandatesInOrdinaryPostgres = async ({
  pool,
  purchaseId,
  authority
}: {
  pool: Awaited<ReturnType<typeof createRuntime>>['pool']
  purchaseId: string
  authority: Ap2ReferenceCompletionAuthority
}) => {
  const resultRows = await pool.query<{
    instrument_json: unknown
    provider_result_json: unknown
  }>('select instrument_json, provider_result_json from ucp_payment_results where transaction_id = $1', [purchaseId])
  const operationRows = await pool.query<{ request_json: unknown; response_json: unknown }>(
    'select request_json, response_json from ucp_checkout_operations where transaction_id = $1',
    [purchaseId]
  )
  const ordinaryPersistence = JSON.stringify([...resultRows.rows, ...operationRows.rows])
  assert(!ordinaryPersistence.includes(authority.checkoutMandate), 'Raw AP2 Checkout Mandate must not persist in ordinary payment or operation records.')
  assert(!ordinaryPersistence.includes(authority.paymentMandate), 'Raw AP2 Payment Mandate must not persist in ordinary payment or operation records.')
}

const runHumanPresent = async (runId: string) => {
  const checkoutId = `chk_ap2_human_${runId}`
  const cartId = `cart_ap2_human_${runId}`
  const orderId = `order_ap2_human_${runId}`
  const runtime = await createRuntime({
    label: `verify-ap2-human-${runId}`,
    checkoutId,
    cartId,
    orderId
  })
  try {
    const advertisedProfile = await runtime.call('/.well-known/ucp', 'GET')
    assert(advertisedProfile.status === 200, `AP2 public profile request failed: ${JSON.stringify(advertisedProfile.body)}`)
    const advertisedCapabilities = asRecord(asRecord(advertisedProfile.body.ucp).capabilities)
    assert(Object.hasOwn(advertisedCapabilities, UCP_AP2_MANDATE_CAPABILITY), 'AP2-enabled reference runtime must advertise the negotiated AP2 capability over the public HTTP profile route.')

    const prepared = await runtime.call('/v1/purchases/prepare', 'POST', purchasePrepareBody(runtime.agentContext('write:purchase')), 'prepare')
    assert(prepared.status === 200, `AP2 human prepare failed: ${JSON.stringify(prepared.body)}`)
    const purchaseId = stringValue(prepared.body.purchaseId)
    const snapshot = stringValue(prepared.body.checkoutSnapshotHash)
    assert(purchaseId && snapshot, 'AP2 human prepare must return a durable purchase and checkout snapshot.')

    const action = await runtime.call(`/v1/purchases/${purchaseId}/payment-actions`, 'POST', {
      preference: { mode: 'host_supplied' },
      executionDownscope: {
        allowedPresentationModes: ['host_native'],
        preferredPaymentProviderKinds: ['trusted_host'],
        autonomousExecutionAllowed: false
      },
      agentContext: runtime.agentContext('write:purchase')
    }, 'payment-action')
    assert(action.status === 200, `AP2 human payment action failed: ${JSON.stringify(action.body)}`)
    const authority = runtime.ap2.humanPresentAuthority(runtime.latestCheckout())
    runtime.setPendingAuthority(authority)
    const actionToken = stringValue(action.body.actionToken)
    assert(actionToken, 'AP2 human payment action must return a signed action token.')
    const result = await runtime.call(`/v1/payment-actions/${actionToken}/result`, 'POST', {
      result: {
        type: 'trusted_host_attestation',
        attestation: paymentAttestation({ action: action.body, jti: 'ap2-human-payment-action' })
      }
    }, 'payment-result')
    assert(result.status === 200, `AP2 human trusted-surface result failed: ${JSON.stringify(result.body)}`)

    const confirmed = await runtime.call(`/v1/purchases/${purchaseId}/confirm`, 'POST', {
      approvalRef: 'ap2-human-present-review-approved',
      checkoutSnapshotHash: snapshot,
      agentContext: runtime.agentContext('write:complete_purchase')
    }, 'confirm')
    assert(confirmed.status === 200, `AP2 human completion failed: ${JSON.stringify(confirmed.body)}`)
    assert(confirmed.body.state === 'completed', 'AP2 human completion must return merchant-completed state.')
    assertExactMerchantPlacement(runtime.state.lastCompleteBody, authority)
    assert(runtime.state.completeCalls === 1, 'AP2 human completion must call the merchant exactly once.')

    const replay = await runtime.call(`/v1/purchases/${purchaseId}/confirm`, 'POST', {
      approvalRef: 'ap2-human-present-review-approved',
      checkoutSnapshotHash: snapshot,
      agentContext: runtime.agentContext('write:complete_purchase')
    }, 'confirm')
    assert(replay.status === 200 && replay.body.state === 'completed', 'AP2 semantic retry must recover the completed purchase without reacquiring authority.')
    assert(runtime.state.completeCalls === 1, 'AP2 semantic retry must not call merchant completion twice.')

    const receipts = runtime.ap2.receipts(authority, orderId)
    const recordedReceipts = await runtime.call(`/v1/purchases/${purchaseId}/ap2-receipts`, 'POST', {
      ...receipts,
      agentContext: runtime.agentContext('write:complete_purchase')
    })
    assert(recordedReceipts.status === 200, `AP2 human receipts failed: ${JSON.stringify(recordedReceipts.body)}`)
    const authorityRows = await runtime.pool.query<{
      authority_mode: string
      status: string
      canonical_mandate_id: string | null
    }>('select authority_mode, status, canonical_mandate_id from ap2_verified_authorities where transaction_id = $1', [purchaseId])
    assert(authorityRows.rows.some((row) => row.authority_mode === 'human_present' && row.status === 'consumed' && row.canonical_mandate_id === null), 'AP2 human authority must persist and consume as human_present.')
    const receiptRows = await runtime.pool.query('select receipt_id from ap2_protocol_receipts where authority_id in (select authority_id from ap2_verified_authorities where transaction_id = $1)', [purchaseId])
    assert(receiptRows.rowCount === 2, 'AP2 human completion must persist Checkout and Payment Receipts.')
    await verifyNoRawMandatesInOrdinaryPostgres({ pool: runtime.pool, purchaseId, authority })
    return { purchaseId, orderId, publicProfileAdvertised: true as const }
  } finally {
    await runtime.close()
  }
}

const runAutonomous = async (runId: string) => {
  const checkoutId = `chk_ap2_autonomous_${runId}`
  const cartId = `cart_ap2_autonomous_${runId}`
  const orderId = `order_ap2_autonomous_${runId}`
  const runtime = await createRuntime({
    label: `verify-ap2-autonomous-${runId}`,
    checkoutId,
    cartId,
    orderId
  })
  try {
    const created = await runtime.call('/v1/purchase-mandates', 'POST', {
      intentDescription: 'Buy one exact 65W USB-C charger with AP2 standing authority.',
      merchantOrigin: 'https://merchant.example',
      productId: 'sku_65w_charger',
      variantId: 'sku_65w_charger',
      intendedQuantity: 1,
      currency: 'USD',
      maximumPerTransactionMinor: '5000',
      maximumTotalSpendMinor: '5000',
      useLimit: 1,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      authorizationProvider: 'ap2_trusted_surface',
      agentContext: runtime.agentContext('write:complete_purchase')
    })
    assert(created.status === 200, `AP2 autonomous mandate draft failed: ${JSON.stringify(created.body)}`)
    const mandate = asRecord(created.body.mandate) as unknown as PurchaseMandate
    const mandateId = mandate.mandateId
    const approvalActionId = stringValue(asRecord(created.body.approvalAction).actionId)
    assert(mandateId && approvalActionId, 'AP2 autonomous draft must return mandate and consume-once authorization action.')
    const open = runtime.ap2.openMandates(mandate)
    const authorized = await runtime.call(`/v1/purchase-mandates/${mandateId}/authorize`, 'POST', {
      mode: 'ap2_trusted_surface',
      approvalActionId,
      evidence: {
        checkoutMandate: open.checkoutMandate,
        paymentMandate: open.paymentMandate
      },
      agentContext: runtime.agentContext('write:complete_purchase')
    })
    assert(authorized.status === 200, `AP2 autonomous standing authorization failed: ${JSON.stringify(authorized.body)}`)

    const jobResponse = await runtime.call(`/v1/purchase-mandates/${mandateId}/jobs`, 'POST', {
      trigger: { type: 'immediate' },
      agentContext: runtime.agentContext('write:complete_purchase')
    })
    assert(jobResponse.status === 200, `AP2 autonomous job creation failed: ${JSON.stringify(jobResponse.body)}`)
    const jobId = stringValue(jobResponse.body.jobId)
    assert(jobId && jobResponse.body.authorizationRoute === 'trusted_host', 'AP2 autonomy must preserve AP2 standing authority while selecting the explicit trusted_host execution route.')

    let autonomousAuthority: Ap2ReferenceCompletionAuthority | undefined
    const paymentExecutor: AutonomousPaymentExecutor = {
      async approvePaymentAction({ paymentAction }) {
        autonomousAuthority = runtime.ap2.autonomousAuthority(runtime.latestCheckout(), open)
        runtime.setPendingAuthority(autonomousAuthority)
        return {
          idempotencyKey: runtime.idempotencyKey('autonomous-payment-result'),
          result: {
            type: 'trusted_host_attestation',
            attestation: paymentAttestation({
              action: paymentAction as unknown as Record<string, unknown>,
              jti: `ap2-autonomous-payment-action-${jobId}`
            })
          }
        }
      }
    }
    const worker = runtime.createWorker(paymentExecutor)
    const result = await worker.runOnce({ leaseOwner: `ap2-worker-${jobId}`, leaseSeconds: 60 })
    assert(result.status === 'completed', `AP2 autonomous worker did not produce an Order: ${JSON.stringify(result)}`)
    assert(result.purchase.state === 'completed', 'AP2 autonomous purchase must finish from merchant-authoritative completed state.')
    assert(autonomousAuthority, 'AP2 autonomous trusted host must create key-bound closed authority only after current Checkout exists.')
    assertExactMerchantPlacement(runtime.state.lastCompleteBody, autonomousAuthority)
    assert(runtime.state.completeCalls === 1, 'AP2 autonomous completion must call the merchant exactly once.')

    const receipts = runtime.ap2.receipts(autonomousAuthority, orderId)
    const recordedReceipts = await runtime.call(`/v1/purchases/${result.purchase.purchaseId}/ap2-receipts`, 'POST', {
      ...receipts,
      agentContext: runtime.agentContext('write:complete_purchase')
    })
    assert(recordedReceipts.status === 200, `AP2 autonomous receipts failed: ${JSON.stringify(recordedReceipts.body)}`)
    const authorityRows = await runtime.pool.query<{
      authority_mode: string
      status: string
      canonical_mandate_id: string | null
      canonical_mandate_version: number | null
      agent_key_thumbprint: string | null
    }>('select authority_mode, status, canonical_mandate_id, canonical_mandate_version, agent_key_thumbprint from ap2_verified_authorities where transaction_id = $1', [result.purchase.purchaseId])
    assert(authorityRows.rows.some((row) =>
      row.authority_mode === 'human_not_present' &&
      row.status === 'consumed' &&
      row.canonical_mandate_id === mandateId &&
      row.canonical_mandate_version === mandate.version &&
      Boolean(row.agent_key_thumbprint)
    ), 'AP2 autonomous authority must bind and consume the canonical Purchase Mandate version and agent key.')
    const mandateRows = await runtime.pool.query<{
      use_count: number
      total_committed_minor: string
      total_reserved_minor: string
    }>('select use_count, total_committed_minor, total_reserved_minor from purchase_mandates where mandate_id = $1', [mandateId])
    assert(mandateRows.rows.some((row) => row.use_count === 1 && row.total_committed_minor === '3299' && row.total_reserved_minor === '0'), 'AP2 autonomous Order must atomically commit actual merchant amount and release reservation.')
    const jobRows = await runtime.pool.query<Pick<AutonomousPurchaseJob, 'status' | 'purchaseId'>>(
      'select status, purchase_id as "purchaseId" from autonomous_purchase_jobs where job_id = $1',
      [jobId]
    )
    assert(jobRows.rows.some((row) => row.status === 'completed' && row.purchaseId === result.purchase.purchaseId), 'AP2 autonomous job must persist completed Order continuity.')
    await verifyNoRawMandatesInOrdinaryPostgres({ pool: runtime.pool, purchaseId: result.purchase.purchaseId, authority: autonomousAuthority })
    return { mandateId, jobId, purchaseId: result.purchase.purchaseId, orderId }
  } finally {
    await runtime.close()
  }
}

export const runAp2RuntimeVerification = async (
  mode: 'all' | 'human_present' | 'autonomous' = 'all'
) => {
  if (!resolveDatabaseUrlFromEnv(process.env) || !process.env.REDIS_URL?.trim()) {
    throw new Error('verify:ap2-runtime requires DATABASE_URL and REDIS_URL.')
  }
  const runId = `${Date.now()}-${process.pid}`
  const human = mode === 'all' || mode === 'human_present' ? await runHumanPresent(runId) : undefined
  const autonomous = mode === 'all' || mode === 'autonomous' ? await runAutonomous(runId) : undefined
  return {
    status: 'passed' as const,
    mode,
    ...(human ? { human } : {}),
    ...(autonomous ? { autonomous } : {})
  }
}

const main = async () => {
  const requestedMode = process.env.AP2_VERIFY_MODE?.trim()
  const mode = requestedMode === 'human_present' || requestedMode === 'autonomous'
    ? requestedMode
    : 'all'
  const result = await runAp2RuntimeVerification(mode)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
