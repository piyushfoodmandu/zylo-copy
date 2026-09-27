import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { color } from '../lib/theme'
import { Icon } from './Icon'
import { Sheet } from './Sheet'
import { Field } from './ui'

export type FilterOption<Value extends string = string> = {
  value: Value
  label: string
  count?: number
}

const normalise = (value: string) => value.trim().toLocaleLowerCase()

const OptionRow = <Value extends string>({
  option,
  selected,
  onPress
}: {
  option: FilterOption<Value>
  selected: boolean
  onPress: () => void
}) => (
  <Pressable
    accessibilityRole="radio"
    accessibilityLabel={option.label}
    accessibilityState={{ checked: selected }}
    aria-checked={selected}
    onPress={onPress}
    className="min-h-14 flex-row items-center gap-3 border-b border-line"
  >
    <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] leading-5 text-ink-950">
      {option.label}
    </Text>
    {option.count === undefined ? null : (
      <Text className="text-[13px] leading-[18px] text-ink-400">{option.count}</Text>
    )}
    {selected ? <Icon name="check" size={18} color={color.arro600} /> : null}
  </Pressable>
)

/**
 * A single-choice facet for the phone layout.
 *
 * Long PriceRunner-style brand and shop lists are useful only when a shopper
 * can reach a specific entry. Keeping filtering, empty-state copy and radio
 * semantics here avoids four subtly different sheets on the results page.
 */
export function FilterOptionSheet<Value extends string>({
  visible,
  title,
  allLabel,
  options,
  selected,
  onSelect,
  onClose,
  searchLabel,
  searchThreshold = 7
}: {
  visible: boolean
  title: string
  allLabel: string
  options: readonly FilterOption<Value>[]
  selected?: Value
  onSelect: (value: Value | undefined) => void
  onClose: () => void
  /** The noun a shopper searches, for example "shops" or "brands". */
  searchLabel?: string
  searchThreshold?: number
}) {
  const [query, setQuery] = useState('')
  const searchable = options.length >= searchThreshold
  const filtered = useMemo(() => {
    const wanted = normalise(query)
    if (!wanted) return options
    return options.filter((option) => normalise(option.label).includes(wanted))
  }, [options, query])

  useEffect(() => {
    if (!visible) setQuery('')
  }, [visible])

  const choose = (value: Value | undefined) => {
    onSelect(value)
    onClose()
  }

  return (
    <Sheet visible={visible} title={title} onClose={onClose}>
      <View className="px-5">
        {searchable ? (
          <View className="gap-1.5 pb-2">
            <Field
              value={query}
              onChangeText={setQuery}
              placeholder={`Search ${searchLabel ?? title.toLocaleLowerCase()}`}
              accessibilityLabel={`Search ${searchLabel ?? title.toLocaleLowerCase()}`}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            <Text accessibilityLiveRegion="polite" className="text-[12px] leading-4 text-ink-400">
              {filtered.length} {filtered.length === 1 ? 'option' : 'options'}
            </Text>
          </View>
        ) : null}
      </View>

      <ScrollView
        className="px-5"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View role="radiogroup" aria-label={title} className="pb-6">
          {query.trim() ? null : (
            <OptionRow
              option={{ value: '' as Value, label: allLabel }}
              selected={selected === undefined}
              onPress={() => choose(undefined)}
            />
          )}
          {filtered.map((option) => (
            <OptionRow
              key={option.value}
              option={option}
              selected={selected === option.value}
              onPress={() => choose(option.value)}
            />
          ))}
          {filtered.length === 0 ? (
            <View className="items-center py-10">
              <Text className="text-[14px] leading-5 text-ink-600">No matching {searchLabel ?? 'options'}.</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </Sheet>
  )
}
