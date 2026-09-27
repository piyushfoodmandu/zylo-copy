import { describe, expect, it } from 'vitest'
import {
  forbiddenCommerceMemoryFieldPaths,
  isCommerceMemoryProposal,
  validateCommerceMemoryMigrationImport,
  validateCommerceMemoryProposal
} from './memory.ts'

const timestamp = '2026-06-01T00:00:00.000Z'

const sourceLabel = {
  sourceId: 'approved-source-1',
  sourceName: 'Approved Source',
  factType: 'approved_catalog_product',
  fetchedAt: timestamp,
  expiresAt: '2026-06-01T00:15:00.000Z',
  freshnessClass: 'advisory_catalog',
  bindingStatus: 'advisory'
}

const baseProposal = {
  proposalId: 'memory-proposal-1',
  scope: {
    integrationId: 'chatgpt-demo',
    externalSubjectRef: 'opaque-user-ref-1',
    externalTaskRef: 'opaque-task-ref-1'
  },
  provenance: {
    kind: 'user_explicit',
    evidenceRef: 'intent-record-1'
  },
  consent: {
    userAuthorized: true,
    basis: 'explicit_user_request',
    grantedAt: timestamp
  },
  retentionClass: 'user_controlled',
  promptExposureClass: 'summary_only',
  mutationReason: 'User explicitly asked Arro to remember this typed commerce state.',
  proposedAt: timestamp
}

const productReference = {
  businessId: 'approved-source-1',
  businessName: 'Approved Source',
  productId: 'approved-product-1',
  variantId: 'approved-product-1-size-10',
  title: 'Approved Running Shoe',
  sourceLabel
}

const issueCodes = (value: unknown) =>
  validateCommerceMemoryProposal(value).issues.map((issue) => issue.code)

const migrationIssueCodes = (value: unknown) =>
  validateCommerceMemoryMigrationImport(value).issues.map((issue) => issue.code)

describe('commerce memory proposal contract', () => {
  it('accepts explicit typed preference memory without raw text authority', () => {
    const proposal = {
      ...baseProposal,
      recordKind: 'region',
      value: {
        region: 'US'
      }
    }

    expect(isCommerceMemoryProposal(proposal)).toBe(true)
    expect(validateCommerceMemoryProposal(proposal)).toMatchObject({
      accepted: true,
      issues: []
    })
  })

  it('accepts saved product references only as source-labeled typed memory', () => {
    const proposal = {
      ...baseProposal,
      proposalId: 'memory-proposal-2',
      scope: {
        ...baseProposal.scope,
        decisionReceiptId: 'decision-receipt-1',
        sourceLabel
      },
      recordKind: 'saved_product_reference',
      value: {
        product: productReference,
        reasonCode: 'user_saved',
        plainReason: 'Matches the requested budget and selected size.',
        decisionReceiptId: 'decision-receipt-1'
      }
    }

    expect(validateCommerceMemoryProposal(proposal)).toMatchObject({
      accepted: true,
      issues: []
    })
  })

  it('rejects raw transcript and arbitrary blob imports', () => {
    const proposal = {
      ...baseProposal,
      recordKind: 'region',
      value: {
        region: 'US'
      },
      rawTranscript: 'User: remember every message in this shopping session.',
      rawBlob: 'Unstructured memory payload from a host agent.'
    }

    expect(issueCodes(proposal)).toEqual(expect.arrayContaining([
      'forbidden_field',
      'schema_invalid'
    ]))
    expect(forbiddenCommerceMemoryFieldPaths(proposal)).toEqual(expect.arrayContaining([
      '/rawTranscript',
      '/rawBlob'
    ]))
  })

  it('rejects payment and commercial influence fields inside memory proposals', () => {
    const proposal = {
      ...baseProposal,
      recordKind: 'saved_product_reference',
      paymentMethodId: 'pm_hidden',
      value: {
        product: productReference,
        reasonCode: 'user_saved',
        paidPlacement: true,
        commissionRate: 0.14
      }
    }

    expect(issueCodes(proposal)).toEqual(expect.arrayContaining([
      'forbidden_field',
      'schema_invalid'
    ]))
    expect(forbiddenCommerceMemoryFieldPaths(proposal)).toEqual(expect.arrayContaining([
      '/paymentMethodId',
      '/value/paidPlacement',
      '/value/commissionRate'
    ]))
  })

  it('requires explicit typed migration authorization for third-party memory imports', () => {
    const migratedWithoutAuthorization = {
      ...baseProposal,
      proposalId: 'memory-proposal-3',
      provenance: {
        kind: 'typed_migration'
      },
      consent: {
        ...baseProposal.consent,
        basis: 'session_policy'
      },
      recordKind: 'currency',
      value: {
        currency: 'USD'
      }
    }

    expect(issueCodes(migratedWithoutAuthorization)).toEqual(expect.arrayContaining([
      'typed_migration_authorization_required',
      'typed_migration_adapter_required'
    ]))

    const authorizedMigration = {
      ...migratedWithoutAuthorization,
      provenance: {
        kind: 'typed_migration',
        adapterId: 'external-memory-adapter-1',
        sourceRecordRef: 'external-memory-record-1'
      },
      consent: {
        ...baseProposal.consent,
        basis: 'typed_migration_authorization'
      }
    }

    expect(validateCommerceMemoryProposal(authorizedMigration)).toMatchObject({
      accepted: true,
      issues: []
    })
  })

  it('accepts external memory imports only as typed migration proposal envelopes', () => {
    const importEnvelope = {
      importId: 'memory-migration-import-1',
      adapter: {
        adapterId: 'external-memory-adapter-1',
        sourceKind: 'external_memory_provider',
        sourceSystem: 'Example Memory',
        sourceRecordRef: 'external-memory-record-1'
      },
      importedAt: timestamp,
      proposal: {
        ...baseProposal,
        proposalId: 'memory-proposal-migration-1',
        provenance: {
          kind: 'typed_migration',
          adapterId: 'external-memory-adapter-1',
          sourceRecordRef: 'external-memory-record-1'
        },
        consent: {
          ...baseProposal.consent,
          basis: 'typed_migration_authorization'
        },
        recordKind: 'currency',
        value: {
          currency: 'USD'
        }
      }
    }

    expect(validateCommerceMemoryMigrationImport(importEnvelope)).toMatchObject({
      accepted: true,
      issues: []
    })
  })

  it('rejects external memory imports that are not typed migrations', () => {
    const importEnvelope = {
      importId: 'memory-migration-import-2',
      adapter: {
        adapterId: 'external-memory-adapter-1',
        sourceKind: 'host_memory',
        sourceSystem: 'Host Memory',
        sourceRecordRef: 'host-memory-record-1'
      },
      importedAt: timestamp,
      proposal: {
        ...baseProposal,
        proposalId: 'memory-proposal-migration-2',
        recordKind: 'region',
        value: {
          region: 'US'
        }
      }
    }

    expect(migrationIssueCodes(importEnvelope)).toEqual(expect.arrayContaining([
      'typed_migration_required',
      'migration_adapter_mismatch',
      'migration_source_record_mismatch',
      'typed_migration_authorization_required'
    ]))
  })

  it('rejects external memory imports that carry raw audio', () => {
    const importEnvelope = {
      importId: 'memory-migration-import-3',
      adapter: {
        adapterId: 'external-memory-adapter-1',
        sourceKind: 'agent_session_log',
        sourceSystem: 'Agent Session',
        sourceRecordRef: 'agent-session-record-1'
      },
      importedAt: timestamp,
      proposal: {
        ...baseProposal,
        proposalId: 'memory-proposal-migration-3',
        provenance: {
          kind: 'typed_migration',
          adapterId: 'external-memory-adapter-1',
          sourceRecordRef: 'agent-session-record-1'
        },
        consent: {
          ...baseProposal.consent,
          basis: 'typed_migration_authorization'
        },
        recordKind: 'currency',
        value: {
          currency: 'USD',
          rawAudio: 'base64-audio-should-not-enter-memory'
        }
      }
    }

    expect(migrationIssueCodes(importEnvelope)).toEqual(expect.arrayContaining([
      'forbidden_field',
      'schema_invalid'
    ]))
    expect(forbiddenCommerceMemoryFieldPaths(importEnvelope)).toContain('/proposal/value/rawAudio')
  })

  it('rejects external memory imports with mismatched adapter provenance', () => {
    const importEnvelope = {
      importId: 'memory-migration-import-4',
      adapter: {
        adapterId: 'external-memory-adapter-1',
        sourceKind: 'agent_session_log',
        sourceSystem: 'Agent Session',
        sourceRecordRef: 'agent-session-record-1'
      },
      importedAt: timestamp,
      proposal: {
        ...baseProposal,
        proposalId: 'memory-proposal-migration-4',
        provenance: {
          kind: 'typed_migration',
          adapterId: 'other-adapter',
          sourceRecordRef: 'agent-session-record-1'
        },
        consent: {
          ...baseProposal.consent,
          basis: 'typed_migration_authorization'
        },
        recordKind: 'currency',
        value: {
          currency: 'USD'
        }
      }
    }

    expect(migrationIssueCodes(importEnvelope)).toContain('migration_adapter_mismatch')
  })
})
