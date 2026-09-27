/**
 * Web hands Shopify checkout to ordinary same-tab navigation. The native build
 * replaces this module with `shopify-checkout.native.ts`, where Checkout Kit
 * presents the same merchant-owned checkout inside Arro.
 */
export const preloadShopifyCheckout = (_url: string) => false

export const openShopifyCheckout = (
  _url: string
): Promise<'dismissed'> | undefined => undefined
