import { useSegments } from 'expo-router'
import Stack from 'expo-router/stack'
import { useState } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { useDeviceState } from '../lib/device-state'
import { color } from '../lib/theme'
import { Header } from './Header'
import { QuickPanel } from './QuickPanel'
import { SearchOverlay } from './SearchOverlay'
import { SkipLink } from './SkipLink'
import { TabBar } from './TabBar'
import { WebStyles } from './WebStyles'
import { Main } from './semantic'

/**
 * Browser chrome stays browser-native: real links, the full search header and
 * the wide-screen utility panel. Keeping this out of the universal route layout
 * prevents desktop navigation furniture from leaking into the native app.
 */
export function WebAppShell() {
  const segments = useSegments()
  const [searchOpen, setSearchOpen] = useState(false)
  useDeviceState()

  const focusedCheckout = segments[0] === 'checkout'

  return (
    <SafeAreaProvider>
      <WebStyles />
      <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={{ flex: 1, backgroundColor: color.white }}>
        <SkipLink />
        {focusedCheckout ? null : <Header onOpenSearch={() => setSearchOpen(true)} />}
        <Main nativeID="main-content" tabIndex={-1} className="flex-1 bg-white">
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.white } }} />
        </Main>
        {focusedCheckout ? null : (
          <View className="md:hidden">
            <TabBar onOpenSearch={() => setSearchOpen(true)} />
          </View>
        )}
        {focusedCheckout ? null : (
          <View className="hidden md:flex">
            <QuickPanel />
          </View>
        )}
      </SafeAreaView>
      <SearchOverlay visible={searchOpen} onClose={() => setSearchOpen(false)} />
    </SafeAreaProvider>
  )
}
