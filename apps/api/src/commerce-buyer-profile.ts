import type { QueryResultRow } from 'pg'
import type {
  CommerceBuyerProfile,
  UcpBuyer,
  UcpCheckoutCreateRequest,
  UcpFulfillment
} from '@arro/contracts'
import type { CommercePrincipal } from './commerce-principal.ts'
import type { Queryable } from './target-business-repository.ts'

export class CommerceBuyerProfileError extends Error {
  readonly code:
    | 'buyer_profile_invalid'
    | 'buyer_profile_not_found'
    | 'buyer_profile_secret_rejected'

  constructor(
    code:
      | 'buyer_profile_invalid'
      | 'buyer_profile_not_found'
      | 'buyer_profile_secret_rejected',
    message: string
  ) {
    super(message)
    this.name = 'CommerceBuyerProfileError'
    this.code = code
  }
}

type BuyerProfileRow = QueryResultRow & {
  profile_json: CommerceBuyerProfile
}

const sensitiveKeyPattern = /(^|_|\b)(pan|cvv|cvc|card_number|cardnumber|payment_data|paymentdata|google_pay_token|googlepaytoken|cryptogram|token|credential|secret)(_|$|\b)/i

const walkForSensitiveKeys = (value: unknown, path: string[] = []): string | undefined => {
  if (!value || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) {
      const found = walkForSensitiveKeys(entry, [...path, String(index)])
      if (found) return found
    }
    return undefined
  }
  for (const [key, entry] of Object.entries(value)) {
    if (sensitiveKeyPattern.test(key) && key !== 'customerReference' && key !== 'referenceId') {
      return [...path, key].join('.')
    }
    const found = walkForSensitiveKeys(entry, [...path, key])
    if (found) return found
  }
  return undefined
}

const assertSafeProfile = (profile: CommerceBuyerProfile) => {
  const secretPath = walkForSensitiveKeys(profile)
  if (secretPath) {
    throw new CommerceBuyerProfileError(
      'buyer_profile_secret_rejected',
      `Buyer profile field ${secretPath} looks like a raw payment credential or provider secret.`
    )
  }
  if (profile.defaultShippingAddressId) {
    const hasAddress = profile.shippingAddresses.some((address) => address.addressId === profile.defaultShippingAddressId)
    if (!hasAddress) {
      throw new CommerceBuyerProfileError(
        'buyer_profile_invalid',
        'defaultShippingAddressId must reference one of the saved shipping addresses.'
      )
    }
  }
}

const namesFromRecipient = (recipientName: string) => {
  const parts = recipientName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}
  const firstName = parts[0]
  if (!firstName) return {}
  if (parts.length === 1) return { first_name: firstName }
  return {
    first_name: firstName,
    last_name: parts.slice(1).join(' ')
  }
}

export const checkoutDefaultsFromBuyerProfile = (
  profile: CommerceBuyerProfile | undefined,
  checkout: UcpCheckoutCreateRequest
): UcpCheckoutCreateRequest => {
  if (!profile) return checkout
  const defaultAddress = profile.defaultShippingAddressId
    ? profile.shippingAddresses.find((address) => address.addressId === profile.defaultShippingAddressId)
    : profile.shippingAddresses[0]
  const buyer: UcpBuyer | undefined = checkout.buyer ?? (
    profile.email || profile.phone || defaultAddress
      ? {
          ...(profile.email ? { email: profile.email } : {}),
          ...(profile.phone ? { phone_number: profile.phone } : {}),
          ...(defaultAddress ? namesFromRecipient(defaultAddress.recipientName) : {})
        }
      : undefined
  )
  const fulfillment: UcpFulfillment | undefined = checkout.fulfillment ?? (
    defaultAddress
      ? {
          methods: [
            {
              type: 'shipping',
              destinations: [{
                type: 'shipping_address',
                ...namesFromRecipient(defaultAddress.recipientName),
                street_address: defaultAddress.line1,
                ...(defaultAddress.line2 ? { extended_address: defaultAddress.line2 } : {}),
                address_locality: defaultAddress.city,
                ...(defaultAddress.region ? { address_region: defaultAddress.region } : {}),
                postal_code: defaultAddress.postalCode,
                address_country: defaultAddress.countryCode,
                ...(profile.phone ? { phone_number: profile.phone } : {})
              }]
            }
          ]
        }
      : undefined
  )
  return {
    ...checkout,
    ...(buyer ? { buyer } : {}),
    ...(fulfillment ? { fulfillment } : {})
  }
}

export type CommerceBuyerProfileStore = {
  read(principal: CommercePrincipal): Promise<CommerceBuyerProfile | undefined>
  upsert(input: {
    principal: CommercePrincipal
    profile: Omit<CommerceBuyerProfile, 'ownerId'>
  }): Promise<CommerceBuyerProfile>
}

export const createPostgresCommerceBuyerProfileStore = ({ client }: { client: Queryable }): CommerceBuyerProfileStore => ({
  async read(principal) {
    const row = await client.query<BuyerProfileRow>(
      `
        select profile_json
        from commerce_buyer_profiles
        where owner_key_id = $1
          and owner_principal_hash = $2
        limit 1
      `,
      [principal.keyId, principal.ownerPrincipalHash]
    )
    return row.rows[0]?.profile_json
  },

  async upsert({ principal, profile }) {
    const storedProfile: CommerceBuyerProfile = {
      ownerId: principal.ownerPrincipalHash,
      ...profile
    }
    assertSafeProfile(storedProfile)
    const row = await client.query<BuyerProfileRow>(
      `
        insert into commerce_buyer_profiles (
          owner_key_id,
          owner_principal_hash,
          owner_id,
          profile_json
        )
        values ($1, $2, $3, $4::jsonb)
        on conflict (owner_key_id, owner_principal_hash)
        do update set
          owner_id = excluded.owner_id,
          profile_json = excluded.profile_json,
          updated_at = now()
        returning profile_json
      `,
      [
        principal.keyId,
        principal.ownerPrincipalHash,
        storedProfile.ownerId,
        JSON.stringify(storedProfile)
      ]
    )
    if (!row.rows[0]) {
      throw new CommerceBuyerProfileError('buyer_profile_invalid', 'Buyer profile could not be saved.')
    }
    return row.rows[0].profile_json
  }
})
