create table if not exists ap2_verified_authorities (
  authority_id text primary key,
  transaction_id text not null references ucp_checkout_sessions(transaction_id) on delete cascade,
  owner_key_id text,
  owner_principal_hash text,
  integration_id text not null,
  agent_session_id text,
  canonical_mandate_id text,
  canonical_mandate_version integer,
  merchant_origin text not null,
  checkout_id text not null,
  checkout_snapshot_hash text not null,
  amount_minor numeric(78, 0) not null,
  currency text not null,
  authority_mode text not null,
  checkout_mandate_id text not null,
  payment_mandate_id text not null,
  checkout_receipt_reference text not null,
  payment_receipt_reference text not null,
  agent_key_thumbprint text,
  status text not null default 'active',
  invalidation_reason text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  consumed_at timestamptz,
  revoked_at timestamptz,
  invalidated_at timestamptz,
  constraint ap2_verified_authorities_mode_check
    check (authority_mode in ('human_present', 'human_not_present')),
  constraint ap2_verified_authorities_status_check
    check (status in ('active', 'consumed', 'revoked', 'invalidated')),
  constraint ap2_verified_authorities_snapshot_check
    check (checkout_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint ap2_verified_authorities_amount_check
    check (amount_minor >= 0),
  constraint ap2_verified_authorities_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  unique (checkout_mandate_id, payment_mandate_id)
);

create index if not exists ap2_verified_authorities_transaction_idx
  on ap2_verified_authorities (transaction_id, status, expires_at);

create table if not exists ap2_protocol_receipts (
  receipt_id text primary key,
  authority_id text not null references ap2_verified_authorities(authority_id) on delete cascade,
  receipt_kind text not null,
  status text not null,
  issuer text not null,
  reference text not null,
  order_id text,
  payment_id text,
  psp_confirmation_id text,
  network_confirmation_id text,
  receipt_jwt text not null,
  issued_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  constraint ap2_protocol_receipts_kind_check
    check (receipt_kind in ('checkout', 'payment')),
  constraint ap2_protocol_receipts_status_check
    check (status in ('Success', 'Error')),
  unique (receipt_kind, reference)
);

create table if not exists purchase_step_up_actions (
  step_up_action_id text primary key,
  owner_key_id text not null,
  owner_principal_hash text not null,
  integration_id text not null,
  purchase_id text not null,
  job_id text references autonomous_purchase_jobs(job_id) on delete cascade,
  mandate_id text not null references purchase_mandates(mandate_id) on delete cascade,
  mandate_version integer not null,
  merchant_origin text not null,
  checkout_id text not null,
  checkout_snapshot_hash text not null,
  amount_minor numeric(78, 0) not null,
  currency text not null,
  items_json jsonb not null,
  display_json jsonb not null,
  reason_code text not null,
  requested_action text not null,
  nonce_hash text not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  decision_ref text,
  provider_challenge_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  invalidated_at timestamptz,
  constraint purchase_step_up_actions_status_check
    check (status in ('pending', 'approved', 'rejected', 'challenge_satisfied', 'expired', 'invalidated', 'consumed')),
  constraint purchase_step_up_actions_snapshot_check
    check (checkout_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint purchase_step_up_actions_nonce_check
    check (nonce_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint purchase_step_up_actions_amount_check
    check (amount_minor >= 0),
  constraint purchase_step_up_actions_currency_check
    check (currency ~ '^[A-Z]{3}$')
);

create unique index if not exists purchase_step_up_actions_one_pending_idx
  on purchase_step_up_actions (purchase_id, mandate_id, mandate_version)
  where status = 'pending';

create index if not exists purchase_step_up_actions_owner_idx
  on purchase_step_up_actions (owner_key_id, owner_principal_hash, integration_id, status, expires_at);
