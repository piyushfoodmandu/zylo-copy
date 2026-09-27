const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim()
const timeoutMs = Number.parseInt(process.env.DEPENDENCY_CHECK_TIMEOUT_MS ?? '5000', 10)

if (!publicBaseUrl) {
  console.error('Production readiness verification requires PUBLIC_BASE_URL.')
  process.exit(1)
}

const endpoint = new URL('/health/ready', publicBaseUrl)
endpoint.searchParams.set('arro_readiness_probe', Date.now().toString())
const failures: string[] = []
const appOrigin = process.env.APP_ALLOWED_ORIGINS
  ?.split(',')
  .map((origin) => origin.trim())
  .find(Boolean)

if (!appOrigin) {
  failures.push('APP_ALLOWED_ORIGINS must include the deployed frontend origin.')
}

try {
  const response = await fetch(endpoint, {
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      'cache-control': 'no-cache',
      pragma: 'no-cache'
    },
    redirect: 'manual',
    signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5_000)
  })
  if (response.status !== 200) failures.push(`Expected HTTP 200, received ${response.status}.`)
  if (response.headers.has('location') || response.redirected) failures.push('Readiness endpoint must not redirect.')
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) failures.push('Readiness endpoint must return application/json.')
  const cacheControl = response.headers.get('cache-control') ?? ''
  if (!cacheControl.toLowerCase().includes('no-store')) {
    failures.push('Readiness endpoint must return Cache-Control: no-store.')
  }
  const body = await response.json() as Record<string, unknown>
  const checks = Array.isArray(body.checks) ? body.checks as Array<Record<string, unknown>> : []
  if (body.status !== 'ok') failures.push(`Readiness status must be ok, received ${String(body.status)}.`)
  if (checks.length === 0) failures.push('Readiness response must include dependency checks.')
  for (const check of checks.filter((entry) => entry.required === true)) {
    if (check.status !== 'ok') {
      failures.push(`Required readiness check ${String(check.name)} is ${String(check.status)}.`)
    }
  }
} catch (error) {
  failures.push(error instanceof Error ? error.message : 'Readiness request failed unexpectedly.')
}

if (appOrigin) {
  const corsEndpoint = new URL('/v1/shopper/session', publicBaseUrl)
  try {
    const response = await fetch(corsEndpoint, {
      method: 'OPTIONS',
      headers: {
        origin: appOrigin,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type,x-arro-shopper-session'
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5_000)
    })
    if (response.status !== 204) failures.push(`Frontend CORS preflight expected HTTP 204, received ${response.status}.`)
    if (response.headers.get('access-control-allow-origin') !== appOrigin) {
      failures.push('Frontend CORS preflight did not return the exact configured origin.')
    }
    const allowedMethods = response.headers.get('access-control-allow-methods') ?? ''
    if (!allowedMethods.split(',').map((method) => method.trim()).includes('POST')) {
      failures.push('Frontend CORS preflight did not allow POST.')
    }
  } catch (error) {
    failures.push(error instanceof Error ? `Frontend CORS preflight failed: ${error.message}` : 'Frontend CORS preflight failed unexpectedly.')
  }
}

if (failures.length > 0) {
  console.error(`Production readiness verification failed for ${endpoint}`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log(`Production readiness verification passed for ${endpoint}`)
