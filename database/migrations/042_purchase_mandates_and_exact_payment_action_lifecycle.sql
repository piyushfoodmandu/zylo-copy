update ucp_payment_actions
set status = 'consumed',
    consumed_at = coalesce(consumed_at, updated_at)
where consumed_at is not null
  and status = 'credential_ready';

update ucp_payment_actions
set consumed_at = null
where status = 'credential_ready'
  and consumed_at is not null;

update ucp_payment_actions
set credential_ready_at = coalesce(credential_ready_at, updated_at)
where status = 'credential_ready'
  and credential_ready_at is null;

alter table ucp_payment_actions
  drop constraint if exists ucp_payment_actions_lifecycle_timestamps,
  add constraint ucp_payment_actions_lifecycle_timestamps
    check (
      (status = 'pending_user_approval' and approved_at is null and credential_ready_at is null and consumed_at is null and revoked_at is null and failed_at is null)
      or (status = 'approved' and approved_at is not null and credential_ready_at is null and consumed_at is null and revoked_at is null and failed_at is null)
      or (status = 'credential_ready' and credential_ready_at is not null and consumed_at is null and revoked_at is null and failed_at is null)
      or (status = 'consumed' and consumed_at is not null and revoked_at is null and failed_at is null)
      or (status = 'revoked' and revoked_at is not null and consumed_at is null)
      or (status = 'failed' and failed_at is not null and consumed_at is null)
      or (status = 'expired' and failed_at is not null and consumed_at is null)
    );

create table if not exists purchase_mandates (
  mandate_id text primary key,
  owner_key_id text not null,
  owner_principal_hash text not null,
  integration_id text not null,
  version integer not null default 1,
  status text not null,
  authorization_provider text not null,
  mandate_json jsonb not null,
  total_reserved_minor numeric(78, 0) not null default 0,
  total_committed_minor numeric(78, 0) not null default 0,
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  authorized_at timestamptz,
  activated_at timestamptz,
  suspended_at timestamptz,
  revoked_at timestamptz,
  expired_at timestamptz,
  exhausted_at timestamptz,
  constraint purchase_mandates_status_check check (status in (
    'draft',
    'pending_authorization',
    'active',
    'suspended',
    'revoked',
    'expired',
    'exhausted'
  )),
  constraint purchase_mandates_authorization_provider_check check (authorization_provider in (
    'zylo',
    'ap2',
    'trusted_host'
  )),
  constraint purchase_mandates_json_object check (jsonb_typeof(mandate_json) = 'object')
);

create table if not exists purchase_mandate_reservations (
  reservation_id text primary key,
  mandate_id text not null references purchase_mandates(mandate_id) on delete cascade,
  mandate_version integer not null,
  transaction_id text not null,
  checkout_id text not null,
  checkout_snapshot_hash text not null,
  amount_minor numeric(78, 0) not null,
  currency text not null,
  status text not null,
  evaluation_json jsonb not null,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  released_at timestamptz,
  constraint purchase_mandate_reservations_status_check check (status in (
    'reserved',
    'committed',
    'released'
  )),
  constraint purchase_mandate_reservations_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint purchase_mandate_reservations_evaluation_object check (jsonb_typeof(evaluation_json) = 'object'),
  unique (mandate_id, transaction_id)
);

create index if not exists purchase_mandates_owner_idx
  on purchase_mandates (owner_key_id, owner_principal_hash, integration_id, status);

create index if not exists purchase_mandate_reservations_active_idx
  on purchase_mandate_reservations (mandate_id, status)
  where status = 'reserved';
