import {
  MCP_PROTOCOL_VERSION,
  ArroMcpToolDefinitions,
  type AgentActionScope,
  type AgentCapabilityAvailability,
  type AgentCapabilityManifest,
  type AgentTrustSignalCapability,
  type McpToolName
} from '@arro/contracts'
import { requiredAgentHostCapabilitiesByScope } from './agent-invocation.ts'

const allTrustSignals: AgentTrustSignalCapability[] = [
  'source_labels',
  'freshness',
  'caveats',
  'no_buy_warnings',
  'commercial_disclosures',
  'authority_limits',
  'allowed_next_actions',
  'user_confirmation',
  'purchase_state'
]

const toolActionScopes = {
  agent_diagnostics: 'read:sanity_check',
  search_products: 'read:search',
  get_product_detail: 'read:product_detail',
  compare_products: 'read:compare',
  get_source_state: 'read:source_state',
  sanity_check_product: 'read:sanity_check',
  prepare_purchase: 'write:purchase',
  update_purchase: 'write:purchase',
  prepare_payment: 'write:purchase',
  provide_payment: 'write:complete_purchase',
  confirm_purchase: 'write:complete_purchase',
  get_purchase: 'read:purchase',
  cancel_purchase: 'write:purchase'
} satisfies Record<McpToolName, AgentActionScope>

const toolAvailability = {
  agent_diagnostics: 'ready',
  search_products: 'ready',
  get_product_detail: 'ready',
  compare_products: 'ready',
  get_source_state: 'ready',
  sanity_check_product: 'ready',
  prepare_purchase: 'ready',
  update_purchase: 'ready',
  prepare_payment: 'gated',
  provide_payment: 'gated',
  confirm_purchase: 'gated',
  get_purchase: 'ready',
  cancel_purchase: 'limited'
} satisfies Record<McpToolName, AgentCapabilityAvailability>

const toolAuthorityLimit = (toolName: McpToolName): string => {
  if (
    toolName === 'prepare_purchase' ||
    toolName === 'update_purchase' ||
    toolName === 'get_purchase' ||
    toolName === 'cancel_purchase'
  ) {
    return 'Compact purchase lane: resolves merchant authority, creates or refreshes merchant checkout state, and returns the smoothest safe next action without claiming Arro payment completion.'
  }

  if (toolName === 'prepare_payment' || toolName === 'provide_payment') {
    return 'Open payment negotiation lane: exact agent capability, merchant handler, Checkout snapshot, and signed one-time action must intersect. Credentials remain vaulted and merchant Order remains completion truth.'
  }

  if (toolName === 'confirm_purchase') {
    return 'Gated purchase confirmation lane: records explicit buyer approval and can complete only when merchant UCP state, idempotency, payment instrument proof, and durable audit requirements pass.'
  }

  return 'Read-first source-governed commerce preflight; output is advisory until the returned action policy allows a next step.'
}

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

export const buildAgentCapabilityManifest = (
  publicBaseUrl: string
): AgentCapabilityManifest => {
  const baseUrl = trimTrailingSlash(publicBaseUrl)

  return {
    manifestVersion: 'arro-agent-capabilities/v0.1',
    product: 'Arro',
    publicBaseUrl: baseUrl,
    mcpEndpoint: `${baseUrl}/v1/mcp`,
    openApiUrl: `${baseUrl}/v1/openapi.json`,
    ucpProfileUrl: `${baseUrl}/.well-known/ucp`,
    quickstartUrl: 'docs/hermes-agent-shopify-quickstart.md',
    supportedSurfaces: [
      'hermes_agent',
      'generic_mcp',
      'direct_http'
    ],
    requiredTrustSignals: allTrustSignals,
    firstSuccessFlow: [
      'agent_diagnostics',
      'search_products',
      'get_product_detail',
      'sanity_check_product',
      'prepare_purchase',
      'prepare_payment',
      'provide_payment',
      'confirm_purchase',
      'get_purchase'
    ],
    authorityBoundaries: [
      'Host agents may parse intent, ask clarifying questions, and render Arro outputs, but their structured intent remains advisory until Arro validates it.',
      'Arro MCP tools are not raw UCP passthroughs and do not grant direct connector access.',
      'Search, detail, comparison, sanity-check, and purchase tools must preserve source labels, freshness, caveats, no-buy warnings, commercial disclosures, authority limits, and allowed next actions.',
      'Cart, checkout, payment, and order operations are internal to the compact purchase lane and stay source-scoped, owner-scoped, idempotent, audited, and gated by returned action policy.',
      'Commercial attribution, service-payment receipts, and host-side shopping or payment skills never influence ranking, product truth, checkout totals, no-buy warnings, or source authority.',
      'An authenticated agent needs no prior Arro host registration to use an exact merchant-advertised x402 or MPP contract; declarations alone grant no private-host, wallet, or merchant authority.'
    ],
    hermes: {
      mcpServerName: 'arro',
      recommendedSkillPath: 'agent-skills/arro-commerce-preflight/SKILL.md',
      mcpToolPrefix: 'mcp_arro_',
      agentContextSurface: 'hermes_agent'
    },
    tools: ArroMcpToolDefinitions.map((tool) => {
      const actionScope = toolActionScopes[tool.name]

      return {
        name: tool.name,
        description: tool.description,
        actionScope,
        availability: toolAvailability[tool.name],
        readOnly: actionScope.startsWith('read:'),
        requiredTrustSignals: requiredAgentHostCapabilitiesByScope[actionScope],
        authorityLimit: toolAuthorityLimit(tool.name)
      }
    }),
    verification: {
      diagnosticsEndpoint: `${baseUrl}/v1/agent/diagnostics`,
      commands: [
        'npm run verify',
        'npm run verify:launch -- --plan',
        'npm run verify:launch'
      ]
    }
  }
}
