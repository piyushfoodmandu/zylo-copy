import { describe, expect, it } from 'vitest'
import {
  buildMcpPresentation,
  renderMcpPresentationText
} from './mcp-presentation.ts'

const sourceLabel = {
  sourceId: 'shopify-global-catalog',
  sourceName: 'Shopify Global Catalog',
  factType: 'connected_catalog_product',
  fetchedAt: '2026-07-09T00:00:00.000Z',
  expiresAt: '2026-07-09T00:15:00.000Z',
  freshnessClass: 'advisory_catalog',
  bindingStatus: 'advisory'
}

describe('MCP presentation product facts', () => {
  it('renders seller identity without inventing a product brand', () => {
    const presentation = buildMcpPresentation({
      toolName: 'search_products',
      httpStatus: 200,
      response: {
        state: 'ready',
        sourceMode: 'connected_sources',
        items: [
          {
            productId: 'gid://shopify/p/nike-dunk-low-levelupkickz',
            title: 'Nike Dunk Low Red White',
            categoryPath: ['Shoes'],
            price: { amountMinor: 49, currency: 'USD' },
            availability: 'in_stock',
            condition: 'new',
            seller: {
              name: 'LevelUpKickz',
              domain: 'levelupkickzz.myshopify.com'
            },
            sourceLabel
          }
        ]
      }
    })

    expect(presentation.facts.find((fact) => fact.label === 'Brand')).toBeUndefined()
    expect(presentation.facts).toContainEqual(expect.objectContaining({
      label: 'Seller',
      value: 'LevelUpKickz (levelupkickzz.myshopify.com)'
    }))
    expect(renderMcpPresentationText({
      presentation,
      requestId: 'seller-brand-boundary'
    })).not.toContain('Brand: LevelUpKickz')
  })

  it('renders source-provided product brand separately from seller identity', () => {
    const presentation = buildMcpPresentation({
      toolName: 'search_products',
      httpStatus: 200,
      response: {
        state: 'ready',
        sourceMode: 'connected_sources',
        items: [
          {
            productId: 'gid://shopify/p/nike-dunk-low-branded',
            title: 'Nike Dunk Low Red White',
            brand: 'Nike',
            categoryPath: ['Shoes'],
            price: { amountMinor: 49, currency: 'USD' },
            availability: 'in_stock',
            condition: 'new',
            seller: {
              name: 'LevelUpKickz',
              domain: 'levelupkickzz.myshopify.com'
            },
            sourceLabel
          }
        ]
      }
    })

    expect(presentation.facts).toContainEqual(expect.objectContaining({
      label: 'Brand',
      value: 'Nike'
    }))
    expect(presentation.facts).toContainEqual(expect.objectContaining({
      label: 'Seller',
      value: 'LevelUpKickz (levelupkickzz.myshopify.com)'
    }))
  })

  it('renders a product handoff as a visible merchant primary action', () => {
    const presentation = buildMcpPresentation({
      toolName: 'search_products',
      httpStatus: 200,
      response: {
        state: 'ready',
        sourceMode: 'connected_sources',
        items: [
          {
            productId: 'gid://shopify/p/charger',
            title: 'USB-C 65W Charger',
            categoryPath: ['Electronics'],
            price: { amountMinor: 39, currency: 'USD' },
            availability: 'in_stock',
            condition: 'new',
            seller: {
              name: 'Power Shop',
              domain: 'power.example'
            },
            handoff: {
              type: 'variant_checkout',
              url: 'https://power.example/products/usb-c-65w?variant=123'
            },
            sourceLabel
          }
        ]
      }
    })

    expect(presentation.primaryAction).toEqual(expect.objectContaining({
      action: 'open_merchant_page',
      label: 'Open merchant variant',
      authority: 'limited',
      url: 'https://power.example/products/usb-c-65w?variant=123'
    }))

    const text = renderMcpPresentationText({
      presentation,
      requestId: 'merchant-handoff-visible'
    })
    expect(text).toContain('Primary action:')
    expect(text).toContain('- Open merchant variant: open_merchant_page (authority: limited) | https://power.example/products/usb-c-65w?variant=123')
    expect(text).toContain('Verify variant, shipping, taxes, final price, returns, and seller trust')
  })

  it('renders a checkout continuation URL without claiming direct completion', () => {
    const presentation = buildMcpPresentation({
      toolName: 'confirm_purchase',
      httpStatus: 200,
      response: {
        state: 'requires_continue_url',
        checkoutStatus: 'requires_continue_url',
        attempt: {
          attemptId: 'attempt-1',
          businessId: 'power-shop',
          cartId: 'cart-1',
          continueUrl: 'https://power.example/checkout/cart-1',
          sourceLabel
        },
        actionPolicy: {
          state: 'checkout_continuation',
          allowedNextActions: [
            {
              action: 'continue_checkout',
              label: 'Continue secure merchant checkout',
              authority: 'allowed',
              reason: 'Final payment remains merchant-controlled.'
            }
          ]
        }
      }
    })

    expect(presentation.primaryAction).toEqual(expect.objectContaining({
      action: 'continue_checkout',
      label: 'Continue on merchant',
      authority: 'allowed',
      url: 'https://power.example/checkout/cart-1'
    }))

    const text = renderMcpPresentationText({
      presentation,
      requestId: 'checkout-continuation-visible'
    })
    expect(text).toContain('- Continue on merchant: continue_checkout (authority: allowed) | https://power.example/checkout/cart-1')
    expect(text).toContain('- Checkout: requires_continue_url')
    expect(text).not.toContain('completed')
  })

  it('renders a prepared purchase handoff as merchant continuation, not payment completion', () => {
    const presentation = buildMcpPresentation({
      toolName: 'prepare_purchase',
      httpStatus: 200,
      response: {
        state: 'ready',
        checkoutStatus: 'merchant_continuation_required',
        sourceMode: 'connected_sources',
        continueUrl: 'https://power.example/cart/cart-1',
        cart: {
          cartId: 'cart-1',
          businessId: 'power-shop',
          businessName: 'Power Shop',
          items: [
            {
              productId: 'gid://shopify/p/charger',
              variantId: 'gid://shopify/v/charger-65w',
              quantity: 1,
              title: 'USB-C 65W Charger',
              price: { amountMinor: 3900, currency: 'USD' },
              availability: 'in_stock'
            }
          ],
          estimatedTotal: { amountMinor: 3900, currency: 'USD' },
          handoff: {
            type: 'cart',
            url: 'https://power.example/cart/cart-1'
          },
          warnings: [],
          sourceLabel: {
            ...sourceLabel,
            sourceId: 'power-shop',
            sourceName: 'Power Shop',
            factType: 'prepared_cart',
            freshnessClass: 'binding_commerce',
            bindingStatus: 'requires_handoff'
          }
        },
        actionPolicy: {
          state: 'checkout_continuation',
          allowedNextActions: [
            {
              action: 'continue_checkout',
              label: 'Continue secure merchant checkout',
              authority: 'allowed',
              reason: 'The source returned a prepared business-scoped handoff; final totals remain merchant-controlled.'
            },
            {
              action: 'get_purchase',
              label: 'Review purchase state',
              authority: 'allowed'
            }
          ]
        }
      }
    })

    expect(presentation.title).toBe('Prepare Purchase')
    expect(presentation.primaryAction).toEqual(expect.objectContaining({
      action: 'continue_checkout',
      label: 'Continue on merchant',
      authority: 'allowed',
      url: 'https://power.example/cart/cart-1'
    }))

    const text = renderMcpPresentationText({
      presentation,
      requestId: 'prepared-cart-handoff-visible'
    })
    expect(text).toContain('- Continue on merchant: continue_checkout (authority: allowed) | https://power.example/cart/cart-1')
    expect(text).toContain('Verify final price, shipping, taxes, returns, and payment details before paying.')
    expect(text).not.toContain('Direct checkout completed')
  })
})
