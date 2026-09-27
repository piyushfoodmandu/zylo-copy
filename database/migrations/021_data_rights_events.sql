create table if not exists data_rights_events (
  event_id text primary key,
  request_id text not null,
  correlation_id text not null,
  integration_id text not null,
  external_subject_ref_hash text not null,
  action text not null check (action in (
    'access',
    'export',
    'correction',
    'deletion'
  )),
  status text not null check (status in (
    'completed',
    'rejected'
  )),
  target_record_kind text not null check (target_record_kind in (
    'subject_scope',
    'decision_receipt',
    'checkout_attempt'
  )),
  target_record_id text,
  correction_payload jsonb,
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint data_rights_events_id_not_blank check (length(trim(event_id)) > 0),
  constraint data_rights_events_request_not_blank check (length(trim(request_id)) > 0),
  constraint data_rights_events_correlation_not_blank check (length(trim(correlation_id)) > 0),
  constraint data_rights_events_integration_not_blank check (length(trim(integration_id)) > 0),
  constraint data_rights_events_subject_hash_format check (external_subject_ref_hash ~ '^[a-f0-9]{64}$'),
  constraint data_rights_events_target_id_not_blank check (target_record_id is null or length(trim(target_record_id)) > 0),
  constraint data_rights_events_correction_object check (correction_payload is null or jsonb_typeof(correction_payload) = 'object'),
  constraint data_rights_events_summary_object check (jsonb_typeof(result_summary) = 'object'),
  constraint data_rights_events_correction_payload_required check (
    action <> 'correction' or correction_payload is not null
  ),
  constraint data_rights_events_target_record_id_required check (
    target_record_kind = 'subject_scope' or target_record_id is not null
  )
);

create index if not exists data_rights_events_scope_idx
  on data_rights_events (integration_id, external_subject_ref_hash, created_at desc);

create index if not exists data_rights_events_action_idx
  on data_rights_events (action, status, created_at desc);

create index if not exists data_rights_events_target_idx
  on data_rights_events (target_record_kind, target_record_id, created_at desc)
  where target_record_id is not null;
