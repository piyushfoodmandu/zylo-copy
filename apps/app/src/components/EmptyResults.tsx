import { Text, View } from 'react-native'
import { browseCategories, categoryForQuery, relatedSearches } from '../lib/categories'
import { categoryHref, searchHref } from '../lib/product-url'
import { color } from '../lib/theme'
import { Icon } from './Icon'
import { Appear } from './motion'
import { ProductLink } from './ProductLink'
import { Heading } from './semantic'
import { Button } from './ui'

/**
 * A dead end is a design failure, not a state to render literally. When a query
 * returns nothing the page still owes the shopper somewhere to go, so it offers
 * the sibling intents from the taxonomy the query belongs to, then the top level.
 *
 * It also says the one true thing once. Stacking a source notice on top of an
 * empty-state heading tells the same person the same news twice.
 */
export function EmptyResults({
  query,
  filtered,
  onClearFilters
}: {
  query: string
  /** True when results exist but the current filters hide all of them. */
  filtered: boolean
  onClearFilters: () => void
}) {
  const category = categoryForQuery(query)
  const suggestions = relatedSearches(query)

  if (filtered) {
    return (
      <Appear className="rounded-2xl border border-line p-6">
        <Heading level={2} className="text-[17px] font-semibold leading-6 text-ink-950">
          Nothing matches these filters
        </Heading>
        <Text className="mt-1.5 max-w-[480px] text-[14px] leading-5 text-ink-600">
          Widen the price range or clear a filter to see the rest.
        </Text>
        <View className="mt-4 self-start">
          <Button variant="outline" size="sm" onPress={onClearFilters}>Clear filters</Button>
        </View>
      </Appear>
    )
  }

  return (
    <Appear>
      <View className="rounded-2xl border border-line p-6">
        <View className="h-11 w-11 items-center justify-center rounded-full bg-fill">
          <Icon name="search" size={20} color={color.ink600} />
        </View>
        <Heading level={2} className="mt-4 text-[19px] font-bold leading-7 text-ink-950">
          {query ? `No shop matched “${query}” just now` : 'Nothing to show yet'}
        </Heading>
        <Text className="mt-1.5 max-w-[560px] text-[14px] leading-5 text-ink-600">
          The shops Arro can reach did not return a close match. A brand or model name usually finds one.
        </Text>
      </View>

      <View className="mt-8">
        <Text className="mb-3 text-[12px] font-semibold uppercase leading-4 tracking-[0.6px] text-ink-400">
          {category ? `Popular in ${category.label}` : 'Try one of these'}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {suggestions.map((item) => (
            <ProductLink
              key={item.query}
              href={searchHref(item.query)}
              className="arro-card min-h-10 justify-center rounded-full border border-line bg-white px-4"
            >
              <Text className="text-[14px] font-medium leading-5 text-ink-800">{item.label}</Text>
            </ProductLink>
          ))}
        </View>
      </View>

      <View className="mt-8">
        <Text className="mb-3 text-[12px] font-semibold uppercase leading-4 tracking-[0.6px] text-ink-400">
          Browse instead
        </Text>
        <View className="flex-row flex-wrap gap-2.5">
          {browseCategories.map((entry) => (
            <ProductLink
              key={entry.query}
              href={categoryHref(entry.query)}
              label={`Browse ${entry.label}`}
              className="arro-card min-h-11 flex-row items-center gap-2.5 rounded-2xl border border-line bg-white px-3.5"
            >
              <Icon name={entry.icon} size={17} color={color.arro600} />
              <Text className="text-[14px] font-medium leading-5 text-ink-800">{entry.label}</Text>
            </ProductLink>
          ))}
        </View>
      </View>
    </Appear>
  )
}
