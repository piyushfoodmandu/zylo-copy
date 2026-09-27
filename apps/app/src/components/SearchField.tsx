import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Platform, Pressable, Text, TextInput, View, type NativeSyntheticEvent, type TextInputKeyPressEventData } from 'react-native'
import { useRouter } from 'expo-router'
import { Icon } from './Icon'
import { ProductImage } from './ProductImage'
import { Tappable } from './motion'
import { useSearchSuggestions } from '../lib/suggestions'
import { productHref } from '../lib/product-url'
import { productMoney } from '../lib/product-display'
import { color } from '../lib/theme'
import type { CatalogProductSummary } from '../types/catalog'

export type SearchFieldSize = 'navbar' | 'hero'

/**
 * One search field, two sizes.
 *
 * Results arrive while the shopper types instead of after they commit, because
 * the fastest way to answer "do you even have this?" is to show the thing. The
 * list is products, not query strings: a suggestion that goes straight to the
 * product skips the results page entirely, and a shopper who wants the full set
 * still just presses Enter.
 */
export function SearchField({
  defaultValue = '',
  onSubmit,
  onSelectProduct,
  size = 'navbar',
  placeholder,
  autoFocus = false
}: {
  /** Seeds the field and re-seeds it when the route's query changes. */
  defaultValue?: string
  onSubmit: (query: string) => void
  /** Overrides direct product navigation, for flows such as compare picking. */
  onSelectProduct?: (product: CatalogProductSummary) => void
  size?: SearchFieldSize
  placeholder?: string
  autoFocus?: boolean
}) {
  const router = useRouter()
  /**
   * The text lives here, not in the shared store.
   *
   * Writing every keystroke to the global shop state re-rendered every screen
   * subscribed to it — on the homepage that is the hero, the category strip,
   * the popular rail and the whole page below it, once per character. Typing at
   * any speed felt like the field was stuck. The store only needs the query
   * when a search is actually run.
   */
  const [value, setValue] = useState(defaultValue)
  const [focused, setFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const blurTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const suggestionListId = `search-suggestions-${useId().replace(/:/g, '')}`
  const hero = size === 'hero'
  const { items, loading } = useSearchSuggestions(value, focused)
  const open = focused && (items.length > 0 || (loading && value.trim().length >= 2))

  useEffect(() => { setValue(defaultValue) }, [defaultValue])

  const submit = useCallback((query: string) => {
    const trimmed = query.trim()
    if (!trimmed) return
    setFocused(false)
    setActiveIndex(-1)
    onSubmit(trimmed)
  }, [onSubmit])

  // A press inside the dropdown blurs the field first, so closing has to wait
  // long enough for the press to land.
  const close = useCallback(() => {
    clearTimeout(blurTimer.current)
    blurTimer.current = setTimeout(() => setFocused(false), 140)
  }, [])

  useEffect(() => () => clearTimeout(blurTimer.current), [])

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1)
      return
    }
    setActiveIndex((current) => Math.min(current, items.length))
  }, [items.length, open])

  const openProduct = useCallback((index: number) => {
    const item = items[index]
    if (!item) return
    clearTimeout(blurTimer.current)
    setFocused(false)
    setActiveIndex(-1)
    if (onSelectProduct) onSelectProduct(item.product)
    else router.push(productHref(item.product))
  }, [items, onSelectProduct, router])

  const handleKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    const key = event.nativeEvent.key
    if (key === 'Escape') {
      event.preventDefault()
      setFocused(false)
      setActiveIndex(-1)
      return
    }
    if (key !== 'ArrowDown' && key !== 'ArrowUp') return
    event.preventDefault()
    clearTimeout(blurTimer.current)
    setFocused(true)
    if (!open) {
      setActiveIndex(-1)
      return
    }
    const lastIndex = items.length // The final option is “See all results”.
    setActiveIndex((current) => key === 'ArrowDown'
      ? (current >= lastIndex ? 0 : current + 1)
      : (current <= 0 ? lastIndex : current - 1))
  }

  return (
    // The dropdown is absolutely positioned out of a header that scrolls under
    // page content, so it needs its own stacking context and an elevation the
    // page cannot beat.
    <View className="relative z-[60]" style={{ zIndex: 60 }}>
      <View
        className={`arro-field flex-row items-center ${hero
          ? 'arro-raise rounded-full border border-line bg-white pl-5 pr-1.5'
          : `rounded-full border bg-fill pl-4 pr-1.5 ${focused ? 'border-ink-950 bg-white' : 'border-transparent'}`}`}
      >
        <Icon name="search" size={hero ? 20 : 18} color={color.ink600} />
        <TextInput
          value={value}
          autoFocus={autoFocus}
          onChangeText={(next) => {
            clearTimeout(blurTimer.current)
            setValue(next)
            setFocused(true)
            setActiveIndex(-1)
          }}
          onFocus={() => { clearTimeout(blurTimer.current); setFocused(true) }}
          onBlur={close}
          onKeyPress={handleKeyPress}
          onSubmitEditing={() => activeIndex >= 0 && activeIndex < items.length
            ? openProduct(activeIndex)
            : submit(value)}
          placeholder={placeholder ?? (hero ? 'What are you looking for today?' : 'Search products')}
          placeholderTextColor={color.ink400}
          returnKeyType="search"
          accessibilityLabel="Search products"
          accessibilityRole="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? suggestionListId : undefined}
          aria-activedescendant={activeIndex >= 0 ? `${suggestionListId}-option-${activeIndex}` : undefined}
          className={`min-w-0 flex-1 text-ink-950 ${hero ? 'ml-3 min-h-14 text-[16px] md:text-[17px]' : 'ml-2.5 min-h-11 text-[15px]'}`}
        />
        {/* The hero always offers the button; the navbar only earns the space
            once someone is actually typing there. */}
        {/* An arrow, not the word "Search" — the magnifier already said that, and
            a labelled button beside a labelled field says it a third time. */}
        {hero || focused || value.trim() ? (
          <Tappable
            accessibilityLabel="Search"
            onPress={() => submit(value)}
            className={`shrink-0 items-center justify-center rounded-full bg-ink-950 ${hero ? 'h-11 w-11' : 'h-9 w-9'}`}
          >
            <Icon name="arrowRight" size={hero ? 18 : 16} color={color.white} />
          </Tappable>
        ) : null}
      </View>

      {open ? (
        <View
          nativeID={suggestionListId}
          accessibilityRole="list"
          {...(Platform.OS === 'web'
            ? ({ role: 'listbox', 'aria-label': 'Product suggestions' } as object)
            : {})}
          className="absolute left-0 right-0 top-full mt-2 overflow-hidden rounded-2xl border border-line bg-white shadow-lg"
          style={{ zIndex: 60 }}
        >
          {items.length === 0 ? (
            <Text className="px-4 py-4 text-[14px] leading-5 text-ink-400">Looking…</Text>
          ) : (
            <>
              {items.map((item, index) => (
                <Pressable
                  key={item.key}
                  nativeID={`${suggestionListId}-option-${index}`}
                  accessibilityRole="link"
                  accessibilityLabel={item.product.title}
                  {...(Platform.OS === 'web'
                    ? ({ role: 'option', 'aria-selected': activeIndex === index } as object)
                    : {})}
                  onFocus={() => { clearTimeout(blurTimer.current); setFocused(true); setActiveIndex(index) }}
                  onBlur={close}
                  onPress={() => openProduct(index)}
                  className={`flex-row items-center gap-3 border-b border-line px-3 py-2.5 ${activeIndex === index ? 'bg-fill-soft' : ''}`}
                >
                  <View className="h-11 w-11 items-center justify-center overflow-hidden rounded-lg bg-fill-soft">
                    {item.product.imageUrl ? (
                      <ProductImage
                        uri={item.product.imageUrl}
                        alt={item.product.title}
                        sizes="44px"
                        className="h-full w-full"
                      />
                    ) : (
                      <Icon name="store" size={16} color={color.ink400} />
                    )}
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text numberOfLines={1} className="text-[14px] font-medium leading-5 text-ink-950">
                      {item.product.title}
                    </Text>
                    <Text numberOfLines={1} className="text-[12px] leading-4 text-ink-400">
                      {item.product.seller?.name || item.product.businessName}
                    </Text>
                  </View>
                  <Text className="shrink-0 text-[14px] font-bold leading-5 text-ink-950">
                    {productMoney(item.product)}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                nativeID={`${suggestionListId}-option-${items.length}`}
                accessibilityRole="link"
                accessibilityLabel={`See all results for ${value.trim()}`}
                {...(Platform.OS === 'web'
                  ? ({ role: 'option', 'aria-selected': activeIndex === items.length } as object)
                  : {})}
                onFocus={() => { clearTimeout(blurTimer.current); setFocused(true); setActiveIndex(items.length) }}
                onBlur={close}
                onPress={() => submit(value)}
                className={`flex-row items-center justify-between gap-3 px-4 py-3 ${activeIndex === items.length ? 'bg-fill-soft' : ''}`}
              >
                <Text className="text-[14px] font-semibold leading-5 text-arro-700">
                  {`See all results for “${value.trim()}”`}
                </Text>
                <Icon name="arrowRight" size={15} color={color.arro700} />
              </Pressable>
            </>
          )}
        </View>
      ) : null}
    </View>
  )
}
