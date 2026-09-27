import { describe, expect, it, vi } from 'vitest'
import type { UcpCheckoutCreateRequest } from '@arro/contracts'
import {
  CommerceBuyerProfileError,
  checkoutDefaultsFromBuyerProfile,
  createPostgresCommerceBuyerProfileStore
} from './commerce-buyer-profile.ts'
import type { CommercePrincipal } from './commerce-principal.ts'
import type { Queryable } from './target-business-repository.ts'

const principal: CommercePrincipal = {
  keyId: 'test-key',
  ownerPrincipal: 'buyer-profile-test',
  ownerPrincipalHash: 'sha256:buyer-profile-owner',
  integrationId: 'agent:test-key:buyer-profile-test',
  agentSessionId: 'agent-session-1'
}

describe('commerce buyer profile', () => {
  it('applies safe buyer and fulfillment defaults without overwriting explicit checkout fields', () => {
    const profile = {
      ownerId: principal.ownerPrincipalHash,
      email: 'shopper@example.com',
      phone: '+14155550100',
      countryCode: 'US',
      shippingAddresses: [
        {
          addressId: 'home',
          recipientName: 'Arro Shopper',
          line1: '1 Market St',
          city: 'San Francisco',
          region: 'CA',
          postalCode: '94105',
          countryCode: 'US'
        }
      ],
      defaultShippingAddressId: 'home'
    }

    const checkout: UcpCheckoutCreateRequest = {
      line_items: [
        {
          item: {
            id: 'sku_65w_charger',
            title: '65W USB-C Charger'
          },
          quantity: 1
        }
      ]
    }
    const withDefaults = checkoutDefaultsFromBuyerProfile(profile, checkout)
    expect(withDefaults.buyer).toMatchObject({
      email: 'shopper@example.com',
      phone_number: '+14155550100',
      first_name: 'Arro',
      last_name: 'Shopper'
    })
    expect(withDefaults.fulfillment?.methods?.[0]).toMatchObject({
      type: 'shipping',
      destinations: [{
        type: 'shipping_address',
        first_name: 'Arro',
        last_name: 'Shopper',
        street_address: '1 Market St',
        address_locality: 'San Francisco',
        address_region: 'CA',
        postal_code: '94105',
        address_country: 'US',
        phone_number: '+14155550100'
      }]
    })

    const explicit = checkoutDefaultsFromBuyerProfile(profile, {
      ...checkout,
      buyer: { email: 'explicit@example.com' },
      fulfillment: { methods: [{ type: 'pickup' }] }
    })
    expect(explicit.buyer).toEqual({ email: 'explicit@example.com' })
    expect(explicit.fulfillment).toEqual({ methods: [{ type: 'pickup' }] })
  })

  it('rejects raw payment credential-looking fields before persistence', async () => {
    const query = vi.fn()
    const store = createPostgresCommerceBuyerProfileStore({
      client: { query } as unknown as Queryable
    })

    await expect(store.upsert({
      principal,
      profile: {
        email: 'shopper@example.com',
        shippingAddresses: [],
        safePaymentReferences: [
          {
            provider: 'trusted_host',
            referenceId: 'display-ref',
            status: 'active',
            token: 'raw-token-that-must-not-persist'
          } as never
        ]
      }
    })).rejects.toMatchObject({
      code: 'buyer_profile_secret_rejected'
    } satisfies Partial<CommerceBuyerProfileError>)
    expect(query).not.toHaveBeenCalled()
  })

  it('rejects a default shipping address that is not saved', async () => {
    const query = vi.fn()
    const store = createPostgresCommerceBuyerProfileStore({
      client: { query } as unknown as Queryable
    })

    await expect(store.upsert({
      principal,
      profile: {
        email: 'shopper@example.com',
        shippingAddresses: [],
        defaultShippingAddressId: 'missing'
      }
    })).rejects.toMatchObject({
      code: 'buyer_profile_invalid'
    } satisfies Partial<CommerceBuyerProfileError>)
    expect(query).not.toHaveBeenCalled()
  })
})
