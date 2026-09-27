create table if not exists ucp_ap2_mandate_replay (
  mandate_hash text primary key,
  mandate_id text,
  transaction_id text not null references ucp_checkout_sessions(transaction_id) on delete cascade,
  checkout_id text not null,
  expires_at timestamptz not null,
  claimed_at timestamptz not null default now(),
  constraint ucp_ap2_mandate_replay_hash_check
    check (mandate_hash ~ '^sha256:[0-9a-f]{64}$')
);

create index if not exists ucp_ap2_mandate_replay_transaction_idx
  on ucp_ap2_mandate_replay (transaction_id, checkout_id);

create index if not exists ucp_ap2_mandate_replay_expiry_idx
  on ucp_ap2_mandate_replay (expires_at);

create table if not exists ucp_embedded_checkout_events (
  embedded_event_id text primary key,
  transaction_id text not null references ucp_checkout_sessions(transaction_id) on delete cascade,
  embedded_session_id text not null,
  message_type text not null check (message_type in (
    'ready',
    'resize',
    'authorized',
    'completed',
    'canceled',
    'error'
  )),
  origin text not null,
  payload_json jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  constraint ucp_embedded_checkout_events_payload_object
    check (jsonb_typeof(payload_json) = 'object')
);

create index if not exists ucp_embedded_checkout_events_transaction_idx
  on ucp_embedded_checkout_events (transaction_id, received_at desc);

create index if not exists ucp_embedded_checkout_events_session_idx
  on ucp_embedded_checkout_events (embedded_session_id, message_type, received_at desc);

alter table data_rights_events
  drop constraint if exists data_rights_events_target_record_kind_check;

alter table data_rights_events
  add constraint data_rights_events_target_record_kind_check check (target_record_kind in (
    'subject_scope',
    'purchase',
    'order'
  ));

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

drop table if exists checkout_handoff_receipts cascade;
drop table if exists cart_prepare_authorizations cascade;
drop table if exists cart_prepare_attempts cascade;
drop table if exists cart_prepare_audit_logs cascade;
drop table if exists checkout_attempts cascade;
drop table if exists decision_receipts cascade;
