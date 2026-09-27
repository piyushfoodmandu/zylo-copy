create table if not exists commerce_memory_proposals (
  proposal_id text primary key,
  status text not null check (status in ('pending_policy_review')),
  record_kind text not null check (record_kind in (
    'region',
    'currency',
    'size',
    'budget',
    'fulfillment_preference',
    'accepted_alternative',
    'rejected_alternative',
    'saved_product_reference',
    'comparison_reference',
    'cart_handoff_reference',
    'checkout_completion_reference',
    'decision_receipt_reference',
    'source_state_reference',
    'no_buy_warning',
    'stale_reference'
  )),
  integration_id text not null,
  external_subject_ref_hash text not null,
  external_task_ref_hash text,
  zylo_user_id text,
  decision_receipt_id text,
  source_id text,
  source_fact_type text,
  provenance_kind text not null check (provenance_kind in (
    'user_explicit',
    'agent_proposed',
    'receipt_derived',
    'source_refresh',
    'typed_migration'
  )),
  retention_class text not null check (retention_class in (
    'session_only',
    'user_controlled',
    'time_limited',
    'receipt_bound'
  )),
  prompt_exposure_class text not null check (prompt_exposure_class in (
    'never_prompt',
    'summary_only',
    'retrieval_allowed'
  )),
  consent_basis text not null check (consent_basis in (
    'explicit_user_request',
    'session_policy',
    'zylo_account_setting',
    'typed_migration_authorization'
  )),
  consent_granted_at timestamptz not null,
  mutation_reason text not null,
  proposed_at timestamptz not null,
  expires_at timestamptz,
  proposal_value jsonb not null,
  provenance jsonb not null,
  consent jsonb not null,
  source_label jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_memory_proposals_id_not_blank check (length(trim(proposal_id)) > 0),
  constraint commerce_memory_proposals_integration_not_blank check (length(trim(integration_id)) > 0),
  constraint commerce_memory_proposals_subject_hash_format check (external_subject_ref_hash ~ '^[a-f0-9]{64}$'),
  constraint commerce_memory_proposals_task_hash_format check (external_task_ref_hash is null or external_task_ref_hash ~ '^[a-f0-9]{64}$'),
  constraint commerce_memory_proposals_reason_not_blank check (length(trim(mutation_reason)) > 0),
  constraint commerce_memory_proposals_value_object check (jsonb_typeof(proposal_value) = 'object'),
  constraint commerce_memory_proposals_provenance_object check (jsonb_typeof(provenance) = 'object'),
  constraint commerce_memory_proposals_consent_object check (jsonb_typeof(consent) = 'object'),
  constraint commerce_memory_proposals_source_label_object check (source_label is null or jsonb_typeof(source_label) = 'object'),
  constraint commerce_memory_proposals_time_limited_expiry check (retention_class <> 'time_limited' or expires_at is not null)
);

create index if not exists commerce_memory_proposals_scope_idx
  on commerce_memory_proposals (integration_id, external_subject_ref_hash, status, created_at desc);

create index if not exists commerce_memory_proposals_record_kind_idx
  on commerce_memory_proposals (record_kind, status, created_at desc);

create index if not exists commerce_memory_proposals_receipt_idx
  on commerce_memory_proposals (decision_receipt_id, created_at desc)
  where decision_receipt_id is not null;

create index if not exists commerce_memory_proposals_expiry_idx
  on commerce_memory_proposals (expires_at)
  where expires_at is not null;
