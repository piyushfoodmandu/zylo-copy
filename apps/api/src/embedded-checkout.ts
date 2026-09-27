import { randomUUID } from 'node:crypto'
import {
  embeddedCheckoutPresentation,
  parseEmbeddedCheckoutMessage,
  processEmbeddedCheckoutMessage,
  type EmbeddedCheckoutPresentation,
  type UcpCheckout
} from '@arro/contracts'

export type EmbeddedCheckoutSession = {
  sessionId: string
  channelId: string
  transactionId: string
  checkoutId: string
  version: EmbeddedCheckoutPresentation['version']
  merchantOrigin: string
  allowedOrigin: string
  createdAt: string
  expiresAt: string
}

export class EmbeddedCheckoutProtocolError extends Error {
  readonly code: 'embedded_checkout_origin_invalid' | 'embedded_checkout_session_invalid' | 'embedded_checkout_message_invalid'
  readonly status: number
  readonly details?: unknown

  constructor(
    code: EmbeddedCheckoutProtocolError['code'],
    message: string,
    status: number,
    details?: unknown
  ) {
    super(message)
    this.name = 'EmbeddedCheckoutProtocolError'
    this.code = code
    this.status = status
    this.details = details
  }
}

const assertOrigin = (value: string) => {
  let url: URL
  try { url = new URL(value) } catch {
    throw new EmbeddedCheckoutProtocolError('embedded_checkout_origin_invalid', 'Embedded Checkout origin is invalid.', 422)
  }
  if (url.protocol !== 'https:') {
    throw new EmbeddedCheckoutProtocolError('embedded_checkout_origin_invalid', 'Embedded Checkout origin must be HTTPS.', 422)
  }
  return url.origin
}

export const createEmbeddedCheckoutSession = ({
  transactionId, checkout, merchantOrigin, allowedOrigin, ttlSeconds = 900, now = new Date()
}: {
  transactionId: string
  checkout: UcpCheckout
  merchantOrigin: string
  allowedOrigin: string
  ttlSeconds?: number
  now?: Date
}): EmbeddedCheckoutSession => {
  const presentation = embeddedCheckoutPresentation(checkout)
  if (!presentation) {
    throw new EmbeddedCheckoutProtocolError(
      'embedded_checkout_session_invalid', 'This checkout has no supported per-session embedded binding.', 409
    )
  }
  return {
    sessionId: `ecs_${randomUUID()}`,
    channelId: `ecc_${randomUUID()}`,
    transactionId,
    checkoutId: checkout.id,
    version: presentation.version,
    merchantOrigin,
    allowedOrigin: assertOrigin(allowedOrigin),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString()
  }
}

// Arro's signed relay token authenticates the host to Arro. It is not a merchant
// ec_auth credential and must never be appended to the merchant's checkout URL.
export const embeddedCheckoutInitParams = (session: EmbeddedCheckoutSession) => ({
  ec_version: session.version,
  ec_delegate: ''
})

export const parseEmbeddedCheckoutJsonRpc = (message: unknown) => {
  try { return parseEmbeddedCheckoutMessage(message) } catch {
    throw new EmbeddedCheckoutProtocolError('embedded_checkout_message_invalid', 'Invalid Embedded Checkout JSON-RPC message.', 422)
  }
}

export const handleEmbeddedCheckoutJsonRpc = async ({
  session, origin, message, currentCheckout, refreshCheckout
}: {
  session: EmbeddedCheckoutSession
  origin: string
  message: unknown
  currentCheckout: UcpCheckout
  refreshCheckout: () => Promise<UcpCheckout | undefined>
}) => {
  if (assertOrigin(origin) !== session.allowedOrigin) {
    throw new EmbeddedCheckoutProtocolError(
      'embedded_checkout_origin_invalid', 'Embedded Checkout relay origin does not match the registered host.', 403
    )
  }
  if (new Date(session.expiresAt).getTime() <= Date.now() || currentCheckout.id !== session.checkoutId) {
    throw new EmbeddedCheckoutProtocolError('embedded_checkout_session_invalid', 'Embedded Checkout session is no longer valid.', 410)
  }
  const result = processEmbeddedCheckoutMessage({
    type: 'ucp_embedded', version: session.version, checkoutId: session.checkoutId
  }, parseEmbeddedCheckoutJsonRpc(message))
  const shouldRefreshCheckout = result.event === 'complete' || result.event === 'change'
  if (shouldRefreshCheckout) await refreshCheckout()
  return {
    request: result.request,
    ...(result.response ? { response: result.response } : {}),
    shouldRefreshCheckout,
    clientCompletionIgnored: result.event === 'complete'
  }
}
