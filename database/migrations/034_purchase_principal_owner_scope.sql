alter table ucp_checkout_sessions
  add column if not exists owner_key_id text,
  add column if not exists owner_principal_hash text,
  add column if not exists agent_session_id text;

alter table ucp_checkout_sessions
  add constraint ucp_checkout_sessions_owner_principal_hash_check
    check (owner_principal_hash is null or owner_principal_hash ~ '^sha256:[0-9a-f]{64}$') not valid,
  add constraint ucp_checkout_sessions_owner_requires_key_check
    check ((owner_principal_hash is null and owner_key_id is null) or (owner_principal_hash is not null and owner_key_id is not null)) not valid;

alter table ucp_checkout_sessions
  validate constraint ucp_checkout_sessions_owner_principal_hash_check;

alter table ucp_checkout_sessions
  validate constraint ucp_checkout_sessions_owner_requires_key_check;

create index if not exists ucp_checkout_sessions_principal_idx
  on ucp_checkout_sessions (
    owner_key_id,
    owner_principal_hash,
    integration_id,
    external_subject_ref_hash,
    external_task_ref_hash
  )
  where owner_principal_hash is not null;

create unique index if not exists ucp_checkout_sessions_owner_idempotency_idx
  on ucp_checkout_sessions (owner_key_id, owner_principal_hash, integration_id, idempotency_key_hash)
  where owner_principal_hash is not null;

alter table ucp_orders
  add column if not exists owner_key_id text,
  add column if not exists owner_principal_hash text;

alter table ucp_orders
  add constraint ucp_orders_owner_principal_hash_check
    check (owner_principal_hash is null or owner_principal_hash ~ '^sha256:[0-9a-f]{64}$') not valid,
  add constraint ucp_orders_owner_requires_key_check
    check ((owner_principal_hash is null and owner_key_id is null) or (owner_principal_hash is not null and owner_key_id is not null)) not valid;

alter table ucp_orders
  validate constraint ucp_orders_owner_principal_hash_check;

alter table ucp_orders
  validate constraint ucp_orders_owner_requires_key_check;

create index if not exists ucp_orders_principal_idx
  on ucp_orders (owner_key_id, owner_principal_hash, order_id)
  where owner_principal_hash is not null;
