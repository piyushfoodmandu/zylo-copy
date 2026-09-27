create table if not exists ucp_payment_results (
  payment_result_id text primary key,
  transaction_id text not null references ucp_checkout_sessions(transaction_id) on delete cascade,
  provider text not null,
  handler_id text not null,
  idempotency_key_hash text not null,
  result_fingerprint text not null,
  instrument_json jsonb not null,
  provider_result_json jsonb not null,
  created_at timestamptz not null default now(),
  constraint ucp_payment_results_idempotency_key_hash_check
    check (idempotency_key_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint ucp_payment_results_result_fingerprint_check
    check (result_fingerprint ~ '^sha256:[0-9a-f]{64}$')
);

create unique index if not exists ucp_payment_results_transaction_idempotency_idx
  on ucp_payment_results (transaction_id, idempotency_key_hash);

create index if not exists ucp_payment_results_transaction_created_idx
  on ucp_payment_results (transaction_id, created_at desc);

alter table ucp_checkout_operations
  drop constraint if exists ucp_checkout_operations_operation_check;

alter table ucp_checkout_operations
  add constraint ucp_checkout_operations_operation_check
    check (operation in (
      'create_cart',
      'get_cart',
      'update_cart',
      'cancel_cart',
      'create_checkout',
      'get_checkout',
      'update_checkout',
      'record_payment_result',
      'complete_checkout',
      'cancel_checkout',
      'get_order'
    ));
