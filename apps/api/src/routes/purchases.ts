import { Type } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import type { AnyElysia } from 'elysia'
import { randomUUID } from 'node:crypto'
import {
  AgentInvocationContextSchema,
  AutonomousPurchaseJobCreateRequestSchema,
  CommerceBuyerProfileUpsertRequestSchema,
  PurchaseConfirmRequestSchema,
  PurchaseMandateAuthorizeRequestSchema,
  PurchaseMandateCreateRequestSchema,
  PurchaseMandateUpdateRequestSchema,
  PurchasePaymentActionCreateRequestSchema,
  PurchasePaymentActionResultRequestSchema,
  PurchasePrepareRequestSchema,
  PurchaseReviewUpdateRequestSchema,
  PurchaseUpdateRequestSchema,
  validationErrorSummary,
  type AgentActionScope,
  type AgentInvocationContext,
  type ApiError,
  type AutonomousPurchaseJobCreateRequest,
  type CommerceBuyerProfileUpsertRequest,
  type PurchaseMandateAuthorizeRequest,
  type PurchaseMandateCreateRequest,
  type PurchaseMandateUpdateRequest
} from '@arro/contracts'
import type { Authenticator } from '../auth.ts'
import { deriveCommercePrincipal, type CommercePrincipal } from '../commerce-principal.ts'
import type { PurchaseOrchestrator } from '../purchase-orchestrator.ts'
import {
  UcpCheckoutServiceError,
  type UcpCheckoutService
} from '../ucp-checkout-service.ts'
import {
  enforceContentLength,
  enforceJsonContentType
} from '../request-guards.ts'
import {
  PurchaseMandateError,
  buildPurchaseMandateAuthorization,
  draftPurchaseMandate,
  purchaseMandateAuthorizationHash,
  type PurchaseMandateRecord,
  type PurchaseMandateRepository
} from '../purchase-mandate.ts'
import {
  TrustedHostMandateAuthorizationError,
  type TrustedHostMandateAuthorizationVerifier
} from '../trusted-host-mandate-authorization.ts'
import {
  AutonomousPurchaseJobError,
  type AutonomousPurchaseJobRepository
} from '../autonomous-purchase-jobs.ts'
import {
  CommerceBuyerProfileError,
  type CommerceBuyerProfileStore
} from '../commerce-buyer-profile.ts'
import type { AgentHostRegistry, RegisteredAgentHost } from '../agent-host-registry.ts'
import {
  Ap2MandateError,
  verifyAp2OpenMandateAuthorization,
  type Ap2TrustedIssuer
} from '../ap2-mandate.ts'
import {
  PurchaseStepUpError,
  type PurchaseStepUpDecision,
  type PurchaseStepUpRepository
} from '../purchase-step-up.ts'
import { paymentActionTokenPrefix } from '../payment-actions.ts'

type PreparePurchaseInput = Parameters<PurchaseOrchestrator['preparePurchase']>[0]
type UpdatePurchaseInput = Parameters<PurchaseOrchestrator['updatePurchase']>[0]
type UpdatePurchaseReviewInput = Parameters<PurchaseOrchestrator['updatePurchaseReview']>[0]
type ConfirmPurchaseInput = Parameters<PurchaseOrchestrator['confirmPurchase']>[0]
type CancelPurchaseInput = Parameters<PurchaseOrchestrator['cancelPurchase']>[0]
type CreatePaymentActionInput = Parameters<PurchaseOrchestrator['createPaymentAction']>[0]
type PaymentActionResultInput = Parameters<PurchaseOrchestrator['recordPaymentActionResult']>[0]

type RegisterPurchaseRoutesOptions = {
  purchases?: PurchaseOrchestrator
  ucpCheckoutService?: UcpCheckoutService
  mandates?: PurchaseMandateRepository
  autonomousJobs?: AutonomousPurchaseJobRepository
  stepUps?: PurchaseStepUpRepository
  buyerProfiles?: CommerceBuyerProfileStore
  agentHostRegistry?: AgentHostRegistry
  autonomousPurchasesEnabled?: boolean
  primaryAutonomousRoute?: 'trusted_host'
  trustedHostMandateAuthorizationVerifier?: TrustedHostMandateAuthorizationVerifier | undefined
  ap2TrustedIssuers?: Ap2TrustedIssuer[] | undefined
  googlePayAllowedOrigins?: string[] | undefined
  embeddedCheckoutRuntimeEnabled?: boolean
  publicBaseUrl?: string | undefined
  authenticate: Authenticator
  agentSessionSigningSecret?: string | undefined
  hashPepper?: string | undefined
  apiError: (code: string, message: string, requestId: string) => ApiError
}

const PurchaseCancelRequestSchema = Type.Object(
  {
    reason: Type.Optional(Type.String({ minLength: 1, maxLength: 240 })),
    agentContext: Type.Optional(AgentInvocationContextSchema),
    idempotencyKey: Type.Optional(Type.String({ minLength: 8, maxLength: 160 }))
  },
  { additionalProperties: false }
)

const PurchaseStepUpDecisionRequestSchema = Type.Object(
  {
    decision: Type.Union([
      Type.Literal('approve'),
      Type.Literal('reject'),
      Type.Literal('challenge_satisfied')
    ]),
    evidence: Type.Optional(Type.Object(
      {
        trustedHostSignature: Type.Optional(Type.String({ minLength: 1 })),
        providerChallengeRef: Type.Optional(Type.String({ minLength: 1, maxLength: 256 }))
      },
      { additionalProperties: false }
    )),
    agentContext: Type.Optional(AgentInvocationContextSchema)
  },
  { additionalProperties: false }
)

const PurchaseAp2ReceiptsRequestSchema = Type.Object(
  {
    checkoutReceipt: Type.Optional(Type.String({ minLength: 1 })),
    paymentReceipt: Type.Optional(Type.String({ minLength: 1 })),
    agentContext: Type.Optional(AgentInvocationContextSchema)
  },
  { additionalProperties: false }
)

const PurchaseEmbeddedSessionRequestSchema = Type.Object(
  {
    allowedOrigin: Type.String({ minLength: 8, maxLength: 256 }),
    agentContext: Type.Optional(AgentInvocationContextSchema)
  },
  { additionalProperties: false }
)

const PurchaseEmbeddedMessageRequestSchema = Type.Object(
  {
    sessionToken: Type.String({ minLength: 32, maxLength: 20_000 }),
    message: Type.Unknown(),
    agentContext: Type.Optional(AgentInvocationContextSchema)
  },
  { additionalProperties: false }
)

const prepareValidator = TypeCompiler.Compile(PurchasePrepareRequestSchema)
const updateValidator = TypeCompiler.Compile(PurchaseUpdateRequestSchema)
const reviewUpdateValidator = TypeCompiler.Compile(PurchaseReviewUpdateRequestSchema)
const confirmValidator = TypeCompiler.Compile(PurchaseConfirmRequestSchema)
const cancelValidator = TypeCompiler.Compile(PurchaseCancelRequestSchema)
const paymentActionCreateValidator = TypeCompiler.Compile(PurchasePaymentActionCreateRequestSchema)
const paymentActionResultValidator = TypeCompiler.Compile(PurchasePaymentActionResultRequestSchema)
const mandateCreateValidator = TypeCompiler.Compile(PurchaseMandateCreateRequestSchema)
const mandateAuthorizeValidator = TypeCompiler.Compile(PurchaseMandateAuthorizeRequestSchema)
const mandateUpdateValidator = TypeCompiler.Compile(PurchaseMandateUpdateRequestSchema)
const buyerProfileUpsertValidator = TypeCompiler.Compile(CommerceBuyerProfileUpsertRequestSchema)
const autonomousJobCreateValidator = TypeCompiler.Compile(AutonomousPurchaseJobCreateRequestSchema)
const stepUpDecisionValidator = TypeCompiler.Compile(PurchaseStepUpDecisionRequestSchema)
const ap2ReceiptsValidator = TypeCompiler.Compile(PurchaseAp2ReceiptsRequestSchema)
const embeddedSessionValidator = TypeCompiler.Compile(PurchaseEmbeddedSessionRequestSchema)
const embeddedMessageValidator = TypeCompiler.Compile(PurchaseEmbeddedMessageRequestSchema)

type RouteValidator = {
  Check(value: unknown): boolean
  Errors(value: unknown): Iterable<{ path: string; message: string }>
}

const apiErrorWithDetails = (code: string, message: string, requestId: string, details?: unknown) => ({
  error: {
    code,
    message,
    requestId,
    ...(details !== undefined ? { details } : {})
  }
})

const requirePurchases = (purchases: PurchaseOrchestrator | undefined): PurchaseOrchestrator => {
  if (purchases) return purchases
  throw new UcpCheckoutServiceError(
    'ucp_runtime_store_required',
    'Purchase orchestration requires the UCP checkout runtime store.',
    503
  )
}

const requireMandates = (mandates: PurchaseMandateRepository | undefined): PurchaseMandateRepository => {
  if (mandates) return mandates
  throw new UcpCheckoutServiceError(
    'ucp_runtime_store_required',
    'Purchase mandate operations require PostgreSQL mandate persistence.',
    503
  )
}

const requireBuyerProfiles = (buyerProfiles: CommerceBuyerProfileStore | undefined): CommerceBuyerProfileStore => {
  if (buyerProfiles) return buyerProfiles
  throw new UcpCheckoutServiceError(
    'ucp_runtime_store_required',
    'Buyer profile operations require PostgreSQL buyer-profile persistence.',
    503
  )
}

const requireAutonomousJobs = (autonomousJobs: AutonomousPurchaseJobRepository | undefined): AutonomousPurchaseJobRepository => {
  if (autonomousJobs) return autonomousJobs
  throw new UcpCheckoutServiceError(
    'ucp_runtime_store_required',
    'Autonomous purchase jobs require PostgreSQL job persistence.',
    503
  )
}

const requireStepUps = (stepUps: PurchaseStepUpRepository | undefined): PurchaseStepUpRepository => {
  if (stepUps) return stepUps
  throw new UcpCheckoutServiceError(
    'ucp_runtime_store_required',
    'Conditional purchase step-up requires PostgreSQL action persistence.',
    503
  )
}

const bigintString = (value: string) => {
  try {
    return BigInt(value)
  } catch {
    return 0n
  }
}

const requireHostRouteCapability = ({
  route,
  mandateRecord,
  host
}: {
  route: 'trusted_host'
  mandateRecord: PurchaseMandateRecord
  host: RegisteredAgentHost
}) => {
  const { mandate, totalReservedMinor, totalCommittedMinor, useCount } = mandateRecord
  if (mandate.status !== 'active') {
    throw new AutonomousPurchaseJobError(
      'autonomous_job_invalid',
      'Autonomous jobs require an active, provider-authorized mandate.'
    )
  }
  if (new Date(mandate.expiresAt).getTime() <= Date.now()) {
    throw new AutonomousPurchaseJobError(
      'autonomous_job_invalid',
      'Autonomous jobs require a mandate that has not expired.'
    )
  }
  if (useCount >= mandate.financialPolicy.useLimit) {
    throw new AutonomousPurchaseJobError(
      'autonomous_job_invalid',
      'Autonomous jobs require remaining mandate uses.'
    )
  }
  const remainingBudget =
    bigintString(mandate.financialPolicy.maximumTotalSpendMinor) -
    bigintString(totalReservedMinor) -
    bigintString(totalCommittedMinor)
  if (remainingBudget <= 0n) {
    throw new AutonomousPurchaseJobError(
      'autonomous_job_invalid',
      'Autonomous jobs require remaining mandate budget.'
    )
  }
  if (!host.autonomousExecutionAllowed) {
    throw new AutonomousPurchaseJobError(
      'autonomous_job_invalid',
      'Registered host does not allow autonomous commerce execution.'
    )
  }
  if (!host.canReceiveAsyncPurchaseUpdates) {
    throw new AutonomousPurchaseJobError(
      'autonomous_job_invalid',
      'Registered host must support asynchronous purchase status updates for autonomous jobs.'
    )
  }
  if (!host.authorizationProviderKinds.includes(mandate.authorizationProvider)) {
    throw new AutonomousPurchaseJobError(
      'autonomous_job_invalid',
      'Registered host does not allow this mandate authorization provider.'
    )
  }
  if (route === 'trusted_host') {
    if (!['trusted_host_signature', 'ap2_trusted_surface'].includes(mandate.authorizationProvider)) {
      throw new AutonomousPurchaseJobError(
        'autonomous_job_invalid',
        'Trusted-host autonomous execution requires trusted-host signature authority or an AP2 trusted-surface mandate that the host is registered to execute.'
      )
    }
    if (!host.paymentProviderKinds.includes('trusted_host')) {
      throw new AutonomousPurchaseJobError(
        'autonomous_job_invalid',
        'Registered host does not expose trusted-host payment capability.'
      )
    }
  }
}

const requireAutonomousJobAuthority = async ({
  principal,
  mandateRecord,
  agentHostRegistry,
  autonomousPurchasesEnabled,
  primaryAutonomousRoute
}: {
  principal: CommercePrincipal
  mandateRecord: PurchaseMandateRecord
  agentHostRegistry: AgentHostRegistry | undefined
  autonomousPurchasesEnabled: boolean | undefined
  primaryAutonomousRoute: 'trusted_host' | undefined
}) => {
  if (!autonomousPurchasesEnabled) {
    throw new AutonomousPurchaseJobError(
      'autonomous_job_invalid',
      'Autonomous purchases are not enabled for this runtime.'
    )
  }
  if (!primaryAutonomousRoute) {
    throw new AutonomousPurchaseJobError(
      'autonomous_job_invalid',
      'Autonomous purchases require an explicit PRIMARY_AUTONOMOUS_ROUTE.'
    )
  }
  const host = await agentHostRegistry?.resolveRegistered({ principal })
  if (!host) {
    throw new AutonomousPurchaseJobError(
      'autonomous_job_invalid',
      'Autonomous jobs require a signed session from a registered trusted agent host.'
    )
  }
  requireHostRouteCapability({
    route: primaryAutonomousRoute,
    mandateRecord,
    host
  })
  return {
    authorizationRoute: primaryAutonomousRoute,
    hostId: host.hostId
  }
}

const handlePurchaseError = (error: unknown, set: { status?: number | string }, requestId: string) => {
  if (error instanceof UcpCheckoutServiceError) {
    set.status = error.status
    return apiErrorWithDetails(error.code, error.message, requestId, error.details)
  }

  if (error instanceof PurchaseMandateError) {
    set.status = error.code === 'mandate_not_found'
      ? 404
      : error.code === 'mandate_authorization_replayed'
        ? 409
        : 422
    return apiErrorWithDetails(error.code, error.message, requestId, error.details)
  }

  if (error instanceof CommerceBuyerProfileError) {
    set.status = error.code === 'buyer_profile_not_found' ? 404 : 422
    return apiErrorWithDetails(error.code, error.message, requestId)
  }

  if (error instanceof AutonomousPurchaseJobError) {
    set.status = error.code === 'autonomous_job_not_found'
      ? 404
      : error.code === 'autonomous_job_conflict'
        ? 409
        : 422
    return apiErrorWithDetails(error.code, error.message, requestId)
  }

  if (error instanceof PurchaseStepUpError) {
    set.status = error.code === 'step_up_not_found'
      ? 404
      : error.code === 'step_up_replayed' || error.code === 'step_up_expired'
        ? 409
        : 422
    return apiErrorWithDetails(error.code, error.message, requestId)
  }

  set.status = 500
  return apiErrorWithDetails('internal_error', 'Unexpected purchase orchestration error.', requestId)
}

const splitHeaderList = (value: string | null) =>
  value
    ?.split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)

const headerAgentContext = (
  request: Request,
  expectedScope: AgentActionScope
): AgentInvocationContext | undefined => {
  const integrationId = request.headers.get('x-arro-agent-integration-id')?.trim()
  const surface = request.headers.get('x-arro-agent-surface')?.trim()
  const sessionToken = request.headers.get('x-arro-agent-session-token')?.trim()
  if (!integrationId && !surface && !sessionToken) return undefined

  const context: AgentInvocationContext = {
    integrationId: integrationId ?? '',
    surface: (surface ?? '') as AgentInvocationContext['surface'],
    requestedActionScope: expectedScope
  }
  const externalSubjectRef = request.headers.get('x-arro-agent-external-subject-ref')?.trim()
  const externalTaskRef = request.headers.get('x-arro-agent-external-task-ref')?.trim()
  const sessionExpiresAt = request.headers.get('x-arro-agent-session-expires-at')?.trim()
  const hostCapabilities = splitHeaderList(request.headers.get('x-arro-agent-host-capabilities'))

  if (externalSubjectRef) context.externalSubjectRef = externalSubjectRef
  if (externalTaskRef) context.externalTaskRef = externalTaskRef
  if (sessionExpiresAt) context.sessionExpiresAt = sessionExpiresAt
  if (sessionToken) context.sessionToken = sessionToken
  if (hostCapabilities && hostCapabilities.length > 0) {
    context.hostCapabilities = hostCapabilities as NonNullable<AgentInvocationContext['hostCapabilities']>
  }

  return context
}

const recordAgentContext = (value: unknown): AgentInvocationContext | undefined => {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as { agentContext?: unknown }
    : {}
  return record.agentContext && typeof record.agentContext === 'object' && !Array.isArray(record.agentContext)
    ? record.agentContext as AgentInvocationContext
    : undefined
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const htmlEscape = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const scriptJson = (value: unknown) =>
  JSON.stringify(value).replace(/</g, '\\u003c')

const idempotencyKey = (request: Request) =>
  request.headers.get('idempotency-key')?.trim()

const headerRecord = (request: Request) =>
  Object.fromEntries([...request.headers.entries()].map(([name, value]) => [name.toLowerCase(), value]))

const requireIdempotencyKey = (
  request: Request,
  requestId: string,
  set: { status?: number | string }
) => {
  const key = idempotencyKey(request)
  if (key && key.length >= 8 && key.length <= 160) return key

  set.status = 422
  return apiErrorWithDetails(
    'idempotency_key_required',
    'An Idempotency-Key header is required for purchase mutations.',
    requestId
  )
}

const validatePurchaseId = (
  purchaseId: string,
  requestId: string,
  set: { status?: number | string }
) => {
  if (purchaseId.trim().length > 0 && purchaseId.length <= 256) return true
  set.status = 422
  return apiErrorWithDetails(
    'purchase_id_invalid',
    'The purchase id is missing or malformed.',
    requestId
  )
}

const validateActionToken = (
  actionToken: string,
  requestId: string,
  set: { status?: number | string }
) => {
  if (actionToken.trim().startsWith(paymentActionTokenPrefix) && actionToken.length <= 4096) return true
  set.status = 422
  return apiErrorWithDetails(
    'payment_action_token_invalid',
    'The payment action token is missing or malformed.',
    requestId
  )
}

const authorize = async ({
  request,
  requestId,
  set,
  authenticate,
  requiredScope,
  agentContext,
  agentSessionSigningSecret,
  hashPepper,
  apiError
}: {
  request: Request
  requestId: string
  set: { status?: number | string }
  authenticate: Authenticator
  requiredScope: AgentActionScope
  agentContext?: AgentInvocationContext | undefined
  agentSessionSigningSecret?: string | undefined
  hashPepper?: string | undefined
  apiError: (code: string, message: string, requestId: string) => ApiError
}): Promise<
  | { ok: true; principal: CommercePrincipal }
  | { ok: false; body: ApiError }
> => {
  const authResult = await authenticate({
    request,
    requestId,
    requiredScopes: [requiredScope]
  })

  if (!authResult.ok) {
    set.status = authResult.status
    return { ok: false, body: authResult.body }
  }

  const principal = deriveCommercePrincipal({
    authPrincipal: authResult.principal,
    agentContext,
    expectedScope: requiredScope,
    signingSecret: agentSessionSigningSecret,
    hashPepper,
    requestId,
    apiError
  })

  if (!principal.ok) {
    set.status = principal.error.status
    return { ok: false, body: principal.error.body }
  }

  return { ok: true, principal: principal.principal }
}

const bodyGuard = (
  request: Request,
  requestId: string,
  set: { status?: number | string },
  requireJson: boolean
) => {
  const contentLengthRejection = enforceContentLength(request, requestId)
  if (contentLengthRejection) {
    set.status = contentLengthRejection.status
    return contentLengthRejection.body
  }

  if (!requireJson) return undefined

  const contentTypeRejection = enforceJsonContentType(request, requestId)
  if (contentTypeRejection) {
    set.status = contentTypeRejection.status
    return contentTypeRejection.body
  }

  return undefined
}

const validateBody = (
  validator: RouteValidator,
  body: unknown,
  toolName: string,
  requestId: string,
  set: { status?: number | string }
) => {
  if (validator.Check(body)) return undefined
  set.status = 422
  return apiErrorWithDetails(
    'validation_failed',
    `${toolName} request did not match the purchase contract.`,
    requestId,
    validationErrorSummary(validator, body)
  )
}

export const registerPurchaseRoutes = (
  app: AnyElysia,
  {
    purchases,
    ucpCheckoutService,
    mandates,
    autonomousJobs,
    stepUps,
    buyerProfiles,
    agentHostRegistry,
    autonomousPurchasesEnabled,
    primaryAutonomousRoute,
    trustedHostMandateAuthorizationVerifier,
    ap2TrustedIssuers = [],
    googlePayAllowedOrigins = [],
    embeddedCheckoutRuntimeEnabled = false,
    publicBaseUrl,
    authenticate,
    agentSessionSigningSecret,
    hashPepper,
    apiError
  }: RegisterPurchaseRoutesOptions
) => {
  app
    .get('/v1/buyer-profile', async ({ request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'read:purchase',
          agentContext: headerAgentContext(request, 'read:purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        return call(set, requestId, async () => {
          const profile = await requireBuyerProfiles(buyerProfiles).read(auth.principal)
          if (!profile) {
            throw new CommerceBuyerProfileError(
              'buyer_profile_not_found',
              'No buyer profile is saved for this owner.'
            )
          }
          return profile
        })
      })
    )
    .put('/v1/buyer-profile', async ({ body, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'write:purchase',
          agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        const validation = validateBody(buyerProfileUpsertValidator, body, 'upsert_buyer_profile', requestId, set)
        if (validation) return validation
        return call(set, requestId, () =>
          requireBuyerProfiles(buyerProfiles).upsert({
            principal: auth.principal,
            profile: body as CommerceBuyerProfileUpsertRequest
          })
        )
      })
    )
    .post('/v1/purchase-mandates', async ({ body, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'write:complete_purchase',
          agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:complete_purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        const validation = validateBody(mandateCreateValidator, body, 'create_purchase_mandate', requestId, set)
        if (validation) return validation
        return call(set, requestId, async () => {
          const input = body as PurchaseMandateCreateRequest
          const mandate = draftPurchaseMandate({
            principal: auth.principal,
            intentDescription: input.intentDescription,
            merchantOrigin: input.merchantOrigin,
            ...(input.productId ? { productId: input.productId } : {}),
            ...(input.variantId ? { variantId: input.variantId } : {}),
            ...(input.intendedQuantity ? { intendedQuantity: input.intendedQuantity } : {}),
            currency: input.currency,
            maximumPerTransactionMinor: input.maximumPerTransactionMinor,
            maximumTotalSpendMinor: input.maximumTotalSpendMinor,
            ...(input.useLimit ? { useLimit: input.useLimit } : {}),
            expiresAt: input.expiresAt,
            authorizationProvider: input.authorizationProvider ?? 'user_approval_action'
          })
          const repo = requireMandates(mandates)
          await repo.createDraft(mandate, auth.principal)
          const providerContext = {
            route: mandate.authorizationProvider,
            integrationId: auth.principal.integrationId,
            agentSessionId: auth.principal.agentSessionId
          }
          const authorizationHash = purchaseMandateAuthorizationHash({ mandate, providerContext })
          const actionExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
          const action = await repo.createAuthorizationAction({
            mandate,
            principal: auth.principal,
            authorizationHash,
            mode: mandate.authorizationProvider,
            expiresAt: actionExpiresAt
          })
          return {
            mandate,
            authorizationHash,
            approvalAction: {
              actionId: action.actionId,
              mode: action.mode,
              expiresAt: action.expiresAt,
              instruction: 'Authorize this exact mandate hash through a configured user-presence provider. The agent session cannot self-authorize standing spend.'
            }
          }
        })
      })
    )
    .get('/v1/purchase-mandates/:mandateId/jobs', async ({ params, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'read:purchase',
          agentContext: headerAgentContext(request, 'read:purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        return call(set, requestId, () =>
          requireAutonomousJobs(autonomousJobs).listForMandate({
            principal: auth.principal,
            mandateId: params.mandateId
          })
        )
      })
    )
    .post('/v1/purchase-mandates/:mandateId/jobs', async ({ params, body, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'write:complete_purchase',
          agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:complete_purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        const validation = validateBody(autonomousJobCreateValidator, body, 'create_autonomous_purchase_job', requestId, set)
        if (validation) return validation
        return call(set, requestId, async () => {
          const mandateRecord = await requireMandates(mandates).read(params.mandateId, auth.principal)
          if (!mandateRecord) throw new PurchaseMandateError('mandate_not_found', 'Purchase mandate was not found.')
          const input = body as AutonomousPurchaseJobCreateRequest
          const authority = await requireAutonomousJobAuthority({
            principal: auth.principal,
            mandateRecord,
            agentHostRegistry,
            autonomousPurchasesEnabled,
            primaryAutonomousRoute
          })
          return requireAutonomousJobs(autonomousJobs).create({
            principal: auth.principal,
            mandate: mandateRecord.mandate,
            trigger: input.trigger,
            authorizationRoute: authority.authorizationRoute,
            hostId: authority.hostId
          })
        })
      })
    )
    .post('/v1/purchase-mandates/:mandateId/jobs/:jobId/cancel', async ({ params, body, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'write:complete_purchase',
          agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:complete_purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        const validation = validateBody(cancelValidator, body, 'cancel_autonomous_purchase_job', requestId, set)
        if (validation) return validation
        return call(set, requestId, () =>
          requireAutonomousJobs(autonomousJobs).cancelJob({
            principal: auth.principal,
            mandateId: params.mandateId,
            jobId: params.jobId
          })
        )
      })
    )
    .get('/v1/purchases/:purchaseId/step-up/:actionId', async ({ params, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'read:purchase',
          agentContext: headerAgentContext(request, 'read:purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        return call(set, requestId, async () => {
          const action = await requireStepUps(stepUps).read({
            principal: auth.principal,
            purchaseId: params.purchaseId,
            actionId: params.actionId
          })
          if (!action) throw new PurchaseStepUpError('step_up_not_found', 'Purchase step-up action was not found.')
          return action
        })
      })
    )
    .post('/v1/purchases/:purchaseId/step-up/:actionId/decision', async ({ params, body, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'write:complete_purchase',
          agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:complete_purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        const validation = validateBody(stepUpDecisionValidator, body, 'decide_purchase_step_up', requestId, set)
        if (validation) return validation
        return call(set, requestId, async () => {
          const repository = requireStepUps(stepUps)
          const action = await repository.read({
            principal: auth.principal,
            purchaseId: params.purchaseId,
            actionId: params.actionId
          })
          if (!action) throw new PurchaseStepUpError('step_up_not_found', 'Purchase step-up action was not found.')
          if (action.status !== 'pending') throw new PurchaseStepUpError('step_up_replayed', 'Purchase step-up action has already been decided or invalidated.')

          const purchase = await requirePurchases(purchases).getPurchase(params.purchaseId, auth.principal)
          if (!purchase.checkoutSnapshotHash || purchase.checkoutSnapshotHash !== action.checkoutSnapshotHash) {
            await repository.invalidateForPurchase({ purchaseId: params.purchaseId, reason: 'checkout_changed' })
            throw new PurchaseStepUpError(
              'step_up_invalid',
              'Merchant checkout changed after this step-up was issued. Refresh and review the new total before deciding.'
            )
          }

          const input = body as {
            decision: PurchaseStepUpDecision
            evidence?: { trustedHostSignature?: string; providerChallengeRef?: string }
          }
          let decisionRef = `rejected:${requestId}`
          if (input.decision !== 'reject') {
            const signature = input.evidence?.trustedHostSignature?.trim()
            if (!signature || !trustedHostMandateAuthorizationVerifier?.verifyStepUp) {
              throw new PurchaseStepUpError(
                'step_up_invalid',
                'Approval requires a configured trusted-host user-presence signature bound to this exact step-up action.'
              )
            }
            if (input.decision === 'challenge_satisfied' && !input.evidence?.providerChallengeRef) {
              throw new PurchaseStepUpError(
                'step_up_invalid',
                'Provider challenge completion requires an opaque provider challenge reference.'
              )
            }
            try {
              decisionRef = trustedHostMandateAuthorizationVerifier.verifyStepUp({
                attestation: signature,
                principal: auth.principal,
                action,
                decision: input.decision
              })
            } catch (error) {
              if (error instanceof TrustedHostMandateAuthorizationError) {
                throw new PurchaseStepUpError('step_up_invalid', error.message)
              }
              throw error
            }
          }

          const decided = await repository.decide({
            principal: auth.principal,
            purchaseId: params.purchaseId,
            actionId: params.actionId,
            decision: input.decision,
            decisionRef,
            ...(input.evidence?.providerChallengeRef ? { providerChallengeRef: input.evidence.providerChallengeRef } : {})
          })
          const job = input.decision === 'reject'
            ? await requireAutonomousJobs(autonomousJobs).cancelJob({
                principal: auth.principal,
                mandateId: action.mandateId,
                jobId: action.jobId
              })
            : await requireAutonomousJobs(autonomousJobs).resumeAfterStepUp({
                principal: auth.principal,
                jobId: action.jobId,
                purchaseId: action.purchaseId
              })
          return { action: decided, job }
        })
      })
    )
    .get('/v1/purchase-mandates/:mandateId', async ({ params, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'read:purchase',
          agentContext: headerAgentContext(request, 'read:purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        return call(set, requestId, async () => {
          const mandate = await requireMandates(mandates).read(params.mandateId, auth.principal)
          if (!mandate) throw new PurchaseMandateError('mandate_not_found', 'Purchase mandate was not found.')
          return mandate
        })
      })
    )
    .post('/v1/purchase-mandates/:mandateId/authorize', async ({ params, body, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'write:complete_purchase',
          agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:complete_purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        const validation = validateBody(mandateAuthorizeValidator, body, 'authorize_purchase_mandate', requestId, set)
        if (validation) return validation
        return call(set, requestId, async () => {
          const input = body as PurchaseMandateAuthorizeRequest
          if (input.mode === 'user_approval_action') {
            throw new PurchaseMandateError(
              'mandate_authorization_required',
              'user_approval_action is allowed only after a real browser/host user-presence ceremony is configured. Agent-held bearer tokens cannot authorize standing spend.'
            )
          }
          if (!['trusted_host_signature', 'ap2_trusted_surface'].includes(input.mode)) {
            throw new PurchaseMandateError(
              'mandate_authorization_required',
              `${input.mode} mandate authorization is activation_blocked until its exact provider verifier is configured.`
            )
          }
          const repo = requireMandates(mandates)
          const record = await repo.read(params.mandateId, auth.principal)
          if (!record) throw new PurchaseMandateError('mandate_not_found', 'Purchase mandate was not found.')
          const approvalActionId = stringValue(input.approvalActionId)
          const evidence = asRecord(input.evidence)
          const trustedHostSignature = stringValue(evidence.trustedHostSignature) ?? stringValue(evidence.attestation)
          if (!approvalActionId) {
            throw new PurchaseMandateError(
              'mandate_authorization_required',
              'Mandate authorization requires the exact consume-once approvalActionId.'
            )
          }
          const action = await repo.readAuthorizationAction({
            actionId: approvalActionId,
            mandateId: params.mandateId,
            principal: auth.principal
          })
          if (!action || action.mandateId !== record.mandate.mandateId || action.mandateVersion !== record.mandate.version || action.mode !== input.mode) {
            throw new PurchaseMandateError(
              'mandate_authorization_invalid',
              'Mandate approval action does not match the current owner, integration, mandate, version, or mode.'
            )
          }
          if (action.status !== 'pending' || new Date(action.expiresAt).getTime() <= Date.now()) {
            throw new PurchaseMandateError(
              'mandate_authorization_replayed',
              'Mandate approval action has already been consumed, revoked, or expired.'
            )
          }
          let externalReference = action.actionId
          if (input.mode === 'trusted_host_signature') {
            if (!trustedHostSignature || !trustedHostMandateAuthorizationVerifier) {
              throw new PurchaseMandateError(
                'mandate_authorization_required',
                'trusted_host_signature mandate authorization requires a configured signed user-presence attestation.'
              )
            }
            try {
              trustedHostMandateAuthorizationVerifier.verify({
                attestation: trustedHostSignature,
                principal: auth.principal,
                mandate: record.mandate,
                action
              })
            } catch (error) {
              if (error instanceof TrustedHostMandateAuthorizationError) {
                throw new PurchaseMandateError('mandate_authorization_invalid', error.message)
              }
              throw error
            }
          } else if (input.mode === 'ap2_trusted_surface') {
            const checkoutMandate = stringValue(evidence.checkoutMandate)
            const paymentMandate = stringValue(evidence.paymentMandate)
            if (!checkoutMandate || !paymentMandate || ap2TrustedIssuers.length === 0) {
              throw new PurchaseMandateError(
                'mandate_authorization_required',
                'ap2_trusted_surface requires configured trusted issuers and exact open Checkout and Payment Mandates.'
              )
            }
            try {
              const verified = verifyAp2OpenMandateAuthorization({
                checkoutMandate,
                paymentMandate,
                mandate: record.mandate,
                trustedIssuers: ap2TrustedIssuers
              })
              externalReference = `${verified.checkoutMandateReference}:${verified.paymentMandateReference}`
            } catch (error) {
              if (error instanceof Ap2MandateError) {
                throw new PurchaseMandateError('mandate_authorization_invalid', error.message, error.details)
              }
              throw error
            }
          }
          const providerContext = input.providerContext ?? {
            route: input.mode,
            integrationId: auth.principal.integrationId,
            agentSessionId: auth.principal.agentSessionId
          }
          const authorization = buildPurchaseMandateAuthorization({
            mandate: record.mandate,
            mode: input.mode,
            issuer: auth.principal.integrationId,
            subject: auth.principal.ownerPrincipalHash,
            evidence: {
              approvalActionId,
              ...(input.evidence ? { evidence: input.evidence } : {})
            },
            providerContext,
            externalReference
          })
          if (authorization.authorizationHash !== action.authorizationHash) {
            throw new PurchaseMandateError(
              'mandate_authorization_invalid',
              'Mandate authorization hash does not match the issued approval action.'
            )
          }
          const mandate = await repo.authorize({
            mandateId: params.mandateId,
            principal: auth.principal,
            actionId: action.actionId,
            authorization
          })
          return {
            mandate,
            authorizationHash: authorization.authorizationHash
          }
        })
      })
    )
    .patch('/v1/purchase-mandates/:mandateId', async ({ params, body, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'write:complete_purchase',
          agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:complete_purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        const validation = validateBody(mandateUpdateValidator, body, 'update_purchase_mandate', requestId, set)
        if (validation) return validation
        return call(set, requestId, async () => {
          const input = body as PurchaseMandateUpdateRequest
          if (input.status !== 'revoked') {
            throw new PurchaseMandateError('mandate_invalid', 'Only mandate revocation is supported in the active purchase route.')
          }
          const repository = requireMandates(mandates)
          await repository.revoke(params.mandateId, auth.principal)
          const cancelledAutonomousJobs = autonomousJobs
            ? await autonomousJobs.cancelForMandate({
                principal: auth.principal,
                mandateId: params.mandateId
              })
            : 0
          return { mandateId: params.mandateId, status: 'revoked', cancelledAutonomousJobs }
        })
      })
    )
    .post('/v1/purchases/prepare', async ({ body, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'write:purchase',
          agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        const validation = validateBody(prepareValidator, body, 'prepare_purchase', requestId, set)
        if (validation) return validation
        const key = requireIdempotencyKey(request, requestId, set)
        if (typeof key !== 'string') return key
        return call(set, requestId, () =>
          requirePurchases(purchases).preparePurchase({
            ...(body as PreparePurchaseInput),
            idempotencyKey: key,
            principal: auth.principal
          })
        )
      })
    )
    .get('/v1/purchases/:purchaseId', async ({ params, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'read:purchase',
          agentContext: headerAgentContext(request, 'read:purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        const invalidId = validatePurchaseId(params.purchaseId, requestId, set)
        if (invalidId !== true) return invalidId
        return call(set, requestId, () =>
          requirePurchases(purchases).getPurchase(params.purchaseId, auth.principal)
        )
      })
    )
    .patch('/v1/purchases/:purchaseId', async ({ params, body, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'write:purchase',
          agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        const invalidId = validatePurchaseId(params.purchaseId, requestId, set)
        if (invalidId !== true) return invalidId
        const validation = validateBody(updateValidator, body, 'update_purchase', requestId, set)
        if (validation) return validation
        const key = requireIdempotencyKey(request, requestId, set)
        if (typeof key !== 'string') return key
        return call(set, requestId, () =>
          requirePurchases(purchases).updatePurchase({
            id: params.purchaseId,
            ...(body as Omit<UpdatePurchaseInput, 'id'>),
            idempotencyKey: key,
            principal: auth.principal
          } as UpdatePurchaseInput)
        )
      })
    )
    .patch('/v1/purchases/:purchaseId/review', async ({ params, body, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'write:purchase',
          agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        const invalidId = validatePurchaseId(params.purchaseId, requestId, set)
        if (invalidId !== true) return invalidId
        const validation = validateBody(reviewUpdateValidator, body, 'update_purchase_review', requestId, set)
        if (validation) return validation
        const key = requireIdempotencyKey(request, requestId, set)
        if (typeof key !== 'string') return key
        return call(set, requestId, () =>
          requirePurchases(purchases).updatePurchaseReview({
            id: params.purchaseId,
            ...(body as Omit<UpdatePurchaseReviewInput, 'id'>),
            idempotencyKey: key,
            principal: auth.principal
          } as UpdatePurchaseReviewInput)
        )
      })
    )
    .post('/v1/purchases/:purchaseId/payment-actions', async ({ params, body, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'write:purchase',
          agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        const invalidId = validatePurchaseId(params.purchaseId, requestId, set)
        if (invalidId !== true) return invalidId
        const validation = validateBody(paymentActionCreateValidator, body, 'purchase_payment_action', requestId, set)
        if (validation) return validation
        const key = requireIdempotencyKey(request, requestId, set)
        if (typeof key !== 'string') return key
        return call(set, requestId, () =>
          requirePurchases(purchases).createPaymentAction({
            id: params.purchaseId,
            ...(body as Omit<CreatePaymentActionInput, 'id'>),
            idempotencyKey: key,
            principal: auth.principal
          } as CreatePaymentActionInput)
        )
      })
    )
    .get('/v1/payment-actions/:signedActionToken', async ({ params, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const invalidId = validateActionToken(params.signedActionToken, requestId, set)
        if (invalidId !== true) return invalidId
        const response = await call(set, requestId, () =>
          requirePurchases(purchases).getPaymentAction(params.signedActionToken)
        )
        const accept = request.headers.get('accept')?.toLowerCase() ?? ''
        if (!accept.includes('text/html') || !response || typeof response !== 'object' || 'error' in response) {
          return response
        }
        const action = asRecord(response)
        const title = htmlEscape(stringValue(action.provider) ?? 'Payment action')
        const message = htmlEscape(stringValue(action.message) ?? 'Approve this payment action in your provider or host.')
        const token = htmlEscape(params.signedActionToken)
        const scriptNonce = randomUUID().replace(/-/g, '')
        const actionPayload = scriptJson(action)
        const actionKind = stringValue(asRecord(action.action).kind)
        if (actionKind === 'google_pay') {
          const configuredActionOrigin = publicBaseUrl ? new URL(publicBaseUrl).origin : undefined
          if (!configuredActionOrigin || !googlePayAllowedOrigins.includes(configuredActionOrigin)) {
            set.status = 503
            return apiErrorWithDetails(
              'ucp_payment_action_unavailable',
              'Arro Google Pay Web is not enabled for this action origin.',
              requestId
            )
          }
        }
        set.headers['content-type'] = 'text/html; charset=utf-8'
        set.headers['cache-control'] = 'no-store'
        set.headers['referrer-policy'] = 'no-referrer'
        set.headers['content-security-policy'] = [
          "default-src 'none'",
          `script-src 'nonce-${scriptNonce}' https://pay.google.com`,
          "connect-src 'self'",
          "frame-src https://pay.google.com",
          "img-src https://www.gstatic.com https://*.gstatic.com data:",
          "style-src 'unsafe-inline'",
          "base-uri 'none'",
          "form-action 'none'",
          "frame-ancestors 'none'"
        ].join('; ')
        const googlePayHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Arro Google Pay action</title>
    <script nonce="${scriptNonce}" src="https://pay.google.com/gp/p/js/pay.js" async></script>
  </head>
  <body>
    <main>
      <h1>Arro Google Pay action</h1>
      <p>${message}</p>
      <p id="arro-google-pay-status">Waiting for Google Pay readiness.</p>
      <div id="arro-google-pay-button"></div>
    </main>
    <script nonce="${scriptNonce}">
      const paymentAction = ${actionPayload};
      const actionConfig = paymentAction.action || {};
      const paymentRequest = actionConfig.paymentRequest || {};
      const allowedPaymentMethods = paymentRequest.allowedPaymentMethods;
      const environment = paymentRequest.environment;
      const transactionInfo = paymentRequest.transactionInfo;
      const statusNode = document.getElementById('arro-google-pay-status');
      const resultUrl = '/v1/payment-actions/${token}/result';

      function baseRequest() {
        return {
          apiVersion: paymentRequest.apiVersion,
          apiVersionMinor: paymentRequest.apiVersionMinor
        };
      }

      function paymentDataRequest() {
        if (!transactionInfo || transactionInfo.totalPriceStatus !== 'FINAL') {
          throw new Error('Signed Google Pay transaction information is unavailable.');
        }
        return {
          ...baseRequest(),
          allowedPaymentMethods,
          transactionInfo,
          merchantInfo: paymentRequest.merchantInfo
        };
      }

      let submitted = false;
      async function submitPaymentData(paymentData) {
        if (submitted) return;
        submitted = true;
        const response = await fetch(resultUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': paymentAction.actionId + ':google-pay-web-result'
          },
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          body: JSON.stringify({
            idempotencyKey: paymentAction.actionId + ':google-pay-web-result',
            result: {
              type: 'google_pay_payment_data',
              source: 'web',
              paymentData
            }
          })
        });
        if (!response.ok) {
          statusNode.textContent = 'Google Pay data was received but Arro could not bind it to this checkout action.';
          return;
        }
        statusNode.textContent = 'Google Pay data was bound to this checkout. Return to your agent to confirm the current merchant checkout.';
      }

      function onGooglePayLoaded() {
        if (!window.google || !google.payments || !google.payments.api) {
          statusNode.textContent = 'Google Pay client did not load.';
          return;
        }
        const paymentsClient = new google.payments.api.PaymentsClient({ environment });
        paymentsClient.isReadyToPay({ ...baseRequest(), allowedPaymentMethods })
          .then((ready) => {
            if (!ready.result) {
              statusNode.textContent = 'Google Pay is not ready on this browser/device. Continue on the merchant checkout instead.';
              return;
            }
            const button = paymentsClient.createButton({
              allowedPaymentMethods,
              onClick: () => {
                paymentsClient.loadPaymentData(paymentDataRequest())
                  .then(submitPaymentData)
                  .catch(() => {
                    statusNode.textContent = 'Google Pay was canceled or failed before payment data was returned.';
                  });
              }
            });
            document.getElementById('arro-google-pay-button').appendChild(button);
            statusNode.textContent = 'Google Pay is ready. Use the official button to continue.';
          })
          .catch(() => {
            statusNode.textContent = 'Google Pay readiness check failed.';
          });
      }

      window.addEventListener('load', onGooglePayLoaded);
    </script>
  </body>
</html>`
        if (actionKind === 'google_pay') {
          return googlePayHtml
        }
        return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Arro payment action</title>
  </head>
  <body>
    <main>
      <h1>Arro payment action: ${title}</h1>
      <p>${message}</p>
      <p>This page never stores reusable credentials. The merchant checkout and order remain the completion source of truth.</p>
      <pre id="payment-action-token">${token}</pre>
    </main>
  </body>
</html>`
      })
    )
    .post('/v1/payment-actions/:signedActionToken/session', async ({ params, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, false)
        if (guard) return guard
        const invalidId = validateActionToken(params.signedActionToken, requestId, set)
        if (invalidId !== true) return invalidId
        set.headers['cache-control'] = 'no-store'
        return call(set, requestId, () =>
          requirePurchases(purchases).createPaymentActionSession(params.signedActionToken)
        )
      })
    )
    .post('/v1/payment-actions/:signedActionToken/result', async ({ params, body, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const invalidId = validateActionToken(params.signedActionToken, requestId, set)
        if (invalidId !== true) return invalidId
        const validation = validateBody(paymentActionResultValidator, body, 'payment_action_result', requestId, set)
        if (validation) return validation
        const resultType = stringValue(asRecord(asRecord(body).result).type)
        if (resultType === 'google_pay_payment_data') {
          const resultSource = stringValue(asRecord(asRecord(body).result).source)
          const actionResponse = await call(set, requestId, () =>
            requirePurchases(purchases).getPaymentAction(params.signedActionToken)
          )
          if (
            !actionResponse ||
            typeof actionResponse !== 'object' ||
            'error' in actionResponse
          ) {
            return actionResponse
          }
          const presentation = stringValue(asRecord(actionResponse).presentation)
          if (resultSource === 'native' && presentation !== 'host_native') {
            set.status = 403
            return apiErrorWithDetails(
              'ucp_payment_action_invalid',
              'Native Google Pay result does not match the signed action presentation.',
              requestId
            )
          }
          if (resultSource === 'web') {
            if (presentation !== 'external_action' && presentation !== 'embedded_component') {
              set.status = 403
              return apiErrorWithDetails(
                'ucp_payment_action_invalid',
                'Web Google Pay result does not match the signed action presentation.',
                requestId
              )
            }
            const origin = request.headers.get('origin')?.trim()
            const configuredActionOrigin = publicBaseUrl ? new URL(publicBaseUrl).origin : undefined
            if (!origin || !configuredActionOrigin || origin !== configuredActionOrigin || !googlePayAllowedOrigins.includes(origin)) {
              set.status = 403
              return apiErrorWithDetails(
                'ucp_payment_action_invalid',
                'Google Pay Web result origin does not match the configured signed action origin.',
                requestId
              )
            }
          }
        }
        const key = requireIdempotencyKey(request, requestId, set)
        if (typeof key !== 'string') return key
        return call(set, requestId, () =>
          requirePurchases(purchases).recordPaymentActionResult({
            actionToken: params.signedActionToken,
            ...(body as Omit<PaymentActionResultInput, 'actionToken'>),
            idempotencyKey: key
          } as PaymentActionResultInput)
        )
      })
    )
    .get('/v1/payment-actions/:signedActionToken/status', async ({ params, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const invalidId = validateActionToken(params.signedActionToken, requestId, set)
        if (invalidId !== true) return invalidId
        return call(set, requestId, () =>
          requirePurchases(purchases).getPaymentAction(params.signedActionToken)
        )
      })
    )
    .post('/v1/purchases/:purchaseId/confirm', async ({ params, body, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'write:complete_purchase',
          agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:complete_purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        const invalidId = validatePurchaseId(params.purchaseId, requestId, set)
        if (invalidId !== true) return invalidId
        const validation = validateBody(confirmValidator, body, 'confirm_purchase', requestId, set)
        if (validation) return validation
        const key = requireIdempotencyKey(request, requestId, set)
        if (typeof key !== 'string') return key
        return call(set, requestId, () =>
          requirePurchases(purchases).confirmPurchase({
            id: params.purchaseId,
            ...(body as Omit<ConfirmPurchaseInput, 'id'>),
            idempotencyKey: key,
            principal: auth.principal
          } as ConfirmPurchaseInput)
        )
      })
    )
    .post('/v1/purchases/:purchaseId/ap2-receipts', async ({ params, body, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'write:complete_purchase',
          agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:complete_purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        const validation = validateBody(ap2ReceiptsValidator, body, 'record_ap2_receipts', requestId, set)
        if (validation) return validation
        const input = body as {
          checkoutReceipt?: string
          paymentReceipt?: string
        }
        return call(set, requestId, () => {
          if (!ucpCheckoutService) {
            throw new UcpCheckoutServiceError(
              'ucp_runtime_store_required',
              'AP2 receipt recording requires the UCP checkout runtime store.',
              503
            )
          }
          return ucpCheckoutService.recordAp2Receipts(params.purchaseId, {
            principal: auth.principal,
            ...(input.checkoutReceipt ? { checkoutReceipt: input.checkoutReceipt } : {}),
            ...(input.paymentReceipt ? { paymentReceipt: input.paymentReceipt } : {})
          })
        })
      })
    )
    .post('/v1/purchases/:purchaseId/cancel', async ({ params, body, request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const auth = await authorize({
          request,
          requestId,
          set,
          authenticate,
          requiredScope: 'write:purchase',
          agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:purchase'),
          agentSessionSigningSecret,
          hashPepper,
          apiError
        })
        if (!auth.ok) return auth.body
        const invalidId = validatePurchaseId(params.purchaseId, requestId, set)
        if (invalidId !== true) return invalidId
        const validation = validateBody(cancelValidator, body, 'cancel_purchase', requestId, set)
        if (validation) return validation
        const key = requireIdempotencyKey(request, requestId, set)
        if (typeof key !== 'string') return key
        return call(set, requestId, () =>
          requirePurchases(purchases).cancelPurchase({
            id: params.purchaseId,
            ...(body as Omit<CancelPurchaseInput, 'id'>),
            idempotencyKey: key,
            principal: auth.principal
          } as CancelPurchaseInput)
        )
      })
    )
    .post('/v1/webhooks/ucp/orders', async ({ request, requestId, set, requestTimeoutGuard }) =>
      requestTimeoutGuard.run(async () => {
        const guard = bodyGuard(request, requestId, set, true)
        if (guard) return guard
        const service = ucpCheckoutService
        if (!service) {
          set.status = 503
          return apiErrorWithDetails(
            'ucp_runtime_store_required',
            'UCP order webhook intake requires the UCP checkout runtime store.',
            requestId
          )
        }
        const headers = headerRecord(request)
        const merchantOrigin = headers['x-ucp-merchant-origin']
        if (!merchantOrigin) {
          set.status = 400
          return apiErrorWithDetails(
            'ucp_invalid_request',
            'UCP order webhook requires x-ucp-merchant-origin.',
            requestId
          )
        }

        return call(set, requestId, async () =>
          service.receiveOrderWebhook({
            headers,
            rawBody: await request.clone().text(),
            merchantOrigin,
            method: request.method.toUpperCase(),
            path: new URL(request.url).pathname
          })
        )
      })
    )

  if (embeddedCheckoutRuntimeEnabled) {
    app
      .post('/v1/purchases/:purchaseId/embedded/sessions', async ({ params, body, request, requestId, set, requestTimeoutGuard }) =>
        requestTimeoutGuard.run(async () => {
          const guard = bodyGuard(request, requestId, set, true)
          if (guard) return guard
          const auth = await authorize({
            request,
            requestId,
            set,
            authenticate,
            requiredScope: 'write:purchase',
            agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:purchase'),
            agentSessionSigningSecret,
            hashPepper,
            apiError
          })
          if (!auth.ok) return auth.body
          const validation = validateBody(embeddedSessionValidator, body, 'create_embedded_checkout_session', requestId, set)
          if (validation) return validation
          const input = body as { allowedOrigin: string }
          return call(set, requestId, async () => {
            const host = await agentHostRegistry?.resolveRegistered({ principal: auth.principal })
            const allowedOrigin = new URL(input.allowedOrigin).origin
            if (
              !host ||
              !host.presentationModes.includes('embedded_component') ||
              !host.thirdPartyPaymentEmbeddingAllowed ||
              !host.componentProtocols?.includes('ucp.embedded_checkout.v1') ||
              !host.allowedComponentOrigins?.includes(allowedOrigin)
            ) {
              throw new UcpCheckoutServiceError(
                'ucp_embedded_checkout_unavailable',
                'The authenticated agent host is not registered for this Embedded Checkout origin and protocol.',
                403
              )
            }
            return requirePurchases(purchases).createEmbeddedCheckoutSession({
              id: params.purchaseId,
              principal: auth.principal,
              allowedOrigin
            })
          })
        })
      )
      .post('/v1/purchases/:purchaseId/embedded/messages', async ({ params, body, request, requestId, set, requestTimeoutGuard }) =>
        requestTimeoutGuard.run(async () => {
          const guard = bodyGuard(request, requestId, set, true)
          if (guard) return guard
          const auth = await authorize({
            request,
            requestId,
            set,
            authenticate,
            requiredScope: 'write:purchase',
            agentContext: recordAgentContext(body) ?? headerAgentContext(request, 'write:purchase'),
            agentSessionSigningSecret,
            hashPepper,
            apiError
          })
          if (!auth.ok) return auth.body
          const validation = validateBody(embeddedMessageValidator, body, 'embedded_checkout_message', requestId, set)
          if (validation) return validation
          const input = body as { sessionToken: string; message: unknown }
          const originHeader = request.headers.get('origin')?.trim()
          return call(set, requestId, async () => {
            const host = await agentHostRegistry?.resolveRegistered({ principal: auth.principal })
            const origin = originHeader ? new URL(originHeader).origin : undefined
            if (
              !host ||
              !origin ||
              !host.presentationModes.includes('embedded_component') ||
              !host.thirdPartyPaymentEmbeddingAllowed ||
              !host.componentProtocols?.includes('ucp.embedded_checkout.v1') ||
              !host.allowedComponentOrigins?.includes(origin)
            ) {
              throw new UcpCheckoutServiceError(
                'ucp_embedded_checkout_invalid',
                'Embedded Checkout message origin is not registered for the authenticated host.',
                403
              )
            }
            return requirePurchases(purchases).handleEmbeddedCheckoutMessage({
              id: params.purchaseId,
              principal: auth.principal,
              sessionToken: input.sessionToken,
              origin,
              message: input.message
            })
          })
        })
      )
  }
}

const call = async <T>(
  set: { status?: number | string },
  requestId: string,
  action: () => Promise<T>
) => {
  try {
    return await action()
  } catch (error) {
    return handlePurchaseError(error, set, requestId)
  }
}
