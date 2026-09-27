create table if not exists product_detail_audit_logs (
  id bigint generated always as identity primary key,
  request_id text not null,
  correlation_id text not null,
  route text not null check (route in ('/v1/catalog/product')),
  business_id text not null,
  product_id_hash text not null,
  variant_id_hash text,
  product_ref_storage_mode text not null default 'sha256_hash_only',
  source_mode text not null check (source_mode in (
    'approved_sources',
    'connected_sources',
    'sandbox',
    'unconfigured'
  )),
  detail_state text not null check (detail_state in ('ready', 'limited', 'unavailable')),
  allowed_business_ids text[] not null default '{}'::text[],
  product_found boolean not null default false,
  source_label_fact_type text,
  media_count integer not null default 0 check (media_count >= 0),
  variant_count integer not null default 0 check (variant_count >= 0),
  source_policy_message_code text not null,
  payout_fields_accessed boolean not null default false,
  commercial_fields_accessed boolean not null default false,
  commercial_isolation_version text not null,
  latency_ms integer not null check (latency_ms >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint product_detail_audit_request_id_not_blank check (length(trim(request_id)) > 0),
  constraint product_detail_audit_correlation_id_not_blank check (length(trim(correlation_id)) > 0),
  constraint product_detail_audit_business_id_not_blank check (length(trim(business_id)) > 0),
  constraint product_detail_audit_product_hash_format check (product_id_hash ~ '^[a-f0-9]{64}$'),
  constraint product_detail_audit_variant_hash_format check (variant_id_hash is null or variant_id_hash ~ '^[a-f0-9]{64}$'),
  constraint product_detail_audit_ref_storage_mode check (product_ref_storage_mode = 'sha256_hash_only'),
  constraint product_detail_audit_source_policy_code_not_blank check (length(trim(source_policy_message_code)) > 0),
  constraint product_detail_audit_commercial_isolation_version_not_blank check (length(trim(commercial_isolation_version)) > 0),
  constraint product_detail_audit_source_label_fact_type_not_blank check (
    source_label_fact_type is null or length(trim(source_label_fact_type)) > 0
  ),
  constraint product_detail_audit_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists product_detail_audit_logs_request_idx
  on product_detail_audit_logs (request_id, created_at desc);

create index if not exists product_detail_audit_logs_created_idx
  on product_detail_audit_logs (created_at desc, id desc);

create index if not exists product_detail_audit_logs_source_mode_idx
  on product_detail_audit_logs (source_mode, detail_state, created_at desc);

create index if not exists product_detail_audit_logs_business_idx
  on product_detail_audit_logs (business_id, created_at desc);

create index if not exists product_detail_audit_logs_commercial_isolation_idx
  on product_detail_audit_logs (created_at desc)
  where payout_fields_accessed = true or commercial_fields_accessed = true;
