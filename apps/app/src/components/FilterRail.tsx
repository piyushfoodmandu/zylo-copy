import type { PropsWithChildren } from 'react'
import { useMemo, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { conditionLabel, type deriveFacets, type ShopperFilters } from '../lib/facets'
import { color } from '../lib/theme'
import { Icon } from './Icon'
import { Button, Field } from './ui'

export type RailFacets = ReturnType<typeof deriveFacets>

const ratingOptions = [4.5, 4, 3.5] as const

const RailSection = ({ title, children }: PropsWithChildren<{ title: string }>) => (
  <View className="border-t border-line py-4">
    <Text className="mb-2.5 text-[12px] font-semibold uppercase leading-4 tracking-[0.6px] text-ink-400">
      {title}
    </Text>
    {children}
  </View>
)

const RailOption = ({
  label,
  detail,
  selected,
  onPress
}: {
  label: string
  detail?: string
  selected: boolean
  onPress: () => void
}) => (
  <Pressable
    accessibilityRole="checkbox"
    accessibilityLabel={label}
    accessibilityState={{ checked: selected }}
    aria-checked={selected}
    onPress={onPress}
    className="min-h-9 flex-row items-center gap-2.5"
  >
    <View className={`h-[18px] w-[18px] items-center justify-center rounded-md border ${selected ? 'border-ink-950 bg-ink-950' : 'border-line-strong'}`}>
      {selected ? <Icon name="check" size={11} color={color.white} /> : null}
    </View>
    <Text numberOfLines={1} className={`min-w-0 flex-1 text-[14px] leading-5 ${selected ? 'font-medium text-ink-950' : 'text-ink-800'}`}>
      {label}
    </Text>
    {detail ? <Text className="text-[12px] leading-4 text-ink-400">{detail}</Text> : null}
  </Pressable>
)

const normalise = (value: string) => value.trim().toLocaleLowerCase()

/** Search and disclosure for the two facets that routinely grow past one view. */
const SearchableRailOptions = ({
  title,
  searchLabel,
  options,
  selected,
  onSelect
}: {
  title: string
  searchLabel: string
  options: readonly (readonly [string, number])[]
  selected?: string
  onSelect: (value: string) => void
}) => {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const filtered = useMemo(() => {
    const wanted = normalise(query)
    if (!wanted) return options
    return options.filter(([label]) => normalise(label).includes(wanted))
  }, [options, query])
  const visible = query.trim() || expanded ? filtered : filtered.slice(0, 6)

  return (
    <RailSection title={title}>
      {options.length > 6 ? (
        <View className="mb-2.5">
          <Field
            value={query}
            onChangeText={setQuery}
            placeholder={`Search ${searchLabel}`}
            accessibilityLabel={`Search ${searchLabel}`}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
        </View>
      ) : null}
      {visible.map(([label, count]) => (
        <RailOption
          key={label}
          label={label}
          detail={String(count)}
          selected={selected === label}
          onPress={() => onSelect(label)}
        />
      ))}
      {filtered.length === 0 ? (
        <Text accessibilityLiveRegion="polite" className="py-2 text-[13px] leading-[18px] text-ink-400">
          No matching {searchLabel}.
        </Text>
      ) : null}
      {!query.trim() && filtered.length > 6 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          aria-expanded={expanded}
          onPress={() => setExpanded((current) => !current)}
          className="min-h-10 flex-row items-center gap-1.5"
        >
          <Text className="text-[13px] font-semibold leading-[18px] text-arro-700">
            {expanded ? 'Show less' : `Show all ${filtered.length}`}
          </Text>
          <Icon name={expanded ? 'chevronUp' : 'chevronDown'} size={14} color={color.arro700} />
        </Pressable>
      ) : null}
    </RailSection>
  )
}

/**
 * On a pointer device every filter is one click away and stays visible while
 * the shopper works. The phone shell reaches the same state through sheets,
 * because a rail there would cost the results half the screen.
 *
 * Sections appear only when the returned facts can change the result set, which
 * is the same rule the chip bar follows. The column owns no width, padding or
 * scrolling of its own: it is a block inside the page's shell, so it starts on
 * the same left edge as the title above it and scrolls with the page.
 */
export function FilterRail({
  facets,
  filters,
  onFilters,
  minValue,
  maxValue,
  onMin,
  onMax,
  onApplyPrice,
  priceCurrency,
  active,
  onReset
}: {
  facets: RailFacets
  filters: ShopperFilters
  onFilters: (update: (current: ShopperFilters) => ShopperFilters) => void
  minValue: string
  maxValue: string
  onMin: (value: string) => void
  onMax: (value: string) => void
  onApplyPrice: () => void
  priceCurrency: string
  active: boolean
  onReset: () => void
}) {
  const toggle = <K extends keyof ShopperFilters>(key: K, value: ShopperFilters[K]) =>
    onFilters((current) => ({ ...current, [key]: current[key] === value ? undefined : value }))

  return (
    <View>
      <View className="flex-row items-center justify-between gap-3 pb-3">
        <View className="flex-row items-center gap-2">
          <Icon name="filter" size={16} color={color.ink800} />
          <Text className="text-[15px] font-bold leading-5 text-ink-950">Filters</Text>
        </View>
        {active ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear all filters" hitSlop={8} onPress={onReset}>
            <Text className="text-[13px] font-medium leading-[18px] text-arro-700">Clear</Text>
          </Pressable>
        ) : null}
      </View>

      <RailSection title={`Price (${priceCurrency})`}>
        <View className="flex-row items-center gap-2">
          <View className="flex-1">
            <Field value={minValue} onChangeText={onMin} placeholder="Min" accessibilityLabel="Minimum price" keyboardType="numeric" />
          </View>
          <Text className="text-[13px] text-ink-400">to</Text>
          <View className="flex-1">
            <Field value={maxValue} onChangeText={onMax} placeholder="Max" accessibilityLabel="Maximum price" keyboardType="numeric" />
          </View>
        </View>
        <View className="mt-2.5 self-start">
          <Button size="sm" variant="outline" onPress={onApplyPrice}>Apply</Button>
        </View>
      </RailSection>

      {facets.showAvailability ? (
        <RailSection title="Availability">
          <RailOption
            label="In stock only"
            selected={filters.inStockOnly}
            onPress={() => onFilters((current) => ({ ...current, inStockOnly: !current.inStockOnly }))}
          />
        </RailSection>
      ) : null}

      {facets.currencies.length > 0 ? (
        <RailSection title="Currency">
          {facets.currencies.map(([currency, count]) => (
            <RailOption
              key={currency}
              label={currency}
              detail={String(count)}
              selected={filters.currency === currency}
              onPress={() => toggle('currency', currency)}
            />
          ))}
        </RailSection>
      ) : null}

      {facets.shops.length > 0 ? (
        <SearchableRailOptions
          title="Shop"
          searchLabel="shops"
          options={facets.shops}
          selected={filters.shop}
          onSelect={(shop) => toggle('shop', shop)}
        />
      ) : null}

      {facets.brands.length > 0 ? (
        <SearchableRailOptions
          title="Brand"
          searchLabel="brands"
          options={facets.brands}
          selected={filters.brand}
          onSelect={(brand) => toggle('brand', brand)}
        />
      ) : null}

      {facets.showRating ? (
        <RailSection title="Rating">
          {ratingOptions.map((value) => (
            <RailOption
              key={value}
              label={`${value} stars and up`}
              selected={filters.minRating === value}
              onPress={() => toggle('minRating', value)}
            />
          ))}
        </RailSection>
      ) : null}

      {facets.conditions.length > 0 ? (
        <RailSection title="Condition">
          {facets.conditions.map(([condition, count]) => (
            <RailOption
              key={condition}
              label={conditionLabel(condition)}
              detail={String(count)}
              selected={filters.condition === condition}
              onPress={() => toggle('condition', condition)}
            />
          ))}
        </RailSection>
      ) : null}
    </View>
  )
}
