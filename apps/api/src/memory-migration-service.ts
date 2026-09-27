import {
  validateCommerceMemoryMigrationImport,
  validateCommerceMemoryProposal,
  type CommerceMemoryMigrationImport,
  type CommerceMemoryMigrationImportValidationIssue,
  type CommerceMemoryProposalValidationIssue
} from '@arro/contracts'
import {
  hashCommerceMemoryScopeRef,
  minCommerceMemoryHashPepperLength,
  storeValidatedCommerceMemoryProposal,
  type CommerceMemoryProposalStoreIssue
} from './memory-proposal-service.ts'
import type { Queryable } from './target-business-repository.ts'

type ExistingMigrationImportRow = {
  import_id: string
}

export type CommerceMemoryMigrationImportSummary = {
  importId: string
  proposalId: string
  importStatus: 'queued_for_policy_review'
  adapter: {
    adapterId: string
    sourceKind: CommerceMemoryMigrationImport['adapter']['sourceKind']
    sourceSystem: string
  }
  recordKind: CommerceMemoryMigrationImport['proposal']['recordKind']
  importedAt: string
  scope: {
    integrationId: string
    hasExternalSubjectRef: boolean
    hasExternalTaskRef: boolean
  }
}

export type CommerceMemoryMigrationImportStoreIssueCode =
  | 'duplicate_import'
  | 'hash_pepper_required'
  | 'import_record_not_stored'

export type CommerceMemoryMigrationImportStoreIssue = {
  code: CommerceMemoryMigrationImportStoreIssueCode
  message: string
  path?: string
}

type StoredMigrationImportIssue =
  | CommerceMemoryProposalStoreIssue
  | CommerceMemoryProposalValidationIssue
  | CommerceMemoryMigrationImportStoreIssue

export type StoreCommerceMemoryMigrationImportResult =
  | {
      imported: true
      entry: CommerceMemoryMigrationImportSummary
    }
  | {
      imported: false
      status: 'rejected'
      issues: Array<
        | CommerceMemoryMigrationImportValidationIssue
        | CommerceMemoryProposalValidationIssue
        | CommerceMemoryProposalStoreIssue
        | CommerceMemoryMigrationImportStoreIssue
      >
    }

const hashPepperIssue = (): CommerceMemoryMigrationImportStoreIssue => ({
  code: 'hash_pepper_required',
  path: '/hashPepper',
  message: 'A production hash pepper with at least 32 characters is required to import typed commerce memory.'
})

const duplicateImportIssue = (): CommerceMemoryMigrationImportStoreIssue => ({
  code: 'duplicate_import',
  path: '/importId',
  message: 'Typed commerce memory migration import is already recorded.'
})

const importRecordNotStoredIssue = (): CommerceMemoryMigrationImportStoreIssue => ({
  code: 'import_record_not_stored',
  path: '/importId',
  message: 'Typed commerce memory migration import metadata was not recorded.'
})

const issueRows = (issues: StoredMigrationImportIssue[]) =>
  issues.map((nestedIssue) => ({
    code: nestedIssue.code,
    message: nestedIssue.message,
    ...(nestedIssue.path ? { path: nestedIssue.path } : {})
  }))

const migrationImportSummary = (
  migrationImport: CommerceMemoryMigrationImport
): CommerceMemoryMigrationImportSummary => ({
  importId: migrationImport.importId,
  proposalId: migrationImport.proposal.proposalId,
  importStatus: 'queued_for_policy_review',
  adapter: {
    adapterId: migrationImport.adapter.adapterId,
    sourceKind: migrationImport.adapter.sourceKind,
    sourceSystem: migrationImport.adapter.sourceSystem
  },
  recordKind: migrationImport.proposal.recordKind,
  importedAt: migrationImport.importedAt,
  scope: {
    integrationId: migrationImport.proposal.scope.integrationId,
    hasExternalSubjectRef: true,
    hasExternalTaskRef: Boolean(migrationImport.proposal.scope.externalTaskRef)
  }
})

const existingMigrationImport = async ({
  client,
  migrationImport,
  sourceRecordRefHash,
  externalSubjectRefHash
}: {
  client: Queryable
  migrationImport: CommerceMemoryMigrationImport
  sourceRecordRefHash: string
  externalSubjectRefHash: string
}) => {
  const result = await client.query<ExistingMigrationImportRow>(
    `
      select import_id
      from commerce_memory_migration_imports
      where import_id = $1
        or (
          adapter_id = $2
          and source_record_ref_hash = $3
          and integration_id = $4
          and external_subject_ref_hash = $5
        )
      limit 1
    `,
    [
      migrationImport.importId,
      migrationImport.adapter.adapterId,
      sourceRecordRefHash,
      migrationImport.proposal.scope.integrationId,
      externalSubjectRefHash
    ]
  )

  return result.rows[0]
}

const recordMigrationImport = async ({
  client,
  migrationImport,
  hashPepper,
  importStatus,
  issues,
  recordedAt
}: {
  client: Queryable
  migrationImport: CommerceMemoryMigrationImport
  hashPepper: string
  importStatus: 'queued_for_policy_review' | 'rejected'
  issues: StoredMigrationImportIssue[]
  recordedAt: Date
}) => {
  const proposal = migrationImport.proposal
  const sourceRecordRefHash = hashCommerceMemoryScopeRef(
    migrationImport.adapter.sourceRecordRef,
    hashPepper
  )
  const externalSubjectRefHash = hashCommerceMemoryScopeRef(
    proposal.scope.externalSubjectRef,
    hashPepper
  )
  const externalTaskRefHash = proposal.scope.externalTaskRef
    ? hashCommerceMemoryScopeRef(proposal.scope.externalTaskRef, hashPepper)
    : undefined
  const acceptedProposalId = importStatus === 'queued_for_policy_review'
    ? proposal.proposalId
    : null

  const result = await client.query<{ import_id: string }>(
    `
      insert into commerce_memory_migration_imports (
        import_id,
        import_status,
        proposal_id,
        accepted_proposal_id,
        adapter_id,
        source_kind,
        source_system,
        source_record_ref_hash,
        integration_id,
        external_subject_ref_hash,
        external_task_ref_hash,
        record_kind,
        retention_class,
        prompt_exposure_class,
        consent_basis,
        issues,
        imported_at,
        created_at,
        updated_at
      ) values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16::jsonb,
        $17,
        $18,
        $18
      )
      on conflict do nothing
      returning import_id
    `,
    [
      migrationImport.importId,
      importStatus,
      proposal.proposalId,
      acceptedProposalId,
      migrationImport.adapter.adapterId,
      migrationImport.adapter.sourceKind,
      migrationImport.adapter.sourceSystem,
      sourceRecordRefHash,
      proposal.scope.integrationId,
      externalSubjectRefHash,
      externalTaskRefHash ?? null,
      proposal.recordKind,
      proposal.retentionClass,
      proposal.promptExposureClass,
      proposal.consent.basis,
      JSON.stringify(issueRows(issues)),
      migrationImport.importedAt,
      recordedAt.toISOString()
    ]
  )

  return (result.rowCount ?? 0) > 0
}

export const storeCommerceMemoryMigrationImport = async ({
  transactionClient,
  migrationImport: migrationImportInput,
  hashPepper,
  recordedAt = new Date()
}: {
  transactionClient: Queryable
  migrationImport: unknown
  hashPepper: string | undefined
  recordedAt?: Date
}): Promise<StoreCommerceMemoryMigrationImportResult> => {
  const importValidation = validateCommerceMemoryMigrationImport(migrationImportInput)
  if (!importValidation.accepted) {
    return {
      imported: false,
      status: 'rejected',
      issues: importValidation.issues
    }
  }

  if (!hashPepper || hashPepper.length < minCommerceMemoryHashPepperLength) {
    return {
      imported: false,
      status: 'rejected',
      issues: [hashPepperIssue()]
    }
  }

  const migrationImport = importValidation.migrationImport
  const proposal = importValidation.proposal
  const sourceRecordRefHash = hashCommerceMemoryScopeRef(
    migrationImport.adapter.sourceRecordRef,
    hashPepper
  )
  const externalSubjectRefHash = hashCommerceMemoryScopeRef(
    proposal.scope.externalSubjectRef,
    hashPepper
  )

  await transactionClient.query('begin')

  const rollbackAndReturn = async (
    result: StoreCommerceMemoryMigrationImportResult
  ): Promise<StoreCommerceMemoryMigrationImportResult> => {
    await transactionClient.query('rollback')
    return result
  }

  try {
    const duplicate = await existingMigrationImport({
      client: transactionClient,
      migrationImport,
      sourceRecordRefHash,
      externalSubjectRefHash
    })
    if (duplicate) {
      return await rollbackAndReturn({
        imported: false,
        status: 'rejected',
        issues: [duplicateImportIssue()]
      })
    }

    const proposalForStorage = {
      ...proposal,
      provenance: {
        ...proposal.provenance,
        sourceRecordRef: sourceRecordRefHash
      }
    }
    const proposalStoreResult = await storeValidatedCommerceMemoryProposal({
      client: transactionClient,
      validationResult: validateCommerceMemoryProposal(proposalForStorage),
      hashPepper,
      queuedAt: recordedAt
    })
    const issues = proposalStoreResult.stored ? [] : proposalStoreResult.issues
    const importStatus = proposalStoreResult.stored
      ? 'queued_for_policy_review'
      : 'rejected'
    const importRecorded = await recordMigrationImport({
      client: transactionClient,
      migrationImport,
      hashPepper,
      importStatus,
      issues,
      recordedAt
    })

    if (!importRecorded) {
      return await rollbackAndReturn({
        imported: false,
        status: 'rejected',
        issues: [importRecordNotStoredIssue()]
      })
    }

    await transactionClient.query('commit')

    if (!proposalStoreResult.stored) {
      return {
        imported: false,
        status: 'rejected',
        issues
      }
    }

    return {
      imported: true,
      entry: migrationImportSummary(migrationImport)
    }
  } catch (error) {
    await transactionClient.query('rollback').catch(() => undefined)
    throw error
  }
}
