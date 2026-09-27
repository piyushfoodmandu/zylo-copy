import type { ComponentProps, PropsWithChildren, ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { color } from '../lib/theme'
import { Icon, type IconName } from './Icon'
import { Tappable } from './motion'
import { Heading } from './semantic'

type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'outline' | 'ghost'
type ButtonSize = 'sm' | 'md' | 'lg'

const buttonSurface: Record<ButtonVariant, string> = {
  primary: 'bg-ink-950',
  // Reserved for the decisive commerce action on a screen. One brand-coloured
  // button per view is a signature; three is a carnival.
  accent: 'bg-arro-600',
  secondary: 'bg-fill',
  outline: 'border border-line-strong bg-white',
  ghost: 'bg-transparent'
}

const buttonText: Record<ButtonVariant, string> = {
  primary: 'text-white',
  accent: 'text-white',
  secondary: 'text-ink-950',
  outline: 'text-ink-950',
  ghost: 'text-ink-800'
}

const buttonIconTint: Record<ButtonVariant, string> = {
  primary: color.white,
  accent: color.white,
  secondary: color.ink950,
  outline: color.ink950,
  ghost: color.ink800
}

const buttonBox: Record<ButtonSize, string> = {
  sm: 'min-h-9 px-3.5',
  md: 'min-h-11 px-4',
  lg: 'min-h-13 px-6'
}

const buttonLabel: Record<ButtonSize, string> = {
  sm: 'text-[13px] leading-[18px]',
  md: 'text-[15px] leading-5',
  lg: 'text-base leading-6'
}

// Icon glyphs render as private-use font characters on native, so they leak into
// the accessible name computed from descendants. Naming the control from its own
// label keeps assistive tech reading "Compare", not "Compare <glyph>".
const labelFrom = (children: ReactNode) => typeof children === 'string' ? children : undefined

export const Button = ({
  children,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
  leading,
  iconRight,
  fullWidth = false,
  accessibilityLabel
}: PropsWithChildren<{
  onPress?: () => void
  variant?: ButtonVariant
  size?: ButtonSize
  disabled?: boolean
  /** Replaces the leading icon with a spinner and blocks the press. */
  loading?: boolean
  icon?: IconName
  /** An arbitrary leading element, for marks the icon set cannot draw. */
  leading?: ReactNode
  iconRight?: IconName
  fullWidth?: boolean
  accessibilityLabel?: string
}>) => {
  const tint = buttonIconTint[variant]
  const glyph = size === 'sm' ? 16 : 18
  const label = accessibilityLabel ?? labelFrom(children)
  const inert = disabled || loading

  return (
    <Tappable
      accessibilityRole="button"
      accessibilityState={{ disabled: inert }}
      {...(label ? { accessibilityLabel: label } : {})}
      disabled={inert}
      {...(onPress ? { onPress } : {})}
      className={`flex-row items-center justify-center gap-2 rounded-full ${buttonSurface[variant]} ${buttonBox[size]} ${inert ? 'opacity-40' : ''} ${fullWidth ? 'w-full' : ''}`}
    >
      {loading ? <ActivityIndicator size="small" color={tint} /> : leading ?? (icon ? <Icon name={icon} size={glyph} color={tint} /> : null)}
      <Text className={`font-semibold ${buttonLabel[size]} ${buttonText[variant]}`}>{children}</Text>
      {iconRight ? <Icon name={iconRight} size={glyph} color={tint} /> : null}
    </Tappable>
  )
}

/**
 * A circular icon-only control. It exists so the header, cards and rails stop
 * hand-rolling the same 44px round target with slightly different padding.
 */
export const IconButton = ({
  icon,
  label,
  onPress,
  tone = 'plain',
  size = 'md',
  disabled = false,
  badge
}: {
  icon: IconName
  label: string
  onPress?: () => void
  tone?: 'plain' | 'fill' | 'ink' | 'accent'
  size?: 'sm' | 'md'
  disabled?: boolean
  /** Small count overlay. Hidden entirely at zero rather than shown as "0". */
  badge?: number
}) => {
  const box = size === 'sm' ? 'h-9 w-9' : 'h-11 w-11'
  const surface = {
    plain: '',
    fill: 'bg-fill',
    ink: 'bg-ink-950',
    accent: 'bg-arro-600'
  }[tone]
  const tint = tone === 'ink' || tone === 'accent' ? color.white : color.ink950

  return (
    <Tappable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      {...(onPress ? { onPress } : {})}
      className={`items-center justify-center rounded-full ${box} ${surface} ${disabled ? 'opacity-40' : ''}`}
    >
      <Icon name={icon} size={size === 'sm' ? 17 : 20} color={tint} />
      {badge ? (
        <View className="absolute -right-0.5 -top-0.5 min-w-[18px] items-center justify-center rounded-full bg-arro-600 px-1">
          <Text className="text-[10px] font-bold leading-[18px] text-white">{badge > 99 ? '99+' : badge}</Text>
        </View>
      ) : null}
    </Tappable>
  )
}

// Horizontal facet/filter control. Selected state inverts to the ink surface so
// an active filter is obvious without adding a second colour to the page.
export const Chip = ({
  children,
  active = false,
  onPress,
  icon,
  leading,
  iconRight,
  disabled = false,
  accessibilityLabel
}: PropsWithChildren<{
  active?: boolean
  onPress?: () => void
  icon?: IconName
  /** An arbitrary leading element, for marks the icon set cannot draw. */
  leading?: ReactNode
  iconRight?: IconName
  disabled?: boolean
  accessibilityLabel?: string
}>) => {
  const label = accessibilityLabel ?? labelFrom(children)

  return (
    <Tappable
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}
      {...(label ? { accessibilityLabel: label } : {})}
      disabled={disabled}
      {...(onPress ? { onPress } : {})}
      hitSlop={6}
      scale={0.95}
      className={`min-h-9 flex-row items-center gap-1.5 rounded-full px-3.5 ${active ? 'bg-ink-950' : 'border border-line bg-white'} ${disabled ? 'opacity-40' : ''}`}
    >
      {icon ? <Icon name={icon} size={15} color={active ? color.white : color.ink600} /> : null}
      <Text className={`text-[13px] font-semibold leading-[18px] ${active ? 'text-white' : 'text-ink-800'}`}>
        {children}
      </Text>
      {iconRight ? <Icon name={iconRight} size={14} color={active ? color.white : color.ink400} /> : null}
    </Tappable>
  )
}

type BadgeTone = 'neutral' | 'accent' | 'positive' | 'warning' | 'danger'

const badgeSurface: Record<BadgeTone, string> = {
  neutral: 'bg-fill',
  accent: 'bg-arro-50',
  positive: 'bg-positive-soft',
  warning: 'bg-warning-soft',
  danger: 'bg-danger-soft'
}

const badgeText: Record<BadgeTone, string> = {
  neutral: 'text-ink-600',
  accent: 'text-arro-700',
  positive: 'text-positive',
  warning: 'text-warning',
  danger: 'text-danger'
}

export const Badge = ({
  children,
  tone = 'neutral',
  icon
}: PropsWithChildren<{ tone?: BadgeTone; icon?: IconName }>) => (
  <View className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${badgeSurface[tone]}`}>
    {icon ? (
      <Icon
        name={icon}
        size={12}
        color={tone === 'positive' ? color.positive : tone === 'warning' ? color.warning : tone === 'danger' ? color.danger : tone === 'accent' ? color.arro700 : color.ink600}
      />
    ) : null}
    <Text className={`text-[12px] font-semibold leading-4 ${badgeText[tone]}`}>{children}</Text>
  </View>
)

export const Field = ({
  value,
  onChangeText,
  placeholder,
  keyboardType,
  onSubmitEditing,
  accessibilityLabel,
  autoCapitalize,
  autoCorrect,
  autoComplete,
  returnKeyType
}: {
  value: string
  onChangeText: (value: string) => void
  placeholder: string
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad'
  onSubmitEditing?: () => void
  accessibilityLabel?: string
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters'
  autoCorrect?: boolean
  autoComplete?: ComponentProps<typeof TextInput>['autoComplete']
  returnKeyType?: 'done' | 'go' | 'next' | 'search'
}) => (
  <TextInput
    value={value}
    onChangeText={onChangeText}
    placeholder={placeholder}
    placeholderTextColor={color.ink400}
    keyboardType={keyboardType}
    {...(accessibilityLabel ? { accessibilityLabel } : {})}
    {...(autoCapitalize ? { autoCapitalize } : {})}
    {...(autoCorrect !== undefined ? { autoCorrect } : {})}
    {...(autoComplete ? { autoComplete } : {})}
    {...(returnKeyType ? { returnKeyType } : {})}
    {...(onSubmitEditing ? { onSubmitEditing } : {})}
    className="min-h-11 rounded-xl border border-line bg-white px-3.5 text-[15px] text-ink-950"
  />
)

/**
 * Quantity is the one number a shopper edits directly, so it gets real targets
 * and a decrement that removes the line at zero rather than sticking at one and
 * making them hunt for a separate delete control.
 */
export const QuantityStepper = ({
  quantity,
  onChange,
  onRemove,
  disabled = false,
  label
}: {
  quantity: number
  onChange: (quantity: number) => void
  onRemove?: () => void
  disabled?: boolean
  /** Names the product this stepper belongs to, for assistive tech. */
  label: string
}) => (
  <View className={`h-10 flex-row items-center rounded-full border border-line ${disabled ? 'opacity-40' : ''}`}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={quantity <= 1 ? `Remove ${label}` : `Decrease quantity of ${label}`}
      disabled={disabled}
      onPress={() => (quantity <= 1 ? onRemove?.() : onChange(quantity - 1))}
      className="h-10 w-10 items-center justify-center rounded-full"
    >
      <Icon name={quantity <= 1 && onRemove ? 'trash' : 'minus'} size={15} color={color.ink800} />
    </Pressable>
    <Text
      accessibilityLabel={`Quantity ${quantity}`}
      className="min-w-6 text-center text-[14px] font-semibold leading-5 text-ink-950"
    >
      {quantity}
    </Text>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Increase quantity of ${label}`}
      disabled={disabled}
      onPress={() => onChange(quantity + 1)}
      className="h-10 w-10 items-center justify-center rounded-full"
    >
      <Icon name="plus" size={15} color={color.ink800} />
    </Pressable>
  </View>
)

export const Stars = ({
  value,
  count,
  compact = false
}: {
  value: number
  count?: number
  compact?: boolean
}) => (
  <View
    accessible
    accessibilityRole="image"
    accessibilityLabel={`Rated ${value.toFixed(1)} out of 5${count === undefined ? '' : ` from ${count} ${count === 1 ? 'review' : 'reviews'}`}`}
    aria-label={`Rated ${value.toFixed(1)} out of 5${count === undefined ? '' : ` from ${count} ${count === 1 ? 'review' : 'reviews'}`}`}
    className="flex-row items-center gap-1"
  >
    <Icon name="star" size={compact ? 13 : 15} color={color.warning} />
    <Text className={`font-semibold text-ink-800 ${compact ? 'text-[12px] leading-4' : 'text-[13px] leading-[18px]'}`}>
      {value.toFixed(1)}
    </Text>
    {count === undefined ? null : (
      <Text className={`text-ink-400 ${compact ? 'text-[12px] leading-4' : 'text-[13px] leading-[18px]'}`}>
        ({count})
      </Text>
    )}
  </View>
)

export const SectionHeading = ({
  title,
  subtitle,
  right,
  level = 2
}: {
  title: string
  subtitle?: string
  right?: ReactNode
  /** Section headings are h2 by default so the document keeps one outline. */
  level?: 2 | 3
}) => (
  <View className="mb-4 flex-row items-end justify-between gap-4">
    <View className="min-w-0 flex-1">
      <Heading level={level} className="text-[20px] font-bold leading-7 text-ink-950 md:text-2xl md:leading-8">{title}</Heading>
      {subtitle ? (
        <Text className="mt-1 text-[14px] leading-5 text-ink-600">{subtitle}</Text>
      ) : null}
    </View>
    {right}
  </View>
)

export const Notice = ({
  tone = 'neutral',
  icon = 'info',
  title,
  children
}: PropsWithChildren<{ tone?: BadgeTone; icon?: IconName; title?: string }>) => {
  const tint = tone === 'danger'
    ? color.danger
    : tone === 'warning'
      ? color.warning
      : tone === 'positive'
        ? color.positive
        : color.ink600

  return (
    <View
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      accessibilityLiveRegion={tone === 'danger' || tone === 'warning' ? 'assertive' : 'polite'}
      className={`flex-row gap-3 rounded-2xl p-4 ${badgeSurface[tone]}`}
    >
      <Icon name={icon} size={18} color={tint} />
      <View className="min-w-0 flex-1">
        {title ? <Text className={`font-semibold ${badgeText[tone]}`}>{title}</Text> : null}
        <Text className={`text-[14px] leading-5 text-ink-800 ${title ? 'mt-1' : ''}`}>{children}</Text>
      </View>
    </View>
  )
}

/**
 * The one line that has to appear anywhere Arro adds prices together. A total
 * Arro computed from what it last saw is a planning estimate; the authoritative
 * number belongs to the shop's own checkout, after shipping and tax.
 */
export const EstimateNote = ({ children }: PropsWithChildren) => (
  <View className="flex-row items-start gap-2">
    <Icon name="info" size={13} color={color.ink400} />
    <Text className="min-w-0 flex-1 text-[12px] leading-4 text-ink-400">{children}</Text>
  </View>
)
