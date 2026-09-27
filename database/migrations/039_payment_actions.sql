create table if not exists ucp_payment_actions (
  action_id text primary key,
  transaction_id text not null references ucp_checkout_sessions(transaction_id) on delete cascade,
  integration_id text not null,
  owner_key_id text,
  owner_principal_hash text,
  external_subject_ref_hash text,
  external_task_ref_hash text,
  agent_session_id text,
  merchant_origin text not null,
  checkout_id text not null,
  checkout_snapshot_hash text not null,
  handler_id text not null,
  handler_name text not null,
  provider text not null,
  capability_id text,
  action_type text not null,
  status text not null default 'pending',
  amount integer,
  currency text,
  token_nonce_hash text not null unique,
  action_payload_json jsonb not null default '{}'::jsonb,
  result_fingerprint text,
  payment_result_id text references ucp_payment_results(payment_result_id) on delete set null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ucp_payment_actions_owner_principal_hash_check
    check (owner_principal_hash is null or owner_principal_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint ucp_payment_actions_external_subject_ref_hash_check
    check (external_subject_ref_hash is null or external_subject_ref_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint ucp_payment_actions_external_task_ref_hash_check
    check (external_task_ref_hash is null or external_task_ref_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint ucp_payment_actions_checkout_snapshot_hash_check
    check (checkout_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint ucp_payment_actions_token_nonce_hash_check
    check (token_nonce_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint ucp_payment_actions_result_fingerprint_check
    check (result_fingerprint is null or result_fingerprint ~ '^sha256:[0-9a-f]{64}$'),
  constraint ucp_payment_actions_payload_object
    check (jsonb_typeof(action_payload_json) = 'object'),
  constraint ucp_payment_actions_status_check
    check (status in ('pending', 'completed', 'failed', 'revoked', 'expired')),
  constraint ucp_payment_actions_action_type_check
    check (action_type in ('host_supplied', 'google_pay', 'processor_tokenizer')),
  constraint ucp_payment_actions_currency_check
    check (currency is null or currency ~ '^[A-Z]{3}$')
);

create index if not exists ucp_payment_actions_transaction_idx
  on ucp_payment_actions (transaction_id, created_at desc);

create index if not exists ucp_payment_actions_status_expiry_idx
  on ucp_payment_actions (status, expires_at);

create index if not exists ucp_payment_actions_owner_idx
  on ucp_payment_actions (
    owner_key_id,
    owner_principal_hash,
    integration_id,
    external_subject_ref_hash,
    external_task_ref_hash
  );

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
      'create_payment_action',
      'record_payment_result',
      'complete_checkout',
      'cancel_checkout',
      'get_order'
    ));
