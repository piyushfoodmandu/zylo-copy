import { createHmac } from 'node:crypto'
import type {
  CommerceMemoryProposal,
  CommerceMemoryProposalValidationIssue,
  CommerceMemoryProposalValidationResult
} from '@arro/contracts'
import type { Queryable } from './target-business-repository.ts'

export type CommerceMemoryPendingProposalStatus = 'pending_policy_review'

export type CommerceMemoryPendingProposalSummary = {
  proposalId: string
  status: CommerceMemoryPendingProposalStatus
  recordKind: CommerceMemoryProposal['recordKind']
  queuedAt: string
  scope: {
    integrationId: string
    hasExternalSubjectRef: boolean
    hasExternalTaskRef: boolean
    hasArroUserId: boolean
    hasDecisionReceiptId: boolean
    hasSourceLabel: boolean
  }
  provenance: {
    kind: CommerceMemoryProposal['provenance']['kind']
    hasEvidenceRef: boolean
    hasAdapterId: boolean
    hasSourceRecordRef: boolean
  }
  retentionClass: CommerceMemoryProposal['retentionClass']
  promptExposureClass: CommerceMemoryProposal['promptExposureClass']
}

export type CommerceMemoryStoredProposal = {
  proposalId: string
  status: CommerceMemoryPendingProposalStatus
  proposal: Omit<CommerceMemoryProposal, 'scope'> & {
    scope: Omit<CommerceMemoryProposal['scope'], 'externalSubjectRef' | 'externalTaskRef'> & {
      externalSubjectRefHash: string
      externalTaskRefHash?: string
    }
  }
  summary: CommerceMemoryPendingProposalSummary
}

export type CommerceMemoryProposalStoreIssueCode =
  | 'duplicate_proposal'
  | 'hash_pepper_required'

export type CommerceMemoryProposalStoreIssue = {
  code: CommerceMemoryProposalStoreIssueCode
  message: string
  path?: string
}

export type StoreCommerceMemoryProposalResult =
  | {
      stored: true
      entry: CommerceMemoryPendingProposalSummary
    }
  | {
      stored: false
      status: 'rejected'
      issues: Array<CommerceMemoryProposalValidationIssue | CommerceMemoryProposalStoreIssue>
    }

type CommerceMemoryProposalRow = {
  proposal_id: string
  status: CommerceMemoryPendingProposalStatus
  record_kind: CommerceMemoryProposal['recordKind']
  integration_id: string
  external_subject_ref_hash: string
  external_task_ref_hash: string | null
  arro_user_id: string | null
  decision_receipt_id: string | null
  source_id: string | null
  source_fact_type: string | null
  provenance_kind: CommerceMemoryProposal['provenance']['kind']
  retention_class: CommerceMemoryProposal['retentionClass']
  prompt_exposure_class: CommerceMemoryProposal['promptExposureClass']
  consent_basis: CommerceMemoryProposal['consent']['basis']
  consent_granted_at: Date | string
  mutation_reason: string
  proposed_at: Date | string
  expires_at: Date | string | null
  proposal_value: CommerceMemoryProposal['value']
  provenance: CommerceMemoryProposal['provenance']
  consent: CommerceMemoryProposal['consent']
  source_label: CommerceMemoryProposal['scope']['sourceLabel'] | null
  created_at: Date | string
}

export const minCommerceMemoryHashPepperLength = 32

const toIso = (value: Date | string | null | undefined) => {
  if (!value) return undefined

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp from commerce memory proposal storage: ${value}`)
  }

  return date.toISOString()
}

export const hashCommerceMemoryScopeRef = (value: string, pepper: string) =>
  createHmac('sha256', pepper).update(value, 'utf8').digest('hex')

const hashPepperIssue = (): CommerceMemoryProposalStoreIssue => ({
  code: 'hash_pepper_required',
  path: '/hashPepper',
  message: 'A production hash pepper with at least 32 characters is required to store commerce memory proposals.'
})

const duplicateIssue = (): CommerceMemoryProposalStoreIssue => ({
  code: 'duplicate_proposal',
  path: '/proposalId',
  message: 'Commerce memory proposal is already pending policy review.'
})

const pendingProposalSummary = ({
  proposal,
  queuedAt
}: {
  proposal: CommerceMemoryProposal
  queuedAt: string
}): CommerceMemoryPendingProposalSummary => ({
  proposalId: proposal.proposalId,
  status: 'pending_policy_review',
  recordKind: proposal.recordKind,
  queuedAt,
  scope: {
    integrationId: proposal.scope.integrationId,
    hasExternalSubjectRef: true,
    hasExternalTaskRef: Boolean(proposal.scope.externalTaskRef),
    hasArroUserId: Boolean(proposal.scope.arroUserId),
    hasDecisionReceiptId: Boolean(proposal.scope.decisionReceiptId),
    hasSourceLabel: Boolean(proposal.scope.sourceLabel)
  },
  provenance: {
    kind: proposal.provenance.kind,
    hasEvidenceRef: Boolean(proposal.provenance.evidenceRef),
    hasAdapterId: Boolean(proposal.provenance.adapterId),
    hasSourceRecordRef: Boolean(proposal.provenance.sourceRecordRef)
  },
  retentionClass: proposal.retentionClass,
  promptExposureClass: proposal.promptExposureClass
})

const rowToSummary = (row: CommerceMemoryProposalRow): CommerceMemoryPendingProposalSummary => ({
  proposalId: row.proposal_id,
  status: row.status,
  recordKind: row.record_kind,
  queuedAt: toIso(row.created_at)!,
  scope: {
    integrationId: row.integration_id,
    hasExternalSubjectRef: true,
    hasExternalTaskRef: Boolean(row.external_task_ref_hash),
    hasArroUserId: Boolean(row.arro_user_id),
    hasDecisionReceiptId: Boolean(row.decision_receipt_id),
    hasSourceLabel: Boolean(row.source_id || row.source_label)
  },
  provenance: {
    kind: row.provenance_kind,
    hasEvidenceRef: Boolean(row.provenance.evidenceRef),
    hasAdapterId: Boolean(row.provenance.adapterId),
    hasSourceRecordRef: Boolean(row.provenance.sourceRecordRef)
  },
  retentionClass: row.retention_class,
  promptExposureClass: row.prompt_exposure_class
})

const rowToStoredProposal = (row: CommerceMemoryProposalRow): CommerceMemoryStoredProposal => {
  const sourceLabel = row.source_label ?? undefined
  const expiresAt = toIso(row.expires_at)

  return {
    proposalId: row.proposal_id,
    status: row.status,
    proposal: {
      proposalId: row.proposal_id,
      recordKind: row.record_kind,
      scope: {
        integrationId: row.integration_id,
        externalSubjectRefHash: row.external_subject_ref_hash,
        ...(row.external_task_ref_hash
          ? { externalTaskRefHash: row.external_task_ref_hash }
          : {}),
        ...(row.arro_user_id ? { arroUserId: row.arro_user_id } : {}),
        ...(row.decision_receipt_id ? { decisionReceiptId: row.decision_receipt_id } : {}),
        ...(sourceLabel ? { sourceLabel } : {})
      },
      provenance: row.provenance,
      consent: row.consent,
      retentionClass: row.retention_class,
      promptExposureClass: row.prompt_exposure_class,
      mutationReason: row.mutation_reason,
      proposedAt: toIso(row.proposed_at)!,
      ...(expiresAt ? { expiresAt } : {}),
      value: row.proposal_value
    },
    summary: rowToSummary(row)
  }
}

export const storeValidatedCommerceMemoryProposal = async ({
  client,
  validationResult,
  hashPepper,
  queuedAt = new Date()
}: {
  client: Queryable
  validationResult: CommerceMemoryProposalValidationResult
  hashPepper: string | undefined
  queuedAt?: Date
}): Promise<StoreCommerceMemoryProposalResult> => {
  if (!validationResult.accepted) {
    return {
      stored: false,
      status: 'rejected',
      issues: validationResult.issues
    }
  }

  if (!hashPepper || hashPepper.length < minCommerceMemoryHashPepperLength) {
    return {
      stored: false,
      status: 'rejected',
      issues: [hashPepperIssue()]
    }
  }

  const { proposal } = validationResult
  const sourceLabel = proposal.scope.sourceLabel
  const externalSubjectRefHash = hashCommerceMemoryScopeRef(
    proposal.scope.externalSubjectRef,
    hashPepper
  )
  const externalTaskRefHash = proposal.scope.externalTaskRef
    ? hashCommerceMemoryScopeRef(proposal.scope.externalTaskRef, hashPepper)
    : undefined
  const queuedAtIso = queuedAt.toISOString()
  const result = await client.query<{ proposal_id: string }>(
    `
      insert into commerce_memory_proposals (
        proposal_id,
        status,
        record_kind,
        integration_id,
        external_subject_ref_hash,
        external_task_ref_hash,
        arro_user_id,
        decision_receipt_id,
        source_id,
        source_fact_type,
        provenance_kind,
        retention_class,
        prompt_exposure_class,
        consent_basis,
        consent_granted_at,
        mutation_reason,
        proposed_at,
        expires_at,
        proposal_value,
        provenance,
        consent,
        source_label,
        created_at,
        updated_at
      ) values (
        $1,
        'pending_policy_review',
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
        $16,
        $17,
        $18::jsonb,
        $19::jsonb,
        $20::jsonb,
        $21::jsonb,
        $22,
        $22
      )
      on conflict (proposal_id) do nothing
      returning proposal_id
    `,
    [
      proposal.proposalId,
      proposal.recordKind,
      proposal.scope.integrationId,
      externalSubjectRefHash,
      externalTaskRefHash ?? null,
      proposal.scope.arroUserId ?? null,
      proposal.scope.decisionReceiptId ?? null,
      sourceLabel?.sourceId ?? null,
      sourceLabel?.factType ?? null,
      proposal.provenance.kind,
      proposal.retentionClass,
      proposal.promptExposureClass,
      proposal.consent.basis,
      proposal.consent.grantedAt,
      proposal.mutationReason,
      proposal.proposedAt,
      proposal.expiresAt ?? null,
      proposal.value,
      proposal.provenance,
      proposal.consent,
      sourceLabel ?? null,
      queuedAtIso
    ]
  )

  if ((result.rowCount ?? 0) === 0) {
    return {
      stored: false,
      status: 'rejected',
      issues: [duplicateIssue()]
    }
  }

  return {
    stored: true,
    entry: pendingProposalSummary({
      proposal,
      queuedAt: queuedAtIso
    })
  }
}

export const readPendingCommerceMemoryProposal = async (
  client: Queryable,
  proposalId: string
) => {
  const result = await client.query<CommerceMemoryProposalRow>(
    `
      select
        proposal_id,
        status,
        record_kind,
        integration_id,
        external_subject_ref_hash,
        external_task_ref_hash,
        arro_user_id,
        decision_receipt_id,
        source_id,
        source_fact_type,
        provenance_kind,
        retention_class,
        prompt_exposure_class,
        consent_basis,
        consent_granted_at,
        mutation_reason,
        proposed_at,
        expires_at,
        proposal_value,
        provenance,
        consent,
        source_label,
        created_at
      from commerce_memory_proposals
      where proposal_id = $1
        and status = 'pending_policy_review'
      limit 1
    `,
    [proposalId]
  )
  const row = result.rows[0]

  return row ? rowToStoredProposal(row) : undefined
}

export const listPendingCommerceMemoryProposalSummaries = async (
  client: Queryable,
  {
    integrationId,
    externalSubjectRef,
    hashPepper,
    limit = 50
  }: {
    integrationId: string
    externalSubjectRef: string
    hashPepper: string
    limit?: number
  }
) => {
  const externalSubjectRefHash = hashCommerceMemoryScopeRef(externalSubjectRef, hashPepper)
  const result = await client.query<CommerceMemoryProposalRow>(
    `
      select
        proposal_id,
        status,
        record_kind,
        integration_id,
        external_subject_ref_hash,
        external_task_ref_hash,
        arro_user_id,
        decision_receipt_id,
        source_id,
        source_fact_type,
        provenance_kind,
        retention_class,
        prompt_exposure_class,
        consent_basis,
        consent_granted_at,
        mutation_reason,
        proposed_at,
        expires_at,
        proposal_value,
        provenance,
        consent,
        source_label,
        created_at
      from commerce_memory_proposals
      where integration_id = $1
        and external_subject_ref_hash = $2
        and status = 'pending_policy_review'
      order by created_at desc, proposal_id asc
      limit $3
    `,
    [
      integrationId,
      externalSubjectRefHash,
      Math.min(Math.max(Math.trunc(limit), 1), 100)
    ]
  )

  return result.rows.map(rowToSummary)
}
