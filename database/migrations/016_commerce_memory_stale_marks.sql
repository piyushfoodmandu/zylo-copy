alter table commerce_memory_records
  drop constraint if exists commerce_memory_records_status_check;

alter table commerce_memory_records
  add constraint commerce_memory_records_status_check
  check (status in ('active', 'stale'));

create table if not exists commerce_memory_record_stale_marks (
  stale_mark_id text primary key,
  record_id text not null unique references commerce_memory_records(record_id) on delete cascade,
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
  marked_stale_at timestamptz not null,
  stale_value jsonb not null,
  source_label jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_memory_stale_marks_id_not_blank check (length(trim(stale_mark_id)) > 0),
  constraint commerce_memory_stale_marks_record_not_blank check (length(trim(record_id)) > 0),
  constraint commerce_memory_stale_marks_integration_not_blank check (length(trim(integration_id)) > 0),
  constraint commerce_memory_stale_marks_subject_hash_format check (external_subject_ref_hash ~ '^[a-f0-9]{64}$'),
  constraint commerce_memory_stale_marks_task_hash_format check (external_task_ref_hash is null or external_task_ref_hash ~ '^[a-f0-9]{64}$'),
  constraint commerce_memory_stale_marks_reason_not_blank check (length(trim(refresh_reason_code)) > 0),
  constraint commerce_memory_stale_marks_value_object check (jsonb_typeof(stale_value) = 'object'),
  constraint commerce_memory_stale_marks_source_label_object check (source_label is null or jsonb_typeof(source_label) = 'object')
);

create index if not exists commerce_memory_records_stale_idx
  on commerce_memory_records (status, updated_at desc)
  where status = 'stale';

create index if not exists commerce_memory_stale_marks_scope_idx
  on commerce_memory_record_stale_marks (
    integration_id,
    external_subject_ref_hash,
    reference_record_kind,
    marked_stale_at desc
  );

create index if not exists commerce_memory_stale_marks_receipt_idx
  on commerce_memory_record_stale_marks (decision_receipt_id, marked_stale_at desc)
  where decision_receipt_id is not null;

create index if not exists commerce_memory_stale_marks_source_idx
  on commerce_memory_record_stale_marks (source_id, source_fact_type, marked_stale_at desc)
  where source_id is not null;
