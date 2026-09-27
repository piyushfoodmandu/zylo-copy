import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { verifyPaymentActivationEvidence } from './production-payment-activation-evidence.ts'

const fixtureDirectory = mkdtempSync(join(tmpdir(), 'arro-google-pay-activation-'))
afterAll(() => rmSync(fixtureDirectory, { recursive: true, force: true }))

const exactBindings = {
  surface: 'android_native',
  environment: 'PRODUCTION',
  handlerName: 'com.google.pay',
  handlerVersion: '2026-01-23',
  handlerId: 'arro_google_pay_client',
  merchantId: '12345678901234567890',
  psp: 'approved-gateway',
  approvalReference: 'google-approval-reference-1'
}

const evidence = (overrides: Record<string, unknown> = {}) => ({
  route: 'google_pay_native',
  status: 'passed',
  observedAt: '2026-09-02T00:00:00.000Z',
  merchantOrderId: 'merchant-order-native-1',
  ...exactBindings,
  ...overrides
})

describe('production payment activation evidence', () => {
  it('accepts an exactly bound native Google Pay merchant Order proof', async () => {
    const path = join(fixtureDirectory, 'native-evidence.json')
    writeFileSync(path, JSON.stringify(evidence()), { mode: 0o600 })

    await expect(verifyPaymentActivationEvidence({
      path,
      route: 'google_pay_native',
      expectedBindings: exactBindings
    })).resolves.toBe(true)
  })

  it('keeps hosted Web proof separate and rejects the wrong action origin', async () => {
    const path = join(fixtureDirectory, 'web-evidence.json')
    writeFileSync(path, JSON.stringify(evidence({
      route: 'google_pay_web',
      surface: 'arro_hosted_web',
      merchantOrderId: 'merchant-order-web-1',
      actionOrigin: 'https://wrong.arro.com'
    })), { mode: 0o600 })

    const webBindings = {
      ...exactBindings,
      surface: 'arro_hosted_web',
      actionOrigin: 'https://api.arro.com'
    }
    await expect(verifyPaymentActivationEvidence({
      path,
      route: 'google_pay_web',
      expectedBindings: webBindings
    })).resolves.toBe(false)

    writeFileSync(path, JSON.stringify(evidence({
      route: 'google_pay_web',
      surface: 'arro_hosted_web',
      merchantOrderId: 'merchant-order-web-1',
      actionOrigin: 'https://api.arro.com'
    })), { mode: 0o600 })
    await expect(verifyPaymentActivationEvidence({
      path,
      route: 'google_pay_web',
      expectedBindings: webBindings
    })).resolves.toBe(true)
  })
})
