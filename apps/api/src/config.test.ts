import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { UCP_STABLE_VERSION } from '@arro/contracts'
import { buildConfig, validateRuntimeConfig } from './config.ts'

const productionCatalogAdaptersJson = JSON.stringify([
  {
    kind: 'shopify_storefront_mcp',
    adapterId: 'production-shopify-mcp',
    businessId: 'production-shopify-store',
    displayName: 'Production Shopify Store',
    shopDomain: 'production-shop.myshopify.com'
  }
])
const productionFrontendEnv = {
  APP_ALLOWED_ORIGINS: 'https://arro.com',
  ARRO_FRONTEND_SERVER_TOKEN: 'production-frontend-server-token-with-at-least-32-characters'
}

const productionUcpSigningFixtureDirectory = mkdtempSync(join(tmpdir(), 'arro-config-key-'))
const productionUcpSigningPrivateJwkFile = join(
  productionUcpSigningFixtureDirectory,
  'ucp-platform-private.jwk'
)
const { privateKey: productionUcpSigningPrivateKey } = generateKeyPairSync('ec', {
  namedCurve: 'P-256'
})
const productionUcpSigningPrivateJwkJson = JSON.stringify({
  ...productionUcpSigningPrivateKey.export({ format: 'jwk' }),
  kid: 'generated-config-test-key',
  alg: 'ES256',
  use: 'sig'
})
writeFileSync(productionUcpSigningPrivateJwkFile, productionUcpSigningPrivateJwkJson, {
  mode: 0o600
})
afterAll(() => rmSync(productionUcpSigningFixtureDirectory, { recursive: true, force: true }))

describe('runtime config', () => {
  it('omits blank optional service URLs', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'development',
      DATABASE_URL: '   ',
      REDIS_URL: ''
    })

    expect('databaseUrl' in runtimeConfig).toBe(false)
    expect('redisUrl' in runtimeConfig).toBe(false)
  })

  it('resolves database and authentication secrets from bounded files', () => {
    const databaseUrlFile = join(productionUcpSigningFixtureDirectory, 'database-url')
    const apiKeyPepperFile = join(productionUcpSigningFixtureDirectory, 'api-key-pepper')
    const agentSessionSecretFile = join(productionUcpSigningFixtureDirectory, 'agent-session-secret')
    writeFileSync(databaseUrlFile, 'postgresql://arro:file-secret@postgres:5432/arro\n', { mode: 0o600 })
    writeFileSync(apiKeyPepperFile, 'file-backed-api-key-pepper-with-at-least-32-characters\n', { mode: 0o600 })
    writeFileSync(agentSessionSecretFile, 'file-backed-agent-session-secret-with-at-least-32-characters\n', { mode: 0o600 })

    const runtimeConfig = buildConfig({
      DATABASE_URL_FILE: databaseUrlFile,
      API_KEY_PEPPER_FILE: apiKeyPepperFile,
      AGENT_SESSION_SIGNING_SECRET_FILE: agentSessionSecretFile
    })

    expect(runtimeConfig.databaseUrl).toBe('postgresql://arro:file-secret@postgres:5432/arro')
    expect(runtimeConfig.apiKeyPepper).toBe('file-backed-api-key-pepper-with-at-least-32-characters')
    expect(runtimeConfig.agentSessionSigningSecret).toBe(
      'file-backed-agent-session-secret-with-at-least-32-characters'
    )
  })

  it('resolves the frontend server token from a bounded file', () => {
    const frontendServerTokenFile = join(
      productionUcpSigningFixtureDirectory,
      'frontend-server-token'
    )
    writeFileSync(
      frontendServerTokenFile,
      'file-backed-frontend-server-token-with-at-least-32-characters\n',
      { mode: 0o600 }
    )

    const runtimeConfig = buildConfig({
      ARRO_FRONTEND_SERVER_TOKEN_FILE: frontendServerTokenFile
    })

    expect(runtimeConfig.frontendServerToken).toBe(
      'file-backed-frontend-server-token-with-at-least-32-characters'
    )
  })

  it('rejects ambiguous inline and file-backed frontend server tokens', () => {
    const frontendServerTokenFile = join(
      productionUcpSigningFixtureDirectory,
      'ambiguous-frontend-server-token'
    )
    writeFileSync(frontendServerTokenFile, 'file-backed-frontend-server-token\n', {
      mode: 0o600
    })

    expect(() => buildConfig({
      ARRO_FRONTEND_SERVER_TOKEN: 'inline-frontend-server-token',
      ARRO_FRONTEND_SERVER_TOKEN_FILE: frontendServerTokenFile
    })).toThrowError(
      'Configure only one of ARRO_FRONTEND_SERVER_TOKEN or ARRO_FRONTEND_SERVER_TOKEN_FILE.'
    )
  })

  it('rejects ambiguous inline and file-backed secret configuration', () => {
    const databaseUrlFile = join(productionUcpSigningFixtureDirectory, 'ambiguous-database-url')
    writeFileSync(databaseUrlFile, 'postgresql://arro:file-secret@postgres:5432/arro\n', { mode: 0o600 })

    expect(() => buildConfig({
      DATABASE_URL: 'postgresql://arro:inline-secret@postgres:5432/arro',
      DATABASE_URL_FILE: databaseUrlFile
    })).toThrowError('Configure only one of DATABASE_URL or DATABASE_URL_FILE.')
  })

  it('parses exact app CORS origins without carrying empty entries', () => {
    const runtimeConfig = buildConfig({
      APP_ALLOWED_ORIGINS: 'https://shop.example.com, https://team.example.com, '
    })

    expect(runtimeConfig.appAllowedOrigins).toEqual([
      'https://shop.example.com',
      'https://team.example.com'
    ])
  })

  it('allows explicitly configured loopback HTTP origins in a production CORS allowlist', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'production',
      APP_ALLOWED_ORIGINS: [
        'https://arro.com',
        'http://localhost:8081',
        'http://app.localhost:8081',
        'http://127.0.0.1:8081',
        'http://[::1]:8081'
      ].join(',')
    })

    expect(validateRuntimeConfig(runtimeConfig)).not.toContain(
      'APP_ALLOWED_ORIGINS entries must be exact public HTTPS or loopback HTTP origins without credentials, paths, queries, fragments, or trailing slashes.'
    )
  })

  it.each([
    'http://shop.example.com',
    'http://192.168.1.7:8081',
    'http://localhost:8081/',
    'http://localhost:8081/path',
    'http://localhost:8081?preview=true',
    'http://user:secret@localhost:8081'
  ])('rejects unsafe production CORS origin %s', (origin) => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'production',
      APP_ALLOWED_ORIGINS: origin
    })

    expect(validateRuntimeConfig(runtimeConfig)).toContain(
      'APP_ALLOWED_ORIGINS entries must be exact public HTTPS or loopback HTTP origins without credentials, paths, queries, fragments, or trailing slashes.'
    )
  })

  it('requires launch-grade production configuration', () => {
    const invalidConfig = buildConfig({
      NODE_ENV: 'production',
      PUBLIC_BASE_URL: 'http://localhost:3000'
    })

    expect(validateRuntimeConfig(invalidConfig)).toEqual(expect.arrayContaining([
      'APP_ALLOWED_ORIGINS must include at least one frontend origin in production.',
      'ARRO_FRONTEND_SERVER_TOKEN must be configured with at least 32 characters in production.',
      'UCP_PLATFORM_SIGNING_PRIVATE_JWK_JSON or UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE is required in production so the published platform identity can sign outbound UCP requests.',
      'PLATFORM_PROFILE_URL must be a public HTTPS URL in production.',
      'DATABASE_URL is required in production.',
      'REDIS_URL is required in production.',
      'REDIS_URL is required when RATE_LIMIT_ENABLED is true in production.',
      'API_KEY_PEPPER must be configured with at least 32 characters in production.',
      'AGENT_SESSION_SIGNING_SECRET must be configured with at least 32 characters in production.',
      'PUBLIC_BASE_URL must be a public HTTPS origin in production.'
    ]))
  })

  it('uses the built-in Shopify Global Catalog source in production when no registry override is supplied', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
    })

    expect(runtimeConfig.catalogAdapterCount).toBe(1)
    expect(runtimeConfig.platformProfileUrl).toBe('https://api.arro.com/.well-known/ucp')
    expect(validateRuntimeConfig(runtimeConfig)).toEqual([])
  })

  it('requires PUBLIC_BASE_URL to be an exact production origin', () => {
    for (const publicBaseUrl of [
      'https://api.arro.com/path',
      'https://api.arro.com?query=yes',
      'https://api.arro.com#fragment',
      'https://user:secret@api.arro.com',
      'https://[::1]',
      'https://localhost.',
      'https://192.168.1.7'
    ]) {
      const runtimeConfig = buildConfig({
        NODE_ENV: 'production',
        ...productionFrontendEnv,
        PUBLIC_BASE_URL: publicBaseUrl,
        DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
        REDIS_URL: 'redis://redis:6379',
        API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
        AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
        UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile
      })

      expect(validateRuntimeConfig(runtimeConfig)).toContain(
        'PUBLIC_BASE_URL must be a public HTTPS origin in production.'
      )
    }
  })

  it('accepts private UCP key material from a protected production environment value', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_JSON: productionUcpSigningPrivateJwkJson
    })

    expect(validateRuntimeConfig(runtimeConfig)).toEqual([])
  })

  it('rejects empty production catalog adapter registries', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      PLATFORM_PROFILE_URL: 'https://api.arro.com/.well-known/ucp',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
      CATALOG_ADAPTERS_JSON: '[]'
    })

    expect(validateRuntimeConfig(runtimeConfig)).toEqual([
      'At least one catalog source must be enabled in production.'
    ])
  })

  it('rejects local development fallback secrets in production', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      PLATFORM_PROFILE_URL: 'https://api.arro.com/.well-known/ucp',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'local-development-api-key-pepper-change-for-shared-environments',
      AGENT_SESSION_SIGNING_SECRET: 'local-development-agent-session-signing-secret-change-for-shared-environments',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
      CATALOG_ADAPTERS_JSON: productionCatalogAdaptersJson
    })

    expect(validateRuntimeConfig(runtimeConfig)).toEqual([
      'API_KEY_PEPPER must not use the local development fallback value in production.',
      'AGENT_SESSION_SIGNING_SECRET must not use the local development fallback value in production.'
    ])
  })

  it('rejects weak PostgreSQL passwords in production', () => {
    for (const password of ['arro_dev_password', 'x']) {
      const runtimeConfig = buildConfig({
        NODE_ENV: 'production',
        ...productionFrontendEnv,
        PUBLIC_BASE_URL: 'https://api.arro.com',
        DATABASE_URL: `postgresql://arro:${password}@postgres:5432/arro`,
        REDIS_URL: 'redis://redis:6379',
        API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
        AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
        UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile
      })

      expect(validateRuntimeConfig(runtimeConfig)).toContain(
        'DATABASE_URL must use a password with at least 32 characters in production.'
      )
    }
  })

  it('rejects production catalog adapters with missing referenced secrets', () => {
    const env = {
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
      CATALOG_ADAPTERS_JSON: JSON.stringify([
        {
          kind: 'shopify_storefront_graphql',
          adapterId: 'production-shopify-graphql',
          businessId: 'production-shopify-store',
          shopDomain: 'production-shop.myshopify.com',
          storefrontAccessTokenEnv: 'PRODUCTION_SHOPIFY_STOREFRONT_TOKEN'
        }
      ])
    }
    const runtimeConfig = buildConfig(env)

    expect(validateRuntimeConfig(runtimeConfig, env)).toEqual([
      'Invalid CATALOG_ADAPTERS_JSON: CATALOG_ADAPTERS_JSON[0].storefrontAccessTokenEnv references PRODUCTION_SHOPIFY_STOREFRONT_TOKEN, but that secret is not configured.'
    ])
  })

  it('requires vault and signed actions for enabled payments without forcing tokenizer auth on hosted-only flows', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      PLATFORM_PROFILE_URL: 'https://api.arro.com/.well-known/ucp',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
      PAYMENTS_ENABLED: 'true',
      PAYMENT_CREDENTIAL_ENCRYPTION_KEY: 'short',
      CATALOG_ADAPTERS_JSON: productionCatalogAdaptersJson
    })

    expect(validateRuntimeConfig(runtimeConfig)).toEqual([
      'PAYMENT_ACTION_SIGNING_SECRET is required when PAYMENTS_ENABLED is true so payment approvals are bound to signed one-time action tokens.',
      'PAYMENT_CREDENTIAL_ENCRYPTION_KEY must be at least 32 characters.'
    ])
  })

  it('requires private tokenizer auth when public handler specs enable tokenizer execution', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
      PAYMENTS_ENABLED: 'true',
      PAYMENT_ACTION_SIGNING_SECRET: 'production-payment-action-secret-at-least-32-chars',
      PAYMENT_CREDENTIAL_ENCRYPTION_KEY: 'production-payment-credential-encryption-key-32-plus',
      PROCESSOR_TOKENIZER_ENABLED: 'true',
      UCP_PAYMENT_HANDLER_SPECS_JSON: JSON.stringify([
        {
          adapterKind: 'processor_tokenizer',
          handlerName: 'com.example.processor_tokenizer',
          platformHandlerId: 'arro_processor_tokenizer_client',
          versions: [UCP_STABLE_VERSION],
          specification: 'https://example.com/ucp/handlers/com.example.processor_tokenizer',
          schema: 'https://example.com/ucp/handlers/com.example.processor_tokenizer/schema.json',
          environment: 'PRODUCTION',
          handlerConfig: {
            gateway: 'stripe',
            credential_type: 'stripe_payment_intent',
            native_session_url: 'https://example.com/ucp/payment-handlers/stripe/native-session'
          }
        }
      ]),
      CATALOG_ADAPTERS_JSON: productionCatalogAdaptersJson
    })

    expect(validateRuntimeConfig(runtimeConfig)).toContain(
      'UCP_TOKENIZER_AUTH_JSON is required when UCP_PAYMENT_HANDLER_SPECS_JSON enables Processor Tokenizer execution.'
    )
  })

  it('activates Processor Tokenizer production only with a live Stripe native-session contract', () => {
    const stripeHandler = {
      adapterKind: 'processor_tokenizer',
      handlerName: 'com.merchant.stripe',
      platformHandlerId: 'arro_stripe_payment_sheet',
      versions: [UCP_STABLE_VERSION],
      specification: 'https://merchant.example/ucp/payment-handlers/com.merchant.stripe',
      schema: 'https://merchant.example/ucp/payment-handlers/com.merchant.stripe/schema.json',
      environment: 'PRODUCTION',
      handlerConfig: {
        gateway: 'stripe',
        credential_type: 'stripe_payment_intent',
        native_session_url: 'https://merchant.example/ucp/payment-handlers/com.merchant.stripe/native-session'
      }
    }
    const baseEnv = {
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
      PAYMENTS_ENABLED: 'true',
      PAYMENT_ACTION_SIGNING_SECRET: 'production-payment-action-secret-at-least-32-chars',
      PAYMENT_CREDENTIAL_ENCRYPTION_KEY: 'production-payment-credential-encryption-key-32-plus',
      PROCESSOR_TOKENIZER_ENABLED: 'true',
      UCP_PAYMENT_HANDLER_SPECS_JSON: JSON.stringify([stripeHandler]),
      UCP_TOKENIZER_AUTH_JSON: JSON.stringify({
        'https://merchant.example': {
          provider: stripeHandler.handlerName,
          environment: 'PRODUCTION',
          bearerToken: 'merchant-runtime-secret'
        }
      }),
      CATALOG_ADAPTERS_JSON: productionCatalogAdaptersJson
    }

    expect(validateRuntimeConfig(buildConfig(baseEnv), baseEnv)).toEqual([])

    const testHandlerEnv = {
      ...baseEnv,
      UCP_PAYMENT_HANDLER_SPECS_JSON: JSON.stringify([{
        ...stripeHandler,
        environment: 'TEST'
      }])
    }
    expect(validateRuntimeConfig(buildConfig(testHandlerEnv), testHandlerEnv)).toEqual(
      expect.arrayContaining([
        'Production Processor Tokenizer handler definitions must use environment PRODUCTION.',
        'Production Processor Tokenizer execution requires a live Stripe native-session handler with gateway stripe, credential_type stripe_payment_intent, environment PRODUCTION, and an HTTPS native_session_url.'
      ])
    )

    const browserOnlyHandlerEnv = {
      ...baseEnv,
      UCP_PAYMENT_HANDLER_SPECS_JSON: JSON.stringify([{
        ...stripeHandler,
        handlerConfig: {
          gateway: 'stripe',
          credential_type: 'stripe_payment_intent'
        }
      }])
    }
    expect(validateRuntimeConfig(buildConfig(browserOnlyHandlerEnv), browserOnlyHandlerEnv)).toContain(
      'Production Processor Tokenizer execution requires a live Stripe native-session handler with gateway stripe, credential_type stripe_payment_intent, environment PRODUCTION, and an HTTPS native_session_url.'
    )
  })

  it('does not misclassify non-tokenizer payment handler definitions as Processor Tokenizer execution', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      PLATFORM_PROFILE_URL: 'https://api.arro.com/.well-known/ucp',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
      PAYMENTS_ENABLED: 'true',
      PAYMENT_ACTION_SIGNING_SECRET: 'production-payment-action-secret-at-least-32-chars',
      PAYMENT_CREDENTIAL_ENCRYPTION_KEY: 'production-payment-credential-encryption-key-32-plus',
      UCP_PAYMENT_HANDLER_SPECS_JSON: JSON.stringify([
        {
          adapterKind: 'google_pay',
          handlerName: 'com.google.pay',
          platformHandlerId: 'arro_google_pay_client',
          versions: ['2026-01-23'],
          specification: 'https://pay.google.com/gp/p/ucp/2026-01-23/',
          schema: 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json',
          environment: 'TEST',
          handlerConfig: {
            api_version: 2,
            api_version_minor: 0,
            environment: 'TEST',
            merchant_info: {
              merchant_id: '12345678901234567890',
              merchant_name: 'Example Merchant',
              merchant_origin: 'merchant.example'
            },
            allowed_payment_methods: [{
              type: 'CARD',
              parameters: {
                allowed_auth_methods: ['PAN_ONLY'],
                allowed_card_networks: ['VISA']
              },
              tokenization_specification: {
                type: 'PAYMENT_GATEWAY',
                parameters: { gateway: 'example' }
              }
            }]
          }
        }
      ]),
      CATALOG_ADAPTERS_JSON: productionCatalogAdaptersJson
    })

    expect(validateRuntimeConfig(runtimeConfig)).toEqual([
      'UCP_PAYMENT_HANDLER_SPECS_JSON includes adapter kinds that are not executable in this runtime: google_pay.'
    ])
  })

  it('activates native Google Pay with exact merchant, handler, and PSP proof without a web origin', () => {
    const googleHandler = {
      adapterKind: 'google_pay',
      handlerName: 'com.google.pay',
      platformHandlerId: 'arro_google_pay_client',
      versions: ['2026-01-23'],
      specification: 'https://pay.google.com/gp/p/ucp/2026-01-23/',
      schema: 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json',
      environment: 'PRODUCTION',
      handlerConfig: {
        api_version: 2,
        api_version_minor: 0,
        environment: 'PRODUCTION',
        merchant_info: {
          merchant_id: '12345678901234567890',
          merchant_name: 'Arro Reference Merchant',
          merchant_origin: 'api.arro.com'
        },
        allowed_payment_methods: [{
          type: 'CARD',
          parameters: {
            allowed_auth_methods: ['PAN_ONLY'],
            allowed_card_networks: ['VISA', 'MASTERCARD']
          },
          tokenization_specification: {
            type: 'PAYMENT_GATEWAY',
            parameters: { gateway: 'approved-gateway' }
          }
        }]
      }
    }
    const baseEnv = {
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      PLATFORM_PROFILE_URL: 'https://api.arro.com/.well-known/ucp',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
      PAYMENTS_ENABLED: 'true',
      PAYMENT_ACTION_SIGNING_SECRET: 'production-payment-action-secret-at-least-32-chars',
      PAYMENT_CREDENTIAL_ENCRYPTION_KEY: 'production-payment-credential-encryption-key-32-plus',
      GOOGLE_PAY_ENABLED: 'true',
      GOOGLE_PAY_ENVIRONMENT: 'PRODUCTION',
      UCP_PAYMENT_HANDLER_SPECS_JSON: JSON.stringify([googleHandler]),
      CATALOG_ADAPTERS_JSON: productionCatalogAdaptersJson
    }
    const blocked = validateRuntimeConfig(buildConfig(baseEnv), baseEnv)
    expect(blocked).toContain('GOOGLE_PAY_PRODUCTION_MERCHANT_ID is required for Google Pay production activation.')
    expect(blocked).toContain('GOOGLE_PAY_PRODUCTION_HANDLER_ID is required for Google Pay production activation.')
    expect(blocked).toContain('GOOGLE_PAY_PRODUCTION_PSP is required for Google Pay production activation.')
    expect(blocked).toContain('GOOGLE_PAY_PRODUCTION_APPROVAL_REFERENCE is required for Google Pay production activation.')
    expect(blocked.join('\n')).not.toContain('ORIGIN')

    const approvedEnv = {
      ...baseEnv,
      GOOGLE_PAY_PRODUCTION_MERCHANT_ID: '12345678901234567890',
      GOOGLE_PAY_PRODUCTION_HANDLER_ID: 'arro_google_pay_client',
      GOOGLE_PAY_PRODUCTION_PSP: 'approved-gateway',
      GOOGLE_PAY_PRODUCTION_APPROVAL_REFERENCE: 'google-approval-reference-1'
    }
    const runtimeConfig = buildConfig(approvedEnv)
    expect(runtimeConfig.googlePayWebEnabled).toBe(false)
    expect(runtimeConfig.googlePayAllowedOrigins).toBeUndefined()
    expect(validateRuntimeConfig(runtimeConfig, approvedEnv)).toEqual([])

    const mismatchedProof = {
      ...approvedEnv,
      GOOGLE_PAY_PRODUCTION_HANDLER_ID: 'another-handler',
      GOOGLE_PAY_PRODUCTION_PSP: 'another-psp'
    }
    expect(validateRuntimeConfig(buildConfig(mismatchedProof), mismatchedProof)).toEqual(
      expect.arrayContaining([
        'GOOGLE_PAY_PRODUCTION_HANDLER_ID must match the exact production UCP platformHandlerId.',
        'GOOGLE_PAY_PRODUCTION_PSP must match the exact production UCP handler gateway.'
      ])
    )
  })

  it('requires an explicit enable flag and exact Arro action origin for hosted Google Pay Web', () => {
    const googleHandler = {
      adapterKind: 'google_pay',
      handlerName: 'com.google.pay',
      platformHandlerId: 'arro_google_pay_client',
      versions: ['2026-01-23'],
      specification: 'https://pay.google.com/gp/p/ucp/2026-01-23/',
      schema: 'https://pay.google.com/gp/p/ucp/2026-01-23/schemas/config.json',
      environment: 'PRODUCTION',
      handlerConfig: {
        api_version: 2,
        api_version_minor: 0,
        environment: 'PRODUCTION',
        merchant_info: {
          merchant_id: '12345678901234567890',
          merchant_name: 'Arro Reference Merchant',
          merchant_origin: 'api.arro.com'
        },
        allowed_payment_methods: [{
          type: 'CARD',
          parameters: {
            allowed_auth_methods: ['PAN_ONLY'],
            allowed_card_networks: ['VISA']
          },
          tokenization_specification: {
            type: 'PAYMENT_GATEWAY',
            parameters: { gateway: 'approved-gateway' }
          }
        }]
      }
    }
    const baseEnv = {
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
      PAYMENTS_ENABLED: 'true',
      PAYMENT_ACTION_SIGNING_SECRET: 'production-payment-action-secret-at-least-32-chars',
      PAYMENT_CREDENTIAL_ENCRYPTION_KEY: 'production-payment-credential-encryption-key-32-plus',
      GOOGLE_PAY_ENABLED: 'true',
      GOOGLE_PAY_ENVIRONMENT: 'PRODUCTION',
      GOOGLE_PAY_PRODUCTION_MERCHANT_ID: '12345678901234567890',
      GOOGLE_PAY_PRODUCTION_HANDLER_ID: 'arro_google_pay_client',
      GOOGLE_PAY_PRODUCTION_PSP: 'approved-gateway',
      GOOGLE_PAY_PRODUCTION_APPROVAL_REFERENCE: 'google-approval-reference-1',
      UCP_PAYMENT_HANDLER_SPECS_JSON: JSON.stringify([googleHandler]),
      CATALOG_ADAPTERS_JSON: productionCatalogAdaptersJson
    }

    const originsWithoutEnable = {
      ...baseEnv,
      GOOGLE_PAY_WEB_ALLOWED_ORIGINS: 'https://api.arro.com'
    }
    expect(buildConfig(originsWithoutEnable).googlePayAllowedOrigins).toBeUndefined()
    expect(validateRuntimeConfig(buildConfig(originsWithoutEnable), originsWithoutEnable)).toEqual([])

    const enabledWithoutOrigin = { ...baseEnv, GOOGLE_PAY_WEB_ENABLED: 'true' }
    expect(validateRuntimeConfig(buildConfig(enabledWithoutOrigin), enabledWithoutOrigin)).toContain(
      'GOOGLE_PAY_WEB_ALLOWED_ORIGINS is required when GOOGLE_PAY_WEB_ENABLED is true.'
    )

    const approvedWebEnv = {
      ...enabledWithoutOrigin,
      GOOGLE_PAY_WEB_ALLOWED_ORIGINS: 'https://api.arro.com',
      GOOGLE_PAY_WEB_PRODUCTION_REGISTERED_ORIGIN: 'https://api.arro.com'
    }
    const webConfig = buildConfig(approvedWebEnv)
    expect(webConfig.googlePayWebEnabled).toBe(true)
    expect(webConfig.googlePayAllowedOrigins).toBe('https://api.arro.com')
    expect(validateRuntimeConfig(webConfig, approvedWebEnv)).toEqual([])

    const pathOrigin = {
      ...approvedWebEnv,
      GOOGLE_PAY_WEB_ALLOWED_ORIGINS: 'https://api.arro.com/pay'
    }
    expect(validateRuntimeConfig(buildConfig(pathOrigin), pathOrigin)).toContain(
      'GOOGLE_PAY_WEB_ALLOWED_ORIGINS entries must be exact HTTPS origins without credentials, paths, queries, fragments, or trailing slashes.'
    )
  })

  it('rejects payment handler specs that omit adapter kind or weaken direct-payment safety', () => {
    const missingKindConfig = buildConfig({
      NODE_ENV: 'development',
      UCP_PAYMENT_HANDLER_SPECS_JSON: JSON.stringify([
        {
          handlerName: 'com.example.processor_tokenizer',
          platformHandlerId: 'arro_processor_tokenizer_client',
          versions: [UCP_STABLE_VERSION],
          specification: 'https://example.com/ucp/handlers/com.example.processor_tokenizer',
          schema: 'https://example.com/ucp/handlers/com.example.processor_tokenizer/schema.json'
        }
      ])
    })
    expect(validateRuntimeConfig(missingKindConfig)).toContain(
      'Invalid UCP_PAYMENT_HANDLER_SPECS_JSON: UCP_PAYMENT_HANDLER_SPECS_JSON[0] must include an explicit supported adapterKind.'
    )

    const weakenedPolicyConfig = buildConfig({
      NODE_ENV: 'development',
      UCP_PAYMENT_HANDLER_SPECS_JSON: JSON.stringify([
        {
          adapterKind: 'processor_tokenizer',
          handlerName: 'com.example.processor_tokenizer',
          platformHandlerId: 'arro_processor_tokenizer_client',
          versions: [UCP_STABLE_VERSION],
          specification: 'https://example.com/ucp/handlers/com.example.processor_tokenizer',
          schema: 'https://example.com/ucp/handlers/com.example.processor_tokenizer/schema.json',
          lifecyclePolicy: {
            rejectReusable: false
          }
        }
      ])
    })
    expect(validateRuntimeConfig(weakenedPolicyConfig)).toContain(
      'Invalid UCP_PAYMENT_HANDLER_SPECS_JSON: UCP payment handler lifecycle policy cannot set rejectReusable to false; direct-payment minimum safety is non-relaxable.'
    )
  })

  it('enables AP2 only with payment, persistence, and trusted issuer prerequisites', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'development',
      AP2_RUNTIME_ENABLED: 'true',
      AP2_TRUSTED_ISSUERS_JSON: '[]',
      EMBEDDED_CHECKOUT_RUNTIME_ENABLED: 'true'
    })

    expect(validateRuntimeConfig(runtimeConfig)).toEqual([
      'PAYMENTS_ENABLED must be true when AP2_RUNTIME_ENABLED is true.',
      'DATABASE_URL is required when AP2_RUNTIME_ENABLED is true for durable replay, authority, and receipt state.',
      'AP2_TRUSTED_ISSUERS_JSON must configure at least one trusted issuer and verification key when AP2_RUNTIME_ENABLED is true.',
      'DATABASE_URL is required when EMBEDDED_CHECKOUT_RUNTIME_ENABLED is true so embedded checkout lifecycle events are durably recorded.',
      'PAYMENT_ACTION_SIGNING_SECRET is required when EMBEDDED_CHECKOUT_RUNTIME_ENABLED is true so embedded checkout sessions are signed.'
    ])

    const ap2RuntimeConfig = buildConfig({
      NODE_ENV: 'development',
      AP2_RUNTIME_ENABLED: 'true',
      AP2_TRUSTED_ISSUERS_JSON: JSON.stringify({
        issuers: [{ issuer: 'https://issuer.example', keys: [{ kty: 'EC', crv: 'P-256', x: 'x', y: 'y', kid: 'key-1' }] }]
      }),
      PAYMENTS_ENABLED: 'true',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@localhost:5432/arro',
      REDIS_URL: 'redis://localhost:6379',
      PAYMENT_CREDENTIAL_ENCRYPTION_KEY: 'development-payment-encryption-key-at-least-32-chars',
      PAYMENT_ACTION_SIGNING_SECRET: 'development-payment-action-secret-at-least-32-chars'
    })
    expect(validateRuntimeConfig(ap2RuntimeConfig)).toEqual([])

    const executableRuntimeConfig = buildConfig({
      NODE_ENV: 'development',
      EMBEDDED_CHECKOUT_RUNTIME_ENABLED: 'true',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@localhost:5432/arro',
      PAYMENT_ACTION_SIGNING_SECRET: 'development-payment-action-secret-at-least-32-chars'
    })
    expect(validateRuntimeConfig(executableRuntimeConfig)).toEqual([])
  })

  it('requires one exact executable trusted-host intersection for autonomous purchases', () => {
    const trustedHost = {
      hostId: 'launch-host',
      integrationId: 'agent:launch-key:launch-host',
      issuer: 'https://host.example',
      audience: 'https://api.arro.com',
      authorizationEndpoint: 'https://host.example/authorize',
      redemptionEndpoint: 'https://host.example/redeem',
      allowedScopes: ['write:complete_purchase'],
      handlerNames: ['com.example.processor_tokenizer'],
      canReceiveAsyncPurchaseUpdates: true,
      autonomousExecutionAllowed: true
    }
    const paymentHandler = {
      adapterKind: 'processor_tokenizer',
      handlerName: 'com.example.processor_tokenizer',
      platformHandlerId: 'arro_processor_tokenizer_client',
      versions: [UCP_STABLE_VERSION],
      specification: 'https://example.com/ucp/handlers/com.example.processor_tokenizer',
      schema: 'https://example.com/ucp/handlers/com.example.processor_tokenizer/schema.json'
    }
    const baseEnv = {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@localhost:5432/arro',
      REDIS_URL: 'redis://localhost:6379',
      PAYMENTS_ENABLED: 'true',
      PAYMENT_ACTION_SIGNING_SECRET: 'trusted-host-payment-action-secret-at-least-32-characters',
      PAYMENT_CREDENTIAL_ENCRYPTION_KEY: 'trusted-host-payment-credential-key-at-least-32-characters',
      AUTONOMOUS_PURCHASES_ENABLED: 'true',
      PRIMARY_AUTONOMOUS_ROUTE: 'trusted_host',
      CATALOG_ADAPTERS_JSON: productionCatalogAdaptersJson,
      HOST_PAYMENT_CAPABILITIES_JSON: JSON.stringify([trustedHost]),
      HOST_PAYMENT_ATTESTATION_KEYS_JSON: JSON.stringify([{
        hostId: trustedHost.hostId,
        issuer: trustedHost.issuer,
        keys: [{ kty: 'EC', crv: 'P-256', x: 'x', y: 'y', kid: 'key-1' }]
      }]),
      UCP_PAYMENT_HANDLER_SPECS_JSON: JSON.stringify([paymentHandler]),
      UCP_TOKENIZER_AUTH_JSON: JSON.stringify({
        'https://merchant.example': {
          provider: paymentHandler.handlerName,
          handlerId: paymentHandler.handlerName,
          tokenizeEndpoint: 'https://merchant.example/tokenize',
          bearerToken: 'private-tokenizer-secret'
        }
      })
    }
    expect(validateRuntimeConfig(buildConfig(baseEnv), baseEnv)).toEqual([])
  })

  it('derives and enforces the canonical platform profile URL for production payment activation', () => {
    const baseEnv = {
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
      PAYMENTS_ENABLED: 'true',
      PAYMENT_ACTION_SIGNING_SECRET: 'production-payment-action-secret-at-least-32-chars',
      PAYMENT_CREDENTIAL_ENCRYPTION_KEY: 'production-payment-credential-encryption-key-32-plus',
      CATALOG_ADAPTERS_JSON: productionCatalogAdaptersJson
    }
    const derived = buildConfig(baseEnv)
    expect(derived.platformProfileUrl).toBe('https://api.arro.com/.well-known/ucp')
    expect(validateRuntimeConfig(derived, baseEnv)).toEqual([])

    const mismatchedEnv = {
      ...baseEnv,
      PLATFORM_PROFILE_URL: 'https://profiles.arro.com/.well-known/ucp'
    }
    expect(validateRuntimeConfig(buildConfig(mismatchedEnv), mismatchedEnv)).toContain(
      'PLATFORM_PROFILE_URL must resolve to PUBLIC_BASE_URL/.well-known/ucp so advertised and outbound UCP authority are identical.'
    )
  })

  it('rejects unsupported production catalog adapter kinds', () => {
    const env = {
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
      CATALOG_ADAPTERS_JSON: JSON.stringify([
        {
          kind: 'scraper',
          adapterId: 'production-scraper',
          businessId: 'production-store'
        }
      ])
    }
    const runtimeConfig = buildConfig(env)

    expect(validateRuntimeConfig(runtimeConfig, env)).toEqual([
      'Invalid CATALOG_ADAPTERS_JSON: CATALOG_ADAPTERS_JSON[0].kind must be ucp_rest, ucp_mcp, shopify_storefront_mcp, shopify_global_catalog_mcp, or shopify_storefront_graphql.'
    ])
  })

  it('requires closed rate-limit failure mode in production', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
      CATALOG_ADAPTERS_JSON: productionCatalogAdaptersJson,
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_FAILURE_MODE: 'open'
    })

    expect(validateRuntimeConfig(runtimeConfig)).toEqual([
      'RATE_LIMIT_FAILURE_MODE must be closed in production when rate limiting is enabled.'
    ])
  })

  it('keeps Postgres statement timeout inside the request timeout budget', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'development',
      REQUEST_TIMEOUT_MS: '1000',
      POSTGRES_STATEMENT_TIMEOUT_MS: '1500'
    })

    expect(validateRuntimeConfig(runtimeConfig)).toEqual([
      'POSTGRES_STATEMENT_TIMEOUT_MS must be less than or equal to REQUEST_TIMEOUT_MS.'
    ])
  })

  it('keeps connector timeout inside the request timeout budget', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'development',
      REQUEST_TIMEOUT_MS: '1000',
      CONNECTOR_TIMEOUT_MS: '1500'
    })

    expect(validateRuntimeConfig(runtimeConfig)).toEqual([
      'CONNECTOR_TIMEOUT_MS must be less than or equal to REQUEST_TIMEOUT_MS.'
    ])
  })

  it('defaults connector timeout to a conservative request-budget slice', () => {
    const defaultConfig = buildConfig({ NODE_ENV: 'development' })
    const smallBudgetConfig = buildConfig({
      NODE_ENV: 'development',
      REQUEST_TIMEOUT_MS: '5000'
    })

    expect(defaultConfig.connectorTimeoutMs).toBe(10_000)
    expect(smallBudgetConfig.connectorTimeoutMs).toBe(5000)
  })

  it('loads shutdown grace-period defaults and overrides', () => {
    const defaultConfig = buildConfig({ NODE_ENV: 'development' })
    const configuredConfig = buildConfig({
      NODE_ENV: 'development',
      SHUTDOWN_GRACE_PERIOD_MS: '12000'
    })

    expect(defaultConfig.shutdownGracePeriodMs).toBe(25_000)
    expect(configuredConfig.shutdownGracePeriodMs).toBe(12_000)
  })

  it('keeps shutdown grace period within deployment termination budget', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'development',
      SHUTDOWN_GRACE_PERIOD_MS: '31000'
    })

    expect(validateRuntimeConfig(runtimeConfig)).toEqual([
      'SHUTDOWN_GRACE_PERIOD_MS must be less than or equal to 30000.'
    ])
  })

  it('loads conservative retention defaults', () => {
    const runtimeConfig = buildConfig({ NODE_ENV: 'development' })

    expect(runtimeConfig.requestAuditLogRetentionDays).toBe(90)
    expect(runtimeConfig.searchAuditLogRetentionDays).toBe(30)
    expect(runtimeConfig.purchaseSessionRetentionDays).toBe(30)
    expect(runtimeConfig.discoveryObservationRetentionDays).toBe(180)
    expect(runtimeConfig.conformanceMaxAgeDays).toBe(30)
  })

  it('loads target-business matrix cache defaults and overrides', () => {
    const defaultConfig = buildConfig({ NODE_ENV: 'development' })
    const disabledConfig = buildConfig({
      NODE_ENV: 'development',
      TARGET_BUSINESS_MATRIX_CACHE_TTL_MS: '0'
    })
    const configuredConfig = buildConfig({
      NODE_ENV: 'development',
      TARGET_BUSINESS_MATRIX_CACHE_TTL_MS: '15000'
    })

    expect(defaultConfig.targetBusinessMatrixCacheTtlMs).toBe(5000)
    expect(disabledConfig.targetBusinessMatrixCacheTtlMs).toBe(0)
    expect(configuredConfig.targetBusinessMatrixCacheTtlMs).toBe(15_000)
  })

  it('loads connector fan-out budget defaults and overrides', () => {
    const defaultConfig = buildConfig({ NODE_ENV: 'development' })
    const configuredConfig = buildConfig({
      NODE_ENV: 'development',
      CATALOG_CONNECTOR_MAX_SOURCES_PER_REQUEST: '8',
      CATALOG_CONNECTOR_MAX_CONCURRENCY_PER_REQUEST: '4',
      CATALOG_CONNECTOR_COALESCING_WINDOW_MS: '250'
    })

    expect(defaultConfig.catalogConnectorMaxSourcesPerRequest).toBe(5)
    expect(defaultConfig.catalogConnectorMaxConcurrencyPerRequest).toBe(3)
    expect(defaultConfig.catalogConnectorCoalescingWindowMs).toBe(100)
    expect(configuredConfig.catalogConnectorMaxSourcesPerRequest).toBe(8)
    expect(configuredConfig.catalogConnectorMaxConcurrencyPerRequest).toBe(4)
    expect(configuredConfig.catalogConnectorCoalescingWindowMs).toBe(250)
  })

  it('keeps connector concurrency inside the source fan-out budget', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'development',
      CATALOG_CONNECTOR_MAX_SOURCES_PER_REQUEST: '2',
      CATALOG_CONNECTOR_MAX_CONCURRENCY_PER_REQUEST: '3'
    })

    expect(validateRuntimeConfig(runtimeConfig)).toEqual([
      'CATALOG_CONNECTOR_MAX_CONCURRENCY_PER_REQUEST must be less than or equal to CATALOG_CONNECTOR_MAX_SOURCES_PER_REQUEST.'
    ])
  })

  it('keeps connector fan-out knobs inside the catalog request budget', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'development',
      CATALOG_CONNECTOR_MAX_SOURCES_PER_REQUEST: '21',
      CATALOG_CONNECTOR_MAX_CONCURRENCY_PER_REQUEST: '11',
      CATALOG_CONNECTOR_COALESCING_WINDOW_MS: '1001'
    })

    expect(validateRuntimeConfig(runtimeConfig)).toEqual([
      'CATALOG_CONNECTOR_MAX_SOURCES_PER_REQUEST must be less than or equal to 20 for the catalog request budget.',
      'CATALOG_CONNECTOR_MAX_CONCURRENCY_PER_REQUEST must be less than or equal to 10 for the catalog request budget.',
      'CATALOG_CONNECTOR_COALESCING_WINDOW_MS must be less than or equal to 1000.'
    ])
  })

  it('loads connector transport and DNS cache runtime defaults', () => {
    const developmentConfig = buildConfig({ NODE_ENV: 'development' })
    const productionConfig = buildConfig({
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
      CATALOG_ADAPTERS_JSON: productionCatalogAdaptersJson
    })
    const configuredConfig = buildConfig({
      NODE_ENV: 'development',
      CATALOG_HTTP_MAX_CONNECTIONS_PER_ORIGIN: '32',
      CONNECTOR_DNS_CACHE_ENABLED: 'true',
      CONNECTOR_DNS_CACHE_TTL_MS: '45000',
      CONNECTOR_DNS_CACHE_MAX_ENTRIES: '256'
    })

    expect(developmentConfig.catalogHttpMaxConnectionsPerOrigin).toBe(64)
    expect(developmentConfig.connectorDnsCacheEnabled).toBe(false)
    expect(productionConfig.connectorDnsCacheEnabled).toBe(true)
    expect(configuredConfig.catalogHttpMaxConnectionsPerOrigin).toBe(32)
    expect(configuredConfig.connectorDnsCacheEnabled).toBe(true)
    expect(configuredConfig.connectorDnsCacheTtlMs).toBe(45_000)
    expect(configuredConfig.connectorDnsCacheMaxEntries).toBe(256)
  })

  it('parses configured retention windows', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'development',
      REQUEST_AUDIT_LOG_RETENTION_DAYS: '45',
      SEARCH_AUDIT_LOG_RETENTION_DAYS: '21',
      PURCHASE_SESSION_RETENTION_DAYS: '15',
      DISCOVERY_OBSERVATION_RETENTION_DAYS: '120',
      CONFORMANCE_MAX_AGE_DAYS: '14'
    })

    expect(runtimeConfig.requestAuditLogRetentionDays).toBe(45)
    expect(runtimeConfig.searchAuditLogRetentionDays).toBe(21)
    expect(runtimeConfig.purchaseSessionRetentionDays).toBe(15)
    expect(runtimeConfig.discoveryObservationRetentionDays).toBe(120)
    expect(runtimeConfig.conformanceMaxAgeDays).toBe(14)
  })

  it('keeps fixture conformance explicitly disabled unless requested outside production', () => {
    const defaultConfig = buildConfig({ NODE_ENV: 'development' })
    const fixtureConfig = buildConfig({
      NODE_ENV: 'development',
      CONFORMANCE_FIXTURE_MODE: 'true'
    })
    const productionConfig = buildConfig({
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
      CATALOG_ADAPTERS_JSON: productionCatalogAdaptersJson,
      CONFORMANCE_FIXTURE_MODE: 'true'
    })

    expect(defaultConfig.conformanceFixtureModeEnabled).toBe(false)
    expect(fixtureConfig.conformanceFixtureModeEnabled).toBe(true)
    expect(productionConfig.conformanceFixtureModeEnabled).toBe(false)
    expect(validateRuntimeConfig(productionConfig)).toContain(
      'CONFORMANCE_FIXTURE_MODE must not be enabled in production.'
    )
  })

  it('requires startup migration validation in production', () => {
    const runtimeConfig = {
      ...buildConfig({
        NODE_ENV: 'production',
        ...productionFrontendEnv,
        PUBLIC_BASE_URL: 'https://api.arro.com',
        DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
        REDIS_URL: 'redis://redis:6379',
        API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
        AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
        UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
        CATALOG_ADAPTERS_JSON: productionCatalogAdaptersJson
      }),
      startupMigrationValidationEnabled: false
    }

    expect(validateRuntimeConfig(runtimeConfig)).toEqual([
      'STARTUP_MIGRATION_VALIDATION must be enabled in production.'
    ])
  })

  it('accepts production config with public HTTPS and real service URLs', () => {
    const runtimeConfig = buildConfig({
      NODE_ENV: 'production',
      ...productionFrontendEnv,
      PUBLIC_BASE_URL: 'https://api.arro.com',
      DATABASE_URL: 'postgresql://arro:production-database-password-1234567890@postgres:5432/arro',
      REDIS_URL: 'redis://redis:6379',
      API_KEY_PEPPER: 'production-api-key-pepper-with-at-least-32-characters',
      AGENT_SESSION_SIGNING_SECRET: 'production-agent-session-signing-secret-with-at-least-32-characters',
      UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE: productionUcpSigningPrivateJwkFile,
      CATALOG_ADAPTERS_JSON: productionCatalogAdaptersJson
    })

    expect(validateRuntimeConfig(runtimeConfig)).toEqual([])
    expect(runtimeConfig.startupMigrationValidationEnabled).toBe(true)
  })
})
