import { useRouter, type ErrorBoundaryProps } from 'expo-router'
import { Platform, ScrollView, Text, View } from 'react-native'
import { Shell } from './Page'
import { Heading } from './semantic'
import { Button } from './ui'

/** Calm recovery UI for source failures and stale catalogue links. */
export function CatalogRouteError({
  error,
  retry
}: {
  error: Error
  retry?: ErrorBoundaryProps['retry']
}) {
  const router = useRouter()
  const missing = /not found|(?:^|\D)404(?:\D|$)/i.test(error.message)
  const tryAgain = () => {
    // Expo caches a rejected web loader. Clearing the React boundary alone
    // immediately rethrows that same rejection; a document reload is what
    // creates a fresh request. Native route errors are ordinary render errors
    // and can use the boundary retry directly.
    if (Platform.OS === 'web' && typeof location !== 'undefined') {
      location.reload()
      return
    }
    if (retry) void retry()
    else router.replace('/')
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Shell className="max-w-[760px] flex-1 py-12 md:py-16">
        <Heading level={1} className="text-[26px] font-bold leading-8 text-ink-950 md:text-[34px] md:leading-10">
          {missing ? 'We could not find this page' : 'This page is temporarily unavailable'}
        </Heading>
        <Text className="mt-2 max-w-[540px] text-[15px] leading-6 text-ink-600">
          {missing
            ? 'The category, search or product may have moved. Search again or return to Discover.'
            : 'One or more shops did not answer in time. Nothing was changed; try the request again.'}
        </Text>
        <View className="mt-6 flex-row flex-wrap gap-2.5">
          <Button variant="accent" onPress={tryAgain}>Try again</Button>
          <Button variant="outline" onPress={() => router.replace('/')}>Discover</Button>
        </View>
      </Shell>
    </ScrollView>
  )
}
