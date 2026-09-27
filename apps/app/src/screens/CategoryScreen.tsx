import { ScrollView, Text, View } from 'react-native'
import type { CategoryRail } from '../lib/catalog-page-data'
import { Breadcrumb } from '../components/Breadcrumb'
import { Carousel } from '../components/Carousel'
import { Disclosure } from '../components/Disclosure'
import { Icon } from '../components/Icon'
import { Appear } from '../components/motion'
import { Shell } from '../components/Page'
import { ProductCard, railCardWidth } from '../components/ProductCard'
import { ProductLink } from '../components/ProductLink'
import { Heading } from '../components/semantic'
import { SiteFooter } from '../components/SiteFooter'
import { ProductRailSkeleton } from '../components/skeletons'
import { browseCategories, type BrowseCategory } from '../lib/categories'
import { categoryGuideFor, categoryQuestions } from '../lib/category-guides'
import { useDocumentTitle } from '../lib/document-title'
import { useLayoutMode } from '../lib/layout'
import { groupCatalogProducts } from '../lib/product-groups'
import { categoryHref, searchHref } from '../lib/product-url'
import { color } from '../lib/theme'

/**
 * A category is a place to choose from, not a query to run.
 *
 * Searching a category's own name is what produced the dead ends: shops sell
 * board games and building sets, not "toys", so the broad word matched nothing
 * and the page rendered an empty state over a perfectly healthy catalogue. This
 * page asks the questions the sources can answer — a bounded few of them — and
 * puts the rest of the taxonomy one tap away.
 */
export function CategoryScreen({
  category,
  rails,
  loading = false,
  unreachable = false
}: {
  category: BrowseCategory
  rails: CategoryRail[]
  loading?: boolean
  /** No rails because the shops did not answer, not because the category is empty. */
  unreachable?: boolean
}) {
  const { compact, desktop } = useLayoutMode()
  const guide = categoryGuideFor(category)
  const questions = categoryQuestions(category)
  useDocumentTitle(`${category.label} — compare prices · Arro`)

  /**
   * Sibling categories go down the left edge, products take the rest.
   *
   * Stacking every neighbouring category above the products pushed the first
   * product below the fold and made the page read as a menu with a grid
   * attached. Beside the content they are a persistent index — one move to a
   * different aisle, no scrolling back up — and the grid gets the width it
   * needs to actually compare things.
   */
  const sidebar = (
    <View className="w-[220px] shrink-0 pr-6">
      <Text className="mb-2 px-2 text-[12px] font-semibold uppercase leading-4 tracking-[0.4px] text-ink-400">
        All categories
      </Text>
      {browseCategories.map((entry) => {
        const current = entry.query === category.query
        return (
          <ProductLink
            key={entry.query}
            href={categoryHref(entry.query)}
            className={`min-h-9 justify-center rounded-lg px-2 ${current ? 'bg-fill' : ''}`}
          >
            <Text
              numberOfLines={1}
              className={`text-[14px] leading-5 ${current ? 'font-semibold text-ink-950' : 'text-ink-600'}`}
            >
              {entry.label}
            </Text>
          </ProductLink>
        )
      })}
    </View>
  )

  const heading = (
    <Appear>
      <View className="flex-row items-center gap-3">
        <View className="h-11 w-11 items-center justify-center rounded-full bg-arro-50">
          <Icon name={category.icon} size={21} color={color.arro600} />
        </View>
        <Heading level={1} className="text-[26px] font-bold leading-8 tracking-[-0.6px] text-ink-950 md:text-[32px] md:leading-9">
          {category.label}
        </Heading>
      </View>

      <View className="mt-5 flex-row flex-wrap gap-2">
        {category.children.map((child) => (
          <ProductLink
            key={child.query}
            href={searchHref(child.query)}
            className="arro-card min-h-10 justify-center rounded-full border border-line bg-white px-4"
          >
            <Text className="text-[14px] font-medium leading-5 text-ink-800">{child.label}</Text>
          </ProductLink>
        ))}
      </View>
    </Appear>
  )

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ flexGrow: 1 }}
    >
      <Shell className="flex-1 pb-16 pt-4 md:pt-8">
        <Breadcrumb className="mb-3" trail={[{ name: 'Home', href: '/' }, { name: category.label }]} />

        <View className={desktop ? 'flex-row items-start' : ''}>
          {desktop ? sidebar : null}
          <View className="min-w-0 flex-1">
        {heading}

        {loading ? (
          <View className="mt-10 gap-12 md:mt-12">
            <ProductRailSkeleton itemWidth={compact ? railCardWidth : 240} />
            <ProductRailSkeleton itemWidth={compact ? railCardWidth : 240} />
          </View>
        ) : rails.length === 0 ? (
          <Appear className="mt-10 rounded-2xl border border-line p-6">
            <Heading level={2} className="text-[17px] font-semibold leading-6 text-ink-950">
              {unreachable ? 'We could not load this yet' : 'No products here yet'}
            </Heading>
            <Text className="mt-1.5 max-w-[520px] text-[14px] leading-5 text-ink-600">
              {unreachable
                ? `The shops did not answer in time. Pick one of the ${category.label.toLowerCase()} areas above, which often loads on its own.`
                : `The shops Arro can reach are not returning ${category.label.toLowerCase()} right now. Pick one of the areas above, or search for a brand or model.`}
            </Text>
          </Appear>
        ) : (
          rails.map((rail, index) => {
            const groups = groupCatalogProducts(rail.items)
            return (
              <Appear key={rail.query} delay={index * 60} className="mt-10 md:mt-12">
                <View className="mb-4 flex-row items-end justify-between gap-4">
                  <Heading level={2} className="text-[20px] font-bold leading-7 text-ink-950 md:text-2xl md:leading-8">
                    {rail.label}
                  </Heading>
                  <ProductLink href={searchHref(rail.query)} className="min-h-9 justify-center">
                    <View className="flex-row items-center gap-1">
                      <Text className="text-[13px] font-semibold leading-[18px] text-arro-700">See all</Text>
                      <Icon name="arrowRight" size={14} color={color.arro700} />
                    </View>
                  </ProductLink>
                </View>

                <Carousel
                  label={rail.label}
                  data={groups}
                  keyExtractor={(group) => group.key}
                  itemWidth={compact ? railCardWidth : 240}
                  gap={16}
                  renderItem={(group, cardIndex) => (
                    <ProductCard group={group} priority={index === 0 && cardIndex < 4} query={rail.query} />
                  )}
                />
              </Appear>
            )
          })
        )}

        <Appear className="mt-14 border-t border-line pt-8">
          <Heading level={2} className="text-[17px] font-bold leading-6 text-ink-950">
            {`Everything in ${category.label}`}
          </Heading>
          <View className="mt-4 flex-row flex-wrap gap-2.5">
            {category.children.map((child) => (
              <ProductLink
                key={`all:${child.query}`}
                href={searchHref(child.query)}
                className="arro-card min-h-11 min-w-[180px] flex-1 justify-center rounded-2xl border border-line bg-white px-4 md:max-w-[260px]"
              >
                <Text className="text-[14px] font-medium leading-5 text-ink-800">{child.label}</Text>
              </ProductLink>
            ))}
          </View>
        </Appear>

        <Appear className="mt-14 border-t border-line pt-8">
          <Heading level={2} className="text-[20px] font-bold leading-7 text-ink-950 md:text-2xl md:leading-8">
            {`How to compare ${category.label.toLocaleLowerCase()}`}
          </Heading>
          <Text className="mt-2 max-w-[760px] text-[15px] leading-6 text-ink-600">{guide.intro}</Text>
          <View className="mt-6 gap-6 md:flex-row md:gap-8">
            {guide.considerations.map((item) => (
              <View key={item.title} className="flex-1 border-t border-line pt-4">
                <Heading level={3} className="text-[16px] font-bold leading-6 text-ink-950">{item.title}</Heading>
                <Text className="mt-1.5 text-[14px] leading-6 text-ink-600">{item.description}</Text>
              </View>
            ))}
          </View>
        </Appear>

        <Appear className="mt-14 border-t border-line pt-8">
          <Heading level={2} className="text-[20px] font-bold leading-7 text-ink-950 md:text-2xl md:leading-8">
            Questions shoppers ask
          </Heading>
          <View className="mt-4 border-t border-line">
            {questions.map((item) => (
              <Disclosure key={item.question} question={item.question} answer={item.answer} />
            ))}
          </View>
        </Appear>
          </View>
        </View>
      </Shell>

      <SiteFooter className="mt-10" />
    </ScrollView>
  )
}
