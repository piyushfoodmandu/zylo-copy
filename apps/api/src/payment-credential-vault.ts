import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import type { UcpPaymentInstrument } from '@arro/contracts'
import type { RuntimeRedisClient } from './redis.ts'

export type PaymentCredentialVaultReference = {
  reference: string
  expiresAt: string
}

export type PaymentCredentialVaultPutInput = {
  transactionId: string
  paymentResultId: string
  instrument: UcpPaymentInstrument
  ap2CheckoutMandate?: string
  ttlSeconds: number
  now?: Date
}

export type PaymentExecutionAuthority = {
  instrument: UcpPaymentInstrument
  ap2CheckoutMandate?: string
}

export interface PaymentCredentialVault {
  put(input: PaymentCredentialVaultPutInput): Promise<PaymentCredentialVaultReference>
  consume(reference: string): Promise<PaymentExecutionAuthority | undefined>
  revoke(reference: string): Promise<void>
}

const keyPrefix = 'arro:payment-credential:'

const normalizeKey = (key: string) => {
  const trimmed = key.trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex')
  try {
    const decoded = Buffer.from(trimmed, 'base64')
    if (decoded.length === 32) return decoded
  } catch {
    // Fall through to raw UTF-8 handling.
  }
  const raw = Buffer.from(trimmed, 'utf8')
  if (raw.length === 32) return raw
  throw new Error('PAYMENT_CREDENTIAL_ENCRYPTION_KEY must be 32 bytes as hex, base64, or raw UTF-8.')
}

const encrypt = (value: unknown, key: Buffer) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final()
  ])
  return {
    alg: 'A256GCM',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url')
  }
}

const decrypt = (value: string, key: Buffer): unknown => {
  const envelope = JSON.parse(value) as {
    alg?: string
    iv?: string
    tag?: string
    ciphertext?: string
  }
  if (envelope.alg !== 'A256GCM' || !envelope.iv || !envelope.tag || !envelope.ciphertext) {
    throw new Error('payment_credential_vault_envelope_invalid')
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.iv, 'base64url')
  )
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final()
  ])
  return JSON.parse(plaintext.toString('utf8')) as unknown
}

export const createRedisPaymentCredentialVault = ({
  client,
  getClient,
  encryptionKey
}: {
  client?: RuntimeRedisClient
  getClient?: () => Promise<RuntimeRedisClient>
  encryptionKey: string
}): PaymentCredentialVault => {
  const key = normalizeKey(encryptionKey)
  const resolveClient = async () => {
    if (client) return client
    if (getClient) return getClient()
    throw new Error('payment_credential_vault_redis_client_required')
  }

  return {
    async put(input) {
      const reference = `pcv_${randomUUID()}`
      const now = input.now ?? new Date()
      const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000).toISOString()
      const payload = encrypt({
        transactionId: input.transactionId,
        paymentResultId: input.paymentResultId,
        expiresAt,
        instrument: input.instrument,
        ...(input.ap2CheckoutMandate ? { ap2CheckoutMandate: input.ap2CheckoutMandate } : {})
      }, key)
      const redis = await resolveClient()
      await redis.set(`${keyPrefix}${reference}`, JSON.stringify(payload), {
        EX: input.ttlSeconds
      })
      return { reference, expiresAt }
    },

    async consume(reference) {
      const redis = await resolveClient()
      const stored = await redis.sendCommand(['GETDEL', `${keyPrefix}${reference}`])
      if (typeof stored !== 'string' || !stored) return undefined
      const payload = decrypt(stored, key) as unknown as {
        instrument?: UcpPaymentInstrument
        ap2CheckoutMandate?: string
      }
      return payload.instrument
        ? {
            instrument: payload.instrument,
            ...(payload.ap2CheckoutMandate ? { ap2CheckoutMandate: payload.ap2CheckoutMandate } : {})
          }
        : undefined
    },

    async revoke(reference) {
      const redis = await resolveClient()
      await redis.del(`${keyPrefix}${reference}`)
    }
  }
}

export const createMemoryPaymentCredentialVault = (): PaymentCredentialVault => {
  const entries = new Map<string, { expiresAt: string; authority: PaymentExecutionAuthority }>()

  return {
    async put(input) {
      const reference = `pcv_${randomUUID()}`
      const now = input.now ?? new Date()
      const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000).toISOString()
      entries.set(reference, {
        expiresAt,
        authority: {
          instrument: input.instrument,
          ...(input.ap2CheckoutMandate ? { ap2CheckoutMandate: input.ap2CheckoutMandate } : {})
        }
      })
      return { reference, expiresAt }
    },

    async consume(reference) {
      const entry = entries.get(reference)
      entries.delete(reference)
      if (!entry) return undefined
      if (new Date(entry.expiresAt).getTime() <= Date.now()) return undefined
      return entry.authority
    },

    async revoke(reference) {
      entries.delete(reference)
    }
  }
}
