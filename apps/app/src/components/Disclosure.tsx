import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { color } from '../lib/theme'
import { Icon } from './Icon'

/** A restrained, keyboard- and screen-reader-friendly disclosure row. */
export function Disclosure({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false)
  const contentId = `disclosure-${question.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`

  return (
    <View className="border-b border-line">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={question}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        aria-controls={contentId}
        onPress={() => setOpen((current) => !current)}
        className="min-h-14 flex-row items-center gap-4 py-3"
      >
        <Text className="min-w-0 flex-1 text-[15px] font-semibold leading-5 text-ink-950">{question}</Text>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} color={color.ink600} />
      </Pressable>
      {open ? (
        <View nativeID={contentId} role="region" aria-label={question} className="pb-5 pr-10">
          <Text className="max-w-[760px] text-[14px] leading-6 text-ink-600">{answer}</Text>
        </View>
      ) : null}
    </View>
  )
}
