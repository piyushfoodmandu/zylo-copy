import { createHash, createPrivateKey, createPublicKey, createSign } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Elysia } from 'elysia'
import { Pool } from 'pg'
import { UCP_STABLE_VERSION } from '@arro/contracts'
import {
  createPaymentHandlerRegistry,
  createUcpClient
} from '@arro/ucp-client'
import {
  businessProfile,
  createReferenceMerchantFetch,
  platformProfile,
  referenceMerchantSigningKeyId,
  referenceMerchantSigningPrivateJwk,
  referenceProcessorTokenizerSchema,
  referenceProcessorTokenizerSpec,
  type ReferenceMerchantState
} from '@arro/ucp-client/reference-merchant.test-support'
import { buildApp } from './app.ts'
import type { Authenticator } from './auth.ts'
import { createAgentSessionToken } from './agent-session.ts'
import { createAgentHostRegistry } from './agent-host-registry.ts'
import { createUcpCheckoutService } from './ucp-checkout-service.ts'
import { createPostgresUcpCheckoutStore } from './ucp-checkout-store.ts'
import { createPurchaseOrchestrator } from './purchase-orchestrator.ts'
import {
  createPurchaseMandateRepository,
  purchaseMandateAuthorizationActionPrefix
} from './purchase-mandate.ts'
import { createPostgresAutonomousPurchaseJobRepository } from './autonomous-purchase-jobs.ts'
import { createAutonomousPurchaseWorker, type AutonomousPaymentExecutor } from './autonomous-purchase-worker.ts'
import { runMigrations } from './migrate.ts'
import {
  createHttpPaymentCredentialProvider,
  createTokenizerCredentialResolver
} from './payment-result-exchange.ts'
import { createRedisPaymentCredentialVault } from './payment-credential-vault.ts'
import { createTrustedHostPaymentVerifier } from './trusted-host-payment.ts'
import { createTrustedHostMandateAuthorizationVerifier } from './trusted-host-mandate-authorization.ts'
import { closeRuntimeRedisClients, getRuntimeRedisClient } from './redis.ts'
import { closeRuntimeDatabasePools } from './database.ts'
import { runAp2RuntimeVerification } from './verify-ap2-runtime.ts'
import { resolveDatabaseUrlFromEnv } from './runtime-secrets.ts'
import { paymentActionTokenPrefix } from './payment-actions.ts'

const failures: string[] = []
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) failures.push(message)
}

const repoFile = (path: string) => new URL(`../../../${path}`, import.meta.url)

const verificationRun = `verify-software-${Date.now()}`
const primaryAutonomousRoute = process.env.PRIMARY_AUTONOMOUS_ROUTE?.trim()
if (primaryAutonomousRoute !== 'trusted_host') {
  throw new Error('PRIMARY_AUTONOMOUS_ROUTE must be explicitly set to trusted_host for autonomous verification.')
}
console.log(`PRIMARY_AUTONOMOUS_ROUTE=${primaryAutonomousRoute}`)
for (const [label, path] of [
  ['Google Pay Web HTTP-to-Order', 'apps/api/src/verify-google-pay-web-reference.ts'],
  ['payment secret isolation', 'apps/api/src/verify-secret-absence.ts']
] as const) {
  const verifier = spawnSync(
    process.execPath,
    [fileURLToPath(repoFile(path))],
    {
      cwd: fileURLToPath(repoFile('apps/api/')),
      env: process.env,
      encoding: 'utf8',
      timeout: 120_000
    }
  )
  if (verifier.stdout) process.stdout.write(verifier.stdout)
  if (verifier.stderr) process.stderr.write(verifier.stderr)
  assert(
    verifier.status === 0,
    `${label} runtime verifier failed with exit status ${String(verifier.status)}.`
  )
}
const trustedHostKeyId = 'verify-host-key-1'
const trustedHostPrivateKey = createPrivateKey({ key: referenceMerchantSigningPrivateJwk, format: 'jwk' })
const trustedHostPublicJwk = {
  ...createPublicKey(trustedHostPrivateKey).export({ format: 'jwk' }) as Record<string, unknown>,
  kid: trustedHostKeyId,
  alg: 'ES256',
  use: 'sig'
}
const verifierApiKey = 'verify-software-key'
const verifierHashPepper = 'verify-software-hash-pepper-32-chars'
const verifierPaymentActionSigningSecret = 'verify-payment-action-signing-secret-32-chars'
const verifierAgentSessionSigningSecret = 'verify-agent-session-signing-secret-32-chars'
const idempotencyKey = (label: string) => `${verificationRun}-${label}`
const base64UrlJson = (value: unknown) =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
const signCompactJws = (payload: Record<string, unknown>) => {
  const protectedHeader = base64UrlJson({
    alg: 'ES256',
    kid: trustedHostKeyId,
    typ: 'JWT'
  })
  const body = base64UrlJson(payload)
  const signer = createSign('sha256')
  signer.update(`${protectedHeader}.${body}`)
  signer.end()
  return `${protectedHeader}.${body}.${signer.sign(trustedHostPrivateKey).toString('base64url')}`
}
const decodePaymentActionTokenNonce = (token: string) => {
  const encodedPayload = token.startsWith(paymentActionTokenPrefix)
    ? token.slice(paymentActionTokenPrefix.length).split('.')[0]
    : undefined
  if (!encodedPayload) return undefined
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Record<string, unknown>
    return typeof payload.nonce === 'string' ? payload.nonce : undefined
  } catch {
    return undefined
  }
}
const paymentActionNonceHash = (nonce: string) =>
  `sha256:${createHash('sha256').update(nonce, 'utf8').digest('hex')}`
const verifierHostCapabilities = [
  'source_labels',
  'freshness',
  'caveats',
  'no_buy_warnings',
  'commercial_disclosures',
  'authority_limits',
  'allowed_next_actions'
] as const
const verifierAuthPrincipal = {
  keyId: 'verify-key-1',
  ownerPrincipal: 'verify:software',
  scopes: [
    'read:purchase',
    'write:purchase',
    'write:complete_purchase',
    'read:order'
  ],
  environment: 'test'
}
const referenceProcessorTokenizerSpecs = [
  {
    adapterKind: 'processor_tokenizer' as const,
    handlerName: 'com.example.processor_tokenizer',
    platformHandlerId: 'arro_processor_tokenizer_client',
    versions: [UCP_STABLE_VERSION],
    specification: referenceProcessorTokenizerSpec,
    schema: referenceProcessorTokenizerSchema,
    lifecyclePolicy: {
      rejectReusable: true,
      requiresCheckoutScope: true,
      requiresMerchantOriginScope: true,
      requiresExpiry: true
    }
  }
]

const state: ReferenceMerchantState = {
  createCalls: 0,
  completeCalls: 0,
  idempotencyKeys: []
}
const referenceCheckoutId = `${verificationRun}-checkout-1`
const referenceOrderId = `${verificationRun}-order-1`
const referenceMerchantFetch = createReferenceMerchantFetch(state, {
  checkoutIdForCreate: (createCall) => `${verificationRun}-checkout-${createCall}`,
  orderIdForCheckout: (_checkoutId, completeCall) => `${verificationRun}-order-${completeCall}`
})
const trustedHostRedemptionFetch = async (_input: string | URL | Request, init?: RequestInit) => {
  const request = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
  return Response.json({
    instrument: {
      id: `pi_trusted_host_${String(request.action_id ?? 'unknown')}`,
      handler_id: String(request.handler_id ?? 'merchant_processor_tokenizer_1'),
      type: 'card',
      credential: {
        type: 'TRUSTED_HOST_OPAQUE_REFERENCE',
        token: 'trusted-host-checkout-scoped-secret',
        reusable: false,
        scope: {
          checkout_id: String(request.checkout_id ?? ''),
          merchant_origin: String(request.merchant_origin ?? '')
        },
        expires_at: '2099-07-12T00:00:00.000Z'
      }
    }
  })
}
const databaseUrl = resolveDatabaseUrlFromEnv(process.env)
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required because verify:software must use PostgreSQL runtime repositories.')
}
const redisUrl = process.env.REDIS_URL?.trim()
if (!redisUrl) {
  throw new Error('REDIS_URL is required because verify:software must use the runtime payment credential vault.')
}
const paymentCredentialEncryptionKey =
  process.env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY?.trim() ??
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
await runMigrations()
const pool = new Pool({ connectionString: databaseUrl })
await pool.query(
  `
    update autonomous_purchase_jobs
    set status = 'cancelled',
        cancelled_at = now(),
        lease_owner = null,
        lease_expires_at = null,
        updated_at = now()
    where owner_key_id in ('verify-key-1', 'verify-autonomous-key', 'verify-purchase-key')
      and status not in ('completed', 'cancelled', 'failed')
  `
).catch(() => undefined)
const store = createPostgresUcpCheckoutStore({ client: pool })
const agentHostRegistry = createAgentHostRegistry([
  {
    hostId: 'verify-host',
    integrationId: 'agent:verify-key-1:generic-mcp-preview',
    allowedScopes: ['write:purchase', 'write:complete_purchase', 'read:purchase'],
    presentationModes: ['host_native', 'external_action', 'merchant_hosted'],
    paymentProviderKinds: ['trusted_host', 'processor_tokenizer', 'merchant_hosted'],
    authorizationProviderKinds: ['trusted_host_signature'],
    handlerNames: ['com.example.processor_tokenizer'],
    allowedReturnOrigins: ['https://host.example'],
    canReceiveAsyncPurchaseUpdates: true,
    thirdPartyPaymentEmbeddingAllowed: false,
    autonomousExecutionAllowed: true,
    attestationIssuer: 'https://verify-host.example',
    attestationAudience: 'https://arro.example'
  }
])
const service = createUcpCheckoutService({
  client: createUcpClient({
    fetch: referenceMerchantFetch,
    platformProfileUrl: 'https://arro.example/.well-known/ucp',
    platformProfile: platformProfile()
  }),
  store,
  platformProfile: platformProfile(),
  platformProfileUrl: 'https://arro.example/.well-known/ucp',
  hashPepper: verifierHashPepper,
  paymentHandlerRegistry: createPaymentHandlerRegistry([
    {
      adapterKind: 'processor_tokenizer',
      handlerName: 'com.example.processor_tokenizer',
      executionMode: 'client',
      supports: (declaration) =>
        declaration.version === UCP_STABLE_VERSION &&
        declaration.spec === referenceProcessorTokenizerSpec &&
        declaration.schema === referenceProcessorTokenizerSchema
    }
  ]),
  paymentHandlerSpecs: referenceProcessorTokenizerSpecs,
  paymentCredentialProvider: createHttpPaymentCredentialProvider({
    fetch: referenceMerchantFetch,
    credentialResolver: createTokenizerCredentialResolver([
      {
        merchantOrigin: 'https://merchant.example',
        provider: 'com.example.processor_tokenizer',
        handlerId: 'merchant_processor_tokenizer_1',
        tokenizeEndpoint: 'https://merchant.example/ucp/payment-handlers/com.example.processor_tokenizer/tokenize',
        environment: 'TEST',
        bearerToken: 'reference-merchant-tokenizer-auth'
      }
    ])
  }),
  paymentCredentialVault: createRedisPaymentCredentialVault({
    getClient: () => getRuntimeRedisClient(redisUrl),
    encryptionKey: paymentCredentialEncryptionKey
  }),
  paymentCredentialTtlSeconds: 900,
  paymentActionSigningSecret: verifierPaymentActionSigningSecret,
  trustedHostPaymentVerifier: createTrustedHostPaymentVerifier({
    fetch: trustedHostRedemptionFetch as typeof fetch,
    configs: [
      {
        hostId: 'verify-host',
        integrationId: 'agent:verify-key-1:generic-mcp-preview',
        issuer: 'https://verify-host.example',
        audience: 'https://arro.example',
        redemptionEndpoint: 'https://verify-host.example/arro/payment/redeem',
        jwks: [trustedHostPublicJwk]
      }
    ]
  }),
  agentHostRegistry,
  publicBaseUrl: 'https://arro.example'
})
const mandateRepository = createPurchaseMandateRepository({ client: pool })
const autonomousJobRepository = createPostgresAutonomousPurchaseJobRepository({ client: pool })
const purchaseOrchestrator = createPurchaseOrchestrator({
  service,
  mandates: mandateRepository
})

const verifyAuthenticator: Authenticator = async ({ request, requestId, requiredScopes }) => {
  const key = request.headers.get('x-api-key')?.trim()
  if (key !== verifierApiKey) {
    return {
      ok: false,
      decision: 'authentication_required',
      status: 401,
      body: {
        error: {
          code: 'authentication_required',
          message: 'A verifier API key is required.',
          requestId
        }
      }
    }
  }

  const missingScope = requiredScopes.find((scope) => !verifierAuthPrincipal.scopes.includes(scope))
  if (missingScope) {
    return {
      ok: false,
      decision: 'insufficient_scope',
      status: 403,
      principal: verifierAuthPrincipal,
      body: {
        error: {
          code: 'insufficient_scope',
          message: `Verifier API key does not have ${missingScope}.`,
          requestId
        }
      }
    }
  }

  return { ok: true, decision: 'allowed', principal: verifierAuthPrincipal }
}

const app = buildApp(new Elysia(), {
  ucpCheckoutService: service,
  purchaseOrchestrator,
  purchaseMandateRepository: mandateRepository,
  autonomousPurchaseJobRepository: autonomousJobRepository,
  authenticate: verifyAuthenticator,
  commercePrincipalHashPepper: verifierHashPepper,
  agentSessionSigningSecret: verifierAgentSessionSigningSecret,
  agentHostRegistry,
  autonomousPurchasesEnabled: true,
  primaryAutonomousRoute,
  trustedHostMandateAuthorizationVerifier: createTrustedHostMandateAuthorizationVerifier({
    configs: [
      {
        hostId: 'verify-host',
        integrationId: 'agent:verify-key-1:generic-mcp-preview',
        issuer: 'https://verify-host.example',
        audience: 'https://arro.example',
        jwks: [trustedHostPublicJwk]
      }
    ]
  }),
  requestTimeoutMs: 10_000
})

const jsonRequest = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      'x-api-key': verifierApiKey,
      'x-request-id': `verify-software-${method}-${path}`,
      ...headers
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  })

const readJsonResponse = async (response: Response) => {
  const body = await response.json() as Record<string, unknown>
  return { status: response.status, body }
}

const purchasePrepareBody = () => ({
  merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
  selectedOffer: {
    variantId: 'sku_65w_charger',
    title: '65W USB-C Charger',
    quantity: 1
  }
})

const agentSessionExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
const issuedAgentSession = createAgentSessionToken({
  request: {
    integrationId: 'generic-mcp-preview',
    surface: 'generic_mcp',
    allowedActionScopes: ['write:purchase', 'write:complete_purchase', 'read:purchase'],
    sessionExpiresAt: agentSessionExpiresAt,
    hostCapabilities: [...verifierHostCapabilities]
  },
  signingSecret: verifierAgentSessionSigningSecret,
  maxTtlSeconds: 900
})
if (!issuedAgentSession.ok) {
  throw new Error(`Could not issue verifier agent session: ${issuedAgentSession.message}`)
}
const agentContext = (scope: 'write:purchase' | 'write:complete_purchase' | 'read:purchase') => ({
  integrationId: 'generic-mcp-preview',
  surface: 'generic_mcp' as const,
  requestedActionScope: scope,
  sessionExpiresAt: agentSessionExpiresAt,
  sessionToken: issuedAgentSession.session.sessionToken,
  hostCapabilities: [...verifierHostCapabilities]
})

const purchasePrepareAgentBody = () => ({
  ...purchasePrepareBody(),
  agentContext: agentContext('write:purchase')
})

const anonymousPrepareResponse = await readJsonResponse(await app.handle(jsonRequest('/v1/purchases/prepare', 'POST', purchasePrepareAgentBody(), {
  'x-api-key': ''
})))
assert(anonymousPrepareResponse.status === 401, 'purchase prepare must reject anonymous callers before merchant execution.')
assert(state.createCalls === 0, 'Anonymous purchase prepare must not call the merchant checkout endpoint.')

const buyerProfileResponse = await readJsonResponse(await app.handle(jsonRequest('/v1/buyer-profile', 'PUT', {
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
      referenceId: 'safe-display-ref',
      brand: 'Visa',
      last4: '4242',
      status: 'active'
    }
  ]
}, {
  'x-arro-agent-integration-id': 'generic-mcp-preview',
  'x-arro-agent-surface': 'generic_mcp',
  'x-arro-agent-session-token': issuedAgentSession.session.sessionToken,
  'x-arro-agent-session-expires-at': agentSessionExpiresAt,
  'x-arro-agent-host-capabilities': 'source_labels,freshness,caveats,no_buy_warnings,commercial_disclosures,authority_limits,allowed_next_actions'
})))
assert(buyerProfileResponse.status === 200, `buyer profile upsert expected 200, got ${buyerProfileResponse.status}: ${JSON.stringify(buyerProfileResponse.body)}`)
assert(!JSON.stringify(buyerProfileResponse.body).toLowerCase().includes('cvv'), 'buyer profile response must not include raw payment credential fields.')
const buyerProfileGetResponse = await readJsonResponse(await app.handle(jsonRequest('/v1/buyer-profile', 'GET')))
assert(buyerProfileGetResponse.status === 200, `buyer profile get expected 200, got ${buyerProfileGetResponse.status}: ${JSON.stringify(buyerProfileGetResponse.body)}`)
assert(JSON.stringify(buyerProfileGetResponse.body).includes('shopper@example.com'), 'buyer profile get must return saved safe buyer/fulfillment metadata.')

const unsignedPrepareResponse = await readJsonResponse(await app.handle(jsonRequest('/v1/purchases/prepare', 'POST', purchasePrepareBody(), {
  'Idempotency-Key': idempotencyKey('purchase-prepare-unsigned')
})))
assert(unsignedPrepareResponse.status === 403, 'purchase prepare must reject API-key-only write access without a signed agent session.')
assert(state.createCalls === 0, 'Unsigned purchase prepare must not call the merchant checkout endpoint.')

const purchasePrepareResponse = await readJsonResponse(await app.handle(jsonRequest('/v1/purchases/prepare', 'POST', purchasePrepareAgentBody(), {
  'Idempotency-Key': idempotencyKey('purchase-prepare-1')
})))
assert(purchasePrepareResponse.status === 200, `purchase prepare expected 200, got ${purchasePrepareResponse.status}: ${JSON.stringify(purchasePrepareResponse.body)}`)
const purchaseId = typeof purchasePrepareResponse.body.purchaseId === 'string'
  ? purchasePrepareResponse.body.purchaseId
  : undefined
const purchaseSnapshotHash = typeof purchasePrepareResponse.body.checkoutSnapshotHash === 'string'
  ? purchasePrepareResponse.body.checkoutSnapshotHash
  : undefined
assert(purchaseId, 'purchase prepare must return a durable purchaseId backed by UCP transaction state.')
assert(Number(state.createCalls) === 1, 'purchase prepare must call @arro/ucp-client and the merchant checkout endpoint once.')
assert(purchasePrepareResponse.body.state === 'payment_action_required', 'purchase prepare must prefer an exact executable direct payment route over merchant continuation.')
assert(JSON.stringify(purchasePrepareResponse.body).includes('com.example.processor_tokenizer'), 'purchase prepare must expose the accepted direct payment capability before action creation.')
assert(JSON.stringify(purchasePrepareResponse.body).includes('Payment is not completed by Arro'), 'purchase prepare must not imply Arro completed payment.')
const session = purchaseId ? await store.readSession(purchaseId) : undefined
assert(session?.checkoutSnapshotHash, 'purchase prepare must persist a checkout snapshot hash.')
assert(session?.ownerPrincipalHash, 'purchase prepare must persist HMAC owner principal scope.')
assert(session?.ownerKeyId === 'verify-key-1', 'purchase prepare must persist API-key owner scope.')

const purchasePaymentActionResponse = purchaseId
  ? await readJsonResponse(await app.handle(jsonRequest(`/v1/purchases/${purchaseId}/payment-actions`, 'POST', {
      preference: {
        provider: 'com.example.processor_tokenizer',
        mode: 'processor_tokenizer'
      },
      returnUrl: 'https://host.example/return',
      agentContext: agentContext('write:purchase')
    }, { 'Idempotency-Key': idempotencyKey('purchase-payment-action-1') })))
  : { status: 500, body: {} }
assert(purchasePaymentActionResponse.status === 200, `purchase payment-action expected 200, got ${purchasePaymentActionResponse.status}: ${JSON.stringify(purchasePaymentActionResponse.body)}`)
const actionToken = typeof purchasePaymentActionResponse.body.actionToken === 'string'
  ? purchasePaymentActionResponse.body.actionToken
  : undefined
assert(actionToken?.startsWith(paymentActionTokenPrefix), 'purchase payment-action must return a signed one-time action token.')
assert(purchasePaymentActionResponse.body.status === 'pending_user_approval', 'purchase payment-action must start pending_user_approval.')
assert(purchasePaymentActionResponse.body.provider === 'com.example.processor_tokenizer', 'purchase payment-action must bind the merchant active Processor Tokenizer handler.')
assert(purchasePaymentActionResponse.body.handlerName === 'com.example.processor_tokenizer', 'purchase payment-action must expose handler name separately from merchant declaration id.')
assert(purchasePaymentActionResponse.body.handlerId === 'merchant_processor_tokenizer_1', 'purchase payment-action handlerId must equal the selected merchant payment-handler declaration id.')
assert(JSON.stringify(purchasePaymentActionResponse.body).includes('Approve this payment action once'), 'purchase payment-action must explain the single-approval boundary.')

const purchasePaymentActionStatusResponse = actionToken
  ? await readJsonResponse(await app.handle(jsonRequest(`/v1/payment-actions/${actionToken}/status`, 'GET')))
  : { status: 500, body: {} }
assert(purchasePaymentActionStatusResponse.status === 200, `purchase payment-action status expected 200, got ${purchasePaymentActionStatusResponse.status}: ${JSON.stringify(purchasePaymentActionStatusResponse.body)}`)
assert(purchasePaymentActionStatusResponse.body.status === 'pending_user_approval', 'payment-action status must be readable from the signed token without exposing credentials.')

const purchasePaymentResultResponse = actionToken
  ? await readJsonResponse(await app.handle(jsonRequest(`/v1/payment-actions/${actionToken}/result`, 'POST', {
      result: {
        type: 'processor_tokenizer_result',
        provider: 'com.example.processor_tokenizer',
        credentialReference: {
          reference: 'ptr_provider_tokenized_payment_result',
          proof: 'proof_provider_tokenized_payment_result'
        }
      }
    }, { 'Idempotency-Key': idempotencyKey('purchase-payment-result-1') })))
  : { status: 500, body: {} }
assert(purchasePaymentResultResponse.status === 200, `purchase payment-action result expected 200, got ${purchasePaymentResultResponse.status}: ${JSON.stringify(purchasePaymentResultResponse.body)}`)
assert(!JSON.stringify(purchasePaymentResultResponse.body).includes('ptr_provider_tokenized_payment_result'), 'purchase payment-result response must not echo source credential references.')
const storedPaymentResult = purchaseId ? await store.readLatestPaymentResult(purchaseId) : undefined
const storedCredential = storedPaymentResult?.instrument.credential as { redacted?: unknown; reference?: unknown; token?: unknown } | undefined
assert(storedCredential?.redacted === true, 'purchase payment-result must persist only redacted payment credential metadata in Postgres.')
assert(typeof storedCredential?.reference === 'string' && storedCredential.reference.startsWith('pcv_'), 'purchase payment-result must persist a payment credential vault reference.')
assert(storedCredential?.token === undefined, 'purchase payment-result must not persist merchant-tokenizer credentials in Postgres.')
const hasTimestamp = (value: unknown) =>
  typeof value === 'string' || value instanceof Date

const credentialReadyRows = await pool.query<{ status: string; credential_ready_at: string | Date | null }>(
  'select status, credential_ready_at from ucp_payment_actions where transaction_id = $1',
  [purchaseId]
)
assert(credentialReadyRows.rows.some((row) =>
  row.status === 'credential_ready' &&
  hasTimestamp(row.credential_ready_at)
), 'purchase payment-result must mark the action credential_ready before merchant completion.')

const purchaseConfirmResponse = purchaseId && purchaseSnapshotHash
  ? await readJsonResponse(await app.handle(jsonRequest(`/v1/purchases/${purchaseId}/confirm`, 'POST', {
      approvalRef: 'purchase-approval-1',
      checkoutSnapshotHash: purchaseSnapshotHash,
      agentContext: agentContext('write:complete_purchase')
    }, { 'Idempotency-Key': idempotencyKey('purchase-complete-1') })))
  : { status: 500, body: {} }
assert(purchaseConfirmResponse.status === 200, `purchase confirm expected 200, got ${purchaseConfirmResponse.status}: ${JSON.stringify(purchaseConfirmResponse.body)}`)
assert(!JSON.stringify(purchaseConfirmResponse.body).includes('ptr_provider_tokenized_payment_result'), 'purchase confirm response must not echo source credential references.')
const completeCallsAfterPurchase = Number(Reflect.get(state, 'completeCalls'))
assert(completeCallsAfterPurchase === 1, 'purchase confirm with stored provider result must call the same @arro/ucp-client completion path exactly once.')
const storedConfirmation = purchaseId ? await store.readConfirmation(purchaseId) : undefined
assert(storedConfirmation, 'purchase confirm must persist snapshot-bound buyer approval.')
const operationRows = await pool.query<{ operation: string }>(
  'select operation from ucp_checkout_operations where transaction_id = $1',
  [purchaseId]
)
assert(operationRows.rows.some((operation) => operation.operation === 'record_payment_result'), 'purchase payment-result must record operation continuity.')
assert(operationRows.rows.some((operation) => operation.operation === 'create_payment_action'), 'purchase payment-action must record operation continuity.')
assert(operationRows.rows.some((operation) => operation.operation === 'complete_checkout'), 'purchase confirm must record complete_checkout operation continuity.')
assert(await store.readOrder(referenceOrderId, 'https://merchant.example'), 'purchase confirm must persist merchant UCP Order continuity when order reference is returned.')
const recoveredResponse = purchaseId
  ? await readJsonResponse(await app.handle(jsonRequest(`/v1/purchases/${purchaseId}`, 'GET', undefined, {
      'x-arro-agent-integration-id': 'generic-mcp-preview',
      'x-arro-agent-surface': 'generic_mcp',
      'x-arro-agent-session-token': issuedAgentSession.session.sessionToken,
      'x-arro-agent-session-expires-at': agentSessionExpiresAt,
      'x-arro-agent-host-capabilities': 'source_labels,freshness,caveats,no_buy_warnings,commercial_disclosures,authority_limits,allowed_next_actions'
    })))
  : { status: 500, body: {} }
assert(recoveredResponse.status === 200, 'purchase get must refresh merchant-authoritative state.')
assert(JSON.stringify(recoveredResponse.body).includes('completed'), 'purchase get recovery must surface completed merchant state after reference recovery.')
assert(JSON.stringify(recoveredResponse.body).includes(`merchant.example/orders/${referenceOrderId}`), 'purchase get must preserve merchant order continuity.')
const paymentActionRows = await pool.query<{
  status: string
  provider: string
  handler_id: string
  handler_name: string
  handler_version: string | null
  handler_specification: string | null
  handler_schema: string | null
  payment_result_id: string | null
  consumed_at: string | Date | null
}>(
  'select status, provider, handler_id, handler_name, handler_version, handler_specification, handler_schema, payment_result_id, consumed_at from ucp_payment_actions where transaction_id = $1',
  [purchaseId]
)
assert(paymentActionRows.rows.some((row) =>
  row.status === 'consumed' &&
  row.provider === 'com.example.processor_tokenizer' &&
  row.handler_name === 'com.example.processor_tokenizer' &&
  row.handler_id === 'merchant_processor_tokenizer_1' &&
  row.handler_version === UCP_STABLE_VERSION &&
  row.handler_specification === referenceProcessorTokenizerSpec &&
  row.handler_schema === referenceProcessorTokenizerSchema &&
  typeof row.payment_result_id === 'string' &&
  hasTimestamp(row.consumed_at)
), 'payment action must be consumed exactly once and linked to the redacted payment-result row.')

const mandateCreateResponse = await readJsonResponse(await app.handle(jsonRequest('/v1/purchase-mandates', 'POST', {
  intentDescription: 'Buy one safe USB-C 65W laptop charger under delegated authority.',
  merchantOrigin: 'https://merchant.example',
  productId: 'sku_65w_charger',
  variantId: 'sku_65w_charger',
  currency: 'USD',
  maximumPerTransactionMinor: '5000',
  maximumTotalSpendMinor: '5000',
  useLimit: 1,
  expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  authorizationProvider: 'trusted_host_signature',
  agentContext: agentContext('write:complete_purchase')
})))
assert(mandateCreateResponse.status === 200, `mandate create expected 200, got ${mandateCreateResponse.status}: ${JSON.stringify(mandateCreateResponse.body)}`)
const mandateBody = mandateCreateResponse.body.mandate && typeof mandateCreateResponse.body.mandate === 'object'
  ? mandateCreateResponse.body.mandate as Record<string, unknown>
  : {}
const mandateId = typeof mandateBody.mandateId === 'string' ? mandateBody.mandateId : undefined
const approvalAction = mandateCreateResponse.body.approvalAction && typeof mandateCreateResponse.body.approvalAction === 'object'
  ? mandateCreateResponse.body.approvalAction as Record<string, unknown>
  : {}
assert(mandateId, 'mandate create must return a durable mandate id.')
assert(typeof approvalAction.actionId === 'string' && approvalAction.actionId.startsWith(purchaseMandateAuthorizationActionPrefix), 'mandate create must return a durable authorization action id.')
assert(!('approvalActionToken' in approvalAction), 'mandate create must not return a bearer approval token to the agent caller.')
assert(!JSON.stringify(mandateCreateResponse.body).includes('"authorization"'), 'draft mandate response must not contain pre-authorized evidence.')
const mandateNowSeconds = Math.floor(Date.now() / 1000)
const mandateAuthorizationSignature = signCompactJws({
  iss: 'https://verify-host.example',
  aud: 'https://arro.example',
  jti: `${verificationRun}-trusted-host-mandate`,
  iat: mandateNowSeconds,
  exp: mandateNowSeconds + 300,
  host_id: 'verify-host',
  owner_id: String(mandateBody.ownerId),
  integration_id: 'agent:verify-key-1:generic-mcp-preview',
  mandate_id: mandateId!,
  mandate_version: mandateBody.version,
  authorization_hash: mandateCreateResponse.body.authorizationHash,
  approval_action_id: approvalAction.actionId,
  valid_from: mandateBody.validFrom,
  expires_at: mandateBody.expiresAt,
  user_presence: true
})

const mandateAuthorizeResponse = mandateId && approvalAction.actionId
  ? await readJsonResponse(await app.handle(jsonRequest(`/v1/purchase-mandates/${mandateId}/authorize`, 'POST', {
      mode: 'trusted_host_signature',
      approvalActionId: approvalAction.actionId,
      evidence: {
        trustedHostSignature: mandateAuthorizationSignature
      },
      agentContext: agentContext('write:complete_purchase')
    })))
  : { status: 500, body: {} }
assert(mandateAuthorizeResponse.status === 200, `mandate authorize expected 200, got ${mandateAuthorizeResponse.status}: ${JSON.stringify(mandateAuthorizeResponse.body)}`)
assert(JSON.stringify(mandateAuthorizeResponse.body).includes('"status":"active"'), 'mandate authorize must activate only after consuming approval evidence.')
const mandateReplayResponse = mandateId && approvalAction.actionId
  ? await readJsonResponse(await app.handle(jsonRequest(`/v1/purchase-mandates/${mandateId}/authorize`, 'POST', {
      mode: 'trusted_host_signature',
      approvalActionId: approvalAction.actionId,
      evidence: {
        trustedHostSignature: mandateAuthorizationSignature
      },
      agentContext: agentContext('write:complete_purchase')
    })))
  : { status: 500, body: {} }
assert(mandateReplayResponse.status === 409, 'mandate authorization action must be consume-once and reject replay.')

const autonomousJobCreateResponse = mandateId
  ? await readJsonResponse(await app.handle(jsonRequest(`/v1/purchase-mandates/${mandateId}/jobs`, 'POST', {
      trigger: { type: 'immediate' },
      agentContext: agentContext('write:complete_purchase')
    })))
  : { status: 500, body: {} }
assert(autonomousJobCreateResponse.status === 200, `autonomous job create expected 200, got ${autonomousJobCreateResponse.status}: ${JSON.stringify(autonomousJobCreateResponse.body)}`)
const autonomousJobId = typeof autonomousJobCreateResponse.body.jobId === 'string'
  ? autonomousJobCreateResponse.body.jobId
  : undefined
assert(autonomousJobId?.startsWith('apj_'), 'autonomous job creation must return a durable autonomous purchase job id.')
assert(autonomousJobCreateResponse.body.mandateId === mandateId, 'autonomous job must bind the selected mandate id.')
assert(autonomousJobCreateResponse.body.status === 'scheduled', 'immediate autonomous job must enter scheduled state for durable worker claim.')
assert(autonomousJobCreateResponse.body.authorizationRoute === primaryAutonomousRoute, 'autonomous job must persist the selected route.')
assert(autonomousJobCreateResponse.body.hostId === 'verify-host', 'autonomous job must persist the server-derived trusted host.')
const autonomousJobListResponse = mandateId
  ? await readJsonResponse(await app.handle(jsonRequest(`/v1/purchase-mandates/${mandateId}/jobs`, 'GET', undefined, {
      'x-arro-agent-integration-id': 'generic-mcp-preview',
      'x-arro-agent-surface': 'generic_mcp',
      'x-arro-agent-session-token': issuedAgentSession.session.sessionToken,
      'x-arro-agent-session-expires-at': agentSessionExpiresAt,
      'x-arro-agent-host-capabilities': 'source_labels,freshness,caveats,no_buy_warnings,commercial_disclosures,authority_limits,allowed_next_actions'
    })))
  : { status: 500, body: {} }
assert(autonomousJobListResponse.status === 200, `autonomous job list expected 200, got ${autonomousJobListResponse.status}: ${JSON.stringify(autonomousJobListResponse.body)}`)
assert(JSON.stringify(autonomousJobListResponse.body).includes(autonomousJobId ?? 'missing-job-id'), 'autonomous job list must return durable job continuity.')

const autonomousPaymentExecutor: AutonomousPaymentExecutor = {
  async approvePaymentAction({ paymentAction }) {
    assert(paymentAction.actionType === 'host_supplied', 'trusted_host autonomous worker must create a host_supplied payment action.')
    assert(paymentAction.capabilityId === 'trusted_host:com.example.processor_tokenizer:merchant_processor_tokenizer_1', 'trusted_host autonomous worker must bind the selected host-native capability.')
    const autonomousActionToken = typeof paymentAction.actionToken === 'string'
      ? paymentAction.actionToken
      : undefined
    assert(autonomousActionToken?.startsWith(paymentActionTokenPrefix), 'autonomous worker must create a signed payment action token through the runtime service.')
    const autonomousActionNonce = autonomousActionToken ? decodePaymentActionTokenNonce(autonomousActionToken) : undefined
    assert(autonomousActionNonce, 'trusted_host autonomous worker must bind attestation to the signed payment-action nonce.')
    const autonomousNowSeconds = Math.floor(Date.now() / 1000)
    return {
      idempotencyKey: idempotencyKey('autonomous-worker-payment-result'),
      result: {
        type: 'trusted_host_attestation',
        attestation: signCompactJws({
          iss: 'https://verify-host.example',
          aud: 'https://arro.example',
          jti: `${verificationRun}-trusted-host-autonomous-worker`,
          iat: autonomousNowSeconds,
          exp: autonomousNowSeconds + 300,
          host_id: 'verify-host',
          integration_id: 'agent:verify-key-1:generic-mcp-preview',
          action_id: paymentAction.actionId,
          transaction_id: paymentAction.purchaseId,
          checkout_id: paymentAction.checkoutId,
          checkout_snapshot_hash: paymentAction.checkoutSnapshotHash,
          payment_action_nonce_hash: paymentActionNonceHash(autonomousActionNonce!),
          merchant_origin: 'https://merchant.example',
          handler_name: paymentAction.handlerName,
          handler_id: paymentAction.handlerId,
          capability_id: String(paymentAction.capabilityId),
          credential_reference: `${verificationRun}-opaque-host-reference`
        })
      }
    }
  }
}
const autonomousWorkerResult = await createAutonomousPurchaseWorker({
  jobs: autonomousJobRepository,
  mandates: mandateRepository,
  purchases: purchaseOrchestrator,
  primaryAutonomousRoute,
  paymentExecutor: autonomousPaymentExecutor
}).runOnce({
  leaseOwner: `${verificationRun}-autonomous-worker`,
  leaseSeconds: 60
})
assert(autonomousWorkerResult.status === 'completed', `autonomous worker expected completed, got ${JSON.stringify(autonomousWorkerResult)}`)
const autonomousPurchaseId = autonomousWorkerResult.status === 'completed'
  ? autonomousWorkerResult.purchase.purchaseId
  : undefined
assert(autonomousPurchaseId, 'autonomous worker must create a durable purchaseId through purchase orchestration.')
assert(!JSON.stringify(autonomousWorkerResult).includes('trusted-host-checkout-scoped-secret'), 'trusted_host autonomous worker result must not echo redeemed host credentials.')

const autonomousApprovedRows = await pool.query<{ status: string; approved_at: string | Date | null; credential_ready_at: string | Date | null; consumed_at: string | Date | null }>(
  'select status, approved_at, credential_ready_at, consumed_at from ucp_payment_actions where transaction_id = $1',
  [autonomousPurchaseId]
)
assert(autonomousApprovedRows.rows.some((row) =>
  row.status === 'consumed' &&
  hasTimestamp(row.approved_at) &&
  hasTimestamp(row.credential_ready_at) &&
  hasTimestamp(row.consumed_at)
), 'autonomous worker payment action must pass approved and credential_ready before exact consume.')
assert(Number(state.completeCalls) === completeCallsAfterPurchase + 1, 'autonomous worker must call merchant complete_checkout exactly once after the human-present purchase.')
const committedMandateRows = await pool.query<{ total_committed_minor: string; use_count: number }>(
  'select total_committed_minor, use_count from purchase_mandates where mandate_id = $1',
  [mandateId]
)
assert(committedMandateRows.rows[0]?.total_committed_minor === '3299', 'autonomous worker must commit actual merchant Order amount through confirm_purchase.')
assert(committedMandateRows.rows[0]?.use_count === 1, 'autonomous worker must consume exactly one delegated use through confirm_purchase.')

const cartLifecyclePrepare = await readJsonResponse(await app.handle(jsonRequest('/v1/purchases/prepare', 'POST', purchasePrepareAgentBody(), {
  'Idempotency-Key': idempotencyKey('cart-lifecycle-prepare')
})))
assert(cartLifecyclePrepare.status === 200, `cart lifecycle prepare expected 200, got ${cartLifecyclePrepare.status}: ${JSON.stringify(cartLifecyclePrepare.body)}`)
const cartLifecyclePurchaseId = typeof cartLifecyclePrepare.body.purchaseId === 'string'
  ? cartLifecyclePrepare.body.purchaseId
  : undefined
assert(cartLifecyclePurchaseId, 'cart lifecycle prepare must return a purchaseId.')
if (cartLifecyclePurchaseId) {
  const cartLifecycleUpdate = await readJsonResponse(await app.handle(jsonRequest(`/v1/purchases/${cartLifecyclePurchaseId}`, 'PATCH', {
    agentContext: agentContext('write:purchase'),
    checkout: {
      line_items: [
        {
          item: {
            id: 'sku_65w_charger',
            title: '65W USB-C Charger'
          },
          quantity: 1
        }
      ]
    }
  }, { 'Idempotency-Key': idempotencyKey('cart-lifecycle-update') })))
  assert(cartLifecycleUpdate.status === 200, `cart lifecycle update expected 200, got ${cartLifecycleUpdate.status}: ${JSON.stringify(cartLifecycleUpdate.body)}`)

  const cartLifecycleGet = await readJsonResponse(await app.handle(jsonRequest(`/v1/purchases/${cartLifecyclePurchaseId}`, 'GET', undefined, {
    'x-arro-agent-integration-id': 'generic-mcp-preview',
    'x-arro-agent-surface': 'generic_mcp',
    'x-arro-agent-session-token': issuedAgentSession.session.sessionToken,
    'x-arro-agent-session-expires-at': agentSessionExpiresAt,
    'x-arro-agent-host-capabilities': 'source_labels,freshness,caveats,no_buy_warnings,commercial_disclosures,authority_limits,allowed_next_actions'
  })))
  assert(cartLifecycleGet.status === 200, `cart lifecycle get expected 200, got ${cartLifecycleGet.status}: ${JSON.stringify(cartLifecycleGet.body)}`)

  const cartLifecycleCancel = await readJsonResponse(await app.handle(jsonRequest(`/v1/purchases/${cartLifecyclePurchaseId}/cancel`, 'POST', {
    reason: 'verifier cart lifecycle cleanup',
    agentContext: agentContext('write:purchase')
  }, { 'Idempotency-Key': idempotencyKey('cart-lifecycle-cancel') })))
  assert(cartLifecycleCancel.status === 200, `cart lifecycle cancel expected 200, got ${cartLifecycleCancel.status}: ${JSON.stringify(cartLifecycleCancel.body)}`)

  const cartOperationRows = await pool.query<{ operation: string }>(
    'select operation from ucp_checkout_operations where transaction_id = $1',
    [cartLifecyclePurchaseId]
  )
  for (const operation of ['create_cart', 'update_cart', 'get_cart', 'cancel_cart']) {
    assert(
      cartOperationRows.rows.some((row) => row.operation === operation),
      `cart lifecycle must record ${operation} operation continuity.`
    )
  }
}

const mcpPrepare = await readJsonResponse(await app.handle(jsonRequest('/v1/mcp', 'POST', {
  jsonrpc: '2.0',
  id: 'mcp-prepare-purchase',
  method: 'tools/call',
  params: {
    name: 'prepare_purchase',
    arguments: {
      idempotencyKey: idempotencyKey('mcp-prepare-purchase'),
      merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
      selectedOffer: {
        variantId: 'sku_65w_charger',
        title: '65W USB-C Charger',
        quantity: 1
      },
      agentContext: agentContext('write:purchase')
    }
  }
})))
assert(mcpPrepare.status === 200, `MCP prepare_purchase expected 200, got ${mcpPrepare.status}.`)
assert(JSON.stringify(mcpPrepare.body).includes('structuredContent'), 'MCP prepare_purchase must return structured content.')
assert(JSON.stringify(mcpPrepare.body).includes('purchaseId'), 'MCP prepare_purchase must expose transaction continuity.')

const orderWebhook = businessProfile().ucp.version && {
  ucp: { version: UCP_STABLE_VERSION, status: 'success' },
  id: `${verificationRun}-webhook-order-1`,
  checkout_id: referenceCheckoutId,
  permalink_url: `https://merchant.example/orders/${verificationRun}-webhook-order-1`,
  currency: 'USD',
  line_items: [
    {
      id: 'li_1',
      item: { id: 'sku_65w_charger', title: '65W USB-C Charger', price: 2999 },
      quantity: 1,
      totals: [{ type: 'total', amount: 3299, currency: 'USD' }]
    }
  ],
  fulfillment: { events: [] },
  totals: [{ type: 'total', amount: 3299, currency: 'USD' }]
}
const rawWebhookBody = JSON.stringify(orderWebhook)
const webhookDigest = createHash('sha256').update(rawWebhookBody, 'utf8').digest('base64')
const webhookNow = Math.floor(Date.now() / 1000)
const webhookUcpAgent = 'profile="https://merchant.example/.well-known/ucp"'
const webhookId = `${verificationRun}-wh-1`
const webhookContentDigest = `sha-256=:${webhookDigest}:`
const webhookSignatureInput = `sig1=("@method" "@path" "content-digest" "ucp-agent" "webhook-id" "webhook-timestamp");created=${webhookNow};keyid="${referenceMerchantSigningKeyId}"`
const webhookSignatureBase = [
  '"@method": POST',
  '"@path": /v1/webhooks/ucp/orders',
  `"content-digest": ${webhookContentDigest}`,
  `"ucp-agent": ${webhookUcpAgent}`,
  `"webhook-id": ${webhookId}`,
  `"webhook-timestamp": ${webhookNow}`,
  `"@signature-params": ("@method" "@path" "content-digest" "ucp-agent" "webhook-id" "webhook-timestamp");created=${webhookNow};keyid="${referenceMerchantSigningKeyId}"`
].join('\n')
const webhookSigner = createSign('sha256')
webhookSigner.update(webhookSignatureBase)
webhookSigner.end()
const webhookSignature = webhookSigner
  .sign(createPrivateKey({ key: referenceMerchantSigningPrivateJwk, format: 'jwk' }))
  .toString('base64')
const webhookResponse = await readJsonResponse(await app.handle(new Request('http://localhost/v1/webhooks/ucp/orders', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-request-id': 'verify-software-webhook',
    'x-ucp-merchant-origin': 'https://merchant.example',
    'webhook-id': webhookId,
    'webhook-timestamp': String(webhookNow),
    'ucp-agent': webhookUcpAgent,
    'content-digest': webhookContentDigest,
    'signature-input': webhookSignatureInput,
    signature: `sig1=:${webhookSignature}:`
  },
  body: rawWebhookBody
})))
assert(webhookResponse.status === 200, `UCP order webhook expected 200, got ${webhookResponse.status}: ${JSON.stringify(webhookResponse.body)}`)
const webhookRows = await pool.query<{ webhook_id: string; signature_verified: boolean }>(
  'select webhook_id, signature_verified from ucp_order_webhook_events where webhook_id = $1',
  [webhookId]
)
assert(webhookRows.rows.length === 1 && webhookRows.rows[0]?.signature_verified === true, 'Signed UCP order webhook route must persist verified full-Order body.')
assert(await store.readOrder(`${verificationRun}-webhook-order-1`, 'https://merchant.example'), 'Signed UCP order webhook must update order continuity.')

const softwareVerificationSummary = {
  selectedPrimaryAutonomousRoute: primaryAutonomousRoute,
  referenceOrSandboxEnvironment: 'reference_merchant_test_runtime',
  paymentProvider: 'processor_tokenizer + trusted_host_attestation',
  merchantHandler: 'com.example.processor_tokenizer#merchant_processor_tokenizer_1',
  authorizationProvider: 'trusted_host_signature',
  humanPresentPurchaseId: purchaseId ?? 'missing',
  autonomousPurchaseId: autonomousPurchaseId ?? 'missing',
  resultingOrderId: referenceOrderId,
  merchantCompletionCalls: Number(state.completeCalls)
}

const ap2RuntimeProof = await runAp2RuntimeVerification('all')
assert(ap2RuntimeProof.human?.orderId, 'Software verification requires an authenticated human-present AP2 merchant Order.')
assert(ap2RuntimeProof.autonomous?.orderId, 'Software verification requires an authenticated autonomous AP2 merchant Order.')
Object.assign(softwareVerificationSummary, {
  ap2HumanOrderId: ap2RuntimeProof.human?.orderId,
  ap2AutonomousOrderId: ap2RuntimeProof.autonomous?.orderId
})

await pool.end()
await closeRuntimeDatabasePools()
await closeRuntimeRedisClients()

if (failures.length > 0) {
  console.error('Software verification failed.')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
} else {
  console.log('Software verification passed.')
  console.log(`Software verification summary: ${JSON.stringify(softwareVerificationSummary)}`)
  console.log('Validated app-level UCP HTTP routes, compact purchase routes, signed payment actions, MCP lifecycle tools, guarded @arro/ucp-client integration, confirmation-gated completion, merchant order continuity, signed full-Order webhook intake, and removal of legacy DecisionReceipt/HMAC blockers from the official UCP runtime path.')
}
