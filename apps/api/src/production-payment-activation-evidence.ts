import { readFile } from 'node:fs/promises'

export type PaymentActivationRoute =
  | 'trusted_host'
  | 'ap2'
  | 'google_pay_native'
  | 'google_pay_web'
  | 'processor_tokenizer'
  | 'merchant_hosted'

export const verifyPaymentActivationEvidence = async ({
  path,
  route,
  expectedBindings = {}
}: {
  path?: string
  route: PaymentActivationRoute
  expectedBindings?: Record<string, string>
}) => {
  if (!path) return false
  try {
    const record = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    return record.route === route &&
      record.status === 'passed' &&
      typeof record.observedAt === 'string' &&
      record.observedAt.length > 0 &&
      typeof record.merchantOrderId === 'string' &&
      record.merchantOrderId.length > 0 &&
      Object.entries(expectedBindings).every(([name, value]) => value.length > 0 && record[name] === value)
  } catch {
    return false
  }
}
