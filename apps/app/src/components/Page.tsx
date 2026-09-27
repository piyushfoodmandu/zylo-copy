import type { PropsWithChildren } from 'react'
import { View } from 'react-native'

/**
 * One horizontal frame for the whole app.
 *
 * Every page, the header and the footer measure from the same edge, so the
 * wordmark, the breadcrumb, the page title and the first product in the grid
 * all sit on one line down the left of the screen. When each surface picked its
 * own max-width and its own padding, that line moved between pages — which is
 * the kind of thing nobody points at but everybody feels.
 *
 * The gutter grows with the viewport rather than staying fixed: 16px on a
 * phone, 40px on a desktop, which is where a comparison grid stops looking
 * pinned to the window edge.
 */
export const shellClass = 'mx-auto w-full max-w-[1680px] px-4 md:px-8 lg:px-10'

/**
 * A focused task reads better at a narrower measure than a browse grid does.
 * Same gutter, shorter line.
 */
export const narrowShellClass = 'mx-auto w-full max-w-[1180px] px-4 md:px-8 lg:px-10'

export const Shell = ({ className = '', children }: PropsWithChildren<{ className?: string }>) => (
  <View className={`${shellClass} ${className}`}>{children}</View>
)
