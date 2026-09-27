import { View } from 'react-native'
import { Skeleton } from './Skeleton'

/**
 * Placeholders are built from the real components' measurements rather than
 * generic bars. A skeleton whose proportions match what arrives means nothing
 * jumps when the data lands, so the wait reads as the page filling in rather
 * than the page changing its mind.
 */

export const ProductCardSkeleton = () => (
  <View className="gap-3">
    <Skeleton className="aspect-square w-full rounded-2xl" />
    <View className="gap-2">
      <Skeleton pill className="h-3 w-1/2" />
      <Skeleton pill className="h-[14px] w-full" />
      <Skeleton pill className="h-[14px] w-3/4" />
      <Skeleton pill className="mt-1 h-5 w-2/5" />
    </View>
  </View>
)

/** A stable first paint while native category/home rails use their client path. */
export const ProductRailSkeleton = ({ itemWidth = 172 }: { itemWidth?: number }) => (
  <View>
    <Skeleton pill className="h-6 w-36" />
    <Skeleton pill className="mt-2 h-3.5 w-60" />
    <View className="mt-4 flex-row gap-4 overflow-hidden">
      {[0, 1, 2, 3].map((index) => (
        <View key={index} style={{ width: itemWidth }}>
          <ProductCardSkeleton />
        </View>
      ))}
    </View>
  </View>
)

const chunk = (count: number, size: number) => {
  const rows: number[][] = []
  for (let index = 0; index < count; index += size) {
    rows.push(Array.from({ length: size }, (_, offset) => index + offset))
  }
  return rows
}

/**
 * Laid out on the same column count and gaps as the real grid, so the loading
 * state occupies the exact space the results will.
 */
export const ResultsGridSkeleton = ({ columns, rows = 2 }: { columns: number; rows?: number }) => (
  <View className="gap-7">
    {chunk(columns * rows, columns).map((row) => (
      <View key={row[0]} className="flex-row gap-3">
        {row.map((index) => (
          <View key={index} className="min-w-0 flex-1">
            <ProductCardSkeleton />
          </View>
        ))}
      </View>
    ))}
  </View>
)

export const OfferRowSkeleton = () => (
  <View className="flex-row items-center gap-4 border-t border-line py-4">
    <View className="min-w-0 flex-1 gap-2">
      <Skeleton pill className="h-4 w-2/5" />
      <Skeleton pill className="h-3 w-3/5" />
    </View>
    <Skeleton pill className="h-5 w-20" />
    <Skeleton className="h-9 w-16 rounded-full" />
  </View>
)

export const DetailSkeleton = ({ desktop }: { desktop: boolean }) => (
  <View className="mx-auto w-full max-w-[1320px] px-4 py-4 md:px-8 md:py-8">
    <Skeleton pill className="mb-5 h-4 w-64" />
    <View className={desktop ? 'flex-row items-start gap-12' : 'gap-5'}>
      <View className={desktop ? 'w-[46%] max-w-[560px] gap-3' : 'gap-3'}>
        <Skeleton className={`w-full rounded-3xl ${desktop ? 'h-[480px]' : 'h-[280px]'}`} />
        <View className="flex-row gap-2">
          {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-16 w-16 rounded-xl" />)}
        </View>
      </View>

      <View className="min-w-0 flex-1">
        <Skeleton pill className="h-4 w-24" />
        <Skeleton pill className="mt-3 h-8 w-full" />
        <Skeleton pill className="mt-2 h-8 w-2/3" />
        <Skeleton pill className="mt-4 h-4 w-32" />
        <View className="mt-6 border-t border-line pt-5">
          <Skeleton pill className="h-3.5 w-28" />
          <Skeleton pill className="mt-2.5 h-9 w-44" />
          <Skeleton pill className="mt-2.5 h-3 w-52" />
        </View>
        <View className="mt-5 gap-2.5">
          <Skeleton className="h-13 w-full rounded-full" />
          <Skeleton className="h-13 w-full rounded-full" />
        </View>
      </View>
    </View>

    <View className="mt-10 border-t border-line pt-8 md:mt-14">
      <Skeleton pill className="h-6 w-44" />
      <View className="mt-4">
        {[0, 1, 2].map((index) => <OfferRowSkeleton key={index} />)}
      </View>
    </View>
  </View>
)

export const LineItemSkeleton = () => (
  <View className="flex-row items-center gap-3.5">
    <Skeleton className="h-[72px] w-[72px] rounded-2xl" />
    <View className="min-w-0 flex-1 gap-2">
      <Skeleton pill className="h-3 w-1/4" />
      <Skeleton pill className="h-[14px] w-4/5" />
      <Skeleton pill className="h-[14px] w-1/3" />
    </View>
    <Skeleton pill className="h-5 w-16" />
  </View>
)

export const CheckoutSkeleton = ({ desktop }: { desktop: boolean }) => (
  <View className="mx-auto w-full max-w-[1080px] px-4 py-4 md:px-8 md:py-8">
    <Skeleton pill className="h-4 w-40" />
    <View className={`mt-5 ${desktop ? 'flex-row items-start gap-6' : 'gap-4'}`}>
      <View className="min-w-0 flex-1 rounded-3xl bg-white p-5 md:p-7">
        <Skeleton pill className="h-6 w-24" />
        <Skeleton pill className="mt-4 h-8 w-3/5" />
        <Skeleton pill className="mt-2.5 h-4 w-4/5" />
        <View className="mt-7 gap-5 border-t border-line pt-6">
          {[0, 1].map((index) => <LineItemSkeleton key={index} />)}
        </View>
      </View>
      <View className={desktop ? 'w-[340px]' : ''}>
        <View className="rounded-3xl bg-white p-5">
          <Skeleton pill className="h-7 w-full" />
          <Skeleton pill className="mt-4 h-14 w-full" />
          <Skeleton className="mt-4 h-13 w-full rounded-full" />
        </View>
      </View>
    </View>
  </View>
)
