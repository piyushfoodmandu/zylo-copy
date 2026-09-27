import {
  createHash,
  createSign,
  generateKeyPairSync,
  sign,
  type KeyObject
} from 'node:crypto'
import {
  UCP_STABLE_VERSION,
  type UcpCheckout,
  type UcpPaymentInstrument,
  type UcpPlatformProfile,
  type UcpProfile
} from '@arro/contracts'
import {
  businessProfile,
  platformProfile,
  referenceCheckout
} from '@arro/ucp-client/reference-merchant.test-support'
import { jcsCanonicalize, type Ap2TrustedIssuer } from './ap2-mandate.ts'
import type { PurchaseMandate } from './purchase-mandate.ts'
import { UCP_AP2_MANDATE_CAPABILITY } from './platform-profile.ts'

const issuerId = 'https://ap2-authority.reference.arro.test'
const issuerKid = 'arro-ap2-reference-issuer-1'
const merchantKid = 'arro-ap2-reference-merchant-1'
const merchantOrigin = 'https://merchant.example'

const base64UrlJson = (value: unknown) =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')

const signInput = (privateKey: KeyObject, input: string) => {
  const signer = createSign('sha256')
  signer.update(input)
  signer.end()
  return signer.sign(privateKey).toString('base64url')
}

const signCompactJws = ({
  privateKey,
  header,
  payload
}: {
  privateKey: KeyObject
  header: Record<string, unknown>
  payload: Record<string, unknown>
}) => {
  const protectedHeader = base64UrlJson(header)
  const body = base64UrlJson(payload)
  const signingInput = `${protectedHeader}.${body}`
  return `${signingInput}.${signInput(privateKey, signingInput)}`
}

const signDetachedJws = ({
  privateKey,
  header,
  payload
}: {
  privateKey: KeyObject
  header: Record<string, unknown>
  payload: Record<string, unknown>
}) => {
  const protectedHeader = base64UrlJson(header)
  const body = Buffer.from(jcsCanonicalize(payload), 'utf8').toString('base64url')
  return `${protectedHeader}..${signInput(privateKey, `${protectedHeader}.${body}`)}`
}

const sha256Base64Url = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('base64url')

const withAp2Capability = <T extends UcpProfile | UcpPlatformProfile>(profile: T): T => ({
  ...profile,
  ucp: {
    ...profile.ucp,
    capabilities: {
      ...profile.ucp.capabilities,
      [UCP_AP2_MANDATE_CAPABILITY]: [{
        version: UCP_STABLE_VERSION,
        spec: `https://ucp.dev/${UCP_STABLE_VERSION}/specification/payment/extensions/ap2-mandates`,
        schema: `https://ucp.dev/${UCP_STABLE_VERSION}/schemas/common/payment_ap2_mandate.json`,
        extends: 'dev.ucp.shopping.checkout',
        config: {
          vp_formats_supported: {
            'dc+sd-jwt': {}
          }
        }
      }]
    }
  }
}) as T

const delegatedMandate = ({
  privateKey,
  previousMandate,
  payload,
  checkoutId,
  nowSeconds
}: {
  privateKey: KeyObject
  previousMandate: string
  payload: Record<string, unknown>
  checkoutId: string
  nowSeconds: number
}) => signCompactJws({
  privateKey,
  header: { alg: 'ES256', typ: 'kb+sd-jwt' },
  payload: {
    aud: merchantOrigin,
    nonce: checkoutId,
    iat: nowSeconds,
    sd_hash: sha256Base64Url(previousMandate.endsWith('~') ? previousMandate : `${previousMandate}~`),
    delegate_payload: [payload]
  }
})

export type Ap2ReferenceOpenMandates = {
  checkoutMandate: string
  paymentMandate: string
}

export type Ap2ReferenceCompletionAuthority = {
  checkoutMandate: string
  paymentMandate: string
  instrument: UcpPaymentInstrument
  checkoutReceiptReference: string
  paymentReceiptReference: string
}

const terminalCompact = (mandate: string) =>
  mandate.split('~~').at(-1)?.split('~')[0] ?? ''

export const createAp2ReferenceEnvironment = ({
  checkoutId = 'chk_ap2_reference'
}: {
  checkoutId?: string
} = {}) => {
  const issuerKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const agentKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const merchantKeys = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const issuerPublicJwk = {
    ...issuerKeys.publicKey.export({ format: 'jwk' }) as Record<string, unknown>,
    kid: issuerKid,
    kty: 'EC',
    alg: 'ES256',
    use: 'sig'
  }
  const agentPublicJwk = agentKeys.publicKey.export({ format: 'jwk' }) as Record<string, unknown>
  const merchantPublicJwk = {
    ...merchantKeys.publicKey.export({ format: 'jwk' }) as Record<string, unknown>,
    kid: merchantKid,
    kty: 'EC',
    alg: 'ES256',
    use: 'sig'
  }
  const platform = withAp2Capability(platformProfile())
  const merchant = withAp2Capability({
    ...businessProfile(),
    keys: [merchantPublicJwk]
  })
  const trustedIssuers: Ap2TrustedIssuer[] = [{
    issuer: issuerId,
    audience: merchantOrigin,
    keys: [issuerPublicJwk]
  }]

  const checkout = (status: UcpCheckout['status'] = 'ready_for_complete'): UcpCheckout => {
    const current = referenceCheckout(status, merchant, checkoutId)
    const withoutAp2 = {
      ...current,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      ucp: {
        ...current.ucp,
        capabilities: {
          ...current.ucp.capabilities,
          [UCP_AP2_MANDATE_CAPABILITY]: [{ version: UCP_STABLE_VERSION }]
        }
      }
    }
    const merchantAuthorization = signDetachedJws({
      privateKey: merchantKeys.privateKey,
      header: { alg: 'ES256', kid: merchantKid },
      payload: withoutAp2 as unknown as Record<string, unknown>
    })
    return {
      ...withoutAp2,
      ap2: { merchant_authorization: merchantAuthorization }
    } as UcpCheckout
  }

  const checkoutJwt = (current: UcpCheckout) => signCompactJws({
    privateKey: merchantKeys.privateKey,
    header: { alg: 'ES256', kid: merchantKid, typ: 'JWT' },
    payload: current as unknown as Record<string, unknown>
  })

  const humanPresentAuthority = (current: UcpCheckout): Ap2ReferenceCompletionAuthority => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const merchantCheckoutJwt = checkoutJwt(current)
    const checkoutHash = sha256Base64Url(merchantCheckoutJwt)
    const instrumentId = `ap2-instrument-${current.id}`
    const checkoutMandate = `${signCompactJws({
      privateKey: issuerKeys.privateKey,
      header: { alg: 'ES256', kid: issuerKid },
      payload: {
        iss: issuerId,
        aud: merchantOrigin,
        iat: nowSeconds,
        exp: nowSeconds + 300,
        delegate_payload: [{
          vct: 'mandate.checkout.1',
          jti: `ap2-checkout-human-${current.id}`,
          iat: nowSeconds,
          exp: nowSeconds + 300,
          checkout_jwt: merchantCheckoutJwt,
          checkout_hash: checkoutHash
        }]
      }
    })}~`
    const paymentMandate = `${signCompactJws({
      privateKey: issuerKeys.privateKey,
      header: { alg: 'ES256', kid: issuerKid },
      payload: {
        iss: issuerId,
        aud: merchantOrigin,
        iat: nowSeconds,
        exp: nowSeconds + 300,
        delegate_payload: [{
          vct: 'mandate.payment.1',
          jti: `ap2-payment-human-${current.id}`,
          iat: nowSeconds,
          exp: nowSeconds + 300,
          transaction_id: checkoutHash,
          payee: { name: 'Example Merchant', website: merchantOrigin },
          payment_amount: {
            currency: current.currency,
            amount: current.totals.find((entry) => entry.type === 'total')?.amount
          },
          payment_instrument: { id: instrumentId, type: 'card' }
        }]
      }
    })}~`
    return {
      checkoutMandate,
      paymentMandate,
      checkoutReceiptReference: sha256Base64Url(terminalCompact(checkoutMandate)),
      paymentReceiptReference: sha256Base64Url(terminalCompact(paymentMandate)),
      instrument: {
        id: instrumentId,
        handler_id: 'merchant_processor_tokenizer_1',
        type: 'card',
        selected: true,
        credential: {
          type: 'ap2_mandate',
          token: paymentMandate,
          reusable: false,
          scope: { checkout_id: current.id, merchant_origin: merchantOrigin },
          expires_at: new Date((nowSeconds + 300) * 1000).toISOString()
        } as NonNullable<UcpPaymentInstrument['credential']>
      }
    }
  }

  const openMandates = (mandate: PurchaseMandate): Ap2ReferenceOpenMandates => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const expiresAtSeconds = Math.min(
      Math.ceil(new Date(mandate.expiresAt).getTime() / 1000),
      nowSeconds + 3600
    )
    const productId = mandate.intent.productIds?.[0] ?? mandate.intent.allowedVariants?.[0]
    if (!productId) throw new Error('AP2 reference autonomy requires an exact product or variant.')
    const checkoutMandate = `${signCompactJws({
      privateKey: issuerKeys.privateKey,
      header: { alg: 'ES256', kid: issuerKid },
      payload: {
        iss: issuerId,
        aud: merchantOrigin,
        iat: nowSeconds,
        exp: expiresAtSeconds,
        delegate_payload: [{
          vct: 'mandate.checkout.open.1',
          jti: `ap2-checkout-open-${mandate.mandateId}`,
          iat: nowSeconds,
          exp: expiresAtSeconds,
          cnf: { jwk: agentPublicJwk },
          constraints: [
            { type: 'checkout.allowed_merchants', allowed: [{ name: 'Example Merchant', website: merchantOrigin }] },
            {
              type: 'checkout.line_items',
              items: [{
                id: `requirement-${mandate.mandateId}`,
                acceptable_items: [{ id: productId }],
                quantity: mandate.intent.intendedQuantity ?? 1
              }]
            }
          ]
        }]
      }
    })}~`
    const checkoutReference = sha256Base64Url(checkoutMandate)
    const paymentMandate = `${signCompactJws({
      privateKey: issuerKeys.privateKey,
      header: { alg: 'ES256', kid: issuerKid },
      payload: {
        iss: issuerId,
        aud: merchantOrigin,
        iat: nowSeconds,
        exp: expiresAtSeconds,
        delegate_payload: [{
          vct: 'mandate.payment.open.1',
          jti: `ap2-payment-open-${mandate.mandateId}`,
          iat: nowSeconds,
          exp: expiresAtSeconds,
          cnf: { jwk: agentPublicJwk },
          constraints: [
            { type: 'payment.reference', conditional_transaction_id: checkoutReference },
            { type: 'payment.allowed_payees', allowed: [{ name: 'Example Merchant', website: merchantOrigin }] },
            {
              type: 'payment.amount_range',
              currency: mandate.financialPolicy.currency,
              min: 0,
              max: Number(mandate.financialPolicy.maximumPerTransactionMinor)
            },
            {
              type: 'payment.agent_recurrence',
              frequency: 'ON_DEMAND',
              max_occurrences: mandate.financialPolicy.useLimit
            },
            {
              type: 'payment.budget',
              currency: mandate.financialPolicy.currency,
              max: Number(mandate.financialPolicy.maximumTotalSpendMinor) / 100
            }
          ]
        }]
      }
    })}~`
    return { checkoutMandate, paymentMandate }
  }

  const autonomousAuthority = (
    current: UcpCheckout,
    open: Ap2ReferenceOpenMandates
  ): Ap2ReferenceCompletionAuthority => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const merchantCheckoutJwt = checkoutJwt(current)
    const checkoutHash = sha256Base64Url(merchantCheckoutJwt)
    const instrumentId = `ap2-agent-instrument-${current.id}`
    const closedCheckout = delegatedMandate({
      privateKey: agentKeys.privateKey,
      previousMandate: open.checkoutMandate,
      checkoutId: current.id,
      nowSeconds,
      payload: {
        vct: 'mandate.checkout.1',
        jti: `ap2-checkout-agent-${current.id}`,
        iat: nowSeconds,
        exp: nowSeconds + 300,
        checkout_jwt: merchantCheckoutJwt,
        checkout_hash: checkoutHash
      }
    })
    const closedPayment = delegatedMandate({
      privateKey: agentKeys.privateKey,
      previousMandate: open.paymentMandate,
      checkoutId: current.id,
      nowSeconds,
      payload: {
        vct: 'mandate.payment.1',
        jti: `ap2-payment-agent-${current.id}`,
        iat: nowSeconds,
        exp: nowSeconds + 300,
        transaction_id: checkoutHash,
        payee: { name: 'Example Merchant', website: merchantOrigin },
        payment_amount: {
          currency: current.currency,
          amount: current.totals.find((entry) => entry.type === 'total')?.amount
        },
        payment_instrument: { id: instrumentId, type: 'card' }
      }
    })
    const checkoutMandate = `${open.checkoutMandate.slice(0, -1)}~~${closedCheckout}~`
    const paymentMandate = `${open.paymentMandate.slice(0, -1)}~~${closedPayment}~`
    return {
      checkoutMandate,
      paymentMandate,
      checkoutReceiptReference: sha256Base64Url(terminalCompact(checkoutMandate)),
      paymentReceiptReference: sha256Base64Url(terminalCompact(paymentMandate)),
      instrument: {
        id: instrumentId,
        handler_id: 'merchant_processor_tokenizer_1',
        type: 'card',
        selected: true,
        credential: {
          type: 'ap2_mandate',
          token: paymentMandate,
          reusable: false,
          scope: { checkout_id: current.id, merchant_origin: merchantOrigin },
          expires_at: new Date((nowSeconds + 300) * 1000).toISOString()
        } as NonNullable<UcpPaymentInstrument['credential']>
      }
    }
  }

  const receipt = (claims: Record<string, unknown>) => {
    const header = base64UrlJson({ alg: 'ES256', kid: issuerKid, typ: 'JWT' })
    const payload = base64UrlJson({
      iss: issuerId,
      iat: Math.floor(Date.now() / 1000),
      status: 'Success',
      ...claims
    })
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), {
      key: issuerKeys.privateKey,
      dsaEncoding: 'ieee-p1363'
    }).toString('base64url')
    return `${header}.${payload}.${signature}`
  }

  const receipts = (authority: Ap2ReferenceCompletionAuthority, orderId: string) => ({
    checkoutReceipt: receipt({
      reference: authority.checkoutReceiptReference,
      order_id: orderId
    }),
    paymentReceipt: receipt({
      reference: authority.paymentReceiptReference,
      payment_id: `payment-${orderId}`,
      psp_confirmation_id: `psp-${orderId}`,
      network_confirmation_id: `network-${orderId}`
    })
  })

  return {
    platformProfile: platform,
    businessProfile: merchant,
    trustedIssuers,
    checkout,
    humanPresentAuthority,
    openMandates,
    autonomousAuthority,
    receipts
  }
}
