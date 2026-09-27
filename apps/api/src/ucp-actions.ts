import type { UcpCheckout } from '@arro/contracts'

export const UCP_PAYMENT_AUTHENTICATION_EXTENSION = 'dev.ucp.common.payment.authentication'
export const UCP_DEVICE_DATA_COLLECTION_ACTION = 'dev.ucp.common.payment.device_data_collection'
export const UCP_THREE_DS_CHALLENGE_ACTION = 'dev.ucp.common.payment.three_ds_challenge'
export const MERCADO_PAGO_RENDER_ARTIFACT_ACTION = 'com.mercadopago.payment.render_artifact'

export type PreparedUcpAction = {
  id: string
  type: string
  presentation: 'hidden_browser' | 'visible_browser' | 'render_artifact' | 'unsupported'
  executable: boolean
  extensionVersion?: string
  paymentInstrumentId?: string
  url?: string
  allowedOrigins?: string[]
  artifact?: {
    type: string
    code?: string
    image?: string
    instructionsUrl?: string
    reference?: string
    expiresAt?: string
  }
  reason?: string
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

const stringValue = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const boundedStringValue = (value: unknown, maxLength: number) => {
  const result = stringValue(value)
  return result && result.length <= maxLength ? result : undefined
}

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(stringValue).filter((entry): entry is string => Boolean(entry)) : []

const capabilityVersions = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
      .map(asRecord)
      .map((declaration) => stringValue(declaration.version))
      .filter((version): version is string => Boolean(version))
    : []

const activeCapabilityVersion = (
  checkout: UcpCheckout,
  paymentHandlers: unknown,
  capabilityName: string
) => {
  const responseCapabilities = asRecord(checkout.ucp.capabilities)
  const negotiatedCapabilities = asRecord(asRecord(paymentHandlers).activeCapabilities)
  const negotiatedVersions = new Set(capabilityVersions(negotiatedCapabilities[capabilityName]))
  return capabilityVersions(responseCapabilities[capabilityName])
    .filter((version) => negotiatedVersions.has(version))
    .sort()
    .at(-1)
}

const checkoutPaymentInstruments = (checkout: UcpCheckout) => checkout.payment?.instruments ?? []

const supportedHandlers = (paymentHandlers: unknown) =>
  (Array.isArray(asRecord(paymentHandlers).paymentHandlers)
    ? asRecord(paymentHandlers).paymentHandlers as unknown[]
    : [])
    .map(asRecord)
    .filter((handler) => handler.supported === true)

const originFromHttpsUrl = (value: string | undefined) => {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    return url.origin
  } catch {
    return undefined
  }
}

const handlerActionOrigins = (handler: Record<string, unknown>) =>
  new Set(stringArray(handler.actionOrigins).flatMap((candidate) => {
    const origin = originFromHttpsUrl(candidate)
    return origin ? [origin] : []
  }))

const handlerForInstrument = (
  checkout: UcpCheckout,
  paymentHandlers: unknown,
  paymentInstrumentId: string | undefined
) => {
  const instrument = checkoutPaymentInstruments(checkout).find((candidate) =>
    candidate.id === paymentInstrumentId
  )
  if (!instrument) return undefined
  return supportedHandlers(paymentHandlers).find((handler) =>
    asRecord(handler.declaration).id === instrument.handler_id
  )
}

const trustedActionUrl = ({
  value,
  merchantOrigin,
  handler,
  allowMerchantOrigin = false
}: {
  value: string | undefined
  merchantOrigin: string
  handler: Record<string, unknown> | undefined
  allowMerchantOrigin?: boolean
}) => {
  if (!value || value.length > 2_048) return undefined
  const origin = originFromHttpsUrl(value)
  if (!origin) return undefined
  const merchant = originFromHttpsUrl(merchantOrigin)
  if (allowMerchantOrigin && merchant && origin === merchant) return value
  if (!handler || !handlerActionOrigins(handler).has(origin)) return undefined
  return value
}

const preparedBrowserAction = ({
  checkout,
  paymentHandlers,
  merchantOrigin,
  type,
  id,
  config,
  presentation
}: {
  checkout: UcpCheckout
  paymentHandlers: unknown
  merchantOrigin: string
  type: string
  id: string
  config: Record<string, unknown>
  presentation: 'hidden_browser' | 'visible_browser'
}): PreparedUcpAction => {
  const extensionVersion = activeCapabilityVersion(
    checkout,
    paymentHandlers,
    UCP_PAYMENT_AUTHENTICATION_EXTENSION
  )
  if (!extensionVersion) {
    return {
      id,
      type,
      presentation: 'unsupported',
      executable: false,
      reason: `Checkout returned ${type} without the negotiated ${UCP_PAYMENT_AUTHENTICATION_EXTENSION} extension.`
    }
  }

  const paymentInstrumentId = boundedStringValue(config.payment_instrument_id, 256)
  const handler = handlerForInstrument(checkout, paymentHandlers, paymentInstrumentId)
  if (!paymentInstrumentId || !handler) {
    return {
      id,
      type,
      presentation: 'unsupported',
      executable: false,
      ...(paymentInstrumentId ? { paymentInstrumentId } : {}),
      reason: 'The Action is not bound to a supported payment instrument and handler.'
    }
  }

  const rawUrl = stringValue(config.url)
  const url = trustedActionUrl({ value: rawUrl, merchantOrigin, handler })
  if (!url) {
    return {
      id,
      type,
      presentation: 'unsupported',
      executable: false,
      paymentInstrumentId,
      reason: 'The payment-authentication URL is not HTTPS or its origin is not authorized by the negotiated payment handler.'
    }
  }

  return {
    id,
    type,
    presentation,
    executable: true,
    extensionVersion,
    paymentInstrumentId,
    url,
    allowedOrigins: [...handlerActionOrigins(handler)].sort()
  }
}

const safeImage = (
  value: string | undefined,
  merchantOrigin: string,
  handler: Record<string, unknown> | undefined
) => {
  if (!value || value.length > 1_500_000) return undefined
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) return value
  return trustedActionUrl({ value, merchantOrigin, handler, allowMerchantOrigin: true })
}

const preparedRenderArtifact = ({
  checkout,
  paymentHandlers,
  merchantOrigin,
  id,
  config
}: {
  checkout: UcpCheckout
  paymentHandlers: unknown
  merchantOrigin: string
  id: string
  config: Record<string, unknown>
}): PreparedUcpAction => {
  const extensionVersion = activeCapabilityVersion(
    checkout,
    paymentHandlers,
    MERCADO_PAGO_RENDER_ARTIFACT_ACTION
  )
  if (!extensionVersion) {
    return {
      id,
      type: MERCADO_PAGO_RENDER_ARTIFACT_ACTION,
      presentation: 'unsupported',
      executable: false,
      reason: 'Checkout returned a render-artifact Action without negotiating its extension.'
    }
  }

  const selectedInstrument = checkoutPaymentInstruments(checkout).find((instrument) => instrument.selected) ??
    checkoutPaymentInstruments(checkout)[0]
  const handler = supportedHandlers(paymentHandlers).find((candidate) =>
    asRecord(candidate.declaration).id === selectedInstrument?.handler_id
  )
  const artifactType = boundedStringValue(config.type, 160)
  const rawCode = stringValue(config.code)
  const code = rawCode && rawCode.length <= 16_384 ? rawCode : undefined
  const image = safeImage(stringValue(config.image), merchantOrigin, handler)
  const instructionsUrl = trustedActionUrl({
    value: stringValue(config.instructions_url),
    merchantOrigin,
    handler,
    allowMerchantOrigin: true
  })
  const reference = stringValue(config.reference)
  const expiresAt = boundedStringValue(config.expires_at, 80)
  const validExpiry = expiresAt && Number.isFinite(Date.parse(expiresAt)) ? expiresAt : undefined
  const paymentInstrumentId = boundedStringValue(selectedInstrument?.id, 256)

  if (!artifactType || (!code && !image && !instructionsUrl)) {
    return {
      id,
      type: MERCADO_PAGO_RENDER_ARTIFACT_ACTION,
      presentation: 'unsupported',
      executable: false,
      reason: 'The render-artifact Action does not contain a valid inert code, image, or trusted instructions URL.'
    }
  }

  if (validExpiry && Date.parse(validExpiry) <= Date.now()) {
    return {
      id,
      type: MERCADO_PAGO_RENDER_ARTIFACT_ACTION,
      presentation: 'unsupported',
      executable: false,
      reason: 'The payment artifact has expired; refresh Checkout for the authoritative state.'
    }
  }

  return {
    id,
    type: MERCADO_PAGO_RENDER_ARTIFACT_ACTION,
    presentation: 'render_artifact',
    executable: true,
    extensionVersion,
    ...(paymentInstrumentId ? { paymentInstrumentId } : {}),
    artifact: {
      type: artifactType,
      ...(code ? { code } : {}),
      ...(image ? { image } : {}),
      ...(instructionsUrl ? { instructionsUrl } : {}),
      ...(reference && reference.length <= 512 ? { reference } : {}),
      ...(validExpiry ? { expiresAt: validExpiry } : {})
    }
  }
}

export const prepareUcpCheckoutActions = ({
  checkout,
  paymentHandlers,
  merchantOrigin
}: {
  checkout: UcpCheckout
  paymentHandlers: unknown
  merchantOrigin: string
}): PreparedUcpAction[] => {
  const prepared: PreparedUcpAction[] = []
  const seen = new Set<string>()

  for (const [rawType, instances] of Object.entries(checkout.actions ?? {}) as Array<[
    string,
    Array<{ id: string; config?: unknown }>
  ]>) {
    const type = boundedStringValue(rawType, 256)
    if (!type) continue
    for (const instance of instances) {
      const id = boundedStringValue(instance.id, 256)
      if (!id) continue
      const identity = `${type}:${id}`
      if (seen.has(identity)) continue
      seen.add(identity)
      const config = asRecord(instance.config)

      if (type === UCP_DEVICE_DATA_COLLECTION_ACTION) {
        prepared.push(preparedBrowserAction({
          checkout,
          paymentHandlers,
          merchantOrigin,
          type,
          id,
          config,
          presentation: 'hidden_browser'
        }))
        continue
      }
      if (type === UCP_THREE_DS_CHALLENGE_ACTION) {
        prepared.push(preparedBrowserAction({
          checkout,
          paymentHandlers,
          merchantOrigin,
          type,
          id,
          config,
          presentation: 'visible_browser'
        }))
        continue
      }
      if (type === MERCADO_PAGO_RENDER_ARTIFACT_ACTION) {
        prepared.push(preparedRenderArtifact({ checkout, paymentHandlers, merchantOrigin, id, config }))
        continue
      }

      prepared.push({
        id,
        type,
        presentation: 'unsupported',
        executable: false,
        reason: `Arro has no installed handler for Action type ${type}.`
      })
    }
  }

  return prepared
}
