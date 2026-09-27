import { Text, View } from 'react-native'
import { useLayoutMode } from '../lib/layout'
import { color } from '../lib/theme'
import { Icon } from './Icon'
import { ProductLink } from './ProductLink'
import { List, ListItem, Nav } from './semantic'

export type Crumb = {
  name: string
  /** Omitted on the current page, which is a label rather than a destination. */
  href?: string
}

/**
 * The trail a crawler reads and the trail a shopper sees are the same trail.
 * Emitting `BreadcrumbList` structured data for a path the page never shows is
 * the same failure as any other machine-readable claim that outruns the visible
 * document, so every crumb here is a real anchor to a page that exists.
 *
 * On a phone the middle collapses rather than wrapping to three lines: the
 * useful ends of a trail are where it started and where you are.
 */
export function Breadcrumb({
  trail,
  className = '',
  hideCurrentOnCompact = false
}: {
  trail: Crumb[]
  className?: string
  /** Product titles already appear as the next h1; omit that duplicate row on a phone. */
  hideCurrentOnCompact?: boolean
}) {
  const { compact } = useLayoutMode()
  if (trail.length === 0) return null

  const visibleTrail = compact && hideCurrentOnCompact ? trail.slice(0, -1) : trail
  const currentPageShown = !(compact && hideCurrentOnCompact)
  const collapsed = compact && visibleTrail.length > 3
    ? [visibleTrail[0]!, { name: '…' }, ...visibleTrail.slice(-2)]
    : visibleTrail

  return (
    <Nav label="Breadcrumb" className={className}>
      <List className="flex-row flex-wrap items-center gap-x-1 gap-y-1">
        {collapsed.map((crumb, index) => {
          const last = index === collapsed.length - 1
          const current = last && currentPageShown
          return (
            <ListItem key={`${crumb.name}:${index}`} className="flex-row items-center gap-1">
              {index > 0 ? (
                <Icon name="chevronRight" size={13} color={color.ink400} />
              ) : null}
              {crumb.href && !current ? (
                <ProductLink href={crumb.href} className="arro-underline min-h-8 justify-center">
                  <Text numberOfLines={1} className="text-[13px] font-medium leading-[18px] text-ink-600">
                    {crumb.name}
                  </Text>
                </ProductLink>
              ) : (
                <View className="min-h-8 max-w-[240px] justify-center md:max-w-[420px]">
                  <Text
                    numberOfLines={1}
                    {...(current ? { 'aria-current': 'page' as const } : {})}
                    className={`text-[13px] leading-[18px] ${current ? 'font-semibold text-ink-950' : 'text-ink-400'}`}
                  >
                    {crumb.name}
                  </Text>
                </View>
              )}
            </ListItem>
          )
        })}
      </List>
    </Nav>
  )
}
