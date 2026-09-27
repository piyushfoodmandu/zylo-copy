import type { ApiError } from '@arro/contracts'
import { createHash } from 'node:crypto'
import { config } from './config.ts'
import { buildOrganizationStructuredDataJson } from './public-discovery.ts'

export type GuardRejection = {
  status: 413 | 415
  reasonCode: 'payload_too_large' | 'unsupported_media_type'
  body: ApiError
}

const apiError = (
  code: GuardRejection['reasonCode'],
  message: string,
  requestId: string
): ApiError => ({
  error: {
    code,
    message,
    requestId
  }
})

export const applySecurityHeaders = (
  headers: Record<string, string | number>,
  publicBaseUrl = config.publicBaseUrl
) => {
  headers['x-content-type-options'] = 'nosniff'
  headers['x-frame-options'] = 'DENY'
  headers['referrer-policy'] = 'strict-origin-when-cross-origin'
  const structuredDataHash = createHash('sha256')
    .update(buildOrganizationStructuredDataJson(publicBaseUrl))
    .digest('base64')
  headers['content-security-policy'] = `default-src 'self'; script-src 'self' 'sha256-${structuredDataHash}'; style-src 'self'; frame-ancestors 'none'`

  if (config.publicBaseUrl.startsWith('https://')) {
    headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains'
  }
}

export const enforceJsonContentType = (
  request: Request,
  requestId: string
): GuardRejection | undefined => {
  if (!['POST', 'PATCH', 'PUT'].includes(request.method.toUpperCase())) return undefined

  const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
  if (contentType.includes('application/json')) return undefined

  return {
    status: 415,
    reasonCode: 'unsupported_media_type',
    body: apiError(
      'unsupported_media_type',
      'This endpoint requires an application/json request body.',
      requestId
    )
  }
}

export const enforceContentLength = (
  request: Request,
  requestId: string,
  maxBytes = config.maxRequestBodyBytes
): GuardRejection | undefined => {
  const contentLength = request.headers.get('content-length')
  if (!contentLength) return undefined

  const parsed = Number.parseInt(contentLength, 10)
  if (!Number.isFinite(parsed) || parsed <= maxBytes) return undefined

  return {
    status: 413,
    reasonCode: 'payload_too_large',
    body: apiError(
      'payload_too_large',
      'The request body exceeds the configured size limit.',
      requestId
    )
  }
}
