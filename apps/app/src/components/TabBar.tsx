import { Link, usePathname } from 'expo-router'
import { Platform, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { cartItemCount } from '../lib/cart'
import { color } from '../lib/theme'
import { useCartStore } from '../store/useCartStore'
import { Icon, type IconName } from './Icon'
import { Nav } from './semantic'

type Tab = {
  key: string
  label: string
  icon: IconName
  activeIcon?: IconName
  href?: string
  /** Search opens in place rather than navigating away from the current page. */
  action?: 'search'
  match: (pathname: string) => boolean
}

const tabs: Tab[] = [
  {
    key: 'discover',
    label: 'Discover',
    icon: 'compass',
    href: '/',
    match: (path) => path === '/' || path.startsWith('/c/') || path.startsWith('/p/') || path.startsWith('/compare')
  },
  { key: 'search', label: 'Search', icon: 'search', action: 'search', match: (path) => path.startsWith('/search') },
  { key: 'cart', label: 'Cart', icon: 'cart', href: '/cart', match: (path) => path.startsWith('/cart') },
  {
    key: 'account',
    label: 'You',
    icon: 'person',
    href: '/account',
    match: (path) => path.startsWith('/account') || path.startsWith('/saved')
  }
]

/**
 * The phone shell puts navigation where the thumb already is. It is not a
 * smaller copy of the desktop header: the desktop header is a wide utility bar
 * with room for a mega menu, and this is four destinations and a badge.
 *
 * Every dimension here is fixed rather than minimum, because a navigation bar
 * that changes height is the one piece of furniture a shopper should never have
 * to re-find. The previous version left three ways for it to move: a `min-h` on
 * the tabs instead of a height on the bar, a top padding fighting the vertical
 * centring, and a label that switched to semibold when active — which reflows
 * the text and nudges everything beside it.
 */
const barHeight = 60
const iconBox = 32

export function TabBar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const cartCount = useCartStore((state) => cartItemCount(state.lines))
  const bottomInset = Platform.OS === 'web' ? 0 : insets.bottom

  return (
    <Nav label="Main" className="border-t border-line bg-white">
      <View
        className="flex-row"
        style={{
          height: barHeight + bottomInset,
          paddingBottom: bottomInset
        }}
      >
        {tabs.map((tab) => {
          const active = tab.match(pathname)
          const count = tab.key === 'cart' ? cartCount : 0
          const control = (
            <Pressable
              key={tab.href ? undefined : tab.key}
              accessibilityRole={Platform.OS === 'web' ? (tab.href ? 'link' : 'button') : 'tab'}
              accessibilityLabel={count ? `${tab.label}, ${count}` : tab.label}
              accessibilityState={{ selected: active }}
              // React Native Web only emits `aria-selected` for tab and option
              // roles, so a navigation link's active state never reached a
              // screen reader. `aria-current` is the attribute that carries it.
              {...(Platform.OS === 'web' && active ? { 'aria-current': 'page' as const } : {})}
              {...(tab.action === 'search' ? { onPress: onOpenSearch } : {})}
              android_ripple={{ color: color.fillStrong }}
              style={({ pressed }) => ({ opacity: pressed ? 0.68 : 1 })}
              className="flex-1 items-center justify-center gap-1"
            >
              {/* A fixed box so a badge appearing never changes the row's
                  geometry, and a tinted pill behind the active icon so the
                  state reads without touching the type. */}
              <View
                className={`items-center justify-center rounded-full ${active ? 'bg-arro-50' : ''}`}
                style={{ height: iconBox, width: iconBox + 12 }}
              >
                <Icon
                  name={active && tab.activeIcon ? tab.activeIcon : tab.icon}
                  size={21}
                  color={active ? color.arro600 : color.ink600}
                />
                {count ? (
                  <View className="absolute right-1.5 top-0.5 min-w-[16px] items-center justify-center rounded-full border-[1.5px] border-white bg-arro-600 px-1">
                    <Text className="text-[9px] font-bold leading-[15px] text-white">
                      {count > 99 ? '99+' : count}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text
                numberOfLines={1}
                className={`text-[11px] font-medium leading-[13px] ${active ? 'text-arro-700' : 'text-ink-600'}`}
              >
                {tab.label}
              </Text>
            </Pressable>
          )
          return tab.href ? (
            <Link key={tab.key} href={tab.href as '/' | '/cart' | '/account'} asChild>
              {control}
            </Link>
          ) : control
        })}
      </View>
    </Nav>
  )
}
