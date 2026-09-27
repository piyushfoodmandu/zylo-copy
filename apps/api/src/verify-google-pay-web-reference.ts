import {
  UCP_STABLE_VERSION,
  type UcpPlatformProfile,
  type UcpProfile
} from '@arro/contracts'
import {
  createReferenceMerchantFetch,
  type ReferenceMerchantState
} from '@arro/ucp-client/reference-merchant.test-support'
import {
  GOOGLE_PAY_HANDLER_NAME,
  GOOGLE_PAY_HANDLER_SCHEMA,
  GOOGLE_PAY_HANDLER_SPEC,
  GOOGLE_PAY_HANDLER_VERSION
} from './google-pay-web.ts'
import type { PaymentHandlerSpecConfig } from './payment-result-exchange.ts'
import {
  createPurchaseVerifierRuntime,
  readJsonResponse
} from './verify-purchase-runtime-fixture.ts'

const failures: string[] = []
const assert = (condition: unknown, message: string) => {
  if (!condition) failures.push(message)
}

const googleConfig = {
  api_version: 2,
  api_version_minor: 0,
  environment: 'TEST',
  merchant_info: {
    merchant_id: '01234567890123456789',
    merchant_name: 'Reference Merchant',
    merchant_origin: 'merchant.example'
  },
  allowed_payment_methods: [{
    type: 'CARD',
    parameters: {
      allowed_auth_methods: ['PAN_ONLY'],
      allowed_card_networks: ['VISA', 'MASTERCARD']
    },
    tokenization_specification: {
      type: 'PAYMENT_GATEWAY',
      parameters: {
        gateway: 'example',
        gatewayMerchantId: 'reference-merchant'
      }
    }
  }]
}

const paymentHandlers = {
  [GOOGLE_PAY_HANDLER_NAME]: [{
    id: 'merchant_google_pay_1',
    version: GOOGLE_PAY_HANDLER_VERSION,
    spec: GOOGLE_PAY_HANDLER_SPEC,
    schema: GOOGLE_PAY_HANDLER_SCHEMA,
    available_instruments: [{
      type: 'card',
      constraints: {
        properties: {
          brand: { enum: ['visa', 'mastercard'] }
        }
      }
    }],
    config: googleConfig
  }]
}

function profile(merchant: true): UcpProfile
function profile(merchant: false): UcpPlatformProfile
function profile(merchant: boolean): UcpProfile | UcpPlatformProfile {
  const ucp = {
    version: UCP_STABLE_VERSION,
    capabilities: {
      'dev.ucp.shopping.cart': [{
        version: UCP_STABLE_VERSION,
        spec: `https://ucp.dev/${UCP_STABLE_VERSION}/specification/shopping/cart`,
        schema: `https://ucp.dev/${UCP_STABLE_VERSION}/schemas/shopping/cart.json`
      }],
      'dev.ucp.shopping.checkout': [{
        version: UCP_STABLE_VERSION,
        spec: `https://ucp.dev/${UCP_STABLE_VERSION}/specification/shopping/checkout`,
        schema: `https://ucp.dev/${UCP_STABLE_VERSION}/schemas/shopping/checkout.json`
      }],
      'dev.ucp.shopping.order': [{
        version: UCP_STABLE_VERSION,
        spec: `https://ucp.dev/${UCP_STABLE_VERSION}/specification/shopping/order`,
        schema: `https://ucp.dev/${UCP_STABLE_VERSION}/schemas/shopping/order.json`
      }]
    }
  }
  if (merchant) {
    return {
      ucp: {
        ...ucp,
        services: {
          'dev.ucp.shopping': [{
            version: UCP_STABLE_VERSION,
            transport: 'rest',
            endpoint: 'https://merchant.example/ucp',
            spec: `https://ucp.dev/${UCP_STABLE_VERSION}/specification/overview`,
            schema: `https://ucp.dev/${UCP_STABLE_VERSION}/services/shopping/rest.openapi.json`
          }]
        },
        payment_handlers: paymentHandlers
      }
    }
  }
  return {
    ucp: {
      ...ucp,
      services: {
        'dev.ucp.shopping': [{
          version: UCP_STABLE_VERSION,
          transport: 'rest',
          spec: `https://ucp.dev/${UCP_STABLE_VERSION}/specification/overview`,
          schema: `https://ucp.dev/${UCP_STABLE_VERSION}/services/shopping/rest.openapi.json`
        }]
      },
      payment_handlers: {
        [GOOGLE_PAY_HANDLER_NAME]: [{
          ...paymentHandlers[GOOGLE_PAY_HANDLER_NAME][0]!,
          id: 'arro_google_pay_web'
        }]
      }
    }
  }
}

const googleSpecs: PaymentHandlerSpecConfig[] = [{
  adapterKind: 'google_pay',
  handlerName: GOOGLE_PAY_HANDLER_NAME,
  platformHandlerId: 'arro_google_pay_web',
  versions: [GOOGLE_PAY_HANDLER_VERSION],
  specification: GOOGLE_PAY_HANDLER_SPEC,
  schema: GOOGLE_PAY_HANDLER_SCHEMA,
  environment: 'TEST',
  handlerConfig: googleConfig,
  lifecyclePolicy: {
    rejectReusable: true,
    requiresCheckoutScope: true,
    requiresMerchantOriginScope: true,
    requiresExpiry: true
  }
}]

const runId = `verify-google-pay-web-reference-${Date.now()}`
const state: ReferenceMerchantState = {
  createCalls: 0,
  completeCalls: 0,
  idempotencyKeys: []
}
const referenceOrderId = `order_google_${Date.now()}`
const merchantFetch = createReferenceMerchantFetch(state, {
  profile: profile(true),
  completeImmediately: true,
  orderId: referenceOrderId
})
const runtime = await createPurchaseVerifierRuntime({
  runLabel: runId,
  merchantFetch,
  state,
  platformProfileOverride: profile(false),
  paymentHandlerSpecs: googleSpecs,
  googlePayAllowedOrigins: ['https://arro.example'],
  hostOverrides: {
    presentationModes: ['external_action', 'merchant_hosted'],
    paymentProviderKinds: ['google_pay', 'merchant_hosted'],
    authorizationProviderKinds: ['user_approval_action'],
    handlerNames: [GOOGLE_PAY_HANDLER_NAME],
    allowedReturnOrigins: ['https://arro.example'],
    autonomousExecutionAllowed: false
  }
})

try {
  const prepare = await readJsonResponse(await runtime.app.handle(runtime.jsonRequest('/v1/purchases/prepare', 'POST', {
    merchantProfileUrl: 'https://merchant.example/.well-known/ucp',
    selectedOffer: {
      variantId: 'sku_65w_charger',
      title: '65W USB-C Charger',
      quantity: 1
    },
    agentContext: runtime.agentContext('write:purchase')
  }, {
    'Idempotency-Key': runtime.idempotencyKey('prepare')
  })))
  assert(prepare.status === 200, `Google Pay purchase prepare expected 200, got ${prepare.status}: ${JSON.stringify(prepare.body)}`)
  const purchaseId = typeof prepare.body.purchaseId === 'string' ? prepare.body.purchaseId : undefined
  const snapshotHash = typeof prepare.body.checkoutSnapshotHash === 'string' ? prepare.body.checkoutSnapshotHash : undefined
  assert(purchaseId && snapshotHash, 'Google Pay reference flow requires a durable purchase and Checkout snapshot.')

  const action = purchaseId
    ? await readJsonResponse(await runtime.app.handle(runtime.jsonRequest(`/v1/purchases/${purchaseId}/payment-actions`, 'POST', {
        preference: {
          provider: GOOGLE_PAY_HANDLER_NAME,
          mode: 'google_pay'
        },
        returnUrl: 'https://arro.example/payment/return',
        agentContext: runtime.agentContext('write:purchase')
      }, {
        'Idempotency-Key': runtime.idempotencyKey('action')
      })))
    : { status: 500, body: {} }
  assert(action.status === 200, `Google Pay action expected 200, got ${action.status}: ${JSON.stringify(action.body)}`)
  const actionToken = typeof action.body.actionToken === 'string' ? action.body.actionToken : undefined
  assert(actionToken, 'Google Pay reference flow requires a signed action token.')
  assert(action.body.actionType === 'google_pay', 'Google Pay action must preserve its route identity.')
  assert((action.body.action as Record<string, unknown> | undefined)?.kind === 'google_pay', 'Google Pay action must use the shared Google Pay presentation contract.')

  const actionPage = actionToken
    ? await runtime.app.handle(new Request(`http://localhost/v1/payment-actions/${actionToken}`, {
        headers: { accept: 'text/html' }
      }))
    : new Response('', { status: 500 })
  const actionHtml = await actionPage.text()
  assert(actionPage.status === 200, `Google Pay signed action page expected 200, got ${actionPage.status}.`)
  for (const marker of [
    'https://pay.google.com/gp/p/js/pay.js',
    'new google.payments.api.PaymentsClient',
    'isReadyToPay',
    'createButton',
    'loadPaymentData',
    "type: 'google_pay_payment_data'"
  ]) {
    assert(actionHtml.includes(marker), `Google Pay signed action page is missing ${marker}.`)
  }

  const paymentToken = JSON.stringify({
    signature: 'google-pay-reference-signature',
    protocolVersion: 'ECv2',
    signedMessage: 'opaque-reference-payment-data'
  })
  const result = actionToken
    ? await readJsonResponse(await runtime.app.handle(runtime.jsonRequest(`/v1/payment-actions/${actionToken}/result`, 'POST', {
        result: {
          type: 'google_pay_payment_data',
          source: 'web',
          paymentData: {
            apiVersion: 2,
            apiVersionMinor: 0,
            paymentMethodData: {
              type: 'CARD',
              description: 'Visa ending 4242',
              info: {
                cardNetwork: 'VISA',
                cardDetails: '4242'
              },
              tokenizationData: {
                type: 'PAYMENT_GATEWAY',
                token: paymentToken
              }
            }
          }
        }
      }, {
        'Idempotency-Key': runtime.idempotencyKey('result'),
        origin: 'https://arro.example'
      })))
    : { status: 500, body: {} }
  assert(result.status === 200, `Google Pay result expected 200, got ${result.status}: ${JSON.stringify(result.body)}`)
  assert(!JSON.stringify(result.body).includes(paymentToken), 'Google Pay result response must not echo tokenized payment data.')

  const confirm = purchaseId && snapshotHash
    ? await readJsonResponse(await runtime.app.handle(runtime.jsonRequest(`/v1/purchases/${purchaseId}/confirm`, 'POST', {
        approvalRef: `google-pay-user-approval-${runId}`,
        checkoutSnapshotHash: snapshotHash,
        agentContext: runtime.agentContext('write:complete_purchase')
      }, {
        'Idempotency-Key': runtime.idempotencyKey('confirm')
      })))
    : { status: 500, body: {} }
  assert(confirm.status === 200, `Google Pay confirm expected 200, got ${confirm.status}: ${JSON.stringify(confirm.body)}`)
  assert(confirm.body.state === 'completed', 'Google Pay reference flow must reach merchant-authoritative completed state.')
  const nextAction = confirm.body.nextAction as Record<string, unknown> | undefined
  assert(nextAction?.type === 'view_order', 'Completed Google Pay purchase must expose the merchant Order continuation action.')
  const order = await runtime.store.readOrder(referenceOrderId, 'https://merchant.example')
  assert(order?.id === referenceOrderId, 'Google Pay reference flow must durably persist the merchant Order.')
  assert(state.completeCalls === 1, 'Google Pay reference flow must call merchant completion exactly once.')
  const completedInstrument = ((state.lastCompleteBody as Record<string, unknown> | undefined)?.payment as {
    instruments?: Array<Record<string, unknown>>
  } | undefined)?.instruments?.[0]
  assert(completedInstrument?.handler_id === 'merchant_google_pay_1', 'Merchant completion must receive the exact negotiated Google Pay handler id.')

  const retry = purchaseId && snapshotHash
    ? await readJsonResponse(await runtime.app.handle(runtime.jsonRequest(`/v1/purchases/${purchaseId}/confirm`, 'POST', {
        approvalRef: `google-pay-user-approval-${runId}`,
        checkoutSnapshotHash: snapshotHash,
        agentContext: runtime.agentContext('write:complete_purchase')
      }, {
        'Idempotency-Key': runtime.idempotencyKey('confirm')
      })))
    : { status: 500, body: {} }
  assert(retry.status === 200 && retry.body.state === 'completed', 'Google Pay semantic retry must recover the completed purchase.')
  assert(state.completeCalls === 1, 'Google Pay semantic retry must not execute merchant completion twice.')

  const stored = purchaseId ? await runtime.store.readLatestPaymentResult(purchaseId) : undefined
  assert(!JSON.stringify(stored ?? {}).includes(paymentToken), 'Ordinary Postgres payment-result state must not contain Google Pay token data.')

  if (failures.length > 0) {
    console.error(JSON.stringify({ status: 'failed', runId, failures }, null, 2))
    process.exitCode = 1
  } else {
    console.log(JSON.stringify({
      status: 'passed',
      route: 'arro_google_pay_web_reference',
      purchaseId,
      orderId: referenceOrderId,
      merchantCompletionCalls: state.completeCalls,
      proof: 'signed action page -> exact Google payment data -> consume-once vault -> merchant Order'
    }))
  }
} finally {
  await runtime.close()
}
