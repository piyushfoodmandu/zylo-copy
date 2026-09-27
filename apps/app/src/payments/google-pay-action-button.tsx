import type { MerchantGooglePayPaymentRequest } from './google-pay'

export type GooglePayActionButtonProps = {
  request: MerchantGooglePayPaymentRequest
  disabled: boolean
  onPress: () => void
}

/** iOS and web never imitate Google's payment control. */
export function GooglePayActionButton(_props: GooglePayActionButtonProps) {
  return null
}
