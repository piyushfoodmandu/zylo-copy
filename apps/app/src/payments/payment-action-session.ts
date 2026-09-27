import type { PurchasePaymentActionResponse } from '../types/purchase'
import type { PaymentSurfaceMode } from './capabilities'
import type { PreparedPaymentAction } from './dispatcher'

export type CheckoutPaymentSession = {
  prepared: PreparedPaymentAction
  /** Once true, every later action request for this checkout must stay external-only. */
  externalOnly: boolean
  nativeUnavailableReason?: string
}

type PaymentActionCreator = (
  purchaseId: string,
  options: { surfaceMode: PaymentSurfaceMode }
) => Promise<PurchasePaymentActionResponse>

type PaymentActionPreparer = (
  action: PurchasePaymentActionResponse
) => Promise<PreparedPaymentAction>

/**
 * Negotiate one action, with exactly one capability downgrade when the native
 * executor cannot run it. The fallback is a new external-only action; the
 * native action's URL is never repurposed as a browser destination.
 */
export const negotiateCheckoutPaymentSession = async (
  purchaseId: string,
  dependencies: {
    createAction: PaymentActionCreator
    prepareAction: PaymentActionPreparer
    onNativeUnavailable?: (reason: string) => void
  },
  surfaceMode: PaymentSurfaceMode = 'native_preferred'
): Promise<CheckoutPaymentSession> => {
  const action = await dependencies.createAction(purchaseId, { surfaceMode })
  const prepared = await dependencies.prepareAction(action)

  if (surfaceMode === 'external_only') {
    return {
      prepared: prepared.status === 'native_ready'
        ? {
            status: 'unavailable',
            reason: 'The shop ignored this app’s external-only payment request.',
            fallback: 'none'
          }
        : prepared,
      externalOnly: true
    }
  }

  if (prepared.status !== 'unavailable' || prepared.fallback !== 'request_external_action') {
    return { prepared, externalOnly: false }
  }

  dependencies.onNativeUnavailable?.(prepared.reason)
  const fallbackAction = await dependencies.createAction(purchaseId, {
    surfaceMode: 'external_only'
  })
  const fallback = await dependencies.prepareAction(fallbackAction)

  return {
    prepared: fallback.status === 'native_ready'
      ? {
          status: 'unavailable',
          reason: 'The shop ignored this app’s external-only payment request.',
          fallback: 'none'
        }
      : fallback,
    externalOnly: true,
    nativeUnavailableReason: prepared.reason
  }
}
