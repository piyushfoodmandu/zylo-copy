import { describe, expect, it, vi } from 'vitest'
import { Elysia } from 'elysia'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { targetBusinessSeedRecords, type ApprovedCatalogSource } from '@arro/connectors'
import {
  AgentCapabilityManifestSchema,
  AgentDiagnosticsResponseSchema,
  AgentSessionIssueResponseSchema,
  CatalogProductCompareResponseSchema,
  CatalogProductDetailResponseSchema,
  CatalogProductSanityCheckResponseSchema,
  CatalogSearchResponseSchema,
  CatalogSourceStateResponseSchema,
  HealthResponseSchema,
  collectUcpPlatformProfileAuthorityFailures,
  TargetBusinessConformanceListResponseSchema,
  TargetBusinessConformanceRunResponseSchema,
  TargetBusinessAdminDetailResponseSchema,
  TargetBusinessAdminListResponseSchema,
  TargetBusinessAdminTransitionResponseSchema,
  TargetBusinessMatrixResponseSchema,
  UcpDiscoveryResponseSchema,
  type UcpDiscoveryResponse,
  type CatalogProductDetail,
  type CatalogProductSearchInput,
  type TargetBusinessRecord,
  type ArroPlatformProfile,
  ArroPlatformProfileSchema
} from '@arro/contracts'
import { buildApp } from './app.ts'
import { RequestLifecycle } from './request-lifecycle.ts'
import type {
  ConformanceListOptions,
  ConformanceOperations,
  ConformanceRunOptions
} from './conformance.ts'
import {
  SourceGovernanceError,
  type SourceGovernanceDetailOptions,
  type SourceGovernanceListOptions,
  type SourceGovernanceOperations,
  type SourceGovernanceTransitionOptions
} from './source-governance.ts'
import { createAgentSessionToken } from './agent-session.ts'
import { issueShopperSessionToken } from './shopper-session.ts'
import { resolveUcpPlatformIdentity } from './ucp-platform-identity.ts'

const app = buildApp()
const authenticatedApp = buildApp(new Elysia(), {
  authenticate: async () => ({
    ok: true,
    decision: 'allowed',
    principal: {
      keyId: 'test-key',
      ownerPrincipal: 'app-test',
      scopes: ['discovery:write'],
      environment: 'test'
    }
  })
})

const guardedAuditEvents: any[] = []
const guardedApp = buildApp(new Elysia(), {
  authenticate: async () => ({
    ok: true,
    decision: 'allowed',
    principal: {
      keyId: 'guarded-key',
      ownerPrincipal: 'guarded-app-test',
      scopes: ['discovery:write'],
      environment: 'test'
    }
  }),
  recordAudit: async (event) => {
    guardedAuditEvents.push(event)
  }
})

const rateLimitAuditEvents: any[] = []
const rateLimitedApp = buildApp(new Elysia(), {
  authenticate: async () => ({
    ok: true,
    decision: 'allowed',
    principal: {
      keyId: 'limited-key',
      ownerPrincipal: 'rate-limited-app-test',
      scopes: ['discovery:write'],
      environment: 'test'
    }
  }),
  rateLimitProtectedRequest: async () => ({
    allowed: false,
    status: 429,
    reasonCode: 'rate_limit_exceeded',
    retryAfterSeconds: 30,
    limit: 10,
    remaining: 0,
    resetAt: '2025-01-01T00:01:00.000Z',
    body: {
      error: {
        code: 'rate_limit_exceeded',
        message: 'Too many requests for this endpoint. Retry after the indicated interval.',
        requestId: 'rate-limit-test'
      }
    }
  }),
  recordAudit: async (event) => {
    rateLimitAuditEvents.push(event)
  }
})

const publicRateLimitedApp = buildApp(new Elysia(), {
  rateLimitPublicRequest: async () => ({
    allowed: false,
    status: 429,
    reasonCode: 'rate_limit_exceeded',
    retryAfterSeconds: 45,
    limit: 5,
    remaining: 0,
    resetAt: '2025-01-01T00:01:00.000Z',
    body: {
      error: {
        code: 'rate_limit_exceeded',
        message: 'Too many requests for this endpoint. Retry after the indicated interval.',
        requestId: 'public-rate-limit-test'
      }
    }
  })
})

const auditedEvents: any[] = []
const auditedApp = buildApp(new Elysia(), {
  authenticate: async ({ request }) => {
    if (request.headers.get('x-api-key') === 'wrong-scope') {
      return {
        ok: false,
        decision: 'insufficient_scope',
        status: 403,
        body: {
          error: {
            code: 'insufficient_scope',
            message: 'The API key is not authorized for this endpoint.',
            requestId: 'audit-test'
          }
        }
      }
    }

    return {
      ok: true,
      decision: 'allowed',
      principal: {
        keyId: 'audit-key',
        ownerPrincipal: 'audit-app-test',
        scopes: ['discovery:write'],
        environment: 'test'
      }
    }
  },
  recordAudit: async (event) => {
    auditedEvents.push(event)
  }
})

const searchAuditEvents: any[] = []
const searchAuditedApp = buildApp(new Elysia(), {
  recordSearchAudit: async (event) => {
    searchAuditEvents.push(event)
    return { recorded: true }
  }
})

const agentSessionAuditEvents: any[] = []
const agentSessionApp = buildApp(new Elysia(), {
  agentSessionSigningSecret: 'test-agent-session-signing-secret-with-at-least-32-characters',
  agentSessionMaxTtlSeconds: 1800,
  loadTargetBusinessRecords: async () => [],
  authenticate: async ({ request, requestId }) => {
    if (request.headers.get('x-api-key') === 'agent-session-key') {
      return {
        ok: true,
        decision: 'allowed',
        principal: {
          keyId: 'agent-session-key',
          ownerPrincipal: 'agent-session-app-test',
          scopes: ['agent:session'],
          environment: 'test'
        }
      }
    }

    return {
      ok: false,
      decision: 'insufficient_scope',
      status: 403,
      body: {
        error: {
          code: 'insufficient_scope',
          message: 'The API key is not authorized for this endpoint.',
          requestId
        }
      }
    }
  },
  rateLimitProtectedRequest: async () => ({
    allowed: true,
    limit: 10,
    remaining: 9,
    resetAt: '2026-06-01T00:01:00.000Z'
  }),
  recordAudit: async (event) => {
    agentSessionAuditEvents.push(event)
  }
})

const approvedCatalogSearchRecord: TargetBusinessRecord = {
  businessId: 'approved-electronics',
  domain: 'approved.example.com',
  displayName: 'Approved Electronics',
  sourceType: 'direct_ucp',
  launchStatus: 'launch_visible',
  featureVisibility: 'catalog_visible',
  accessPolicyState: 'approved',
  profileUrl: 'https://approved.example.com/.well-known/ucp',
  profileHash: 'sha256:approved-electronics-profile',
  capabilities: [
    {
      capability: 'dev.ucp.shopping.catalog.search',
      status: 'approved',
      source: 'arro_conformance'
    }
  ],
  evidence: [
    {
      kind: 'arro_conformance',
      source: 'target_business_conformance_runs:app-test; request:approved-search',
      observedAt: '2026-06-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      summary: 'Conformance passed for profile sha256:approved-electronics-profile with 8 passing checks.'
    }
  ],
  userFacingStatus: {
    label: 'Approved catalog source',
    reason: 'Current conformance and admin approval are recorded for catalog search.',
    nextAction: 'Keep source evidence current before expanding product coverage.'
  }
}

const approvedCatalogSearchProduct: CatalogProductSearchInput = {
  productId: 'approved-iphone-16-pro',
  variantId: 'approved-iphone-16-pro-256gb',
  businessId: 'approved-electronics',
  businessName: 'Approved Electronics',
  title: 'Apple iPhone 16 Pro 256GB',
  brand: 'Apple',
  description: 'Approved-source smartphone listing with contract-safe product facts.',
  categoryPath: ['Electronics', 'Smartphones'],
  price: { amountMinor: 999, currency: 'USD' },
  availability: 'in_stock',
  condition: 'new',
  productUrl: 'https://approved.example.com/products/iphone-16-pro',
  tags: ['iphone', 'mobile', 'smartphone'],
  sourceLabel: {
    sourceId: 'approved-electronics',
    sourceName: 'Approved Electronics',
    factType: 'approved_catalog_product',
    fetchedAt: '2026-06-01T00:00:00.000Z',
    expiresAt: '2026-06-01T00:15:00.000Z',
    freshnessClass: 'advisory_catalog',
    bindingStatus: 'advisory'
  }
}

const approvedCatalogSecondRecord: TargetBusinessRecord = {
  ...approvedCatalogSearchRecord,
  businessId: 'approved-appliances',
  domain: 'appliances.example.com',
  displayName: 'Approved Appliances',
  profileUrl: 'https://appliances.example.com/.well-known/ucp',
  profileHash: 'sha256:approved-appliances-profile',
  evidence: [
    {
      kind: 'arro_conformance',
      source: 'target_business_conformance_runs:app-test; request:approved-appliances-search',
      observedAt: '2026-06-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
      summary: 'Conformance passed for profile sha256:approved-appliances-profile with 8 passing checks.'
    }
  ]
}

const approvedCatalogSecondProduct: CatalogProductSearchInput = {
  ...approvedCatalogSearchProduct,
  productId: 'approved-galaxy-s25',
  variantId: 'approved-galaxy-s25-256gb',
  businessId: 'approved-appliances',
  businessName: 'Approved Appliances',
  title: 'Samsung Galaxy S25 256GB',
  brand: 'Samsung',
  productUrl: 'https://appliances.example.com/products/galaxy-s25',
  tags: ['samsung', 'galaxy', 'mobile', 'smartphone'],
  sourceLabel: {
    ...approvedCatalogSearchProduct.sourceLabel,
    sourceId: 'approved-appliances',
    sourceName: 'Approved Appliances'
  }
}

const approvedCatalogSearchAuditEvents: any[] = []
const approvedCatalogSearchApp = buildApp(new Elysia(), {
  loadTargetBusinessRecords: async () => [approvedCatalogSearchRecord],
  catalogProductFetcher: async ({ source }) => ({
    sourceId: source.businessId,
    sourceName: source.displayName,
    status: 'fetched',
    products: [approvedCatalogSearchProduct],
    fetchedAt: '2026-06-01T00:00:00.000Z',
    latencyMs: 14,
    messages: [
      {
        severity: 'info',
        code: 'connector_catalog_fetched',
        text: 'Connector-backed catalog product facts were fetched and validated.'
      }
    ]
  }),
  recordSearchAudit: async (event) => {
    approvedCatalogSearchAuditEvents.push(event)
    return { recorded: true }
  }
})

const connectedCatalogSource: ApprovedCatalogSource = {
  businessId: 'connected-shopify-storefront',
  domain: 'connected-shop.myshopify.com',
  displayName: 'Connected Shopify Storefront',
  sourceType: 'direct_ucp',
  profileUrl: 'https://connected-shop.myshopify.com/.well-known/ucp',
  profileHash: 'sha256:connected-shopify-storefront-profile',
  cartPreparationEvidence: {
    capability: 'dev.ucp.shopping.cart',
    toolName: 'create_cart',
    profileHash: 'sha256:connected-shopify-storefront-profile',
    profileVersion: '2026-08-25',
    checkedAt: '2026-07-10T00:00:00.000Z',
    expiresAt: '2026-07-17T00:00:00.000Z',
    allowedHandoffAuthorities: ['connected-shop.myshopify.com']
  },
  allowedHandoffAuthorities: ['connected-shop.myshopify.com']
}

const connectedCatalogProduct: CatalogProductSearchInput = {
  ...approvedCatalogSearchProduct,
  productId: 'connected-iphone-16-pro',
  variantId: 'connected-iphone-16-pro-256gb',
  businessId: connectedCatalogSource.businessId,
  businessName: connectedCatalogSource.displayName,
  productUrl: 'https://connected-shop.myshopify.com/products/iphone-16-pro',
  sourceLabel: {
    ...approvedCatalogSearchProduct.sourceLabel,
    sourceId: connectedCatalogSource.businessId,
    sourceName: connectedCatalogSource.displayName,
    factType: 'connected_catalog_product'
  }
}

const connectedCatalogProductDetail: CatalogProductDetail = {
  productId: connectedCatalogProduct.productId,
  variantId: connectedCatalogProduct.variantId,
  businessId: connectedCatalogSource.businessId,
  businessName: connectedCatalogSource.displayName,
  title: connectedCatalogProduct.title,
  brand: connectedCatalogProduct.brand,
  description: 'Connector-backed product detail with source-confirmed media and variants.',
  categoryPath: connectedCatalogProduct.categoryPath,
  price: connectedCatalogProduct.price,
  availability: connectedCatalogProduct.availability,
  condition: connectedCatalogProduct.condition,
  productUrl: connectedCatalogProduct.productUrl,
  media: [
    {
      type: 'image',
      url: 'https://connected-shop.myshopify.com/images/iphone-16-pro.jpg',
      alt: 'Apple iPhone 16 Pro 256GB'
    }
  ],
  options: [
    {
      name: 'Storage',
      values: [{ label: '256GB' }]
    }
  ],
  selected: [{ name: 'Storage', label: '256GB' }],
  variants: [
    {
      variantId: connectedCatalogProduct.variantId!,
      title: '256GB',
      selectedOptions: [{ name: 'Storage', label: '256GB' }],
      price: connectedCatalogProduct.price,
      availability: 'in_stock',
      productUrl: connectedCatalogProduct.productUrl
    }
  ],
  warnings: [],
  sourceLabel: {
    ...connectedCatalogProduct.sourceLabel,
    factType: 'connected_catalog_product_detail'
  }
}

const connectedCatalogSearchAuditEvents: any[] = []
const connectedCatalogProductDetailAuditEvents: any[] = []
const connectedCatalogSearchRequests: any[] = []
const connectedCatalogSearchApp = buildApp(new Elysia(), {
  loadTargetBusinessRecords: async () => [],
  connectedCatalogSources: [connectedCatalogSource],
  catalogProductFetcher: async ({ source, searchRequest }) => {
    connectedCatalogSearchRequests.push(searchRequest)

    return {
      sourceId: source.businessId,
      sourceName: source.displayName,
      status: 'fetched',
      products: [connectedCatalogProduct],
      fetchedAt: '2026-06-01T00:00:00.000Z',
      latencyMs: 11,
      messages: [
        {
          severity: 'info',
          code: 'connected_catalog_fetched',
          text: 'Connected catalog product facts were fetched and validated.'
        }
      ]
    }
  },
  catalogProductDetailFetcher: async ({ source }) => ({
    sourceId: source.businessId,
    sourceName: source.displayName,
    status: 'fetched',
    product: connectedCatalogProductDetail,
    fetchedAt: '2026-06-01T00:00:00.000Z',
    latencyMs: 9,
    messages: [
      {
        severity: 'info',
        code: 'connected_catalog_product_detail_fetched',
        text: 'Connected catalog product detail was fetched and validated.'
      }
    ]
  }),
  recordSearchAudit: async (event) => {
    connectedCatalogSearchAuditEvents.push(event)
    return { recorded: true }
  },
  recordProductDetailAudit: async (event) => {
    connectedCatalogProductDetailAuditEvents.push(event)
    return { recorded: true }
  }
})

const appDiscoveryResponse = ({
  requestId,
  correlationId,
  domain
}: {
  requestId: string
  correlationId: string
  domain: string
}): UcpDiscoveryResponse => ({
  requestId,
  correlationId,
  status: 'fetched',
  accessPolicyState: 'profile_fetched',
  domain,
  profileUrl: `https://${domain}/.well-known/ucp`,
  httpStatus: 200,
  fetchedAt: '2026-05-31T00:00:00.000Z',
  evidence: {
    httpsOnly: true,
    redirectsAllowed: false,
    privateNetworkBlocked: true,
    contentType: 'application/json',
    responseBytes: 512,
    latencyMs: 25
  },
  profile: {
    domain,
    profileUrl: `https://${domain}/.well-known/ucp`,
    profileHash: 'sha256:app-discovery-profile',
    profileShape: 'canonical_ucp',
    protocolVersions: ['2026-08-25'],
    supportedVersionUrls: [],
    services: [
      {
        id: 'catalog',
        transport: 'mcp',
        url: 'https://api.example.com/ucp',
        capabilities: ['dev.ucp.shopping.catalog.search']
      }
    ],
    capabilities: ['dev.ucp.shopping.catalog.search'],
    paymentHandlers: [],
    signingKeyCount: 0,
    cache: {
      cacheControl: 'public, max-age=300',
      maxAgeSeconds: 300,
      internallyCappedMaxAgeSeconds: 300
    },
    dns: {
      hostname: domain,
      checkedAddresses: ['93.184.216.34']
    },
    validatedAt: '2026-05-31T00:00:00.000Z'
  },
  messages: [
    {
      severity: 'info',
      code: 'profile_fetched',
      text: 'The UCP profile was fetched and summarized.'
    }
  ]
})

const discoveryPersistenceCalls: any[] = []
const discoveryAuditEvents: any[] = []
const discoveryInjectedApp = buildApp(new Elysia(), {
  authenticate: async () => ({
    ok: true,
    decision: 'allowed',
    principal: {
      keyId: 'discovery-key',
      ownerPrincipal: 'discovery-app-test',
      scopes: ['discovery:write'],
      environment: 'test'
    }
  }),
  discoverUcpProfile: async (request, options) =>
    appDiscoveryResponse({
      requestId: options.requestId,
      correlationId: options.correlationId,
      domain: request.domain
    }),
  persistDiscoveryObservation: async (options) => {
    discoveryPersistenceCalls.push(options)
    return {
      observationId: '4242',
      businessId: 'direct-ucp-example',
      createdBusiness: true,
      capabilitiesUpserted: 1,
      evidenceInserted: true
    }
  },
  recordAudit: async (event) => {
    discoveryAuditEvents.push(event)
  }
})

const adminAuditEvents: any[] = []
const adminRecord = targetBusinessSeedRecords.find((record) =>
  record.businessId === 'allbirds-public-ucp-candidate'
)!
const adminBlockedRecord = {
  ...adminRecord,
  launchStatus: 'blocked' as const,
  userFacingStatus: {
    label: 'Not connected',
    reason: 'An administrative block is recorded for this source.',
    nextAction: 'Complete admin review before retrying discovery, conformance, or source exposure.'
  }
}
const adminTransition = {
  id: '1',
  businessId: adminRecord.businessId,
  requestId: 'admin-transition-request',
  correlationId: 'admin-transition-request',
  principalKeyId: 'admin-key',
  ownerPrincipal: 'admin-app-test',
  previousLaunchStatus: 'candidate' as const,
  nextLaunchStatus: 'blocked' as const,
  previousFeatureVisibility: 'hidden' as const,
  nextFeatureVisibility: 'hidden' as const,
  previousAccessPolicyState: 'profile_fetched' as const,
  nextAccessPolicyState: 'profile_fetched' as const,
  reasonCode: 'policy_block' as const,
  reviewerNote: 'Policy review blocked source exposure.',
  overrideApplied: false,
  metadata: { verifier: 'app-test' },
  createdAt: '2026-05-31T00:00:00.000Z'
}
const adminConformanceRun = {
  id: '77',
  businessId: adminRecord.businessId,
  requestId: 'admin-conformance-request',
  correlationId: 'admin-conformance-request',
  principalKeyId: 'admin-key',
  ownerPrincipal: 'admin-app-test',
  linkedDiscoveryObservationId: '4242',
  runMode: 'live' as const,
  runStatus: 'passed' as const,
  profileHash: 'sha256:admin-conformance-profile',
  checksPassed: 8,
  checksFailed: 0,
  checkDetails: [
    {
      id: 'profile_hash_matches_business',
      status: 'passed' as const,
      message: 'The discovery profile hash matches the current business profile hash.'
    }
  ],
  capabilityCoverage: {
    required: ['dev.ucp.shopping.catalog.search'],
    declared: ['dev.ucp.shopping.catalog.search'],
    missing: []
  },
  failureClassification: 'none' as const,
  startedAt: '2026-05-31T00:00:00.000Z',
  completedAt: '2026-05-31T00:00:00.000Z',
  expiresAt: '2026-06-01T00:00:00.000Z',
  reviewerSummary: 'App test conformance run.',
  metadata: { verifier: 'app-test' },
  createdAt: '2026-05-31T00:00:00.000Z'
}
const listAdminBusinessesMock = vi.fn(async (options: SourceGovernanceListOptions) => ({
  requestId: options.requestId,
  correlationId: options.correlationId,
  generatedAt: '2026-05-31T00:00:00.000Z',
  filters: options.filters ?? {},
  records: [adminRecord],
  messages: [
    {
      severity: 'info' as const,
      code: 'admin_source_governance',
      text: 'Admin source governance views are operational controls.'
    }
  ]
}))
const getAdminBusinessDetailMock = vi.fn(async (options: SourceGovernanceDetailOptions) => ({
  requestId: options.requestId,
  correlationId: options.correlationId,
  generatedAt: '2026-05-31T00:00:00.000Z',
  record: adminRecord,
  recentDiscoveryObservations: [],
  transitions: [],
  messages: [
    {
      severity: 'info' as const,
      code: 'admin_source_governance',
      text: 'Admin source governance views are operational controls.'
    }
  ]
}))
const transitionAdminBusinessMock = vi.fn(async (options: SourceGovernanceTransitionOptions) => {
  if (options.transition.nextLaunchStatus === 'launch_visible') {
    throw new SourceGovernanceError(
      409,
      'conformance_required',
      'Launch-visible source states require current passing conformance.'
    )
  }

  return {
    requestId: options.requestId,
    correlationId: options.correlationId,
    generatedAt: '2026-05-31T00:00:00.000Z',
    record: adminBlockedRecord,
    transition: {
      ...adminTransition,
      requestId: options.requestId,
      correlationId: options.correlationId
    },
    messages: [
      {
        severity: 'info' as const,
        code: 'admin_source_governance',
        text: 'Admin source governance views are operational controls.'
      }
    ]
  }
})
const adminSourceGovernance: SourceGovernanceOperations = {
  listBusinesses: listAdminBusinessesMock,
  getBusinessDetail: getAdminBusinessDetailMock,
  transitionBusiness: transitionAdminBusinessMock
}
const runAdminConformanceMock = vi.fn(async (options: ConformanceRunOptions) => ({
  requestId: options.requestId,
  correlationId: options.correlationId,
  generatedAt: '2026-05-31T00:00:00.000Z',
  run: {
    ...adminConformanceRun,
    requestId: options.requestId,
    correlationId: options.correlationId,
    businessId: options.businessId,
    metadata: { verifier: 'app-test' }
  },
  messages: [
    {
      severity: 'info' as const,
      code: 'target_business_conformance',
      text: 'Conformance records protocol evidence.'
    }
  ]
}))
const listAdminConformanceRunsMock = vi.fn(async (options: ConformanceListOptions) => ({
  requestId: options.requestId,
  correlationId: options.correlationId,
  generatedAt: '2026-05-31T00:00:00.000Z',
  businessId: options.businessId,
  runs: [{ ...adminConformanceRun, businessId: options.businessId }],
  messages: [
    {
      severity: 'info' as const,
      code: 'target_business_conformance',
      text: 'Conformance records protocol evidence.'
    }
  ]
}))
const adminConformance: ConformanceOperations = {
  runConformance: runAdminConformanceMock,
  listConformanceRuns: listAdminConformanceRunsMock
}
const adminApp = buildApp(new Elysia(), {
  authenticate: async ({ request, requestId }) => {
    if (request.headers.get('x-api-key') === 'admin-key') {
      return {
        ok: true,
        decision: 'allowed',
        principal: {
          keyId: 'admin-key',
          ownerPrincipal: 'admin-app-test',
          scopes: ['admin:*'],
          environment: 'test'
        }
      }
    }

    return {
      ok: false,
      decision: 'insufficient_scope',
      status: 403,
      principal: {
        keyId: 'search-key',
        ownerPrincipal: 'search-app-test',
        scopes: ['search:read'],
        environment: 'test'
      },
      body: {
        error: {
          code: 'insufficient_scope',
          message: 'The API key is not authorized for this endpoint.',
          requestId
        }
      }
    }
  },
  sourceGovernance: adminSourceGovernance,
  conformance: adminConformance,
  recordAudit: async (event) => {
    adminAuditEvents.push(event)
  }
})

const healthValidator = TypeCompiler.Compile(HealthResponseSchema)
const platformProfileValidator = TypeCompiler.Compile(ArroPlatformProfileSchema)
const agentDiagnosticsValidator = TypeCompiler.Compile(AgentDiagnosticsResponseSchema)
const agentSessionIssueValidator = TypeCompiler.Compile(AgentSessionIssueResponseSchema)
const catalogSearchValidator = TypeCompiler.Compile(CatalogSearchResponseSchema)
const agentCapabilityManifestValidator = TypeCompiler.Compile(AgentCapabilityManifestSchema)
const catalogProductDetailValidator = TypeCompiler.Compile(CatalogProductDetailResponseSchema)
const catalogProductCompareValidator = TypeCompiler.Compile(CatalogProductCompareResponseSchema)
const catalogProductSanityCheckValidator = TypeCompiler.Compile(CatalogProductSanityCheckResponseSchema)
const catalogSourceStateValidator = TypeCompiler.Compile(CatalogSourceStateResponseSchema)
const ucpDiscoveryValidator = TypeCompiler.Compile(UcpDiscoveryResponseSchema)
const targetBusinessMatrixValidator = TypeCompiler.Compile(TargetBusinessMatrixResponseSchema)
const targetBusinessAdminListValidator = TypeCompiler.Compile(TargetBusinessAdminListResponseSchema)
const targetBusinessAdminDetailValidator = TypeCompiler.Compile(TargetBusinessAdminDetailResponseSchema)
const targetBusinessAdminTransitionValidator = TypeCompiler.Compile(TargetBusinessAdminTransitionResponseSchema)
const targetBusinessConformanceRunValidator = TypeCompiler.Compile(TargetBusinessConformanceRunResponseSchema)
const targetBusinessConformanceListValidator = TypeCompiler.Compile(TargetBusinessConformanceListResponseSchema)

const jsonRequest = (
  path: string,
  body: unknown,
  headers?: Record<string, string>,
  method = 'POST'
) =>
  new Request(`http://localhost${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    body: JSON.stringify(body)
  })

describe('Arro API foundation', () => {
  it('responds to liveness checks with request and correlation IDs', async () => {
    const response = await app.handle(
      new Request('http://localhost/health/live', {
        headers: {
          'x-request-id': 'req-test',
          'x-correlation-id': 'corr-test'
        }
      })
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('x-request-id')).toBe('req-test')
    expect(response.headers.get('x-correlation-id')).toBe('corr-test')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('cache-control')).toBe('no-store')

    const body = (await response.json()) as Record<string, any>
    expect(healthValidator.Check(body)).toBe(true)
    expect(body.status).toBe('ok')
  })

  it('allows browser preflight only from configured app origins', async () => {
    const corsApp = buildApp(new Elysia(), {
      appAllowedOrigins: ['https://shop.example.com', 'http://localhost:8081']
    })

    const allowed = await corsApp.handle(
      new Request('http://localhost/v1/catalog/search', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://shop.example.com',
          'access-control-request-method': 'POST'
        }
      })
    )
    expect(allowed.status).toBe(204)
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://shop.example.com')
    expect(allowed.headers.get('access-control-allow-methods')).toContain('POST')
    expect(allowed.headers.get('vary')).toContain('Origin')

    const allowedLocalShopperSession = await corsApp.handle(
      new Request('http://localhost/v1/shopper/session', {
        method: 'OPTIONS',
        headers: {
          origin: 'http://localhost:8081',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,x-arro-shopper-session'
        }
      })
    )
    expect(allowedLocalShopperSession.status).toBe(204)
    expect(allowedLocalShopperSession.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:8081'
    )
    expect(allowedLocalShopperSession.headers.get('access-control-allow-headers')).toContain(
      'x-arro-shopper-session'
    )

    const denied = await corsApp.handle(
      new Request('http://localhost/v1/catalog/search', {
        method: 'OPTIONS',
        headers: {
          origin: 'https://not-allowed.example.com',
          'access-control-request-method': 'POST'
        }
      })
    )
    expect(denied.status).toBe(403)
    expect(denied.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('reports local readiness as degraded until external services are configured', async () => {
    const response = await app.handle(
      new Request('http://localhost/health/ready')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')

    const body = (await response.json()) as Record<string, any>
    expect(healthValidator.Check(body)).toBe(true)
    expect(body.status).toBe('degraded')
    expect(body.checks.some((check: { name: string }) => check.name === 'postgres')).toBe(true)
    expect(body.checks.some((check: { name: string }) => check.name === 'redis')).toBe(true)
  })

  it('serves a cacheable UCP platform profile', async () => {
    const response = await app.handle(
      new Request('http://localhost/.well-known/ucp')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('content-type')).toContain('application/json')

    const cacheControl = response.headers.get('cache-control') ?? ''
    const maxAge = Number(/(?:^|,\s*)max-age=(\d+)/.exec(cacheControl)?.[1])
    expect(cacheControl).toContain('public')
    expect(maxAge).toBeGreaterThanOrEqual(60)

    const body = (await response.json()) as Record<string, any>
    expect(platformProfileValidator.Check(body)).toBe(true)

    const ucp = body.ucp as ArroPlatformProfile['ucp']
    expect(collectUcpPlatformProfileAuthorityFailures(body as ArroPlatformProfile)).toEqual([])
    expect(ucp.version).toBe('2026-08-25')
    expect(ucp.capabilities['dev.ucp.shopping.checkout']).toBeUndefined()
    expect(ucp.capabilities['dev.ucp.shopping.fulfillment']).toBeUndefined()
    expect(ucp.capabilities['dev.ucp.shopping.discount']).toBeUndefined()
    expect(ucp.capabilities['dev.ucp.shopping.buyer_consent']).toBeUndefined()
    expect((ucp.capabilities as Record<string, unknown>)['dev.ucp.common.payment.authentication']).toBeUndefined()
    expect(ucp.capabilities['dev.ucp.shopping.catalog.search']?.[0]?.schema).toBe(
      'https://ucp.dev/2026-08-25/schemas/shopping/catalog_search.json'
    )
    expect(ucp.capabilities['dev.ucp.shopping.catalog.lookup']?.[0]?.schema).toBe(
      'https://ucp.dev/2026-08-25/schemas/shopping/catalog_lookup.json'
    )
    expect(ucp.capabilities['dev.shopify.catalog.global']?.[0]?.extends).toEqual([
      'dev.ucp.shopping.catalog.lookup',
      'dev.ucp.shopping.catalog.search'
    ])
    expect(ucp.services['dev.ucp.shopping']).toHaveLength(2)
    expect(ucp.services['dev.ucp.shopping']).toEqual(expect.arrayContaining([
      expect.objectContaining({
        version: '2026-08-25',
        spec: 'https://ucp.dev/2026-08-25/specification/overview',
        transport: 'mcp',
        schema: 'https://ucp.dev/2026-08-25/services/shopping/mcp.openrpc.json'
      }),
      expect.objectContaining({
        version: '2026-08-25',
        spec: 'https://ucp.dev/2026-08-25/specification/overview',
        transport: 'rest',
        schema: 'https://ucp.dev/2026-08-25/services/shopping/rest.openapi.json'
      })
    ]))
    expect(ucp.services['dev.ucp.shopping'].every((service) => service.endpoint === undefined)).toBe(true)
    expect(ucp.payment_handlers).toEqual({})
  })

  it('publishes only the public half of the exact platform request-signing identity', async () => {
    const privateJwk = {
      kty: 'EC',
      crv: 'P-256',
      x: '_rVPgdqCmGBO9Rg4YVk0TpD4NSUL7_2agZS9TZJ1zFs',
      y: 'bEQXnAqe3JkisNlOpRZ8fVxhClH9Z0UKHhiIaRyaOWc',
      d: '0HOvxtnWANSaK30STQucISJhdrsPjOFTQwZNUTvwjzY',
      kid: 'test-platform-2026',
      alg: 'ES256',
      use: 'sig'
    }
    const identity = resolveUcpPlatformIdentity({
      privateJwkJson: JSON.stringify(privateJwk)
    })
    if (!identity) throw new Error('test UCP platform identity was not resolved')
    const identityApp = buildApp(new Elysia(), { ucpPlatformIdentity: identity })
    const response = await identityApp.handle(new Request('http://localhost/.well-known/ucp'))
    const body = await response.json() as Record<string, any>

    expect(response.status).toBe(200)
    expect(body).not.toHaveProperty('signing_keys')
    expect(body.keys).toEqual([expect.objectContaining({
      kid: 'test-platform-2026',
      kty: 'EC',
      crv: 'P-256',
      alg: 'ES256',
      use: 'sig'
    })])
    expect(JSON.stringify(body)).not.toContain(privateJwk.d)
    expect(platformProfileValidator.Check(body)).toBe(true)
  })

  it('serves a canonical API-origin discovery surface without claiming merchant authority', async () => {
    const publicOrigin = 'https://api.arro.example'
    const discoveryApp = buildApp(new Elysia(), { publicBaseUrl: publicOrigin })

    const homepage = await discoveryApp.handle(new Request(`${publicOrigin}/`))
    expect(homepage.status).toBe(200)
    expect(homepage.headers.get('content-type')).toContain('text/html')
    expect(homepage.headers.get('content-security-policy')).toContain("style-src 'self'")
    const html = await homepage.text()
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">')
    expect(html).toContain(`<link rel="canonical" href="${publicOrigin}/">`)
    expect(html).toContain('property="og:image"')
    expect(html).toContain(`${publicOrigin}/og-card.png`)
    expect(html).not.toContain('<style>')
    const jsonLd = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1]
    expect(JSON.parse(jsonLd ?? '{}')).toMatchObject({
      '@type': 'Organization',
      url: publicOrigin
    })

    const serviceRoot = await discoveryApp.handle(new Request(`${publicOrigin}/v1`))
    expect(serviceRoot.status).toBe(200)
    await expect(serviceRoot.json()).resolves.toMatchObject({
      role: 'commerce_orchestration_platform',
      interfaces: {
        ucp_platform_profile: `${publicOrigin}/.well-known/ucp`,
        mcp: `${publicOrigin}/v1/mcp`,
        openapi: `${publicOrigin}/openapi.json`
      }
    })

    const stylesheet = await discoveryApp.handle(new Request(`${publicOrigin}/discovery.css`))
    expect(stylesheet.status).toBe(200)
    expect(stylesheet.headers.get('content-type')).toContain('text/css')

    const robots = await discoveryApp.handle(new Request(`${publicOrigin}/robots.txt`))
    expect(robots.status).toBe(200)
    expect(robots.headers.get('content-type')).toContain('text/plain')
    expect(await robots.text()).toContain(`Sitemap: ${publicOrigin}/sitemap.xml`)

    const sitemap = await discoveryApp.handle(new Request(`${publicOrigin}/sitemap.xml`))
    expect(sitemap.status).toBe(200)
    expect(sitemap.headers.get('content-type')).toContain('application/xml')
    const sitemapXml = await sitemap.text()
    expect(sitemapXml).toContain(`<loc>${publicOrigin}/</loc>`)
    expect(sitemapXml).not.toContain('localhost')

    const socialCard = await discoveryApp.handle(new Request(`${publicOrigin}/og-card.svg`))
    expect(socialCard.status).toBe(200)
    expect(socialCard.headers.get('content-type')).toContain('image/svg+xml')

    const rasterSocialCard = await discoveryApp.handle(new Request(`${publicOrigin}/og-card.png`))
    expect(rasterSocialCard.status).toBe(200)
    expect(rasterSocialCard.headers.get('content-type')).toContain('image/png')
    expect(new Uint8Array(await rasterSocialCard.arrayBuffer()).subarray(0, 8))
      .toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
  })

  it('serves a cacheable agent capability manifest for MCP and Hermes surfaces', async () => {
    const response = await app.handle(
      new Request('http://localhost/.well-known/arro-agent-capabilities')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toContain('public')

    const body = (await response.json()) as Record<string, any>
    expect(agentCapabilityManifestValidator.Check(body)).toBe(true)
    expect(body.manifestVersion).toBe('arro-agent-capabilities/v0.1')
    expect(body.mcpEndpoint).toBe('http://localhost:3000/v1/mcp')
    expect(body.supportedSurfaces).toEqual(expect.arrayContaining([
      'hermes_agent',
      'generic_mcp',
      'direct_http'
    ]))
    expect(body.firstSuccessFlow).toEqual(expect.arrayContaining([
      'agent_diagnostics',
      'search_products',
      'prepare_purchase',
      'prepare_payment',
      'provide_payment',
      'confirm_purchase',
      'get_purchase'
    ]))
    expect(body.tools.find((tool: any) => tool.name === 'search_products')).toMatchObject({
      actionScope: 'read:search',
      availability: 'ready',
      readOnly: true
    })
    expect(body.tools.find((tool: any) => tool.name === 'confirm_purchase')).toMatchObject({
      actionScope: 'write:complete_purchase',
      availability: 'gated',
      readOnly: false
    })
  })

  it('documents the initial API routes', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/openapi.json')
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, any>
    expect(body.openapi).toBe('3.1.0')
    expect(body.paths['/v1/catalog/search']).toBeDefined()
    expect(body.paths['/.well-known/arro-agent-capabilities']).toBeDefined()
    expect(body.paths['/v1/agent/capabilities']).toBeDefined()
    expect(body.paths['/v1/product/compare']).toBeDefined()
    expect(body.paths['/v1/product/sanity-check']).toBeDefined()
    expect(body.paths['/v1/source/state']).toBeDefined()
    expect(body.paths['/v1/agent/diagnostics']).toBeDefined()
    expect(body.paths['/v1/agent/session']).toBeDefined()
    expect(body.paths['/v1/mcp']).toBeDefined()
    expect(body.paths['/v1/ucp/businesses']).toBeDefined()
    expect(body.paths['/v1/ucp/discover']).toBeDefined()
    expect(body.paths['/v1/admin/businesses/{businessId}/conformance']).toBeDefined()
  })

  it('returns bounded agent diagnostics without echoing opaque subject or task refs', async () => {
    const response = await app.handle(
      jsonRequest('/v1/agent/diagnostics', {
        expectedActionScope: 'read:search',
        agentContext: {
          integrationId: 'claude-preview',
          surface: 'claude',
          requestedActionScope: 'read:search',
          externalSubjectRef: 'opaque-user-ref-should-not-echo',
          externalTaskRef: 'opaque-task-ref-should-not-echo',
          sessionExpiresAt: '2099-01-01T00:00:00.000Z',
          hostCapabilities: [
            'source_labels',
            'freshness',
            'caveats',
            'no_buy_warnings',
            'commercial_disclosures',
            'authority_limits',
            'allowed_next_actions'
          ]
        }
      }, {
        'x-request-id': 'agent-diagnostics-ready-req'
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>

    expect(agentDiagnosticsValidator.Check(body)).toBe(true)
    expect(body).toMatchObject({
      requestId: 'agent-diagnostics-ready-req',
      state: 'ready',
      integrationId: 'claude-preview',
      surface: 'claude',
      expectedActionScope: 'read:search',
      requestedActionScope: 'read:search',
      missingHostCapabilities: [],
      hasExternalSubjectRef: true,
      hasExternalTaskRef: true,
      hasSessionToken: false,
      sessionBindingState: 'not_supplied'
    })
    expect(body.checks.map((check: any) => check.code)).toEqual([
      'agent_diagnostics_ready'
    ])
    expect(JSON.stringify(body)).not.toContain('opaque-user-ref-should-not-echo')
    expect(JSON.stringify(body)).not.toContain('opaque-task-ref-should-not-echo')
  })

  it('blocks agent diagnostics when scope or host rendering capability is unsafe', async () => {
    const response = await app.handle(
      jsonRequest('/v1/agent/diagnostics', {
        expectedActionScope: 'write:purchase',
        agentContext: {
          integrationId: 'weak-host-preview',
          surface: 'generic_mcp',
          requestedActionScope: 'read:search',
          hostCapabilities: [
            'source_labels',
            'freshness'
          ]
        }
      }, {
        'x-request-id': 'agent-diagnostics-blocked-req'
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>

    expect(agentDiagnosticsValidator.Check(body)).toBe(true)
    expect(body.state).toBe('blocked')
    expect(body.expectedActionScope).toBe('write:purchase')
    expect(body.requestedActionScope).toBe('read:search')
    expect(body.hasSessionToken).toBe(false)
    expect(body.sessionBindingState).toBe('not_supplied')
    expect(body.missingHostCapabilities).toEqual([
      'caveats',
      'no_buy_warnings',
      'commercial_disclosures',
      'authority_limits',
      'allowed_next_actions',
      'user_confirmation',
      'purchase_state'
    ])
    expect(body.checks.map((check: any) => check.code)).toEqual([
      'agent_action_scope_mismatch',
      'agent_host_capabilities_missing'
    ])
  })

  it('blocks agent diagnostics when rendered fixture evidence omits required trust signals', async () => {
    const response = await app.handle(
      jsonRequest('/v1/agent/diagnostics', {
        expectedActionScope: 'read:sanity_check',
        renderedTrustSignals: [
          'source_labels',
          'freshness'
        ],
        agentContext: {
          integrationId: 'weak-rendering-preview',
          surface: 'hermes_agent',
          requestedActionScope: 'read:sanity_check',
          hostCapabilities: [
            'source_labels',
            'freshness',
            'caveats',
            'no_buy_warnings',
            'commercial_disclosures',
            'authority_limits',
            'allowed_next_actions'
          ]
        }
      }, {
        'x-request-id': 'agent-rendering-evidence-blocked-req'
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>

    expect(agentDiagnosticsValidator.Check(body)).toBe(true)
    expect(body).toMatchObject({
      requestId: 'agent-rendering-evidence-blocked-req',
      state: 'blocked',
      integrationId: 'weak-rendering-preview',
      surface: 'hermes_agent',
      expectedActionScope: 'read:sanity_check',
      requestedActionScope: 'read:sanity_check',
      missingHostCapabilities: [],
      missingRenderedTrustSignals: [
        'caveats',
        'no_buy_warnings',
        'commercial_disclosures',
        'authority_limits',
        'allowed_next_actions'
      ],
      renderingEvidenceState: 'blocked',
      sessionBindingState: 'not_supplied'
    })
    expect(body.checks.map((check: any) => check.code)).toEqual([
      'agent_rendering_evidence_missing'
    ])
  })

  it('issues scoped agent sessions and rejects rebinding on commerce routes', async () => {
    agentSessionAuditEvents.length = 0

    const hostCapabilities = [
      'source_labels',
      'freshness',
      'caveats',
      'no_buy_warnings',
      'commercial_disclosures',
      'authority_limits',
      'allowed_next_actions'
    ]
    const sessionExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
    const issueResponse = await agentSessionApp.handle(
      jsonRequest('/v1/agent/session', {
        integrationId: 'generic-mcp-preview',
        surface: 'generic_mcp',
        allowedActionScopes: ['read:search'],
        externalSubjectRef: 'opaque-session-subject',
        externalTaskRef: 'opaque-session-task',
        sessionExpiresAt,
        hostCapabilities
      }, {
        'x-api-key': 'agent-session-key',
        'x-request-id': 'agent-session-issue-req'
      })
    )

    expect(issueResponse.status).toBe(200)
    const issueBody = (await issueResponse.json()) as Record<string, any>
    expect(agentSessionIssueValidator.Check(issueBody)).toBe(true)
    expect(issueBody.session.sessionToken).toMatch(/^arro_session_v1\./)
    expect(JSON.stringify(issueBody)).not.toContain('opaque-session-subject')
    expect(JSON.stringify(issueBody)).not.toContain('opaque-session-task')

    const agentContext = {
      integrationId: 'generic-mcp-preview',
      surface: 'generic_mcp',
      requestedActionScope: 'read:search',
      externalSubjectRef: 'opaque-session-subject',
      externalTaskRef: 'opaque-session-task',
      sessionExpiresAt,
      sessionToken: issueBody.session.sessionToken,
      hostCapabilities
    }
    const searchResponse = await agentSessionApp.handle(
      jsonRequest('/v1/catalog/search', {
        query: 'running shoes',
        agentContext
      }, {
        'x-request-id': 'agent-session-search-req'
      })
    )

    expect(searchResponse.status).toBe(200)
    expect(catalogSearchValidator.Check(await searchResponse.json())).toBe(true)

    const reboundResponse = await agentSessionApp.handle(
      jsonRequest('/v1/catalog/search', {
        query: 'running shoes',
        agentContext: {
          ...agentContext,
          externalSubjectRef: 'different-session-subject'
        }
      }, {
        'x-request-id': 'agent-session-rebound-req'
      })
    )

    expect(reboundResponse.status).toBe(403)
    expect(await reboundResponse.json()).toEqual({
      error: {
        code: 'agent_session_subject_mismatch',
        message: 'Agent session token is bound to a different external subject reference.',
        requestId: 'agent-session-rebound-req'
      }
    })
    expect(agentSessionAuditEvents.some((event) =>
      event.routeGroup === 'agent_session' &&
      event.reasonCode === 'agent_session_issued' &&
      event.metadata.sessionIssued === true
    )).toBe(true)
  })

  it('returns connected source state without granting product or checkout authority', async () => {
    const sourceStateApp = buildApp(new Elysia(), {
      loadTargetBusinessRecords: async () => [],
      connectedCatalogSources: [connectedCatalogSource]
    })
    const response = await sourceStateApp.handle(
      jsonRequest('/v1/source/state', {
        businessId: connectedCatalogSource.businessId,
        agentContext: {
          integrationId: 'claude-preview',
          surface: 'claude',
          requestedActionScope: 'read:source_state',
          externalSubjectRef: 'opaque-source-state-user-ref',
          externalTaskRef: 'opaque-source-state-task-ref',
          hostCapabilities: [
            'source_labels',
            'freshness',
            'caveats',
            'commercial_disclosures',
            'authority_limits',
            'allowed_next_actions'
          ]
        }
      }, {
        'x-request-id': 'source-state-connected-req'
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>

    expect(catalogSourceStateValidator.Check(body)).toBe(true)
    expect(body).toMatchObject({
      requestId: 'source-state-connected-req',
      sourceMode: 'connected_sources',
      state: 'ready'
    })
    expect(body.sources[0]).toMatchObject({
      businessId: connectedCatalogSource.businessId,
      domain: connectedCatalogSource.domain,
      sourceMode: 'connected_sources',
      state: 'ready'
    })
    expect(body.actionPolicy.state).toBe('read')
    expect(body.actionPolicy.allowedNextActions.map((action: any) => action.action)).toEqual([
      'search_products',
      'get_product_detail'
    ])
    expect(JSON.stringify(body)).not.toContain('complete_checkout')
    expect(JSON.stringify(body)).not.toContain('opaque-source-state-user-ref')
  })

  it('blocks source-state reads when the host cannot render trust signals', async () => {
    const response = await app.handle(
      jsonRequest('/v1/source/state', {
        domain: 'approved.example.com',
        agentContext: {
          integrationId: 'weak-host-preview',
          surface: 'generic_mcp',
          requestedActionScope: 'read:source_state',
          hostCapabilities: [
            'source_labels',
            'freshness'
          ]
        }
      }, {
        'x-request-id': 'source-state-denied-req'
      })
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: {
        code: 'agent_host_capability_denied',
        message: 'Agent host does not advertise required trust-signal capabilities for read:source_state: caveats, commercial_disclosures, authority_limits, allowed_next_actions.',
        requestId: 'source-state-denied-req'
      }
    })
  })

  it('sanity-checks submitted product evidence without fetching unsupported pages or granting checkout authority', async () => {
    const freshApprovedProduct: CatalogProductSearchInput = {
      ...approvedCatalogSearchProduct,
      sourceLabel: {
        ...approvedCatalogSearchProduct.sourceLabel,
        fetchedAt: '2099-01-01T00:00:00.000Z',
        expiresAt: '2099-01-01T00:15:00.000Z'
      }
    }
    const response = await app.handle(
      jsonRequest('/v1/product/sanity-check', {
        submittedUrl: 'https://approved.example.com/products/iphone-16-pro',
        identifiers: [
          {
            kind: 'product_id',
            value: 'approved-iphone-16-pro'
          }
        ],
        visibleClaimText: 'Brand new authentic iPhone 16 Pro from Approved Electronics.',
        candidates: [freshApprovedProduct],
        agentContext: {
          integrationId: 'claude-preview',
          surface: 'claude',
          requestedActionScope: 'read:sanity_check',
          externalSubjectRef: 'opaque-sanity-user-ref',
          externalTaskRef: 'opaque-sanity-task-ref',
          hostCapabilities: [
            'source_labels',
            'freshness',
            'caveats',
            'no_buy_warnings',
            'commercial_disclosures',
            'authority_limits',
            'allowed_next_actions'
          ]
        }
      }, {
        'x-request-id': 'product-sanity-supported-req'
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>

    expect(catalogProductSanityCheckValidator.Check(body)).toBe(true)
    expect(body).toMatchObject({
      requestId: 'product-sanity-supported-req',
      state: 'supported',
      evidence: {
        hasSubmittedUrl: true,
        submittedUrlHost: 'approved.example.com',
        identifierCount: 1,
        hasVisibleClaimText: true,
        candidateCount: 1,
        sourceLabelCount: 1
      }
    })
    expect(body.candidateAssessments[0]).toMatchObject({
      businessId: 'approved-electronics',
      productId: 'approved-iphone-16-pro',
      matchState: 'supports'
    })
    expect(body.actionPolicy.state).toBe('safer_next_action')
    expect(body.actionPolicy.allowedNextActions.map((action: any) => action.action)).toEqual([
      'get_product_detail',
      'prepare_purchase'
    ])
    expect(JSON.stringify(body)).not.toContain('Brand new authentic')
    expect(JSON.stringify(body)).not.toContain('complete_checkout')
    expect(JSON.stringify(body)).not.toContain('opaque-sanity-user-ref')
  })

  it('compares source-labeled products without fetching unsupported pages or granting checkout authority', async () => {
    const freshSourceLabel = {
      ...approvedCatalogSearchProduct.sourceLabel,
      fetchedAt: '2099-01-01T00:00:00.000Z',
      expiresAt: '2099-01-01T00:15:00.000Z'
    }
    const comparableProduct: CatalogProductSearchInput = {
      ...approvedCatalogSearchProduct,
      seller: {
        name: 'Approved Electronics',
        domain: 'approved.example.com',
        url: 'https://approved.example.com'
      },
      handoff: {
        type: 'product',
        url: 'https://approved.example.com/products/iphone-16-pro'
      },
      sourceLabel: freshSourceLabel
    }
    const lowerPriceProduct: CatalogProductSearchInput = {
      ...comparableProduct,
      productId: 'approved-iphone-16-pro-deal',
      variantId: 'approved-iphone-16-pro-deal-256gb',
      title: 'Apple iPhone 16 Pro 256GB Source-Backed Deal',
      price: {
        amountMinor: 949,
        currency: 'USD'
      },
      productUrl: 'https://approved.example.com/products/iphone-16-pro-deal',
      handoff: {
        type: 'product',
        url: 'https://approved.example.com/products/iphone-16-pro-deal'
      }
    }
    const response = await app.handle(
      jsonRequest('/v1/product/compare', {
        intentSummary: 'Compare the two approved iPhone options.',
        sourceMode: 'approved_sources',
        products: [comparableProduct, lowerPriceProduct],
        criteria: ['price', 'availability', 'source_freshness'],
        agentContext: {
          integrationId: 'claude-preview',
          surface: 'claude',
          requestedActionScope: 'read:compare',
          externalSubjectRef: 'opaque-compare-user-ref',
          externalTaskRef: 'opaque-compare-task-ref',
          hostCapabilities: [
            'source_labels',
            'freshness',
            'caveats',
            'no_buy_warnings',
            'commercial_disclosures',
            'authority_limits',
            'allowed_next_actions'
          ]
        }
      }, {
        'x-request-id': 'product-compare-ready-req'
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>

    expect(catalogProductCompareValidator.Check(body)).toBe(true)
    expect(body).toMatchObject({
      requestId: 'product-compare-ready-req',
      sourceMode: 'approved_sources',
      state: 'ready',
      evidence: {
        productCount: 2,
        sourceLabelCount: 2,
        staleSourceLabelCount: 0,
        unavailableProductCount: 0,
        hasIntentSummary: true
      }
    })
    expect(body.assessments[0]).toMatchObject({
      productId: 'approved-iphone-16-pro-deal',
      comparisonState: 'stronger'
    })
    expect(body.actionPolicy.state).toBe('compare')
    expect(body.actionPolicy.allowedNextActions.map((action: any) => action.action)).toEqual([
      'get_product_detail',
      'prepare_purchase'
    ])
    expect(JSON.stringify(body)).not.toContain('Compare the two approved')
    expect(JSON.stringify(body)).not.toContain('complete_checkout')
    expect(JSON.stringify(body)).not.toContain('opaque-compare-user-ref')
  })

  it('blocks product comparison when the host cannot render trust signals', async () => {
    const response = await app.handle(
      jsonRequest('/v1/product/compare', {
        products: [approvedCatalogSearchProduct, approvedCatalogSecondProduct],
        agentContext: {
          integrationId: 'weak-host-preview',
          surface: 'generic_mcp',
          requestedActionScope: 'read:compare',
          hostCapabilities: [
            'source_labels',
            'freshness'
          ]
        }
      }, {
        'x-request-id': 'product-compare-denied-req'
      })
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: {
        code: 'agent_host_capability_denied',
        message: 'Agent host does not advertise required trust-signal capabilities for read:compare: caveats, no_buy_warnings, commercial_disclosures, authority_limits, allowed_next_actions.',
        requestId: 'product-compare-denied-req'
      }
    })
  })

  it('blocks product sanity-check when the host cannot render no-buy and authority signals', async () => {
    const response = await app.handle(
      jsonRequest('/v1/product/sanity-check', {
        submittedUrl: 'https://approved.example.com/products/iphone-16-pro',
        candidates: [approvedCatalogSearchProduct],
        agentContext: {
          integrationId: 'weak-host-preview',
          surface: 'generic_mcp',
          requestedActionScope: 'read:sanity_check',
          hostCapabilities: [
            'source_labels',
            'freshness'
          ]
        }
      }, {
        'x-request-id': 'product-sanity-denied-req'
      })
    )

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: {
        code: 'agent_host_capability_denied',
        message: 'Agent host does not advertise required trust-signal capabilities for read:sanity_check: caveats, no_buy_warnings, commercial_disclosures, authority_limits, allowed_next_actions.',
        requestId: 'product-sanity-denied-req'
      }
    })
  })

  it('serves the OpenAPI documentation page', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/openapi')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    expect(await response.text()).toContain('Arro API')
  })

  it('keeps generated request IDs consistent and hides internal error details', async () => {
    const failingApp = buildApp(new Elysia(), {
      recordSearchAudit: async () => {
        throw new Error('database password leaked through driver message')
      }
    })

    const response = await failingApp.handle(
      jsonRequest('/v1/catalog/search', {
        query: 'iphone',
        context: {
          locale: 'en-US',
          region: 'US',
          currency: 'USD',
          channel: 'web'
        }
      })
    )

    const body = (await response.json()) as Record<string, any>
    const responseRequestId = response.headers.get('x-request-id')

    expect(response.status).toBe(500)
    expect(responseRequestId).toBeTruthy()
    expect(response.headers.get('x-correlation-id')).toBe(responseRequestId)
    expect(body.error).toEqual({
      code: 'internal_error',
      message: 'Unexpected API error.',
      requestId: responseRequestId
    })
    expect(JSON.stringify(body)).not.toContain('database password leaked')
  })

  it('preserves inbound request and correlation IDs when hiding internal errors', async () => {
    const failingApp = buildApp(new Elysia(), {
      recordSearchAudit: async () => {
        throw new Error('driver stack trace should stay server-side')
      }
    })

    const response = await failingApp.handle(
      jsonRequest(
        '/v1/catalog/search',
        {
          query: 'iphone',
          context: {
            locale: 'en-US',
            region: 'US',
            currency: 'USD',
            channel: 'web'
          }
        },
        {
          'x-request-id': 'client-request-id',
          'x-correlation-id': 'client-correlation-id'
        }
      )
    )

    const body = (await response.json()) as Record<string, any>

    expect(response.status).toBe(500)
    expect(response.headers.get('x-request-id')).toBe('client-request-id')
    expect(response.headers.get('x-correlation-id')).toBe('client-correlation-id')
    expect(body.error).toEqual({
      code: 'internal_error',
      message: 'Unexpected API error.',
      requestId: 'client-request-id'
    })
    expect(JSON.stringify(body)).not.toContain('driver stack trace')
  })

  it('returns a bounded 400 error for malformed JSON request bodies', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/catalog/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'malformed-json-request'
        },
        body: '{"query":'
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: {
        code: 'invalid_json',
        message: 'The request body was not valid JSON.',
        requestId: 'malformed-json-request'
      }
    })
  })

  it('returns a bounded 404 error for unknown routes', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/not-a-route', {
        headers: {
          'x-request-id': 'unknown-route-request'
        }
      })
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      error: {
        code: 'not_found',
        message: 'The requested route was not found.',
        requestId: 'unknown-route-request'
      }
    })
  })

  it('rejects new non-liveness work and fails readiness while draining', async () => {
    const requestLifecycle = new RequestLifecycle()
    const drainingApp = buildApp(new Elysia(), { requestLifecycle })

    requestLifecycle.startDraining()

    const rejected = await drainingApp.handle(
      jsonRequest(
        '/v1/catalog/search',
        {
          query: 'iphone',
          context: {
            locale: 'en-US',
            region: 'US',
            currency: 'USD',
            channel: 'web'
          }
        },
        {
          'x-request-id': 'draining-search-request'
        }
      )
    )

    expect(rejected.status).toBe(503)
    expect(rejected.headers.get('retry-after')).toBe('25')
    expect(rejected.headers.get('x-request-id')).toBe('draining-search-request')
    expect((await rejected.json() as Record<string, any>).error.code).toBe('server_shutting_down')

    const live = await drainingApp.handle(new Request('http://localhost/health/live'))
    expect(live.status).toBe(200)

    const ready = await drainingApp.handle(new Request('http://localhost/health/ready'))
    expect(ready.status).toBe(503)
    expect(ready.headers.get('cache-control')).toBe('no-store')

    const readyBody = (await ready.json()) as Record<string, any>
    expect(healthValidator.Check(readyBody)).toBe(true)
    expect(readyBody.status).toBe('fail')
    expect(readyBody.checks).toEqual([
      expect.objectContaining({
        name: 'server-lifecycle',
        status: 'fail',
        required: true
      })
    ])
    expect(requestLifecycle.activeRequestCount).toBe(0)
  })

  it('returns target-business matrix records without granting launch visibility', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/ucp/businesses', {
        headers: {
          'x-request-id': 'matrix-req'
        }
      })
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, any>
    expect(targetBusinessMatrixValidator.Check(body)).toBe(true)
    expect(body.requestId).toBe('matrix-req')
    expect(body.records.length).toBeGreaterThanOrEqual(3)

    const allbirdsRecord = body.records.find((record: any) => record.businessId === 'allbirds-public-ucp-candidate')
    const unsupportedRecord = body.records.find((record: any) => record.businessId === 'major-retail-unsupported-snapshot')

    expect(body.records.every((record: any) => record.sourceType !== 'sandbox')).toBe(true)
    expect(body.records.every((record: any) => record.featureVisibility !== 'sandbox_only')).toBe(true)
    expect(allbirdsRecord.accessPolicyState).toBe('profile_fetched')
    expect(allbirdsRecord.featureVisibility).toBe('hidden')
    expect(unsupportedRecord.accessPolicyState).toBe('unknown')
    expect(unsupportedRecord.featureVisibility).toBe('hidden')
    expect(body.records.every((record: any) => record.featureVisibility !== 'catalog_visible')).toBe(true)
    expect(body.records.every((record: any) => record.featureVisibility !== 'checkout_visible')).toBe(true)
  })

  it('caches target-business matrix loads across search-adjacent reads', async () => {
    const loadTargetBusinessRecords = vi.fn(async () => [targetBusinessSeedRecords[0]!])
    const cachedMatrixApp = buildApp(new Elysia(), {
      loadTargetBusinessRecords,
      targetBusinessMatrixCacheTtlMs: 60_000
    })

    const first = await cachedMatrixApp.handle(new Request('http://localhost/v1/ucp/businesses'))
    const second = await cachedMatrixApp.handle(new Request('http://localhost/v1/ucp/businesses'))

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(loadTargetBusinessRecords).toHaveBeenCalledTimes(1)
  })

  it('requires authentication for UCP discovery', async () => {
    const response = await app.handle(
      jsonRequest('/v1/ucp/discover', {
        domain: 'example.com'
      })
    )

    expect(response.status).toBe(401)

    const body = (await response.json()) as Record<string, any>
    expect(body.error.code).toBe('authentication_required')
  })

  it('rejects invalid UCP discovery domains at the API contract boundary after auth', async () => {
    const response = await authenticatedApp.handle(
      jsonRequest('/v1/ucp/discover', {
        domain: 'localhost'
      })
    )

    expect(response.status).toBe(422)

    const body = (await response.json()) as Record<string, any>
    expect(body.error.code).toBe('validation_failed')
  })

  it('rejects unsupported discovery content types after auth and audits the guard', async () => {
    guardedAuditEvents.length = 0

    const response = await guardedApp.handle(
      new Request('http://localhost/v1/ucp/discover', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'domain=example.com'
      })
    )

    expect(response.status).toBe(415)

    const body = (await response.json()) as Record<string, any>
    expect(body.error.code).toBe('unsupported_media_type')
    expect(guardedAuditEvents).toHaveLength(1)
    expect(guardedAuditEvents[0]).toMatchObject({
      routeGroup: 'ucp_discovery',
      statusCode: 415,
      decision: 'allowed',
      reasonCode: 'unsupported_media_type'
    })
  })

  it('rejects oversized discovery requests after auth and audits the guard', async () => {
    guardedAuditEvents.length = 0

    const response = await guardedApp.handle(
      new Request('http://localhost/v1/ucp/discover', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '2097152'
        },
        body: '{}'
      })
    )

    expect(response.status).toBe(413)

    const body = (await response.json()) as Record<string, any>
    expect(body.error.code).toBe('payload_too_large')
    expect(guardedAuditEvents).toHaveLength(1)
    expect(guardedAuditEvents[0]).toMatchObject({
      routeGroup: 'ucp_discovery',
      statusCode: 413,
      decision: 'allowed',
      reasonCode: 'payload_too_large'
    })
  })

  it('returns 429 and audits rate-limited protected discovery requests', async () => {
    rateLimitAuditEvents.length = 0

    const response = await rateLimitedApp.handle(
      jsonRequest('/v1/ucp/discover', { domain: 'localhost' })
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('30')

    const body = (await response.json()) as Record<string, any>
    expect(body.error.code).toBe('rate_limit_exceeded')
    expect(rateLimitAuditEvents).toHaveLength(1)
    expect(rateLimitAuditEvents[0]).toMatchObject({
      routeGroup: 'ucp_discovery',
      statusCode: 429,
      decision: 'rate_limited',
      reasonCode: 'rate_limit_exceeded',
      principal: {
        keyId: 'limited-key',
        ownerPrincipal: 'rate-limited-app-test'
      },
      metadata: {
        rateLimitRemaining: 0,
        rateLimitResetAt: '2025-01-01T00:01:00.000Z'
      }
    })
  })

  it('rejects unsupported public commerce content types before route parsing', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/catalog/search', {
        method: 'POST',
        headers: {
          'content-type': 'text/plain',
          'x-request-id': 'public-commerce-content-type-req'
        },
        body: 'query=iphone'
      })
    )

    expect(response.status).toBe(415)
    const body = (await response.json()) as Record<string, any>
    expect(body.error).toEqual({
      code: 'unsupported_media_type',
      message: 'This endpoint requires an application/json request body.',
      requestId: 'public-commerce-content-type-req'
    })
  })

  it('rejects oversized public commerce requests before route parsing', async () => {
    const response = await app.handle(
      new Request('http://localhost/v1/catalog/search', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': '2097152',
          'x-request-id': 'public-commerce-size-req'
        },
        body: '{}'
      })
    )

    expect(response.status).toBe(413)
    const body = (await response.json()) as Record<string, any>
    expect(body.error).toEqual({
      code: 'payload_too_large',
      message: 'The request body exceeds the configured size limit.',
      requestId: 'public-commerce-size-req'
    })
  })

  it('rate-limits public commerce routes before connector work', async () => {
    const response = await publicRateLimitedApp.handle(
      jsonRequest('/v1/catalog/search', {
        query: 'iphone'
      }, {
        'x-request-id': 'public-rate-limit-test'
      })
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('45')
    expect(response.headers.get('x-ratelimit-limit')).toBe('5')
    expect(response.headers.get('x-ratelimit-remaining')).toBe('0')
    expect(response.headers.get('x-ratelimit-reset')).toBe('2025-01-01T00:01:00.000Z')
    const body = (await response.json()) as Record<string, any>
    expect(body.error.code).toBe('rate_limit_exceeded')
  })

  it('keys public commerce limits to verified shopper identity and ignores caller-controlled token rotation', async () => {
    const signingSecret = 'test-shopper-session-signing-secret-with-at-least-32-characters'
    const sessionId = 'shopper_11111111-2222-4333-8444-555555555555'
    const identities: string[] = []
    const identityApp = buildApp(new Elysia(), {
      agentSessionSigningSecret: signingSecret,
      rateLimitPublicRequest: async ({ identityKey }) => {
        identities.push(identityKey)
        return {
          allowed: false,
          status: 429,
          reasonCode: 'rate_limit_exceeded',
          retryAfterSeconds: 1,
          limit: 1,
          remaining: 0,
          resetAt: '2026-09-04T00:00:01.000Z',
          body: {
            error: {
              code: 'rate_limit_exceeded',
              message: 'Test rate limit.',
              requestId: 'identity-test'
            }
          }
        }
      }
    })
    const firstToken = issueShopperSessionToken({
      signingSecret,
      sessionId,
      now: new Date(Date.now() - 2_000)
    }).token
    const rotatedToken = issueShopperSessionToken({
      signingSecret,
      sessionId,
      now: new Date(Date.now() - 1_000)
    }).token

    await identityApp.handle(jsonRequest('/v1/catalog/search', { query: 'phone' }, {
      'user-agent': 'Arro iOS',
      'x-arro-shopper-session': firstToken,
      'x-forwarded-for': '203.0.113.10'
    }))
    await identityApp.handle(jsonRequest('/v1/catalog/search', { query: 'phone' }, {
      'user-agent': 'Arro Android',
      'x-arro-shopper-session': rotatedToken,
      'x-forwarded-for': '203.0.113.10'
    }))

    expect(identities).toHaveLength(2)
    expect(identities[0]).toMatch(/^shopper:/)
    expect(identities[1]).toBe(identities[0])
  })

  it('falls invalid shopper credentials back to one network rate-limit identity', async () => {
    const identities: string[] = []
    const identityApp = buildApp(new Elysia(), {
      agentSessionSigningSecret: 'test-shopper-session-signing-secret-with-at-least-32-characters',
      rateLimitPublicRequest: async ({ identityKey }) => {
        identities.push(identityKey)
        return {
          allowed: false,
          status: 429,
          reasonCode: 'rate_limit_exceeded',
          retryAfterSeconds: 1,
          limit: 1,
          remaining: 0,
          resetAt: '2026-09-04T00:00:01.000Z',
          body: {
            error: {
              code: 'rate_limit_exceeded',
              message: 'Test rate limit.',
              requestId: 'identity-test'
            }
          }
        }
      }
    })

    await identityApp.handle(jsonRequest('/v1/catalog/search', { query: 'phone' }, {
      'user-agent': 'Rotating Client One',
      'x-arro-shopper-session': 'arro_ss1.invalid.one',
      'x-forwarded-for': '203.0.113.20'
    }))
    await identityApp.handle(jsonRequest('/v1/catalog/search', { query: 'phone' }, {
      'user-agent': 'Rotating Client Two',
      'x-arro-shopper-session': 'arro_ss1.invalid.two',
      'x-forwarded-for': '203.0.113.20'
    }))

    expect(identities).toHaveLength(2)
    expect(identities[0]).toMatch(/^network:/)
    expect(identities[1]).toBe(identities[0])
  })

  it('audits protected discovery auth decisions without request body data', async () => {
    auditedEvents.length = 0

    const deniedResponse = await auditedApp.handle(
      jsonRequest('/v1/ucp/discover', { domain: 'example.com' }, { 'x-api-key': 'wrong-scope' })
    )
    const allowedValidationResponse = await auditedApp.handle(
      jsonRequest('/v1/ucp/discover', { domain: 'localhost' }, { 'x-api-key': 'valid-scope' })
    )

    expect(deniedResponse.status).toBe(403)
    expect(allowedValidationResponse.status).toBe(422)
    expect(auditedEvents).toHaveLength(2)
    expect(auditedEvents[0]).toMatchObject({
      routeGroup: 'ucp_discovery',
      statusCode: 403,
      decision: 'insufficient_scope',
      reasonCode: 'insufficient_scope',
      requiredScopes: ['discovery:write']
    })
    expect(auditedEvents[1]).toMatchObject({
      routeGroup: 'ucp_discovery',
      statusCode: 422,
      decision: 'allowed',
      reasonCode: 'validation_failed',
      principal: {
        keyId: 'audit-key',
        ownerPrincipal: 'audit-app-test'
      }
    })
    expect(JSON.stringify(auditedEvents)).not.toContain('localhost')
  })

  it('persists non-authoritative discovery observations after successful protected discovery', async () => {
    discoveryPersistenceCalls.length = 0
    discoveryAuditEvents.length = 0

    const response = await discoveryInjectedApp.handle(
      jsonRequest('/v1/ucp/discover', { domain: 'example.com' })
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, any>
    expect(ucpDiscoveryValidator.Check(body)).toBe(true)
    expect(body.status).toBe('fetched')
    expect(discoveryPersistenceCalls).toHaveLength(1)
    expect(discoveryPersistenceCalls[0]).toMatchObject({
      principal: {
        keyId: 'discovery-key',
        ownerPrincipal: 'discovery-app-test'
      },
      discoveryResponse: {
        domain: 'example.com',
        profile: {
          profileHash: 'sha256:app-discovery-profile'
        }
      }
    })
    expect(discoveryAuditEvents).toHaveLength(1)
    expect(discoveryAuditEvents[0]).toMatchObject({
      routeGroup: 'ucp_discovery',
      statusCode: 200,
      decision: 'allowed',
      reasonCode: 'discovery_fetched',
      metadata: {
        discoveryObservationId: '4242',
        discoveryBusinessId: 'direct-ucp-example',
        discoveryCreatedBusiness: true,
        discoveryCapabilitiesUpserted: 1,
        discoveryEvidenceInserted: true,
        discoveryStatus: 'fetched',
        accessPolicyState: 'profile_fetched',
        profileHash: 'sha256:app-discovery-profile',
        capabilityCount: 1
      }
    })
  })

  it('requires admin scope for source governance routes and audits the rejection', async () => {
    adminAuditEvents.length = 0

    const response = await adminApp.handle(
      new Request('http://localhost/v1/admin/businesses', {
        headers: {
          'x-api-key': 'search-key'
        }
      })
    )

    expect(response.status).toBe(403)

    const body = (await response.json()) as Record<string, any>
    expect(body.error.code).toBe('insufficient_scope')
    expect(adminAuditEvents).toHaveLength(1)
    expect(adminAuditEvents[0]).toMatchObject({
      routeGroup: 'admin_businesses',
      statusCode: 403,
      decision: 'insufficient_scope',
      reasonCode: 'insufficient_scope',
      requiredScopes: ['admin:*'],
      principal: {
        keyId: 'search-key',
        ownerPrincipal: 'search-app-test'
      }
    })
  })

  it('lists admin source candidates with schema-backed filters', async () => {
    adminAuditEvents.length = 0
    listAdminBusinessesMock.mockClear()

    const response = await adminApp.handle(
      new Request('http://localhost/v1/admin/businesses?accessPolicyState=profile_fetched&domain=allbirds', {
        headers: {
          'x-api-key': 'admin-key',
          'x-request-id': 'admin-list-request'
        }
      })
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, any>
    expect(targetBusinessAdminListValidator.Check(body)).toBe(true)
    expect(body.requestId).toBe('admin-list-request')
    expect(body.filters).toEqual({
      domain: 'allbirds',
      accessPolicyState: 'profile_fetched'
    })
    expect(body.records[0].businessId).toBe('allbirds-public-ucp-candidate')
    expect(listAdminBusinessesMock).toHaveBeenCalledWith(expect.objectContaining({
      filters: {
        domain: 'allbirds',
        accessPolicyState: 'profile_fetched'
      }
    }))
    expect(adminAuditEvents[0]).toMatchObject({
      routeGroup: 'admin_businesses',
      statusCode: 200,
      reasonCode: 'admin_businesses_listed',
      metadata: {
        recordCount: 1,
        filters: {
          domain: 'allbirds',
          accessPolicyState: 'profile_fetched'
        }
      }
    })
  })

  it('returns admin source detail without granting authority', async () => {
    adminAuditEvents.length = 0
    getAdminBusinessDetailMock.mockClear()

    const response = await adminApp.handle(
      new Request('http://localhost/v1/admin/businesses/allbirds-public-ucp-candidate', {
        headers: {
          'x-api-key': 'admin-key'
        }
      })
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, any>
    expect(targetBusinessAdminDetailValidator.Check(body)).toBe(true)
    expect(body.record.businessId).toBe('allbirds-public-ucp-candidate')
    expect(body.record.featureVisibility).not.toBe('catalog_visible')
    expect(body.record.accessPolicyState).not.toBe('approved')
    expect(getAdminBusinessDetailMock).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'allbirds-public-ucp-candidate'
    }))
  })

  it('records admin conformance runs and audits bounded metadata', async () => {
    adminAuditEvents.length = 0
    runAdminConformanceMock.mockClear()

    const response = await adminApp.handle(
      jsonRequest(
        '/v1/admin/businesses/allbirds-public-ucp-candidate/conformance',
        {
          runMode: 'live',
          linkedDiscoveryObservationId: '4242',
          reviewerSummary: 'App test conformance run.',
          metadata: {
            verifier: 'app-test',
            secretToken: 'must-not-be-audited'
          }
        },
        {
          'x-api-key': 'admin-key',
          'x-request-id': 'admin-conformance-request'
        }
      )
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, any>
    expect(targetBusinessConformanceRunValidator.Check(body)).toBe(true)
    expect(body.run.businessId).toBe('allbirds-public-ucp-candidate')
    expect(body.run.runStatus).toBe('passed')
    expect(body.run.failureClassification).toBe('none')
    expect(runAdminConformanceMock).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'allbirds-public-ucp-candidate',
      principal: expect.objectContaining({ keyId: 'admin-key' }),
      request: expect.objectContaining({
        runMode: 'live',
        linkedDiscoveryObservationId: '4242'
      })
    }))
    expect(adminAuditEvents[0]).toMatchObject({
      routeGroup: 'admin_conformance',
      statusCode: 200,
      reasonCode: 'conformance_passed',
      metadata: {
        businessId: 'allbirds-public-ucp-candidate',
        conformanceRunId: '77',
        runMode: 'live',
        runStatus: 'passed',
        checksPassed: 8,
        checksFailed: 0,
        failureClassification: 'none'
      }
    })
    expect(JSON.stringify(adminAuditEvents)).not.toContain('must-not-be-audited')
  })

  it('lists admin conformance runs without granting authority', async () => {
    adminAuditEvents.length = 0
    listAdminConformanceRunsMock.mockClear()

    const response = await adminApp.handle(
      new Request('http://localhost/v1/admin/businesses/allbirds-public-ucp-candidate/conformance', {
        headers: {
          'x-api-key': 'admin-key'
        }
      })
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, any>
    expect(targetBusinessConformanceListValidator.Check(body)).toBe(true)
    expect(body.businessId).toBe('allbirds-public-ucp-candidate')
    expect(body.runs[0].runStatus).toBe('passed')
    expect(listAdminConformanceRunsMock).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'allbirds-public-ucp-candidate'
    }))
    expect(adminAuditEvents[0]).toMatchObject({
      routeGroup: 'admin_conformance',
      statusCode: 200,
      reasonCode: 'admin_conformance_runs_listed',
      metadata: {
        businessId: 'allbirds-public-ucp-candidate',
        runCount: 1
      }
    })
  })

  it('records safe admin source transitions and audits transition metadata', async () => {
    adminAuditEvents.length = 0
    transitionAdminBusinessMock.mockClear()

    const response = await adminApp.handle(
      jsonRequest(
        '/v1/admin/businesses/allbirds-public-ucp-candidate',
        {
          nextLaunchStatus: 'blocked',
          reasonCode: 'policy_block',
          reviewerNote: 'Policy review blocked source exposure.',
          metadata: {
            verifier: 'app-test',
            secretToken: 'must-not-be-audited'
          }
        },
        {
          'x-api-key': 'admin-key',
          'x-request-id': 'admin-transition-request'
        },
        'PATCH'
      )
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, any>
    expect(targetBusinessAdminTransitionValidator.Check(body)).toBe(true)
    expect(body.record.launchStatus).toBe('blocked')
    expect(body.record.featureVisibility).toBe('hidden')
    expect(body.record.accessPolicyState).not.toBe('approved')
    expect(body.transition.reasonCode).toBe('policy_block')
    expect(transitionAdminBusinessMock).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 'allbirds-public-ucp-candidate',
      principal: expect.objectContaining({ keyId: 'admin-key' }),
      transition: expect.objectContaining({
        nextLaunchStatus: 'blocked',
        reasonCode: 'policy_block'
      })
    }))
    expect(adminAuditEvents[0]).toMatchObject({
      routeGroup: 'admin_businesses',
      statusCode: 200,
      reasonCode: 'admin_business_transition_recorded',
      metadata: {
        businessId: 'allbirds-public-ucp-candidate',
        transitionId: '1',
        nextLaunchStatus: 'blocked',
        nextFeatureVisibility: 'hidden',
        nextAccessPolicyState: 'profile_fetched',
        transitionReasonCode: 'policy_block'
      }
    })
    expect(JSON.stringify(adminAuditEvents)).not.toContain('must-not-be-audited')
  })

  it('rejects approval-style admin transitions until conformance gates exist', async () => {
    adminAuditEvents.length = 0

    const response = await adminApp.handle(
      jsonRequest(
        '/v1/admin/businesses/allbirds-public-ucp-candidate',
        {
          nextLaunchStatus: 'launch_visible',
          reasonCode: 'conformance_required'
        },
        {
          'x-api-key': 'admin-key'
        },
        'PATCH'
      )
    )

    expect(response.status).toBe(409)

    const body = (await response.json()) as Record<string, any>
    expect(body.error.code).toBe('conformance_required')
    expect(adminAuditEvents[0]).toMatchObject({
      routeGroup: 'admin_businesses',
      statusCode: 409,
      reasonCode: 'conformance_required',
      metadata: {
        businessId: 'allbirds-public-ucp-candidate'
      }
    })
  })

  it('returns unavailable catalog search when no real sources are configured', async () => {
    searchAuditEvents.length = 0
    const response = await app.handle(
      jsonRequest(
        '/v1/catalog/search',
        {
          query: 'iphone',
          context: {
            locale: 'en-US',
            region: 'US',
            currency: 'USD',
            channel: 'web',
            requestedQuantity: 1
          }
        },
        {
          'x-request-id': 'catalog-req'
        }
      )
    )

    expect(response.status).toBe(200)

    const body = (await response.json()) as Record<string, any>
    expect(catalogSearchValidator.Check(body)).toBe(true)
    expect(body.requestId).toBe('catalog-req')
    expect(body.sourceMode).toBe('unconfigured')
    expect(body.state).toBe('unavailable')
    expect(body.interpretedQuery.detectedBrands).toContain('Apple')
    expect(body.interpretedQuery.detectedCategories).toContain('Smartphones')
    expect(body.items).toEqual([])
    expect(body.messages.some((message: any) => message.code === 'connectors_not_configured')).toBe(true)
  })

  it('records bounded search audit metadata for valid public search decisions', async () => {
    searchAuditEvents.length = 0

    const response = await searchAuditedApp.handle(
      jsonRequest(
        '/v1/catalog/search',
        {
          query: 'iphone',
          context: {
            locale: 'en-US',
            region: 'US',
            currency: 'USD',
            channel: 'web'
          }
        },
        {
          'x-request-id': 'catalog-audit-req'
        }
      )
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>

    expect(catalogSearchValidator.Check(body)).toBe(true)
    expect(searchAuditEvents).toHaveLength(1)
    expect(searchAuditEvents[0]).toMatchObject({
      requestId: 'catalog-audit-req',
      route: '/v1/catalog/search',
      normalizedQuery: 'iphone',
      sourcePolicy: {
        sourceMode: 'unconfigured',
        message: {
          code: 'connectors_not_configured'
        }
      },
      response: {
        sourceMode: 'unconfigured',
        state: 'unavailable'
      },
      metadata: {
        commercialIsolationVersion: 'search-v1-no-commercial-inputs'
      }
    })
    expect(JSON.stringify(searchAuditEvents)).not.toContain('commission')
    expect(JSON.stringify(searchAuditEvents)).not.toContain('payout')
  })

  it('returns validated approved-source catalog products through the API route', async () => {
    approvedCatalogSearchAuditEvents.length = 0

    const response = await approvedCatalogSearchApp.handle(
      jsonRequest(
        '/v1/catalog/search',
        {
          query: 'iphone mobile',
          context: {
            locale: 'en-US',
            region: 'US',
            currency: 'USD',
            channel: 'web'
          },
          agentContext: {
            integrationId: 'chatgpt-demo',
            surface: 'chatgpt',
            requestedActionScope: 'read:search',
            externalSubjectRef: 'opaque-user-ref-1',
            externalTaskRef: 'opaque-task-ref-1',
            hostCapabilities: [
              'source_labels',
              'freshness',
              'caveats',
              'no_buy_warnings',
              'commercial_disclosures',
              'authority_limits',
              'allowed_next_actions'
            ]
          }
        },
        {
          'x-request-id': 'approved-catalog-search-req'
        }
      )
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>

    expect(catalogSearchValidator.Check(body)).toBe(true)
    expect(body.sourceMode).toBe('approved_sources')
    expect(body.state).toBe('ready')
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      productId: 'approved-iphone-16-pro',
      businessId: 'approved-electronics',
      sourceLabel: {
        sourceId: 'approved-electronics',
        factType: 'approved_catalog_product'
      }
    })
    expect(body.actionPolicy).toMatchObject({
      state: 'read',
      allowedNextActions: [
        {
          action: 'get_product_detail',
          authority: 'allowed',
          requiredActionScope: 'read:product_detail'
        },
        {
          action: 'compare_products',
          authority: 'allowed',
          requiredActionScope: 'read:compare'
        },
        {
          action: 'prepare_purchase',
          authority: 'allowed'
        }
      ]
    })
    expect(body.messages.map((message: any) => message.code)).toEqual([
      'approved_catalog_sources',
      'connector_catalog_fetched'
    ])
    expect(approvedCatalogSearchAuditEvents).toHaveLength(1)
    expect(approvedCatalogSearchAuditEvents[0]).toMatchObject({
      requestId: 'approved-catalog-search-req',
      normalizedQuery: 'iphone mobile',
      sourcePolicy: {
        sourceMode: 'approved_sources',
        allowedBusinessIds: ['approved-electronics']
      },
      response: {
        sourceMode: 'approved_sources',
        state: 'ready'
      },
      metadata: {
        agentInvocation: {
          integrationId: 'chatgpt-demo',
          surface: 'chatgpt',
          requestedActionScope: 'read:search',
          hostCapabilities: [
            'source_labels',
            'freshness',
            'caveats',
            'no_buy_warnings',
            'commercial_disclosures',
            'authority_limits',
            'allowed_next_actions'
          ],
          hasExternalSubjectRef: true,
          hasExternalTaskRef: true
        },
        connectorCatalogFetch: {
          summary: {
            requestedSourceCount: 1,
            fetchedSourceCount: 1,
            resultProductCount: 1
          },
          fetchResults: [
            {
              sourceId: 'approved-electronics',
              status: 'fetched',
              latencyMs: 14
            }
          ]
        }
      }
    })
    expect(JSON.stringify(approvedCatalogSearchAuditEvents[0].metadata)).not.toContain('opaque-user-ref-1')
    expect(JSON.stringify(approvedCatalogSearchAuditEvents[0].metadata)).not.toContain('opaque-task-ref-1')
    expect(JSON.stringify(body)).not.toMatch(/commission|payout|affiliate|settlement|margin/i)
  })

  it('returns connected-source catalog products without internal catalog approval records', async () => {
    connectedCatalogSearchAuditEvents.length = 0
    connectedCatalogSearchRequests.length = 0

    const response = await connectedCatalogSearchApp.handle(
      jsonRequest(
        '/v1/catalog/search',
        {
          query: 'iphone mobile',
          context: {
            locale: 'en-US',
            region: 'US',
            currency: 'USD',
            channel: 'agent'
          }
        },
        {
          'x-request-id': 'connected-catalog-search-req'
        }
      )
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>

    expect(catalogSearchValidator.Check(body)).toBe(true)
    expect(body.sourceMode).toBe('connected_sources')
    expect(body.state).toBe('ready')
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({
      productId: 'connected-iphone-16-pro',
      businessId: 'connected-shopify-storefront',
      sourceLabel: {
        sourceId: 'connected-shopify-storefront',
        factType: 'connected_catalog_product'
      }
    })
    expect(body.messages.map((message: any) => message.code)).toEqual([
      'connected_catalog_sources',
      'connected_catalog_fetched'
    ])
    expect(connectedCatalogSearchRequests).toHaveLength(1)
    expect(connectedCatalogSearchRequests[0].intent).toMatchObject({
      brands: ['Apple'],
      categories: expect.arrayContaining(['Smartphones']),
      productTypes: expect.arrayContaining(['smartphone'])
    })
    expect(connectedCatalogSearchAuditEvents).toHaveLength(1)
    expect(connectedCatalogSearchAuditEvents[0]).toMatchObject({
      requestId: 'connected-catalog-search-req',
      normalizedQuery: 'iphone mobile',
      sourcePolicy: {
        sourceMode: 'connected_sources',
        allowedBusinessIds: ['connected-shopify-storefront']
      },
      response: {
        sourceMode: 'connected_sources',
        state: 'ready'
      },
      metadata: {
        hasStructuredSearchIntent: false,
        connectorSearchIntentKeys: expect.arrayContaining([
          'brands',
          'categories',
          'productTypes'
        ]),
        connectorCatalogFetch: {
          summary: {
            requestedSourceCount: 1,
            fetchedSourceCount: 1,
            resultProductCount: 1
          },
          fetchResults: [
            {
              sourceId: 'connected-shopify-storefront',
              status: 'fetched',
              latencyMs: 11
            }
          ]
        }
      }
    })
    expect(JSON.stringify(body)).not.toMatch(/commission|payout|affiliate|settlement|margin/i)
  })

  it('returns connector-backed product detail for connected-source products', async () => {
    connectedCatalogProductDetailAuditEvents.length = 0
    const response = await connectedCatalogSearchApp.handle(
      jsonRequest(
        '/v1/catalog/product',
        {
          businessId: connectedCatalogSource.businessId,
          productId: connectedCatalogProduct.productId,
          variantId: connectedCatalogProduct.variantId,
          context: {
            locale: 'en-US',
            region: 'US',
            currency: 'USD',
            channel: 'web'
          },
          agentContext: {
            integrationId: 'test-product-detail-integration',
            surface: 'direct_http',
            requestedActionScope: 'read:product_detail',
            externalSubjectRef: 'opaque-product-detail-user-ref',
            externalTaskRef: 'opaque-product-detail-task-ref',
            hostCapabilities: [
              'source_labels',
              'freshness',
              'caveats',
              'no_buy_warnings',
              'commercial_disclosures',
              'authority_limits',
              'allowed_next_actions'
            ]
          }
        },
        {
          'x-request-id': 'connected-catalog-product-detail-req'
        }
      )
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>

    expect(catalogProductDetailValidator.Check(body)).toBe(true)
    expect(body.requestId).toBe('connected-catalog-product-detail-req')
    expect(body.sourceMode).toBe('connected_sources')
    expect(body.state).toBe('ready')
    expect(body.product).toMatchObject({
      productId: connectedCatalogProduct.productId,
      variantId: connectedCatalogProduct.variantId,
      businessId: connectedCatalogSource.businessId,
      title: connectedCatalogProduct.title,
      media: [
        {
          type: 'image',
          url: 'https://connected-shop.myshopify.com/images/iphone-16-pro.jpg'
        }
      ],
      options: [{ name: 'Storage', values: [{ label: '256GB' }] }],
      variants: [
        expect.objectContaining({
          variantId: connectedCatalogProduct.variantId,
          availability: 'in_stock'
        })
      ],
      sourceLabel: {
        sourceId: connectedCatalogSource.businessId,
        factType: 'connected_catalog_product_detail'
      }
    })
    expect(body.actionPolicy).toMatchObject({
      state: 'read',
      allowedNextActions: [
        {
          action: 'prepare_purchase',
          authority: 'allowed',
          requiredActionScope: 'write:purchase'
        }
      ]
    })
    expect(body.messages.map((message: any) => message.code)).toEqual([
      'connected_catalog_sources',
      'connected_catalog_product_detail_fetched'
    ])
    expect(connectedCatalogProductDetailAuditEvents).toHaveLength(1)
    expect(connectedCatalogProductDetailAuditEvents[0]).toMatchObject({
      requestId: 'connected-catalog-product-detail-req',
      correlationId: 'connected-catalog-product-detail-req',
      route: '/v1/catalog/product',
      request: {
        businessId: connectedCatalogSource.businessId,
        productId: connectedCatalogProduct.productId,
        variantId: connectedCatalogProduct.variantId
      },
      sourcePolicy: {
        sourceMode: 'connected_sources',
        allowedBusinessIds: [connectedCatalogSource.businessId]
      },
      response: {
        sourceMode: 'connected_sources',
        state: 'ready',
        product: {
          productId: connectedCatalogProduct.productId,
          sourceLabel: {
            factType: 'connected_catalog_product_detail'
          }
        }
      },
      metadata: {
        hasVariantId: true,
        detailFetch: {
          sourceId: connectedCatalogSource.businessId,
          status: 'fetched',
          latencyMs: 9,
          messageCodes: ['connected_catalog_product_detail_fetched']
        },
        agentInvocation: {
          integrationId: 'test-product-detail-integration',
          surface: 'direct_http',
          requestedActionScope: 'read:product_detail',
          hasExternalSubjectRef: true,
          hasExternalTaskRef: true
        }
      }
    })
    expect(JSON.stringify(connectedCatalogProductDetailAuditEvents[0].metadata)).not.toContain('opaque-product-detail-user-ref')
    expect(JSON.stringify(connectedCatalogProductDetailAuditEvents[0].metadata)).not.toContain('opaque-product-detail-task-ref')
    expect(JSON.stringify(body)).not.toMatch(/commission|payout|affiliate|settlement|margin/i)
  })

  it('keeps configurable product detail readable until the shopper selection is source-confirmed', async () => {
    const configurableDetail: CatalogProductDetail = {
      ...connectedCatalogProductDetail,
      options: [
        {
          name: 'Storage',
          values: [
            { label: '256GB', available: true, exists: true },
            { label: '512GB', available: true, exists: true }
          ]
        }
      ],
      selected: [{ name: 'Storage', label: '256GB' }],
      variants: [
        connectedCatalogProductDetail.variants[0]!,
        {
          ...connectedCatalogProductDetail.variants[0]!,
          variantId: 'connected-iphone-16-pro-512gb',
          title: '512GB',
          selectedOptions: [{ name: 'Storage', label: '512GB' }]
        }
      ]
    }

    const configurableApp = buildApp(new Elysia(), {
      loadTargetBusinessRecords: async () => [],
      connectedCatalogSources: [connectedCatalogSource],
      catalogProductDetailFetcher: async ({ source, detailRequest }) => {
        const selectedStorage = detailRequest.selected?.find((selection) => selection.name === 'Storage')
        return {
          sourceId: source.businessId,
          sourceName: source.displayName,
          status: 'fetched' as const,
          product: selectedStorage
            ? { ...configurableDetail, selected: [{ name: 'Storage', label: selectedStorage.label }] }
            : configurableDetail,
          fetchedAt: '2026-06-01T00:00:00.000Z',
          latencyMs: 9,
          messages: [
            {
              severity: 'info' as const,
              code: 'connected_catalog_product_detail_fetched',
              text: 'Connected catalog product detail was fetched and validated.'
            }
          ]
        }
      },
      recordProductDetailAudit: async () => ({ recorded: true })
    })

    const unresolvedResponse = await configurableApp.handle(jsonRequest('/v1/catalog/product', {
      businessId: connectedCatalogSource.businessId,
      productId: connectedCatalogProduct.productId
    }))
    const unresolved = (await unresolvedResponse.json()) as Record<string, any>

    expect(unresolvedResponse.status).toBe(200)
    expect(unresolved.state).toBe('limited')
    expect(unresolved.messages.map((message: any) => message.code)).toContain('product_variant_ambiguous')
    expect(unresolved.actionPolicy.allowedNextActions).toEqual([
      expect.objectContaining({ action: 'get_product_detail', authority: 'allowed' })
    ])

    const resolvedResponse = await configurableApp.handle(jsonRequest('/v1/catalog/product', {
      businessId: connectedCatalogSource.businessId,
      productId: connectedCatalogProduct.productId,
      selected: [{ name: 'Storage', label: '512GB' }]
    }))
    const resolved = (await resolvedResponse.json()) as Record<string, any>

    expect(resolvedResponse.status).toBe(200)
    expect(resolved.state).toBe('ready')
    expect(resolved.product.selected).toEqual([{ name: 'Storage', label: '512GB' }])
    expect(resolved.actionPolicy.allowedNextActions).toEqual([
      expect.objectContaining({ action: 'prepare_purchase', authority: 'allowed' })
    ])
  })

  it('fails closed when connector-backed product detail audit persistence is unavailable', async () => {
    const auditUnavailableApp = buildApp(new Elysia(), {
      loadTargetBusinessRecords: async () => [],
      connectedCatalogSources: [connectedCatalogSource],
      catalogProductDetailFetcher: async ({ source }) => ({
        sourceId: source.businessId,
        sourceName: source.displayName,
        status: 'fetched',
        product: connectedCatalogProductDetail,
        fetchedAt: '2026-06-01T00:00:00.000Z',
        latencyMs: 9,
        messages: [
          {
            severity: 'info' as const,
            code: 'connected_catalog_product_detail_fetched',
            text: 'Connected catalog product detail was fetched and validated.'
          }
        ]
      }),
      recordProductDetailAudit: async () => ({
        recorded: false,
        reasonCode: 'write_failed'
      })
    })

    const response = await auditUnavailableApp.handle(
      jsonRequest(
        '/v1/catalog/product',
        {
          businessId: connectedCatalogSource.businessId,
          productId: connectedCatalogProduct.productId,
          variantId: connectedCatalogProduct.variantId
        },
        {
          'x-request-id': 'connected-product-detail-audit-unavailable'
        }
      )
    )
    const body = (await response.json()) as Record<string, any>

    expect(response.status).toBe(503)
    expect(body.error).toEqual({
      code: 'product_detail_audit_unavailable',
      message: 'Connector-backed product detail is unavailable because product-detail audit persistence is not available.',
      requestId: 'connected-product-detail-audit-unavailable'
    })
  })

  it('fails closed when product detail source is not connector-backed', async () => {
    const response = await app.handle(
      jsonRequest(
        '/v1/catalog/product',
        {
          businessId: 'missing-source',
          productId: 'missing-product'
        },
        {
          'x-request-id': 'unconfigured-catalog-product-detail-req'
        }
      )
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>

    expect(catalogProductDetailValidator.Check(body)).toBe(true)
    expect(body.requestId).toBe('unconfigured-catalog-product-detail-req')
    expect(body.sourceMode).toBe('unconfigured')
    expect(body.state).toBe('unavailable')
    expect(body.product).toBeUndefined()
    expect(body.messages.map((message: any) => message.code)).toEqual([
      'connectors_not_configured',
      'catalog_product_detail_source_unavailable'
    ])
  })

  it('propagates the request timeout signal to approved-source catalog fetchers', async () => {
    const signalAuditEvents: any[] = []
    let observedSignal: AbortSignal | undefined
    const signalApp = buildApp(new Elysia(), {
      requestTimeoutMs: 1000,
      loadTargetBusinessRecords: async () => [approvedCatalogSearchRecord],
      catalogProductFetcher: async ({ source, signal }) => {
        observedSignal = signal

        return {
          sourceId: source.businessId,
          sourceName: source.displayName,
          status: 'fetched',
          products: [approvedCatalogSearchProduct],
          fetchedAt: '2026-06-01T00:00:00.000Z',
          latencyMs: 2,
          messages: []
        }
      },
      recordSearchAudit: async (event) => {
        signalAuditEvents.push(event)
        return { recorded: true }
      }
    })

    const response = await signalApp.handle(
      jsonRequest('/v1/catalog/search', {
        query: 'iphone mobile',
        context: {
          locale: 'en-US',
          region: 'US',
          currency: 'USD',
          channel: 'web'
        }
      })
    )

    expect(response.status).toBe(200)
    expect(observedSignal).toBeDefined()
    expect(observedSignal?.aborted).toBe(false)
    expect(signalAuditEvents).toHaveLength(1)
  })

  it('returns a bounded 504 when catalog search exceeds the route timeout budget', async () => {
    const timeoutAuditEvents: any[] = []
    let observedSignal: AbortSignal | undefined

    const timeoutApp = buildApp(new Elysia(), {
      requestTimeoutMs: 25,
      connectorTimeoutMs: 1000,
      loadTargetBusinessRecords: async () => [approvedCatalogSearchRecord],
      catalogProductFetcher: async ({ signal }) => {
        observedSignal = signal
        return new Promise(() => undefined)
      },
      recordSearchAudit: async (event) => {
        timeoutAuditEvents.push(event)
        return { recorded: true }
      }
    })

    const response = await timeoutApp.handle(
      jsonRequest(
        '/v1/catalog/search',
        {
          query: 'iphone mobile',
          context: {
            locale: 'en-US',
            region: 'US',
            currency: 'USD',
            channel: 'web'
          }
        },
        {
          'x-request-id': 'route-timeout-search-request'
        }
      )
    )

    expect(response.status).toBe(504)
    expect(response.headers.get('x-request-id')).toBe('route-timeout-search-request')
    expect((await response.json() as Record<string, any>).error.code).toBe('request_timeout')
    expect(observedSignal?.aborted).toBe(true)
    expect(timeoutAuditEvents).toHaveLength(0)
  })

  it('marks connector-backed search limited when source fan-out budget skips eligible sources', async () => {
    const budgetAuditEvents: any[] = []
    const startedSources: string[] = []
    const budgetApp = buildApp(new Elysia(), {
      catalogConnectorMaxSourcesPerRequest: 1,
      catalogConnectorMaxConcurrencyPerRequest: 1,
      loadTargetBusinessRecords: async () => [
        approvedCatalogSearchRecord,
        approvedCatalogSecondRecord
      ],
      catalogProductFetcher: async ({ source }) => {
        startedSources.push(source.businessId)
        return {
          sourceId: source.businessId,
          sourceName: source.displayName,
          status: 'fetched',
          products: [approvedCatalogSearchProduct],
          fetchedAt: '2026-06-01T00:00:00.000Z',
          latencyMs: 1,
          messages: []
        }
      },
      recordSearchAudit: async (event) => {
        budgetAuditEvents.push(event)
        return { recorded: true }
      }
    })

    const response = await budgetApp.handle(
      jsonRequest('/v1/catalog/search', {
        query: 'iphone mobile',
        context: {
          locale: 'en-US',
          region: 'US',
          currency: 'USD',
          channel: 'web'
        }
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>

    expect(catalogSearchValidator.Check(body)).toBe(true)
    expect(startedSources).toEqual(['approved-electronics'])
    expect(body.state).toBe('limited')
    expect(body.messages.map((message: any) => message.code)).toContain('connector_catalog_source_budget_limited')
    expect(budgetAuditEvents[0].metadata.connectorCatalogFetch.summary).toMatchObject({
      requestedSourceCount: 2,
      dispatchedSourceCount: 1,
      skippedSourceCount: 1,
      fetchedSourceCount: 1,
      resultProductCount: 1
    })
  })

  it('returns partial approved-source results when one source times out', async () => {
    const partialAuditEvents: any[] = []
    const partialApp = buildApp(new Elysia(), {
      connectorTimeoutMs: 1,
      loadTargetBusinessRecords: async () => [
        approvedCatalogSearchRecord,
        approvedCatalogSecondRecord
      ],
      catalogProductFetcher: async ({ source }) => {
        if (source.businessId === 'approved-appliances') {
          return new Promise(() => undefined)
        }

        return {
          sourceId: source.businessId,
          sourceName: source.displayName,
          status: 'fetched',
          products: [approvedCatalogSearchProduct],
          fetchedAt: '2026-06-01T00:00:00.000Z',
          latencyMs: 1,
          messages: [
            {
              severity: 'info' as const,
              code: 'connector_catalog_fetched',
              text: 'Connector-backed catalog product facts were fetched and validated.'
            }
          ]
        }
      },
      recordSearchAudit: async (event) => {
        partialAuditEvents.push(event)
        return { recorded: true }
      }
    })

    const response = await partialApp.handle(
      jsonRequest('/v1/catalog/search', {
        query: 'iphone mobile',
        context: {
          locale: 'en-US',
          region: 'US',
          currency: 'USD',
          channel: 'web'
        }
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>

    expect(catalogSearchValidator.Check(body)).toBe(true)
    expect(body.sourceMode).toBe('approved_sources')
    expect(body.state).toBe('limited')
    expect(body.items).toHaveLength(1)
    expect(body.items[0].businessId).toBe('approved-electronics')
    expect(body.messages.map((message: any) => message.code)).toContain('connector_catalog_fetch_timeout')
    expect(body.messages.map((message: any) => message.code)).toContain('connector_catalog_partial_results')
    expect(partialAuditEvents[0].metadata.connectorCatalogFetch.summary).toMatchObject({
      requestedSourceCount: 2,
      fetchedSourceCount: 1,
      timeoutSourceCount: 1,
      resultProductCount: 1
    })
    expect(partialAuditEvents[0].metadata.connectorCatalogFetch.fetchResults).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceId: 'approved-electronics',
        status: 'fetched',
        latencyMs: 1
      }),
      expect.objectContaining({
        sourceId: 'approved-appliances',
        status: 'timeout'
      })
    ]))
    expect(JSON.stringify(partialAuditEvents)).not.toMatch(/commission|payout|affiliate|settlement|margin/i)
  })

  it('returns unavailable approved-source results when all approved sources time out', async () => {
    const timeoutAuditEvents: any[] = []
    const timeoutApp = buildApp(new Elysia(), {
      connectorTimeoutMs: 1,
      loadTargetBusinessRecords: async () => [approvedCatalogSearchRecord],
      catalogProductFetcher: async () => new Promise(() => undefined),
      recordSearchAudit: async (event) => {
        timeoutAuditEvents.push(event)
        return { recorded: true }
      }
    })

    const response = await timeoutApp.handle(
      jsonRequest('/v1/catalog/search', {
        query: 'iphone mobile',
        context: {
          locale: 'en-US',
          region: 'US',
          currency: 'USD',
          channel: 'web'
        }
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>

    expect(catalogSearchValidator.Check(body)).toBe(true)
    expect(body.sourceMode).toBe('approved_sources')
    expect(body.state).toBe('unavailable')
    expect(body.items).toEqual([])
    expect(body.messages.map((message: any) => message.code)).toContain('connector_catalog_sources_unavailable')
    expect(timeoutAuditEvents[0].metadata.connectorCatalogFetch.summary).toMatchObject({
      requestedSourceCount: 1,
      fetchedSourceCount: 0,
      timeoutSourceCount: 1,
      resultProductCount: 0
    })
    expect(timeoutAuditEvents[0].metadata.connectorCatalogFetch.fetchResults).toEqual([
      expect.objectContaining({
        sourceId: 'approved-electronics',
        status: 'timeout'
      })
    ])
  })

  it('rejects invalid approved-source products and audits validation status', async () => {
    const invalidAuditEvents: any[] = []
    const invalidApp = buildApp(new Elysia(), {
      loadTargetBusinessRecords: async () => [approvedCatalogSearchRecord],
      catalogProductFetcher: async ({ source }) => ({
        sourceId: source.businessId,
        sourceName: source.displayName,
        status: 'fetched',
        products: [
          {
            ...approvedCatalogSearchProduct,
            businessId: 'unapproved-source',
            sourceLabel: {
              ...approvedCatalogSearchProduct.sourceLabel,
              sourceId: 'unapproved-source'
            }
          }
        ],
        fetchedAt: '2026-06-01T00:00:00.000Z',
        latencyMs: 3,
        messages: []
      }),
      recordSearchAudit: async (event) => {
        invalidAuditEvents.push(event)
        return { recorded: true }
      }
    })

    const response = await invalidApp.handle(
      jsonRequest('/v1/catalog/search', {
        query: 'iphone mobile',
        context: {
          locale: 'en-US',
          region: 'US',
          currency: 'USD',
          channel: 'web'
        }
      })
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, any>

    expect(catalogSearchValidator.Check(body)).toBe(true)
    expect(body.sourceMode).toBe('approved_sources')
    expect(body.state).toBe('unavailable')
    expect(body.items).toEqual([])
    expect(body.messages.map((message: any) => message.code)).toContain('product_source_mismatch')
    expect(invalidAuditEvents[0].metadata.connectorCatalogFetch.summary).toMatchObject({
      requestedSourceCount: 1,
      fetchedSourceCount: 0,
      invalidResponseSourceCount: 1,
      resultProductCount: 0
    })
    expect(invalidAuditEvents[0].metadata.connectorCatalogFetch.fetchResults).toEqual([
      expect.objectContaining({
        sourceId: 'approved-electronics',
        status: 'invalid_response',
        latencyMs: 3,
        validationErrorCode: 'product_source_mismatch'
      })
    ])
  })

  it('returns an opaque continuation for a single cursor-capable catalog source', async () => {
    const observedSourceCursors: Array<string | undefined> = []
    const paginationApp = buildApp(new Elysia(), {
      loadTargetBusinessRecords: async () => [approvedCatalogSearchRecord],
      catalogProductFetcher: async ({ source, searchRequest }) => {
        const cursor = searchRequest.pagination?.cursor
        observedSourceCursors.push(cursor)
        return {
          sourceId: source.businessId,
          sourceName: source.displayName,
          status: 'fetched',
          products: [{
            ...approvedCatalogSearchProduct,
            productId: cursor ? 'approved-iphone-page-two' : 'approved-iphone-page-one'
          }],
          pagination: cursor
            ? { hasNextPage: false }
            : { cursor: 'source-page-two', hasNextPage: true },
          fetchedAt: '2026-06-01T00:00:00.000Z',
          latencyMs: 1,
          messages: []
        }
      },
      recordSearchAudit: async () => ({ recorded: true })
    })

    const firstResponse = await paginationApp.handle(
      jsonRequest('/v1/catalog/search', {
        query: 'iphone mobile',
        pagination: { limit: 20 }
      })
    )
    expect(firstResponse.status).toBe(200)
    const firstBody = (await firstResponse.json()) as Record<string, any>
    expect(catalogSearchValidator.Check(firstBody)).toBe(true)
    expect(firstBody.pageInfo.hasNextPage).toBe(true)
    expect(firstBody.pageInfo.nextCursor).toMatch(/^arro_c1\./)
    expect(firstBody.pageInfo.nextCursor).not.toContain('source-page-two')

    const secondResponse = await paginationApp.handle(
      jsonRequest('/v1/catalog/search', {
        query: 'iphone mobile',
        pagination: { limit: 20, cursor: firstBody.pageInfo.nextCursor }
      })
    )
    expect(secondResponse.status).toBe(200)
    const secondBody = (await secondResponse.json()) as Record<string, any>
    expect(catalogSearchValidator.Check(secondBody)).toBe(true)
    expect(secondBody.items[0]?.productId).toBe('approved-iphone-page-two')
    expect(secondBody.pageInfo).toEqual({ hasNextPage: false })
    expect(observedSourceCursors).toEqual([undefined, 'source-page-two'])
  })

  it('rejects raw or malformed catalog continuation cursors', async () => {
    const response = await app.handle(
      jsonRequest('/v1/catalog/search', {
        query: 'iphone mobile',
        pagination: { cursor: 'raw-upstream-cursor' }
      })
    )

    expect(response.status).toBe(422)
    const body = (await response.json()) as Record<string, any>
    expect(body.error.code).toBe('catalog_pagination_cursor_invalid')
  })


  it('rejects invalid catalog search input at the API contract boundary', async () => {
    const response = await app.handle(
      jsonRequest('/v1/catalog/search', {
        query: ''
      })
    )

    expect(response.status).toBe(422)

    const body = (await response.json()) as Record<string, any>
    expect(body.error.code).toBe('validation_failed')
  })
})
