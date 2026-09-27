import type { AutonomousPaymentExecutor } from './autonomous-purchase-worker.ts'
import type { TrustedHostPaymentConfig } from './trusted-host-payment.ts'

export class TrustedHostAutonomousPaymentError extends Error {
  readonly code:
    | 'trusted_host_authorization_not_configured'
    | 'trusted_host_authorization_failed'
    | 'trusted_host_authorization_invalid'

  constructor(code: TrustedHostAutonomousPaymentError['code'], message: string) {
    super(message)
    this.name = 'TrustedHostAutonomousPaymentError'
    this.code = code
  }
}

const readBoundedJson = async (response: Response, maximumBytes = 64 * 1024) => {
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.includes('application/json')) {
    throw new TrustedHostAutonomousPaymentError(
      'trusted_host_authorization_invalid',
      'Trusted host authorization response must be JSON.'
    )
  }
  const body = await response.text()
  if (Buffer.byteLength(body, 'utf8') > maximumBytes) {
    throw new TrustedHostAutonomousPaymentError(
      'trusted_host_authorization_invalid',
      'Trusted host authorization response exceeded the accepted size.'
    )
  }
  try {
    return JSON.parse(body) as unknown
  } catch {
    throw new TrustedHostAutonomousPaymentError(
      'trusted_host_authorization_invalid',
      'Trusted host authorization response was not valid JSON.'
    )
  }
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

export const createTrustedHostAutonomousPaymentExecutor = ({
  configs,
  fetch: fetcher = fetch,
  timeoutMs = 15_000
}: {
  configs: TrustedHostPaymentConfig[]
  fetch?: typeof fetch
  timeoutMs?: number
}): AutonomousPaymentExecutor => ({
  async approvePaymentAction({ job, mandate, purchase, paymentAction, route }) {
    if (route !== 'trusted_host') {
      throw new TrustedHostAutonomousPaymentError(
        'trusted_host_authorization_not_configured',
        'Trusted host payment execution cannot authorize a different autonomous route.'
      )
    }
    const config = configs.find((entry) =>
      entry.hostId === job.hostId &&
      entry.integrationId === job.integrationId &&
      Boolean(entry.authorizationEndpoint)
    )
    if (!config?.authorizationEndpoint || !paymentAction.actionToken) {
      throw new TrustedHostAutonomousPaymentError(
        'trusted_host_authorization_not_configured',
        'The selected host does not expose an authenticated autonomous payment authorization endpoint.'
      )
    }

    const response = await fetcher(config.authorizationEndpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(config.headers ?? {})
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        protocol: 'arro.trusted_host.payment_authorization.v1',
        action_token: paymentAction.actionToken,
        action_id: paymentAction.actionId,
        purchase_id: purchase.purchaseId,
        mandate_id: mandate.mandateId,
        mandate_version: mandate.version,
        autonomous_job_id: job.jobId,
        merchant: purchase.merchant,
        items: purchase.items,
        totals: purchase.totals,
        expires_at: paymentAction.expiresAt
      })
    }).catch(() => {
      throw new TrustedHostAutonomousPaymentError(
        'trusted_host_authorization_failed',
        'Trusted host authorization request did not complete.'
      )
    })
    if (!response.ok) {
      throw new TrustedHostAutonomousPaymentError(
        'trusted_host_authorization_failed',
        'Trusted host did not authorize the bounded payment action.'
      )
    }
    const body = record(await readBoundedJson(response))
    const attestation = typeof body.attestation === 'string' ? body.attestation.trim() : ''
    if (attestation.length < 32 || attestation.length > 20_000) {
      throw new TrustedHostAutonomousPaymentError(
        'trusted_host_authorization_invalid',
        'Trusted host authorization did not return a signed bounded attestation.'
      )
    }
    return {
      result: {
        type: 'trusted_host_attestation',
        attestation
      },
      idempotencyKey: `${job.jobId}:trusted-host-attestation:v${job.mandateVersion}`
    }
  }
})
