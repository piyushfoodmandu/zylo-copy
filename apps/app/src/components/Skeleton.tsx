import { Animated } from 'react-native'
import { useSkeletonPulse } from '../lib/motion'

export type SkeletonProps = {
  className?: string
  /** Rounds to a pill. Use for text lines so a placeholder reads as text. */
  pill?: boolean
}

/**
 * A placeholder has one job: say "content is coming, and it will be this shape".
 * A still grey box says the first half only, which is why it reads as a broken
 * layout rather than a loading one.
 *
 * Every native skeleton on screen breathes from one shared driver, so a grid of
 * twenty costs one animation. The web build sweeps a CSS gradient instead and
 * costs no main-thread work at all.
 */
export const Skeleton = ({ className = '', pill = false }: SkeletonProps) => {
  const pulse = useSkeletonPulse()

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={`bg-fill ${pill ? 'rounded-full' : 'rounded-xl'} ${className}`}
      style={pulse}
    />
  )
}
