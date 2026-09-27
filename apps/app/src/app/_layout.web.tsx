import '../../global.css'
import { requestHeaders, setResponseHeaders } from 'expo-server'
import { Text, View } from 'react-native'
import { WebAppShell } from '../components/WebAppShell'
import { defaultServerWidth, InitialViewportProvider } from '../lib/layout'

const initialViewportGlobal = '__ARRO_INITIAL_VIEWPORT_WIDTH__'

const hintedViewportWidth = (value: string | null) => {
  const width = value ? Number(value) : Number.NaN
  return Number.isFinite(width) && width >= 240 && width <= 5120 ? Math.round(width) : undefined
}

const fallbackWidthForUserAgent = (userAgent: string) => {
  if (/iPad|Tablet|Macintosh.*Mobile|Android(?!.*Mobile)/i.test(userAgent)) return 820
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(userAgent)) return 390
  return defaultServerWidth
}

const serverViewportWidth = () => {
  try {
    const headers = requestHeaders()
    setResponseHeaders({
      'accept-ch': 'Sec-CH-Viewport-Width',
      'critical-ch': 'Sec-CH-Viewport-Width',
      'vary': 'Sec-CH-Viewport-Width, User-Agent'
    })
    return hintedViewportWidth(headers.get('sec-ch-viewport-width'))
      ?? fallbackWidthForUserAgent(headers.get('user-agent') ?? '')
  } catch {
    // Static export has no request scope. Its desktop document remains the
    // deterministic fallback and a runtime server can still tailor requests.
    return defaultServerWidth
  }
}

/**
 * Expo Router's development fallback uses a native-driver toast on the web.
 * A quiet, accessible route status is both clearer for shoppers and identical
 * in development and production.
 */
export function SuspenseFallback() {
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading page"
      className="min-h-[50vh] items-center justify-center px-4"
    >
      <Text className="text-[14px] leading-5 text-ink-500">Loading…</Text>
    </View>
  )
}

export default function RootLayout() {
  const initialWidth = typeof window === 'undefined'
    ? serverViewportWidth()
    : ((globalThis as typeof globalThis & { __ARRO_INITIAL_VIEWPORT_WIDTH__?: number })[initialViewportGlobal]
      ?? window.innerWidth
      ?? defaultServerWidth)
  const initialWidthScript = `globalThis.${initialViewportGlobal}=${JSON.stringify(initialWidth)}`

  return (
    <InitialViewportProvider width={initialWidth}>
      <script dangerouslySetInnerHTML={{ __html: initialWidthScript }} />
      <WebAppShell />
    </InitialViewportProvider>
  )
}
