alter table checkout_handoff_receipts
  drop constraint if exists checkout_handoff_receipts_state_check;

alter table checkout_handoff_receipts
  add constraint checkout_handoff_receipts_state_check check (
    state in (
      'handed_off',
      'requires_buyer_input',
      'requires_buyer_review',
      'ready_for_complete',
      'complete_in_progress',
      'completion_unknown',
      'completed',
      'expired',
      'canceled',
      'unavailable',
      'reconciliation_required'
    )
  );

alter table checkout_handoff_receipts
  add column if not exists completion_evidence_type text,
  add column if not exists completion_authority_identity text,
  add column if not exists completion_reference_hash text,
  add column if not exists completion_evidence_at timestamptz,
  add column if not exists completion_evidence_verified_at timestamptz,
  add column if not exists completion_source_profile_hash text,
  add column if not exists completion_source_profile_version text,
  add column if not exists completion_evidence_writer text;

update checkout_handoff_receipts
set state = 'reconciliation_required',
    updated_at = now()
where state = 'completed'
  and (
    authoritative_order_reference_hash is null
    or completion_evidence_type is null
    or completion_authority_identity is null
    or completion_reference_hash is null
    or completion_evidence_at is null
    or completion_evidence_verified_at is null
    or completion_evidence_writer is null
  );

alter table checkout_handoff_receipts
  drop constraint if exists checkout_handoff_completion_evidence_type_check,
  drop constraint if exists checkout_handoff_completion_evidence_writer_check,
  drop constraint if exists checkout_handoff_completion_reference_hash_check,
  drop constraint if exists checkout_handoff_completion_source_hash_check,
  drop constraint if exists checkout_handoff_completion_evidence_required_check,
  drop constraint if exists checkout_handoff_noncompletion_evidence_absent_check;

alter table checkout_handoff_receipts
  add constraint checkout_handoff_completion_evidence_type_check check (
    completion_evidence_type is null
    or completion_evidence_type in (
      'merchant_order',
      'provider_order',
      'source_order',
      'payment_provider'
    )
  ),
  add constraint checkout_handoff_completion_evidence_writer_check check (
    completion_evidence_writer is null
    or completion_evidence_writer in (
      'trusted_reconciliation',
      'direct_completion'
    )
  ),
  add constraint checkout_handoff_completion_reference_hash_check check (
    completion_reference_hash is null
    or completion_reference_hash ~ '^sha256:[0-9a-f]{64}$'
    or completion_reference_hash ~ '^hmac_sha256:[0-9a-f]{64}$'
  ),
  add constraint checkout_handoff_completion_source_hash_check check (
    completion_source_profile_hash is null
    or completion_source_profile_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  add constraint checkout_handoff_completion_evidence_required_check check (
    state <> 'completed'
    or (
      completion_evidence_type is not null
      and length(trim(completion_authority_identity)) > 0
      and completion_reference_hash is not null
      and completion_evidence_at is not null
      and completion_evidence_verified_at is not null
      and completion_evidence_writer is not null
      and completion_evidence_verified_at >= completion_evidence_at
    )
  ),
  add constraint checkout_handoff_noncompletion_evidence_absent_check check (
    state = 'completed'
    or (
      completion_evidence_type is null
      and completion_authority_identity is null
      and completion_reference_hash is null
      and completion_evidence_at is null
      and completion_evidence_verified_at is null
      and completion_source_profile_hash is null
      and completion_source_profile_version is null
      and completion_evidence_writer is null
    )
  );

create index if not exists checkout_handoff_receipts_completion_evidence_idx
  on checkout_handoff_receipts (business_id, completion_reference_hash)
  where state = 'completed';
