import { readFile } from 'node:fs/promises'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import {
  AgentCapabilityManifestSchema,
  AgentDiagnosticsResponseSchema,
  CatalogSearchResponseSchema,
  McpJsonRpcResponseSchema,
  ArroMcpToolDefinitions,
  validationErrorSummary,
  type AgentCapabilityManifest,
  type AgentDiagnosticsResponse,
  type McpJsonRpcSuccessResponse
} from '@arro/contracts'
import { buildApp } from './app.ts'

const manifestValidator = TypeCompiler.Compile(AgentCapabilityManifestSchema)
const diagnosticsValidator = TypeCompiler.Compile(AgentDiagnosticsResponseSchema)
const catalogSearchValidator = TypeCompiler.Compile(CatalogSearchResponseSchema)
const mcpResponseValidator = TypeCompiler.Compile(McpJsonRpcResponseSchema)

const app = buildApp()
const failures: string[] = []
const expectedHermesToolAllowlist = [
  'agent_diagnostics',
  'search_products',
  'get_product_detail',
  'get_source_state',
  'compare_products',
  'sanity_check_product',
  'prepare_purchase',
  'update_purchase',
  'prepare_payment',
  'provide_payment',
  'confirm_purchase',
  'get_purchase',
  'cancel_purchase'
]

const assert = (condition: unknown, message: string) => {
  if (!condition) failures.push(message)
}

const jsonRequest = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(body)
  })

const getJson = async (path: string) => {
  const response = await app.handle(new Request(`http://localhost${path}`))
  const body = await response.json()
  return { response, body }
}

const getText = async (path: string) => {
  const response = await app.handle(new Request(`http://localhost${path}`))
  return { response, body: await response.text() }
}

const postJson = async (path: string, body: unknown) => {
  const response = await app.handle(jsonRequest(path, body))
  const responseBody = await response.json()
  return { response, body: responseBody }
}

const repoFile = (path: string) => new URL(`../../../${path}`, import.meta.url)
const readText = async (path: string) => readFile(repoFile(path), 'utf8')
const readJson = async (path: string) => JSON.parse(await readText(path)) as Record<string, unknown>

const validateManifest = async () => {
  const { response, body } = await getJson('/.well-known/arro-agent-capabilities')
  assert(response.status === 200, `manifest: expected HTTP 200, received ${response.status}.`)
  assert(
    response.headers.get('cache-control')?.includes('public'),
    'manifest: expected public cache-control header.'
  )
  assert(
    manifestValidator.Check(body),
    `manifest: response failed contract: ${validationErrorSummary(manifestValidator, body)}`
  )

  if (!manifestValidator.Check(body)) return undefined

  const manifest = body as AgentCapabilityManifest
  const toolNames = manifest.tools.map((tool) => tool.name)
  const expectedToolNames = ArroMcpToolDefinitions.map((tool) => tool.name)
  assert(
    JSON.stringify(toolNames) === JSON.stringify(expectedToolNames),
    `manifest: tools are not in canonical MCP order (${toolNames.join(', ')}).`
  )
  assert(manifest.mcpEndpoint.endsWith('/v1/mcp'), 'manifest: MCP endpoint must point to /v1/mcp.')
  assert(
    manifest.supportedSurfaces.includes('hermes_agent') &&
      manifest.supportedSurfaces.includes('generic_mcp') &&
      manifest.supportedSurfaces.includes('direct_http'),
    'manifest: expected Hermes, generic MCP, and direct HTTP surfaces.'
  )
  assert(
    manifest.hermes.recommendedSkillPath === 'agent-skills/arro-commerce-preflight/SKILL.md',
    'manifest: Hermes recommended skill path drifted.'
  )
  assert(
    manifest.tools.find((tool) => tool.name === 'search_products')?.actionScope === 'read:search',
    'manifest: search_products must require read:search.'
  )
  assert(
    manifest.tools.find((tool) => tool.name === 'confirm_purchase')?.availability === 'gated',
    'manifest: confirm_purchase must remain gated.'
  )
  assert(
    manifest.firstSuccessFlow.includes('prepare_payment') &&
      manifest.firstSuccessFlow.includes('provide_payment'),
    'manifest: first-success flow must include open payment negotiation.'
  )
  assert(
    manifest.authorityBoundaries.some((boundary) => boundary.includes('raw UCP passthroughs')),
    'manifest: expected raw UCP passthrough boundary.'
  )

  const v1Manifest = await getJson('/v1/agent/capabilities')
  assert(v1Manifest.response.status === 200, `v1 manifest: expected HTTP 200, received ${v1Manifest.response.status}.`)
  assert(
    manifestValidator.Check(v1Manifest.body),
    `v1 manifest: response failed contract: ${validationErrorSummary(manifestValidator, v1Manifest.body)}`
  )

  return manifest
}

const validateOpenApiAndMcp = async () => {
  const openApi = await getJson('/v1/openapi.json')
  assert(openApi.response.status === 200, `openapi: expected HTTP 200, received ${openApi.response.status}.`)
  const openApiBody = openApi.body as { paths?: Record<string, unknown> }
  assert(Boolean(openApiBody.paths?.['/.well-known/arro-agent-capabilities']), 'openapi: missing well-known manifest route.')
  assert(Boolean(openApiBody.paths?.['/v1/agent/capabilities']), 'openapi: missing v1 manifest route.')

  const machineOpenApi = await getJson('/openapi.json')
  assert(machineOpenApi.response.status === 200, `machine openapi: expected HTTP 200, received ${machineOpenApi.response.status}.`)
  const x402 = await getJson('/.well-known/x402')
  assert(x402.response.status === 200, `x402 discovery: expected HTTP 200, received ${x402.response.status}.`)
  assert((x402.body as { x402Version?: unknown }).x402Version === 2, 'x402 discovery: expected protocol version 2.')
  const agentCard = await getJson('/.well-known/agent-card.json')
  assert(agentCard.response.status === 200, `agent card: expected HTTP 200, received ${agentCard.response.status}.`)
  const llms = await getText('/llms.txt')
  assert(llms.response.status === 200, `llms.txt: expected HTTP 200, received ${llms.response.status}.`)
  assert(llms.body.includes('merchant Order'), 'llms.txt: merchant Order must remain completion truth.')
  for (const schemaPath of [
    '/schemas/payment-handlers/x402-v2.json',
    '/schemas/payment-handlers/mpp-draft.json'
  ]) {
    const schema = await getJson(schemaPath)
    assert(schema.response.status === 200, `${schemaPath}: expected HTTP 200, received ${schema.response.status}.`)
    assert(
      String((schema.body as { description?: unknown }).description).includes('not an official UCP handler'),
      `${schemaPath}: must state that the binding is not an official UCP handler.`
    )
  }

  const toolsList = await postJson('/v1/mcp', {
    jsonrpc: '2.0',
    id: 'agent-distribution-tools-list',
    method: 'tools/list'
  })
  assert(toolsList.response.status === 200, `mcp tools/list: expected HTTP 200, received ${toolsList.response.status}.`)
  assert(
    mcpResponseValidator.Check(toolsList.body),
    `mcp tools/list: invalid JSON-RPC response: ${validationErrorSummary(mcpResponseValidator, toolsList.body)}`
  )

  const result = (toolsList.body as McpJsonRpcSuccessResponse).result as { tools?: Array<{ name: string, outputSchema?: unknown }> }
  const toolNames = result.tools?.map((tool) => tool.name) ?? []
  for (const tool of ArroMcpToolDefinitions) {
    assert(toolNames.includes(tool.name), `mcp tools/list: missing ${tool.name}.`)
  }
  for (const tool of result.tools ?? []) {
    assert(Boolean(tool.outputSchema), `mcp tools/list: missing outputSchema for ${tool.name}.`)
  }
}

const validateSkillPackage = async () => {
  const skill = await readText('agent-skills/arro-commerce-preflight/SKILL.md')
  const docs = await readText('docs/agent-distribution-kit/README.md')
  const searchExample = await readJson('agent-skills/arro-commerce-preflight/examples/search-products.json')
  const diagnosticsExample = await readJson('agent-skills/arro-commerce-preflight/examples/rendering-diagnostics.json')
  const directHttpSearchExample = await readJson('agent-skills/arro-commerce-preflight/examples/direct-http-search.json')
  const genericMcpSearchExample = await readJson('agent-skills/arro-commerce-preflight/examples/generic-mcp-search-products.json')
  const genericMcpPurchaseExample = await readJson('agent-skills/arro-commerce-preflight/examples/generic-mcp-purchase.json')
  const x402PaymentExample = await readJson('agent-skills/arro-commerce-preflight/examples/x402-agent-payment.json')
  const mppPaymentExample = await readJson('agent-skills/arro-commerce-preflight/examples/mpp-agent-payment.json')
  const merchantHandlerExample = await readJson('agent-skills/arro-commerce-preflight/examples/ucp-merchant-portable-handlers.json')
  const proprietaryAdapterExample = await readJson('agent-skills/arro-commerce-preflight/examples/proprietary-payment-adapter.json')
  const hermesConfig = await readText('agent-skills/arro-commerce-preflight/examples/hermes-mcp-config.yaml')

  for (const phrase of [
    'not source authority',
    'not become source authority',
    'confirm_purchase',
    'mcp_arro_',
    'renderedTrustSignals'
  ]) {
    assert(skill.includes(phrase) || docs.includes(phrase), `skill package: missing phrase ${phrase}.`)
  }

  assert(searchExample.agentContext && typeof searchExample.agentContext === 'object', 'search example: missing agentContext.')
  assert(diagnosticsExample.renderedTrustSignals && Array.isArray(diagnosticsExample.renderedTrustSignals), 'diagnostics example: missing renderedTrustSignals.')
  assert(directHttpSearchExample.path === '/v1/catalog/search', 'direct HTTP search example: expected /v1/catalog/search path.')
  assert(directHttpSearchExample.method === 'POST', 'direct HTTP search example: expected POST method.')
  assert(
    (directHttpSearchExample.body as { agentContext?: { surface?: unknown } } | undefined)?.agentContext?.surface === 'direct_http',
    'direct HTTP search example: expected direct_http surface.'
  )
  assert(genericMcpSearchExample.method === 'tools/call', 'generic MCP example: expected tools/call method.')
  assert(
    (genericMcpSearchExample.params as { name?: unknown } | undefined)?.name === 'search_products',
    'generic MCP example: expected search_products tool.'
  )
  assert(
    ((genericMcpSearchExample.params as { arguments?: { agentContext?: { surface?: unknown } } } | undefined)?.arguments?.agentContext?.surface) === 'generic_mcp',
    'generic MCP example: expected generic_mcp surface.'
  )
  const purchaseSteps = Array.isArray(genericMcpPurchaseExample.lifecycle)
    ? genericMcpPurchaseExample.lifecycle as Array<{ params?: { name?: unknown } }>
    : []
  for (const toolName of ['prepare_purchase', 'prepare_payment', 'provide_payment', 'confirm_purchase', 'get_purchase']) {
    assert(
      purchaseSteps.some((step) => step.params?.name === toolName),
      `generic purchase example: missing ${toolName}.`
    )
  }
  assert(x402PaymentExample.protocol === 'x402' && x402PaymentExample.registrationRequired === false, 'x402 example: must be open and protocol-specific.')
  assert(mppPaymentExample.protocol === 'mpp' && mppPaymentExample.registrationRequired === false, 'MPP example: must be open and protocol-specific.')
  const merchantHandlers = merchantHandlerExample.merchantProfilePaymentHandlers as Record<string, unknown> | undefined
  assert(Boolean(merchantHandlers?.['dev.arro.payment.x402']), 'merchant example: missing experimental x402 handler.')
  assert(Boolean(merchantHandlers?.['dev.arro.payment.mpp']), 'merchant example: missing experimental MPP handler.')
  assert(
    String(proprietaryAdapterExample.purpose).includes('does not approve or register calling agents'),
    'proprietary adapter example: config must not become agent approval.'
  )
  assert(
    hermesConfig.includes('https://api.atishghimire.com.np/v1/mcp'),
    'Hermes config example: expected current public tunnel MCP URL.'
  )
  assert(hermesConfig.includes('include:'), 'Hermes config example: expected tools.include allowlist.')
  for (const toolName of expectedHermesToolAllowlist) {
    assert(hermesConfig.includes(toolName), `Hermes config example: missing ${toolName}.`)
  }
  assert(!hermesConfig.includes('prepare_cart'), 'Hermes config example: prepare_cart must not be exposed in the active tool allowlist.')
  assert(hermesConfig.includes('resources: false'), 'Hermes config example: resources wrapper must be disabled.')
  assert(hermesConfig.includes('prompts: false'), 'Hermes config example: prompts wrapper must be disabled.')

  const diagnostics = await postJson('/v1/agent/diagnostics', diagnosticsExample)
  assert(diagnostics.response.status === 200, `diagnostics example: expected HTTP 200, received ${diagnostics.response.status}.`)
  assert(
    diagnosticsValidator.Check(diagnostics.body),
    `diagnostics example: response failed contract: ${validationErrorSummary(diagnosticsValidator, diagnostics.body)}`
  )

  if (diagnosticsValidator.Check(diagnostics.body)) {
    const body = diagnostics.body as AgentDiagnosticsResponse
    assert(body.state === 'ready', `diagnostics example: expected ready, received ${body.state}.`)
    assert(
      body.renderingEvidenceState === 'ready',
      `diagnostics example: expected rendering evidence ready, received ${body.renderingEvidenceState}.`
    )
    assert(
      body.checks.some((check) => check.code === 'agent_rendering_evidence_ready'),
      'diagnostics example: expected agent_rendering_evidence_ready check.'
    )
  }

  const directHttpBody = (directHttpSearchExample.body && typeof directHttpSearchExample.body === 'object')
    ? directHttpSearchExample.body
    : {}
  const directHttpSearch = await postJson('/v1/catalog/search', directHttpBody)
  assert(directHttpSearch.response.status === 200, `direct HTTP search example: expected HTTP 200, received ${directHttpSearch.response.status}.`)
  assert(
    catalogSearchValidator.Check(directHttpSearch.body),
    `direct HTTP search example: response failed contract: ${validationErrorSummary(catalogSearchValidator, directHttpSearch.body)}`
  )

  const genericMcpSearch = await postJson('/v1/mcp', genericMcpSearchExample)
  assert(genericMcpSearch.response.status === 200, `generic MCP search example: expected HTTP 200, received ${genericMcpSearch.response.status}.`)
  assert(
    mcpResponseValidator.Check(genericMcpSearch.body),
    `generic MCP search example: invalid JSON-RPC response: ${validationErrorSummary(mcpResponseValidator, genericMcpSearch.body)}`
  )
}

await validateManifest()
await validateOpenApiAndMcp()
await validateSkillPackage()

if (failures.length > 0) {
  console.error('Agent Distribution Kit verification failed.')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Agent Distribution Kit verification passed.')
console.log('Validated capability manifest, OpenAPI routes, MCP tools/list, Hermes skill package, examples, and positive rendering diagnostics evidence.')
