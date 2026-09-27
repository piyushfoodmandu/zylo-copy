import { describe, expect, it } from 'vitest'
import { UCP_STABLE_VERSION, type UcpCheckout } from '@arro/contracts'
import {
  MERCADO_PAGO_RENDER_ARTIFACT_ACTION,
  UCP_DEVICE_DATA_COLLECTION_ACTION,
  UCP_PAYMENT_AUTHENTICATION_EXTENSION,
  UCP_THREE_DS_CHALLENGE_ACTION,
  prepareUcpCheckoutActions
} from './ucp-actions.ts'

const checkoutWithAction = (
  actionType: string,
  config: Record<string, unknown>,
  capability = UCP_PAYMENT_AUTHENTICATION_EXTENSION
): UcpCheckout => ({
  ucp: {
    version: UCP_STABLE_VERSION,
    status: 'success',
    capabilities: {
      'dev.ucp.shopping.checkout': [{ version: UCP_STABLE_VERSION }],
      [capability]: [{ version: UCP_STABLE_VERSION }]
    }
  },
  id: 'chk_actions_1',
  status: 'requires_escalation',
  currency: 'USD',
  line_items: [],
  totals: [{ type: 'total', amount: 1000, currency: 'USD' }],
  links: [],
  payment: {
    instruments: [{
      id: 'pi_1',
      handler_id: 'merchant_handler_1',
      type: 'card',
      selected: true,
      credential: { type: 'opaque_token', token: 'redacted' }
    }]
  },
  actions: {
    [actionType]: [{ id: 'action_1', config }]
  }
})

const paymentHandlers = {
  activeCapabilities: {
    [UCP_PAYMENT_AUTHENTICATION_EXTENSION]: [{ version: UCP_STABLE_VERSION }],
    [MERCADO_PAGO_RENDER_ARTIFACT_ACTION]: [{ version: UCP_STABLE_VERSION }]
  },
  paymentHandlers: [{
    supported: true,
    actionOrigins: ['https://acs.example', 'https://payments.example'],
    declaration: {
      id: 'merchant_handler_1',
      version: '2026-01-23'
    }
  }]
}

describe('UCP Actions preparation', () => {
  it('prepares a negotiated 3DS challenge only for an explicitly trusted HTTPS origin', () => {
    const [action] = prepareUcpCheckoutActions({
      checkout: checkoutWithAction(UCP_THREE_DS_CHALLENGE_ACTION, {
        payment_instrument_id: 'pi_1',
        url: 'https://acs.example/challenge/123'
      }),
      paymentHandlers,
      merchantOrigin: 'https://merchant.example'
    })

    expect(action).toMatchObject({
      id: 'action_1',
      type: UCP_THREE_DS_CHALLENGE_ACTION,
      presentation: 'visible_browser',
      executable: true,
      extensionVersion: UCP_STABLE_VERSION,
      paymentInstrumentId: 'pi_1',
      url: 'https://acs.example/challenge/123',
      allowedOrigins: ['https://acs.example', 'https://payments.example']
    })
  })

  it('blocks a payment-authentication URL that is not authorized by the handler', () => {
    const [action] = prepareUcpCheckoutActions({
      checkout: checkoutWithAction(UCP_DEVICE_DATA_COLLECTION_ACTION, {
        payment_instrument_id: 'pi_1',
        url: 'https://attacker.example/collect'
      }),
      paymentHandlers,
      merchantOrigin: 'https://merchant.example'
    })

    expect(action).toMatchObject({
      presentation: 'unsupported',
      executable: false,
      paymentInstrumentId: 'pi_1'
    })
  })

  it('does not trust a merchant-origin payment-authentication URL unless the handler authorizes it', () => {
    const [action] = prepareUcpCheckoutActions({
      checkout: checkoutWithAction(UCP_THREE_DS_CHALLENGE_ACTION, {
        payment_instrument_id: 'pi_1',
        url: 'https://merchant.example/merchant-controlled-challenge'
      }),
      paymentHandlers,
      merchantOrigin: 'https://merchant.example'
    })

    expect(action).toMatchObject({
      presentation: 'unsupported',
      executable: false,
      paymentInstrumentId: 'pi_1'
    })
  })

  it('blocks an Action when the returned extension version was not negotiated', () => {
    const [action] = prepareUcpCheckoutActions({
      checkout: checkoutWithAction(UCP_THREE_DS_CHALLENGE_ACTION, {
        payment_instrument_id: 'pi_1',
        url: 'https://acs.example/challenge/123'
      }),
      paymentHandlers: {
        ...paymentHandlers,
        activeCapabilities: {
          ...paymentHandlers.activeCapabilities,
          [UCP_PAYMENT_AUTHENTICATION_EXTENSION]: [{ version: '2026-08-04' }]
        }
      },
      merchantOrigin: 'https://merchant.example'
    })

    expect(action).toMatchObject({
      presentation: 'unsupported',
      executable: false
    })
  })

  it('exposes only inert render-artifact fields and trusted instructions', () => {
    const [action] = prepareUcpCheckoutActions({
      checkout: checkoutWithAction(MERCADO_PAGO_RENDER_ARTIFACT_ACTION, {
        type: 'qr_code',
        code: '000201010212...',
        image: 'data:image/png;base64,aGVsbG8=',
        instructions_url: 'https://payments.example/help',
        reference: 'payment-ref-1',
        html: '<script>alert(1)</script>'
      }, MERCADO_PAGO_RENDER_ARTIFACT_ACTION),
      paymentHandlers,
      merchantOrigin: 'https://merchant.example'
    })

    expect(action).toMatchObject({
      presentation: 'render_artifact',
      executable: true,
      artifact: {
        type: 'qr_code',
        code: '000201010212...',
        instructionsUrl: 'https://payments.example/help',
        reference: 'payment-ref-1'
      }
    })
    expect(action?.artifact).not.toHaveProperty('html')
  })

  it('never treats an unknown Action type as executable merchant instructions', () => {
    const [action] = prepareUcpCheckoutActions({
      checkout: checkoutWithAction('com.example.run_anything', {
        url: 'https://merchant.example/do-it',
        command: 'rm -rf /'
      }, 'com.example.run_anything'),
      paymentHandlers,
      merchantOrigin: 'https://merchant.example'
    })

    expect(action).toMatchObject({
      type: 'com.example.run_anything',
      presentation: 'unsupported',
      executable: false
    })
  })

  it('does not recognize the retired shopping payment-authentication Action namespace', () => {
    const [action] = prepareUcpCheckoutActions({
      checkout: checkoutWithAction('dev.ucp.shopping.three_ds_challenge', {
        payment_instrument_id: 'pi_1',
        url: 'https://acs.example/challenge/legacy'
      }, 'dev.ucp.shopping.payment_authentication'),
      paymentHandlers,
      merchantOrigin: 'https://merchant.example'
    })

    expect(action).toMatchObject({
      type: 'dev.ucp.shopping.three_ds_challenge',
      presentation: 'unsupported',
      executable: false
    })
  })
})
