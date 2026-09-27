#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { isIP } from 'node:net'
import { fileURLToPath } from 'node:url'
import { resolveDatabaseUrlFromEnv } from '../apps/api/src/runtime-secrets.ts'
import { resolveUcpPlatformIdentity } from '../apps/api/src/ucp-platform-identity.ts'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const planOnly = process.argv.includes('--plan')
const failures = []

const required = (name) => {
  const value = process.env[name]?.trim()
  if (!value) failures.push(`${name} is required.`)
  return value
}

const publicHttpsUrl = (name, value) => {
  if (!value) return undefined
  try {
    const url = new URL(value)
    const hostname = url.hostname
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '')
      .toLowerCase()
    const localHost = isIP(hostname) !== 0 || hostname === 'localhost' ||
      hostname.endsWith('.localhost') || hostname.endsWith('.local')
    if (url.protocol !== 'https:' || localHost) {
      failures.push(`${name} must be a public HTTPS URL.`)
      return undefined
    }
    return url
  } catch {
    failures.push(`${name} must be a valid absolute URL.`)
    return undefined
  }
}

const publicBaseUrlValue = required('PUBLIC_BASE_URL')
const frontendSiteUrlValue = required('EXPO_PUBLIC_ARRO_SITE_URL')
const frontendServerToken = required('ARRO_FRONTEND_SERVER_TOKEN')
if (frontendServerToken && frontendServerToken.length < 32) {
  failures.push('ARRO_FRONTEND_SERVER_TOKEN must contain at least 32 characters.')
}
let liveDatabaseUrl
try {
  liveDatabaseUrl = resolveDatabaseUrlFromEnv(process.env)
  if (!liveDatabaseUrl) failures.push('DATABASE_URL or DATABASE_URL_FILE is required.')
} catch (error) {
  failures.push(error instanceof Error ? error.message : 'DATABASE_URL configuration is invalid.')
}
const liveRedisUrl = required('REDIS_URL')
const verificationDatabaseUrl = process.env.VERIFICATION_DATABASE_URL?.trim()
const verificationRedisUrl = process.env.VERIFICATION_REDIS_URL?.trim()
const ucpPlatformSigningPrivateJwkFile = process.env.UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE?.trim()
const ucpPlatformSigningPrivateJwkJson = process.env.UCP_PLATFORM_SIGNING_PRIVATE_JWK_JSON?.trim()
if (Boolean(verificationDatabaseUrl) !== Boolean(verificationRedisUrl)) {
  failures.push('VERIFICATION_DATABASE_URL and VERIFICATION_REDIS_URL must be configured together when running the optional isolated software band.')
}
if (!ucpPlatformSigningPrivateJwkFile && !ucpPlatformSigningPrivateJwkJson) {
  failures.push('UCP_PLATFORM_SIGNING_PRIVATE_JWK_FILE or UCP_PLATFORM_SIGNING_PRIVATE_JWK_JSON is required.')
}
if (process.env.VERIFY_PUBLIC_DISCOVERY_REQUEST_BASE_URL?.trim()) {
  failures.push(
    'VERIFY_PUBLIC_DISCOVERY_REQUEST_BASE_URL must be unset for the canonical launch gate; use it only for the standalone origin diagnostic.'
  )
}

if (ucpPlatformSigningPrivateJwkFile || ucpPlatformSigningPrivateJwkJson) {
  try {
    resolveUcpPlatformIdentity({
      privateJwkFile: ucpPlatformSigningPrivateJwkFile,
      privateJwkJson: ucpPlatformSigningPrivateJwkJson,
      additionalPublicJwksJson: process.env.UCP_PLATFORM_ADDITIONAL_PUBLIC_JWKS_JSON
    })
  } catch (error) {
    failures.push(error instanceof Error ? error.message : 'UCP platform signing identity is invalid.')
  }
}

const publicBaseUrl = publicHttpsUrl('PUBLIC_BASE_URL', publicBaseUrlValue)
const frontendSiteUrl = publicHttpsUrl('EXPO_PUBLIC_ARRO_SITE_URL', frontendSiteUrlValue)
if (frontendSiteUrl && frontendSiteUrl.toString() !== `${frontendSiteUrl.origin}/`) {
  failures.push('EXPO_PUBLIC_ARRO_SITE_URL must be an origin without credentials, a path, a query, or a fragment.')
}
const explicitPlatformProfileUrl = process.env.PLATFORM_PROFILE_URL?.trim()
const platformProfileUrlValue = explicitPlatformProfileUrl ||
  (publicBaseUrl ? new URL('/.well-known/ucp', publicBaseUrl).toString() : undefined)
const platformProfileUrl = publicHttpsUrl('PLATFORM_PROFILE_URL', platformProfileUrlValue)
if (publicBaseUrl && platformProfileUrl) {
  const expectedProfileUrl = new URL('/.well-known/ucp', publicBaseUrl).toString()
  if (platformProfileUrl.toString() !== expectedProfileUrl) {
    failures.push(`PLATFORM_PROFILE_URL must equal ${expectedProfileUrl}`)
  }
}
if (liveDatabaseUrl && verificationDatabaseUrl && liveDatabaseUrl === verificationDatabaseUrl) {
  failures.push('VERIFICATION_DATABASE_URL must not point to the production DATABASE_URL; software verification writes reference transactions.')
}
if (liveRedisUrl && verificationRedisUrl && liveRedisUrl === verificationRedisUrl) {
  failures.push('VERIFICATION_REDIS_URL must not point to the production REDIS_URL; software verification writes consume-once reference credentials.')
}
const envExample = await readFile(new URL('../.env.example', import.meta.url), 'utf8')
const repositoryConfigNames = new Set(
  [...envExample.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1])
)
const isolatedEnv = { ...process.env }
for (const name of repositoryConfigNames) delete isolatedEnv[name]
isolatedEnv.NODE_ENV = 'test'
isolatedEnv.CATALOG_ADAPTERS_JSON = '[]'

const softwareVerificationEnv = {
  ...isolatedEnv,
  DATABASE_URL: verificationDatabaseUrl ?? '',
  REDIS_URL: verificationRedisUrl ?? '',
  PRIMARY_AUTONOMOUS_ROUTE: process.env.VERIFICATION_PRIMARY_AUTONOMOUS_ROUTE?.trim() || 'trusted_host',
  RATE_LIMIT_ENABLED: 'false'
}
if (process.env.VERIFICATION_PAYMENT_CREDENTIAL_ENCRYPTION_KEY?.trim()) {
  softwareVerificationEnv.PAYMENT_CREDENTIAL_ENCRYPTION_KEY =
    process.env.VERIFICATION_PAYMENT_CREDENTIAL_ENCRYPTION_KEY.trim()
}

const liveEnv = {
  ...process.env,
  NODE_ENV: 'production'
}
delete liveEnv.VERIFY_PUBLIC_DISCOVERY_REQUEST_BASE_URL
const frontendBuildEnv = {
  ...isolatedEnv,
  ARRO_FRONTEND_SERVER_TOKEN: frontendServerToken ?? '',
  EXPO_PUBLIC_ARRO_API_URL: publicBaseUrlValue ?? '',
  EXPO_PUBLIC_ARRO_SITE_URL: frontendSiteUrlValue ?? '',
  ...(process.env.EXPO_PUBLIC_ARRO_CURRENCY?.trim()
    ? { EXPO_PUBLIC_ARRO_CURRENCY: process.env.EXPO_PUBLIC_ARRO_CURRENCY.trim() }
    : {})
}
const livePaymentActivation = process.env.GOOGLE_PAY_ENVIRONMENT?.trim() === 'PRODUCTION'
const paymentActivationEnv = {
  ...liveEnv,
  REQUIRE_LIVE_PAYMENT_ACTIVATION: livePaymentActivation ? 'true' : 'false'
}
const signedProfileEnv = {
  ...liveEnv,
  VERIFY_UCP_REQUIRE_PUBLIC_HTTPS: 'true',
  VERIFY_UCP_REQUIRE_SIGNING_KEYS: 'true',
  VERIFY_UCP_REQUIRE_ACTIVE_SIGNER: 'true'
}
const steps = [
  { label: 'Build, typecheck, tests, and Expo app validation', command: npmCommand, args: ['run', 'verify'], env: isolatedEnv },
  { label: 'Expo web production export', command: npmCommand, args: ['run', 'build:app'], env: frontendBuildEnv },
  ...(verificationDatabaseUrl && verificationRedisUrl
    ? [{ label: 'App-level software verification on isolated Postgres/Redis', command: process.execPath, args: ['apps/api/src/verify-software.ts'], env: softwareVerificationEnv }]
    : []),
  { label: 'Production configuration', command: process.execPath, args: ['apps/api/src/verify-production-config.ts'], env: liveEnv },
  {
    label: livePaymentActivation
      ? 'Strict live payment activation matrix'
      : 'Staging payment configuration matrix',
    command: process.execPath,
    args: ['apps/api/src/verify-production-payment-activation.ts'],
    env: paymentActivationEnv
  },
  { label: 'Public production readiness', command: process.execPath, args: ['apps/api/src/verify-production-readiness.ts'], env: liveEnv },
  { label: 'Public UCP profile', command: process.execPath, args: ['apps/api/src/verify-ucp-response.ts'], env: signedProfileEnv },
  { label: 'Live production search', command: process.execPath, args: ['apps/api/src/verify-production-search.ts'], env: liveEnv }
]

if (planOnly) {
  console.log('Arro production launch verification plan:')
  steps.forEach((step, index) => console.log(`${index + 1}. ${step.label}`))
  console.log(verificationDatabaseUrl && verificationRedisUrl
    ? 'Reference software verification uses isolated stores, never the production stores.'
    : 'Reference software verification is skipped; set both VERIFICATION_DATABASE_URL and VERIFICATION_REDIS_URL to include it.')
  console.log('The public API must already be running at PUBLIC_BASE_URL before the production surface steps execute.')
  if (failures.length > 0) {
    console.log('\nCurrent preflight gaps:')
    for (const failure of failures) console.log(`- ${failure}`)
  }
  process.exit(0)
}

if (failures.length > 0) {
  console.error('Arro launch preflight failed.')
  for (const failure of failures) console.error(`- ${failure}`)
  console.error('Run `npm run verify:launch -- --plan` to inspect the complete verification plan.')
  process.exit(1)
}

for (const [index, step] of steps.entries()) {
  console.log(`\n[${index + 1}/${steps.length}] ${step.label}`)
  const result = spawnSync(step.command, step.args, {
    cwd: repoRoot,
    env: step.env,
    stdio: 'inherit'
  })
  if (result.error) {
    console.error(`${step.label} could not start: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`${step.label} failed with exit status ${String(result.status)}.`)
    process.exit(result.status ?? 1)
  }
}

console.log('\nArro production launch verification passed.')
console.log(JSON.stringify({
  status: 'passed',
  publicBaseUrl: publicBaseUrl?.origin,
  platformProfileUrl: platformProfileUrl?.toString(),
  softwareRuntime: verificationDatabaseUrl && verificationRedisUrl
    ? 'isolated_verification_postgres_redis'
    : 'skipped_optional_isolated_band',
  productionRuntime: 'live_public_https',
  paymentActivation: livePaymentActivation
    ? 'strict_live_merchant_order_evidence'
    : 'staging_test_environment_configuration'
}, null, 2))
