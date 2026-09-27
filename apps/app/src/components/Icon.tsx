import { SymbolView, type SymbolViewProps } from 'expo-symbols'
import { color as palette } from '../lib/theme'

export type IconName =
  | 'search'
  | 'menu'
  | 'close'
  | 'compare'
  | 'share'
  | 'chevronRight'
  | 'chevronLeft'
  | 'chevronDown'
  | 'chevronUp'
  | 'arrowUp'
  | 'arrowRight'
  | 'filter'
  | 'sort'
  | 'check'
  | 'star'
  | 'home'
  | 'garden'
  | 'kids'
  | 'toys'
  | 'gaming'
  | 'electronics'
  | 'phone'
  | 'tv'
  | 'camera'
  | 'clothing'
  | 'health'
  | 'sports'
  | 'diy'
  | 'mobility'
  | 'cart'
  | 'external'
  | 'info'
  | 'store'
  | 'payments'
  | 'lock'
  | 'refresh'
  | 'clock'
  | 'shield'
  | 'heart'
  | 'heartFill'
  | 'plus'
  | 'minus'
  | 'trash'
  | 'trendingUp'
  | 'trendingDown'
  | 'history'
  | 'sparkle'
  | 'tag'
  | 'truck'
  | 'alert'
  | 'bell'
  | 'bellFill'
  | 'google'
  | 'apple'
  | 'grid'
  | 'compass'
  | 'person'

const symbols: Record<IconName, SymbolViewProps['name']> = {
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  menu: { ios: 'line.3.horizontal', android: 'menu', web: 'menu' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  compare: { ios: 'arrow.left.arrow.right', android: 'compare_arrows', web: 'compare_arrows' },
  share: { ios: 'square.and.arrow.up', android: 'share', web: 'share' },
  chevronRight: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  chevronLeft: { ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' },
  chevronDown: { ios: 'chevron.down', android: 'expand_more', web: 'expand_more' },
  chevronUp: { ios: 'chevron.up', android: 'expand_less', web: 'expand_less' },
  arrowUp: { ios: 'arrow.up', android: 'arrow_upward', web: 'arrow_upward' },
  arrowRight: { ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' },
  filter: { ios: 'line.3.horizontal.decrease', android: 'filter_list', web: 'filter_list' },
  sort: { ios: 'arrow.up.arrow.down', android: 'sort', web: 'sort' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  star: { ios: 'star.fill', android: 'star', web: 'star' },
  home: { ios: 'house', android: 'home', web: 'home' },
  garden: { ios: 'leaf', android: 'yard', web: 'yard' },
  kids: { ios: 'figure.child', android: 'child_care', web: 'child_care' },
  toys: { ios: 'teddybear', android: 'toys', web: 'toys' },
  gaming: { ios: 'gamecontroller', android: 'sports_esports', web: 'sports_esports' },
  electronics: { ios: 'desktopcomputer', android: 'devices', web: 'devices' },
  phone: { ios: 'iphone', android: 'smartphone', web: 'smartphone' },
  tv: { ios: 'tv', android: 'tv', web: 'tv' },
  camera: { ios: 'camera', android: 'photo_camera', web: 'photo_camera' },
  clothing: { ios: 'tshirt', android: 'checkroom', web: 'checkroom' },
  health: { ios: 'heart', android: 'health_and_beauty', web: 'health_and_beauty' },
  sports: { ios: 'figure.run', android: 'exercise', web: 'exercise' },
  diy: { ios: 'hammer', android: 'handyman', web: 'handyman' },
  mobility: { ios: 'car', android: 'directions_car', web: 'directions_car' },
  cart: { ios: 'cart', android: 'shopping_cart', web: 'shopping_cart' },
  external: { ios: 'arrow.up.right.square', android: 'open_in_new', web: 'open_in_new' },
  info: { ios: 'info.circle', android: 'info', web: 'info' },
  store: { ios: 'storefront', android: 'storefront', web: 'storefront' },
  payments: { ios: 'creditcard', android: 'payments', web: 'payments' },
  lock: { ios: 'lock', android: 'lock', web: 'lock' },
  refresh: { ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' },
  clock: { ios: 'clock', android: 'schedule', web: 'schedule' },
  shield: { ios: 'checkmark.shield', android: 'verified_user', web: 'verified_user' },
  heart: { ios: 'heart', android: 'favorite', web: 'favorite' },
  heartFill: { ios: 'heart.fill', android: 'favorite', web: 'favorite' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  minus: { ios: 'minus', android: 'remove', web: 'remove' },
  trash: { ios: 'trash', android: 'delete', web: 'delete' },
  trendingUp: { ios: 'chart.line.uptrend.xyaxis', android: 'trending_up', web: 'trending_up' },
  trendingDown: { ios: 'chart.line.downtrend.xyaxis', android: 'trending_down', web: 'trending_down' },
  history: { ios: 'clock.arrow.circlepath', android: 'history', web: 'history' },
  sparkle: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
  tag: { ios: 'tag', android: 'sell', web: 'sell' },
  truck: { ios: 'shippingbox', android: 'local_shipping', web: 'local_shipping' },
  alert: { ios: 'exclamationmark.triangle', android: 'warning', web: 'warning' },
  bell: { ios: 'bell', android: 'notifications', web: 'notifications' },
  bellFill: { ios: 'bell.fill', android: 'notifications_active', web: 'notifications_active' },
  google: { ios: 'g.circle', android: 'login', web: 'login' },
  apple: { ios: 'apple.logo', android: 'phone_iphone', web: 'phone_iphone' },
  grid: { ios: 'square.grid.2x2', android: 'grid_view', web: 'grid_view' },
  compass: { ios: 'safari', android: 'explore', web: 'explore' },
  person: { ios: 'person', android: 'person', web: 'person' }
}

export function Icon({
  name,
  size = 20,
  color = palette.ink950
}: {
  name: IconName
  size?: number
  color?: string
}) {
  return <SymbolView name={symbols[name]} size={size} tintColor={color} />
}
