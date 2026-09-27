import { useEffect, useRef } from 'react'
import { EmbeddedCheckoutFrame } from './EmbeddedCheckoutFrame'
import { useEmbeddedCheckout, type EmbeddedCheckoutProps } from './useEmbeddedCheckout'

export const EmbeddedCheckout = (props: EmbeddedCheckoutProps) => {
  const frame = useRef<HTMLIFrameElement>(null)
  const host = useEmbeddedCheckout(props)

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return
      host.receive(event.data, event.origin, (message) => {
        frame.current?.contentWindow?.postMessage(message, host.origin)
      })
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [host.origin, host.receive])

  return (
    <EmbeddedCheckoutFrame {...props} {...host}>
      {!host.failure && <iframe
        ref={frame}
        title={`Secure checkout with ${props.merchantName}`}
        src={host.url}
        allow="payment"
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        onError={() => host.fail('The shop’s checkout could not open here. You can continue on its site.')}
        style={{ border: 0, width: '100%', flex: 1, minHeight: 480, background: '#fff' }}
      />}
    </EmbeddedCheckoutFrame>
  )
}
