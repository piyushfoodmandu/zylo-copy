create table if not exists cart_prepare_audit_logs (
  id bigint generated always as identity primary key,
  request_id text not null,
  correlation_id text not null,
  route text not null check (route in ('/v1/cart/prepare', '/v1/mcp/tools/prepare_cart')),
  business_id text not null,
  item_product_id_hashes text[] not null default '{}'::text[],
  item_variant_id_hashes text[] not null default '{}'::text[],
  cart_id_hash text,
  idempotency_key_hash text,
  cart_ref_storage_mode text not null default 'sha256_hash_only',
  source_mode text not null check (source_mode in (
    'approved_sources',
    'connected_sources',
    'sandbox',
    'unconfigured'
  )),
  cart_state text not null check (cart_state in ('ready', 'limited', 'unavailable')),
  allowed_business_ids text[] not null default '{}'::text[],
  cart_found boolean not null default false,
  source_label_fact_type text,
  request_item_count integer not null default 0 check (request_item_count >= 0),
  request_quantity_total integer not null default 0 check (request_quantity_total >= 0),
  cart_line_item_count integer not null default 0 check (cart_line_item_count >= 0),
  cart_warning_count integer not null default 0 check (cart_warning_count >= 0),
  has_handoff boolean not null default false,
  handoff_type text check (handoff_type in ('cart', 'checkout', 'seller')),
  source_policy_message_code text not null,
  payment_fields_accessed boolean not null default false,
  commercial_fields_accessed boolean not null default false,
  checkout_completion_attempted boolean not null default false,
  commercial_isolation_version text not null,
  latency_ms integer not null check (latency_ms >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint cart_prepare_audit_request_id_not_blank check (length(trim(request_id)) > 0),
  constraint cart_prepare_audit_correlation_id_not_blank check (length(trim(correlation_id)) > 0),
  constraint cart_prepare_audit_business_id_not_blank check (length(trim(business_id)) > 0),
  constraint cart_prepare_audit_cart_hash_format check (cart_id_hash is null or cart_id_hash ~ '^[a-f0-9]{64}$'),
  constraint cart_prepare_audit_idempotency_hash_format check (idempotency_key_hash is null or idempotency_key_hash ~ '^[a-f0-9]{64}$'),
  constraint cart_prepare_audit_ref_storage_mode check (cart_ref_storage_mode = 'sha256_hash_only'),
  constraint cart_prepare_audit_source_policy_code_not_blank check (length(trim(source_policy_message_code)) > 0),
  constraint cart_prepare_audit_commercial_isolation_version_not_blank check (length(trim(commercial_isolation_version)) > 0),
  constraint cart_prepare_audit_source_label_fact_type_not_blank check (
    source_label_fact_type is null or length(trim(source_label_fact_type)) > 0
  ),
  constraint cart_prepare_audit_handoff_type_required check (
    (has_handoff = false and handoff_type is null) or (has_handoff = true and handoff_type is not null)
  ),
  constraint cart_prepare_audit_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists cart_prepare_audit_logs_request_idx
  on cart_prepare_audit_logs (request_id, created_at desc);

create index if not exists cart_prepare_audit_logs_created_idx
  on cart_prepare_audit_logs (created_at desc, id desc);

create index if not exists cart_prepare_audit_logs_source_mode_idx
  on cart_prepare_audit_logs (source_mode, cart_state, created_at desc);

create index if not exists cart_prepare_audit_logs_business_idx
  on cart_prepare_audit_logs (business_id, created_at desc);

create index if not exists cart_prepare_audit_logs_commercial_isolation_idx
  on cart_prepare_audit_logs (created_at desc)
  where payment_fields_accessed = true or commercial_fields_accessed = true or checkout_completion_attempted = true;
