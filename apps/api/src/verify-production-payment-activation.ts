import { buildConfig, validateRuntimeConfig } from './config.ts'
import { parsePaymentHandlerSpecConfig } from './payment-result-exchange.ts'
import {
  type PaymentActivationRoute,
  verifyPaymentActivationEvidence
} from './production-payment-activation-evidence.ts'

type RouteState = 'passed' | 'disabled' | 'activation_blocked' | 'failed'
type RouteName = PaymentActivationRoute

type RouteReadiness = {
  softwareImplemented: boolean
  activationConfigured: boolean
  externalTestVerified: boolean
  productionConfigured: boolean
  advertised: boolean
  state: RouteState
  blockingReasons: string[]
}

const truthy = (value: string | undefined) =>
  ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '')

let resolvedRuntimeValues = new Set<string>()
const missingValues = (names: string[]) =>
  names
    .filter((name) => !process.env[name]?.trim() && !resolvedRuntimeValues.has(name))
    .map((name) => `${name} is not configured.`)

const activationEvidence = async (
  envName: string,
  route: RouteName,
  expectedBindings: Record<string, string> = {}
) => verifyPaymentActivationEvidence({
  route,
  expectedBindings,
  ...(process.env[envName]?.trim() ? { path: process.env[envName]!.trim() } : {})
})

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

let runtimeConfig: ReturnType<typeof buildConfig>
let validationErrors: string[] = []
try {
  runtimeConfig = buildConfig(process.env)
  resolvedRuntimeValues = new Set([
    ...(runtimeConfig.databaseUrl ? ['DATABASE_URL'] : []),
    ...(runtimeConfig.apiKeyPepper ? ['API_KEY_PEPPER'] : []),
    ...(runtimeConfig.agentSessionSigningSecret ? ['AGENT_SESSION_SIGNING_SECRET'] : [])
  ])
  validationErrors = validateRuntimeConfig(runtimeConfig, process.env)
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
  process.exit()
}

let handlerSpecs: ReturnType<typeof parsePaymentHandlerSpecConfig> = []
const handlerConfigErrors: string[] = []
try {
  handlerSpecs = runtimeConfig.ucpPaymentHandlerSpecsJson
    ? parsePaymentHandlerSpecConfig(JSON.parse(runtimeConfig.ucpPaymentHandlerSpecsJson) as unknown)
    : []
} catch (error) {
  handlerConfigErrors.push(error instanceof Error ? error.message : 'Payment handler config is invalid.')
}

const isProductionRuntime = runtimeConfig.environment === 'production' &&
  runtimeConfig.publicBaseUrl.startsWith('https://') &&
  runtimeConfig.platformProfileUrl.startsWith('https://')
const requireLiveActivation = truthy(process.env.REQUIRE_LIVE_PAYMENT_ACTIVATION)
const routeErrors = (markers: string[]) => validationErrors.filter((error) =>
  markers.some((marker) => error.includes(marker))
)

const trustedHostAdvertised = runtimeConfig.autonomousPurchasesEnabled && runtimeConfig.primaryAutonomousRoute === 'trusted_host'
const trustedHostActivationErrors = [
  ...missingValues([
    'PAYMENTS_ENABLED',
    'PAYMENT_ACTION_SIGNING_SECRET',
    'PAYMENT_CREDENTIAL_ENCRYPTION_KEY',
    'DATABASE_URL',
    'REDIS_URL',
    'AUTONOMOUS_PURCHASES_ENABLED',
    'PRIMARY_AUTONOMOUS_ROUTE',
    'HOST_PAYMENT_CAPABILITIES_JSON',
    'HOST_PAYMENT_ATTESTATION_KEYS_JSON',
    'UCP_PAYMENT_HANDLER_SPECS_JSON',
    'PUBLIC_BASE_URL'
  ]),
  ...routeErrors(['trusted host', 'trusted_host', 'HOST_PAYMENT_CAPABILITIES_JSON', 'AUTONOMOUS_PURCHASES_ENABLED', 'PRIMARY_AUTONOMOUS_ROUTE'])
]
const trustedHostActivationConfigured = trustedHostAdvertised && trustedHostActivationErrors.length === 0
const trustedHostExternalVerified = await activationEvidence('TRUSTED_HOST_ACTIVATION_EVIDENCE_FILE', 'trusted_host')

const ap2Advertised = runtimeConfig.ap2RuntimeEnabled
const ap2ActivationErrors = [
  ...missingValues(['AP2_RUNTIME_ENABLED', 'AP2_TRUSTED_ISSUERS_JSON', 'PAYMENTS_ENABLED', 'DATABASE_URL', 'REDIS_URL', 'PAYMENT_ACTION_SIGNING_SECRET', 'PAYMENT_CREDENTIAL_ENCRYPTION_KEY']),
  ...routeErrors(['AP2_', 'AP2 ', 'PAYMENTS_ENABLED'])
]
const ap2ActivationConfigured = ap2Advertised && ap2ActivationErrors.length === 0
const ap2ExternalVerified = await activationEvidence('AP2_ACTIVATION_EVIDENCE_FILE', 'ap2')

const googleSpecs = handlerSpecs.filter((entry) => entry.adapterKind === 'google_pay')
const googleSpec = googleSpecs.length === 1 ? googleSpecs[0] : undefined
const googleNativeAdvertised = runtimeConfig.googlePayEnabled && Boolean(googleSpec)
const googleWebAdvertised = googleNativeAdvertised && runtimeConfig.googlePayWebEnabled
const googleNativeValidationErrors = routeErrors([
  'GOOGLE_PAY_ENABLED',
  'GOOGLE_PAY_ENVIRONMENT',
  'GOOGLE_PAY_PRODUCTION_',
  'com.google.pay',
  'Google Pay production',
  'google_pay'
]).filter((error) => !error.includes('GOOGLE_PAY_WEB_') && !error.includes('hosted Google Pay Web'))
const googleNativeActivationErrors = [
  ...missingValues([
    'GOOGLE_PAY_ENABLED',
    'PAYMENTS_ENABLED',
    'PAYMENT_ACTION_SIGNING_SECRET',
    'PAYMENT_CREDENTIAL_ENCRYPTION_KEY',
    'DATABASE_URL',
    'REDIS_URL',
    'UCP_PAYMENT_HANDLER_SPECS_JSON',
    'PUBLIC_BASE_URL',
    ...(runtimeConfig.googlePayEnvironment === 'PRODUCTION'
      ? [
          'GOOGLE_PAY_PRODUCTION_MERCHANT_ID',
          'GOOGLE_PAY_PRODUCTION_HANDLER_ID',
          'GOOGLE_PAY_PRODUCTION_PSP',
          'GOOGLE_PAY_PRODUCTION_APPROVAL_REFERENCE'
        ]
      : [])
  ]),
  ...googleNativeValidationErrors,
  ...(requireLiveActivation && isProductionRuntime && runtimeConfig.googlePayEnvironment !== 'PRODUCTION'
    ? ['GOOGLE_PAY_ENVIRONMENT must be PRODUCTION for production activation.']
    : [])
]
const googleNativeActivationConfigured = googleNativeAdvertised && googleNativeActivationErrors.length === 0
const googleEvidenceBindings = {
  surface: 'android_native',
  environment: runtimeConfig.googlePayEnvironment,
  handlerName: googleSpec?.handlerName ?? '',
  handlerVersion: googleSpec?.versions[0] ?? '',
  handlerId: process.env.GOOGLE_PAY_PRODUCTION_HANDLER_ID?.trim() ?? '',
  merchantId: process.env.GOOGLE_PAY_PRODUCTION_MERCHANT_ID?.trim() ?? '',
  psp: process.env.GOOGLE_PAY_PRODUCTION_PSP?.trim() ?? '',
  approvalReference: process.env.GOOGLE_PAY_PRODUCTION_APPROVAL_REFERENCE?.trim() ?? ''
}
const googleNativeExternalVerified = await activationEvidence(
  'GOOGLE_PAY_NATIVE_ACTIVATION_EVIDENCE_FILE',
  'google_pay_native',
  googleEvidenceBindings
)
const googleWebActivationErrors = [
  ...googleNativeActivationErrors,
  ...missingValues([
    'GOOGLE_PAY_WEB_ENABLED',
    'GOOGLE_PAY_WEB_ALLOWED_ORIGINS',
    ...(runtimeConfig.googlePayEnvironment === 'PRODUCTION'
      ? ['GOOGLE_PAY_WEB_PRODUCTION_REGISTERED_ORIGIN']
      : [])
  ]),
  ...routeErrors(['GOOGLE_PAY_WEB_', 'hosted Google Pay Web'])
]
const googleWebActivationConfigured = googleWebAdvertised && googleWebActivationErrors.length === 0
const googleWebExternalVerified = await activationEvidence(
  'GOOGLE_PAY_WEB_ACTIVATION_EVIDENCE_FILE',
  'google_pay_web',
  {
    ...googleEvidenceBindings,
    surface: 'arro_hosted_web',
    actionOrigin: process.env.GOOGLE_PAY_WEB_PRODUCTION_REGISTERED_ORIGIN?.trim() ?? ''
  }
)

const processorSpecs = handlerSpecs.filter((entry) => entry.adapterKind === 'processor_tokenizer')
const processorAdvertised = runtimeConfig.paymentsEnabled && runtimeConfig.processorTokenizerEnabled && processorSpecs.length > 0
const processorActivationErrors = [
  ...missingValues(['PAYMENTS_ENABLED', 'UCP_TOKENIZER_AUTH_JSON', 'UCP_PAYMENT_HANDLER_SPECS_JSON', 'DATABASE_URL', 'REDIS_URL']),
  ...routeErrors(['UCP_TOKENIZER_AUTH_JSON', 'Processor Tokenizer'])
]
const processorActivationConfigured = processorAdvertised && processorActivationErrors.length === 0
const processorExternalVerified = await activationEvidence('PROCESSOR_TOKENIZER_ACTIVATION_EVIDENCE_FILE', 'processor_tokenizer')

const optionalState = ({
  advertised,
  activationConfigured,
  externalTestVerified
}: {
  advertised: boolean
  activationConfigured: boolean
  externalTestVerified: boolean
}): RouteState => {
  if (!advertised) return 'disabled'
  if (!activationConfigured) return 'failed'
  if (requireLiveActivation && !externalTestVerified) return 'activation_blocked'
  return 'passed'
}

const blockingReasons = (advertised: boolean, reasons: string[]) =>
  advertised ? [...new Set(reasons)] : []

const matrix: Record<RouteName, RouteReadiness> = {
  trusted_host: {
    softwareImplemented: true,
    activationConfigured: trustedHostActivationConfigured,
    externalTestVerified: trustedHostExternalVerified,
    productionConfigured: isProductionRuntime && trustedHostActivationConfigured && trustedHostExternalVerified,
    advertised: trustedHostAdvertised,
    state: optionalState({
      advertised: trustedHostAdvertised,
      activationConfigured: trustedHostActivationConfigured,
      externalTestVerified: trustedHostExternalVerified
    }),
    blockingReasons: blockingReasons(trustedHostAdvertised, [
      ...trustedHostActivationErrors,
      ...(!trustedHostExternalVerified ? ['TRUSTED_HOST_ACTIVATION_EVIDENCE_FILE does not contain a passed merchant Order proof.'] : [])
    ])
  },
  ap2: {
    softwareImplemented: true,
    activationConfigured: ap2ActivationConfigured,
    externalTestVerified: ap2ExternalVerified,
    productionConfigured: isProductionRuntime && ap2ActivationConfigured && ap2ExternalVerified,
    advertised: ap2Advertised,
    state: optionalState({
      advertised: ap2Advertised,
      activationConfigured: ap2ActivationConfigured,
      externalTestVerified: ap2ExternalVerified
    }),
    blockingReasons: blockingReasons(ap2Advertised, [
      ...ap2ActivationErrors,
      ...(!ap2ExternalVerified
        ? ['AP2_ACTIVATION_EVIDENCE_FILE does not contain a passed merchant Order proof; it is required by the strict live activation gate.']
        : [])
    ])
  },
  google_pay_native: {
    softwareImplemented: true,
    activationConfigured: googleNativeActivationConfigured,
    externalTestVerified: googleNativeExternalVerified,
    productionConfigured: isProductionRuntime && runtimeConfig.googlePayEnvironment === 'PRODUCTION' && googleNativeActivationConfigured && googleNativeExternalVerified,
    advertised: googleNativeAdvertised,
    state: optionalState({ advertised: googleNativeAdvertised, activationConfigured: googleNativeActivationConfigured, externalTestVerified: googleNativeExternalVerified }),
    blockingReasons: blockingReasons(googleNativeAdvertised, [
      ...googleNativeActivationErrors,
      ...(!googleNativeExternalVerified
        ? ['GOOGLE_PAY_NATIVE_ACTIVATION_EVIDENCE_FILE does not contain an exactly bound passed native merchant Order proof.']
        : [])
    ])
  },
  google_pay_web: {
    softwareImplemented: true,
    activationConfigured: googleWebActivationConfigured,
    externalTestVerified: googleWebExternalVerified,
    productionConfigured: isProductionRuntime && runtimeConfig.googlePayEnvironment === 'PRODUCTION' && googleWebActivationConfigured && googleWebExternalVerified,
    advertised: googleWebAdvertised,
    state: optionalState({ advertised: googleWebAdvertised, activationConfigured: googleWebActivationConfigured, externalTestVerified: googleWebExternalVerified }),
    blockingReasons: blockingReasons(googleWebAdvertised, [
      ...googleWebActivationErrors,
      ...(!googleWebExternalVerified
        ? ['GOOGLE_PAY_WEB_ACTIVATION_EVIDENCE_FILE does not contain an exactly origin-bound passed hosted Web merchant Order proof.']
        : [])
    ])
  },
  processor_tokenizer: {
    softwareImplemented: true,
    activationConfigured: processorActivationConfigured,
    externalTestVerified: processorExternalVerified,
    productionConfigured: isProductionRuntime && processorActivationConfigured && processorExternalVerified,
    advertised: processorAdvertised,
    state: optionalState({ advertised: processorAdvertised, activationConfigured: processorActivationConfigured, externalTestVerified: processorExternalVerified }),
    blockingReasons: blockingReasons(processorAdvertised, [...processorActivationErrors, ...(!processorExternalVerified ? ['PROCESSOR_TOKENIZER_ACTIVATION_EVIDENCE_FILE does not contain a passed merchant Order proof.'] : [])])
  },
  merchant_hosted: {
    softwareImplemented: true,
    activationConfigured: true,
    externalTestVerified: true,
    productionConfigured: isProductionRuntime,
    advertised: true,
    state: 'passed',
    blockingReasons: []
  }
}

const advertisedFailures = Object.entries(matrix).flatMap(([name, readiness]) =>
  readiness.advertised && readiness.state !== 'passed'
    ? [`${name} is advertised but its state is ${readiness.state}.`]
    : []
)
const releaseFailures = [
  ...validationErrors,
  ...handlerConfigErrors,
  ...advertisedFailures,
  ...(matrix.merchant_hosted.state === 'passed' ? [] : ['merchant_hosted fallback is unavailable.'])
]
const productionPaymentLaunchReady = isProductionRuntime &&
  matrix.merchant_hosted.productionConfigured &&
  Object.values(matrix).every((route) => !route.advertised || (route.state === 'passed' && route.productionConfigured))

const releaseGatePassed = releaseFailures.length === 0

process.stdout.write(`${JSON.stringify({
  status: releaseGatePassed && (!requireLiveActivation || productionPaymentLaunchReady) ? 'passed' : 'failed',
  releaseGatePassed,
  productionPaymentLaunchReady,
  strictLiveActivationRequired: requireLiveActivation,
  runtimeValidationErrors: validationErrors,
  releaseFailures,
  matrix
}, null, 2)}\n`)

if (!releaseGatePassed || (requireLiveActivation && !productionPaymentLaunchReady)) process.exitCode = 1
