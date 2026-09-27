import { useCallback, useEffect, useRef, useState } from 'react'
import {
  embeddedCheckoutUrl,
  processEmbeddedCheckoutMessage,
  type EmbeddedCheckoutPresentation,
  type EmbeddedCheckoutResponse
} from '@arro/contracts/embedded-checkout'

export type EmbeddedCheckoutProps = {
  url: string
  presentation: EmbeddedCheckoutPresentation
  merchantName: string
  onComplete: () => void
  onClose: () => void
  onOpenBrowser: (url: string) => void
}

export const useEmbeddedCheckout = (props: EmbeddedCheckoutProps) => {
  const [failure, setFailure] = useState<string>()
  const [recoveryUrl, setRecoveryUrl] = useState(props.url)
  const [active, setActive] = useState(false)
  const handshake = useRef(false)
  const ended = useRef(false)
  const onComplete = useRef(props.onComplete)
  onComplete.current = props.onComplete
  const url = embeddedCheckoutUrl(props.url, props.presentation)
  const origin = new URL(props.url).origin

  const fail = useCallback((message: string) => {
    if (ended.current) return
    ended.current = true
    setFailure(message)
  }, [])

  useEffect(() => {
    if (active || failure) return
    const timeout = setTimeout(() => fail('The shop’s checkout is taking too long to open. Try again or continue on its site.'), 20000)
    return () => clearTimeout(timeout)
  }, [active, fail, failure])

  const receive = useCallback((input: unknown, senderOrigin: string, reply: (message: EmbeddedCheckoutResponse) => void) => {
    if (senderOrigin !== origin || ended.current) return
    let result
    try {
      result = processEmbeddedCheckoutMessage(props.presentation, input)
    } catch {
      // Merchant pages may also send unrelated analytics/payment SDK messages.
      return
    }
    if (result.response) reply(result.response)
    if (result.event === 'error') {
      if (result.recoveryUrl) setRecoveryUrl(result.recoveryUrl)
      fail(result.message || 'The shop could not continue this checkout here.')
      return
    }
    if (result.event === 'ready') {
      handshake.current = true
      return
    }
    if (!handshake.current) return
    if (result.event === 'start') setActive(true)
    if (result.event === 'complete') {
      ended.current = true
      onComplete.current()
    }
  }, [fail, origin, props.presentation])

  return { url, origin, receive, fail, active, failure, recoveryUrl }
}
