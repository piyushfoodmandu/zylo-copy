import { Text, View } from 'react-native'
import { browseCategories } from '../lib/categories'
import { categoryHref } from '../lib/product-url'
import { siteName } from '../lib/seo'
import { ProductLink } from './ProductLink'
import { Shell } from './Page'
import { ContentInfo, Heading, Nav } from './semantic'

/**
 * Every page ends with the same category links. This is the internal-linking
 * backbone: a crawler that lands on any product still finds a path to every
 * category, and a shopper who reaches the end of a page gets somewhere to go
 * next instead of a dead end.
 *
 * It is page content, not chrome. Pinned to the viewport it would spend real
 * estate on links nobody is looking at yet; at the end of the scroll it costs
 * nothing until someone has run out of page.
 */
export function SiteFooter({ className = '' }: { className?: string }) {
  return (
    <ContentInfo className={`border-t border-line bg-fill-soft ${className}`}>
      <Shell className="py-10 md:py-12">
        <Nav label="Browse categories">
          <Heading level={2} className="text-[13px] font-semibold uppercase leading-4 tracking-[0.6px] text-ink-400">
            Browse
          </Heading>
          <View className="mt-4 flex-row flex-wrap gap-x-6 gap-y-3">
            {browseCategories.map((category) => (
              <ProductLink
                key={category.query}
                href={categoryHref(category.query)}
                className="min-h-8 justify-center"
              >
                <Text className="text-[14px] leading-5 text-ink-600">{category.label}</Text>
              </ProductLink>
            ))}
          </View>
        </Nav>

        <View className="mt-8 border-t border-line pt-6">
          <Text className="max-w-[600px] text-[13px] leading-5 text-ink-400">
            {siteName} compares live offers from real shops. The shop you buy from stays the seller of record.
          </Text>
        </View>
      </Shell>
    </ContentInfo>
  )
}
