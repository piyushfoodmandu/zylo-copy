import {
  assertUcpOrderWebhookEvent,
  createPaymentHandlerRegistry,
  createUcpClient,
  UCP_CLIENT_PROTOCOL_VERSION
} from './index.ts'
import {
  businessProfile,
  createReferenceMerchantFetch,
  platformProfile,
  referenceProcessorTokenizerVersion,
  type ReferenceMerchantState
} from './reference-merchant.test-support.ts'

type VerificationMode =
  | 'protocol'
  | 'checkout'
  | 'payment-handlers'
  | 'order-webhooks'
  | 'idempotency-recovery'

const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) throw new Error(message)
}

const state: ReferenceMerchantState = {
  createCalls: 0,
  completeCalls: 0,
  idempotencyKeys: []
}

const client = createUcpClient({
  fetch: createReferenceMerchantFetch(state),
  platformProfileUrl: 'https://arro.example/.well-known/ucp',
  platformProfile: platformProfile()
})

const mode = (process.argv[2] ?? 'protocol') as VerificationMode
const negotiation = await client.negotiate(platformProfile(), await client.discover('merchant.example'))

if (mode === 'protocol') {
  assert(
    negotiation.version === UCP_CLIENT_PROTOCOL_VERSION,
    `Expected exact UCP ${UCP_CLIENT_PROTOCOL_VERSION} negotiation.`
  )
  assert(negotiation.transport === 'rest', 'Expected REST as primary negotiated checkout transport.')
  assert(Boolean(negotiation.capabilities['dev.ucp.shopping.checkout']), 'Expected checkout capability intersection.')
  assert(Boolean(negotiation.paymentHandlers['com.example.processor_tokenizer']), 'Expected payment-handler intersection.')
  console.log('Validated UCP profile discovery, stable-version negotiation, REST transport selection, checkout capability intersection, and payment-handler intersection.')
}

if (mode === 'checkout') {
  const checkout = await client.createCheckout({
    negotiation,
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440101',
    body: { line_items: [{ item: { id: 'sku_65w_charger' }, quantity: 1 }] }
  })
  assert(checkout.status === 'ready_for_complete', 'Expected merchant checkout to become ready_for_complete.')
  const complete = await client.completeCheckout({
    negotiation,
    checkoutId: checkout.id,
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440102',
    body: {
      payment: {
        instruments: [
          {
            handler_id: 'merchant_processor_tokenizer_1',
            type: 'card',
            selected: true,
            credential: { type: 'PAYMENT_GATEWAY', token: 'opaque-token' }
          }
        ]
      }
    }
  })
  assert(
    complete.status === 'complete_in_progress',
    'UCP complete_checkout must return the merchant checkout status, not infer completion from HTTP 2xx.'
  )
  console.log('Validated UCP create_checkout and complete_checkout without inferring payment/order completion from HTTP success.')
}

if (mode === 'payment-handlers') {
  const checkout = await client.createCheckout({
    negotiation,
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440103',
    body: { line_items: [{ item: { id: 'sku_65w_charger' }, quantity: 1 }] }
  })
  const registry = createPaymentHandlerRegistry([
    {
      adapterKind: 'processor_tokenizer',
      handlerName: 'com.example.processor_tokenizer',
      executionMode: 'client',
      supports: (declaration) => declaration.version === referenceProcessorTokenizerVersion
    }
  ])
  const support = registry.resolve({ businessProfile: businessProfile(), checkout })
  assert(support.some((handler) => handler.supported && handler.handlerName === 'com.example.processor_tokenizer'), 'Expected supported Processor Tokenizer handler.')
  assert(support.some((handler) => !handler.supported && handler.handlerName === 'com.example.unsupported_wallet'), 'Expected unsupported handler to remain explicit.')
  assert(support.some((handler) => handler.supported && handler.handlerName === 'merchant_hosted_continuation'), 'Expected merchant-hosted continuation fallback.')
  console.log('Validated payment-handler registry intersection, unsupported-handler reporting, and merchant-hosted continuation fallback.')
}

if (mode === 'order-webhooks') {
  const event = assertUcpOrderWebhookEvent({
    ucp: { version: UCP_CLIENT_PROTOCOL_VERSION, status: 'success' },
    id: 'order_1',
    checkout_id: 'chk_1',
    permalink_url: 'https://merchant.example/orders/order_1',
    currency: 'USD',
    line_items: [
      {
        id: 'li_1',
        item: { id: 'sku_65w_charger', title: '65W USB-C Charger', price: 2999 },
        quantity: { total: 1 },
        totals: [{ type: 'total', amount: 3299, currency: 'USD' }]
      }
    ],
    fulfillment: {
      events: []
    },
    totals: [{ type: 'total', amount: 3299, currency: 'USD' }]
  })
  assert(event.id === 'order_1', 'Expected full UCP Order webhook body validation.')
  const order = await client.getOrder({ negotiation, orderId: 'order_1' })
  assert(order.permalink_url === 'https://merchant.example/orders/order_1', 'Expected durable order permalink from merchant UCP order.')
  console.log('Validated UCP order retrieval and order webhook event schema for durable order continuity.')
}

if (mode === 'idempotency-recovery') {
  const checkout = await client.createCheckout({
    negotiation,
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440104',
    body: { line_items: [{ item: { id: 'sku_65w_charger' }, quantity: 1 }] }
  })
  await client.completeCheckout({
    negotiation,
    checkoutId: checkout.id,
    idempotencyKey: '550e8400-e29b-41d4-a716-446655440105',
    body: {
      payment: {
        instruments: [
          {
            handler_id: 'merchant_processor_tokenizer_1',
            type: 'card',
            selected: true,
            credential: { type: 'PAYMENT_GATEWAY', token: 'opaque-token' }
          }
        ]
      }
    }
  })
  const recovered = await client.getCheckout({ negotiation, checkoutId: checkout.id })
  assert(recovered.status === 'completed', 'Expected recovery by reading merchant-authoritative checkout status.')
  assert(state.idempotencyKeys.includes('550e8400-e29b-41d4-a716-446655440104'), 'Expected create idempotency key forwarding.')
  assert(state.idempotencyKeys.includes('550e8400-e29b-41d4-a716-446655440105'), 'Expected complete idempotency key forwarding.')
  console.log('Validated UCP idempotency-key forwarding and unknown-outcome recovery through get_checkout.')
}
