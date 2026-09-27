create table if not exists request_audit_log (
  id bigint generated always as identity primary key,
  request_id text not null,
  correlation_id text not null,
  principal_key_id text,
  owner_principal text,
  http_method text not null,
  http_path text not null,
  route_group text not null,
  http_status_code integer not null check (http_status_code between 100 and 599),
  decision text not null check (decision in (
    'allowed',
    'authentication_required',
    'invalid_api_key',
    'insufficient_scope',
    'authentication_unavailable'
  )),
  reason_code text not null,
  required_scopes text[] not null default '{}',
  latency_ms numeric(12, 3) not null check (latency_ms >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint request_audit_request_id_not_blank check (length(trim(request_id)) > 0),
  constraint request_audit_correlation_id_not_blank check (length(trim(correlation_id)) > 0),
  constraint request_audit_method_not_blank check (length(trim(http_method)) > 0),
  constraint request_audit_path_not_blank check (length(trim(http_path)) > 0),
  constraint request_audit_route_group_not_blank check (length(trim(route_group)) > 0),
  constraint request_audit_reason_code_not_blank check (length(trim(reason_code)) > 0)
);

create index if not exists request_audit_log_request_id_idx on request_audit_log (request_id, created_at desc);
create index if not exists request_audit_log_principal_idx on request_audit_log (principal_key_id, created_at desc) where principal_key_id is not null;
create index if not exists request_audit_log_route_decision_idx on request_audit_log (route_group, decision, created_at desc);