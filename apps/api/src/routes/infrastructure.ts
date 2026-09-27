import type { AnyElysia } from 'elysia'
import type { UcpPlatformProfile } from '@arro/contracts'
import { config } from '../config.ts'
import { buildPlatformProfile } from '../platform-profile.ts'
import {
  buildHealthResponse,
  buildReadinessChecks
} from '../readiness.ts'
import type { RequestLifecycle } from '../request-lifecycle.ts'
import type { PaymentHandlerSpecConfig } from '../payment-result-exchange.ts'
import { buildOpenApiDocument } from '../openapi.ts'
import {
  mppHandlerName,
  mppProtocolVersion,
  x402HandlerName,
  x402ProtocolVersion
} from '../portable-payment.ts'
import {
  buildApiHomepageHtml,
  buildApiServiceDescriptor,
  buildDiscoveryCss,
  buildOgCardPng,
  buildOgCardSvg,
  buildRobotsTxt,
  buildSitemapXml
} from '../public-discovery.ts'

type InfrastructureRouteOptions = {
  requestLifecycle: RequestLifecycle
  platformProfile?: UcpPlatformProfile
  paymentHandlerSpecs?: PaymentHandlerSpecConfig[]
  publicBaseUrl?: string
}

export const registerInfrastructureRoutes = <App extends AnyElysia>(
  app: App,
  {
    requestLifecycle,
    platformProfile,
    paymentHandlerSpecs = [],
    publicBaseUrl = config.publicBaseUrl
  }: InfrastructureRouteOptions
) =>
  app
    .get('/', () => new Response(buildApiHomepageHtml(publicBaseUrl), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': `public, max-age=${config.platformProfileMaxAgeSeconds}`
      }
    }))
    .get('/v1', ({ set }) => {
      set.headers['cache-control'] = `public, max-age=${config.platformProfileMaxAgeSeconds}`
      return buildApiServiceDescriptor(publicBaseUrl)
    })
    .get('/discovery.css', () => new Response(buildDiscoveryCss(), {
      headers: {
        'content-type': 'text/css; charset=utf-8',
        'cache-control': `public, max-age=${config.platformProfileMaxAgeSeconds}`
      }
    }))
    .get('/robots.txt', () => new Response(buildRobotsTxt(publicBaseUrl), {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': `public, max-age=${config.platformProfileMaxAgeSeconds}`
      }
    }))
    .get('/sitemap.xml', () => new Response(buildSitemapXml(publicBaseUrl), {
      headers: {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': `public, max-age=${config.platformProfileMaxAgeSeconds}`
      }
    }))
    .get('/og-card.svg', () => new Response(buildOgCardSvg(), {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': `public, max-age=${config.platformProfileMaxAgeSeconds}`
      }
    }))
    .get('/og-card.png', ({ set }) => {
      set.headers['content-type'] = 'image/png'
      set.headers['cache-control'] = `public, max-age=${config.platformProfileMaxAgeSeconds}`
      return buildOgCardPng()
    })
    .get(
      '/health/live',
      ({ requestId, correlationId, set }) => {
        set.headers['cache-control'] = 'no-store'
        return buildHealthResponse({
          requestId,
          correlationId,
          checks: [
            {
              name: 'api-runtime',
              status: 'ok',
              required: true,
              message: `Node ${process.version} is running the API process.`
            }
          ]
        })
      }
    )
    .get(
      '/health/ready',
      async ({ requestId, correlationId, set }) => {
        set.headers['cache-control'] = 'no-store'
        if (requestLifecycle.isDraining) {
          set.status = 503
          const body = buildHealthResponse({
            requestId,
            correlationId,
            checks: [
              {
                name: 'server-lifecycle',
                status: 'fail',
                required: true,
                message: 'The API process is draining in-flight requests and is not accepting new work.'
              }
            ]
          })

          return body
        }

        const body = buildHealthResponse({
          requestId,
          correlationId,
          checks: await buildReadinessChecks()
        })

        if (body.status === 'fail') set.status = 503

        return body
      }
    )
    .get(
      '/.well-known/ucp',
      ({ set }) => {
        set.headers['cache-control'] = `public, max-age=${config.platformProfileMaxAgeSeconds}`
        return platformProfile ?? buildPlatformProfile()
      }
    )
    .get('/openapi.json', ({ set }) => {
      set.headers['cache-control'] = `public, max-age=${config.platformProfileMaxAgeSeconds}`
      return buildOpenApiDocument()
    })
    .get('/.well-known/x402', ({ set }) => {
      set.headers['cache-control'] = `public, max-age=${config.platformProfileMaxAgeSeconds}`
      const specs = paymentHandlerSpecs.filter((entry) => entry.adapterKind === 'x402')
      return {
        x402Version: 2,
        enabled: specs.length > 0,
        transport: {
          paymentRequiredHeader: 'PAYMENT-REQUIRED',
          paymentSignatureHeader: 'PAYMENT-SIGNATURE',
          paymentResponseHeader: 'PAYMENT-RESPONSE'
        },
        ucpExperimentalHandler: x402HandlerName,
        handlerSchema: `${publicBaseUrl}/schemas/payment-handlers/x402-v2.json`,
        endpoints: {
          mcp: `${publicBaseUrl}/v1/mcp`,
          openapi: `${publicBaseUrl}/openapi.json`
        },
        contracts: specs.map((entry) => ({
          version: x402ProtocolVersion,
          methods: entry.handlerConfig?.methods ?? entry.handlerConfig?.schemes ?? [],
          networks: entry.handlerConfig?.networks ?? [],
          assets: entry.handlerConfig?.assets ?? []
        }))
      }
    })
    .get('/.well-known/agent-card.json', ({ set }) => {
      set.headers['cache-control'] = `public, max-age=${config.platformProfileMaxAgeSeconds}`
      const mppSpecs = paymentHandlerSpecs.filter((entry) => entry.adapterKind === 'mpp')
      return {
        name: 'Arro Universal Commerce',
        description: 'Neutral source-backed Cart, Checkout, payment-capability negotiation, and merchant Order execution for authenticated agents.',
        version: '0.1.0',
        url: publicBaseUrl,
        authentication: { schemes: ['apiKey', 'arroSignedAgentSession'] },
        interfaces: {
          mcp: `${publicBaseUrl}/v1/mcp`,
          openapi: `${publicBaseUrl}/openapi.json`,
          ucp: `${publicBaseUrl}/.well-known/ucp`
        },
        paymentProtocols: [
          ...paymentHandlerSpecs.filter((entry) => entry.adapterKind === 'x402').map(() => ({ protocol: 'x402', version: x402ProtocolVersion })),
          ...mppSpecs.map((entry) => ({
            protocol: 'mpp',
            version: mppProtocolVersion,
            methods: entry.handlerConfig?.methods ?? []
          }))
        ]
      }
    })
    .get('/llms.txt', ({ set }) => {
      set.headers['content-type'] = 'text/plain; charset=utf-8'
      set.headers['cache-control'] = `public, max-age=${config.platformProfileMaxAgeSeconds}`
      return [
        '# Arro Universal Commerce',
        '',
        'Lifecycle: search -> prepare_purchase -> prepare_payment -> provide_payment -> confirm_purchase -> merchant Order.',
        'Payment credentials never equal completion. Merchant Order continuity is authoritative.',
        'x402 and MPP are separate protocol adapters and are not official UCP payment handlers.',
        '',
        `MCP: ${publicBaseUrl}/v1/mcp`,
        `OpenAPI: ${publicBaseUrl}/openapi.json`,
        `UCP: ${publicBaseUrl}/.well-known/ucp`,
        `x402: ${publicBaseUrl}/.well-known/x402`,
        `Agent Card: ${publicBaseUrl}/.well-known/agent-card.json`
      ].join('\n')
    })
    .get('/schemas/payment-handlers/x402-v2.json', () => ({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `${publicBaseUrl}/schemas/payment-handlers/x402-v2.json`,
      title: `${x402HandlerName} experimental UCP handler`,
      description: 'Arro experimental binding of x402 v2 challenge and PaymentPayload to one merchant Checkout. This is not an official UCP handler.',
      type: 'object',
      required: ['protocol_version', 'schemes', 'networks', 'assets'],
      properties: {
        protocol_version: { const: x402ProtocolVersion },
        challenge_url: { type: 'string', format: 'uri', description: 'Required on a merchant declaration; must be HTTPS and same-origin with the merchant.' },
        schemes: { type: 'array', minItems: 1, items: { type: 'string' } },
        networks: { type: 'array', minItems: 1, items: { type: 'string' } },
        assets: { type: 'array', minItems: 1, items: { type: 'string' } }
      },
      additionalProperties: true
    }))
    .get('/schemas/payment-handlers/mpp-draft.json', () => ({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `${publicBaseUrl}/schemas/payment-handlers/mpp-draft.json`,
      title: `${mppHandlerName} experimental UCP handler`,
      description: 'Arro experimental binding of the draft Payment HTTP Authentication Scheme to one merchant Checkout. This is not an official UCP handler.',
      type: 'object',
      required: ['protocol_version', 'methods', 'intents'],
      properties: {
        protocol_version: { const: mppProtocolVersion },
        challenge_url: { type: 'string', format: 'uri', description: 'Required on a merchant declaration; must be HTTPS and same-origin with the merchant.' },
        methods: { type: 'array', minItems: 1, items: { type: 'string' } },
        intents: { type: 'array', minItems: 1, items: { type: 'string' } }
      },
      additionalProperties: true
    }))
