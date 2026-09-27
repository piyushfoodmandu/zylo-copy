import { describe, expect, it, vi } from 'vitest'
import type { PurchasePaymentActionResponse } from '../types/purchase'
import type { PreparedPaymentAction } from './dispatcher'
import { negotiateCheckoutPaymentSession } from './payment-action-session'

const action = (presentation: PurchasePaymentActionResponse['presentation']) => ({
  presentation
}) as PurchasePaymentActionResponse

describe('checkout payment action negotiation', () => {
  it('downscopes exactly once after native readiness is unavailable', async () => {
    const createAction = vi.fn(async (
      _purchaseId: string,
      options: { surfaceMode: 'native_preferred' | 'external_only' }
    ) => action(options.surfaceMode === 'external_only' ? 'external_action' : 'host_native'))
    const prepareAction = vi.fn(async (value: PurchasePaymentActionResponse): Promise<PreparedPaymentAction> =>
      value.presentation === 'host_native'
        ? { status: 'unavailable', reason: 'No wallet is ready.', fallback: 'request_external_action' }
        : {
            status: 'external_action_required',
            actionUrl: 'https://merchant.example/pay',
            presentation: 'external_action'
          })
    const onNativeUnavailable = vi.fn()

    await expect(negotiateCheckoutPaymentSession('purchase-1', {
      createAction,
      prepareAction,
      onNativeUnavailable
    })).resolves.toEqual({
      prepared: {
        status: 'external_action_required',
        actionUrl: 'https://merchant.example/pay',
        presentation: 'external_action'
      },
      externalOnly: true,
      nativeUnavailableReason: 'No wallet is ready.'
    })
    expect(createAction).toHaveBeenNthCalledWith(1, 'purchase-1', { surfaceMode: 'native_preferred' })
    expect(createAction).toHaveBeenNthCalledWith(2, 'purchase-1', { surfaceMode: 'external_only' })
    expect(createAction).toHaveBeenCalledTimes(2)
    expect(onNativeUnavailable).toHaveBeenCalledWith('No wallet is ready.')
  })

  it('never accepts a native action after the checkout was downscoped', async () => {
    const createAction = vi.fn(async () => action('host_native'))
    const nativeReady = {
      status: 'native_ready',
      action: action('host_native'),
      request: { allowedPaymentMethods: [] },
      present: vi.fn()
    } as unknown as PreparedPaymentAction

    await expect(negotiateCheckoutPaymentSession('purchase-1', {
      createAction,
      prepareAction: async () => nativeReady
    }, 'external_only')).resolves.toEqual({
      prepared: {
        status: 'unavailable',
        reason: 'The shop ignored this app’s external-only payment request.',
        fallback: 'none'
      },
      externalOnly: true
    })
    expect(createAction).toHaveBeenCalledTimes(1)
  })
})
