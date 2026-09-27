import { describe, expect, it } from 'vitest'
import { Value } from '@sinclair/typebox/value'
import {
  ArroPlatformProfileSchema,
  collectUcpPlatformProfileAuthorityFailures,
  reverseDnsAuthorityPrefixFromHostname,
  validateUcpNamespaceSchemaAuthority,
  type ArroPlatformProfile
} from './platform-profile.ts'

describe('UCP namespace authority binding', () => {
  it('accepts the tagged platform profile requiredness and schema-less A2A binding', () => {
    const profile: ArroPlatformProfile = {
      ucp: {
        version: '2026-08-25',
        services: {
          'dev.ucp.shopping': [{
            version: '2026-08-25',
            spec: 'https://ucp.dev/2026-08-25/specification/overview',
            transport: 'a2a'
          }]
        },
        payment_handlers: {}
      }
    }

    expect(Value.Check(ArroPlatformProfileSchema, profile)).toBe(true)
    expect(collectUcpPlatformProfileAuthorityFailures(profile)).toEqual([])
  })

  it('accepts namespaces served from their reverse-DNS schema authority', () => {
    expect(reverseDnsAuthorityPrefixFromHostname('ucp.dev')).toBe('dev.ucp')
    expect(
      validateUcpNamespaceSchemaAuthority(
        'dev.ucp.shopping.checkout',
        'https://ucp.dev/2026-08-25/schemas/shopping/checkout.json'
      )
    ).toMatchObject({
      ok: true,
      namespace: 'dev.ucp.shopping.checkout',
      authorityPrefix: 'dev.ucp'
    })
    expect(
      validateUcpNamespaceSchemaAuthority(
        'dev.shopify.catalog.global',
        'https://shopify.dev/ucp/schemas/2026-08-25/shopify_catalog_global.json'
      )
    ).toMatchObject({
      ok: true,
      namespace: 'dev.shopify.catalog.global',
      authorityPrefix: 'dev.shopify'
    })
  })

  it('rejects schema URLs that cannot prove namespace authority', () => {
    expect(
      validateUcpNamespaceSchemaAuthority(
        'dev.shopify.catalog.global',
        'https://ucp.dev/2026-08-25/schemas/shopify_catalog_global.json'
      )
    ).toMatchObject({
      ok: false,
      failure: { code: 'namespace_authority_mismatch' }
    })
    expect(
      validateUcpNamespaceSchemaAuthority(
        'dev.ucp.shopping.checkout',
        'https://agent:secret@ucp.dev/2026-08-25/schemas/shopping/checkout.json'
      )
    ).toMatchObject({
      ok: false,
      failure: { code: 'schema_url_has_credentials' }
    })
  })

  it('accepts an exact namespace authority and rejects boundary, IP, and single-label confusion', () => {
    expect(
      validateUcpNamespaceSchemaAuthority(
        'com.google.pay',
        'https://pay.google.com/gp/p/ucp/schema.json'
      )
    ).toMatchObject({
      ok: true,
      namespace: 'com.google.pay',
      authorityPrefix: 'com.google.pay'
    })

    expect(
      validateUcpNamespaceSchemaAuthority(
        'dev.ucp.shopping.checkout',
        'https://shopping.ucp.dev/schemas/checkout.json'
      )
    ).toMatchObject({
      ok: true,
      namespace: 'dev.ucp.shopping.checkout',
      authorityPrefix: 'dev.ucp.shopping'
    })

    expect(
      validateUcpNamespaceSchemaAuthority(
        'com.google.pay',
        'https://schemas.pay.google.com/gp/p/ucp/schema.json'
      )
    ).toMatchObject({
      ok: false,
      failure: { code: 'namespace_authority_mismatch' }
    })

    expect(
      validateUcpNamespaceSchemaAuthority(
        'dev.ucpchecker.shopping',
        'https://ucp.dev/schema.json'
      )
    ).toMatchObject({
      ok: false,
      failure: { code: 'namespace_authority_mismatch' }
    })

    for (const schema of [
      'https://127.0.0.1/schema.json',
      'https://[::1]/schema.json',
      'https://localhost/schema.json'
    ]) {
      expect(
        validateUcpNamespaceSchemaAuthority('dev.ucp.shopping.checkout', schema)
      ).toMatchObject({
        ok: false,
        failure: { code: 'schema_url_host_invalid' }
      })
    }
  })

  it('checks payment-handler schema authority as part of platform-profile validation', () => {
    const profile: ArroPlatformProfile = {
      ucp: {
        version: '2026-08-25',
        services: {
          'dev.ucp.shopping': [{
            version: '2026-08-25',
            spec: 'https://ucp.dev/2026-08-25/specification/overview',
            transport: 'rest',
            schema: 'https://ucp.dev/2026-08-25/services/shopping/rest.openapi.json'
          }]
        },
        capabilities: {
          'dev.ucp.shopping.checkout': [{
            version: '2026-08-25',
            spec: 'https://ucp.dev/2026-08-25/specification/shopping/checkout',
            schema: 'https://ucp.dev/2026-08-25/schemas/shopping/checkout.json'
          }]
        },
        payment_handlers: {
          'com.google.pay': [{
            id: 'google-pay',
            version: '2026-01-23',
            spec: 'https://pay.google.com/about/business/',
            schema: 'https://evil.example/google-pay.json'
          }]
        }
      }
    }

    expect(collectUcpPlatformProfileAuthorityFailures(profile)).toEqual([
      expect.objectContaining({
        namespace: 'com.google.pay',
        code: 'namespace_authority_mismatch'
      })
    ])
  })

})
