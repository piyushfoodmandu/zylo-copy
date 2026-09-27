import type { PropsWithChildren } from 'react'
import { Text, View } from 'react-native'

/**
 * React Native Web maps accessibility roles onto real HTML tags, so the same
 * component tree that renders a native screen can render a document with
 * headings and landmarks. Without these, the server-rendered page is a wall of
 * `<div>`s: readable to a person, structureless to a crawler or an answer engine.
 *
 * The mapping lives in `react-native-web/dist/modules/AccessibilityUtil/propsToAccessibilityComponent`:
 * `heading` + `aria-level` becomes `h1`-`h6`, and `main`, `navigation`, `banner`,
 * `contentinfo`, `article`, `region`, `list` and `listitem` become their tags.
 */

type Level = 1 | 2 | 3 | 4 | 5 | 6

export const Heading = ({
  level,
  className,
  numberOfLines,
  children
}: PropsWithChildren<{ level: Level; className?: string; numberOfLines?: number }>) => (
  <Text
    role="heading"
    aria-level={level}
    {...(className ? { className } : {})}
    {...(numberOfLines ? { numberOfLines } : {})}
  >
    {children}
  </Text>
)

export const Main = ({ className, nativeID, tabIndex, children }: PropsWithChildren<{
  className?: string
  nativeID?: string
  tabIndex?: 0 | -1
}>) => (
  <View
    role="main"
    {...(nativeID ? { nativeID } : {})}
    {...(tabIndex !== undefined ? { tabIndex } : {})}
    {...(className ? { className } : {})}
  >
    {children}
  </View>
)

export const Nav = ({
  className,
  label,
  children
}: PropsWithChildren<{ className?: string; label?: string }>) => (
  <View
    role="navigation"
    {...(label ? { 'aria-label': label } : {})}
    {...(className ? { className } : {})}
  >
    {children}
  </View>
)

/**
 * The header owns a stacking context above the page because the search field
 * drops a panel out of it. Without this the suggestions render underneath the
 * first thing on the page with a background.
 */
export const Banner = ({ className, children }: PropsWithChildren<{ className?: string }>) => (
  <View role="banner" style={{ zIndex: 50 }} {...(className ? { className } : {})}>{children}</View>
)

export const ContentInfo = ({ className, children }: PropsWithChildren<{ className?: string }>) => (
  <View role="contentinfo" {...(className ? { className } : {})}>{children}</View>
)

export const Section = ({
  className,
  label,
  children
}: PropsWithChildren<{ className?: string; label?: string }>) => (
  <View
    role="region"
    {...(label ? { 'aria-label': label } : {})}
    {...(className ? { className } : {})}
  >
    {children}
  </View>
)

export const Article = ({ className, children }: PropsWithChildren<{ className?: string }>) => (
  <View role="article" {...(className ? { className } : {})}>{children}</View>
)

export const List = ({
  className,
  label,
  children
}: PropsWithChildren<{ className?: string; label?: string }>) => (
  <View
    role="list"
    {...(label ? { 'aria-label': label } : {})}
    {...(className ? { className } : {})}
  >
    {children}
  </View>
)

export const ListItem = ({ className, children }: PropsWithChildren<{ className?: string }>) => (
  <View role="listitem" {...(className ? { className } : {})}>{children}</View>
)
