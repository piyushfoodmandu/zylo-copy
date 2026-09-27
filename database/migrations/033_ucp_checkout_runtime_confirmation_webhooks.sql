alter table ucp_checkout_sessions
  add column if not exists request_fingerprint text,
  add column if not exists business_profile_json jsonb,
  add column if not exists negotiation_json jsonb;

alter table ucp_checkout_sessions
  add constraint ucp_checkout_sessions_request_fingerprint_check
    check (request_fingerprint is null or request_fingerprint ~ '^sha256:[0-9a-f]{64}$') not valid;

alter table ucp_checkout_sessions
  validate constraint ucp_checkout_sessions_request_fingerprint_check;

create table if not exists ucp_checkout_confirmations (
  transaction_id text primary key references ucp_checkout_sessions(transaction_id) on delete cascade,
  checkout_id text not null,
  checkout_snapshot_hash text not null,
  total_amount integer,
  currency text,
  approval_ref text not null,
  approval_payload jsonb not null,
  approved_at timestamptz not null default now(),
  constraint ucp_checkout_confirmations_checkout_snapshot_hash_check
    check (checkout_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint ucp_checkout_confirmations_currency_check
    check (currency is null or currency ~ '^[A-Z]{3}$')
);

alter table ucp_checkout_operations
  drop constraint if exists ucp_checkout_operations_operation_check;

alter table ucp_checkout_operations
  add constraint ucp_checkout_operations_operation_check
    check (operation in (
      'discover',
      'negotiate',
      'create_checkout',
      'get_checkout',
      'update_checkout',
      'list_checkout_payment_handlers',
      'prepare_checkout_payment',
      'confirm_checkout',
      'complete_checkout',
      'cancel_checkout',
      'get_order',
      'order_webhook'
    ));

alter table ucp_order_webhook_events
  add column if not exists webhook_id text,
  add column if not exists webhook_timestamp text,
  add column if not exists ucp_agent text,
  add column if not exists content_digest text,
  add column if not exists signature_input text,
  add column if not exists signature text,
  add column if not exists order_json jsonb;

create unique index if not exists ucp_order_webhook_events_webhook_id_idx
  on ucp_order_webhook_events (merchant_origin, webhook_id)
  where webhook_id is not null;
