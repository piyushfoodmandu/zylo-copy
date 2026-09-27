import { embeddedCheckoutPresentation, type PurchaseAction } from '@arro/contracts'

/** Provider-specific presentation adapters do not change UCP checkout execution. */
export const checkoutPresentation = (checkout: Record<string, unknown>): NonNullable<PurchaseAction['presentation']> => {
  const embedded = embeddedCheckoutPresentation(checkout)
  if (embedded) return embedded

  const ucp = checkout.ucp as { payment_handlers?: Record<string, unknown> } | undefined
  // Shopify-owned handler declarations are checkout evidence. A /checkout URL,
  // the catalog source, or support for Visa/Stripe is not provider identity.
  const shopify = ['dev.shopify.card', 'dev.shopify.shop_pay'].some((namespace) => {
    const handlers = ucp?.payment_handlers?.[namespace]
    return Array.isArray(handlers) && handlers.length > 0
  })
  return shopify ? { type: 'native_checkout', provider: 'shopify' } : { type: 'browser' }
}
