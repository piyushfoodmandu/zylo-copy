import type { IconName } from '../components/Icon'

export type BrowseSubCategory = {
  label: string
  query: string
}

export type BrowseCategory = {
  label: string
  query: string
  icon: IconName
  /**
   * The second level a shopper actually navigates by. Arro does not own a
   * catalogue taxonomy — these are search intents, not facet counts — so each
   * one is a query the catalog can answer rather than a node Arro claims to
   * have inventory for.
   */
  children: readonly BrowseSubCategory[]
}

export const browseCategories: readonly BrowseCategory[] = [
  {
    label: 'Home',
    query: 'home',
    icon: 'home',
    children: [
      { label: 'Coffee machines', query: 'coffee machine' },
      { label: 'Vacuum cleaners', query: 'vacuum cleaner' },
      { label: 'Kitchen appliances', query: 'kitchen appliances' },
      { label: 'Cookware', query: 'cookware' },
      { label: 'Bedding', query: 'bedding' },
      { label: 'Lighting', query: 'home lighting' },
      { label: 'Furniture', query: 'furniture' },
      { label: 'Storage', query: 'home storage' }
    ]
  },
  {
    label: 'Garden',
    query: 'garden',
    icon: 'garden',
    children: [
      { label: 'Garden furniture', query: 'garden furniture' },
      { label: 'BBQ & grills', query: 'bbq grill' },
      { label: 'Lawn mowers', query: 'lawn mower' },
      { label: 'Plants & seeds', query: 'plants seeds' },
      { label: 'Garden tools', query: 'garden tools' },
      { label: 'Outdoor lighting', query: 'outdoor lighting' }
    ]
  },
  {
    label: 'Kids',
    query: 'kids',
    icon: 'kids',
    children: [
      { label: 'Pushchairs', query: 'pushchair stroller' },
      { label: 'Car seats', query: 'child car seat' },
      { label: 'Nursery', query: 'nursery furniture' },
      { label: 'Feeding', query: 'baby feeding' },
      { label: 'Kids clothing', query: 'kids clothing' }
    ]
  },
  {
    label: 'Toys',
    query: 'toys',
    icon: 'toys',
    children: [
      { label: 'Building sets', query: 'building blocks set' },
      { label: 'Board games', query: 'board games' },
      { label: 'Puzzles', query: 'jigsaw puzzle' },
      { label: 'Outdoor play', query: 'outdoor toys' },
      { label: 'Soft toys', query: 'soft toys' }
    ]
  },
  {
    label: 'Gaming',
    query: 'gaming',
    icon: 'gaming',
    children: [
      { label: 'Consoles', query: 'games console' },
      { label: 'Controllers', query: 'game controller' },
      { label: 'Gaming headsets', query: 'gaming headset' },
      { label: 'Gaming chairs', query: 'gaming chair' },
      { label: 'Gaming monitors', query: 'gaming monitor' },
      { label: 'PC components', query: 'pc components' }
    ]
  },
  {
    label: 'Electronics',
    query: 'electronics',
    icon: 'electronics',
    children: [
      { label: 'Laptops', query: 'laptop' },
      { label: 'Tablets', query: 'tablet' },
      { label: 'Monitors', query: 'computer monitor' },
      { label: 'Keyboards', query: 'mechanical keyboard' },
      { label: 'Storage & drives', query: 'external ssd' },
      { label: 'Printers', query: 'printer' }
    ]
  },
  {
    label: 'Phones',
    query: 'mobile phones',
    icon: 'phone',
    children: [
      { label: 'Smartphones', query: 'smartphone' },
      { label: 'Cases & covers', query: 'phone case' },
      { label: 'Chargers', query: 'phone charger' },
      { label: 'Power banks', query: 'power bank' },
      { label: 'Smartwatches', query: 'smartwatch' }
    ]
  },
  {
    label: 'Sound & TV',
    query: 'sound and tv',
    icon: 'tv',
    children: [
      { label: 'Televisions', query: 'television' },
      { label: 'Headphones', query: 'wireless headphones' },
      { label: 'Speakers', query: 'bluetooth speaker' },
      { label: 'Soundbars', query: 'soundbar' },
      { label: 'Turntables', query: 'record player' },
      { label: 'Streaming devices', query: 'streaming device' }
    ]
  },
  {
    label: 'Photography',
    query: 'photography',
    icon: 'camera',
    children: [
      { label: 'Cameras', query: 'digital camera' },
      { label: 'Lenses', query: 'camera lens' },
      { label: 'Tripods', query: 'camera tripod' },
      { label: 'Action cameras', query: 'action camera' },
      { label: 'Drones', query: 'camera drone' }
    ]
  },
  {
    label: 'Clothing',
    query: 'clothing',
    icon: 'clothing',
    children: [
      { label: 'Jackets & coats', query: 'jacket coat' },
      { label: 'Shoes', query: 'shoes' },
      { label: 'Jeans', query: 'jeans' },
      { label: 'Knitwear', query: 'knitwear jumper' },
      { label: 'Bags', query: 'bags' },
      { label: 'Watches', query: 'watches' }
    ]
  },
  {
    label: 'Health',
    query: 'health and beauty',
    icon: 'health',
    children: [
      { label: 'Skincare', query: 'skincare' },
      { label: 'Hair care', query: 'hair care' },
      { label: 'Electric shavers', query: 'electric shaver' },
      { label: 'Toothbrushes', query: 'electric toothbrush' },
      { label: 'Fragrance', query: 'perfume' }
    ]
  },
  {
    label: 'Sports',
    query: 'sports',
    icon: 'sports',
    children: [
      { label: 'Running shoes', query: 'running shoes' },
      { label: 'Fitness equipment', query: 'fitness equipment' },
      { label: 'Bikes', query: 'bicycle' },
      { label: 'Camping', query: 'camping gear' },
      { label: 'Sportswear', query: 'sportswear' }
    ]
  },
  {
    label: 'DIY',
    query: 'diy',
    icon: 'diy',
    children: [
      { label: 'Power tools', query: 'power tools' },
      { label: 'Hand tools', query: 'hand tools' },
      { label: 'Paint', query: 'paint' },
      { label: 'Workwear', query: 'workwear' },
      { label: 'Ladders', query: 'ladder' }
    ]
  },
  {
    label: 'Mobility',
    query: 'mobility',
    icon: 'mobility',
    children: [
      { label: 'Car accessories', query: 'car accessories' },
      { label: 'Dash cams', query: 'dash cam' },
      { label: 'E-scooters', query: 'electric scooter' },
      { label: 'Car tyres', query: 'car tyres' },
      { label: 'Roof boxes', query: 'roof box' }
    ]
  }
]

/**
 * Entry points for someone who has not typed anything yet. Deliberately broad
 * and product-shaped rather than trend-shaped: these are seeds for a search, not
 * a merchandising slot, and nothing here is sold or ranked.
 */
export const popularSearches: readonly string[] = [
  'wireless headphones',
  'running shoes',
  'coffee machine',
  'gaming monitor',
  'robot vacuum',
  'office chair',
  'air fryer',
  'mechanical keyboard'
]

const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

const curatedSearchQueries = new Set(
  browseCategories.flatMap((category) => category.children.map((child) => normalise(child.query)))
)

/** Search documents we intentionally publish and link from the sitemap. */
export const isCuratedSearchQuery = (query: string) => curatedSearchQueries.has(normalise(query))

/**
 * The category a query most plausibly belongs to, matched against the taxonomy
 * rather than guessed. Used to offer a way onward when a search returns nothing.
 */
export const categoryForQuery = (query: string): BrowseCategory | undefined => {
  const wanted = normalise(query)
  if (!wanted) return undefined
  const exact = browseCategories.find((category) =>
    normalise(category.query) === wanted ||
    normalise(category.label) === wanted ||
    category.children.some((child) => normalise(child.query) === wanted || normalise(child.label) === wanted)
  )
  if (exact) return exact

  const containsPhrase = (value: string) => ` ${wanted} `.includes(` ${normalise(value)} `)
  // A concrete child beats a broad parent and phrase boundaries keep
  // "headphones" from being classified as "Phones" merely because the
  // letters happen to appear at the end of the word.
  return browseCategories.find((category) =>
    category.children.some((child) => containsPhrase(child.query) || containsPhrase(child.label))
  ) ?? browseCategories.find((category) =>
    containsPhrase(category.query) || containsPhrase(category.label))
}

export type ProductBrowseTrailItem = {
  name: string
  query: string
  kind: 'category' | 'search'
}

/**
 * One deterministic category trail for the visible product page and JSON-LD.
 * A child phrase is stronger than a broad parent substring, and low-information
 * source paths such as "Catalog" are excluded before placement.
 */
export const productBrowseTrail = (
  title: string,
  rawCategoryPath: readonly string[]
): readonly ProductBrowseTrailItem[] => {
  const categoryPath = rawCategoryPath.filter((part) => normalise(part) !== 'catalog')
  const haystack = normalise(`${title} ${categoryPath.join(' ')}`)
  const stem = (value: string) => normalise(value).replace(/s$/, '')
  const hit = (value: string) => {
    const wanted = stem(value)
    return wanted.length > 2 && haystack.includes(wanted)
  }

  const placements = browseCategories.map((category) => ({
    category,
    child: category.children.find((entry) => hit(entry.label) || hit(entry.query))
  }))
  const placed = placements.find((entry) => entry.child)
    ?? placements.find((entry) => hit(entry.category.label))
  const owning = placed?.category
    ?? (categoryPath.length > 0 ? categoryForQuery(categoryPath[0]!) : undefined)

  const trail: ProductBrowseTrailItem[] = []
  if (owning) {
    trail.push({ name: owning.label, query: owning.query, kind: 'category' })
    if (placed?.child) trail.push({ name: placed.child.label, query: placed.child.query, kind: 'search' })
  }
  for (const part of categoryPath) {
    if (owning && normalise(part) === normalise(owning.label)) continue
    if (trail.some((item) => normalise(item.name) === normalise(part))) continue
    trail.push({ name: part, query: part, kind: 'search' })
  }
  return trail
}

/** Sibling intents to offer when a query returns nothing. */
export const relatedSearches = (query: string, limit = 6): readonly BrowseSubCategory[] => {
  const category = categoryForQuery(query)
  if (category) return category.children.slice(0, limit)
  return popularSearches.slice(0, limit).map((item) => ({ label: item, query: item }))
}

/** The category behind a `/c/[category]` slug. */
export const categoryBySlug = (slug: string) => {
  const wanted = normalise(slug.replace(/-+/g, ' '))
  return browseCategories.find((category) => normalise(category.query) === wanted)
    ?? browseCategories.find((category) => normalise(category.label) === wanted)
}
