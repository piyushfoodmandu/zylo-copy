import type { SearchResponse } from '../types/catalog'

const codeCopy: Record<string, string> = {
  connectors_not_configured: 'Product search is temporarily unavailable. Try again in a moment.',
  connected_catalog_no_match: 'We could not find a close match across the shops available right now.',
  ucp_mcp_catalog_response_invalid: 'Some product details were incomplete, so we left those results out.',
  connector_catalog_sources_unavailable: 'Some shops could not be reached right now.',
  connected_catalog_sources: '',
  source_governance_limited: 'Some shops could not be reached right now.'
}

// A shopper only benefits from an error that names the blocker and the next
// move. "Try again" is wrong advice for a shop that cannot transact at all.
const requestCodeCopy: Record<string, string> = {
  api_url_missing: 'Arro is not connected to its API on this device.',
  shopper_session_unavailable: 'Checkout is temporarily unavailable. You can still compare prices and shops.',
  invalid_shopper_session: 'Your checkout session expired. Try again and Arro will start a new one.',
  purchase_not_found: 'This checkout is not available in this browser. Open it where you started it, or start again from the product page.',
  ucp_protocol_error: 'The shop could not process this request. Your checkout is still available; try again or continue with the shop.',
  ucp_merchant_rate_limited: 'This shop is temporarily limiting checkout updates. Wait before trying again, or continue with the shop.',
  commerce_directory_merchant_unresolved: 'Arro could not identify this shop well enough to check out. Pick another offer for this product.',
  ucp_transaction_not_found: 'This checkout is not available in this browser. Open it where you started it, or start again from the product page.',
  ucp_invalid_request: 'This offer cannot be checked out as selected. Pick another offer for this product.',
  purchase_completed: 'This order is already placed.',
  purchase_canceled: 'This checkout was canceled. Start again from the product page.',
  checkout_changed: 'The shop changed this checkout. Reopen it to see the current order.'
}

export const shopperSearchNotice = (response: SearchResponse | undefined) => {
  if (!response || response.state === 'ready') return undefined

  for (const message of response.messages) {
    const mapped = codeCopy[message.code]
    if (mapped) return mapped
  }

  return response.state === 'limited'
    ? 'Some shops could not be reached right now.'
    : 'We could not check enough shops to show useful results.'
}

export const shopperErrorText = (error: unknown, fallback: string) => {
  if (!(error instanceof Error)) return fallback
  const code = (error as Error & { code?: string }).code
  if (code === 'ucp_review_rejected') return error.message || fallback
  if (code && requestCodeCopy[code]) return requestCodeCopy[code]

  if (/fetch failed|network request failed|failed to fetch|networkerror/i.test(error.message)) {
    return 'Arro could not reach the service. Check your connection and try again.'
  }
  if (/timed out|timeout/i.test(error.message)) {
    return 'That took too long. Try again in a moment.'
  }

  return fallback
}
