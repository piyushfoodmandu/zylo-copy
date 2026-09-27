import { createHash, createPrivateKey, createPublicKey, createSign } from 'node:crypto'
import { Elysia } from 'elysia'
import { Pool } from 'pg'
import {
  createPaymentHandlerRegistry,
  createUcpClient
} from '@arro/ucp-client'
import { UCP_STABLE_VERSION, type UcpPlatformProfile } from '@arro/contracts'
import {
  businessProfile,
  createReferenceMerchantFetch,
  platformProfile,
  referenceMerchantSigningPrivateJwk,
  referenceProcessorTokenizerSchema,
  referenceProcessorTokenizerSpec,
  type ReferenceMerchantState
} from '@arro/ucp-client/reference-merchant.test-support'
import { buildApp } from './app.ts'
import type { Authenticator } from './auth.ts'
import { createAgentSessionToken } from './agent-session.ts'
import { createAgentHostRegistry, type RegisteredAgentHost } from './agent-host-registry.ts'
import { createAutonomousPurchaseWorker, type AutonomousPaymentExecutor } from './autonomous-purchase-worker.ts'
import { createPostgresAutonomousPurchaseJobRepository } from './autonomous-purchase-jobs.ts'
import { createPurchaseMandateRepository } from './purchase-mandate.ts'
import { createPurchaseOrchestrator } from './purchase-orchestrator.ts'
import { closeRuntimeRedisClients, getRuntimeRedisClient } from './redis.ts'
import { createPostgresUcpCheckoutStore } from './ucp-checkout-store.ts'
import { createUcpCheckoutService } from './ucp-checkout-service.ts'
import { runMigrations } from './migrate.ts'
import { createRedisPaymentCredentialVault } from './payment-credential-vault.ts'
import {
  createHttpPaymentCredentialProvider,
  createTokenizerCredentialResolver,
  type PaymentHandlerSpecConfig
} from './payment-result-exchange.ts'
import { createTrustedHostMandateAuthorizationVerifier } from './trusted-host-mandate-authorization.ts'
import { createTrustedHostPaymentVerifier } from './trusted-host-payment.ts'
import type { Ap2TrustedIssuer } from './ap2-mandate.ts'
import type { PortablePaymentChallengeClient } from './portable-payment.ts'
import { resolveDatabaseUrlFromEnv } from './runtime-secrets.ts'
import { paymentActionTokenPrefix } from './payment-actions.ts'

export type PurchaseVerifierRuntime = Awaited<ReturnType<typeof createPurchaseVerifierRuntime>>

type RuntimeOptions = {
  runLabel: string
  merchantFetch?: typeof fetch
  state?: ReferenceMerchantState
  primaryAutonomousRoute?: 'trusted_host'
  hostOverrides?: Partial<RegisteredAgentHost>
  platformProfileOverride?: UcpPlatformProfile
  ap2TrustedIssuers?: Ap2TrustedIssuer[]
  trustedHostRedemptionFetch?: typeof fetch
  paymentHandlerSpecs?: PaymentHandlerSpecConfig[]
  googlePayAllowedOrigins?: string[]
  portablePaymentChallengeClient?: PortablePaymentChallengeClient
  registerAgentHost?: boolean
}

const verifierApiKey = 'verify-purchase-runtime-key'
const verifierHashPepper = 'verify-purchase-runtime-hash-pepper-32'
const verifierPaymentActionSigningSecret = 'verify-purchase-payment-action-signing-secret-32'
const verifierAgentSessionSigningSecret = 'verify-purchase-agent-session-signing-secret-32'
const trustedHostKeyId = 'verify-purchase-host-key-1'
const trustedHostPrivateKey = createPrivateKey({ key: referenceMerchantSigningPrivateJwk, format: 'jwk' })
const trustedHostPublicJwk = {
  ...createPublicKey(trustedHostPrivateKey).export({ format: 'jwk' }) as Record<string, unknown>,
  kid: trustedHostKeyId,
  alg: 'ES256',
  use: 'sig'
}

const base64UrlJson = (value: unknown) =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

export const paymentActionNonceHash = (nonce: string) =>
  `sha256:${createHash('sha256').update(nonce, 'utf8').digest('hex')}`

export const decodePaymentActionTokenNonce = (token: string) => {
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

export const signTrustedHostJwt = (payload: Record<string, unknown>) => {
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

export const readJsonResponse = async (response: Response) => ({
  status: response.status,
  body: await response.json() as Record<string, unknown>
})

export const createPurchaseVerifierRuntime = async ({
  runLabel,
  merchantFetch,
  state = {
    createCalls: 0,
    completeCalls: 0,
    idempotencyKeys: []
  },
  primaryAutonomousRoute = 'trusted_host',
  hostOverrides,
  platformProfileOverride,
  ap2TrustedIssuers = [],
  trustedHostRedemptionFetch: trustedHostRedemptionFetchOverride,
  paymentHandlerSpecs: paymentHandlerSpecsOverride,
  googlePayAllowedOrigins,
  portablePaymentChallengeClient,
  registerAgentHost = true
}: RuntimeOptions) => {
  const databaseUrl = resolveDatabaseUrlFromEnv(process.env)
  if (!databaseUrl) throw new Error(`${runLabel} requires DATABASE_URL.`)
  const redisUrl = process.env.REDIS_URL?.trim()
  if (!redisUrl) throw new Error(`${runLabel} requires REDIS_URL.`)
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
      where owner_key_id = $1
        and status not in ('completed', 'cancelled', 'failed')
    `,
    ['verify-purchase-key']
  ).catch(() => undefined)
  const referenceMerchantFetch = merchantFetch ?? createReferenceMerchantFetch(state)
  const runtimePlatformProfile = platformProfileOverride ?? platformProfile()
  const paymentHandlerSpecs = paymentHandlerSpecsOverride ?? [
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
  const store = createPostgresUcpCheckoutStore({ client: pool })
  const agentHostRegistry = registerAgentHost ? createAgentHostRegistry([
    {
      hostId: 'verify-host',
      integrationId: 'agent:verify-purchase-key:generic-mcp-preview',
      allowedScopes: ['read:purchase', 'write:purchase', 'write:complete_purchase'],
      presentationModes: ['host_native', 'merchant_hosted'],
      paymentProviderKinds: ['trusted_host', 'merchant_hosted'],
      authorizationProviderKinds: ['trusted_host_signature'],
      handlerNames: ['com.example.processor_tokenizer'],
      canReceiveAsyncPurchaseUpdates: true,
      thirdPartyPaymentEmbeddingAllowed: false,
      autonomousExecutionAllowed: true,
      attestationIssuer: 'https://verify-host.example',
      attestationAudience: 'https://arro.example',
      ...hostOverrides
    }
  ]) : undefined
  const trustedHostRedemptionFetch = trustedHostRedemptionFetchOverride ?? (async (_input: string | URL | Request, init?: RequestInit) => {
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
  })
  const service = createUcpCheckoutService({
    client: createUcpClient({
      fetch: referenceMerchantFetch,
      platformProfileUrl: 'https://arro.example/.well-known/ucp',
      platformProfile: runtimePlatformProfile
    }),
    store,
    platformProfile: runtimePlatformProfile,
    platformProfileUrl: 'https://arro.example/.well-known/ucp',
    hashPepper: verifierHashPepper,
    paymentHandlerRegistry: createPaymentHandlerRegistry(paymentHandlerSpecs.map((spec) => ({
      adapterKind: spec.adapterKind,
      handlerName: spec.handlerName,
      executionMode: 'client' as const,
      supports: (declaration) =>
        spec.versions.includes(declaration.version) &&
        declaration.spec === spec.specification &&
        declaration.schema === spec.schema
    }))),
    paymentHandlerSpecs,
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
    ...(portablePaymentChallengeClient ? { portablePaymentChallengeClient } : {}),
    trustedHostPaymentVerifier: createTrustedHostPaymentVerifier({
      fetch: trustedHostRedemptionFetch as typeof fetch,
      configs: [
        {
          hostId: 'verify-host',
          integrationId: 'agent:verify-purchase-key:generic-mcp-preview',
          issuer: 'https://verify-host.example',
          audience: 'https://arro.example',
          redemptionEndpoint: 'https://verify-host.example/arro/payment/redeem',
          jwks: [trustedHostPublicJwk]
        }
      ]
    }),
    ap2TrustedIssuers,
    ...(agentHostRegistry ? { agentHostRegistry } : {}),
    publicBaseUrl: 'https://arro.example'
  })
  const mandateRepository = createPurchaseMandateRepository({ client: pool })
  const autonomousJobRepository = createPostgresAutonomousPurchaseJobRepository({ client: pool })
  const purchaseOrchestrator = createPurchaseOrchestrator({
    service,
    mandates: mandateRepository
  })
  const verifierAuthPrincipal = {
    keyId: 'verify-purchase-key',
    ownerPrincipal: `verify:${runLabel}`,
    scopes: ['read:purchase', 'write:purchase', 'write:complete_purchase'],
    environment: 'test'
  }
  const verifyAuthenticator: Authenticator = async ({ request, requestId, requiredScopes }) => {
    if (request.headers.get('x-api-key')?.trim() !== verifierApiKey) {
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
    const missing = requiredScopes.find((scope) => !verifierAuthPrincipal.scopes.includes(scope))
    if (missing) {
      return {
        ok: false,
        decision: 'insufficient_scope',
        status: 403,
        principal: verifierAuthPrincipal,
        body: {
          error: {
            code: 'insufficient_scope',
            message: `Verifier API key does not have ${missing}.`,
            requestId
          }
        }
      }
    }
    return { ok: true, decision: 'allowed', principal: verifierAuthPrincipal }
  }
  const agentSessionExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const issuedAgentSession = createAgentSessionToken({
    request: {
      integrationId: 'generic-mcp-preview',
      surface: 'generic_mcp',
      allowedActionScopes: ['read:purchase', 'write:purchase', 'write:complete_purchase'],
      sessionExpiresAt: agentSessionExpiresAt,
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
    signingSecret: verifierAgentSessionSigningSecret,
    maxTtlSeconds: 900
  })
  if (!issuedAgentSession.ok) {
    throw new Error(`Could not issue ${runLabel} agent session: ${issuedAgentSession.message}`)
  }
  const app = buildApp(new Elysia(), {
    ucpCheckoutService: service,
    purchaseOrchestrator,
    purchaseMandateRepository: mandateRepository,
    autonomousPurchaseJobRepository: autonomousJobRepository,
    authenticate: verifyAuthenticator,
    commercePrincipalHashPepper: verifierHashPepper,
    agentSessionSigningSecret: verifierAgentSessionSigningSecret,
    ...(agentHostRegistry ? { agentHostRegistry } : {}),
    autonomousPurchasesEnabled: true,
    primaryAutonomousRoute,
    trustedHostMandateAuthorizationVerifier: createTrustedHostMandateAuthorizationVerifier({
      configs: [
        {
          hostId: 'verify-host',
          integrationId: 'agent:verify-purchase-key:generic-mcp-preview',
          issuer: 'https://verify-host.example',
          audience: 'https://arro.example',
          jwks: [trustedHostPublicJwk]
        }
      ]
    }),
    ap2TrustedIssuers,
    platformProfile: runtimePlatformProfile,
    paymentHandlerSpecs,
    ...(googlePayAllowedOrigins ? { googlePayAllowedOrigins } : {}),
    publicBaseUrl: 'https://arro.example',
    requestTimeoutMs: 10_000
  })
  const idempotencyKey = (label: string) => `${runLabel}-${label}`
  const jsonRequest = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        'x-api-key': verifierApiKey,
        'x-request-id': `${runLabel}-${method}-${path}`,
        ...headers
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    })
  const agentContext = (scope: 'read:purchase' | 'write:purchase' | 'write:complete_purchase') => ({
    integrationId: 'generic-mcp-preview',
    surface: 'generic_mcp' as const,
    requestedActionScope: scope,
    sessionExpiresAt: agentSessionExpiresAt,
    sessionToken: issuedAgentSession.session.sessionToken,
    hostCapabilities: [
      'source_labels',
      'freshness',
      'caveats',
      'no_buy_warnings',
      'commercial_disclosures',
      'authority_limits',
      'allowed_next_actions'
    ] as const
  })
  const close = async () => {
    await pool.end()
    await closeRuntimeRedisClients()
  }
  const createWorker = (paymentExecutor?: AutonomousPaymentExecutor) =>
    createAutonomousPurchaseWorker({
      jobs: autonomousJobRepository,
      mandates: mandateRepository,
      purchases: purchaseOrchestrator,
      primaryAutonomousRoute,
      ...(paymentExecutor ? { paymentExecutor } : {})
    })

  return {
    app,
    pool,
    store,
    state,
    businessProfile,
    idempotencyKey,
    jsonRequest,
    readJsonResponse,
    agentContext,
    createWorker,
    close
  }
}
