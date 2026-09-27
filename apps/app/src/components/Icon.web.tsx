import { createElement } from 'react'
import { color as palette } from '../lib/theme'
import type { IconName } from './Icon'

/**
 * On the web these are inline SVG, not a symbol font.
 *
 * `expo-symbols` draws web icons by downloading the 941 KB Material Symbols
 * variable font and rendering private-use characters from it. That costs the
 * whole icon set before a single glyph appears, leaves every icon missing from
 * the server-rendered HTML, and pops the layout when the font finally lands.
 * Thirty inline paths weigh a few kilobytes, ship inside the first byte of the
 * document, and tint from `currentColor`.
 *
 * One geometry for every icon: a 24px box, 1.75px strokes, round caps and
 * joins. Consistency here is what stops an interface built from thirty small
 * marks looking like thirty different interfaces.
 */
const paths: Record<IconName, string> = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M16.3 16.3 20.5 20.5"/>',
  menu: '<path d="M3.5 7h17M3.5 12h17M3.5 17h17"/>',
  close: '<path d="M6 6 18 18M18 6 6 18"/>',
  compare: '<path d="M4 9h13M13.5 5.5 17 9l-3.5 3.5"/><path d="M20 15H7M10.5 11.5 7 15l3.5 3.5"/>',
  share: '<path d="M12 15.8V3.5M7.5 8 12 3.5 16.5 8"/><path d="M5 12.2v7.3h14v-7.3"/>',
  chevronRight: '<path d="m9.5 5 7 7-7 7"/>',
  chevronLeft: '<path d="m14.5 5-7 7 7 7"/>',
  chevronDown: '<path d="m5 9 7 7 7-7"/>',
  chevronUp: '<path d="m5 15 7-7 7 7"/>',
  arrowUp: '<path d="M12 20V4M5.5 10.5 12 4l6.5 6.5"/>',
  arrowRight: '<path d="M4 12h16M13.5 5.5 20 12l-6.5 6.5"/>',
  filter: '<path d="M4 7h16M7 12h10M10 17h4"/>',
  sort: '<path d="M7 4.5v15M4 16.5l3 3 3-3"/><path d="M17 19.5v-15M14 7.5l3-3 3 3"/>',
  check: '<path d="m4.5 12.5 5 5 10-11"/>',
  star: '<path d="m12 2.6 2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45-4.7-4.6 6.5-.95z" fill="currentColor" stroke="none"/>',
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.6 9.2V20.5h12.8V9.2"/><path d="M9.5 20.5V14h5v6.5"/>',
  garden: '<path d="M5 19c-2-6 2-14.2 14.6-14.6C20 17 11.6 21 6 18.6"/><path d="M5 19c2.6-5.2 6.6-8.8 11.2-10.8"/>',
  kids: '<circle cx="12" cy="6.2" r="2.8"/><path d="M9 21v-5.2H7.4l1.7-4.6a2 2 0 0 1 1.9-1.3h2a2 2 0 0 1 1.9 1.3l1.7 4.6H15V21"/>',
  toys: '<path d="M12 3c2.9 2.4 4.4 5.6 4.4 9.1 0 1.6-.3 3-.8 4.3H8.4c-.5-1.3-.8-2.7-.8-4.3C7.6 8.6 9.1 5.4 12 3z"/><circle cx="12" cy="10" r="1.9"/><path d="m8.4 14.6-2.9 2.6v3.3l3.2-1.9M15.6 14.6l2.9 2.6v3.3l-3.2-1.9"/>',
  gaming: '<path d="M8.6 7.8h6.8a5 5 0 0 1 4.9 4l.6 3.3a2.6 2.6 0 0 1-4.6 2.1l-1.2-1.6H8.9l-1.2 1.6a2.6 2.6 0 0 1-4.6-2.1l.6-3.3a5 5 0 0 1 4.9-4z"/><path d="M7.3 11v2.6M6 12.3h2.6"/><circle cx="15.3" cy="11.7" r=".95" fill="currentColor" stroke="none"/><circle cx="17.4" cy="13.6" r=".95" fill="currentColor" stroke="none"/>',
  electronics: '<rect x="2.8" y="4.4" width="18.4" height="12.2" rx="2"/><path d="M9 20.6h6M12 16.6v4"/>',
  phone: '<rect x="6.6" y="2.6" width="10.8" height="18.8" rx="2.6"/><path d="M10.6 5.7h2.8M11 18.5h2"/>',
  tv: '<rect x="2.6" y="7" width="18.8" height="13.4" rx="2"/><path d="m8 2.8 4 4.2 4-4.2"/>',
  camera: '<rect x="2.6" y="7" width="18.8" height="13.2" rx="2.6"/><path d="m8.6 7 1.4-2.6h4l1.4 2.6"/><circle cx="12" cy="13.6" r="3.6"/>',
  clothing: '<path d="M8.6 3.4 4 6.2l1.7 4.1 2.4-.9v11.2h7.8V9.4l2.4.9L20 6.2l-4.6-2.8a3.5 3.5 0 0 1-6.8 0z"/>',
  health: '<path d="M12 20.3S3.7 15.4 3.7 9.6a4.6 4.6 0 0 1 8.3-2.8 4.6 4.6 0 0 1 8.3 2.8c0 5.8-8.3 10.7-8.3 10.7z"/>',
  sports: '<path d="M2.8 12h3.7l2.6-6.6 3.9 13 2.5-6.4h5.7"/>',
  diy: '<path d="M16 3.2a5.4 5.4 0 0 0-4.9 7.7L4 18a2.1 2.1 0 0 0 3 3l7.1-7.1a5.4 5.4 0 0 0 6.7-6.8l-3 3-2.8-.6-.6-2.8z"/>',
  mobility: '<path d="m5.2 13.4 1.7-4.5a2 2 0 0 1 1.9-1.3h6.4a2 2 0 0 1 1.9 1.3l1.7 4.5"/><rect x="3" y="13.4" width="18" height="5.2" rx="1.8"/><circle cx="7.4" cy="18.6" r="1.6"/><circle cx="16.6" cy="18.6" r="1.6"/>',
  cart: '<circle cx="9.6" cy="20" r="1.5"/><circle cx="17.4" cy="20" r="1.5"/><path d="M2.6 3.6h2.7L7.8 15.2h10.4L21 7.2H6"/>',
  external: '<path d="M14 3.6h6.4V10"/><path d="M20.4 3.6 11.6 12.4"/><path d="M18 14.4V19a1.6 1.6 0 0 1-1.6 1.6H5a1.6 1.6 0 0 1-1.6-1.6V7.6A1.6 1.6 0 0 1 5 6h4.6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11.2v5.4"/><circle cx="12" cy="7.9" r="1.05" fill="currentColor" stroke="none"/>',
  store: '<path d="M5.4 9.4V20.5h13.2V9.4"/><path d="M4.6 3.8h14.8l1.8 5.6H2.8z"/><path d="M9.6 20.5V14.6h4.8v5.9"/>',
  payments: '<rect x="2.6" y="5" width="18.8" height="14" rx="2.6"/><path d="M2.6 9.8h18.8"/><path d="M6.2 14.8h4"/>',
  lock: '<rect x="4.4" y="10" width="15.2" height="10.6" rx="2.6"/><path d="M8 10V7.6a4 4 0 0 1 8 0V10"/>',
  refresh: '<path d="M20.3 12a8.3 8.3 0 1 1-2.7-6.1"/><path d="M20.6 3.4v5.7h-5.7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6.8V12l3.5 2.2"/>',
  shield: '<path d="m12 3 7.6 3v5.6c0 4.5-3.1 8-7.6 9.4-4.5-1.4-7.6-4.9-7.6-9.4V6z"/><path d="m8.7 12.1 2.4 2.4 4.2-4.7"/>',
  heart: '<path d="M12 20.3S3.7 15.4 3.7 9.6a4.6 4.6 0 0 1 8.3-2.8 4.6 4.6 0 0 1 8.3 2.8c0 5.8-8.3 10.7-8.3 10.7z"/>',
  heartFill: '<path d="M12 20.3S3.7 15.4 3.7 9.6a4.6 4.6 0 0 1 8.3-2.8 4.6 4.6 0 0 1 8.3 2.8c0 5.8-8.3 10.7-8.3 10.7z" fill="currentColor" stroke="none"/>',
  plus: '<path d="M12 4.8v14.4M4.8 12h14.4"/>',
  minus: '<path d="M4.8 12h14.4"/>',
  trash: '<path d="M4 6.4h16"/><path d="M9.4 6.4V4.8a1.3 1.3 0 0 1 1.3-1.3h2.6a1.3 1.3 0 0 1 1.3 1.3v1.6"/><path d="m6.3 6.4.9 12.4a1.8 1.8 0 0 0 1.8 1.7h6a1.8 1.8 0 0 0 1.8-1.7l.9-12.4"/><path d="M10.4 10.4v6.2M13.6 10.4v6.2"/>',
  trendingUp: '<path d="m3 17 6.4-6.4 3.5 3.5L20.8 7"/><path d="M20.8 12V7h-5"/>',
  trendingDown: '<path d="m3 7 6.4 6.4 3.5-3.5 7.9 7.9"/><path d="M20.8 12v5.8h-5"/>',
  history: '<path d="M3.4 9.6a9 9 0 1 1-.4 3.6"/><path d="M3 4v5.6h5.6"/><path d="M12 7.6V12l3.3 2"/>',
  sparkle: '<path d="m11.2 3 1.8 4.8 4.8 1.8-4.8 1.8-1.8 4.8-1.8-4.8L4.6 9.6l4.8-1.8z"/><path d="m18.2 15.2.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/>',
  tag: '<path d="M3.6 11.3V4.9a1.3 1.3 0 0 1 1.3-1.3h6.4a1.3 1.3 0 0 1 .9.4l8 8a1.3 1.3 0 0 1 0 1.8l-6.4 6.4a1.3 1.3 0 0 1-1.8 0l-8-8a1.3 1.3 0 0 1-.4-.9z"/><circle cx="7.9" cy="7.9" r="1.35"/>',
  truck: '<path d="M2.6 6.4h10.6v10.2H2.6z"/><path d="M13.2 9.8h4.1l3.5 3.6v3.2h-7.6z"/><circle cx="7" cy="18.4" r="1.8"/><circle cx="17" cy="18.4" r="1.8"/>',
  alert: '<path d="M12 4.2 20.6 19a1.1 1.1 0 0 1-.9 1.6H4.3a1.1 1.1 0 0 1-1-1.6z"/><path d="M12 9.8v4.4"/><circle cx="12" cy="17.4" r="1.05" fill="currentColor" stroke="none"/>',
  bell: '<path d="M18 9.4a6 6 0 1 0-12 0c0 4.2-1.6 5.6-1.6 5.6h15.2S18 13.6 18 9.4z"/><path d="M13.7 19a2 2 0 0 1-3.4 0"/>',
  bellFill: '<path d="M18 9.4a6 6 0 1 0-12 0c0 4.2-1.6 5.6-1.6 5.6h15.2S18 13.6 18 9.4z" fill="currentColor"/><path d="M13.7 19a2 2 0 0 1-3.4 0"/>',
  // Placeholders only: the coloured brand geometry lives in BrandMark.web.
  google: '<circle cx="12" cy="12" r="8"/><path d="M12 10.5h4.5"/>',
  apple: '<path d="M15.5 12.8c0-2 1.6-3 1.7-3-.9-1.4-2.4-1.5-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.3 2-1.4 2.4-.4 6 1 7.9.7 1 1.5 2 2.5 2 1 0 1.4-.6 2.6-.6s1.5.6 2.6.6c1.1 0 1.8-1 2.4-2 .8-1.1 1.1-2.2 1.1-2.2s-2.1-.8-2.1-3.1z"/>',
  grid: '<rect x="3.4" y="3.4" width="7.2" height="7.2" rx="1.6"/><rect x="13.4" y="3.4" width="7.2" height="7.2" rx="1.6"/><rect x="3.4" y="13.4" width="7.2" height="7.2" rx="1.6"/><rect x="13.4" y="13.4" width="7.2" height="7.2" rx="1.6"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m15.8 8.2-2.1 5.5-5.5 2.1 2.1-5.5z"/>',
  person: '<circle cx="12" cy="8" r="3.6"/><path d="M4.6 20.4a7.4 7.4 0 0 1 14.8 0"/>'
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
  return createElement('svg', {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: color,
    strokeWidth: 1.75,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    // The accessible name always comes from the control that owns the icon, so
    // the mark itself must stay out of the accessibility tree entirely.
    'aria-hidden': true,
    focusable: false,
    style: { display: 'block', flexShrink: 0, color },
    dangerouslySetInnerHTML: { __html: paths[name] }
  })
}
