import { useRef } from 'react'
import { WebView } from 'react-native-webview'
import { EmbeddedCheckoutFrame } from './EmbeddedCheckoutFrame'
import { useEmbeddedCheckout, type EmbeddedCheckoutProps } from './useEmbeddedCheckout'

const installBridge = `
  window.EmbeddedCheckoutProtocolConsumer = {
    postMessage: function(message) { window.ReactNativeWebView.postMessage(message); }
  };
  true;
`

export const EmbeddedCheckout = (props: EmbeddedCheckoutProps) => {
  const view = useRef<WebView>(null)
  const host = useEmbeddedCheckout(props)
  return (
    <EmbeddedCheckoutFrame {...props} {...host}>
      {!host.failure && <WebView
        ref={view}
        source={{ uri: host.url }}
        style={{ flex: 1 }}
        injectedJavaScriptBeforeContentLoaded={installBridge}
        injectedJavaScript={installBridge}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        injectedJavaScriptForMainFrameOnly
        javaScriptCanOpenWindowsAutomatically
        sharedCookiesEnabled
        onMessage={({ nativeEvent }) => {
          let origin: string
          try { origin = new URL(nativeEvent.url).origin } catch { return }
          host.receive(nativeEvent.data, origin, (message) => {
            view.current?.injectJavaScript(`
              if (window.location.origin === ${JSON.stringify(host.origin)}) {
                window.EmbeddedCheckoutProtocol.postMessage(${JSON.stringify(message)});
              }
              true;
            `)
          })
        }}
        onError={() => host.fail('The shop’s checkout could not load. Check your connection and try again.')}
        onHttpError={({ nativeEvent }) => {
          if (nativeEvent.url === host.url) host.fail('The shop’s checkout is temporarily unavailable.')
        }}
        onContentProcessDidTerminate={() => host.fail('The checkout closed unexpectedly. Open it again to continue.')}
        onRenderProcessGone={() => host.fail('The checkout closed unexpectedly. Open it again to continue.')}
      />}
    </EmbeddedCheckoutFrame>
  )
}
