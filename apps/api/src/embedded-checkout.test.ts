import { describe, expect, it, vi } from 'vitest'
import { UCP_STABLE_VERSION, type UcpCheckout } from '@arro/contracts'
import {
  createEmbeddedCheckoutSession,
  embeddedCheckoutInitParams,
  handleEmbeddedCheckoutJsonRpc
} from './embedded-checkout.ts'

const checkout: UcpCheckout = {
  ucp: {
    version: UCP_STABLE_VERSION,
    status: 'success',
    services: { 'dev.ucp.shopping': [{ version: UCP_STABLE_VERSION, transport: 'embedded', config: { delegate: [] } }] }
  },
  id: 'chk_embedded_1',
  status: 'ready_for_complete',
  currency: 'USD',
  line_items: [],
  totals: [],
  links: [],
  continue_url: 'https://merchant.example/checkout/1'
}

describe('Embedded Checkout protocol', () => {
  it('negotiates standard initialization and responds honestly to unsupported delegation/auth', async () => {
    const session = createEmbeddedCheckoutSession({
      transactionId: 'txn_embedded_1',
      checkout,
      merchantOrigin: 'https://merchant.example',
      allowedOrigin: 'https://host.example'
    })

    expect(embeddedCheckoutInitParams(session)).toMatchObject({
      ec_version: UCP_STABLE_VERSION,
      ec_delegate: ''
    })

    await expect(handleEmbeddedCheckoutJsonRpc({
      session,
      origin: 'https://host.example',
      currentCheckout: checkout,
      refreshCheckout: vi.fn(),
      message: {
        jsonrpc: '2.0',
        id: 'ready-1',
        method: 'ec.ready',
        params: {
          delegate: []
        }
      }
    })).resolves.toMatchObject({
      response: {
        result: {
          ucp: { version: UCP_STABLE_VERSION, status: 'success' }
        }
      },
      shouldRefreshCheckout: false
    })

    await expect(handleEmbeddedCheckoutJsonRpc({
      session,
      origin: 'https://host.example',
      currentCheckout: checkout,
      refreshCheckout: vi.fn(),
      message: {
        jsonrpc: '2.0',
        id: 'delegate-1',
        method: 'ec.payment.credential_request'
      }
    })).resolves.toMatchObject({
      response: {
        error: { code: -32601 }
      }
    })

    await expect(handleEmbeddedCheckoutJsonRpc({
      session,
      origin: 'https://host.example',
      currentCheckout: checkout,
      refreshCheckout: vi.fn(),
      message: {
        jsonrpc: '2.0',
        id: 'authorize-1',
        method: 'ec.auth',
        params: { type: 'oauth' }
      }
    })).resolves.toMatchObject({
      response: {
        result: {
          ucp: { version: UCP_STABLE_VERSION, status: 'error' }
        }
      },
      shouldRefreshCheckout: false
    })
  })

  it('validates origin and never accepts client completion as merchant completion', async () => {
    const session = createEmbeddedCheckoutSession({
      transactionId: 'txn_embedded_2',
      checkout,
      merchantOrigin: 'https://merchant.example',
      allowedOrigin: 'https://host.example'
    })

    await expect(handleEmbeddedCheckoutJsonRpc({
      session,
      origin: 'https://attacker.example',
      currentCheckout: checkout,
      refreshCheckout: vi.fn(),
      message: {
        jsonrpc: '2.0',
        method: 'ec.ready'
      }
    })).rejects.toMatchObject({
      code: 'embedded_checkout_origin_invalid'
    })

    const refreshCheckout = vi.fn().mockResolvedValue({
      ...checkout,
      status: 'ready_for_complete'
    })
    const completion = await handleEmbeddedCheckoutJsonRpc({
      session,
      origin: 'https://host.example',
      currentCheckout: checkout,
      refreshCheckout,
      message: {
        jsonrpc: '2.0',
        method: 'ec.complete',
        params: {
          checkout: { ...checkout, status: 'completed', order: { id: 'unverified-client-order' } }
        }
      }
    })
    expect(completion).toMatchObject({
      clientCompletionIgnored: true,
      shouldRefreshCheckout: true
    })
    expect(completion.response).toBeUndefined()
    expect(refreshCheckout).toHaveBeenCalledOnce()
  })
})
