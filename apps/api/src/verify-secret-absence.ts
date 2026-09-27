import type { ReferenceMerchantState } from '@arro/ucp-client/reference-merchant.test-support'
import { createReferenceMerchantFetch } from '@arro/ucp-client/reference-merchant.test-support'
import { getRuntimeRedisClient } from './redis.ts'
import {
  createPurchaseVerifierRuntime,
  readJsonResponse
} from './verify-purchase-runtime-fixture.ts'

const failures: string[] = []
const assert = (condition: unknown, message: string) => {
  if (!condition) failures.push(message)
}

const runId = `verify-secret-absence-${Date.now()}`
const secretMarker = `live-token-${runId}`
const state: ReferenceMerchantState = {
  createCalls: 0,
  completeCalls: 0,
  idempotencyKeys: []
}
const baseFetch = createReferenceMerchantFetch(state)
const merchantFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const response = await baseFetch(input, init)
  if (
    url.href === 'https://merchant.example/ucp/payment-handlers/com.example.processor_tokenizer/tokenize' &&
    (init?.method ?? 'GET').toUpperCase() === 'POST'
  ) {
    const body = await response.json() as {
      instrument?: { credential?: Record<string, unknown> }
    }
    if (body.instrument?.credential) body.instrument.credential.token = secretMarker
    return Response.json(body, { status: response.status })
  }
  return response
}

const runtime = await createPurchaseVerifierRuntime({
  runLabel: runId,
  merchantFetch,
  state,
  hostOverrides: {
    presentationModes: ['external_action', 'merchant_hosted'],
    paymentProviderKinds: ['processor_tokenizer', 'merchant_hosted'],
    authorizationProviderKinds: ['user_approval_action'],
    handlerNames: ['com.example.processor_tokenizer'],
    allowedReturnOrigins: ['https://arro.example'],
    autonomousExecutionAllowed: false
  }
})

try {
  const prepare = await readJsonResponse(await runtime.app.handle(runtime.jsonRequest('/v1/purchases/prepare', 'POST', {
    merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
    selectedOffer: {
      variantId: 'sku_65w_charger',
      title: '65W USB-C Charger',
      quantity: 1
    },
    agentContext: runtime.agentContext('write:purchase')
  }, {
    'Idempotency-Key': runtime.idempotencyKey('prepare')
  })))
  assert(prepare.status === 200, `Purchase prepare expected 200, got ${prepare.status}: ${JSON.stringify(prepare.body)}`)
  const purchaseId = typeof prepare.body.purchaseId === 'string' ? prepare.body.purchaseId : undefined
  assert(purchaseId, 'Secret-isolation verification requires a purchase created through the compact HTTP route.')

  const action = purchaseId
    ? await readJsonResponse(await runtime.app.handle(runtime.jsonRequest(`/v1/purchases/${purchaseId}/payment-actions`, 'POST', {
        preference: {
          provider: 'com.example.processor_tokenizer',
          mode: 'processor_tokenizer'
        },
        returnUrl: 'https://arro.example/payment/return',
        agentContext: runtime.agentContext('write:purchase')
      }, {
        'Idempotency-Key': runtime.idempotencyKey('payment-action')
      })))
    : { status: 500, body: {} }
  assert(action.status === 200, `Payment action expected 200, got ${action.status}: ${JSON.stringify(action.body)}`)
  const actionToken = typeof action.body.actionToken === 'string' ? action.body.actionToken : undefined
  assert(actionToken, 'Secret-isolation verification requires a signed payment action token.')

  const result = actionToken
    ? await readJsonResponse(await runtime.app.handle(runtime.jsonRequest(`/v1/payment-actions/${actionToken}/result`, 'POST', {
        result: {
          type: 'processor_tokenizer_result',
          provider: 'com.example.processor_tokenizer',
          credentialReference: {
            reference: `source-credential-${runId}`,
            proof: `source-proof-${runId}`
          }
        }
      }, {
        'Idempotency-Key': runtime.idempotencyKey('payment-result')
      })))
    : { status: 500, body: {} }
  assert(result.status === 200, `Payment result expected 200, got ${result.status}: ${JSON.stringify(result.body)}`)

  const status = actionToken
    ? await readJsonResponse(await runtime.app.handle(runtime.jsonRequest(`/v1/payment-actions/${actionToken}/status`, 'GET')))
    : { status: 500, body: {} }
  assert(status.status === 200, `Payment action status expected 200, got ${status.status}: ${JSON.stringify(status.body)}`)

  for (const [surface, value] of [
    ['prepare response', prepare.body],
    ['payment action response', action.body],
    ['payment result response', result.body],
    ['payment action status response', status.body]
  ] as const) {
    assert(!JSON.stringify(value).includes(secretMarker), `${surface} exposed the live tokenizer credential.`)
  }

  const stored = purchaseId ? await runtime.store.readLatestPaymentResult(purchaseId) : undefined
  const storedCredential = stored?.instrument.credential as {
    redacted?: unknown
    reference?: unknown
    token?: unknown
  } | undefined
  assert(storedCredential?.redacted === true, 'Postgres payment result must contain a redacted credential marker.')
  assert(storedCredential?.token === undefined, 'Postgres payment result must not contain a live payment token.')
  const vaultReference = typeof storedCredential?.reference === 'string' ? storedCredential.reference : undefined
  assert(vaultReference?.startsWith('pcv_'), 'Postgres must retain only an opaque credential-vault reference.')

  if (purchaseId) {
    for (const table of [
      'ucp_checkout_sessions',
      'ucp_checkout_operations',
      'ucp_payment_results',
      'ucp_payment_actions'
    ] as const) {
      const rows = await runtime.pool.query<{ value: string }>(
        `select row_to_json(record)::text as value from ${table} record where transaction_id = $1`,
        [purchaseId]
      )
      assert(
        rows.rows.every((row) => !row.value.includes(secretMarker)),
        `${table} persisted the live tokenizer credential.`
      )
    }
  }
  const jobRows = await runtime.pool.query<{ value: string }>(
    `select row_to_json(record)::text as value
       from autonomous_purchase_jobs record
      where owner_key_id = 'verify-purchase-key'
        and created_at >= now() - interval '10 minutes'`
  )
  assert(
    jobRows.rows.every((row) => !row.value.includes(secretMarker)),
    'Autonomous job state persisted the live tokenizer credential.'
  )
  const auditRows = await runtime.pool.query<{ value: string }>(
    `select row_to_json(record)::text as value
       from request_audit_log record
      where request_id like $1`,
    [`${runId}%`]
  )
  assert(
    auditRows.rows.every((row) => !row.value.includes(secretMarker)),
    'Request audit state persisted the live tokenizer credential.'
  )

  if (vaultReference) {
    const redis = await getRuntimeRedisClient(process.env.REDIS_URL!)
    const encryptedEnvelope = await redis.get(`arro:payment-credential:${vaultReference}`)
    assert(typeof encryptedEnvelope === 'string', 'Credential vault must contain the short-lived encrypted authority.')
    assert(!encryptedEnvelope?.includes(secretMarker), 'Redis credential vault stored the live tokenizer credential in plaintext.')
    assert(encryptedEnvelope?.includes('A256GCM'), 'Redis credential vault must use the AES-256-GCM envelope.')
    await redis.del(`arro:payment-credential:${vaultReference}`)
  }

  if (failures.length > 0) {
    console.error(JSON.stringify({ status: 'failed', runId, failures }, null, 2))
    process.exitCode = 1
  } else {
    console.log(JSON.stringify({
      status: 'passed',
      runId,
      purchaseId,
      credentialStorage: 'aes-256-gcm Redis consume-once envelope',
      ordinaryPostgresCredentialState: 'redacted vault reference only',
      checkedSurfaces: [
        'compact HTTP responses',
        'checkout sessions',
        'checkout operations',
        'payment results',
        'payment actions',
        'autonomous jobs',
        'request audit',
        'Redis plaintext'
      ]
    }))
  }
} finally {
  await runtime.close()
}
