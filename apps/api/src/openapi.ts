import {
  AgentDiagnosticsRequestSchema,
  AgentDiagnosticsResponseSchema,
  AgentCapabilityManifestSchema,
  AgentSessionIssueRequestSchema,
  AgentSessionIssueResponseSchema,
  CatalogProductCompareRequestSchema,
  CatalogProductCompareResponseSchema,
  CatalogProductDetailRequestSchema,
  CatalogProductDetailResponseSchema,
  CatalogProductSanityCheckRequestSchema,
  CatalogProductSanityCheckResponseSchema,
  CatalogSearchRequestSchema,
  CatalogSearchResponseSchema,
  CatalogSourceStateRequestSchema,
  CatalogSourceStateResponseSchema,
  DataRightsCorrectionRequestSchema,
  DataRightsCorrectionResponseSchema,
  DataRightsDeletionRequestSchema,
  DataRightsDeletionResponseSchema,
  DataRightsExportRequestSchema,
  DataRightsExportResponseSchema,
  HealthResponseSchema,
  McpClientMessageSchema,
  McpJsonRpcResponseSchema,
  PurchaseConfirmRequestSchema,
  PurchasePaymentActionCreateRequestSchema,
  PurchasePaymentActionResponseSchema,
  PurchasePaymentActionResultRequestSchema,
  StripePaymentActionSessionSchema,
  PurchasePrepareRequestSchema,
  PurchaseReviewUpdateRequestSchema,
  PurchaseResponseSchema,
  TargetBusinessConformanceListResponseSchema,
  TargetBusinessConformanceRunResponseSchema,
  TargetBusinessConformanceTriggerRequestSchema,
  TargetBusinessAdminDetailResponseSchema,
  TargetBusinessAdminListResponseSchema,
  TargetBusinessAdminTransitionRequestSchema,
  TargetBusinessAdminTransitionResponseSchema,
  TargetBusinessMatrixResponseSchema,
  ApiErrorSchema,
  UcpDiscoveryRequestSchema,
  UcpDiscoveryResponseSchema,
  ArroPlatformProfileSchema
} from '@arro/contracts'
import { apiVersion } from './config.ts'

export const buildOpenApiDocument = () => ({
  openapi: '3.1.0',
  info: {
    title: 'Arro API',
    version: apiVersion
  },
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key'
      },
      ShopperSessionAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Arro-Shopper-Session'
      }
    }
  },
  paths: {
    '/health/live': {
      get: {
        summary: 'API liveness check',
        responses: {
          '200': {
            description: 'API process is running.',
            content: {
              'application/json': {
                schema: HealthResponseSchema
              }
            }
          }
        }
      }
    },
    '/health/ready': {
      get: {
        summary: 'API readiness check',
        responses: {
          '200': {
            description: 'API dependencies and launch-critical configuration state.',
            content: {
              'application/json': {
                schema: HealthResponseSchema
              }
            }
          }
        }
      }
    },
    '/.well-known/ucp': {
      get: {
        summary: 'Arro UCP platform profile',
        responses: {
          '200': {
            description: 'Cacheable Arro platform profile.',
            content: {
              'application/json': {
                schema: ArroPlatformProfileSchema
              }
            }
          }
        }
      }
    },
    '/.well-known/arro-agent-capabilities': {
      get: {
        summary: 'Arro agent capability manifest',
        responses: {
          '200': {
            description: 'Cacheable machine-readable agent capability manifest for MCP, Hermes Agent, and direct HTTP integrations.',
            content: {
              'application/json': {
                schema: AgentCapabilityManifestSchema
              }
            }
          }
        }
      }
    },
    '/v1/agent/capabilities': {
      get: {
        summary: 'Arro agent capability manifest',
        responses: {
          '200': {
            description: 'Machine-readable agent capability manifest for MCP, Hermes Agent, and direct HTTP integrations.',
            content: {
              'application/json': {
                schema: AgentCapabilityManifestSchema
              }
            }
          }
        }
      }
    },
    '/v1/catalog/search': {
      post: {
        summary: 'Catalog search API surface',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: CatalogSearchRequestSchema
            }
          }
        },
        responses: {
          '200': {
            description: 'Catalog search result or safe unavailable state.',
            content: {
              'application/json': {
                schema: CatalogSearchResponseSchema
              }
            }
          },
          '400': {
            description: 'Request body was not valid JSON.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '422': {
            description: 'Request body failed API contract validation.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '503': {
            description: 'Connector-backed search is temporarily unavailable, including durable audit persistence failures.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '504': {
            description: 'Search exceeded the request timeout budget.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '500': {
            description: 'Unexpected API error with sanitized response body.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    },
    '/v1/agent/diagnostics': {
      post: {
        summary: 'Agent integration diagnostics',
        description: 'Checks whether a declared agent context can safely call an expected Arro action scope without exposing raw external subject or task references.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: AgentDiagnosticsRequestSchema
            }
          }
        },
        responses: {
          '200': {
            description: 'Bounded diagnostics result for route scope, host rendering capabilities, and session expiry.',
            content: {
              'application/json': {
                schema: AgentDiagnosticsResponseSchema
              }
            }
          },
          '400': {
            description: 'Request body was not valid JSON.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '422': {
            description: 'Request body failed API contract validation.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    },
    '/v1/agent/session': {
      post: {
        summary: 'Issue a scoped agent session token',
        description: 'Issues a short-lived signed preview session token bound to integration, surface, allowed action scopes, host capability declarations, expiry, and optional opaque subject/task refs. The token binds agent context but does not replace API-key auth, source governance, host-rendering checks, receipts, idempotency, or checkout gates.',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: AgentSessionIssueRequestSchema
            }
          }
        },
        responses: {
          '200': {
            description: 'Signed scoped agent session token issued.',
            content: {
              'application/json': {
                schema: AgentSessionIssueResponseSchema
              }
            }
          },
          '400': {
            description: 'Request body was not valid JSON.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '401': {
            description: 'Missing or invalid API key.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '403': {
            description: 'API key is missing the agent session scope.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '422': {
            description: 'Request failed contract validation or configured TTL policy.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '503': {
            description: 'Agent session signing is not configured.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    },
    '/v1/shopper/session': {
      post: {
        summary: 'Start a short-lived first-party shopper checkout session',
        description: 'Issues a short-lived signed session for Arro’s own web and native checkout UI. A still-valid session may be rotated without changing shopper ownership. The token authorizes only shopper purchase routes and is never an external-agent credential.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } }
        },
        responses: {
          '200': {
            description: 'Short-lived shopper checkout session.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['token', 'expiresAt'],
                  additionalProperties: false,
                  properties: {
                    token: { type: 'string' },
                    expiresAt: { type: 'string', format: 'date-time' }
                  }
                }
              }
            }
          },
          '503': { description: 'First-party checkout sessions are not configured.', content: { 'application/json': { schema: ApiErrorSchema } } }
        }
      }
    },
    '/v1/purchases/prepare': {
      post: {
        summary: 'Prepare merchant Cart and Checkout from a selected offer',
        description: 'Resolves merchant authority, creates the strongest supported Cart and Checkout, and returns accepted payment capabilities plus the safest next action. Any authenticated agent with write:purchase may call this route; portable payment protocols do not require host registration.',
        security: [{ ApiKeyAuth: [] }, { ShopperSessionAuth: [] }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: PurchasePrepareRequestSchema } }
        },
        responses: {
          '200': { description: 'Prepared purchase with merchant Checkout continuity.', content: { 'application/json': { schema: PurchaseResponseSchema } } },
          '401': { description: 'Authentication required.', content: { 'application/json': { schema: ApiErrorSchema } } },
          '403': { description: 'Purchase scope or signed agent context rejected.', content: { 'application/json': { schema: ApiErrorSchema } } },
          '409': { description: 'Merchant state or idempotency conflict.', content: { 'application/json': { schema: ApiErrorSchema } } },
          '422': { description: 'Invalid merchant, offer, Cart, or Checkout input.', content: { 'application/json': { schema: ApiErrorSchema } } }
        }
      }
    },
    '/v1/purchases/{purchaseId}': {
      get: {
        summary: 'Read the current purchase state',
        description: 'Returns the current owner-scoped purchase, checkout continuity, totals, payment state, and next action.',
        security: [{ ApiKeyAuth: [] }, { ShopperSessionAuth: [] }],
        parameters: [{ name: 'purchaseId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Current purchase state.', content: { 'application/json': { schema: PurchaseResponseSchema } } },
          '401': { description: 'Authentication required.', content: { 'application/json': { schema: ApiErrorSchema } } },
          '403': { description: 'Purchase owner or scope rejected.', content: { 'application/json': { schema: ApiErrorSchema } } },
          '404': { description: 'Purchase not found for this owner.', content: { 'application/json': { schema: ApiErrorSchema } } }
        }
      }
    },
    '/v1/purchases/{purchaseId}/review': {
      patch: {
        summary: 'Update shopper-owned Checkout review details',
        description: 'Applies buyer contact and fulfillment selections to the exact current Checkout snapshot. Arro expands the narrow shopper input into a full UCP replacement while excluding merchant-owned prices, options, totals, and pickup locations.',
        security: [{ ApiKeyAuth: [] }, { ShopperSessionAuth: [] }],
        parameters: [
          { name: 'purchaseId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 160 } }
        ],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: PurchaseReviewUpdateRequestSchema } }
        },
        responses: {
          '200': { description: 'Purchase review updated from the merchant Checkout.', content: { 'application/json': { schema: PurchaseResponseSchema } } },
          '401': { description: 'Authentication required.', content: { 'application/json': { schema: ApiErrorSchema } } },
          '403': { description: 'Purchase owner or write scope rejected.', content: { 'application/json': { schema: ApiErrorSchema } } },
          '409': { description: 'Checkout snapshot is stale, completing, completed, or canceled.', content: { 'application/json': { schema: ApiErrorSchema } } },
          '422': { description: 'Buyer details or fulfillment selection is invalid for the current merchant Checkout.', content: { 'application/json': { schema: ApiErrorSchema } } }
        }
      }
    },
    '/v1/purchases/{purchaseId}/payment-actions': {
      post: {
        summary: 'Negotiate one executable payment action',
        description: 'Intersects caller-declared portable capability with the exact merchant handler and current Checkout. x402 and MPP actions contain merchant-origin HTTP 402 challenges; declarations alone grant no private-host authority.',
        security: [{ ApiKeyAuth: [] }, { ShopperSessionAuth: [] }],
        parameters: [{ name: 'purchaseId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: PurchasePaymentActionCreateRequestSchema } }
        },
        responses: {
          '200': { description: 'Signed checkout-bound payment action.', content: { 'application/json': { schema: PurchasePaymentActionResponseSchema } } },
          '409': { description: 'No exact executable capability intersection; merchant continuation remains available when supplied by the Checkout.', content: { 'application/json': { schema: ApiErrorSchema } } },
          '422': { description: 'Invalid portable capability or payment preference.', content: { 'application/json': { schema: ApiErrorSchema } } }
        }
      }
    },
    '/v1/payment-actions/{signedActionToken}/result': {
      post: {
        summary: 'Provide one protocol-native payment credential',
        description: 'Verifies the signed action and exact Checkout binding, then stores the consume-once credential only in the encrypted runtime vault. This does not create or imply an Order.',
        parameters: [{ name: 'signedActionToken', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: PurchasePaymentActionResultRequestSchema } }
        },
        responses: {
          '200': { description: 'Credential accepted for the current Checkout.', content: { 'application/json': { schema: PurchaseResponseSchema } } },
          '409': { description: 'Action replayed, revoked, expired, or bound to stale Checkout terms.', content: { 'application/json': { schema: ApiErrorSchema } } },
          '422': { description: 'Credential shape or protocol binding invalid.', content: { 'application/json': { schema: ApiErrorSchema } } }
        }
      }
    },
    '/v1/payment-actions/{signedActionToken}/session': {
      post: {
        summary: 'Create one live native payment session',
        description: 'Refreshes the exact merchant Checkout and asks its selected production Processor Tokenizer handler for a short-lived Stripe PaymentSheet session. The session is bound durably to this signed action and never creates an Order by itself.',
        parameters: [{ name: 'signedActionToken', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Live, checkout-bound Stripe PaymentSheet session.', content: { 'application/json': { schema: StripePaymentActionSessionSchema } } },
          '409': { description: 'Action is stale, replayed, expired, or no longer bound to the active Checkout.', content: { 'application/json': { schema: ApiErrorSchema } } },
          '502': { description: 'Merchant returned an invalid or unavailable native payment session.', content: { 'application/json': { schema: ApiErrorSchema } } },
          '503': { description: 'Runtime credentials or durable action storage are unavailable.', content: { 'application/json': { schema: ApiErrorSchema } } }
        }
      }
    },
    '/v1/purchases/{purchaseId}/confirm': {
      post: {
        summary: 'Confirm and complete a compatible purchase',
        description: 'Records exact current Checkout authority and calls merchant completion only with a consume-once payment credential. Purchase state becomes completed only when the merchant returns Order continuity.',
        security: [{ ApiKeyAuth: [] }, { ShopperSessionAuth: [] }],
        parameters: [{ name: 'purchaseId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: PurchaseConfirmRequestSchema } }
        },
        responses: {
          '200': { description: 'Current purchase state, including merchant Order only when authoritative.', content: { 'application/json': { schema: PurchaseResponseSchema } } },
          '403': { description: 'Buyer, mandate, or AP2 authority is insufficient.', content: { 'application/json': { schema: ApiErrorSchema } } },
          '409': { description: 'Checkout changed, payment credential unavailable, or completion needs reconciliation.', content: { 'application/json': { schema: ApiErrorSchema } } }
        }
      }
    },
    '/v1/purchases/{purchaseId}/cancel': {
      post: {
        summary: 'Cancel the current purchase flow',
        description: 'Cancels the owner-scoped purchase or merchant checkout where current merchant semantics allow it.',
        security: [{ ApiKeyAuth: [] }, { ShopperSessionAuth: [] }],
        parameters: [{ name: 'purchaseId', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                properties: { reason: { type: 'string', minLength: 1, maxLength: 240 } }
              }
            }
          }
        },
        responses: {
          '200': { description: 'Updated purchase state.', content: { 'application/json': { schema: PurchaseResponseSchema } } },
          '403': { description: 'Purchase owner or scope rejected.', content: { 'application/json': { schema: ApiErrorSchema } } },
          '409': { description: 'Merchant state prevents cancellation.', content: { 'application/json': { schema: ApiErrorSchema } } }
        }
      }
    },
    '/v1/product/sanity-check': {
      post: {
        summary: 'Product sanity-check API surface',
        description: 'Checks caller-supplied product evidence, identifiers, visible claim text, URL strings, or structured source-labeled candidates without fetching unsupported pages. The response can support, require review, or return a no-buy warning, but it never grants checkout authority.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: CatalogProductSanityCheckRequestSchema
            }
          }
        },
        responses: {
          '200': {
            description: 'Bounded sanity-check result with source-preserving findings and safe next actions.',
            content: {
              'application/json': {
                schema: CatalogProductSanityCheckResponseSchema
              }
            }
          },
          '400': {
            description: 'Request body was not valid JSON.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '403': {
            description: 'Agent scope, signed session binding, expiry, or host trust-signal capability does not allow this sanity check.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '422': {
            description: 'Request body failed API contract validation.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    },
    '/v1/product/compare': {
      post: {
        summary: 'Product comparison API surface',
        description: 'Compares caller-supplied source-labeled product candidates without fetching unsupported pages, ranking by commercial incentives, or granting checkout authority. The response preserves source mode, freshness, caveats, and advisory next actions.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: CatalogProductCompareRequestSchema
            }
          }
        },
        responses: {
          '200': {
            description: 'Bounded comparison result with source-preserving assessments and safe next actions.',
            content: {
              'application/json': {
                schema: CatalogProductCompareResponseSchema
              }
            }
          },
          '400': {
            description: 'Request body was not valid JSON.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '403': {
            description: 'Agent scope, signed session binding, expiry, or host trust-signal capability does not allow this comparison.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '422': {
            description: 'Request body failed API contract validation.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    },
    '/v1/source/state': {
      post: {
        summary: 'Source state API surface',
        description: 'Returns source-governed readiness for approved, connected, limited, or unavailable commerce sources without probing unsupported pages or granting product, cart, checkout, or payment authority.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: CatalogSourceStateRequestSchema
            }
          }
        },
        responses: {
          '200': {
            description: 'Bounded source-state result with freshness, capability, caveat, and safe next-action context.',
            content: {
              'application/json': {
                schema: CatalogSourceStateResponseSchema
              }
            }
          },
          '400': {
            description: 'Request body was not valid JSON.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '403': {
            description: 'Agent scope, signed session binding, expiry, or host trust-signal capability does not allow this source-state read.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '422': {
            description: 'Request body failed API contract validation.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '504': {
            description: 'Source-state read exceeded the request timeout budget.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    },
    '/v1/mcp': {
      post: {
        summary: 'Arro MCP preview JSON-RPC endpoint',
        description: 'MCP transport for authenticated agents. The endpoint exposes the compact Arro-owned commerce lifecycle over JSON-RPC while delegating every tool call to the same HTTP handlers, source governance, agent policy, checkout, payment, timeout, and audit boundaries used by the canonical API routes. Exact x402 or MPP payment capability does not require prior host registration.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: McpClientMessageSchema
            }
          }
        },
        responses: {
          '200': {
            description: 'MCP JSON-RPC response for initialize, tools/list, or tools/call. Tool execution failures are returned as MCP tool results with isError=true when the request itself is valid JSON-RPC.',
            content: {
              'application/json': {
                schema: McpJsonRpcResponseSchema
              }
            }
          },
          '202': {
            description: 'Initialized notification accepted.'
          },
          '400': {
            description: 'Invalid MCP JSON-RPC request or unsupported MCP method.',
            content: {
              'application/json': {
                schema: McpJsonRpcResponseSchema
              }
            }
          },
          '405': {
            description: 'MCP endpoint requires HTTP POST for JSON-RPC messages.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    },
    '/v1/data-rights/access': {
      post: {
        summary: 'Access scoped UCP data-rights records',
        description: 'Returns scoped current UCP purchase sessions, payment results, Orders, and data-rights event records for one integration and opaque external subject reference. The raw external subject reference is used only for HMAC lookup and is not echoed.',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: DataRightsExportRequestSchema
            }
          }
        },
        responses: {
          '200': {
            description: 'Scoped access response.',
            content: {
              'application/json': {
                schema: DataRightsExportResponseSchema
              }
            }
          },
          '400': {
            description: 'Request body was not valid JSON.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '401': {
            description: 'API key authentication is required.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '403': {
            description: 'API key scope or subject lookup requirements were not satisfied.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '422': {
            description: 'Request body failed API contract validation.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '503': {
            description: 'Data-rights storage or hash configuration is unavailable.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    },
    '/v1/data-rights/export': {
      post: {
        summary: 'Export scoped UCP data-rights records',
        description: 'Exports scoped current UCP purchase sessions, payment results, Orders, and data-rights event records in a machine-readable response for one integration and opaque external subject reference.',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: DataRightsExportRequestSchema
            }
          }
        },
        responses: {
          '200': {
            description: 'Scoped export response.',
            content: {
              'application/json': {
                schema: DataRightsExportResponseSchema
              }
            }
          },
          '400': {
            description: 'Request body was not valid JSON.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '401': {
            description: 'API key authentication is required.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '403': {
            description: 'API key scope or subject lookup requirements were not satisfied.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '422': {
            description: 'Request body failed API contract validation.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '503': {
            description: 'Data-rights storage or hash configuration is unavailable.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    },
    '/v1/data-rights/corrections': {
      post: {
        summary: 'Record a scoped UCP data-rights correction',
        description: 'Records an append-only correction event for a subject scope, current purchase, or Order without rewriting merchant/source-backed purchase or Order history.',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: DataRightsCorrectionRequestSchema
            }
          }
        },
        responses: {
          '200': {
            description: 'Correction event recorded.',
            content: {
              'application/json': {
                schema: DataRightsCorrectionResponseSchema
              }
            }
          },
          '400': {
            description: 'Request body was not valid JSON.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '401': {
            description: 'API key authentication is required.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '403': {
            description: 'API key scope or subject lookup requirements were not satisfied.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '404': {
            description: 'Correction target was not found in the scoped records.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '422': {
            description: 'Request body failed API contract validation.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '503': {
            description: 'Data-rights storage or hash configuration is unavailable.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    },
    '/v1/data-rights/delete': {
      post: {
        summary: 'Delete scoped UCP data-rights records',
        description: 'Deletes scoped current UCP purchase/payment/Order records for one integration and opaque external subject reference according to the current data-rights service while retaining a minimal hash-only data-rights event ledger and policy-bound request audit rows.',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: DataRightsDeletionRequestSchema
            }
          }
        },
        responses: {
          '200': {
            description: 'Scoped deletion completed.',
            content: {
              'application/json': {
                schema: DataRightsDeletionResponseSchema
              }
            }
          },
          '400': {
            description: 'Request body was not valid JSON.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '401': {
            description: 'API key authentication is required.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '403': {
            description: 'API key scope or subject lookup requirements were not satisfied.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '422': {
            description: 'Request body failed API contract validation.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '503': {
            description: 'Data-rights storage or hash configuration is unavailable.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    },
    '/v1/catalog/product': {
      post: {
        summary: 'Catalog product detail API surface',
        description: 'Returns connector-confirmed product detail from approved or connected official sources. This route fails closed with an unavailable state when product detail cannot be verified by a configured source.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: CatalogProductDetailRequestSchema
            }
          }
        },
        responses: {
          '200': {
            description: 'Product detail result or safe unavailable state.',
            content: {
              'application/json': {
                schema: CatalogProductDetailResponseSchema
              }
            }
          },
          '400': {
            description: 'Request body was not valid JSON.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '422': {
            description: 'Request body failed API contract validation.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '504': {
            description: 'Product detail exceeded the request timeout budget.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '500': {
            description: 'Unexpected API error with sanitized response body.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    },
    '/v1/ucp/discover': {
      post: {
        summary: 'Read-only UCP business profile discovery',
        security: [{ ApiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: UcpDiscoveryRequestSchema
            }
          }
        },
        responses: {
          '200': {
            description: 'UCP discovery result, access-state classification, and non-authoritative observation recording. Discovery does not approve a source or enable live product visibility.',
            content: {
              'application/json': {
                schema: UcpDiscoveryResponseSchema
              }
            }
          },
          '401': {
            description: 'Missing or invalid API key.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '403': {
            description: 'Valid API key without the required scope.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '413': {
            description: 'Request body exceeds the configured size limit.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '415': {
            description: 'Request body content type is not supported.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '422': {
            description: 'Request body failed API contract validation.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '429': {
            description: 'Per-principal UCP discovery request quota exceeded.',
            headers: {
              'Retry-After': {
                description: 'Seconds until another request should be attempted.',
                schema: {
                  type: 'integer',
                  minimum: 1
                }
              }
            },
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    },
    '/v1/ucp/businesses': {
      get: {
        summary: 'Target-business matrix',
        responses: {
          '200': {
            description: 'Candidate business access, capability, evidence, and launch visibility records.',
            content: {
              'application/json': {
                schema: TargetBusinessMatrixResponseSchema
              }
            }
          }
        }
      }
    },
    '/v1/admin/businesses': {
      get: {
        summary: 'Admin source-governance business review list',
        description: 'Protected control-plane view for source candidates and access states. Listing records does not approve a source or enable live product visibility.',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'domain',
            in: 'query',
            required: false,
            schema: { type: 'string' }
          },
          {
            name: 'launchStatus',
            in: 'query',
            required: false,
            schema: { type: 'string' }
          },
          {
            name: 'featureVisibility',
            in: 'query',
            required: false,
            schema: { type: 'string' }
          },
          {
            name: 'accessPolicyState',
            in: 'query',
            required: false,
            schema: { type: 'string' }
          }
        ],
        responses: {
          '200': {
            description: 'Admin-filtered source-governance records.',
            content: {
              'application/json': {
                schema: TargetBusinessAdminListResponseSchema
              }
            }
          },
          '401': {
            description: 'Missing or invalid API key.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '403': {
            description: 'Valid API key without admin scope.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '422': {
            description: 'Query filters failed API contract validation.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    },
    '/v1/admin/businesses/{businessId}': {
      get: {
        summary: 'Admin source-governance business detail',
        description: 'Protected business detail view with recent discovery observations and source transition history. Discovery and review records remain non-authoritative until explicit conformance-backed approval exists.',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'businessId',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 1 }
          }
        ],
        responses: {
          '200': {
            description: 'Admin business detail record.',
            content: {
              'application/json': {
                schema: TargetBusinessAdminDetailResponseSchema
              }
            }
          },
          '401': {
            description: 'Missing or invalid API key.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '403': {
            description: 'Valid API key without admin scope.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '404': {
            description: 'Business record was not found.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      },
      patch: {
        summary: 'Record a safe admin source-governance transition',
        description: 'Records auditable source state transitions for review, block, deny, and partner-required style states. Approval, launch visibility, catalog visibility, and checkout visibility are rejected until current passing conformance gates exist.',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'businessId',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 1 }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: TargetBusinessAdminTransitionRequestSchema
            }
          }
        },
        responses: {
          '200': {
            description: 'Transition was recorded in the append-only source governance ledger.',
            content: {
              'application/json': {
                schema: TargetBusinessAdminTransitionResponseSchema
              }
            }
          },
          '401': {
            description: 'Missing or invalid API key.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '403': {
            description: 'Valid API key without admin scope.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '409': {
            description: 'Requested transition conflicts with governance rules, such as conformance-gated approval states.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '413': {
            description: 'Request body exceeds the configured size limit.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '415': {
            description: 'Request body content type is not supported.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '422': {
            description: 'Transition request failed API contract validation or linked-observation validation.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    },
    '/v1/admin/businesses/{businessId}/conformance': {
      get: {
        summary: 'List admin target-business conformance runs',
        description: 'Protected control-plane view of conformance evidence for a target business. Conformance evidence does not approve a source without an explicit source-governance transition.',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'businessId',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 1 }
          }
        ],
        responses: {
          '200': {
            description: 'Recent conformance runs for the business.',
            content: {
              'application/json': {
                schema: TargetBusinessConformanceListResponseSchema
              }
            }
          },
          '401': {
            description: 'Missing or invalid API key.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '403': {
            description: 'Valid API key without admin scope.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '404': {
            description: 'Business record was not found.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      },
      post: {
        summary: 'Run target-business conformance checks',
        description: 'Records protocol conformance evidence for a target business. Passing conformance is required evidence for future catalog/launch approval transitions, but it does not approve the source by itself.',
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: 'businessId',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 1 }
          }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: TargetBusinessConformanceTriggerRequestSchema
            }
          }
        },
        responses: {
          '200': {
            description: 'Conformance run was recorded.',
            content: {
              'application/json': {
                schema: TargetBusinessConformanceRunResponseSchema
              }
            }
          },
          '401': {
            description: 'Missing or invalid API key.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '403': {
            description: 'Valid API key without admin scope.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '413': {
            description: 'Request body exceeds the configured size limit.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '415': {
            description: 'Request body content type is not supported.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          },
          '422': {
            description: 'Conformance request failed API contract validation or linked-observation validation.',
            content: {
              'application/json': {
                schema: ApiErrorSchema
              }
            }
          }
        }
      }
    }

  }
})
