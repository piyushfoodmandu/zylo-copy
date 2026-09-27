create unique index if not exists commerce_memory_policy_reviews_review_proposal_decision_idx
  on commerce_memory_proposal_policy_reviews (review_id, proposal_id, decision);

create table if not exists commerce_memory_records (
  record_id text primary key,
  proposal_id text not null unique references commerce_memory_proposals(proposal_id) on delete cascade,
  policy_review_id text not null,
  policy_review_decision text not null check (policy_review_decision = 'approved_for_commit'),
  status text not null check (status in ('active')),
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
  mutation_reason text not null,
  committed_at timestamptz not null,
  expires_at timestamptz,
  record_value jsonb not null,
  provenance jsonb not null,
  consent jsonb not null,
  source_label jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_memory_records_approved_review_fk
    foreign key (policy_review_id, proposal_id, policy_review_decision)
    references commerce_memory_proposal_policy_reviews(review_id, proposal_id, decision),
  constraint commerce_memory_records_id_not_blank check (length(trim(record_id)) > 0),
  constraint commerce_memory_records_proposal_not_blank check (length(trim(proposal_id)) > 0),
  constraint commerce_memory_records_review_not_blank check (length(trim(policy_review_id)) > 0),
  constraint commerce_memory_records_integration_not_blank check (length(trim(integration_id)) > 0),
  constraint commerce_memory_records_subject_hash_format check (external_subject_ref_hash ~ '^[a-f0-9]{64}$'),
  constraint commerce_memory_records_task_hash_format check (external_task_ref_hash is null or external_task_ref_hash ~ '^[a-f0-9]{64}$'),
  constraint commerce_memory_records_reason_not_blank check (length(trim(mutation_reason)) > 0),
  constraint commerce_memory_records_value_object check (jsonb_typeof(record_value) = 'object'),
  constraint commerce_memory_records_provenance_object check (jsonb_typeof(provenance) = 'object'),
  constraint commerce_memory_records_consent_object check (jsonb_typeof(consent) = 'object'),
  constraint commerce_memory_records_source_label_object check (source_label is null or jsonb_typeof(source_label) = 'object'),
  constraint commerce_memory_records_time_limited_expiry check (retention_class <> 'time_limited' or expires_at is not null)
);

create index if not exists commerce_memory_records_scope_idx
  on commerce_memory_records (
    integration_id,
    external_subject_ref_hash,
    status,
    record_kind,
    committed_at desc
  );

create index if not exists commerce_memory_records_receipt_idx
  on commerce_memory_records (decision_receipt_id, status, committed_at desc)
  where decision_receipt_id is not null;

create index if not exists commerce_memory_records_source_idx
  on commerce_memory_records (source_id, source_fact_type, status, committed_at desc)
  where source_id is not null;

create index if not exists commerce_memory_records_expiry_idx
  on commerce_memory_records (expires_at)
  where expires_at is not null;
