import { View } from 'react-native'
import { Icon } from './Icon'
import { color } from '../lib/theme'

/**
 * Native falls back to the platform symbol set. The web build carries the exact
 * brand geometry; here the closest system glyph keeps the button honest without
 * bundling an SVG renderer for two marks.
 */
export function BrandMark({ name, size = 18, tone }: { name: 'google' | 'apple'; size?: number; tone?: string }) {
  return (
    <View>
      <Icon name={name} size={size} color={tone ?? (name === 'apple' ? color.white : color.ink950)} />
    </View>
  )
}
