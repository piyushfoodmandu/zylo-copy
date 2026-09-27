import { Type, type Static } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { isIP } from 'node:net'
import { validationErrorMessages, validationErrorSummary } from '@arro/contracts'
import {
  createRuntimeCatalogAdapterRegistry,
  resolveCatalogAdaptersJson,
  RuntimeCatalogAdapterConfigError
} from './catalog-adapters.ts'
import { parsePaymentHandlerSpecConfig } from './payment-result-exchange.ts'
import { parseTrustedHostPaymentConfigs } from './trusted-host-payment.ts'
import { parseAp2TrustedIssuersJson } from './ap2-mandate.ts'
import {
  resolveUcpPlatformIdentity,
  UcpPlatformIdentityConfigError
} from './ucp-platform-identity.ts'
import {
  resolveDatabaseUrlFromEnv,
  resolveFileBackedSecret
} from './runtime-secrets.ts'
import { stripeNativeProcessorConfigFromValue } from './stripe-native-payment.ts'

export const apiVersion = '0.1.0'

export const RuntimeConfigSchema = Type.Object(
  {
    environment: Type.String({ minLength: 1 }),
    port: Type.Integer({ minimum: 1, maximum: 65535 }),
    publicBaseUrl: Type.String({ minLength: 1 }),
    appAllowedOrigins: Type.Array(Type.String({ minLength: 1 })),
    frontendServerToken: Type.Optional(Type.String({ minLength: 1 })),
    platformProfileUrl: Type.String({ minLength: 1 }),
    ucpPlatformSigningPrivateJwkJson: Type.Optional(Type.String({ minLength: 1 })),
    ucpPlatformSigningPrivateJwkFile: Type.Optional(Type.String({ minLength: 1 })),
    ucpPlatformAdditionalPublicJwksJson: Type.Optional(Type.String({ minLength: 1 })),
    logLevel: Type.String({ minLength: 1 }),
    databaseUrl: Type.Optional(Type.String({ minLength: 1 })),
    redisUrl: Type.Optional(Type.String({ minLength: 1 })),
    apiKeyPepper: Type.Optional(Type.String({ minLength: 1 })),
    agentSessionSigningSecret: Type.Optional(Type.String({ minLength: 1 })),
    paymentsEnabled: Type.Boolean(),
    paymentCredentialEncryptionKey: Type.Optional(Type.String({ minLength: 1 })),
    paymentActionSigningSecret: Type.Optional(Type.String({ minLength: 1 })),
    paymentCredentialTtlSeconds: Type.Integer({ minimum: 30 }),
    hostPaymentCapabilitiesJson: Type.Optional(Type.String({ minLength: 1 })),
    hostPaymentAttestationKeysJson: Type.Optional(Type.String({ minLength: 1 })),
    autonomousPurchasesEnabled: Type.Boolean(),
    primaryAutonomousRoute: Type.Optional(Type.Literal('trusted_host')),
    googlePayEnabled: Type.Boolean(),
    googlePayEnvironment: Type.Union([
      Type.Literal('TEST'),
      Type.Literal('PRODUCTION')
    ]),
    googlePayWebEnabled: Type.Boolean(),
    googlePayAllowedOrigins: Type.Optional(Type.String({ minLength: 1 })),
    processorTokenizerEnabled: Type.Boolean(),
    ucpPaymentHandlerSpecsJson: Type.Optional(Type.String({ minLength: 1 })),
    ucpTokenizerAuthJson: Type.Optional(Type.String({ minLength: 1 })),
    agentSessionMaxTtlSeconds: Type.Integer({ minimum: 1 }),
    postgresPoolMax: Type.Integer({ minimum: 1, maximum: 100 }),
    postgresPoolIdleTimeoutMs: Type.Integer({ minimum: 1 }),
    postgresStatementTimeoutMs: Type.Integer({ minimum: 1 }),
    maxRequestBodyBytes: Type.Integer({ minimum: 1 }),
    requestTimeoutMs: Type.Integer({ minimum: 1 }),
    connectorTimeoutMs: Type.Integer({ minimum: 1 }),
    catalogHttpMaxConnectionsPerOrigin: Type.Integer({ minimum: 1 }),
    catalogConnectorMaxSourcesPerRequest: Type.Integer({ minimum: 1 }),
    catalogConnectorMaxConcurrencyPerRequest: Type.Integer({ minimum: 1 }),
    catalogConnectorCoalescingWindowMs: Type.Integer({ minimum: 0 }),
    catalogProductDetailCacheTtlMs: Type.Integer({ minimum: 0 }),
    catalogSearchCacheTtlMs: Type.Integer({ minimum: 0 }),
    connectorDnsCacheEnabled: Type.Boolean(),
    connectorDnsCacheTtlMs: Type.Integer({ minimum: 1 }),
    connectorDnsCacheMaxEntries: Type.Integer({ minimum: 1 }),
    targetBusinessMatrixCacheTtlMs: Type.Integer({ minimum: 0 }),
    shutdownGracePeriodMs: Type.Integer({ minimum: 1 }),
    startupMigrationValidationEnabled: Type.Boolean(),
    requestAuditLogRetentionDays: Type.Integer({ minimum: 1 }),
    searchAuditLogRetentionDays: Type.Integer({ minimum: 1 }),
    purchaseSessionRetentionDays: Type.Integer({ minimum: 1 }),
    discoveryObservationRetentionDays: Type.Integer({ minimum: 1 }),
    conformanceMaxAgeDays: Type.Integer({ minimum: 1 }),
    conformanceFixtureModeEnabled: Type.Boolean(),
    conformanceFixtureModeRequested: Type.Boolean(),
    rateLimitEnabled: Type.Boolean(),
    rateLimitFailureMode: Type.Union([
      Type.Literal('open'),
      Type.Literal('closed')
    ]),
    rateLimitWindowSeconds: Type.Integer({ minimum: 1 }),
    rateLimitUcpDiscoveryMax: Type.Integer({ minimum: 1 }),
    rateLimitAgentSessionMax: Type.Integer({ minimum: 1 }),
    catalogAdapterCount: Type.Integer({ minimum: 0 }),
    ap2RuntimeEnabled: Type.Boolean(),
    ap2TrustedIssuersJson: Type.Optional(Type.String({ minLength: 1 })),
    embeddedCheckoutRuntimeEnabled: Type.Boolean(),
    ucpCheckerRegistryUrl: Type.Optional(Type.String({ minLength: 1 })),
    platformProfileMaxAgeSeconds: Type.Integer({ minimum: 1 }),
    dependencyCheckTimeoutMs: Type.Integer({ minimum: 1 })
  },
  { additionalProperties: false }
)

export type RuntimeConfig = Static<typeof RuntimeConfigSchema>

const runtimeConfigValidator = TypeCompiler.Compile(RuntimeConfigSchema)

const parsePositiveInteger = (value: string | undefined, fallback: number) => {
  if (!value) return fallback

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const parseNonNegativeInteger = (value: string | undefined, fallback: number) => {
  if (!value) return fallback

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

const normalizeBaseUrl = (value: string | undefined) => {
  const baseUrl = value?.trim() || 'http://localhost:3000'
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl
}

const parseBoolean = (value: string | undefined, fallback: boolean) => {
  if (value === undefined) return fallback

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

const parseCsv = (value: string | undefined) =>
  value?.split(',').map((entry) => entry.trim()).filter(Boolean) ?? []

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const parseRateLimitFailureMode = (
  value: string | undefined,
  fallback: RuntimeConfig['rateLimitFailureMode']
): RuntimeConfig['rateLimitFailureMode'] => {
  const normalized = value?.trim().toLowerCase()
  return normalized === 'open' || normalized === 'closed' ? normalized : fallback
}

const countCatalogAdapterDescriptors = (value: string | undefined) => {
  const rawConfig = value?.trim()
  if (!rawConfig) return 0

  try {
    const parsed = JSON.parse(rawConfig) as unknown
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

const maxCatalogConnectorSourcesPerRequest = 20
const maxCatalogConnectorConcurrencyPerRequest = 10
const maxCatalogConnectorCoalescingWindowMs = 1000
const localDevelopmentApiKeyPepper =
  'local-development-api-key-pepper-change-for-shared-environments'
const localDevelopmentAgentSessionSigningSecret =
  'local-development-agent-session-signing-secret-change-for-shared-environments'

export const buildConfig = (env: NodeJS.ProcessEnv = process.env): RuntimeConfig => {
  const environment = env.NODE_ENV?.trim() || 'development'
  const databaseUrl = resolveDatabaseUrlFromEnv(env)
  const redisUrl = env.REDIS_URL?.trim()
  const frontendServerToken = resolveFileBackedSecret(
    env,
    'ARRO_FRONTEND_SERVER_TOKEN',
    'ARRO_FRONTEND_SERVER_TOKEN_FILE',
    16_384
  )
  const apiKeyPepper = resolveFileBackedSecret(
    env,
    'API_KEY_PEPPER',
    'API_KEY_PEPPER_FILE',
    16_384
  )
  const agentSessionSigningSecret = resolveFileBackedSecret(
    env,
    'AGENT_SESSION_SIGNING_SECRET',
    'AGENT_SESSION_SIGNING_SECRET_FILE',
    16_384
  )
  const conformanceFixtureModeRequested = parseBoolean(env.CONFORMANCE_FIXTURE_MODE, false)
  const requestTimeoutMs = parsePositiveInteger(env.REQUEST_TIMEOUT_MS, 30_000)
  const catalogAdapterCount = countCatalogAdapterDescriptors(resolveCatalogAdaptersJson(env))
  const publicBaseUrl = normalizeBaseUrl(env.PUBLIC_BASE_URL)
  const platformProfileUrl = env.PLATFORM_PROFILE_URL?.trim() || `${publicBaseUrl}/.well-known/ucp`
  const googlePayWebEnabled = parseBoolean(env.GOOGLE_PAY_WEB_ENABLED, false)

  const runtimeConfig = {
    environment,
    port: parsePositiveInteger(env.PORT, 3000),
    publicBaseUrl,
    appAllowedOrigins: parseCsv(env.APP_ALLOWED_ORIGINS),
    ...(frontendServerToken ? { frontendServerToken } : {}),
    platformProfileUrl,
    ...(env.UCP_PLATFORM_SIGNING_PRIVATE_JWK_JSON?.trim()
      ? { ucpPlatformSigningPrivateJwkJson: env.UCP_PLATFORM_SIGNING_PRIVATE_JWK_JSON.trim() }
      : {}),
    ...(env.UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE?.trim()
      ? { ucpPlatformSigningPrivateJwkFile: env.UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE.trim() }
      : {}),
    ...(env.UCP_PLATFORM_ADDITIONAL_PUBLIC_JWKS_JSON?.trim()
      ? { ucpPlatformAdditionalPublicJwksJson: env.UCP_PLATFORM_ADDITIONAL_PUBLIC_JWKS_JSON.trim() }
      : {}),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(redisUrl ? { redisUrl } : {}),
    ...(apiKeyPepper ? { apiKeyPepper } : {}),
    ...(agentSessionSigningSecret ? { agentSessionSigningSecret } : {}),
    paymentsEnabled: parseBoolean(env.PAYMENTS_ENABLED, false),
    ...(env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY?.trim() ? { paymentCredentialEncryptionKey: env.PAYMENT_CREDENTIAL_ENCRYPTION_KEY.trim() } : {}),
    ...(env.PAYMENT_ACTION_SIGNING_SECRET?.trim() ? { paymentActionSigningSecret: env.PAYMENT_ACTION_SIGNING_SECRET.trim() } : {}),
    paymentCredentialTtlSeconds: parsePositiveInteger(env.PAYMENT_CREDENTIAL_TTL_SECONDS, 900),
    ...(env.HOST_PAYMENT_CAPABILITIES_JSON?.trim() ? { hostPaymentCapabilitiesJson: env.HOST_PAYMENT_CAPABILITIES_JSON.trim() } : {}),
    ...(env.HOST_PAYMENT_ATTESTATION_KEYS_JSON?.trim() ? { hostPaymentAttestationKeysJson: env.HOST_PAYMENT_ATTESTATION_KEYS_JSON.trim() } : {}),
    autonomousPurchasesEnabled: parseBoolean(env.AUTONOMOUS_PURCHASES_ENABLED, false),
    ...(env.PRIMARY_AUTONOMOUS_ROUTE?.trim() === 'trusted_host'
      ? { primaryAutonomousRoute: 'trusted_host' as const }
      : {}),
    googlePayEnabled: parseBoolean(env.GOOGLE_PAY_ENABLED, false),
    googlePayEnvironment: env.GOOGLE_PAY_ENVIRONMENT?.trim() === 'PRODUCTION' ? 'PRODUCTION' : 'TEST',
    googlePayWebEnabled,
    ...(googlePayWebEnabled && env.GOOGLE_PAY_WEB_ALLOWED_ORIGINS?.trim()
      ? { googlePayAllowedOrigins: env.GOOGLE_PAY_WEB_ALLOWED_ORIGINS.trim() }
      : {}),
    processorTokenizerEnabled: parseBoolean(env.PROCESSOR_TOKENIZER_ENABLED, false),
    ...(env.UCP_PAYMENT_HANDLER_SPECS_JSON?.trim() ? { ucpPaymentHandlerSpecsJson: env.UCP_PAYMENT_HANDLER_SPECS_JSON.trim() } : {}),
    ...(env.UCP_TOKENIZER_AUTH_JSON?.trim() ? { ucpTokenizerAuthJson: env.UCP_TOKENIZER_AUTH_JSON.trim() } : {}),
    agentSessionMaxTtlSeconds: parsePositiveInteger(env.AGENT_SESSION_MAX_TTL_SECONDS, 1800),
    postgresPoolMax: parsePositiveInteger(env.POSTGRES_POOL_MAX, 10),
    postgresPoolIdleTimeoutMs: parsePositiveInteger(
      env.POSTGRES_POOL_IDLE_TIMEOUT_MS,
      30_000
    ),
    postgresStatementTimeoutMs: parsePositiveInteger(
      env.POSTGRES_STATEMENT_TIMEOUT_MS,
      requestTimeoutMs
    ),
    maxRequestBodyBytes: parsePositiveInteger(env.MAX_REQUEST_BODY_BYTES, 1_048_576),
    requestTimeoutMs,
    connectorTimeoutMs: parsePositiveInteger(
      env.CONNECTOR_TIMEOUT_MS,
      Math.min(10_000, requestTimeoutMs)
    ),
    catalogHttpMaxConnectionsPerOrigin: parsePositiveInteger(
      env.CATALOG_HTTP_MAX_CONNECTIONS_PER_ORIGIN,
      64
    ),
    catalogConnectorMaxSourcesPerRequest: parsePositiveInteger(
      env.CATALOG_CONNECTOR_MAX_SOURCES_PER_REQUEST,
      5
    ),
    catalogConnectorMaxConcurrencyPerRequest: parsePositiveInteger(
      env.CATALOG_CONNECTOR_MAX_CONCURRENCY_PER_REQUEST,
      3
    ),
    catalogConnectorCoalescingWindowMs: parseNonNegativeInteger(
      env.CATALOG_CONNECTOR_COALESCING_WINDOW_MS,
      100
    ),
    catalogProductDetailCacheTtlMs: parseNonNegativeInteger(
      env.CATALOG_PRODUCT_DETAIL_CACHE_TTL_MS,
      60_000
    ),
    catalogSearchCacheTtlMs: parseNonNegativeInteger(
      env.CATALOG_SEARCH_CACHE_TTL_MS,
      5 * 60_000
    ),
    connectorDnsCacheEnabled: environment === 'production'
      ? parseBoolean(env.CONNECTOR_DNS_CACHE_ENABLED, true)
      : parseBoolean(env.CONNECTOR_DNS_CACHE_ENABLED, false),
    connectorDnsCacheTtlMs: parsePositiveInteger(
      env.CONNECTOR_DNS_CACHE_TTL_MS,
      30_000
    ),
    connectorDnsCacheMaxEntries: parsePositiveInteger(
      env.CONNECTOR_DNS_CACHE_MAX_ENTRIES,
      512
    ),
    targetBusinessMatrixCacheTtlMs: parseNonNegativeInteger(
      env.TARGET_BUSINESS_MATRIX_CACHE_TTL_MS,
      5000
    ),
    shutdownGracePeriodMs: parsePositiveInteger(env.SHUTDOWN_GRACE_PERIOD_MS, 25_000),
    startupMigrationValidationEnabled: environment === 'production'
      ? true
      : parseBoolean(env.STARTUP_MIGRATION_VALIDATION, false),
    requestAuditLogRetentionDays: parsePositiveInteger(
      env.REQUEST_AUDIT_LOG_RETENTION_DAYS,
      90
    ),
    searchAuditLogRetentionDays: parsePositiveInteger(
      env.SEARCH_AUDIT_LOG_RETENTION_DAYS,
      30
    ),
    purchaseSessionRetentionDays: parsePositiveInteger(
      env.PURCHASE_SESSION_RETENTION_DAYS,
      30
    ),
    discoveryObservationRetentionDays: parsePositiveInteger(
      env.DISCOVERY_OBSERVATION_RETENTION_DAYS,
      180
    ),
    conformanceMaxAgeDays: parsePositiveInteger(
      env.CONFORMANCE_MAX_AGE_DAYS,
      30
    ),
    conformanceFixtureModeEnabled: environment === 'production'
      ? false
      : conformanceFixtureModeRequested,
    conformanceFixtureModeRequested,
    rateLimitEnabled: environment === 'production'
      ? parseBoolean(env.RATE_LIMIT_ENABLED, true)
      : parseBoolean(env.RATE_LIMIT_ENABLED, false),
    rateLimitFailureMode: parseRateLimitFailureMode(
      env.RATE_LIMIT_FAILURE_MODE,
      environment === 'production' ? 'closed' : 'open'
    ),
    rateLimitWindowSeconds: parsePositiveInteger(env.RATE_LIMIT_WINDOW_SECONDS, 60),
    rateLimitUcpDiscoveryMax: parsePositiveInteger(env.RATE_LIMIT_UCP_DISCOVERY_MAX, 10),
    rateLimitAgentSessionMax: parsePositiveInteger(env.RATE_LIMIT_AGENT_SESSION_MAX, 20),
    catalogAdapterCount,
    ap2RuntimeEnabled: parseBoolean(env.AP2_RUNTIME_ENABLED, false),
    ...(env.AP2_TRUSTED_ISSUERS_JSON?.trim() ? { ap2TrustedIssuersJson: env.AP2_TRUSTED_ISSUERS_JSON.trim() } : {}),
    embeddedCheckoutRuntimeEnabled: parseBoolean(env.EMBEDDED_CHECKOUT_RUNTIME_ENABLED, false),
    ...(env.UCP_CHECKER_REGISTRY_URL?.trim() ? { ucpCheckerRegistryUrl: env.UCP_CHECKER_REGISTRY_URL.trim() } : {}),
    platformProfileMaxAgeSeconds: parsePositiveInteger(
      env.PLATFORM_PROFILE_MAX_AGE_SECONDS,
      300
    ),
    dependencyCheckTimeoutMs: parsePositiveInteger(
      env.DEPENDENCY_CHECK_TIMEOUT_MS,
      1500
    )
  } satisfies RuntimeConfig

  if (!runtimeConfigValidator.Check(runtimeConfig)) {
    const errors = validationErrorSummary(
      runtimeConfigValidator,
      runtimeConfig,
      Number.POSITIVE_INFINITY
    )
    throw new Error(`Invalid runtime config shape: ${errors}`)
  }

  return runtimeConfig
}

const parseUrl = (value: string) => {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}

const isLaunchGradeProductionBaseUrl = (publicBaseUrl: string) => {
  const url = parseUrl(publicBaseUrl)
  if (!url) return false

  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()
  return (
    url.protocol === 'https:' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '' &&
    isIP(hostname) === 0 &&
    hostname !== 'localhost' &&
    !hostname.endsWith('.localhost') &&
    !hostname.endsWith('.local')
  )
}

const isExactLoopbackHttpOrigin = (origin: string) => {
  const url = parseUrl(origin)
  if (!url || url.origin !== origin || url.protocol !== 'http:') return false

  const hostname = url.hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase()
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '::1' ||
    (isIP(hostname) === 4 && hostname.startsWith('127.'))
  )
}

const isAllowedProductionAppOrigin = (origin: string) => (
  (isLaunchGradeProductionBaseUrl(origin) && new URL(origin).origin === origin) ||
  isExactLoopbackHttpOrigin(origin)
)

export const validateRuntimeConfig = (
  runtimeConfig: RuntimeConfig = config,
  env: NodeJS.ProcessEnv = process.env
): string[] => {
  const errors = runtimeConfigValidator.Check(runtimeConfig)
    ? []
    : validationErrorMessages(runtimeConfigValidator, runtimeConfig, Number.POSITIVE_INFINITY)

  let ucpPlatformIdentityConfigured = false
  try {
    ucpPlatformIdentityConfigured = Boolean(resolveUcpPlatformIdentity({
      privateJwkJson: runtimeConfig.ucpPlatformSigningPrivateJwkJson,
      privateJwkFile: runtimeConfig.ucpPlatformSigningPrivateJwkFile,
      additionalPublicJwksJson: runtimeConfig.ucpPlatformAdditionalPublicJwksJson
    }))
  } catch (error) {
    errors.push(
      error instanceof UcpPlatformIdentityConfigError
        ? error.message
        : 'UCP platform signing identity configuration is invalid.'
    )
  }

  if (runtimeConfig.platformProfileMaxAgeSeconds < 60) {
    errors.push('PLATFORM_PROFILE_MAX_AGE_SECONDS must be at least 60 for UCP profile caching.')
  }

  if (runtimeConfig.postgresStatementTimeoutMs > runtimeConfig.requestTimeoutMs) {
    errors.push('POSTGRES_STATEMENT_TIMEOUT_MS must be less than or equal to REQUEST_TIMEOUT_MS.')
  }

  if (runtimeConfig.connectorTimeoutMs > runtimeConfig.requestTimeoutMs) {
    errors.push('CONNECTOR_TIMEOUT_MS must be less than or equal to REQUEST_TIMEOUT_MS.')
  }

  if (runtimeConfig.catalogConnectorMaxConcurrencyPerRequest > runtimeConfig.catalogConnectorMaxSourcesPerRequest) {
    errors.push('CATALOG_CONNECTOR_MAX_CONCURRENCY_PER_REQUEST must be less than or equal to CATALOG_CONNECTOR_MAX_SOURCES_PER_REQUEST.')
  }

  if (runtimeConfig.catalogConnectorMaxSourcesPerRequest > maxCatalogConnectorSourcesPerRequest) {
    errors.push(`CATALOG_CONNECTOR_MAX_SOURCES_PER_REQUEST must be less than or equal to ${maxCatalogConnectorSourcesPerRequest} for the catalog request budget.`)
  }

  if (runtimeConfig.catalogConnectorMaxConcurrencyPerRequest > maxCatalogConnectorConcurrencyPerRequest) {
    errors.push(`CATALOG_CONNECTOR_MAX_CONCURRENCY_PER_REQUEST must be less than or equal to ${maxCatalogConnectorConcurrencyPerRequest} for the catalog request budget.`)
  }

  if (runtimeConfig.catalogConnectorCoalescingWindowMs > maxCatalogConnectorCoalescingWindowMs) {
    errors.push(`CATALOG_CONNECTOR_COALESCING_WINDOW_MS must be less than or equal to ${maxCatalogConnectorCoalescingWindowMs}.`)
  }

  if (runtimeConfig.shutdownGracePeriodMs > 30_000) {
    errors.push('SHUTDOWN_GRACE_PERIOD_MS must be less than or equal to 30000.')
  }

  if (runtimeConfig.paymentsEnabled) {
    if (!runtimeConfig.databaseUrl) {
      errors.push('DATABASE_URL is required when PAYMENTS_ENABLED is true for durable Checkout, payment-action, and Order continuity.')
    }
    if (!runtimeConfig.redisUrl) {
      errors.push('REDIS_URL is required when PAYMENTS_ENABLED is true because payment credentials must use the runtime credential vault.')
    }
    if (!runtimeConfig.paymentCredentialEncryptionKey) {
      errors.push('PAYMENT_CREDENTIAL_ENCRYPTION_KEY is required when PAYMENTS_ENABLED is true.')
    }
    if (!runtimeConfig.paymentActionSigningSecret) {
      errors.push('PAYMENT_ACTION_SIGNING_SECRET is required when PAYMENTS_ENABLED is true so payment approvals are bound to signed one-time action tokens.')
    }
  }

  if (runtimeConfig.paymentCredentialEncryptionKey && runtimeConfig.paymentCredentialEncryptionKey.length < 32) {
    errors.push('PAYMENT_CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters.')
  }

  if (runtimeConfig.paymentActionSigningSecret && runtimeConfig.paymentActionSigningSecret.length < 32) {
    errors.push('PAYMENT_ACTION_SIGNING_SECRET must be at least 32 characters when configured.')
  }

  if (runtimeConfig.googlePayEnabled && !runtimeConfig.paymentsEnabled) {
    errors.push('PAYMENTS_ENABLED must be true when GOOGLE_PAY_ENABLED is true.')
  }

  if (runtimeConfig.googlePayWebEnabled && !runtimeConfig.googlePayEnabled) {
    errors.push('GOOGLE_PAY_ENABLED must be true when GOOGLE_PAY_WEB_ENABLED is true.')
  }

  if (runtimeConfig.googlePayWebEnabled && !runtimeConfig.googlePayAllowedOrigins) {
    errors.push('GOOGLE_PAY_WEB_ALLOWED_ORIGINS is required when GOOGLE_PAY_WEB_ENABLED is true.')
  }

  if (runtimeConfig.googlePayWebEnabled && runtimeConfig.googlePayAllowedOrigins) {
    try {
      const configuredOrigins = runtimeConfig.googlePayAllowedOrigins.split(',').map((origin) => origin.trim())
      const allowedOrigins = configuredOrigins.map((origin) => new URL(origin))
      if (allowedOrigins.some((origin, index) => (
        origin.protocol !== 'https:' ||
        origin.username !== '' ||
        origin.password !== '' ||
        origin.pathname !== '/' ||
        origin.search !== '' ||
        origin.hash !== '' ||
        origin.origin !== configuredOrigins[index]
      ))) {
        errors.push('GOOGLE_PAY_WEB_ALLOWED_ORIGINS entries must be exact HTTPS origins without credentials, paths, queries, fragments, or trailing slashes.')
      }
      if (!allowedOrigins.some((origin) => origin.origin === new URL(runtimeConfig.publicBaseUrl).origin)) {
        errors.push('GOOGLE_PAY_WEB_ALLOWED_ORIGINS must include the exact PUBLIC_BASE_URL origin for signed Arro-hosted Google Pay Web actions.')
      }
    } catch {
      errors.push('GOOGLE_PAY_WEB_ALLOWED_ORIGINS must be a comma-separated list of exact HTTPS origins.')
    }
  }

  let trustedHostPaymentConfigs: ReturnType<typeof parseTrustedHostPaymentConfigs> = []
  if (runtimeConfig.hostPaymentCapabilitiesJson || runtimeConfig.hostPaymentAttestationKeysJson) {
    if (!runtimeConfig.paymentsEnabled) {
      errors.push('PAYMENTS_ENABLED must be true when trusted host payment capabilities are configured.')
    }
    if (!runtimeConfig.hostPaymentCapabilitiesJson || !runtimeConfig.hostPaymentAttestationKeysJson) {
      errors.push('HOST_PAYMENT_CAPABILITIES_JSON and HOST_PAYMENT_ATTESTATION_KEYS_JSON must be configured together for trusted host payment execution.')
    } else {
      try {
        trustedHostPaymentConfigs = parseTrustedHostPaymentConfigs({
          capabilitiesJson: runtimeConfig.hostPaymentCapabilitiesJson,
          keysJson: runtimeConfig.hostPaymentAttestationKeysJson
        })
      } catch (error) {
        errors.push(
          error instanceof Error
            ? `Invalid trusted host payment config: ${error.message}`
            : 'Invalid trusted host payment config.'
        )
      }
    }
  }

  if (runtimeConfig.autonomousPurchasesEnabled) {
    if (!env.PRIMARY_AUTONOMOUS_ROUTE?.trim()) {
      errors.push('PRIMARY_AUTONOMOUS_ROUTE is required when AUTONOMOUS_PURCHASES_ENABLED is true.')
    } else if (!runtimeConfig.primaryAutonomousRoute) {
      errors.push('PRIMARY_AUTONOMOUS_ROUTE must be trusted_host.')
    }
    if (runtimeConfig.primaryAutonomousRoute === 'trusted_host' && !runtimeConfig.hostPaymentCapabilitiesJson) {
      errors.push('HOST_PAYMENT_CAPABILITIES_JSON is required when PRIMARY_AUTONOMOUS_ROUTE=trusted_host.')
    }
    if (runtimeConfig.primaryAutonomousRoute === 'trusted_host' && trustedHostPaymentConfigs.length > 0) {
      const executableHost = trustedHostPaymentConfigs.find((paymentHost) => {
        return Boolean(
          paymentHost.authorizationEndpoint &&
          paymentHost.autonomousExecutionAllowed &&
          paymentHost.canReceiveAsyncPurchaseUpdates &&
          (paymentHost.handlerNames?.length ?? 0) > 0 &&
          (!paymentHost.allowedScopes?.length || paymentHost.allowedScopes.includes('write:complete_purchase'))
        )
      })
      if (!executableHost) {
        errors.push('PRIMARY_AUTONOMOUS_ROUTE=trusted_host requires one signed trusted-host payment adapter with completion scope, async updates, autonomous execution, exact handler names, issuer/audience keys, and callable authorization/redemption endpoints.')
      }
    }
    if (!runtimeConfig.databaseUrl) {
      errors.push('DATABASE_URL is required when AUTONOMOUS_PURCHASES_ENABLED is true.')
    }
    if (!runtimeConfig.paymentsEnabled) {
      errors.push('PAYMENTS_ENABLED must be true when AUTONOMOUS_PURCHASES_ENABLED is true.')
    }
    if (runtimeConfig.catalogAdapterCount === 0) {
      errors.push('At least one catalog source is required when AUTONOMOUS_PURCHASES_ENABLED is true.')
    }
  }

  let paymentHandlerSpecDefinitions: ReturnType<typeof parsePaymentHandlerSpecConfig> = []
  if (runtimeConfig.ucpPaymentHandlerSpecsJson) {
    try {
      paymentHandlerSpecDefinitions = parsePaymentHandlerSpecConfig(
        JSON.parse(runtimeConfig.ucpPaymentHandlerSpecsJson) as unknown
      )
    } catch (error) {
      errors.push(
        error instanceof Error
          ? `Invalid UCP_PAYMENT_HANDLER_SPECS_JSON: ${error.message}`
          : 'Invalid UCP_PAYMENT_HANDLER_SPECS_JSON: handler specifications could not be parsed.'
      )
    }
  }

  const processorTokenizerDefinitions = paymentHandlerSpecDefinitions.filter((definition) =>
    definition.adapterKind === 'processor_tokenizer'
  )
  if (runtimeConfig.processorTokenizerEnabled && !runtimeConfig.paymentsEnabled) {
    errors.push('PAYMENTS_ENABLED must be true when PROCESSOR_TOKENIZER_ENABLED is true.')
  }
  if (runtimeConfig.processorTokenizerEnabled && processorTokenizerDefinitions.length === 0) {
    errors.push('PROCESSOR_TOKENIZER_ENABLED requires at least one Processor Tokenizer handler definition.')
  }
  if (runtimeConfig.environment === 'production' && runtimeConfig.processorTokenizerEnabled) {
    if (processorTokenizerDefinitions.some((definition) => definition.environment !== 'PRODUCTION')) {
      errors.push('Production Processor Tokenizer handler definitions must use environment PRODUCTION.')
    }

    const liveStripeNativeDefinitions = processorTokenizerDefinitions.filter((definition) => {
      const stripeConfig = stripeNativeProcessorConfigFromValue({
        ...(definition.handlerConfig ?? {}),
        ...(definition.environment ? { environment: definition.environment } : {})
      })
      if (
        stripeConfig.environment !== 'PRODUCTION' ||
        stripeConfig.gateway !== 'stripe' ||
        stripeConfig.credentialType !== 'stripe_payment_intent' ||
        !stripeConfig.sessionUrl
      ) return false

      try {
        const sessionUrl = new URL(stripeConfig.sessionUrl)
        return sessionUrl.protocol === 'https:' && !sessionUrl.username && !sessionUrl.password
      } catch {
        return false
      }
    })
    if (liveStripeNativeDefinitions.length === 0) {
      errors.push('Production Processor Tokenizer execution requires a live Stripe native-session handler with gateway stripe, credential_type stripe_payment_intent, environment PRODUCTION, and an HTTPS native_session_url.')
    }
  }
  const googlePayDefinitions = paymentHandlerSpecDefinitions.filter((definition) => definition.adapterKind === 'google_pay')
  if (runtimeConfig.googlePayEnabled && googlePayDefinitions.length !== 1) {
    errors.push('GOOGLE_PAY_ENABLED requires exactly one com.google.pay UCP handler definition.')
  }
  if (runtimeConfig.googlePayEnabled && googlePayDefinitions.some((definition) => definition.environment !== runtimeConfig.googlePayEnvironment)) {
    errors.push('GOOGLE_PAY_ENVIRONMENT must match every enabled Google Pay handler definition environment.')
  }
  if (runtimeConfig.googlePayEnabled && runtimeConfig.googlePayEnvironment === 'PRODUCTION') {
    const productionMerchantId = env.GOOGLE_PAY_PRODUCTION_MERCHANT_ID?.trim()
    const productionHandlerId = env.GOOGLE_PAY_PRODUCTION_HANDLER_ID?.trim()
    const productionPsp = env.GOOGLE_PAY_PRODUCTION_PSP?.trim()
    const approvalReference = env.GOOGLE_PAY_PRODUCTION_APPROVAL_REFERENCE?.trim()
    if (!productionMerchantId) errors.push('GOOGLE_PAY_PRODUCTION_MERCHANT_ID is required for Google Pay production activation.')
    if (!productionHandlerId) errors.push('GOOGLE_PAY_PRODUCTION_HANDLER_ID is required for Google Pay production activation.')
    if (!productionPsp) errors.push('GOOGLE_PAY_PRODUCTION_PSP is required for Google Pay production activation.')
    if (!approvalReference) errors.push('GOOGLE_PAY_PRODUCTION_APPROVAL_REFERENCE is required for Google Pay production activation.')
    const configuredMerchantIds = googlePayDefinitions.flatMap((definition) => {
      const merchantId = asRecord(asRecord(definition.handlerConfig).merchant_info).merchant_id
      return typeof merchantId === 'string' && merchantId.trim() ? [merchantId.trim()] : []
    })
    const configuredHandlerIds = googlePayDefinitions.map((definition) => definition.platformHandlerId)
    const configuredPsps = [...new Set(googlePayDefinitions.flatMap((definition) => {
      const methods = asRecord(definition.handlerConfig).allowed_payment_methods
      if (!Array.isArray(methods)) return []
      return methods.flatMap((method) => {
        const tokenization = asRecord(asRecord(method).tokenization_specification)
        if (tokenization.type !== 'PAYMENT_GATEWAY') return []
        const gateway = asRecord(tokenization.parameters).gateway
        return typeof gateway === 'string' && gateway.trim() ? [gateway.trim()] : []
      })
    }))]
    if (productionMerchantId && !configuredMerchantIds.includes(productionMerchantId)) {
      errors.push('GOOGLE_PAY_PRODUCTION_MERCHANT_ID must match the exact production UCP handler merchant_id.')
    }
    if (productionHandlerId && !configuredHandlerIds.includes(productionHandlerId)) {
      errors.push('GOOGLE_PAY_PRODUCTION_HANDLER_ID must match the exact production UCP platformHandlerId.')
    }
    if (configuredPsps.length !== 1) {
      errors.push('Google Pay production activation requires exactly one PAYMENT_GATEWAY PSP in the enabled UCP handler.')
    } else if (productionPsp && configuredPsps[0] !== productionPsp) {
      errors.push('GOOGLE_PAY_PRODUCTION_PSP must match the exact production UCP handler gateway.')
    }
  }
  if (runtimeConfig.googlePayWebEnabled && runtimeConfig.googlePayEnvironment === 'PRODUCTION') {
    const registeredOrigin = env.GOOGLE_PAY_WEB_PRODUCTION_REGISTERED_ORIGIN?.trim()
    if (!registeredOrigin) {
      errors.push('GOOGLE_PAY_WEB_PRODUCTION_REGISTERED_ORIGIN is required when hosted Google Pay Web is enabled in production.')
    } else {
      try {
        const origin = new URL(registeredOrigin)
        const allowedOrigins = runtimeConfig.googlePayAllowedOrigins?.split(',').map((entry) => entry.trim()) ?? []
        if (
          origin.protocol !== 'https:' ||
          origin.origin !== registeredOrigin ||
          origin.origin !== new URL(runtimeConfig.publicBaseUrl).origin ||
          !allowedOrigins.includes(origin.origin)
        ) {
          errors.push('GOOGLE_PAY_WEB_PRODUCTION_REGISTERED_ORIGIN must be the approved exact HTTPS PUBLIC_BASE_URL origin and appear in GOOGLE_PAY_WEB_ALLOWED_ORIGINS.')
        }
      } catch {
        errors.push('GOOGLE_PAY_WEB_PRODUCTION_REGISTERED_ORIGIN must be a valid exact HTTPS origin.')
      }
    }
  }
  const unsupportedExecutableDefinitions = paymentHandlerSpecDefinitions.filter((definition) =>
    definition.adapterKind !== 'x402' &&
    definition.adapterKind !== 'mpp' &&
    definition.adapterKind !== 'processor_tokenizer' &&
    !(definition.adapterKind === 'google_pay' && runtimeConfig.googlePayEnabled)
  )
  if (unsupportedExecutableDefinitions.length > 0) {
    errors.push(
      `UCP_PAYMENT_HANDLER_SPECS_JSON includes adapter kinds that are not executable in this runtime: ${[
        ...new Set(unsupportedExecutableDefinitions.map((definition) => definition.adapterKind))
      ].join(', ')}.`
    )
  }

  if (
    runtimeConfig.processorTokenizerEnabled &&
    runtimeConfig.paymentsEnabled &&
    processorTokenizerDefinitions.length > 0 &&
    !runtimeConfig.ucpTokenizerAuthJson
  ) {
    errors.push('UCP_TOKENIZER_AUTH_JSON is required when UCP_PAYMENT_HANDLER_SPECS_JSON enables Processor Tokenizer execution.')
  }

  if (runtimeConfig.autonomousPurchasesEnabled && runtimeConfig.primaryAutonomousRoute === 'trusted_host') {
    const registeredHandlerNames = new Set(trustedHostPaymentConfigs.flatMap((host) => host.handlerNames ?? []))
    const executableHandlerNames = new Set(paymentHandlerSpecDefinitions.map((definition) => definition.handlerName))
    if (![...registeredHandlerNames].some((handlerName) => executableHandlerNames.has(handlerName))) {
      errors.push('PRIMARY_AUTONOMOUS_ROUTE=trusted_host requires an exact handler-name intersection between its signed payment adapter and UCP_PAYMENT_HANDLER_SPECS_JSON.')
    }
  }

  if (runtimeConfig.ap2RuntimeEnabled) {
    if (!runtimeConfig.paymentsEnabled) {
      errors.push('PAYMENTS_ENABLED must be true when AP2_RUNTIME_ENABLED is true.')
    }
    if (!runtimeConfig.databaseUrl) {
      errors.push('DATABASE_URL is required when AP2_RUNTIME_ENABLED is true for durable replay, authority, and receipt state.')
    }
    if (!runtimeConfig.ap2TrustedIssuersJson) {
      errors.push('AP2_TRUSTED_ISSUERS_JSON must configure at least one trusted issuer and verification key when AP2_RUNTIME_ENABLED is true.')
    } else {
      try {
        if (parseAp2TrustedIssuersJson(runtimeConfig.ap2TrustedIssuersJson).length === 0) {
          errors.push('AP2_TRUSTED_ISSUERS_JSON must configure at least one trusted issuer and verification key when AP2_RUNTIME_ENABLED is true.')
        }
      } catch (error) {
        errors.push(
          error instanceof Error
            ? `Invalid AP2_TRUSTED_ISSUERS_JSON: ${error.message}`
            : 'Invalid AP2_TRUSTED_ISSUERS_JSON.'
        )
      }
    }
  }

  if (runtimeConfig.embeddedCheckoutRuntimeEnabled) {
    if (!runtimeConfig.databaseUrl) {
      errors.push('DATABASE_URL is required when EMBEDDED_CHECKOUT_RUNTIME_ENABLED is true so embedded checkout lifecycle events are durably recorded.')
    }
    if (!runtimeConfig.paymentActionSigningSecret) {
      errors.push('PAYMENT_ACTION_SIGNING_SECRET is required when EMBEDDED_CHECKOUT_RUNTIME_ENABLED is true so embedded checkout sessions are signed.')
    }
  }

  if (runtimeConfig.environment !== 'production') return errors

  if (runtimeConfig.appAllowedOrigins.length === 0) {
    errors.push('APP_ALLOWED_ORIGINS must include at least one frontend origin in production.')
  } else if (runtimeConfig.appAllowedOrigins.some((origin) => !isAllowedProductionAppOrigin(origin))) {
    errors.push('APP_ALLOWED_ORIGINS entries must be exact public HTTPS or loopback HTTP origins without credentials, paths, queries, fragments, or trailing slashes.')
  }

  if (!runtimeConfig.frontendServerToken || runtimeConfig.frontendServerToken.length < 32) {
    errors.push('ARRO_FRONTEND_SERVER_TOKEN must be configured with at least 32 characters in production.')
  }

  if (!ucpPlatformIdentityConfigured && !runtimeConfig.ucpPlatformSigningPrivateJwkJson && !runtimeConfig.ucpPlatformSigningPrivateJwkFile) {
    errors.push(
      'UCP_PLATFORM_SIGNING_PRIVATE_JWK_JSON or UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE is required in production so the published platform identity can sign outbound UCP requests.'
    )
  }

  if (runtimeConfig.catalogAdapterCount > 0 || runtimeConfig.paymentsEnabled || runtimeConfig.autonomousPurchasesEnabled || env.PLATFORM_PROFILE_URL?.trim()) {
    try {
      const configuredProfileUrl = new URL(runtimeConfig.platformProfileUrl)
      const expectedProfileUrl = new URL('/.well-known/ucp', `${runtimeConfig.publicBaseUrl}/`)
      if (configuredProfileUrl.protocol !== 'https:') {
        errors.push('PLATFORM_PROFILE_URL must be a public HTTPS URL in production.')
      }
      if (configuredProfileUrl.href !== expectedProfileUrl.href) {
        errors.push('PLATFORM_PROFILE_URL must resolve to PUBLIC_BASE_URL/.well-known/ucp so advertised and outbound UCP authority are identical.')
      }
    } catch {
      errors.push('PLATFORM_PROFILE_URL must be a valid absolute URL.')
    }
  }

  if (!runtimeConfig.startupMigrationValidationEnabled) {
    errors.push('STARTUP_MIGRATION_VALIDATION must be enabled in production.')
  }

  if (!runtimeConfig.databaseUrl) {
    errors.push('DATABASE_URL is required in production.')
  } else {
    try {
      const databaseUrl = new URL(runtimeConfig.databaseUrl)
      if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
        errors.push('DATABASE_URL must be a valid PostgreSQL URL in production.')
      } else if (
        !databaseUrl.password ||
        decodeURIComponent(databaseUrl.password).length < 32 ||
        decodeURIComponent(databaseUrl.password) === 'arro_dev_password'
      ) {
        errors.push('DATABASE_URL must use a password with at least 32 characters in production.')
      }
    } catch {
      errors.push('DATABASE_URL must be a valid PostgreSQL URL in production.')
    }
  }

  if (!runtimeConfig.redisUrl) {
    errors.push('REDIS_URL is required in production.')
  }

  if (runtimeConfig.rateLimitEnabled && !runtimeConfig.redisUrl) {
    errors.push('REDIS_URL is required when RATE_LIMIT_ENABLED is true in production.')
  }

  if (runtimeConfig.rateLimitEnabled && runtimeConfig.rateLimitFailureMode !== 'closed') {
    errors.push('RATE_LIMIT_FAILURE_MODE must be closed in production when rate limiting is enabled.')
  }

  if (!runtimeConfig.apiKeyPepper || runtimeConfig.apiKeyPepper.length < 32) {
    errors.push('API_KEY_PEPPER must be configured with at least 32 characters in production.')
  } else if (runtimeConfig.apiKeyPepper === localDevelopmentApiKeyPepper) {
    errors.push('API_KEY_PEPPER must not use the local development fallback value in production.')
  }

  if (!runtimeConfig.agentSessionSigningSecret || runtimeConfig.agentSessionSigningSecret.length < 32) {
    errors.push('AGENT_SESSION_SIGNING_SECRET must be configured with at least 32 characters in production.')
  } else if (
    runtimeConfig.agentSessionSigningSecret === localDevelopmentAgentSessionSigningSecret
  ) {
    errors.push('AGENT_SESSION_SIGNING_SECRET must not use the local development fallback value in production.')
  }

  if (runtimeConfig.agentSessionMaxTtlSeconds > 86_400) {
    errors.push('AGENT_SESSION_MAX_TTL_SECONDS must be less than or equal to 86400 in production.')
  }

  if (runtimeConfig.catalogAdapterCount < 1) {
    errors.push('At least one catalog source must be enabled in production.')
  }

  try {
    createRuntimeCatalogAdapterRegistry(env, {
      platformProfileUrl: 'https://config-validation.invalid/.well-known/ucp'
    })
  } catch (error) {
    errors.push(
      error instanceof RuntimeCatalogAdapterConfigError
        ? `Invalid CATALOG_ADAPTERS_JSON: ${error.message}`
        : 'Invalid CATALOG_ADAPTERS_JSON: production catalog adapters could not be validated.'
    )
  }

  if (runtimeConfig.conformanceFixtureModeRequested) {
    errors.push('CONFORMANCE_FIXTURE_MODE must not be enabled in production.')
  }

  if (!isLaunchGradeProductionBaseUrl(runtimeConfig.publicBaseUrl)) {
    errors.push('PUBLIC_BASE_URL must be a public HTTPS origin in production.')
  }

  return errors
}

export const config = buildConfig()

export const isProduction = config.environment === 'production'
