create table if not exists ucp_checkout_sessions (
  transaction_id text primary key,
  integration_id text not null,
  external_subject_ref_hash text,
  external_task_ref_hash text,
  merchant_profile_url text not null,
  merchant_origin text not null,
  ucp_version text not null,
  checkout_id text not null,
  selected_payment_handler_id text,
  idempotency_key_hash text not null,
  last_checkout_status text not null,
  checkout_snapshot_hash text,
  checkout_json jsonb not null,
  order_id text,
  order_permalink_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ucp_checkout_sessions_external_subject_ref_hash_check
    check (external_subject_ref_hash is null or external_subject_ref_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint ucp_checkout_sessions_external_task_ref_hash_check
    check (external_task_ref_hash is null or external_task_ref_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint ucp_checkout_sessions_idempotency_key_hash_check
    check (idempotency_key_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint ucp_checkout_sessions_checkout_snapshot_hash_check
    check (checkout_snapshot_hash is null or checkout_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint ucp_checkout_sessions_status_check
    check (last_checkout_status in (
      'incomplete',
      'requires_escalation',
      'ready_for_complete',
      'complete_in_progress',
      'completed',
      'canceled'
    ))
);

create unique index if not exists ucp_checkout_sessions_integration_idempotency_idx
  on ucp_checkout_sessions (integration_id, idempotency_key_hash);

create index if not exists ucp_checkout_sessions_subject_idx
  on ucp_checkout_sessions (integration_id, external_subject_ref_hash);

create index if not exists ucp_checkout_sessions_checkout_idx
  on ucp_checkout_sessions (merchant_origin, checkout_id);

create table if not exists ucp_checkout_operations (
  operation_id text primary key,
  transaction_id text not null references ucp_checkout_sessions(transaction_id) on delete cascade,
  operation text not null,
  idempotency_key_hash text not null,
  request_json jsonb not null,
  response_json jsonb,
  status text not null,
  retry_after_seconds integer,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint ucp_checkout_operations_idempotency_key_hash_check
    check (idempotency_key_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint ucp_checkout_operations_operation_check
    check (operation in (
      'discover',
      'negotiate',
      'create_checkout',
      'get_checkout',
      'update_checkout',
      'complete_checkout',
      'cancel_checkout',
      'get_order'
    )),
  constraint ucp_checkout_operations_status_check
    check (status in (
      'started',
      'retryable',
      'unknown_outcome',
      'succeeded',
      'failed'
    ))
);

create unique index if not exists ucp_checkout_operations_transaction_operation_idempotency_idx
  on ucp_checkout_operations (transaction_id, operation, idempotency_key_hash);

create table if not exists ucp_orders (
  order_record_id text primary key,
  transaction_id text not null references ucp_checkout_sessions(transaction_id) on delete cascade,
  merchant_origin text not null,
  checkout_id text not null,
  order_id text not null,
  order_permalink_url text,
  ucp_version text not null,
  order_json jsonb not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (merchant_origin, order_id)
);

create index if not exists ucp_orders_transaction_idx
  on ucp_orders (transaction_id);

create table if not exists ucp_order_webhook_events (
  webhook_event_id text primary key,
  merchant_origin text not null,
  event_type text not null,
  event_sequence bigint,
  checkout_id text,
  order_id text,
  event_json jsonb not null,
  signature_verified boolean not null default false,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  dedupe_hash text not null,
  constraint ucp_order_webhook_events_dedupe_hash_check
    check (dedupe_hash ~ '^sha256:[0-9a-f]{64}$')
);

create unique index if not exists ucp_order_webhook_events_dedupe_idx
  on ucp_order_webhook_events (merchant_origin, dedupe_hash);

create index if not exists ucp_order_webhook_events_order_idx
  on ucp_order_webhook_events (merchant_origin, order_id);
