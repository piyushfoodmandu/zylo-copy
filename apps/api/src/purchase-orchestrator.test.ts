import { describe, expect, it, vi } from 'vitest'
import { UCP_STABLE_VERSION, type UcpCheckout, type UcpPaymentInstrument } from '@arro/contracts'
import {
  createPurchaseOrchestrator
} from './purchase-orchestrator.ts'
import type { UcpCheckoutService } from './ucp-checkout-service.ts'
import {
  UCP_PAYMENT_AUTHENTICATION_EXTENSION,
  UCP_THREE_DS_CHALLENGE_ACTION
} from './ucp-actions.ts'

const checksum = `sha256:${'a'.repeat(64)}`

const checkout = ({
  status,
  continueUrl,
  order
}: {
  status: UcpCheckout['status']
  continueUrl?: string
  order?: UcpCheckout['order']
}): UcpCheckout => ({
  ucp: {
    version: UCP_STABLE_VERSION,
    status: 'success'
  },
  id: 'chk_65w_charger',
  status,
  currency: 'USD',
  line_items: [
    {
      id: 'line_65w_charger',
      item: {
        id: 'variant_65w_charger',
        title: 'Safe 65W USB-C Charger',
        url: 'https://merchant.test/products/safe-65w-usb-c-charger'
      },
      quantity: {
        total: 1
      }
    }
  ],
  totals: [
    {
      type: 'subtotal',
      amount: 3999,
      currency: 'USD'
    },
    {
      type: 'total',
      amount: 3999,
      currency: 'USD'
    }
  ],
  links: [],
  ...(continueUrl ? { continue_url: continueUrl } : {}),
  ...(order ? { order } : {})
})

const session = (transactionId: string) => ({
  transactionId,
  integrationId: 'api-key:test-owner',
  merchantProfileUrl: 'https://merchant.test/.well-known/ucp',
  merchantOrigin: 'https://merchant.test',
  ucpVersion: UCP_STABLE_VERSION,
  checkoutId: 'chk_65w_charger',
  idempotencyKeyHash: 'sha256:idempotency',
  requestFingerprint: 'sha256:fingerprint',
  lastCheckoutStatus: 'ready_for_complete',
  checkoutSnapshotHash: checksum,
  createdAt: '2026-07-11T00:00:00.000Z',
  updatedAt: '2026-07-11T00:00:00.000Z'
})

const response = ({
  transactionId,
  checkoutBody,
  primaryAction,
  paymentCompletedByArro = false
}: {
  transactionId: string
  checkoutBody: UcpCheckout
  primaryAction: { action: string; label: string; url?: string }
  paymentCompletedByArro?: boolean
}) => ({
  transactionId,
  checkout: checkoutBody,
  session: session(transactionId),
  paymentCompletedByArro,
  primaryAction
})

const merchantHostedHandlers = {
  paymentHandlers: [
    {
      handlerName: 'merchant_hosted_continuation',
      supported: true,
      executionMode: 'merchant_hosted'
    }
  ]
}

const directPaymentHandlers = {
  paymentHandlers: [
    {
      handlerName: 'processor_tokenizer',
      supported: true,
      executionMode: 'tokenized_payment'
    }
  ]
}

describe('initial checkout delivery input', () => {
  const setup = (shipping = true) => {
    const body = checkout({ status: 'requires_escalation', continueUrl: 'https://merchant.test/checkout' })
    body.line_items[0]!.quantity = 1
    body.fulfillment = { methods: [] }
    body.ucp.capabilities = {
      'dev.ucp.shopping.fulfillment': [{
        version: UCP_STABLE_VERSION,
        config: { method_combinations: shipping ? [['shipping']] : [['pickup']] }
      }]
    }
    const current = response({ transactionId: 'delivery', checkoutBody: body, primaryAction: { action: 'continue', label: 'Continue' } })
    const updateCheckout = vi.fn().mockResolvedValue(current)
    const service = {
      getCheckout: vi.fn().mockResolvedValue(current),
      updateCheckout,
      listPaymentHandlers: vi.fn().mockResolvedValue(merchantHostedHandlers)
    } as unknown as UcpCheckoutService
    return { purchases: createPurchaseOrchestrator({ service }), updateCheckout, body, current }
  }
  const input = {
    id: 'delivery', principal: {} as never, checkoutSnapshotHash: checksum, idempotencyKey: 'initial-delivery-address',
    fulfillment: { methods: [{ type: 'shipping' as const, destinations: [{ address_country: 'US', postal_code: '10001' }] }] }
  }

  it('exposes the initial address editor from negotiated shipping capability', async () => {
    const { purchases } = setup()
    expect(await purchases.getPurchase('delivery', {} as never)).toMatchObject({ canAddShippingAddress: true })
  })

  it('sends an initial UCP shipping preference with merchant-owned line IDs and no invented method ID', async () => {
    const { purchases, updateCheckout } = setup()
    await purchases.updatePurchaseReview(input)
    expect(updateCheckout).toHaveBeenCalledWith('delivery', expect.objectContaining({
      checkout: expect.objectContaining({ fulfillment: { methods: [{
        type: 'shipping', line_item_ids: ['line_65w_charger'],
        destinations: [{ address_country: 'US', postal_code: '10001' }]
      }] } })
    }))
  })

  it('does not invent shipping for a pickup-only checkout', async () => {
    const { purchases, updateCheckout } = setup(false)
    expect(await purchases.getPurchase('delivery', {} as never)).toMatchObject({ canAddShippingAddress: false })
    await expect(purchases.updatePurchaseReview(input)).rejects.toThrow('does not accept a new shipping method')
    expect(updateCheckout).not.toHaveBeenCalled()
  })

  it('keeps existing merchant methods on the ID-based editing path', async () => {
    const { purchases, body, updateCheckout } = setup()
    body.fulfillment = { methods: [{ id: 'shipping_1', type: 'shipping', line_item_ids: ['line_65w_charger'] }] }
    await expect(purchases.updatePurchaseReview(input)).rejects.toThrow('does not accept a new shipping method')
    await purchases.updatePurchaseReview({ ...input, fulfillment: { methods: [{
      id: 'shipping_1', destinations: [{ address_country: 'US' }]
    }] } })
    expect(updateCheckout).toHaveBeenCalledOnce()
  })

  it('does not report merchant-rejected details as saved', async () => {
    const { purchases, current, updateCheckout } = setup()
    updateCheckout.mockResolvedValue({ ...current, ucpError: { messages: [{
      type: 'error', code: 'address_invalid', severity: 'recoverable', content: 'Postal code is invalid.'
    }] } })
    await expect(purchases.updatePurchaseReview(input)).rejects.toMatchObject({ code: 'ucp_review_rejected', status: 422, message: 'Postal code is invalid.' })
  })

  it('normalizes buyer and recipient phone formatting before the merchant request', async () => {
    const { purchases, updateCheckout } = setup()
    await purchases.updatePurchaseReview({ ...input,
      buyer: { phone_number: '+1 (212) 555-0123' },
      fulfillment: { methods: [{ type: 'shipping', destinations: [{ address_country: 'US', phone_number: '+1 (212) 555-0123' }] }] }
    })
    expect(updateCheckout.mock.calls[0]![1].checkout).toMatchObject({
      buyer: { phone_number: '+12125550123' },
      fulfillment: { methods: [{ destinations: [{ phone_number: '+12125550123' }] }] }
    })
  })

  it('keeps invalid phone input a correctable form error without calling the merchant', async () => {
    const { purchases, updateCheckout } = setup()
    await expect(purchases.updatePurchaseReview({ ...input, buyer: { phone_number: '2125550123' } })).rejects.toMatchObject({ code: 'ucp_review_rejected', status: 422 })
    expect(updateCheckout).not.toHaveBeenCalled()
  })

  it('does not append a second success descriptor after saving details', async () => {
    const { purchases } = setup()
    const result = await purchases.updatePurchaseReview(input)
    expect(result.messages.some((message) => message.text.includes('details were applied'))).toBe(false)
  })
})

describe('createPurchaseOrchestrator', () => {
  it('exposes a merchant-neutral embedded presentation on an escalated purchase', async () => {
    const checkoutBody = checkout({ status: 'requires_escalation', continueUrl: 'https://merchant.test/checkout/1' })
    checkoutBody.ucp.services = {
      'dev.ucp.shopping': [{ version: UCP_STABLE_VERSION, transport: 'embedded', config: { delegate: [] } }]
    }
    const service = {
      createCheckout: vi.fn().mockResolvedValue(response({
        transactionId: 'ucptx_embedded', checkoutBody,
        primaryAction: { action: 'continue_on_merchant', label: 'Checkout', url: checkoutBody.continue_url! }
      })),
      listPaymentHandlers: vi.fn().mockResolvedValue(merchantHostedHandlers)
    } as unknown as UcpCheckoutService
    const purchase = await createPurchaseOrchestrator({ service }).preparePurchase({
      merchantDomain: 'merchant.test',
      selectedOffer: { variantId: 'variant_65w_charger', quantity: 1 },
      idempotencyKey: 'purchase-embedded'
    })
    expect(purchase).toMatchObject({
      state: 'merchant_continuation_required',
      nextAction: { type: 'continue_on_merchant', presentation: { type: 'ucp_embedded', version: UCP_STABLE_VERSION, checkoutId: checkoutBody.id } }
    })
  })

  it('forwards first-party client capabilities to payment-route negotiation', async () => {
    const createPaymentAction = vi.fn().mockResolvedValue({
      actionId: 'arro_pa_native_google_pay_1',
      purchaseId: 'ucptx_native_google_pay_1',
      status: 'pending_user_approval',
      actionType: 'google_pay',
      provider: 'com.google.pay',
      handlerId: 'merchant_google_pay_1',
      handlerName: 'com.google.pay',
      presentation: 'host_native',
      merchantOrigin: 'https://merchant.test',
      checkoutId: 'chk_native_google_pay_1',
      checkoutSnapshotHash: checksum,
      expiresAt: '2099-01-01T00:00:00.000Z',
      actionToken: 'arro_pa1_signed_native_google_pay_action',
      message: 'Approve with native Google Pay.'
    })
    const purchases = createPurchaseOrchestrator({
      service: { createPaymentAction } as unknown as UcpCheckoutService
    })
    const clientCapabilities = {
      platform: 'android' as const,
      surfaces: ['host_native' as const, 'external_action' as const],
      providerKinds: ['google_pay' as const],
      handlerNames: ['com.google.pay']
    }

    await purchases.createPaymentAction({
      id: 'ucptx_native_google_pay_1',
      principal: {} as never,
      clientCapabilities,
      preference: { mode: 'google_pay' },
      idempotencyKey: 'native-google-pay-action'
    })

    expect(createPaymentAction).toHaveBeenCalledWith(
      'ucptx_native_google_pay_1',
      expect.objectContaining({
        clientCapabilities,
        preference: { mode: 'google_pay' },
        idempotencyKey: 'native-google-pay-action'
      })
    )
  })

  it('keeps an incomplete UCP checkout in Arro review instead of forcing a browser continuation', async () => {
    const createCheckout = vi.fn().mockResolvedValue(response({
      transactionId: 'ucptx_handoff',
      checkoutBody: checkout({
        status: 'incomplete',
        continueUrl: 'https://merchant.test/checkout/cart-65w'
      }),
      primaryAction: {
        action: 'continue_on_merchant',
        label: 'Continue on merchant checkout',
        url: 'https://merchant.test/checkout/cart-65w'
      }
    }))
    const service = {
      createCheckout,
      listPaymentHandlers: vi.fn().mockResolvedValue(merchantHostedHandlers)
    } as unknown as UcpCheckoutService
    const purchases = createPurchaseOrchestrator({ service })

    const purchase = await purchases.preparePurchase({
      merchantDomain: 'merchant.test',
      selectedOffer: {
        variantId: 'variant_65w_charger',
        title: 'Safe 65W USB-C Charger',
        quantity: 1
      },
      idempotencyKey: 'purchase-idempotency-key'
    })

    expect(createCheckout).toHaveBeenCalledWith(expect.objectContaining({
      merchantProfileUrl: 'https://merchant.test/.well-known/ucp',
      idempotencyKey: 'purchase-idempotency-key',
      cart: {
        line_items: [
          {
            item: {
              id: 'variant_65w_charger',
              title: 'Safe 65W USB-C Charger'
            },
            quantity: 1
          }
        ]
      },
      checkout: {
        line_items: [
          {
            item: {
              id: 'variant_65w_charger',
              title: 'Safe 65W USB-C Charger'
            },
            quantity: 1
          }
        ]
      }
    }))
    expect(purchase).toMatchObject({
      purchaseId: 'ucptx_handoff',
      state: 'review_required',
      executionLevel: 'direct_payment',
      payment: {
        completedByArro: false
      },
      nextAction: {
        type: 'review_purchase',
        label: 'Complete checkout details'
      }
    })
    expect(purchase.messages).toEqual([])
  })

  it('resolves Shopify selected-offer seller identity without a caller-provided merchant profile URL', async () => {
    const createCheckout = vi.fn().mockResolvedValue(response({
      transactionId: 'ucptx_shopify_seller',
      checkoutBody: checkout({
        status: 'incomplete',
        continueUrl: 'https://levelupkickzz.myshopify.com/checkouts/cn/checkout-token'
      }),
      primaryAction: {
        action: 'continue_on_merchant',
        label: 'Continue on merchant checkout',
        url: 'https://levelupkickzz.myshopify.com/checkouts/cn/checkout-token'
      }
    }))
    const service = {
      createCheckout,
      listPaymentHandlers: vi.fn().mockResolvedValue(merchantHostedHandlers)
    } as unknown as UcpCheckoutService
    const purchases = createPurchaseOrchestrator({ service })

    await purchases.preparePurchase({
      selectedOffer: {
        variantId: 'gid://shopify/ProductVariant/charger-65w',
        title: 'Safe 65W USB-C Charger',
        quantity: 1,
        checkout_url: 'https://levelupkickzz.myshopify.com/checkouts/cn/checkout-token',
        seller: {
          name: 'LevelUpKickz',
          domain: 'levelupkickzz.myshopify.com'
        }
      },
      idempotencyKey: 'purchase-shopify-seller-idempotency'
    })

    expect(createCheckout).toHaveBeenCalledWith(expect.objectContaining({
      merchantProfileUrl: 'https://levelupkickzz.myshopify.com/.well-known/ucp'
    }))
  })

  it('records buyer confirmation without completing when tokenized payment proof is absent', async () => {
    const completeCheckout = vi.fn()
    const service = {
      confirmCheckout: vi.fn().mockResolvedValue(response({
        transactionId: 'ucptx_review',
        checkoutBody: checkout({ status: 'ready_for_complete' }),
        primaryAction: {
          action: 'confirm_then_complete',
          label: 'Confirm checkout before completion'
        }
      })),
      getCheckout: vi.fn().mockResolvedValue(response({
        transactionId: 'ucptx_review',
        checkoutBody: checkout({ status: 'ready_for_complete' }),
        primaryAction: {
          action: 'confirm_then_complete',
          label: 'Confirm checkout before completion'
        }
      })),
      listPaymentHandlers: vi.fn().mockResolvedValue(directPaymentHandlers),
      readLatestPaymentExecutionAuthority: vi.fn().mockResolvedValue(undefined),
      completeCheckout
    } as unknown as UcpCheckoutService
    const purchases = createPurchaseOrchestrator({ service })

    const purchase = await purchases.confirmPurchase({
      id: 'ucptx_review',
      approvalRef: 'buyer-approved-current-total',
      checkoutSnapshotHash: checksum,
      idempotencyKey: 'review-confirm-idempotency-key'
    })

    expect(completeCheckout).not.toHaveBeenCalled()
    expect(purchase).toMatchObject({
      state: 'payment_action_required',
      executionLevel: 'direct_payment',
      payment: {
        completedByArro: false
      },
      nextAction: {
        type: 'provide_payment'
      }
    })
    expect(purchase.messages.some((entry) =>
      entry.text.includes('Direct completion still needs a tokenized UCP payment instrument')
    )).toBe(true)
  })

  it('returns a first-class UCP Action instead of creating another payment request', async () => {
    const actionCheckout: UcpCheckout = {
      ...checkout({ status: 'requires_escalation' }),
      ucp: {
        version: UCP_STABLE_VERSION,
        status: 'success',
        capabilities: {
          'dev.ucp.shopping.checkout': [{ version: UCP_STABLE_VERSION }],
          [UCP_PAYMENT_AUTHENTICATION_EXTENSION]: [{ version: UCP_STABLE_VERSION }]
        }
      },
      payment: {
        instruments: [{
          id: 'pi_action_1',
          handler_id: 'merchant_handler_1',
          type: 'card',
          selected: true,
          credential: { type: 'opaque_token', token: 'redacted' }
        }]
      },
      actions: {
        [UCP_THREE_DS_CHALLENGE_ACTION]: [{
          id: 'three_ds_1',
          config: {
            payment_instrument_id: 'pi_action_1',
            url: 'https://acs.example/challenge/three_ds_1'
          }
        }]
      }
    }
    const service = {
      getCheckout: vi.fn().mockResolvedValue(response({
        transactionId: 'ucptx_action',
        checkoutBody: actionCheckout,
        primaryAction: { action: 'refresh_checkout', label: 'Refresh checkout' }
      })),
      listPaymentHandlers: vi.fn().mockResolvedValue({
        activeCapabilities: {
          'dev.ucp.shopping.checkout': [{ version: UCP_STABLE_VERSION }],
          [UCP_PAYMENT_AUTHENTICATION_EXTENSION]: [{ version: UCP_STABLE_VERSION }]
        },
        paymentHandlers: [{
          supported: true,
          handlerName: 'com.example.processor_tokenizer',
          executionMode: 'client',
          actionOrigins: ['https://acs.example'],
          declaration: { id: 'merchant_handler_1', version: UCP_STABLE_VERSION }
        }]
      })
    } as unknown as UcpCheckoutService
    const purchases = createPurchaseOrchestrator({ service })

    const purchase = await purchases.getPurchase('ucptx_action', {} as never)

    expect(purchase).toMatchObject({
      state: 'payment_action_required',
      executionLevel: 'direct_payment',
      pendingActions: [{
        id: 'three_ds_1',
        type: UCP_THREE_DS_CHALLENGE_ACTION,
        presentation: 'visible_browser',
        executable: true,
        extensionVersion: UCP_STABLE_VERSION,
        url: 'https://acs.example/challenge/three_ds_1',
        allowedOrigins: ['https://acs.example']
      }],
      nextAction: {
        type: 'complete_ucp_action',
        label: 'Complete payment authentication',
        url: 'https://acs.example/challenge/three_ds_1'
      }
    })
    expect(purchase.messages).toEqual([])
  })

  it('reports completed only after the merchant runtime returns completed checkout and order state', async () => {
    const paymentInstrument: UcpPaymentInstrument = {
      handler_id: 'processor_tokenizer',
      type: 'card_token',
      credential: {
        type: 'token',
        token: 'tok_provider_controlled'
      }
    }
    const completeCheckout = vi.fn().mockResolvedValue(response({
      transactionId: 'ucptx_done',
      checkoutBody: checkout({
        status: 'completed',
        order: {
          id: 'order_65w',
          permalink_url: 'https://merchant.test/orders/order_65w'
        }
      }),
      primaryAction: {
        action: 'order_created',
        label: 'Order created by merchant',
        url: 'https://merchant.test/orders/order_65w'
      },
      paymentCompletedByArro: true
    }))
    const service = {
      getCheckout: vi.fn().mockResolvedValue(response({
        transactionId: 'ucptx_done',
        checkoutBody: checkout({ status: 'ready_for_complete' }),
        primaryAction: { action: 'confirm_then_complete', label: 'Confirm checkout before completion' }
      })),
      confirmCheckout: vi.fn().mockResolvedValue(response({
        transactionId: 'ucptx_done',
        checkoutBody: checkout({ status: 'ready_for_complete' }),
        primaryAction: {
          action: 'confirm_then_complete',
          label: 'Confirm checkout before completion'
        }
      })),
      completeCheckout,
      listPaymentHandlers: vi.fn().mockResolvedValue(directPaymentHandlers),
      readLatestPaymentExecutionAuthority: vi.fn().mockResolvedValue({ instrument: paymentInstrument })
    } as unknown as UcpCheckoutService
    const purchases = createPurchaseOrchestrator({ service })

    const purchase = await purchases.confirmPurchase({
      id: 'ucptx_done',
      approvalRef: 'buyer-approved-current-total',
      checkoutSnapshotHash: checksum,
      idempotencyKey: 'complete-idempotency-key'
    })

    expect(completeCheckout).toHaveBeenCalledWith('ucptx_done', expect.objectContaining({
      idempotencyKey: 'complete-idempotency-key',
      checkout: {
        payment: {
          instruments: [paymentInstrument]
        }
      }
    }))
    expect(purchase).toMatchObject({
      purchaseId: 'ucptx_done',
      state: 'completed',
      executionLevel: 'direct_payment',
      payment: {
        completedByArro: true
      },
      nextAction: {
        type: 'view_order',
        url: 'https://merchant.test/orders/order_65w'
      }
    })
    expect(purchase.messages).toEqual([])
  })

  it('does not report completion when the merchant returns completed Checkout without an Order', async () => {
    const service = {
      getCheckout: vi.fn().mockResolvedValue(response({
        transactionId: 'ucptx_order_pending',
        checkoutBody: checkout({ status: 'completed' }),
        primaryAction: { action: 'refresh_checkout', label: 'Refresh checkout' },
        paymentCompletedByArro: true
      })),
      listPaymentHandlers: vi.fn().mockResolvedValue(directPaymentHandlers)
    } as unknown as UcpCheckoutService
    const purchases = createPurchaseOrchestrator({ service })

    const purchase = await purchases.getPurchase('ucptx_order_pending', {} as never)

    expect(purchase).toMatchObject({
      state: 'review_required',
      payment: { completedByArro: false },
      checkoutStatus: 'completed',
      nextAction: {
        type: 'refresh_purchase',
        label: 'Refresh merchant order'
      }
    })
    expect(purchase.messages).toContainEqual({
      severity: 'info', code: 'order_confirmation_pending',
      text: 'The shop is confirming your order. Check its status before trying to pay again.'
    })
  })

  it('places vaulted AP2 authority at the exact UCP completion locations', async () => {
    const paymentMandate = 'issuer.payload.signature~~closed.payload.signature~~kb.payload.signature'
    const checkoutMandate = 'issuer.checkout.signature~~closed.checkout.signature~~kb.checkout.signature'
    const paymentInstrument: UcpPaymentInstrument = {
      handler_id: 'merchant_ap2_handler_1',
      type: 'card',
      credential: {
        type: 'ap2_mandate',
        token: paymentMandate
      }
    }
    const completeCheckout = vi.fn().mockResolvedValue(response({
      transactionId: 'ucptx_ap2_done',
      checkoutBody: checkout({
        status: 'completed',
        order: { id: 'order_ap2', permalink_url: 'https://merchant.test/orders/order_ap2' }
      }),
      primaryAction: { action: 'order_created', label: 'Order created by merchant' },
      paymentCompletedByArro: true
    }))
    const service = {
      getCheckout: vi.fn().mockResolvedValue(response({
        transactionId: 'ucptx_ap2_done',
        checkoutBody: checkout({ status: 'ready_for_complete' }),
        primaryAction: { action: 'confirm_then_complete', label: 'Confirm checkout before completion' }
      })),
      confirmCheckout: vi.fn().mockResolvedValue(response({
        transactionId: 'ucptx_ap2_done',
        checkoutBody: checkout({ status: 'ready_for_complete' }),
        primaryAction: { action: 'confirm_then_complete', label: 'Confirm checkout before completion' }
      })),
      completeCheckout,
      listPaymentHandlers: vi.fn().mockResolvedValue(directPaymentHandlers),
      readLatestPaymentExecutionAuthority: vi.fn().mockResolvedValue({
        instrument: paymentInstrument,
        ap2CheckoutMandate: checkoutMandate
      })
    } as unknown as UcpCheckoutService
    const purchases = createPurchaseOrchestrator({ service })

    await purchases.confirmPurchase({
      id: 'ucptx_ap2_done',
      approvalRef: 'trusted-surface-exact-checkout',
      checkoutSnapshotHash: checksum,
      idempotencyKey: 'complete-ap2-idempotency-key'
    })

    expect(completeCheckout).toHaveBeenCalledWith('ucptx_ap2_done', expect.objectContaining({
      checkout: {
        payment: { instruments: [paymentInstrument] },
        ap2: { checkout_mandate: checkoutMandate }
      }
    }))
  })

  it('records provider payment result and later completes with the stored tokenized instrument', async () => {
    const paymentInstrument: UcpPaymentInstrument = {
      handler_id: 'com.example.processor_tokenizer',
      type: 'card',
      selected: true,
      display: { brand: 'visa', last_digits: '4242' },
      credential: { type: 'PAYMENT_GATEWAY', token: 'opaque-provider-token' }
    }
    const recordPaymentResult = vi.fn().mockResolvedValue({
      ...response({
        transactionId: 'ucptx_provider_result',
        checkoutBody: checkout({ status: 'ready_for_complete' }),
        primaryAction: {
          action: 'confirm_then_complete',
          label: 'Confirm checkout before completion'
        }
      }),
      paymentResult: {
        paymentResultId: 'ucppr_1',
        provider: 'com.example.processor_tokenizer',
        handlerId: 'com.example.processor_tokenizer',
        instrumentId: 'pi_1',
        idempotentReplay: false,
        createdAt: '2026-07-11T00:00:00.000Z'
      }
    })
    const completeCheckout = vi.fn().mockResolvedValue(response({
      transactionId: 'ucptx_provider_result',
      checkoutBody: checkout({
        status: 'completed',
        order: {
          id: 'order_provider_result',
          permalink_url: 'https://merchant.test/orders/order_provider_result'
        }
      }),
      primaryAction: {
        action: 'order_created',
        label: 'Order created by merchant',
        url: 'https://merchant.test/orders/order_provider_result'
      },
      paymentCompletedByArro: true
    }))
    const service = {
      recordPaymentResult,
      getCheckout: vi.fn().mockResolvedValue(response({
        transactionId: 'ucptx_provider_result',
        checkoutBody: checkout({ status: 'ready_for_complete' }),
        primaryAction: { action: 'confirm_then_complete', label: 'Confirm checkout before completion' }
      })),
      confirmCheckout: vi.fn().mockResolvedValue(response({
        transactionId: 'ucptx_provider_result',
        checkoutBody: checkout({ status: 'ready_for_complete' }),
        primaryAction: {
          action: 'confirm_then_complete',
          label: 'Confirm checkout before completion'
        }
      })),
      readLatestPaymentExecutionAuthority: vi.fn().mockResolvedValue({ instrument: paymentInstrument }),
      completeCheckout,
      listPaymentHandlers: vi.fn().mockResolvedValue(directPaymentHandlers)
    } as unknown as UcpCheckoutService
    const purchases = createPurchaseOrchestrator({ service })

    const recorded = await purchases.recordPaymentResult({
      id: 'ucptx_provider_result',
      provider: 'com.example.processor_tokenizer',
      result: { token: 'opaque-provider-token' },
      idempotencyKey: 'payment-result-idempotency'
    })
    const completed = await purchases.confirmPurchase({
      id: 'ucptx_provider_result',
      approvalRef: 'buyer-approved-current-total',
      checkoutSnapshotHash: checksum,
      idempotencyKey: 'complete-from-stored-provider-token'
    })

    expect(recordPaymentResult).toHaveBeenCalledWith('ucptx_provider_result', expect.objectContaining({
      provider: 'com.example.processor_tokenizer',
      result: { token: 'opaque-provider-token' },
      idempotencyKey: 'payment-result-idempotency'
    }))
    expect(recorded.messages.some((entry) =>
      entry.text.includes('Provider returned a tokenized payment instrument')
    )).toBe(true)
    expect(completeCheckout).toHaveBeenCalledWith('ucptx_provider_result', expect.objectContaining({
      idempotencyKey: 'complete-from-stored-provider-token',
      checkout: {
        payment: {
          instruments: [paymentInstrument]
        }
      }
    }))
    expect(completed).toMatchObject({
      state: 'completed',
      payment: {
        completedByArro: true
      },
      nextAction: {
        type: 'view_order',
        url: 'https://merchant.test/orders/order_provider_result'
      }
    })
  })
})
