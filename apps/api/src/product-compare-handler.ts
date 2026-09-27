import { TypeCompiler } from '@sinclair/typebox/compiler'
import { compareProducts } from '@arro/product-intelligence'
import {
  CatalogProductCompareRequestSchema,
  type ApiError,
  type CatalogProductCompareRequest
} from '@arro/contracts'
import {
  agentActionScopeError,
  agentHostCapabilityError,
  agentSessionExpiryError
} from './agent-invocation.ts'
import { agentSessionBindingError } from './agent-session.ts'

const productCompareRequestValidator = TypeCompiler.Compile(
  CatalogProductCompareRequestSchema
)

type CreateProductCompareHandlerOptions = {
  agentSessionSigningSecret?: string | undefined
  apiError: (code: string, message: string, requestId: string) => ApiError
}

export type ProductCompareHandlerOptions = {
  body: unknown
  requestId: string
  correlationId: string
  set: { status?: number | string }
}

export type ProductCompareHandler = (
  options: ProductCompareHandlerOptions
) => Promise<unknown>

export const createProductCompareHandler = ({
  agentSessionSigningSecret,
  apiError
}: CreateProductCompareHandlerOptions): ProductCompareHandler => async ({
  body,
  requestId,
  correlationId,
  set
}) => {
  if (!productCompareRequestValidator.Check(body)) {
    set.status = 422
    return apiError(
      'validation_failed',
      'The request did not match the API contract.',
      requestId
    )
  }

  const requestBody = body as CatalogProductCompareRequest
  const scopeError = agentActionScopeError({
    agentContext: requestBody.agentContext,
    expectedScope: 'read:compare',
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
    expectedScope: 'read:compare',
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
    expectedScope: 'read:compare',
    requestId,
    apiError
  })
  if (hostCapabilityError) {
    set.status = 403
    return hostCapabilityError
  }

  return compareProducts(requestBody, {
    requestId,
    correlationId
  })
}
