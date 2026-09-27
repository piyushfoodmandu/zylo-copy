import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PurchaseResponse } from '../types/purchase'
import { CheckoutReview } from './CheckoutReview'

const editor = vi.hoisted(() => ({ kind: 'buyer', hook: 0 }))
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return { ...react, useState: (initial: unknown) => {
    const index = editor.hook++
    if (index === 0) return react.useState(editor.kind === 'buyer')
    if (index === 3) return react.useState(editor.kind === 'address' ? { draft: {} } : undefined)
    return react.useState(initial)
  } }
})
vi.mock('react-native', () => ({ Platform: { OS: 'web' }, KeyboardAvoidingView: 'div', ScrollView: 'div', Pressable: 'button', Text: 'span', View: 'div' }))
vi.mock('../lib/layout', () => ({ useLayoutMode: () => ({ compact: false }) }))
vi.mock('../lib/external-step', () => ({ openExactExternalStep: vi.fn() }))
vi.mock('./Icon', () => ({ Icon: () => null }))
vi.mock('./ProductImage', () => ({ ProductImage: () => null }))
vi.mock('./Sheet', () => ({ Sheet: ({ visible, children, footer }: React.PropsWithChildren<{ visible: boolean; footer: React.ReactNode }>) => visible ? <section>{children}{footer}</section> : null }))
vi.mock('./ui', () => ({
  Badge: ({ children }: React.PropsWithChildren) => <span>{children}</span>,
  Button: ({ children }: React.PropsWithChildren) => <button>{children}</button>,
  Notice: ({ children }: React.PropsWithChildren) => <aside>{children}</aside>,
  Field: ({ accessibilityLabel, value }: { accessibilityLabel: string; value: string }) => <input aria-label={accessibilityLabel} value={value} readOnly />
}))

const purchase = { state: 'merchant_continuation_required', messages: [], links: [], canAddShippingAddress: true } as unknown as PurchaseResponse
const render = (value = purchase) => renderToStaticMarkup(<CheckoutReview purchase={value} disabled={false} working={false} onUpdate={vi.fn()} onEditingChange={vi.fn()} />)

describe('checkout form field ownership', () => {
  beforeEach(() => { editor.hook = 0; editor.kind = 'buyer' })
  it('asks for one contact method, leaving recipient fields to delivery', () => {
    const html = render()
    expect(html.match(/<input/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Email"')
    expect(html).not.toContain('aria-label="First name"')
    expect(html).not.toContain('aria-label="Phone"')
  })
  it('renders delivery fields once without another contact form', () => {
    editor.kind = 'address'
    const html = render()
    expect(html.match(/aria-label="First name"/g)).toHaveLength(1)
    expect(html.match(/aria-label="Phone"/g)).toHaveLength(1)
    expect(html).not.toContain('aria-label="Email"')
  })
  it('still collects buyer names when the merchant explicitly requires them', () => {
    expect(render({ ...purchase, messages: [{ severity: 'warning', resolution: 'recoverable', path: '$.buyer.first_name', text: 'Enter a first name' }] })).toContain('aria-label="First name. Needed by shop"')
  })
  it('does not show an error before the shopper has tried to save', () => {
    const html = render({ ...purchase, messages: [{ code: 'buyer_identity_contact_method_required', severity: 'warning', resolution: 'recoverable', text: 'Missing a valid contact method.' }] })
    expect(html).not.toContain('Missing a valid contact method.')
    expect(html).not.toContain('<aside>')
  })
})
