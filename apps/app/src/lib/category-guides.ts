import type { BrowseCategory } from './categories'

export type CategoryGuide = {
  intro: string
  considerations: readonly { title: string; description: string }[]
}

const guide = (
  intro: string,
  considerations: readonly [title: string, description: string][]
): CategoryGuide => ({
  intro,
  considerations: considerations.map(([title, description]) => ({ title, description }))
})

const guides: Record<string, CategoryGuide> = {
  home: guide('Start with the job the product must do, then compare the exact capacity, size and model across shops.', [
    ['Measure the space', 'Check dimensions, capacity and clearance before price. A cheaper appliance or piece of furniture is not a saving if it does not fit.'],
    ['Count ongoing costs', 'Look for filters, bags, capsules, energy use or replacement parts that change the cost after purchase.'],
    ['Check what is included', 'Accessories, installation and warranty coverage can differ even when two listings use a similar title.']
  ]),
  garden: guide('Match the product to the area, weather and storage you actually have before comparing the same specification.', [
    ['Fit the area', 'Check coverage, cutting width, dimensions and power against the size of the garden or outdoor space.'],
    ['Compare materials', 'Weather exposure, frame materials and care requirements often matter more than a small price difference.'],
    ['Plan storage and upkeep', 'Include fuel, batteries, blades, covers and replacement parts when judging the long-term cost.']
  ]),
  kids: guide('Compatibility, age guidance and everyday cleaning come before price when comparing products for children.', [
    ['Check the exact fit', 'Use the manufacturer’s age, height, weight and vehicle compatibility guidance for the exact model.'],
    ['Verify safety information', 'Read the current product instructions and the shop’s supplied safety details; Arro does not infer certification.'],
    ['Think past day one', 'Washable covers, replacement parts, folding size and adjustability affect how long a product remains useful.']
  ]),
  toys: guide('Compare the exact set, age range and included pieces so near-identical titles do not hide different products.', [
    ['Match the age guidance', 'Check the manufacturer’s age range, small-parts warnings and required supervision for the exact item.'],
    ['Count what is included', 'Piece count, figures, batteries and expansion packs can make similar-looking listings materially different.'],
    ['Check size and storage', 'Finished dimensions and storage needs matter for large sets, outdoor toys and puzzles.']
  ]),
  gaming: guide('Platform compatibility and the exact hardware revision are the fastest way to narrow a gaming comparison.', [
    ['Confirm compatibility', 'Check console, PC, connector and operating-system support for the exact model and revision.'],
    ['Compare the useful specs', 'Refresh rate, resolution, latency, storage and wireless standards should match the way you play.'],
    ['Inspect the bundle', 'Controllers, cables, stands, subscriptions and bundled games can explain a price gap between shops.']
  ]),
  electronics: guide('Compare model numbers and the few specifications that change daily use; product families often contain very different configurations.', [
    ['Match the full model', 'Processor, memory, storage, display and model suffixes can distinguish products with almost identical names.'],
    ['Check ports and expansion', 'Connections, charging standards and upgrade options determine whether existing accessories will work.'],
    ['Verify region and warranty', 'Keyboard layout, plug type, cellular bands and warranty handling can vary by seller and region.']
  ]),
  'mobile phones': guide('Storage, network support and the exact regional model matter more than comparing a family name alone.', [
    ['Check the exact variant', 'Confirm storage, colour, SIM format, model suffix and whether the phone is locked or unlocked.'],
    ['Match network and charging', 'Verify supported bands, eSIM availability, charger requirements and the accessories included in the box.'],
    ['Consider support', 'Warranty region, update policy, repair options and return terms can outweigh a small upfront saving.']
  ]),
  'sound and tv': guide('Start with room, fit and connection needs, then compare the same size and model across sellers.', [
    ['Fit the space', 'Screen size, viewing distance, headphone style and speaker placement change the experience more than a spec-sheet headline.'],
    ['Check formats and ports', 'HDMI features, codecs, wireless standards and app support should match the devices you already use.'],
    ['Inspect the box', 'Mounts, remotes, cases, cables and power adapters are not always included in otherwise similar offers.']
  ]),
  photography: guide('Lens mount, sensor compatibility and the intended shooting style should narrow the choice before price.', [
    ['Confirm the system', 'Check mount, sensor coverage, autofocus support and firmware compatibility for cameras, lenses and accessories.'],
    ['Match the use case', 'Weight, stabilization, weather sealing, focus speed and video limits matter differently for travel, sport and studio work.'],
    ['Budget for the kit', 'Batteries, cards, filters, bags and adapters can materially change the complete cost.']
  ]),
  clothing: guide('Compare the exact size, material and colour, then check whether the shop’s return policy suits a fit-sensitive purchase.', [
    ['Use the shop’s size chart', 'A familiar size label can measure differently across brands, cuts and regions.'],
    ['Read material and care', 'Fabric composition, lining, waterproofing and wash instructions affect comfort and longevity.'],
    ['Check the exact variant', 'Colour names, season, width and style codes help distinguish similar listings and clearance versions.']
  ]),
  'health and beauty': guide('Ingredients, pack size and the exact device attachment or formula should be clear before comparing prices.', [
    ['Match the exact formula', 'Check ingredient lists, shade, concentration, fragrance and any manufacturer guidance relevant to you.'],
    ['Compare like with like', 'Unit size, multipacks, refills and included attachments can make the lowest headline price misleading.'],
    ['Check device compatibility', 'For electrical products, confirm voltage, plug, replacement heads and warranty region.']
  ]),
  sports: guide('Fit, intended intensity and replacement needs are the useful filters before comparing the same product across shops.', [
    ['Get the fit right', 'Use the manufacturer’s sizing and dimensions for shoes, bikes, protective equipment and training gear.'],
    ['Match the activity', 'Surface, weather, load rating and frequency of use determine which features are worth paying for.'],
    ['Plan maintenance', 'Tyres, cleats, grips, consumables and service parts can change the total cost over time.']
  ]),
  diy: guide('Match the tool or material to the exact job and existing battery system before sorting by price.', [
    ['Check the working specification', 'Power, capacity, dimensions and supported materials should fit the task rather than the broad product category.'],
    ['Inspect battery and accessories', 'Bare tools, kits, blades, bits and battery generations can look similar while including very different value.'],
    ['Plan safe use', 'Follow the manufacturer’s instructions and include the required protection, extraction and installation equipment.']
  ]),
  mobility: guide('Vehicle compatibility, installation and local-use requirements should be confirmed before comparing the same accessory or device.', [
    ['Confirm compatibility', 'Use the exact vehicle, model year, dimensions, connector and load limits rather than relying on a broad fit claim.'],
    ['Check installation', 'Mounts, wiring, tools and professional fitting can change both the practical and total cost.'],
    ['Verify use requirements', 'For tyres, cameras and powered mobility products, check current manufacturer guidance and applicable local rules.']
  ])
}

export const categoryGuideFor = (category: BrowseCategory) => guides[category.query] ?? guide(
  `Compare the exact ${category.label.toLocaleLowerCase()} product and variant across shops, not the family name alone.`,
  [
    ['Match the exact model', 'Check variant, dimensions and included accessories before treating two offers as equivalent.'],
    ['Compare the complete cost', 'Delivery, installation and consumables may be settled by the shop at checkout.'],
    ['Check the current offer', 'Price and availability can change, so use the source and last-checked details shown by Arro.']
  ]
)

export const categoryQuestions = (category: BrowseCategory) => [
  {
    question: `Why can ${category.label.toLocaleLowerCase()} prices differ between shops?`,
    answer: 'Each shop controls its own price, stock and checkout total. Arro groups the current offers it can verify and labels the seller and last-checked time; shipping and tax may still be confirmed at checkout.'
  },
  {
    question: 'How do I know I am comparing the same product?',
    answer: 'Match the model, variant, size, colour and included accessories shown in the listing. If a source does not provide enough detail, open the shop offer and verify the exact configuration before buying.'
  },
  {
    question: 'What does “last checked” mean?',
    answer: 'It is when Arro received the displayed product fact from the source. It is a freshness signal, not a promise that stock or the final checkout total cannot change.'
  }
] as const
