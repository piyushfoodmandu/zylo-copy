import { Stack, useSegments } from 'expo-router'
import { useState } from 'react'
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context'
import { useDeviceState } from '../lib/device-state'
import { color } from '../lib/theme'
import { StripeRedirectHandler } from '../payments/StripeRedirectHandler'
import { SearchOverlay } from './SearchOverlay'
import { TabBar } from './TabBar'

const stackScreenOptions = {
  headerBackButtonDisplayMode: 'minimal' as const,
  headerShadowVisible: false,
  headerStyle: { backgroundColor: color.white },
  headerTintColor: color.ink950,
  headerTitleStyle: { fontWeight: '600' as const },
  contentStyle: { backgroundColor: color.white }
}

/**
 * The native shell deliberately has no website header, mega menu, breadcrumbs
 * or floating utility panel. React Navigation owns titles and back behavior;
 * the bottom destinations stay reachable with a safe-area-aware tab bar.
 *
 * NativeTabs needs each visible tab to own a nested route subtree. Arro's
 * current public routes are flat, so introducing it here would make product,
 * category and query URLs unreachable unless the entire route graph moved at
 * once. This shell is the safe intermediate step: native stack semantics now,
 * route groups and NativeTabs in a focused follow-up migration.
 */
export function NativeAppShell() {
  const segments = useSegments()
  const [searchOpen, setSearchOpen] = useState(false)
  useDeviceState()

  const focusedCheckout = segments[0] === 'checkout'

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StripeRedirectHandler />
      <SafeAreaView edges={['left', 'right']} style={{ flex: 1, backgroundColor: color.white }}>
        <Stack screenOptions={stackScreenOptions}>
          <Stack.Screen name="index" options={{ title: 'Discover' }} />
          <Stack.Screen name="c/[category]" options={{ title: 'Category' }} />
          <Stack.Screen name="search/[query]" options={{ title: 'Search results' }} />
          <Stack.Screen name="p/[slug]/[id]" options={{ title: 'Product' }} />
          <Stack.Screen name="compare" options={{ title: 'Compare' }} />
          <Stack.Screen name="saved" options={{ title: 'Saved' }} />
          <Stack.Screen name="cart" options={{ title: 'Cart' }} />
          <Stack.Screen name="checkout" options={{ headerShown: false }} />
          <Stack.Screen name="account" options={{ title: 'You' }} />
          <Stack.Screen name="+not-found" options={{ title: 'Not found' }} />
        </Stack>
        {focusedCheckout ? null : <TabBar onOpenSearch={() => setSearchOpen(true)} />}
      </SafeAreaView>
      <SearchOverlay visible={searchOpen} onClose={() => setSearchOpen(false)} />
    </SafeAreaProvider>
  )
}
