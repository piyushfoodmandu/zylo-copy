import type { ReactNode } from 'react'
import { memo, useEffect, useRef, useState } from 'react'
import { Platform, Pressable, Text, View } from 'react-native'
import { cartLineKey } from '../lib/cart'
import { gridImageSizes } from '../lib/image-url'
import { shopName } from '../lib/facets'
import { availabilityLabel, productMoney } from '../lib/product-display'
import type { CatalogProductGroup } from '../lib/product-groups'
import { productHref } from '../lib/product-url'
import { color } from '../lib/theme'
import { useCartStore } from '../store/useCartStore'
import { useShopStore } from '../store/useShopStore'
import type { CatalogProductSummary } from '../types/catalog'
import { Icon } from './Icon'
import { ProductImage } from './ProductImage'
import { ProductLink } from './ProductLink'
import { SaveButton } from './SaveButton'
import { Heading } from './semantic'
import { Stars } from './ui'

const sameProduct = (left: CatalogProductSummary, right: CatalogProductSummary) =>
  left.businessId === right.businessId &&
  left.productId === right.productId &&
  left.variantId === right.variantId

/**
 * Card actions sit outside the anchor, because a button nested inside a link is
 * both invalid markup and an ambiguous tap.
 *
 * Only the controls that belong on a photograph float over one: save, and
 * compare where there is room for it. Add-to-cart gets its own row under the
 * price. It used to be pinned to the card's bottom-right corner, which put a
 * 40px target directly on top of the shop name and the price — the two things
 * the card exists to show — and left the corner ambiguous to tap.
 */
export const ProductCard = memo(function ProductCard({
  group,
  priority = false,
  query,
  footer,
  showCompare = false,
  onCompare,
  headingLevel = 3
}: {
  group: CatalogProductGroup
  /** Above-the-fold cards load their image eagerly; the rest defer. */
  priority?: boolean
  query?: string
  /** Extra context under the price — why an item is saved, when it was added. */
  footer?: ReactNode
  /**
   * Off by default. Callers that have the room — the pointer-width results grid
   * — turn it on; rails and phone grids leave it off. Reading the viewport here
   * instead would put a dimensions subscription behind every tile in the grid.
   */
  showCompare?: boolean
  /**
   * Turns the compare toggle into a picker. The product is added first, then
   * the caller can return to the comparison screen. A product already in the
   * comparison is kept there and simply opens it again.
   */
  onCompare?: (product: CatalogProductSummary) => void
  /** Cards under a section heading are h3; a results grid under the page title opts into h2. */
  headingLevel?: 2 | 3
}) {
  const product = group.product
  const selected = useShopStore((state) => state.compare.some((candidate) => sameProduct(candidate, product)))
  const compareFull = useShopStore((state) => state.compare.length >= 4)
  const selectProduct = useShopStore((state) => state.selectProduct)
  const toggleCompare = useShopStore((state) => state.toggleCompare)
  const addToCart = useCartStore((state) => state.add)
  // Matched on the cart's own line identity, which includes the seller. A
  // product carried by two shops is two lines, and only the one the card shows
  // should read as already added.
  const lineKey = cartLineKey(product)
  const inCart = useCartStore((state) => state.lines.some((line) => line.key === lineKey))
  const [justAdded, setJustAdded] = useState(false)
  const addedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(addedTimer.current), [])

  const compareDisabled = compareFull && !selected
  const offerCurrencies = new Set(group.offers.flatMap((offer) => offer.price ? [offer.price.currency] : []))
  const showFromPrice = group.offers.length > 1 && offerCurrencies.size === 1
  const sellable = product.availability !== 'out_of_stock'

  const href = productHref({
    businessId: product.businessId,
    productId: product.productId,
    title: product.title,
    ...(group.merchantCount === 1 && product.variantId ? { variantId: product.variantId } : {})
  })

  const add = () => {
    addToCart(product, query ? { query } : undefined)
    setJustAdded(true)
    clearTimeout(addedTimer.current)
    addedTimer.current = setTimeout(() => setJustAdded(false), 1600)
  }

  const compare = () => {
    if (!selected) toggleCompare(product)
    if (onCompare) onCompare(product)
    else if (selected) toggleCompare(product)
  }

  return (
    <View className="flex-1" role="listitem">
      <ProductLink
        href={href}
        label={product.title}
        className="arro-product gap-3"
        onPress={() => selectProduct(product, group.offers)}
      >
        <View className="aspect-square w-full items-center justify-center overflow-hidden rounded-2xl bg-fill-soft p-3">
          {product.imageUrl ? (
            <ProductImage
              uri={product.imageUrl}
              alt={product.title}
              priority={priority}
              sizes={gridImageSizes}
              className="h-full w-full"
            />
          ) : (
            <Icon name="store" size={28} color={color.ink400} />
          )}
        </View>

        {/* Product first, then how good it is, then what it costs, then who
            sells it. Leading with the shop puts the least decisive fact in the
            most prominent line and makes every card in a grid start with grey
            text nobody is scanning for. */}
        <View className="gap-1.5">
          <Heading level={headingLevel} numberOfLines={2} className="min-h-10 text-[14px] font-medium leading-5 text-ink-800">
            {product.title}
          </Heading>
          {product.rating ? (
            <Stars compact value={product.rating.value} count={product.rating.count} />
          ) : (
            <View className="h-4" />
          )}
          <View className="mt-0.5 flex-row items-baseline gap-1.5">
            {showFromPrice ? <Text className="text-[12px] leading-4 text-ink-400">from</Text> : null}
            <Text className="text-[19px] font-bold leading-6 tracking-[-0.3px] text-ink-950">
              {productMoney(product)}
            </Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <Text numberOfLines={1} className="min-w-0 flex-1 text-[12px] leading-4 text-ink-400">
              {group.merchantCount > 1 ? `${group.merchantCount} shops` : shopName(product)}
            </Text>
            {product.availability === 'in_stock' ? null : (
              <Text className="text-[12px] font-medium leading-4 text-ink-600">
                {availabilityLabel(product.availability)}
              </Text>
            )}
          </View>
          {footer}
        </View>
      </ProductLink>

      {showCompare ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            onCompare && selected
              ? `Open comparison with ${product.title}`
              : selected
                ? `Remove ${product.title} from comparison`
                : `Add ${product.title} to comparison`
          }
          accessibilityState={{ ...(!onCompare ? { selected } : {}), disabled: compareDisabled }}
          aria-pressed={onCompare ? undefined : selected}
          aria-disabled={compareDisabled}
          disabled={compareDisabled}
          onPress={compare}
          hitSlop={6}
          className={`absolute left-2 top-2 h-10 w-10 items-center justify-center rounded-full ${selected ? 'bg-ink-950' : 'bg-white/95'} ${compareDisabled ? 'opacity-40' : ''}`}
        >
          <Icon name={selected ? 'check' : 'compare'} size={16} color={selected ? color.white : color.ink800} />
        </Pressable>
      ) : null}

      <View className="absolute right-2 top-2">
        <SaveButton product={product} {...(query ? { query } : {})} />
      </View>

      {/* Cards in a row are as tall as the tallest one, and a saved card carries
          extra lines the one beside it may not — a price-drop badge, the search
          it came from. Letting the button follow the text put it at a different
          height in every card. `mt-auto` pins it to the bottom of whatever the
          row settled on; where there is no spare height it collapses and the
          padding keeps the gap. */}
      <View className="mt-auto pt-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            sellable
              ? justAdded ? `${product.title} added to cart` : `Add ${product.title} to cart`
              : `${product.title} is out of stock`
          }
          accessibilityState={{ disabled: !sellable }}
          disabled={!sellable}
          onPress={add}
          hitSlop={4}
          className={`min-h-9 flex-row items-center justify-center gap-1.5 rounded-full border ${justAdded ? 'border-positive-soft bg-positive-soft' : inCart ? 'border-arro-100 bg-arro-50' : 'border-line bg-white'} ${sellable ? '' : 'opacity-40'}`}
        >
          <Icon
            name={justAdded ? 'check' : 'cart'}
            size={15}
            color={justAdded ? color.positive : inCart ? color.arro700 : color.ink800}
          />
          <Text className={`text-[13px] font-semibold leading-[18px] ${justAdded ? 'text-positive' : inCart ? 'text-arro-700' : 'text-ink-800'}`}>
            {justAdded ? 'Added' : inCart ? 'In cart' : 'Add'}
          </Text>
        </Pressable>
      </View>
    </View>
  )
}, (previous, next) =>
  previous.group === next.group &&
  previous.priority === next.priority &&
  previous.query === next.query &&
  previous.showCompare === next.showCompare &&
  previous.onCompare === next.onCompare &&
  previous.headingLevel === next.headingLevel &&
  previous.footer === next.footer)

// Rails size their own cells, so a card inside one must not stretch to the grid.
export const railCardWidth = Platform.OS === 'web' ? 190 : 172
