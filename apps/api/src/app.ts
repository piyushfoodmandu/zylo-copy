import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { openapi, type ElysiaOpenAPIConfig } from '@elysia/openapi'
import { Elysia } from 'elysia'
import {
  createTimeoutEnforcedCatalogFetcher,
  createCachedCatalogProductDetailFetcher,
  createCachedCatalogFetcher,
  createTimeoutEnforcedCatalogProductDetailFetcher,
  createCachedDnsResolver,
  createConnectorHttpFetcher,
  createUnavailableCatalogProductDetailFetcher,
  discoverUcpProfile as connectorDiscoverUcpProfile,
  type CatalogSource,
  type ConnectorHttpFetcher,
  type ConnectorDnsResolver,
  type CatalogProductDetailFetcher,
  type CatalogProductFetcher,
  type DiscoverUcpProfileOptions,
  targetBusinessSeedRecords
} from '@arro/connectors'
import {
  type UcpPlatformProfile,
  type TargetBusinessRecord,
  type UcpPaymentHandlerDeclaration,
  type UcpDiscoveryRequest,
  type UcpDiscoveryResponse,
  type ApiError
} from '@arro/contracts'
import {
  createGooglePayPaymentHandlerAdapter,
  createProcessorTokenizerPaymentHandlerAdapter,
  createPaymentHandlerRegistry,
  createUcpClient
} from '@arro/ucp-client'
import { config } from './config.ts'
import {
  createApiRequestAuthenticator,
  type Authenticator
} from './auth.ts'
import {
  recordRequestAuditLog,
  requestPath,
  type AuditRecorder
} from './audit-log.ts'
import {
  createPublicRateLimiter,
  createProtectedRateLimiter,
  type PublicRateLimiter,
  type RateLimitPolicy,
  type ProtectedRateLimiter
} from './rate-limit.ts'
import {
  applySecurityHeaders,
  enforceContentLength,
  enforceJsonContentType
} from './request-guards.ts'
import {
  runtimeConformanceOperations,
  type ConformanceOperations
} from './conformance.ts'
import {
  fetchTargetBusinessRecords,
  persistRuntimeUcpDiscoveryObservation,
  type DiscoveryObservationPersistenceResult,
  type PersistDiscoveryObservationOptions
} from './target-business-repository.ts'
import {
  runtimeSourceGovernanceOperations,
  type SourceGovernanceOperations
} from './source-governance.ts'
import {
  recordSearchAuditLog,
  type SearchAuditRecorder
} from './search-audit.ts'
import {
  recordProductDetailAuditLog,
  type ProductDetailAuditRecorder
} from './product-detail-audit.ts'
import {
  runtimeRequestLifecycle,
  type RequestLifecycle,
  type RequestLifecycleTicket
} from './request-lifecycle.ts'
import {
  createRequestTimeoutGuard,
  isRequestTimeoutError
} from './request-timeout.ts'
import { buildOpenApiDocument } from './openapi.ts'
import { createAgentDiagnosticsHandler } from './agent-diagnostics-handler.ts'
import {
  createDataRightsAccessHandler,
  createDataRightsCorrectionHandler,
  createDataRightsDeletionHandler,
  createDataRightsExportHandler
} from './data-rights-handler.ts'
import {
  createPostgresDataRightsStore,
  type DataRightsStore
} from './data-rights-service.ts'
import { createProductCompareHandler } from './product-compare-handler.ts'
import { createProductDetailHandler } from './product-detail-handler.ts'
import { createProductSanityCheckHandler } from './product-sanity-check-handler.ts'
import { createPurchaseOrchestrator, type PurchaseOrchestrator } from './purchase-orchestrator.ts'
import {
  createPurchaseMandateRepository,
  type PurchaseMandateRepository
} from './purchase-mandate.ts'
import {
  createPostgresAutonomousPurchaseJobRepository,
  type AutonomousPurchaseJobRepository
} from './autonomous-purchase-jobs.ts'
import {
  createAutonomousPurchaseWorker,
  type AutonomousPaymentExecutor
} from './autonomous-purchase-worker.ts'
import { createAutonomousCandidateResolver } from './autonomous-candidate-resolver.ts'
import { startAutonomousPurchaseRuntime } from './autonomous-purchase-runtime.ts'
import { createTrustedHostAutonomousPaymentExecutor } from './trusted-host-autonomous-payment.ts'
import {
  createPostgresPurchaseStepUpRepository,
  type PurchaseStepUpRepository
} from './purchase-step-up.ts'
import {
  createPostgresCommerceBuyerProfileStore,
  type CommerceBuyerProfileStore
} from './commerce-buyer-profile.ts'
import {
  createCommerceDirectory,
  createDirectCommerceDirectoryProvider,
  createLiveUcpProfileCommerceDirectoryProvider,
  createUcpCheckerRegistryDirectoryProvider
} from './commerce-directory.ts'
import {
  createMerchantAuthResolverFromEnv,
  type MerchantAuthResolver
} from './merchant-auth-resolver.ts'
import { createSearchHandler } from './search-handler.ts'
import { createSourceStateHandler } from './source-state-handler.ts'
import { createRuntimeCatalogAdapterRegistry } from './catalog-adapters.ts'
import { createCatalogReadModelFetcher } from './catalog-read-model.ts'
import { getRuntimeDatabasePool } from './database.ts'
import { createMcpHandler } from './mcp-handler.ts'
import { createAgentSessionIssueHandler } from './agent-session.ts'
import { buildPlatformProfile } from './platform-profile.ts'
import {
  resolveUcpPlatformIdentity,
  type UcpPlatformIdentity
} from './ucp-platform-identity.ts'
import {
  createUcpCheckoutService,
  type UcpCheckoutService
} from './ucp-checkout-service.ts'
import {
  createHttpPaymentCredentialProvider,
  createTokenizerCredentialResolverFromEnv,
  parsePaymentHandlerSpecConfig,
  parseTokenizerAuthConfig,
  paymentHandlersFromSpecConfig,
  processorTokenizerPaymentHandlersFromSpecConfig,
  type PaymentHandlerSpecConfig
} from './payment-result-exchange.ts'
import { createRedisPaymentCredentialVault } from './payment-credential-vault.ts'
import { createHttpPortablePaymentChallengeClient } from './portable-payment.ts'
import { createHttpStripeNativePaymentSessionClient } from './stripe-native-payment.ts'
import {
  createPostgresUcpCheckoutStore
} from './ucp-checkout-store.ts'
import { getRuntimeRedisClient } from './redis.ts'
import { validateShopperSessionToken } from './shopper-session.ts'
import { verifyPaymentActionToken } from './payment-actions.ts'
import { registerInfrastructureRoutes } from './routes/infrastructure.ts'
import { registerUcpBusinessesRoute } from './routes/ucp-businesses.ts'
import { registerUcpDiscoveryRoute } from './routes/ucp-discovery.ts'
import { registerAdminBusinessRoutes } from './routes/admin-businesses.ts'
import { registerAdminConformanceRoutes } from './routes/admin-conformance.ts'
import { registerAgentCapabilitiesRoutes } from './routes/agent-capabilities.ts'
import { registerAgentDiagnosticsRoute } from './routes/agent-diagnostics.ts'
import { registerAgentSessionRoute } from './routes/agent-session.ts'
import { registerCatalogSearchRoutes } from './routes/catalog-search.ts'
import { registerDataRightsRoutes } from './routes/data-rights.ts'
import { registerMcpRoute } from './routes/mcp.ts'
import { registerProductCompareRoute } from './routes/product-compare.ts'
import { registerProductSanityCheckRoute } from './routes/product-sanity-check.ts'
import { registerPurchaseRoutes } from './routes/purchases.ts'
import { registerSourceStateRoute } from './routes/source-state.ts'
import { createShopperAccounts } from './shopper-account.ts'
import { registerShopperAccountRoutes } from './routes/shopper-account.ts'
import { registerShopperSessionRoute } from './routes/shopper-session.ts'
import {
  createTrustedHostPaymentVerifier,
  parseTrustedHostPaymentConfigs
} from './trusted-host-payment.ts'
import { createTrustedHostMandateAuthorizationVerifier } from './trusted-host-mandate-authorization.ts'
import type { TrustedHostMandateAuthorizationVerifier } from './trusted-host-mandate-authorization.ts'
import { parseAp2TrustedIssuersJson, type Ap2TrustedIssuer } from './ap2-mandate.ts'
import {
  createAgentHostRegistry,
  type AgentHostRegistry
} from './agent-host-registry.ts'

const normalizeHeaderId = (value: string | null) => {
  const trimmed = value?.trim()
  return trimmed && trimmed.length <= 128 ? trimmed : randomUUID()
}

type RequestIds = {
  requestId: string
  correlationId: string
}

const loadTargetBusinessRecords = () =>
  config.databaseUrl
    ? fetchTargetBusinessRecords(config.databaseUrl)
    : Promise.resolve(targetBusinessSeedRecords)

type TargetBusinessRecordsLoader = () => Promise<TargetBusinessRecord[]>

const createCachedTargetBusinessRecordsLoader = (
  loadRecords: TargetBusinessRecordsLoader,
  ttlMs: number,
  currentTimeMs = () => Date.now()
): TargetBusinessRecordsLoader => {
  let cached:
    | {
        expiresAtMs: number
        records: TargetBusinessRecord[]
      }
    | undefined
  let pendingLoad: Promise<TargetBusinessRecord[]> | undefined

  return async () => {
    if (ttlMs <= 0) return loadRecords()

    const nowMs = currentTimeMs()
    if (cached && cached.expiresAtMs > nowMs) return cached.records
    if (pendingLoad) return pendingLoad

    pendingLoad = loadRecords()
      .then((records) => {
        cached = {
          records,
          expiresAtMs: currentTimeMs() + ttlMs
        }
        return records
      })
      .finally(() => {
        pendingLoad = undefined
      })

    return pendingLoad
  }
}

const apiError = (
  code: string,
  message: string,
  requestId: string
): ApiError => ({
  error: {
    code,
    message,
    requestId
  }
})

type BuildAppOptions = {
  authenticate?: Authenticator
  recordAudit?: AuditRecorder
  rateLimitProtectedRequest?: ProtectedRateLimiter
  rateLimitPublicRequest?: PublicRateLimiter
  discoverUcpProfile?: (request: UcpDiscoveryRequest, options: DiscoverUcpProfileOptions) => Promise<UcpDiscoveryResponse>
  loadTargetBusinessRecords?: () => Promise<TargetBusinessRecord[]>
  targetBusinessMatrixCacheTtlMs?: number
  catalogProductFetcher?: CatalogProductFetcher
  catalogProductDetailFetcher?: CatalogProductDetailFetcher
  connectedCatalogSources?: CatalogSource[]
  connectorTimeoutMs?: number
  catalogConnectorMaxSourcesPerRequest?: number
  catalogConnectorMaxConcurrencyPerRequest?: number
  catalogConnectorCoalescingWindowMs?: number
  persistDiscoveryObservation?: (options: PersistDiscoveryObservationOptions) => Promise<DiscoveryObservationPersistenceResult | undefined>
  sourceGovernance?: SourceGovernanceOperations
  conformance?: ConformanceOperations
  recordSearchAudit?: SearchAuditRecorder
  recordProductDetailAudit?: ProductDetailAuditRecorder
  requestLifecycle?: RequestLifecycle
  requestTimeoutMs?: number
  dataRightsStore?: DataRightsStore
  agentSessionSigningSecret?: string | undefined
  commercePrincipalHashPepper?: string | undefined
  agentSessionMaxTtlSeconds?: number
  connectorHttpFetcher?: ConnectorHttpFetcher
  connectorDnsResolver?: ConnectorDnsResolver
  ucpCheckoutService?: UcpCheckoutService
  purchaseOrchestrator?: PurchaseOrchestrator
  purchaseMandateRepository?: PurchaseMandateRepository
  autonomousPurchaseJobRepository?: AutonomousPurchaseJobRepository
  purchaseStepUpRepository?: PurchaseStepUpRepository
  commerceBuyerProfileStore?: CommerceBuyerProfileStore
  trustedHostMandateAuthorizationVerifier?: TrustedHostMandateAuthorizationVerifier
  merchantAuthResolver?: MerchantAuthResolver
  agentHostRegistry?: AgentHostRegistry
  autonomousPurchasesEnabled?: boolean
  primaryAutonomousRoute?: 'trusted_host'
  autonomousPaymentExecutor?: AutonomousPaymentExecutor
  embeddedCheckoutRuntimeEnabled?: boolean
  googlePayAllowedOrigins?: string[]
  appAllowedOrigins?: string[]
  /** Server-only credential for frontend SSR catalog fan-out; null disables the environment value. */
  frontendServerToken?: string | null
  publicBaseUrl?: string
  platformProfileUrl?: string
  platformProfile?: UcpPlatformProfile
  /** Explicit identity override; null disables environment identity for a focused harness. */
  ucpPlatformIdentity?: UcpPlatformIdentity | null
  paymentHandlerSpecs?: PaymentHandlerSpecConfig[]
  ap2TrustedIssuers?: Ap2TrustedIssuer[]
}

export const buildApp = (app = new Elysia(), options: BuildAppOptions = {}) => {
  const runtimePublicBaseUrl = options.publicBaseUrl ?? config.publicBaseUrl
  const runtimePlatformProfileUrl = options.platformProfileUrl ?? (
    options.publicBaseUrl
      ? new URL('/.well-known/ucp', `${runtimePublicBaseUrl}/`).toString()
      : config.platformProfileUrl
  )
  const ucpPlatformIdentity = options.ucpPlatformIdentity === undefined
    ? resolveUcpPlatformIdentity({
        privateJwkJson: config.ucpPlatformSigningPrivateJwkJson,
        privateJwkFile: config.ucpPlatformSigningPrivateJwkFile,
        additionalPublicJwksJson: config.ucpPlatformAdditionalPublicJwksJson
      })
    : options.ucpPlatformIdentity ?? undefined
  const appAllowedOrigins = new Set(options.appAllowedOrigins ?? config.appAllowedOrigins)
  const frontendServerToken = options.frontendServerToken === undefined
    ? config.frontendServerToken
    : options.frontendServerToken ?? undefined
  const agentSessionSigningSecret = options.agentSessionSigningSecret ?? config.agentSessionSigningSecret
  const authenticate = options.authenticate ?? createApiRequestAuthenticator(agentSessionSigningSecret)
  const recordAudit = options.recordAudit ?? recordRequestAuditLog
  const rateLimitProtectedRequest = options.rateLimitProtectedRequest ?? createProtectedRateLimiter()
  const rateLimitPublicRequest = options.rateLimitPublicRequest ?? createPublicRateLimiter()
  const connectorDnsResolver = options.connectorDnsResolver ?? createCachedDnsResolver({
    enabled: config.connectorDnsCacheEnabled,
    ttlMs: config.connectorDnsCacheTtlMs,
    maxEntries: config.connectorDnsCacheMaxEntries
  })
  const connectorHttpFetcher = options.connectorHttpFetcher ?? createConnectorHttpFetcher({
    maxConnectionsPerOrigin: config.catalogHttpMaxConnectionsPerOrigin,
    dnsResolver: connectorDnsResolver
  })
  const discoverUcpProfile = options.discoverUcpProfile ?? ((request, discoveryOptions) =>
    connectorDiscoverUcpProfile(request, {
      ...discoveryOptions,
      fetcher: connectorHttpFetcher,
      resolver: connectorDnsResolver
    }))
  const targetBusinessRecords = createCachedTargetBusinessRecordsLoader(
    options.loadTargetBusinessRecords ?? loadTargetBusinessRecords,
    options.targetBusinessMatrixCacheTtlMs ?? config.targetBusinessMatrixCacheTtlMs
  )
  const runtimeCatalogAdapters = options.catalogProductFetcher
    ? undefined
    : createRuntimeCatalogAdapterRegistry(process.env, {
        platformProfileUrl: runtimePlatformProfileUrl,
        allowLocalPlatformProfileUrl: config.environment !== 'production',
        fetcher: connectorHttpFetcher
      })
  const timeoutCatalogProductFetcher = createTimeoutEnforcedCatalogFetcher(
    options.catalogProductFetcher ?? runtimeCatalogAdapters!.fetcher
  )
  const projectedCatalogProductFetcher = !options.catalogProductFetcher && config.redisUrl
    ? createCatalogReadModelFetcher(timeoutCatalogProductFetcher, {
        getClient: () => getRuntimeRedisClient(config.redisUrl),
        freshForMs: config.catalogSearchCacheTtlMs
      })
    : timeoutCatalogProductFetcher
  const catalogProductFetcher = createCachedCatalogFetcher(
    projectedCatalogProductFetcher,
    {
      // Redis is the durable five-minute projection. This tiny L1 exists only
      // to coalesce bursts and avoid one Redis GET per rendered card; it cannot
      // hide a completed stale-while-revalidate refresh for long.
      ttlMs: options.catalogProductFetcher
        ? 0
        : config.redisUrl
          ? Math.min(config.catalogSearchCacheTtlMs, 2_000)
          : config.catalogSearchCacheTtlMs
    }
  )
  const catalogProductDetailFetcher = createCachedCatalogProductDetailFetcher(
    createTimeoutEnforcedCatalogProductDetailFetcher(
      options.catalogProductDetailFetcher ?? runtimeCatalogAdapters?.detailFetcher ?? createUnavailableCatalogProductDetailFetcher()
    ),
    // Tests inject their own fetcher to assert call counts, so reuse is off
    // unless the runtime adapters are the ones answering.
    { ttlMs: options.catalogProductDetailFetcher ? 0 : config.catalogProductDetailCacheTtlMs }
  )
  const connectedCatalogSources = options.connectedCatalogSources ?? runtimeCatalogAdapters?.connectedSources ?? []
  const connectorTimeoutMs = options.connectorTimeoutMs ?? config.connectorTimeoutMs
  const catalogConnectorMaxSourcesPerRequest =
    options.catalogConnectorMaxSourcesPerRequest ?? config.catalogConnectorMaxSourcesPerRequest
  const catalogConnectorMaxConcurrencyPerRequest =
    options.catalogConnectorMaxConcurrencyPerRequest ?? config.catalogConnectorMaxConcurrencyPerRequest
  const catalogConnectorCoalescingWindowMs =
    options.catalogConnectorCoalescingWindowMs ?? (options.catalogProductFetcher ? 0 : config.catalogConnectorCoalescingWindowMs)
  const persistDiscoveryObservation = options.persistDiscoveryObservation ?? ((persistOptions) =>
    persistRuntimeUcpDiscoveryObservation(persistOptions, config.databaseUrl))
  const sourceGovernance = options.sourceGovernance ?? runtimeSourceGovernanceOperations()
  const conformance = options.conformance ?? runtimeConformanceOperations()
  const recordSearchAudit = options.recordSearchAudit ?? recordSearchAuditLog
  const recordProductDetailAudit = options.recordProductDetailAudit ?? recordProductDetailAuditLog
  const requestLifecycle = options.requestLifecycle ?? runtimeRequestLifecycle
  const requestTimeoutMs = options.requestTimeoutMs ?? config.requestTimeoutMs
  const commercePrincipalHashPepper = options.commercePrincipalHashPepper ?? config.apiKeyPepper
  const agentSessionMaxTtlSeconds = options.agentSessionMaxTtlSeconds ?? config.agentSessionMaxTtlSeconds
  const discoveryRequiredScopes = ['discovery:write']
  const agentSessionRequiredScopes = ['agent:session']
  const dataRightsReadScopes = ['data-rights:read']
  const dataRightsWriteScopes = ['data-rights:write']
  const adminRequiredScopes = ['admin:*']
  const requestIds = new WeakMap<Request, RequestIds>()

  const idsForRequest = (request: Request): RequestIds => {
    const existing = requestIds.get(request)
    if (existing) return existing

    const requestId = normalizeHeaderId(request.headers.get('x-request-id'))
    const correlationId = normalizeHeaderId(request.headers.get('x-correlation-id') ?? requestId)
    const ids = { requestId, correlationId }
    requestIds.set(request, ids)
    return ids
  }

  const setRequestIdHeaders = (set: { headers: Record<string, string | number> }, ids: RequestIds) => {
    set.headers['x-request-id'] = ids.requestId
    set.headers['x-correlation-id'] = ids.correlationId
  }

  const applyAppCorsHeaders = (
    request: Request,
    headers: Record<string, string | number>
  ) => {
    const origin = request.headers.get('origin')?.trim()
    if (!origin) return false

    const existingVary = String(headers.vary ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    if (!existingVary.some((value) => value.toLowerCase() === 'origin')) {
      headers.vary = [...existingVary, 'Origin'].join(', ')
    }

    if (!appAllowedOrigins.has(origin)) return false

    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-methods'] = 'GET, POST, PATCH, DELETE, OPTIONS'
    headers['access-control-allow-headers'] =
      'authorization, content-type, idempotency-key, ucp-agent, x-api-key, x-agent-session, x-correlation-id, x-request-id, x-arro-shopper-session'
    headers['access-control-expose-headers'] =
      'retry-after, server-timing, x-correlation-id, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, x-request-id'
    headers['access-control-max-age'] = '600'
    return true
  }

  const drainBypassPath = (request: Request) => {
    const path = requestPath(request)
    return path === '/health/live' || path === '/health/ready'
  }

  const publicRateLimitPolicy = (request: Request): RateLimitPolicy | undefined => {
    const method = request.method.toUpperCase()
    const path = requestPath(request)
    if (path === '/v1/shopper/session') {
      return {
        routeGroup: 'public_session_issue',
        // A shared mobile carrier or campus address can legitimately introduce
        // many shoppers. Subsequent catalog and checkout traffic is keyed to
        // the issued shopper credential instead of this network bucket.
        maxRequests: Math.max(60, config.rateLimitAgentSessionMax * 30),
        windowSeconds: config.rateLimitWindowSeconds
      }
    }
    if (path === '/v1/webhooks/ucp/orders') {
      return {
        routeGroup: 'public_order_webhook',
        maxRequests: Math.max(60, config.rateLimitAgentSessionMax * 30),
        windowSeconds: config.rateLimitWindowSeconds
      }
    }
    if (
      path.startsWith('/v1/purchases') ||
      path.startsWith('/v1/payment-actions')
    ) {
      return {
        routeGroup: 'public_commerce_write',
        maxRequests: Math.max(1, config.rateLimitAgentSessionMax),
        windowSeconds: config.rateLimitWindowSeconds
      }
    }

    if (method !== 'POST') return undefined

    if (path === '/v1/mcp') {
      return {
        routeGroup: 'public_mcp',
        maxRequests: Math.max(1, config.rateLimitAgentSessionMax * 3),
        windowSeconds: config.rateLimitWindowSeconds
      }
    }

    if (
      path === '/v1/catalog/search' ||
      path === '/v1/catalog/product' ||
      path === '/v1/product/compare' ||
      path === '/v1/product/sanity-check' ||
      path === '/v1/source/state'
    ) {
      return {
        routeGroup: 'public_commerce_read',
        maxRequests: Math.max(1, config.rateLimitAgentSessionMax * 6),
        windowSeconds: config.rateLimitWindowSeconds
      }
    }

    return undefined
  }

  const publicRateLimitIdentity = (request: Request) => {
    const path = requestPath(request)
    const paymentActionToken = /^\/v1\/payment-actions\/([^/]+)/.exec(path)?.[1]
    if (paymentActionToken && config.paymentActionSigningSecret) {
      try {
        const action = verifyPaymentActionToken(
          paymentActionToken,
          config.paymentActionSigningSecret
        )
        return `payment-action:${createHash('sha256').update(action.actionId).digest('base64url')}`
      } catch {
        // An invalid caller-controlled token must not mint a fresh Redis bucket.
      }
    }
    const shopperSession = request.headers.get('x-arro-shopper-session')?.trim()
    if (shopperSession && agentSessionSigningSecret) {
      const claims = validateShopperSessionToken({
        token: shopperSession,
        signingSecret: agentSessionSigningSecret
      })
      if (claims) {
        // Token rotation retains the shopper principal and therefore the same
        // quota identity instead of granting a fresh bucket.
        return `shopper:${createHash('sha256').update(claims.sessionId).digest('base64url')}`
      }
    }

    const network = [
      request.headers.get('cf-connecting-ip'),
      request.headers.get('x-real-ip'),
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ].find(value => value && value.trim().length > 0) ?? 'unknown-client'
    // User-Agent and UCP-Agent are caller-controlled. Route groups already
    // isolate webhook, catalog and session quotas, so the fallback identity is
    // only the edge-provided network address.
    return `network:${createHash('sha256').update(network).digest('base64url')}`
  }

  const trustedFrontendCatalogRequest = (request: Request, policy: RateLimitPolicy) => {
    if (policy.routeGroup !== 'public_commerce_read' || !frontendServerToken) return false
    const presented = request.headers.get('x-arro-frontend-server')
    if (!presented) return false
    const actual = Buffer.from(presented)
    const expected = Buffer.from(frontendServerToken)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }

  const finishLifecycleTicket = (ticket: RequestLifecycleTicket | undefined) => {
    if (!ticket) return

    ticket.finish()
  }

  const handleSearch = createSearchHandler({
    loadTargetBusinessRecords: targetBusinessRecords,
    catalogProductFetcher,
    connectedCatalogSources,
    connectorTimeoutMs,
    connectorMaxSourcesPerRequest: catalogConnectorMaxSourcesPerRequest,
    connectorMaxConcurrencyPerRequest: catalogConnectorMaxConcurrencyPerRequest,
    connectorCoalescingWindowMs: catalogConnectorCoalescingWindowMs,
    recordSearchAudit,
    agentSessionSigningSecret,
    apiError
  })
  const handleProductDetail = createProductDetailHandler({
    loadTargetBusinessRecords: targetBusinessRecords,
    catalogProductDetailFetcher,
    connectedCatalogSources,
    connectorTimeoutMs,
    recordProductDetailAudit,
    agentSessionSigningSecret,
    apiError
  })
  const handleProductSanityCheck = createProductSanityCheckHandler({
    agentSessionSigningSecret,
    apiError
  })
  const handleProductCompare = createProductCompareHandler({
    agentSessionSigningSecret,
    apiError
  })
  const handleSourceState = createSourceStateHandler({
    loadTargetBusinessRecords: targetBusinessRecords,
    connectedCatalogSources,
    agentSessionSigningSecret,
    apiError
  })
  const handleAgentDiagnostics = createAgentDiagnosticsHandler({
    agentSessionSigningSecret,
    apiError
  })
  const handleAgentSessionIssue = createAgentSessionIssueHandler({
    signingSecret: agentSessionSigningSecret,
    maxTtlSeconds: agentSessionMaxTtlSeconds,
    apiError
  })
  const guardedUcpFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const headers = init?.headers
      ? Object.fromEntries(new Headers(init.headers).entries())
      : undefined
    const body = typeof init?.body === 'string' || init?.body instanceof Uint8Array
      ? init.body
      : init?.body === undefined || init.body === null
        ? undefined
        : String(init.body)
    const response = await connectorHttpFetcher(url, {
      method: init?.method,
      ...(headers ? { headers } : {}),
      ...(body !== undefined ? { body } : {}),
      signal: init?.signal
    })
    const responseBody = await response.body.text()
    const responseHeaders = new Headers()
    for (const headerName of [
      'content-digest',
      'signature-input',
      'signature',
      'ucp-agent',
      'request-id',
      'idempotency-key',
      'retry-after',
      'content-type',
      'location'
    ]) {
      const headerValue = response.headers.get(headerName)
      if (headerValue) responseHeaders.set(headerName, headerValue)
    }
    return new Response(responseBody, {
      status: response.status,
      headers: responseHeaders
    })
  }) satisfies typeof fetch
  const ucpCheckoutStore = config.databaseUrl
    ? createPostgresUcpCheckoutStore({
        client: getRuntimeDatabasePool(config.databaseUrl)
      })
    : undefined
  const paymentCredentialVault = config.paymentsEnabled &&
    config.redisUrl &&
    config.paymentCredentialEncryptionKey
    ? createRedisPaymentCredentialVault({
        getClient: () => getRuntimeRedisClient(config.redisUrl),
        encryptionKey: config.paymentCredentialEncryptionKey
      })
    : undefined
  const processorTokenizerConfigs = config.paymentsEnabled && config.processorTokenizerEnabled && config.ucpTokenizerAuthJson
    ? parseTokenizerAuthConfig(JSON.parse(config.ucpTokenizerAuthJson) as unknown)
    : []
  const tokenizerCredentialResolver = createTokenizerCredentialResolverFromEnv(process.env)
  const paymentHandlerDefinitions = options.paymentHandlerSpecs ?? (
    config.paymentsEnabled && config.ucpPaymentHandlerSpecsJson
      ? parsePaymentHandlerSpecConfig(JSON.parse(config.ucpPaymentHandlerSpecsJson) as unknown)
      : []
  )
  const processorTokenizerSpecs = config.processorTokenizerEnabled
    ? paymentHandlerDefinitions.filter((definition) => definition.adapterKind === 'processor_tokenizer')
    : []
  const googlePaySpecs = config.googlePayEnabled
    ? paymentHandlerDefinitions.filter((definition) => definition.adapterKind === 'google_pay')
    : []
  const portablePaymentSpecs = paymentHandlerDefinitions.filter((definition) =>
    definition.adapterKind === 'x402' || definition.adapterKind === 'mpp'
  )
  const injectedPortablePaymentRuntime = Boolean(
    options.ucpCheckoutService &&
    options.purchaseOrchestrator &&
    options.paymentHandlerSpecs &&
    portablePaymentSpecs.length > 0
  )
  const portablePaymentsExecutable = Boolean(
    injectedPortablePaymentRuntime || (
      config.paymentsEnabled &&
      config.paymentActionSigningSecret &&
      paymentCredentialVault &&
      portablePaymentSpecs.length > 0
    )
  )
  const processorTokenizerExecutable = Boolean(
    config.paymentsEnabled &&
    config.paymentActionSigningSecret &&
    paymentCredentialVault &&
    config.processorTokenizerEnabled &&
    processorTokenizerSpecs.length > 0 &&
    processorTokenizerConfigs.length > 0
  )
  const googlePayExecutable = Boolean(
    config.paymentsEnabled &&
    config.paymentActionSigningSecret &&
    paymentCredentialVault &&
    config.googlePayEnabled &&
    googlePaySpecs.length > 0
  )
  const trustedHostPaymentConfigs = config.paymentsEnabled &&
    config.hostPaymentCapabilitiesJson &&
    config.hostPaymentAttestationKeysJson
    ? parseTrustedHostPaymentConfigs({
        capabilitiesJson: config.hostPaymentCapabilitiesJson,
        keysJson: config.hostPaymentAttestationKeysJson
      })
    : []
  const trustedHostPaymentVerifier = trustedHostPaymentConfigs.length > 0
    ? createTrustedHostPaymentVerifier({
        configs: trustedHostPaymentConfigs,
        fetch: guardedUcpFetch
      })
    : undefined
  const trustedHostMandateAuthorizationVerifier = options.trustedHostMandateAuthorizationVerifier ?? (trustedHostPaymentConfigs.length > 0
    ? createTrustedHostMandateAuthorizationVerifier({
        configs: trustedHostPaymentConfigs.map((config) => ({
          hostId: config.hostId,
          integrationId: config.integrationId,
          issuer: config.issuer,
          audience: config.audience,
          jwks: config.jwks
        }))
      })
    : undefined)
  const ap2TrustedIssuers = options.ap2TrustedIssuers ?? (config.ap2RuntimeEnabled
    ? parseAp2TrustedIssuersJson(config.ap2TrustedIssuersJson)
    : [])
  const paymentHandlerAdapters = [
    ...(portablePaymentsExecutable
      ? portablePaymentSpecs.map((handlerConfig) => ({
          adapterKind: handlerConfig.adapterKind,
          handlerName: handlerConfig.handlerName,
          executionMode: 'client' as const,
          ...(handlerConfig.actionOrigins?.length ? { actionOrigins: handlerConfig.actionOrigins } : {}),
          supports(declaration: UcpPaymentHandlerDeclaration) {
            return Boolean(declaration.id) &&
              handlerConfig.versions.includes(declaration.version) &&
              declaration.spec === handlerConfig.specification &&
              declaration.schema === handlerConfig.schema
          }
        }))
      : []),
    ...(processorTokenizerExecutable
      ? processorTokenizerSpecs.map((handlerConfig) => createProcessorTokenizerPaymentHandlerAdapter({
        handlerName: handlerConfig.handlerName,
        specificationUrl: handlerConfig.specification,
        schemaUrl: handlerConfig.schema,
        supportedVersions: [handlerConfig.versions[0]!, ...handlerConfig.versions.slice(1)],
        environment: handlerConfig.environment === 'PRODUCTION' ? 'PRODUCTION' : 'TEST',
        platformId: runtimePublicBaseUrl,
        ...(handlerConfig.actionOrigins?.length ? { actionOrigins: handlerConfig.actionOrigins } : {})
      }))
      : []),
    ...(googlePayExecutable
      ? googlePaySpecs.map((handlerConfig) => createGooglePayPaymentHandlerAdapter({
          specificationUrl: handlerConfig.specification,
          schemaUrl: handlerConfig.schema,
          supportedVersions: handlerConfig.versions,
          environment: handlerConfig.environment === 'PRODUCTION' ? 'PRODUCTION' : 'TEST',
          ...(config.googlePayWebEnabled && handlerConfig.actionOrigins?.length
            ? { actionOrigins: handlerConfig.actionOrigins }
            : {})
        }))
      : [])
  ]
  const paymentHandlerRegistry = createPaymentHandlerRegistry(paymentHandlerAdapters)
  const executablePaymentHandlerSpecs = [
    ...(portablePaymentsExecutable ? portablePaymentSpecs : []),
    ...(processorTokenizerExecutable ? processorTokenizerSpecs : []),
    ...(googlePayExecutable ? googlePaySpecs : [])
  ]
  const paymentHandlers = executablePaymentHandlerSpecs.length > 0
    ? paymentHandlersFromSpecConfig(executablePaymentHandlerSpecs)
    : {}
  const runtimePlatformProfile = options.platformProfile ?? buildPlatformProfile({
    catalog: true,
    shopifyCatalog: true,
    cart: Boolean(ucpCheckoutStore),
    checkout: Boolean(ucpCheckoutStore),
    fulfillment: Boolean(ucpCheckoutStore),
    order: Boolean(ucpCheckoutStore),
    ap2Mandate: Boolean(ucpCheckoutStore && config.ap2RuntimeEnabled && ap2TrustedIssuers.length > 0),
    ...(ucpPlatformIdentity ? { signingKeys: ucpPlatformIdentity.publicJwks } : {}),
    paymentHandlers,
    transports: [
      'mcp',
      'rest',
      ...((options.embeddedCheckoutRuntimeEnabled ?? config.embeddedCheckoutRuntimeEnabled) && ucpCheckoutStore
        ? ['embedded' as const]
        : [])
    ]
  })
  const agentHostRegistry = options.agentHostRegistry ?? createAgentHostRegistry(
    trustedHostPaymentConfigs.map((adapter) => ({
      hostId: adapter.hostId,
      integrationId: adapter.integrationId,
      allowedScopes: adapter.allowedScopes ?? [],
      presentationModes: [
        'host_native' as const,
        ...(adapter.thirdPartyPaymentEmbeddingAllowed ? ['embedded_component' as const] : []),
        ...((adapter.allowedReturnOrigins?.length ?? 0) > 0 ? ['external_action' as const] : []),
        'merchant_hosted' as const
      ],
      paymentProviderKinds: ['trusted_host' as const, 'merchant_hosted' as const],
      authorizationProviderKinds: ['trusted_host_signature'],
      handlerNames: adapter.handlerNames ?? [],
      componentProtocols: adapter.componentProtocols ?? [],
      allowedComponentOrigins: adapter.allowedComponentOrigins ?? [],
      allowedReturnOrigins: adapter.allowedReturnOrigins ?? [],
      canReceiveAsyncPurchaseUpdates: adapter.canReceiveAsyncPurchaseUpdates === true,
      thirdPartyPaymentEmbeddingAllowed: adapter.thirdPartyPaymentEmbeddingAllowed === true,
      autonomousExecutionAllowed: adapter.autonomousExecutionAllowed === true,
      attestationIssuer: adapter.issuer,
      attestationAudience: adapter.audience
    }))
  )
  const ucpCheckoutService = options.ucpCheckoutService ?? createUcpCheckoutService({
    client: createUcpClient({
      fetch: guardedUcpFetch,
      platformProfileUrl: runtimePlatformProfileUrl,
      platformProfile: runtimePlatformProfile,
      ...(ucpPlatformIdentity ? { signingPrivateJwk: ucpPlatformIdentity.privateJwk } : {}),
      allowHttpForLocalTesting: config.environment !== 'production'
    }),
    ...(ucpCheckoutStore ? { store: ucpCheckoutStore } : {}),
    platformProfile: runtimePlatformProfile,
    platformProfileUrl: runtimePlatformProfileUrl,
    ...(config.apiKeyPepper ? { hashPepper: config.apiKeyPepper } : {}),
    paymentHandlerRegistry,
    paymentHandlerSpecs: executablePaymentHandlerSpecs,
    paymentCredentialProvider: createHttpPaymentCredentialProvider({
      fetch: guardedUcpFetch,
      credentialResolver: tokenizerCredentialResolver
    }),
    stripeNativePaymentSessionClient: createHttpStripeNativePaymentSessionClient({
      fetch: guardedUcpFetch,
      credentialResolver: tokenizerCredentialResolver
    }),
    portablePaymentChallengeClient: createHttpPortablePaymentChallengeClient({
      fetch: guardedUcpFetch
    }),
    ...(paymentCredentialVault ? { paymentCredentialVault } : {}),
    paymentCredentialTtlSeconds: config.paymentCredentialTtlSeconds,
    ...(config.paymentActionSigningSecret ? { paymentActionSigningSecret: config.paymentActionSigningSecret } : {}),
    ...(trustedHostPaymentVerifier ? { trustedHostPaymentVerifier } : {}),
    ...(ap2TrustedIssuers.length > 0 ? { ap2TrustedIssuers } : {}),
    agentHostRegistry,
    publicBaseUrl: runtimePublicBaseUrl,
    merchantAuthResolver: options.merchantAuthResolver ?? createMerchantAuthResolverFromEnv(process.env, {
      fetch: guardedUcpFetch
    })
  })
  const commerceDirectoryProviders = [
    ...(config.ucpCheckerRegistryUrl && config.databaseUrl
      ? [
          createUcpCheckerRegistryDirectoryProvider({
            client: getRuntimeDatabasePool(config.databaseUrl),
            registryUrl: config.ucpCheckerRegistryUrl,
            fetch: guardedUcpFetch
          })
        ]
      : []),
    createLiveUcpProfileCommerceDirectoryProvider({
      fetch: guardedUcpFetch
    }),
    createDirectCommerceDirectoryProvider()
  ]
  const purchaseMandateRepository = options.purchaseMandateRepository ?? (config.databaseUrl
    ? createPurchaseMandateRepository({ client: getRuntimeDatabasePool(config.databaseUrl) })
    : undefined)
  const shopperAccounts = config.databaseUrl
    ? createShopperAccounts(getRuntimeDatabasePool(config.databaseUrl))
    : undefined
  const commerceBuyerProfileStore = options.commerceBuyerProfileStore ?? (config.databaseUrl
    ? createPostgresCommerceBuyerProfileStore({ client: getRuntimeDatabasePool(config.databaseUrl) })
    : undefined)
  const autonomousPurchaseJobRepository = options.autonomousPurchaseJobRepository ?? (config.databaseUrl
    ? createPostgresAutonomousPurchaseJobRepository({ client: getRuntimeDatabasePool(config.databaseUrl) })
    : undefined)
  const purchaseStepUpRepository = options.purchaseStepUpRepository ?? (config.databaseUrl
    ? createPostgresPurchaseStepUpRepository({ client: getRuntimeDatabasePool(config.databaseUrl) })
    : undefined)
  const purchaseOrchestrator = options.purchaseOrchestrator ?? createPurchaseOrchestrator({
    service: ucpCheckoutService,
    directory: createCommerceDirectory(commerceDirectoryProviders),
    ...(purchaseMandateRepository ? { mandates: purchaseMandateRepository } : {}),
    ...(commerceBuyerProfileStore ? { buyerProfiles: commerceBuyerProfileStore } : {}),
    ...(purchaseStepUpRepository ? { stepUps: purchaseStepUpRepository } : {})
  })
  const primaryAutonomousRoute = options.primaryAutonomousRoute ?? config.primaryAutonomousRoute
  const autonomousPaymentExecutor = options.autonomousPaymentExecutor ?? (
    primaryAutonomousRoute === 'trusted_host' && trustedHostPaymentConfigs.some((entry) => entry.authorizationEndpoint)
      ? createTrustedHostAutonomousPaymentExecutor({
          configs: trustedHostPaymentConfigs,
          fetch: guardedUcpFetch,
          timeoutMs: config.requestTimeoutMs
        })
      : undefined
  )
  if (
    options.autonomousPurchasesEnabled === undefined &&
    config.autonomousPurchasesEnabled &&
    primaryAutonomousRoute &&
    purchaseMandateRepository &&
    autonomousPurchaseJobRepository &&
    autonomousPaymentExecutor
  ) {
    startAutonomousPurchaseRuntime({
      worker: createAutonomousPurchaseWorker({
        jobs: autonomousPurchaseJobRepository,
        mandates: purchaseMandateRepository,
        purchases: purchaseOrchestrator,
        primaryAutonomousRoute,
        paymentExecutor: autonomousPaymentExecutor,
        ...(purchaseStepUpRepository ? { stepUps: purchaseStepUpRepository } : {}),
        candidateResolver: createAutonomousCandidateResolver({
          sources: connectedCatalogSources,
          fetcher: catalogProductFetcher,
          timeoutMs: connectorTimeoutMs
        })
      })
    })
  }
  const dataRightsStore = options.dataRightsStore ?? (
    config.databaseUrl
      ? createPostgresDataRightsStore({
          client: getRuntimeDatabasePool(config.databaseUrl),
          hashPepper: config.apiKeyPepper
        })
      : undefined
  )
  const handleDataRightsAccess = createDataRightsAccessHandler({
    ...(dataRightsStore ? { store: dataRightsStore } : {}),
    apiError
  })
  const handleDataRightsExport = createDataRightsExportHandler({
    ...(dataRightsStore ? { store: dataRightsStore } : {}),
    apiError
  })
  const handleDataRightsCorrection = createDataRightsCorrectionHandler({
    ...(dataRightsStore ? { store: dataRightsStore } : {}),
    apiError
  })
  const handleDataRightsDeletion = createDataRightsDeletionHandler({
    ...(dataRightsStore ? { store: dataRightsStore } : {}),
    apiError
  })
  const handleMcp = createMcpHandler({
    authenticate,
    agentSessionSigningSecret,
    hashPepper: commercePrincipalHashPepper,
    apiError,
    handleAgentDiagnostics,
    handleSearch,
    handleProductDetail,
    handleProductCompare,
    handleSourceState,
    handleProductSanityCheck,
    handlePurchases: purchaseOrchestrator,
    mppPaymentMethods: portablePaymentSpecs
      .filter((definition) => definition.adapterKind === 'mpp')
      .flatMap((definition) => {
        const methods = definition.handlerConfig?.methods
        return Array.isArray(methods)
          ? methods.filter((method): method is string => typeof method === 'string')
          : []
      })
  })

  const configuredApp = app
    .onRequest(async ({ request, set }) => {
      const ids = idsForRequest(request)

      setRequestIdHeaders(set, ids)
      applySecurityHeaders(set.headers, runtimePublicBaseUrl)
      const corsAllowed = applyAppCorsHeaders(request, set.headers)

      if (request.method.toUpperCase() === 'OPTIONS' && request.headers.has('origin')) {
        if (!corsAllowed) {
          set.status = 403
          return apiError(
            'cors_origin_denied',
            'This browser origin is not allowed to call the Arro API.',
            ids.requestId
          )
        }
        return new Response(null, { status: 204 })
      }

      const rateLimitPolicy = publicRateLimitPolicy(request)
      if (rateLimitPolicy && !trustedFrontendCatalogRequest(request, rateLimitPolicy)) {
        const contentLengthRejection = enforceContentLength(request, ids.requestId)
        if (contentLengthRejection) {
          set.status = contentLengthRejection.status
          return contentLengthRejection.body
        }

        if (request.method.toUpperCase() !== 'GET') {
          const contentTypeRejection = enforceJsonContentType(request, ids.requestId)
          if (contentTypeRejection) {
            set.status = contentTypeRejection.status
            return contentTypeRejection.body
          }
        }

        const rateLimit = await rateLimitPublicRequest({
          request,
          requestId: ids.requestId,
          identityKey: publicRateLimitIdentity(request),
          policy: rateLimitPolicy
        })

        set.headers['x-ratelimit-limit'] = rateLimit.limit
        set.headers['x-ratelimit-remaining'] = rateLimit.remaining
        set.headers['x-ratelimit-reset'] = rateLimit.resetAt

        if (!rateLimit.allowed) {
          set.status = rateLimit.status
          set.headers['retry-after'] = String(rateLimit.retryAfterSeconds)
          return rateLimit.body
        }
      }

      if (requestLifecycle.isDraining && !drainBypassPath(request)) {
        set.status = 503
        set.headers['retry-after'] = String(Math.ceil(config.shutdownGracePeriodMs / 1000))
        return apiError(
          'server_shutting_down',
          'The API is draining in-flight requests and is not accepting new work.',
          ids.requestId
        )
      }
    })
    .derive(({ request, set }) => {
      const { requestId, correlationId } = idsForRequest(request)
      const beginResult = requestLifecycle.beginRequest({ allowDuringDrain: true })
      const requestLifecycleTicket = beginResult.accepted ? beginResult.ticket : undefined
      const requestTimeoutGuard = createRequestTimeoutGuard({
        timeoutMs: requestTimeoutMs,
        parentSignal: request.signal
      })

      setRequestIdHeaders(set, { requestId, correlationId })
      applySecurityHeaders(set.headers, runtimePublicBaseUrl)
      applyAppCorsHeaders(request, set.headers)
      return {
        requestId,
        correlationId,
        requestLifecycleTicket,
        requestTimeoutGuard
      }
    })
    .onAfterHandle(({ requestLifecycleTicket, requestTimeoutGuard }) => {
      requestTimeoutGuard?.cleanup()
      finishLifecycleTicket(requestLifecycleTicket)
    })
    .onError(({ code, error, request, set, requestLifecycleTicket, requestTimeoutGuard }) => {
      const { requestId, correlationId } = idsForRequest(request)

      requestTimeoutGuard?.cleanup()
      setRequestIdHeaders(set, { requestId, correlationId })
      applySecurityHeaders(set.headers, runtimePublicBaseUrl)
      applyAppCorsHeaders(request, set.headers)

      if (isRequestTimeoutError(error)) {
        set.status = error.statusCode
        finishLifecycleTicket(requestLifecycleTicket)
        return apiError(
          error.code,
          'The request exceeded the API timeout budget before a response could be completed.',
          requestId
        )
      }

      if (code === 'VALIDATION') {
        set.status = 422
        finishLifecycleTicket(requestLifecycleTicket)
        return {
          error: {
            code: 'validation_failed',
            message: 'The request did not match the API contract.',
            requestId
          }
        }
      }

      if (code === 'PARSE') {
        set.status = 400
        finishLifecycleTicket(requestLifecycleTicket)
        return apiError(
          'invalid_json',
          'The request body was not valid JSON.',
          requestId
        )
      }

      if (code === 'NOT_FOUND') {
        set.status = 404
        finishLifecycleTicket(requestLifecycleTicket)
        return apiError(
          'not_found',
          'The requested route was not found.',
          requestId
        )
      }

      set.status = 500
      finishLifecycleTicket(requestLifecycleTicket)
      return {
        error: {
          code: 'internal_error',
          message: 'Unexpected API error.',
          requestId
        }
      }
    })
    .use(openapi({
      path: '/v1/openapi',
      specPath: '/v1/openapi.json',
      documentation: buildOpenApiDocument() as unknown as NonNullable<ElysiaOpenAPIConfig['documentation']>,
      exclude: {
        paths: /.*/
      }
    }))

  registerInfrastructureRoutes(configuredApp, {
    requestLifecycle,
    platformProfile: runtimePlatformProfile,
    paymentHandlerSpecs: executablePaymentHandlerSpecs,
    publicBaseUrl: runtimePublicBaseUrl
  })
  registerUcpBusinessesRoute(configuredApp, {
    loadTargetBusinessRecords: targetBusinessRecords
  })
  registerUcpDiscoveryRoute(configuredApp, {
    authenticate,
    recordAudit,
    rateLimitProtectedRequest,
    discoverUcpProfile,
    persistDiscoveryObservation,
    requiredScopes: discoveryRequiredScopes,
    platformProfileUrl: runtimePlatformProfileUrl,
    timeoutMs: config.requestTimeoutMs,
    apiError
  })
  registerAdminBusinessRoutes(configuredApp, {
    authenticate,
    recordAudit,
    sourceGovernance,
    requiredScopes: adminRequiredScopes,
    apiError
  })
  registerAdminConformanceRoutes(configuredApp, {
    authenticate,
    recordAudit,
    conformance,
    requiredScopes: adminRequiredScopes,
    apiError
  })
  registerAgentCapabilitiesRoutes(configuredApp)
  registerAgentDiagnosticsRoute(configuredApp, { handleAgentDiagnostics })
  registerAgentSessionRoute(configuredApp, {
    authenticate,
    recordAudit,
    rateLimitProtectedRequest,
    requiredScopes: agentSessionRequiredScopes,
    handleAgentSessionIssue
  })
  registerDataRightsRoutes(configuredApp, {
    authenticate,
    recordAudit,
    readScopes: dataRightsReadScopes,
    writeScopes: dataRightsWriteScopes,
    handleDataRightsAccess,
    handleDataRightsExport,
    handleDataRightsCorrection,
    handleDataRightsDeletion
  })
  registerMcpRoute(configuredApp, { handleMcp })
  registerProductCompareRoute(configuredApp, { handleProductCompare })
  registerProductSanityCheckRoute(configuredApp, { handleProductSanityCheck })
  registerSourceStateRoute(configuredApp, { handleSourceState })
  registerShopperSessionRoute(configuredApp, { signingSecret: agentSessionSigningSecret })
  registerShopperAccountRoutes(configuredApp, {
    accounts: shopperAccounts,
    signingSecret: agentSessionSigningSecret,
    identityAudiences: {
      google: (process.env.SHOPPER_GOOGLE_CLIENT_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean),
      apple: (process.env.SHOPPER_APPLE_CLIENT_IDS ?? '').split(',').map((value) => value.trim()).filter(Boolean)
    }
  })
  registerPurchaseRoutes(configuredApp, {
    purchases: purchaseOrchestrator,
    ucpCheckoutService,
    ...(purchaseMandateRepository ? { mandates: purchaseMandateRepository } : {}),
    ...(autonomousPurchaseJobRepository ? { autonomousJobs: autonomousPurchaseJobRepository } : {}),
    ...(purchaseStepUpRepository ? { stepUps: purchaseStepUpRepository } : {}),
    ...(commerceBuyerProfileStore ? { buyerProfiles: commerceBuyerProfileStore } : {}),
    agentHostRegistry,
    autonomousPurchasesEnabled: options.autonomousPurchasesEnabled ?? config.autonomousPurchasesEnabled,
    ...(primaryAutonomousRoute
      ? { primaryAutonomousRoute }
      : {}),
    ...(trustedHostMandateAuthorizationVerifier ? { trustedHostMandateAuthorizationVerifier } : {}),
    ...(ap2TrustedIssuers.length > 0 ? { ap2TrustedIssuers } : {}),
    ...((options.googlePayAllowedOrigins ?? (config.googlePayAllowedOrigins
      ? config.googlePayAllowedOrigins.split(',').map((origin) => new URL(origin.trim()).origin)
      : undefined))
      ? { googlePayAllowedOrigins: options.googlePayAllowedOrigins ?? config.googlePayAllowedOrigins!.split(',').map((origin) => new URL(origin.trim()).origin) }
      : {}),
    embeddedCheckoutRuntimeEnabled: options.embeddedCheckoutRuntimeEnabled ?? config.embeddedCheckoutRuntimeEnabled,
    publicBaseUrl: runtimePublicBaseUrl,
    authenticate,
    agentSessionSigningSecret,
    hashPepper: commercePrincipalHashPepper,
    apiError
  })
  registerCatalogSearchRoutes(configuredApp, { handleSearch, handleProductDetail })

  return configuredApp
}
