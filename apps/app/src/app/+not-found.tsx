import { useRouter } from 'expo-router'
import type { GenerateMetadataFunction } from 'expo-server'
import { ScrollView, Text, View } from 'react-native'
import { Icon } from '../components/Icon'
import { Appear } from '../components/motion'
import { Shell } from '../components/Page'
import { ProductLink } from '../components/ProductLink'
import { Heading } from '../components/semantic'
import { SiteFooter } from '../components/SiteFooter'
import { Button } from '../components/ui'
import { browseCategories, popularSearches } from '../lib/categories'
import { categoryHref, searchHref } from '../lib/product-url'
import { pageMetadata, siteName } from '../lib/seo'
import { color } from '../lib/theme'

export const generateMetadata: GenerateMetadataFunction = () => pageMetadata({
  title: `Page not found · ${siteName}`,
  description: 'That page does not exist. Search for a product or browse a category instead.',
  path: '/',
  robots: { index: false, follow: true },
  canonicalize: false
})

/**
 * A 404 is still one of Arro's pages. The router's default is a black screen
 * with a broken-file glyph and a link to a developer sitemap — fine for a build
 * error, wrong for a shopper who mistyped a URL or followed a stale link.
 *
 * It keeps the site chrome, says what happened in one line, and offers the two
 * things that actually recover the visit: a search and the category list. It is
 * `noindex, follow` so the links are still crawled while the page itself is not.
 */
export default function NotFoundRoute() {
  const router = useRouter()

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1 }}>
      <Shell className="max-w-[880px] flex-1 py-12 md:py-16">
        <Appear>
          <View className="h-12 w-12 items-center justify-center rounded-full bg-fill">
            <Icon name="compass" size={22} color={color.ink600} />
          </View>
          <Heading level={1} className="mt-5 text-[28px] font-bold leading-9 tracking-[-0.8px] text-ink-950 md:text-[36px] md:leading-[42px]">
            This page has moved on
          </Heading>
          <Text className="mt-2 max-w-[520px] text-[15px] leading-6 text-ink-600">
            The link you followed does not point anywhere on Arro. Products come and go from shops, so an old product
            link can expire too.
          </Text>

          <View className="mt-6 flex-row flex-wrap gap-2.5">
            <Button variant="accent" icon="search" onPress={() => router.push('/')}>Search products</Button>
            <Button variant="outline" onPress={() => router.back()}>Go back</Button>
          </View>
        </Appear>

        <Appear delay={60} className="mt-12">
          <Text className="mb-3 text-[12px] font-semibold uppercase leading-4 tracking-[0.6px] text-ink-400">
            Popular searches
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {popularSearches.slice(0, 6).map((item) => (
              <ProductLink
                key={item}
                href={searchHref(item)}
                className="arro-card min-h-10 justify-center rounded-full border border-line bg-white px-4"
              >
                <Text className="text-[14px] font-medium leading-5 text-ink-800">{item}</Text>
              </ProductLink>
            ))}
          </View>
        </Appear>

        <Appear delay={100} className="mt-10">
          <Text className="mb-3 text-[12px] font-semibold uppercase leading-4 tracking-[0.6px] text-ink-400">
            Browse
          </Text>
          <View className="flex-row flex-wrap gap-2.5">
            {browseCategories.slice(0, 6).map((category) => (
              <ProductLink
                key={category.query}
                href={categoryHref(category.query)}
                label={`Browse ${category.label}`}
                className="arro-card min-h-11 flex-row items-center gap-2.5 rounded-2xl border border-line bg-white px-3.5"
              >
                <Icon name={category.icon} size={17} color={color.arro600} />
                <Text className="text-[14px] font-medium leading-5 text-ink-800">{category.label}</Text>
              </ProductLink>
            ))}
          </View>
        </Appear>
      </Shell>

      <SiteFooter className="mt-10" />
    </ScrollView>
  )
}
