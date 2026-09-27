/** Purchase wire types are owned by the public contract package. */
export type {
  PurchaseExecutionLevel,
  PurchaseState,
  PurchaseAction,
  PurchasePendingAction,
  PurchaseResponse,
  PurchaseClientCapabilities,
  PurchaseClientPlatform,
  PurchaseFulfillmentGroupSelection,
  PurchaseFulfillmentMethodSelection,
  PurchasePaymentActionCreateRequest,
  PurchasePaymentActionResult,
  PurchasePaymentActionResultRequest,
  PurchasePaymentActionResponse,
  PurchaseReviewUpdateRequest,
  PurchaseShippingDestinationInput,
  StripePaymentActionSession,
  UcpBuyer,
  UcpDescription,
  UcpFulfillmentDestination,
  UcpFulfillmentGroup,
  UcpFulfillmentMethod,
  UcpFulfillmentOption,
  UcpLink,
  UcpPolicy,
  UcpPostalAddress,
  UcpShippingDestination
} from '@arro/contracts'

/** The short-lived shopper bootstrap response belongs to the auth route. */
export type ShopperSessionResponse = {
  token: string
  expiresAt: string
}
