import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { discoverUcpProfile } from '@arro/connectors'
import { persistRuntimeUcpDiscoveryObservation } from './target-business-repository.ts'
import { resolveDatabaseUrlFromEnv } from './runtime-secrets.ts'

const defaultDatasetUrl = 'https://huggingface.co/datasets/UCPChecker/ucp-merchants/resolve/main/ucp-merchants-2026-04-02.csv'
const defaultLimit = 10
const maxLimit = 100
const defaultTimeoutMs = 5_000

type UcpCheckerMerchantRow = {
  domain: string
  status: string
  ucpUrl?: string
  httpStatus?: number
  version?: string
  hasCheckout: boolean
  hasIdentityLinking: boolean
  hasCartManagement: boolean
  hasOrder: boolean
  hasPaymentToken: boolean
  capabilityCount: number
  transports: string[]
  lastCheckedAt?: string
  lastSuccessAt?: string
}

export type UcpDirectoryPrecomputeCandidate = UcpCheckerMerchantRow & {
  priority: number
}

type CandidateSelectionOptions = {
  limit: number
  requireTransport?: string
  requireCheckout?: boolean
  requireCartManagement?: boolean
  requirePaymentToken?: boolean
}

type PrecomputeOptions = CandidateSelectionOptions & {
  datasetUrl?: string
  datasetPath?: string
  databaseUrl?: string
  persist: boolean
  platformProfileUrl?: string
  timeoutMs: number
}

type PrecomputeResult = {
  datasetSource: string
  parsedRows: number
  selectedCandidates: number
  liveFetched: number
  persistedObservations: number
  failedDomains: string[]
  summaries: string[]
}

const asPositiveInteger = (value: string | undefined, fallback: number, maximum = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, maximum)
}

const parseBooleanFlag = (value: string | undefined) => {
  const normalized = value?.trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

const optionalString = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const normalizeDomain = (value: string | undefined) => {
  const trimmed = optionalString(value)
  if (!trimmed) return undefined

  try {
    const url = trimmed.includes('://') ? new URL(trimmed) : new URL(`https://${trimmed}`)
    const hostname = url.hostname.toLowerCase()
    if (!hostname.includes('.') || hostname.includes('..')) return undefined
    if (!/^[a-z0-9.-]+$/.test(hostname)) return undefined
    return hostname
  } catch {
    return undefined
  }
}

const parseNumber = (value: string | undefined) => {
  const trimmed = optionalString(value)
  if (!trimmed) return undefined

  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

const parseStringList = (value: string | undefined) => {
  const trimmed = optionalString(value)
  if (!trimmed) return []

  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (Array.isArray(parsed)) {
      return parsed.flatMap((entry) => typeof entry === 'string' ? [entry.trim().toLowerCase()] : []).filter(Boolean)
    }
  } catch {
    // Fall through to a permissive split for older exports.
  }

  return trimmed
    .replace(/[\[\]"]/g, '')
    .split(/[|,]/)
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
}

const parseCsvRecords = (csv: string) => {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index]
    const nextChar = csv[index + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"'
        index += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === ',' && !inQuotes) {
      row.push(field)
      field = ''
      continue
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') index += 1
      row.push(field)
      if (row.some((entry) => entry.trim().length > 0)) rows.push(row)
      row = []
      field = ''
      continue
    }

    field += char
  }

  row.push(field)
  if (row.some((entry) => entry.trim().length > 0)) rows.push(row)

  return rows
}

export const parseUcpCheckerMerchantsCsv = (csv: string): UcpCheckerMerchantRow[] => {
  const records = parseCsvRecords(csv)
  const header = records[0]?.map((entry) => entry.trim())
  if (!header || header.length === 0) return []

  return records.slice(1).flatMap((record) => {
    const fields = new Map<string, string>()
    for (const [index, key] of header.entries()) fields.set(key, record[index]?.trim() ?? '')

    const domain = normalizeDomain(fields.get('domain'))
    if (!domain) return []

    const httpStatus = parseNumber(fields.get('http_status'))
    const capabilityCount = parseNumber(fields.get('capability_count')) ?? 0
    const ucpUrl = optionalString(fields.get('ucp_url'))
    const version = optionalString(fields.get('version'))
    const lastCheckedAt = optionalString(fields.get('last_checked_at'))
    const lastSuccessAt = optionalString(fields.get('last_success_at'))

    return [{
      domain,
      status: fields.get('status')?.trim().toLowerCase() ?? '',
      ...(ucpUrl ? { ucpUrl } : {}),
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      ...(version ? { version } : {}),
      hasCheckout: parseBooleanFlag(fields.get('has_checkout')),
      hasIdentityLinking: parseBooleanFlag(fields.get('has_identity_linking')),
      hasCartManagement: parseBooleanFlag(fields.get('has_cart_management')),
      hasOrder: parseBooleanFlag(fields.get('has_order')),
      hasPaymentToken: parseBooleanFlag(fields.get('has_payment_token')),
      capabilityCount,
      transports: parseStringList(fields.get('transports')),
      ...(lastCheckedAt ? { lastCheckedAt } : {}),
      ...(lastSuccessAt ? { lastSuccessAt } : {})
    }]
  })
}

const candidatePriority = (row: UcpCheckerMerchantRow) =>
  row.capabilityCount +
  (row.transports.includes('mcp') ? 20 : 0) +
  (row.hasPaymentToken ? 16 : 0) +
  (row.hasCartManagement ? 12 : 0) +
  (row.hasCheckout ? 8 : 0) +
  (row.hasOrder ? 4 : 0) +
  (row.hasIdentityLinking ? 2 : 0)

export const selectUcpDirectoryPrecomputeCandidates = (
  rows: UcpCheckerMerchantRow[],
  options: CandidateSelectionOptions
): UcpDirectoryPrecomputeCandidate[] => {
  const seenDomains = new Set<string>()
  const requiredTransport = options.requireTransport?.trim().toLowerCase()

  return rows
    .filter((row) => row.status === 'verified')
    .filter((row) => row.httpStatus === undefined || row.httpStatus === 200)
    .filter((row) => !requiredTransport || row.transports.includes(requiredTransport))
    .filter((row) => !options.requireCheckout || row.hasCheckout)
    .filter((row) => !options.requireCartManagement || row.hasCartManagement)
    .filter((row) => !options.requirePaymentToken || row.hasPaymentToken)
    .map((row) => ({ ...row, priority: candidatePriority(row) }))
    .sort((left, right) => right.priority - left.priority || left.domain.localeCompare(right.domain))
    .filter((row) => {
      if (seenDomains.has(row.domain)) return false
      seenDomains.add(row.domain)
      return true
    })
    .slice(0, options.limit)
}

const loadDatasetCsv = async (options: Pick<PrecomputeOptions, 'datasetPath' | 'datasetUrl'>) => {
  if (options.datasetPath) {
    return {
      source: options.datasetPath,
      csv: await readFile(options.datasetPath, 'utf8')
    }
  }

  const datasetUrl = options.datasetUrl || defaultDatasetUrl
  const response = await fetch(datasetUrl, {
    headers: {
      accept: 'text/csv, text/plain;q=0.9, */*;q=0.1'
    }
  })

  if (!response.ok) throw new Error(`UCP directory dataset fetch returned HTTP ${response.status}.`)

  return {
    source: datasetUrl,
    csv: await response.text()
  }
}

export const runUcpDirectoryPrecompute = async (options: PrecomputeOptions): Promise<PrecomputeResult> => {
  if (options.persist && !options.databaseUrl) {
    throw new Error('DATABASE_URL is required when UCP_DIRECTORY_PRECOMPUTE_PERSIST=true.')
  }

  const dataset = await loadDatasetCsv(options)
  const rows = parseUcpCheckerMerchantsCsv(dataset.csv)
  const candidates = selectUcpDirectoryPrecomputeCandidates(rows, options)
  const correlationId = `verify-ucp-directory-precompute-${Date.now()}`
  const summaries: string[] = []
  const failedDomains: string[] = []
  let liveFetched = 0
  let persistedObservations = 0

  for (const [index, candidate] of candidates.entries()) {
    const requestId = `${correlationId}-${index + 1}`
    const discovery = await discoverUcpProfile(
      {
        domain: candidate.domain,
        requestedCapabilities: [
          'dev.ucp.shopping.catalog.search',
          'dev.ucp.shopping.catalog.lookup',
          'dev.ucp.shopping.cart',
          'dev.ucp.shopping.checkout',
          'dev.ucp.shopping.payment'
        ]
      },
      {
        requestId,
        correlationId,
        ...(options.platformProfileUrl ? { platformProfileUrl: options.platformProfileUrl } : {}),
        timeoutMs: options.timeoutMs
      }
    )

    if (discovery.status === 'fetched' && discovery.profile) {
      liveFetched += 1
      summaries.push(`${candidate.domain}: ${discovery.profile.capabilities.length} live capabilities, ${discovery.profile.services.length} services`)

      if (options.persist) {
        const persistence = await persistRuntimeUcpDiscoveryObservation({
          requestId,
          correlationId,
          discoveryResponse: discovery
        }, options.databaseUrl)
        if (persistence?.observationId) persistedObservations += 1
      }
    } else {
      failedDomains.push(`${candidate.domain}:${discovery.status}`)
    }
  }

  return {
    datasetSource: dataset.source,
    parsedRows: rows.length,
    selectedCandidates: candidates.length,
    liveFetched,
    persistedObservations,
    failedDomains,
    summaries
  }
}

const optionsFromEnvironment = (): PrecomputeOptions => {
  const databaseUrl = resolveDatabaseUrlFromEnv(process.env)
  return {
    datasetUrl: process.env.UCP_DIRECTORY_DATASET_URL?.trim() || defaultDatasetUrl,
    ...(process.env.UCP_DIRECTORY_DATASET_PATH?.trim() ? { datasetPath: process.env.UCP_DIRECTORY_DATASET_PATH.trim() } : {}),
    limit: asPositiveInteger(process.env.UCP_DIRECTORY_LIMIT, defaultLimit, maxLimit),
    persist: process.env.UCP_DIRECTORY_PRECOMPUTE_PERSIST === 'true',
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(process.env.PUBLIC_BASE_URL?.startsWith('https://')
      ? { platformProfileUrl: `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/.well-known/ucp` }
      : {}),
    ...(process.env.UCP_DIRECTORY_PLATFORM_PROFILE_URL?.trim() ? { platformProfileUrl: process.env.UCP_DIRECTORY_PLATFORM_PROFILE_URL.trim() } : {}),
    ...(process.env.UCP_DIRECTORY_REQUIRE_TRANSPORT?.trim() ? { requireTransport: process.env.UCP_DIRECTORY_REQUIRE_TRANSPORT.trim() } : {}),
    requireCheckout: process.env.UCP_DIRECTORY_REQUIRE_CHECKOUT === 'true',
    requireCartManagement: process.env.UCP_DIRECTORY_REQUIRE_CART_MANAGEMENT === 'true',
    requirePaymentToken: process.env.UCP_DIRECTORY_REQUIRE_PAYMENT_TOKEN === 'true',
    timeoutMs: asPositiveInteger(process.env.UCP_DIRECTORY_TIMEOUT_MS, defaultTimeoutMs, 30_000)
  }
}

const isEntrypoint = () => {
  const entrypoint = process.argv[1]
  return entrypoint ? import.meta.url === pathToFileURL(entrypoint).href : false
}

if (isEntrypoint()) {
  try {
    const result = await runUcpDirectoryPrecompute(optionsFromEnvironment())

    console.log('UCP directory precompute verification passed.')
    console.log(`Dataset: ${result.datasetSource}`)
    console.log('Attribution: UCP Checker merchant dataset, CC BY 4.0, https://ucpchecker.com')
    console.log(`Parsed rows: ${result.parsedRows}`)
    console.log(`Selected candidates: ${result.selectedCandidates}`)
    console.log(`Live profiles fetched: ${result.liveFetched}`)
    console.log(`Discovery observations persisted: ${result.persistedObservations}`)
    for (const summary of result.summaries.slice(0, 20)) console.log(`- ${summary}`)
    if (result.failedDomains.length > 0) console.log(`Skipped after live probe: ${result.failedDomains.join(', ')}`)

    if (result.selectedCandidates === 0 || result.liveFetched === 0) {
      console.error('No live UCP profiles were fetched from the selected public-directory candidates.')
      process.exitCode = 1
    }
  } catch (error) {
    console.error('UCP directory precompute verification failed.')
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
