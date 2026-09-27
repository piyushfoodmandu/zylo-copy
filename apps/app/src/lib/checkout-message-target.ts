import type { PurchaseResponse } from '../types/purchase'

export type CheckoutMessageTarget = 'buyer' | 'fulfillment'

/** Merchants may identify an input error by code without supplying a JSONPath. */
export const checkoutMessageTarget = (
  message: PurchaseResponse['messages'][number]
): CheckoutMessageTarget | undefined => {
  if (message.path) {
    if (/^\$\.buyer(?:\.|\[|$)/.test(message.path)) return 'buyer'
    if (/^\$\.fulfillment(?:\.|\[|$)/.test(message.path)) return 'fulfillment'
    return undefined
  }
  if (message.code?.startsWith('buyer_identity_')) return 'buyer'
  if (message.code?.startsWith('delivery_')) return 'fulfillment'
  return undefined
}

export const checkoutHasInputErrors = (purchase: PurchaseResponse, target?: CheckoutMessageTarget) =>
  purchase.messages.some((message) => {
    if (message.presentation === 'disclosure') return false
    if (!['recoverable', 'requires_buyer_input', 'requires_buyer_review'].includes(message.resolution ?? '')) return false
    const field = checkoutMessageTarget(message)
    return Boolean(field && (!target || field === target))
  })

/** Editable field messages belong in their editor, not in a second page-level card. */
export const checkoutMessageHasEditor = (message: PurchaseResponse['messages'][number], purchase: PurchaseResponse) => {
  if (message.presentation === 'disclosure' || message.severity === 'blocked' || message.url || message.imageUrl) return false
  if (['completed', 'canceled', 'unavailable'].includes(purchase.state) || purchase.checkoutStatus === 'complete_in_progress') return false
  const target = checkoutMessageTarget(message)
  if (!['recoverable', 'requires_buyer_input', 'requires_buyer_review'].includes(message.resolution ?? '')) return false
  return target === 'buyer' || (target === 'fulfillment' && Boolean(
    purchase.canAddShippingAddress || purchase.fulfillment?.methods?.some((method) => method.type === 'shipping' && method.id)
  ))
}

/** Keep merchant field errors readable without repeating the same edit button. */
export const groupCheckoutInputMessages = (messages: PurchaseResponse['messages']) => {
  const result: PurchaseResponse['messages'] = []
  const groups = new Map<CheckoutMessageTarget, number>()
  for (const message of messages) {
    const target = checkoutMessageTarget(message)
    if (!target || message.severity !== 'warning' || message.presentation === 'disclosure' ||
      message.url || message.imageUrl || (message.contentType && message.contentType !== 'plain')) {
      result.push(message)
      continue
    }
    const index = groups.get(target)
    if (index === undefined) {
      groups.set(target, result.length)
      result.push({ ...message })
    } else {
      result[index] = { ...result[index]!, text: `${result[index]!.text}\n${message.text}` }
    }
  }
  return result
}
