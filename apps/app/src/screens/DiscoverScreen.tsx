import { useRouter } from 'expo-router'
import { ScrollView, Text, View } from 'react-native'
import { Carousel } from '../components/Carousel'
import { Icon } from '../components/Icon'
import { Appear, Tappable } from '../components/motion'
import { ProductCard, railCardWidth } from '../components/ProductCard'
import { Shell } from '../components/Page'
import { ProductLink } from '../components/ProductLink'
import { Heading } from '../components/semantic'
import { SiteFooter } from '../components/SiteFooter'
import { SectionHeading } from '../components/ui'
import { browseCategories, type BrowseCategory } from '../lib/categories'
import { useDocumentTitle } from '../lib/document-title'
import { useLayoutMode } from '../lib/layout'
import { singleProductGroup } from '../lib/product-groups'
import type { CatalogProductSummary } from '../types/catalog'
import { categoryHref, searchHref } from '../lib/product-url'
import { SearchField } from '../components/SearchField'
import { ProductRailSkeleton } from '../components/skeletons'
import { color } from '../lib/theme'
import { useSavedStore } from '../store/useSavedStore'
import { useShopStore } from '../store/useShopStore'

const steps = [
  { title: 'Search once', body: 'One query reaches every shop Arro can read.' },
  { title: 'Compare honestly', body: 'Matching offers stay together when the source identifies the same product; every seller stays labelled.' },
  { title: 'Buy from the shop', body: 'Checkout is prepared with the shop that actually sells it.' }
]

function CategoryCard({ category, onPress }: { category: BrowseCategory; onPress: () => void }) {
  return (
    <ProductLink
      href={categoryHref(category.query)}
      label={`Browse ${category.label}`}
      onPress={onPress}
      className="min-h-[58px] items-center justify-center gap-1.5 rounded-xl px-1 py-1.5 hover:bg-fill-soft"
    >
      <Icon name={category.icon} size={19} color={color.ink800} />
      <Text numberOfLines={1} className="text-center text-[12px] font-medium leading-4 text-ink-800">
        {category.label}
      </Text>
    </ProductLink>
  )
}

export function DiscoverScreen({
  popular = [],
  rated = [],
  loading = false,
  unavailable = false
}: {
  popular?: CatalogProductSummary[]
  rated?: CatalogProductSummary[]
  loading?: boolean
  unavailable?: boolean
} = {}) {
  const router = useRouter()
  const { compact } = useLayoutMode()
  const setQuery = useShopStore((state) => state.setQuery)
  const submitQuery = useShopStore((state) => state.submitQuery)
  const recordQuery = useSavedStore((state) => state.recordQuery)
  const recent = useSavedStore((state) => state.recent)
  const saved = useSavedStore((state) => state.items)

  useDocumentTitle('Arro — compare prices across real shops')

  const search = (value: string) => {
    const next = value.trim()
    if (!next) return
    setQuery(next)
    submitQuery(next)
    recordQuery(next)
    router.push(searchHref(next))
  }

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1 }}
    >
      {/* React Native Web gives every View `position: relative; z-index: 0`, so
          each one opens a stacking context and an inner z-index cannot escape
          it. The search suggestions therefore could not paint over the category
          strip below, which is a later sibling at the same level. Lifting the
          whole hero is what actually decides the order. */}
      <View className="arro-hero border-b border-line" style={{ zIndex: 30 }}>
        {/* Centred and compact. A left-aligned headline with a column of empty
            space beside it was the shape of a landing page for a product that
            has nothing to show; this one has a catalogue, so the hero's only
            job is to hand over the search field and get out of the way. */}
        <Shell className="items-center pb-7 pt-8 md:pb-10 md:pt-12">
          <Appear className="w-full max-w-[720px] items-center">
            <View className="w-full items-center">
              <Heading
                level={1}
                className="text-center text-[30px] font-bold leading-[36px] tracking-[-1px] text-ink-950 md:text-[44px] md:leading-[50px] md:tracking-[-1.6px]"
              >
                Compare every shop, once.
              </Heading>
              <Text className="mt-2.5 max-w-[520px] text-center text-[15px] leading-6 text-ink-600 md:text-[17px]">
                Live prices from real shops, each one labelled with the shop it came from.
              </Text>

              <View className="mt-6 w-full">
                <SearchField size="hero" onSubmit={(next) => search(next)} />
              </View>
            </View>
          </Appear>
        </Shell>
      </View>

      {/* Browsing sits directly under the hero, where a shopper who has no words
          for what they want looks next. It is a strip rather than a section
          further down the page: on a comparison site the two ways in — type it,
          or point at it — belong to the same moment. */}
      <View className="border-b border-line bg-white">
        {compact ? (
          // One scrolling row of chips. Wrapping fourteen tiles into four rows
          // spent a third of a phone screen on navigation before the shopper had
          // seen a single price.
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8 }}
          >
            {browseCategories.map((category) => (
              <ProductLink
                key={category.query}
                href={categoryHref(category.query)}
                label={`Browse ${category.label}`}
                onPress={() => setQuery(category.query)}
                className="min-h-9 flex-row items-center gap-2 rounded-full border border-line bg-white px-3.5"
              >
                <Icon name={category.icon} size={15} color={color.ink800} />
                <Text numberOfLines={1} className="text-[13px] font-medium leading-[18px] text-ink-800">
                  {category.label}
                </Text>
              </ProductLink>
            ))}
          </ScrollView>
        ) : (
          <Shell className="py-2.5">
            <View className="flex-row justify-between">
              {browseCategories.map((category) => (
                <View key={category.query} className="flex-1 px-0.5">
                  <CategoryCard category={category} onPress={() => setQuery(category.query)} />
                </View>
              ))}
            </View>
          </Shell>
        )}
      </View>

      <Shell className="flex-1 pb-16 pt-8 md:pt-14">

        {loading ? (
          <View className="mb-12 md:mb-14">
            <ProductRailSkeleton itemWidth={compact ? railCardWidth : 240} />
          </View>
        ) : null}

        {!loading && unavailable ? (
          <View className="mb-10 rounded-2xl border border-line p-5">
            <Heading level={2} className="text-[17px] font-semibold leading-6 text-ink-950">
              Live offers are taking longer than usual
            </Heading>
            <Text className="mt-1.5 max-w-[540px] text-[14px] leading-5 text-ink-600">
              Search and categories are still available. The popular shelves will return when the shops answer.
            </Text>
          </View>
        ) : null}

        {popular.length > 0 ? (
          <Appear className="mb-12 md:mb-14">
            <SectionHeading title="Popular" subtitle="Most reviewed at the shops selling them." />
            <Carousel
              label="Popular"
              data={popular}
              keyExtractor={(product) => `${product.businessId}:${product.productId}`}
              itemWidth={compact ? railCardWidth : 240}
              gap={16}
              renderItem={(product, index) => (
                <ProductCard
                  group={singleProductGroup(product)}
                  priority={index < 4}
                  showCompare={false}
                />
              )}
            />
          </Appear>
        ) : null}

        {rated.length > 0 ? (
          <Appear className="mb-12 md:mb-14">
            <SectionHeading title="Top rated" subtitle="Highest rated, with enough reviews to mean something." />
            <Carousel
              label="Top rated"
              data={rated}
              keyExtractor={(product) => `${product.businessId}:${product.productId}`}
              itemWidth={compact ? railCardWidth : 240}
              gap={16}
              renderItem={(product) => (
                <ProductCard group={singleProductGroup(product)} showCompare={false} />
              )}
            />
          </Appear>
        ) : null}

        {/* Device state, so the server renders nothing here and the rails appear
            for a returning shopper only. */}
        {recent.length > 0 ? (
          <Appear className="mb-12 md:mb-14">
            <SectionHeading title="Pick up where you left off" />
            <Carousel
              label="Recently viewed"
              data={recent}
              keyExtractor={(product) => `${product.businessId}:${product.productId}`}
              itemWidth={railCardWidth}
              renderItem={(product) => <ProductCard group={singleProductGroup(product)} showCompare={false} />}
            />
          </Appear>
        ) : null}

        {saved.length > 0 ? (
          <Appear className="mb-12 md:mb-14">
            <SectionHeading
              title="Still on your list"
              right={
                <Tappable
                  accessibilityLabel="Open saved products"
                  onPress={() => router.push('/saved')}
                  className="min-h-9 flex-row items-center gap-1 rounded-full px-2"
                >
                  <Text className="text-[13px] font-semibold leading-[18px] text-ink-950">See all</Text>
                  <Icon name="chevronRight" size={14} color={color.ink600} />
                </Tappable>
              }
            />
            <Carousel
              label="Saved products"
              data={saved.slice(0, 12)}
              keyExtractor={(item) => item.key}
              itemWidth={railCardWidth}
              renderItem={(item) => (
                <ProductCard
                  group={singleProductGroup(item.product)}
                  showCompare={false}
                  {...(item.query ? { query: item.query } : {})}
                />
              )}
            />
          </Appear>
        ) : null}

        <View className="hidden mt-14 border-t border-line pt-10 md:mt-16 md:flex">
          <SectionHeading title="How Arro works" />
          <View className="gap-3 md:flex-row md:gap-4">
            {steps.map((step, index) => (
              <Appear key={step.title} delay={index * 60} className="flex-1 rounded-2xl bg-fill-soft p-5 md:p-6">
                <Text className="text-[13px] font-bold leading-4 text-arro-600">{`0${index + 1}`}</Text>
                <Text className="mt-3 text-[17px] font-semibold leading-6 text-ink-950">{step.title}</Text>
                <Text className="mt-1.5 text-[14px] leading-5 text-ink-600">{step.body}</Text>
              </Appear>
            ))}
          </View>
        </View>
      </Shell>

      <SiteFooter />
    </ScrollView>
  )
}
