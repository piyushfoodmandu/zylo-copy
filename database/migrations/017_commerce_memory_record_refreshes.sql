create table if not exists commerce_memory_record_refreshes (
  refresh_id text primary key,
  superseded_record_id text not null unique references commerce_memory_records(record_id) on delete cascade,
  replacement_record_id text not null unique references commerce_memory_records(record_id) on delete cascade,
  stale_mark_id text not null unique references commerce_memory_record_stale_marks(stale_mark_id) on delete cascade,
  replacement_proposal_id text not null references commerce_memory_proposals(proposal_id) on delete cascade,
  replacement_policy_review_id text not null references commerce_memory_proposal_policy_reviews(review_id) on delete cascade,
  reference_record_kind text not null check (reference_record_kind in (
    'saved_product_reference',
    'comparison_reference',
    'cart_handoff_reference',
    'checkout_completion_reference',
    'decision_receipt_reference',
    'source_state_reference'
  )),
  integration_id text not null,
  external_subject_ref_hash text not null,
  external_task_ref_hash text,
  zylo_user_id text,
  decision_receipt_id text,
  source_id text,
  source_fact_type text,
  refresh_reason_code text not null,
  refreshed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint commerce_memory_refreshes_id_not_blank check (length(trim(refresh_id)) > 0),
  constraint commerce_memory_refreshes_superseded_not_blank check (length(trim(superseded_record_id)) > 0),
  constraint commerce_memory_refreshes_replacement_not_blank check (length(trim(replacement_record_id)) > 0),
  constraint commerce_memory_refreshes_distinct_records check (superseded_record_id <> replacement_record_id),
  constraint commerce_memory_refreshes_integration_not_blank check (length(trim(integration_id)) > 0),
  constraint commerce_memory_refreshes_subject_hash_format check (external_subject_ref_hash ~ '^[a-f0-9]{64}$'),
  constraint commerce_memory_refreshes_task_hash_format check (external_task_ref_hash is null or external_task_ref_hash ~ '^[a-f0-9]{64}$'),
  constraint commerce_memory_refreshes_reason_not_blank check (length(trim(refresh_reason_code)) > 0)
);

create index if not exists commerce_memory_refreshes_scope_idx
  on commerce_memory_record_refreshes (
    integration_id,
    external_subject_ref_hash,
    reference_record_kind,
    refreshed_at desc
  );

create index if not exists commerce_memory_refreshes_receipt_idx
  on commerce_memory_record_refreshes (decision_receipt_id, refreshed_at desc)
  where decision_receipt_id is not null;

create index if not exists commerce_memory_refreshes_source_idx
  on commerce_memory_record_refreshes (source_id, source_fact_type, refreshed_at desc)
  where source_id is not null;
