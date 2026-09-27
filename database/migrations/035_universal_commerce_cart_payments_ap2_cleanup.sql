alter table ucp_checkout_sessions
  add column if not exists cart_id text,
  add column if not exists cart_snapshot_hash text,
  add column if not exists cart_json jsonb;

alter table ucp_checkout_sessions
  add constraint ucp_checkout_sessions_cart_snapshot_hash_check
    check (cart_snapshot_hash is null or cart_snapshot_hash ~ '^sha256:[0-9a-f]{64}$') not valid;

alter table ucp_checkout_sessions
  validate constraint ucp_checkout_sessions_cart_snapshot_hash_check;

create index if not exists ucp_checkout_sessions_cart_idx
  on ucp_checkout_sessions (merchant_origin, cart_id)
  where cart_id is not null;

alter table ucp_checkout_operations
  drop constraint if exists ucp_checkout_operations_operation_check;

alter table ucp_checkout_operations
  add constraint ucp_checkout_operations_operation_check
    check (operation in (
      'discover',
      'negotiate',
      'create_cart',
      'get_cart',
      'update_cart',
      'cancel_cart',
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
