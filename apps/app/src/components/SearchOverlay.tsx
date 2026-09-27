import { useRouter } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { browseCategories, popularSearches } from '../lib/categories'
import { searchHref } from '../lib/product-url'
import { color } from '../lib/theme'
import { useSavedStore } from '../store/useSavedStore'
import { useShopStore } from '../store/useShopStore'
import { Icon } from './Icon'
import { Appear } from './motion'

/**
 * Search on a phone is a destination, not a field wedged into a header. Taking
 * the whole screen buys an autofocused input, the queries this device ran
 * before, and category entry — the three things someone opening search actually
 * wants — without any of them competing with results that are still on screen.
 */
export function SearchOverlay({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter()
  const input = useRef<TextInput>(null)
  const setQuery = useShopStore((state) => state.setQuery)
  const submitQuery = useShopStore((state) => state.submitQuery)
  const recentQueries = useSavedStore((state) => state.recentQueries)
  const recordQuery = useSavedStore((state) => state.recordQuery)
  const clearQueries = useSavedStore((state) => state.clearQueries)
  const [value, setValue] = useState('')

  useEffect(() => {
    if (!visible) return
    setValue('')
    // The modal has to be on screen before the field can take focus.
    const timer = setTimeout(() => input.current?.focus(), 80)
    return () => clearTimeout(timer)
  }, [visible])

  const run = (next: string) => {
    const query = next.trim()
    if (!query) return
    recordQuery(query)
    setQuery(query)
    submitQuery(query)
    onClose()
    router.push(searchHref(query))
  }

  const suggestions = [
    ...(recentQueries.length
      ? [{ title: 'Recent', items: recentQueries, icon: 'history' as const, clear: clearQueries }]
      : []),
    { title: 'Popular right now', items: [...popularSearches], icon: 'trendingUp' as const }
  ]

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      accessibilityLabel="Search products"
      aria-label="Search products"
      onRequestClose={onClose}
    >
      <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={{ flex: 1, backgroundColor: color.white }}>
        <View className="flex-1 bg-white">
          <View className="flex-row items-center gap-2 border-b border-line px-2 py-2">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close search"
              onPress={onClose}
              className="h-11 w-11 items-center justify-center rounded-full"
            >
              <Icon name="chevronLeft" size={22} color={color.ink950} />
            </Pressable>
            <View className="min-w-0 flex-1 flex-row items-center rounded-full bg-fill px-4">
              <Icon name="search" size={18} color={color.ink600} />
              <TextInput
                ref={input}
                accessibilityLabel="Search products, brands and models"
                value={value}
                onChangeText={setValue}
                onSubmitEditing={() => run(value)}
                placeholder="Search products, brands and models"
                placeholderTextColor={color.ink400}
                returnKeyType="search"
                autoCorrect={false}
                className="ml-2.5 min-h-11 flex-1 text-[15px] text-ink-950"
              />
              {value ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={8}
                  onPress={() => setValue('')}
                >
                  <Icon name="close" size={16} color={color.ink600} />
                </Pressable>
              ) : null}
            </View>
          </View>

          <ScrollView
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View className="px-4 pb-16 pt-5">
              {suggestions.map((section, index) => (
                <Appear key={section.title} delay={index * 40} className="mb-7">
                  <View className="mb-2.5 flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      <Icon name={section.icon} size={15} color={color.ink400} />
                      <Text className="text-[12px] font-semibold uppercase leading-4 tracking-[0.6px] text-ink-400">
                        {section.title}
                      </Text>
                    </View>
                    {section.clear ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Clear ${section.title.toLowerCase()}`}
                        hitSlop={8}
                        onPress={section.clear}
                      >
                        <Text className="text-[13px] font-medium leading-[18px] text-ink-600">Clear</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {section.items.map((item) => (
                    <Pressable
                      key={item}
                      accessibilityRole="button"
                      accessibilityLabel={`Search for ${item}`}
                      onPress={() => run(item)}
                      className="min-h-12 flex-row items-center justify-between gap-3 border-b border-line"
                    >
                      <Text numberOfLines={1} className="min-w-0 flex-1 text-[15px] leading-5 text-ink-950">{item}</Text>
                      <Icon name="arrowUp" size={15} color={color.ink400} />
                    </Pressable>
                  ))}
                </Appear>
              ))}

              <Appear delay={80}>
                <Text className="mb-3 text-[12px] font-semibold uppercase leading-4 tracking-[0.6px] text-ink-400">
                  Browse
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  {browseCategories.map((category) => (
                    <Pressable
                      key={category.query}
                      accessibilityRole="button"
                      accessibilityLabel={`Browse ${category.label}`}
                      onPress={() => run(category.query)}
                      className="min-h-10 flex-row items-center gap-2 rounded-full bg-fill px-3.5"
                    >
                      <Icon name={category.icon} size={15} color={color.arro700} />
                      <Text className="text-[13px] font-medium leading-[18px] text-ink-800">{category.label}</Text>
                    </Pressable>
                  ))}
                </View>
              </Appear>
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  )
}
