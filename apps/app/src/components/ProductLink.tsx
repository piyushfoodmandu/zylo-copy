import type { PropsWithChildren } from 'react'
import { useRouter } from 'expo-router'
import { Pressable } from 'react-native'

/**
 * On native this is a Pressable, not Expo Router's `Link`.
 *
 * `Link` renders a `Text`, and a `Text` lays its children out **inline, like
 * words**. Every flex utility handed to it — `items-center`, `justify-center`,
 * `gap`, `flex-1` — is silently ignored, so a category tile rendered its icon
 * beside its label and pinned both to the top, and a product card ran its image
 * into its title. The layout only looked right on the web, where the `.web`
 * variant renders a real anchor.
 *
 * Crawlability is a web concern and the web build keeps its `<a href>`. Native
 * needs a View that lays out like every other View in the app.
 */
export const ProductLink = ({
  href,
  label,
  className,
  onPress,
  children
}: PropsWithChildren<{
  href: string
  label?: string
  className?: string
  onPress?: () => void
  onIntent?: () => void
}>) => {
  const router = useRouter()

  return (
    <Pressable
      accessibilityRole="link"
      {...(label ? { accessibilityLabel: label } : {})}
      {...(className ? { className } : {})}
      onPress={() => {
        onPress?.()
        router.push(href)
      }}
    >
      {children}
    </Pressable>
  )
}
