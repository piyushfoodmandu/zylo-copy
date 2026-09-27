import { TypeCompiler } from '@sinclair/typebox/compiler'
import { analyzeProductSanityCheck } from '@arro/product-intelligence'
import {
  CatalogProductSanityCheckRequestSchema,
  type ApiError,
  type CatalogProductSanityCheckRequest
} from '@arro/contracts'
import {
  agentActionScopeError,
  agentHostCapabilityError,
  agentSessionExpiryError
} from './agent-invocation.ts'
import { agentSessionBindingError } from './agent-session.ts'

const productSanityCheckRequestValidator = TypeCompiler.Compile(
  CatalogProductSanityCheckRequestSchema
)

type CreateProductSanityCheckHandlerOptions = {
  agentSessionSigningSecret?: string | undefined
  apiError: (code: string, message: string, requestId: string) => ApiError
}

export type ProductSanityCheckHandlerOptions = {
  body: unknown
  requestId: string
  correlationId: string
  set: { status?: number | string }
}

export type ProductSanityCheckHandler = (
  options: ProductSanityCheckHandlerOptions
) => Promise<unknown>

export const createProductSanityCheckHandler = ({
  agentSessionSigningSecret,
  apiError
}: CreateProductSanityCheckHandlerOptions): ProductSanityCheckHandler => async ({
  body,
  requestId,
  correlationId,
  set
}) => {
  if (!productSanityCheckRequestValidator.Check(body)) {
    set.status = 422
    return apiError(
      'validation_failed',
      'The request did not match the API contract.',
      requestId
    )
  }

  const requestBody = body as CatalogProductSanityCheckRequest
  const scopeError = agentActionScopeError({
    agentContext: requestBody.agentContext,
    expectedScope: 'read:sanity_check',
    requestId,
    apiError
  })
  if (scopeError) {
    set.status = 403
    return scopeError
  }

  const sessionExpiryError = agentSessionExpiryError({
    agentContext: requestBody.agentContext,
    requestId,
    apiError
  })
  if (sessionExpiryError) {
    set.status = 403
    return sessionExpiryError
  }

  const sessionBindingError = agentSessionBindingError({
    agentContext: requestBody.agentContext,
    expectedScope: 'read:sanity_check',
    signingSecret: agentSessionSigningSecret,
    requestId,
    apiError
  })
  if (sessionBindingError) {
    set.status = sessionBindingError.status
    return sessionBindingError.body
  }

  const hostCapabilityError = agentHostCapabilityError({
    agentContext: requestBody.agentContext,
    expectedScope: 'read:sanity_check',
    requestId,
    apiError
  })
  if (hostCapabilityError) {
    set.status = 403
    return hostCapabilityError
  }

  return analyzeProductSanityCheck(requestBody, {
    requestId,
    correlationId
  })
}
