import type {
  CatalogCartPrepareResponse,
  CatalogSearchResponse,
  PlainStatusMessage,
  TargetBusinessMatrixResponse,
  TargetBusinessRecord
} from '@arro/contracts'
import type { CatalogSource } from './catalog-fetcher.ts'

type BuildMatrixOptions = {
  requestId: string
  correlationId: string
  records?: TargetBusinessRecord[]
  now?: Date
}

type BuildCatalogSearchSourcePolicyOptions = {
  records?: TargetBusinessRecord[]
  connectedSources?: CatalogSource[]
  now?: Date
}

type BuildCartPrepareSourcePolicyOptions = {
  records?: TargetBusinessRecord[]
  connectedSources?: CatalogSource[]
  now?: Date
}

type BuildCheckoutCompletionSourcePolicyOptions = {
  records?: TargetBusinessRecord[]
  connectedSources?: CatalogSource[]
  now?: Date
}

type CapabilityStatus = TargetBusinessRecord['capabilities'][number]['status']

export type CatalogSearchSourcePolicy = {
  sourceMode: CatalogSearchResponse['sourceMode']
  allowedBusinessIds: string[]
  message: PlainStatusMessage
}

export type CartPrepareSourcePolicy = {
  sourceMode: CatalogCartPrepareResponse['sourceMode']
  allowedBusinessIds: string[]
  message: PlainStatusMessage
}

export type CheckoutCompletionSourcePolicy = CartPrepareSourcePolicy

const observedAt = '2026-05-30T00:00:00.000Z'
const reviewAt = '2026-06-30T00:00:00.000Z'

const catalogSearch = 'dev.ucp.shopping.catalog.search'
const catalogLookup = 'dev.ucp.shopping.catalog.lookup'
const cart = 'dev.ucp.shopping.cart'
const checkout = 'dev.ucp.shopping.checkout'
const order = 'dev.ucp.shopping.order'

export const targetBusinessSeedRecords: TargetBusinessRecord[] = [
  {
    businessId: 'allbirds-public-ucp-candidate',
    domain: 'www.allbirds.com',
    displayName: 'Allbirds',
    sourceType: 'direct_ucp',
    launchStatus: 'candidate',
    featureVisibility: 'hidden',
    accessPolicyState: 'profile_fetched',
    profileUrl: 'https://www.allbirds.com/.well-known/ucp',
    lastDiscoveredAt: observedAt,
    nextReviewAt: reviewAt,
    capabilities: [
      {
        capability: catalogSearch,
        status: 'discovery_only',
        source: 'arro_discovery',
        notes: 'Candidate requires public cacheable Arro platform profile before live catalog calls.'
      },
      {
        capability: catalogLookup,
        status: 'discovery_only',
        source: 'arro_discovery'
      },
      {
        capability: checkout,
        status: 'unknown',
        source: 'target_business_matrix'
      }
    ],
    evidence: [
      {
        kind: 'public_readiness_snapshot',
        source: 'repo memory: ucp-discovery.md',
        observedAt,
        expiresAt: reviewAt,
        summary: 'Prior probe found public UCP profile and catalog MCP hints; live catalog requires public HTTPS Arro profile.'
      }
    ],
    userFacingStatus: {
      label: 'Connector candidate',
      reason: 'A public profile exists, but catalog calls are not approved or launch-visible yet.',
      nextAction: 'Re-run discovery, verify data-use terms, and complete approval before live results.'
    }
  },
  {
    businessId: 'shopify-global-catalog-candidate',
    domain: 'catalog.shopify.com',
    displayName: 'Shopify Global Catalog',
    sourceType: 'managed_channel',
    launchStatus: 'outreach',
    featureVisibility: 'hidden',
    accessPolicyState: 'partner_required',
    nextReviewAt: reviewAt,
    capabilities: [
      {
        capability: catalogSearch,
        status: 'discovery_only',
        source: 'managed_channel_signal',
        notes: 'Managed ecosystem path; does not grant individual merchant connector authority.'
      },
      {
        capability: checkout,
        status: 'not_supported',
        source: 'target_business_matrix'
      },
      {
        capability: order,
        status: 'not_supported',
        source: 'target_business_matrix'
      }
    ],
    evidence: [
      {
        kind: 'managed_channel_signal',
        source: 'technical_full.md Shopify watchlist',
        observedAt,
        expiresAt: reviewAt,
        summary: 'Track as managed-channel/onboarding signal, not direct per-merchant authority.'
      }
    ],
    userFacingStatus: {
      label: 'Partner path required',
      reason: 'This is a managed catalog path and cannot enable merchant checkout by itself.',
      nextAction: 'Track individual merchant domains, access tier, scopes, and approval separately.'
    }
  },
  {
    businessId: 'major-retail-unsupported-snapshot',
    domain: 'amazon.com',
    displayName: 'Amazon Retail Snapshot',
    sourceType: 'unsupported',
    launchStatus: 'blocked',
    featureVisibility: 'hidden',
    accessPolicyState: 'unknown',
    nextReviewAt: reviewAt,
    capabilities: [
      {
        capability: catalogSearch,
        status: 'not_supported',
        source: 'public_readiness_snapshot'
      },
      {
        capability: checkout,
        status: 'not_supported',
        source: 'public_readiness_snapshot'
      }
    ],
    evidence: [
      {
        kind: 'public_readiness_snapshot',
        source: 'repo memory: ucp-discovery.md',
        observedAt,
        expiresAt: reviewAt,
        summary: 'Prior probe did not find usable public direct UCP connector evidence.'
      }
    ],
    userFacingStatus: {
      label: 'Not connected',
      reason: 'No approved direct connector authority is recorded for this business.',
      nextAction: 'Use unsupported fallback and supported alternatives until official connector evidence exists.'
    }
  }
]

export const buildTargetBusinessMatrix = ({
  requestId,
  correlationId,
  records = targetBusinessSeedRecords,
  now = new Date()
}: BuildMatrixOptions): TargetBusinessMatrixResponse => ({
  requestId,
  correlationId,
  generatedAt: now.toISOString(),
  records
})

export const launchVisibleRecords = (
  records: TargetBusinessRecord[] = targetBusinessSeedRecords
) =>
  records.filter((record) =>
    record.featureVisibility === 'catalog_visible' ||
    record.featureVisibility === 'checkout_visible'
  )

const hasCapabilityStatus = (
  record: TargetBusinessRecord,
  capability: string,
  allowedStatuses: readonly CapabilityStatus[]
) =>
  record.capabilities.some(
    (capabilityRecord) =>
      capabilityRecord.capability === capability &&
      allowedStatuses.includes(capabilityRecord.status)
  )

const isFutureIsoDate = (value: string | undefined, now: Date) => {
  if (!value) return false

  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.getTime() > now.getTime()
}

const hasCurrentConformanceEvidence = (
  record: TargetBusinessRecord,
  now: Date
) =>
  record.evidence.some(
    (evidence) =>
      evidence.kind === 'arro_conformance' &&
      isFutureIsoDate(evidence.expiresAt, now)
  )

export const catalogVisibleRecords = (
  records: TargetBusinessRecord[] = targetBusinessSeedRecords,
  now = new Date()
) =>
  records.filter(
    (record) =>
      record.featureVisibility === 'catalog_visible' &&
      record.launchStatus === 'launch_visible' &&
      record.accessPolicyState === 'approved' &&
      hasCurrentConformanceEvidence(record, now) &&
      hasCapabilityStatus(record, catalogSearch, ['approved'])
  )

export const cartPrepareVisibleRecords = (
  records: TargetBusinessRecord[] = targetBusinessSeedRecords,
  now = new Date()
) =>
  records.filter(
    (record) =>
      record.featureVisibility === 'checkout_visible' &&
      record.launchStatus === 'launch_visible' &&
      record.accessPolicyState === 'approved' &&
      hasCurrentConformanceEvidence(record, now) &&
      (
        hasCapabilityStatus(record, cart, ['approved']) ||
        hasCapabilityStatus(record, checkout, ['approved'])
      )
  )

export const buildCatalogSearchSourcePolicy = ({
  records = targetBusinessSeedRecords,
  connectedSources = [],
  now = new Date()
}: BuildCatalogSearchSourcePolicyOptions): CatalogSearchSourcePolicy => {
  const approvedRecords = catalogVisibleRecords(records, now)

  if (approvedRecords.length > 0) {
    return {
      sourceMode: 'approved_sources',
      allowedBusinessIds: approvedRecords.map((record) => record.businessId),
      message: {
        severity: 'info',
        code: 'approved_catalog_sources',
        text: 'Results are constrained to approved launch-visible catalog sources.',
        nextAction: 'Keep source evidence, freshness, and approval state current before expanding coverage.'
      }
    }
  }

  const connectedBusinessIds = [...new Set(
    connectedSources
        .filter((source) => source.sourceType !== 'unsupported')
      .map((source) => source.businessId)
  )]

  if (connectedBusinessIds.length > 0) {
    return {
      sourceMode: 'connected_sources',
      allowedBusinessIds: connectedBusinessIds,
      message: {
        severity: 'info',
        code: 'connected_catalog_sources',
        text: 'Results are constrained to configured official catalog connectors.',
        nextAction: 'Keep connector credentials, protocol compatibility, and response validation healthy before expanding traffic.'
      }
    }
  }

  return {
    sourceMode: 'unconfigured',
    allowedBusinessIds: [],
    message: {
      severity: 'info',
      code: 'connectors_not_configured',
      text: 'Product search is not connected to approved catalog sources or official connectors yet.',
      nextAction: 'Connect approved UCP or official catalog sources before showing live results.'
    }
  }
}

export const buildCartPrepareSourcePolicy = ({
  records = targetBusinessSeedRecords,
  connectedSources = [],
  now = new Date()
}: BuildCartPrepareSourcePolicyOptions): CartPrepareSourcePolicy => {
  const approvedRecords = cartPrepareVisibleRecords(records, now)

  if (approvedRecords.length > 0) {
    return {
      sourceMode: 'approved_sources',
      allowedBusinessIds: approvedRecords.map((record) => record.businessId),
      message: {
        severity: 'info',
        code: 'approved_cart_prepare_sources',
        text: 'Cart preparation is constrained to approved launch-visible checkout-capable sources.',
        nextAction: 'Keep cart, checkout, conformance, and handoff authority evidence current before expanding coverage.'
      }
    }
  }

  const connectedBusinessIds = [...new Set(
    connectedSources
      .filter((source) => source.sourceType !== 'unsupported')
      .map((source) => source.businessId)
  )]

  if (connectedBusinessIds.length > 0) {
    return {
      sourceMode: 'connected_sources',
      allowedBusinessIds: connectedBusinessIds,
      message: {
        severity: 'info',
        code: 'connected_cart_prepare_sources',
        text: 'Cart preparation is constrained to configured checkout-capable connectors.',
        nextAction: 'Keep connector credentials, cart capability evidence, handoff authority, and response validation healthy before expanding traffic.'
      }
    }
  }

  return {
    sourceMode: 'unconfigured',
    allowedBusinessIds: [],
    message: {
      severity: 'info',
      code: 'cart_prepare_sources_not_configured',
      text: 'Cart preparation is not connected to approved checkout-capable sources or cart-preparation connectors yet.',
      nextAction: 'Connect a source with explicit cart or checkout handoff capability before preparing a cart.'
    }
  }
}

export const checkoutCompletionVisibleRecords = (
  records: TargetBusinessRecord[] = targetBusinessSeedRecords,
  now = new Date()
) =>
  records.filter(
    (record) =>
      record.featureVisibility === 'checkout_visible' &&
      record.launchStatus === 'launch_visible' &&
      record.accessPolicyState === 'approved' &&
      hasCurrentConformanceEvidence(record, now) &&
      hasCapabilityStatus(record, checkout, ['approved']) &&
      hasCapabilityStatus(record, order, ['approved'])
  )

export const buildCheckoutCompletionSourcePolicy = ({
  records = targetBusinessSeedRecords,
  connectedSources = [],
  now = new Date()
}: BuildCheckoutCompletionSourcePolicyOptions): CheckoutCompletionSourcePolicy => {
  const approvedRecords = checkoutCompletionVisibleRecords(records, now)

  if (approvedRecords.length > 0) {
    return {
      sourceMode: 'approved_sources',
      allowedBusinessIds: approvedRecords.map((record) => record.businessId),
      message: {
        severity: 'info',
        code: 'approved_checkout_completion_sources',
        text: 'Direct checkout completion is constrained to approved launch-visible checkout executor sources.',
        nextAction: 'Keep payment proof support, final validation, completion reference, and audit evidence current before using direct completion.'
      }
    }
  }

  const connectedBusinessIds = [...new Set(
    connectedSources
      .filter((source) => source.sourceType !== 'unsupported')
      .map((source) => source.businessId)
  )]

  if (connectedBusinessIds.length > 0) {
    return {
      sourceMode: 'connected_sources',
      allowedBusinessIds: connectedBusinessIds,
      message: {
        severity: 'info',
        code: 'connected_checkout_completion_sources',
        text: 'Direct checkout completion is constrained to configured sources with an explicit completion executor.',
        nextAction: 'Keep direct executor, payment proof, structured response, completion reference, and source profile evidence current.'
      }
    }
  }

  return {
    sourceMode: 'unconfigured',
    allowedBusinessIds: [],
    message: {
      severity: 'info',
      code: 'checkout_completion_sources_not_configured',
      text: 'Direct checkout completion is not connected to approved checkout executor sources.',
      nextAction: 'Use merchant checkout handoff until a source-specific completion executor and payment proof path are configured.'
    }
  }
}

export const approvedCheckoutCompletionSourcesForPolicy = ({
  records,
  allowedBusinessIds,
  now = new Date()
}: {
  records: TargetBusinessRecord[]
  allowedBusinessIds: string[]
  now?: Date
}): CatalogSource[] => {
  const allowed = new Set(allowedBusinessIds)

  return checkoutCompletionVisibleRecords(records, now)
    .filter((record) => allowed.has(record.businessId))
    .map((record) => ({
      businessId: record.businessId,
      domain: record.domain,
      displayName: record.displayName,
      sourceType: record.sourceType,
      ...(record.profileUrl ? { profileUrl: record.profileUrl } : {}),
      ...(record.profileHash ? { profileHash: record.profileHash } : {})
    }))
}
