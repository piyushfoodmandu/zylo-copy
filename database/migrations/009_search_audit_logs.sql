create table if not exists search_audit_logs (
  id bigint generated always as identity primary key,
  request_id text not null,
  correlation_id text not null,
  route text not null check (route in ('/v1/catalog/search', '/v1/search/universal')),
  query_hash text not null,
  query_normalized text not null,
  source_mode text not null check (source_mode in ('approved_sources', 'sandbox', 'unconfigured')),
  search_state text not null check (search_state in ('ready', 'limited', 'unavailable')),
  allowed_business_ids text[] not null default '{}'::text[],
  result_count integer not null check (result_count >= 0),
  source_policy_message_code text not null,
  payout_fields_accessed boolean not null default false,
  commercial_fields_accessed boolean not null default false,
  commercial_isolation_version text not null,
  latency_ms integer not null check (latency_ms >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint search_audit_request_id_not_blank check (length(trim(request_id)) > 0),
  constraint search_audit_correlation_id_not_blank check (length(trim(correlation_id)) > 0),
  constraint search_audit_query_hash_not_blank check (length(trim(query_hash)) > 0),
  constraint search_audit_query_normalized_not_blank check (length(trim(query_normalized)) > 0),
  constraint search_audit_source_policy_code_not_blank check (length(trim(source_policy_message_code)) > 0),
  constraint search_audit_commercial_isolation_version_not_blank check (length(trim(commercial_isolation_version)) > 0),
  constraint search_audit_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists search_audit_logs_request_idx
  on search_audit_logs (request_id, created_at desc);

create index if not exists search_audit_logs_created_idx
  on search_audit_logs (created_at desc, id desc);

create index if not exists search_audit_logs_source_mode_idx
  on search_audit_logs (source_mode, search_state, created_at desc);

create index if not exists search_audit_logs_commercial_isolation_idx
  on search_audit_logs (created_at desc)
  where payout_fields_accessed = true or commercial_fields_accessed = true;