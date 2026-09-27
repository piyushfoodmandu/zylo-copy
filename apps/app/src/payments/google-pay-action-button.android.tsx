import {
  GooglePayButton,
  GooglePayButtonConstants
} from '@google/react-native-make-payment'
import type { ComponentProps } from 'react'
import { Pressable, View } from 'react-native'
import type { GooglePayActionButtonProps } from './google-pay-action-button'

type AllowedPaymentMethods = ComponentProps<typeof GooglePayButton>['allowedPaymentMethods']

/**
 * Google's native branded control is the only surface allowed to present a
 * preflighted host-native com.google.pay action.
 */
export function GooglePayActionButton({
  request,
  disabled,
  onPress
}: GooglePayActionButtonProps) {
  if (!GooglePayButtonConstants) return null

  const merchant = request.merchantInfo?.merchantName?.trim() || 'this merchant'
  const amount = `${request.transactionInfo.currencyCode} ${request.transactionInfo.totalPrice}`

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Pay ${amount} to ${merchant} with Google Pay`}
      accessibilityHint="Opens the Google Pay sheet for this checkout"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{ width: '100%', height: 68 }}
    >
      <View
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
      >
        <GooglePayButton
          allowedPaymentMethods={request.allowedPaymentMethods as unknown as AllowedPaymentMethods}
          type={GooglePayButtonConstants.Types.Checkout}
          theme={GooglePayButtonConstants.Themes.Dark}
          radius={12}
          disabled={disabled}
          onPress={onPress}
          style={{ width: '100%', height: 68 }}
        />
      </View>
    </Pressable>
  )
}
