import { View } from 'react-native'
import type { SkeletonProps } from './Skeleton'

/**
 * The web placeholder sweeps a CSS gradient over the fill tint. The animation
 * is composited by the browser, so a grid of twenty skeletons costs no
 * main-thread work — and the reduced-motion rule in the web stylesheet stops it
 * for anyone who asked their system for less movement.
 */
export const Skeleton = ({ className = '', pill = false }: SkeletonProps) => (
  <View
    aria-hidden
    className={`arro-shimmer bg-fill ${pill ? 'rounded-full' : 'rounded-xl'} ${className}`}
  />
)
