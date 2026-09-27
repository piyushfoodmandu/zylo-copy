import { describe, expect, it } from 'vitest'
import {
  parseUcpCheckerMerchantsCsv,
  selectUcpDirectoryPrecomputeCandidates
} from './verify-ucp-directory-precompute.ts'

describe('UCP directory precompute verifier', () => {
  it('parses UCPChecker merchant CSV rows with quoted transport JSON', () => {
    const rows = parseUcpCheckerMerchantsCsv(`domain,status,ucp_url,http_status,version,has_checkout,has_identity_linking,has_cart_management,has_order,has_payment_token,capability_count,ai_bot_policies,transports,last_checked_at,last_success_at
shop.example,verified,https://shop.example/.well-known/ucp,200,2026-08-25,1,0,1,1,0,4,"{}","[""MCP"",""REST""]",2026-04-02T00:00:00Z,2026-04-02T00:00:00Z
broken.example,invalid,https://broken.example/.well-known/ucp,500,2026-08-25,0,0,0,0,0,0,"{}","[]",2026-04-02T00:00:00Z,
`)

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      domain: 'shop.example',
      status: 'verified',
      httpStatus: 200,
      version: '2026-08-25',
      hasCheckout: true,
      hasCartManagement: true,
      hasOrder: true,
      capabilityCount: 4,
      transports: ['mcp', 'rest']
    })
  })

  it('selects verified live-candidate rows without treating the directory as authority', () => {
    const rows = parseUcpCheckerMerchantsCsv(`domain,status,ucp_url,http_status,version,has_checkout,has_identity_linking,has_cart_management,has_order,has_payment_token,capability_count,ai_bot_policies,transports,last_checked_at,last_success_at
catalog-only.example,verified,https://catalog-only.example/.well-known/ucp,200,2026-08-25,1,0,0,1,0,2,"{}","[""REST""]",2026-04-02T00:00:00Z,2026-04-02T00:00:00Z
commerce.example,verified,https://commerce.example/.well-known/ucp,200,2026-08-25,1,1,1,1,1,5,"{}","[""MCP""]",2026-04-02T00:00:00Z,2026-04-02T00:00:00Z
duplicate.example,verified,https://duplicate.example/.well-known/ucp,200,2026-08-25,1,0,1,1,0,3,"{}","[""MCP""]",2026-04-02T00:00:00Z,2026-04-02T00:00:00Z
duplicate.example,verified,https://duplicate.example/.well-known/ucp,200,2026-08-25,1,0,1,1,0,3,"{}","[""MCP""]",2026-04-02T00:00:00Z,2026-04-02T00:00:00Z
not-found.example,verified,https://not-found.example/.well-known/ucp,404,2026-08-25,1,0,1,1,0,3,"{}","[""MCP""]",2026-04-02T00:00:00Z,
`)

    const candidates = selectUcpDirectoryPrecomputeCandidates(rows, {
      limit: 5,
      requireTransport: 'mcp',
      requireCartManagement: true
    })

    expect(candidates.map((candidate) => candidate.domain)).toEqual([
      'commerce.example',
      'duplicate.example'
    ])
    expect(candidates[0]?.priority).toBeGreaterThan(candidates[1]?.priority ?? 0)
  })
})
