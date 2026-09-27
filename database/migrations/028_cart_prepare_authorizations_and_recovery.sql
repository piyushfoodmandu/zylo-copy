create table if not exists cart_prepare_authorizations (
  authorization_ref text primary key,
  integration_id text not null,
  surface text not null,
  requested_action_scope text not null,
  external_subject_ref_hash text not null,
  external_task_ref_hash text not null,
  business_id text not null,
  decision_receipt_id text not null,
  idempotency_key_hash text not null,
  action text not null,
  item_snapshot_hash text not null,
  source_profile_hash text,
  source_profile_version text,
  max_estimated_total jsonb,
  authorization_payload jsonb not null,
  request_fingerprint text not null,
  state text not null default 'issued',
  confirmed_at timestamptz not null,
  expires_at timestamptz not null,
  used_attempt_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cart_prepare_authorizations_scope_check check (requested_action_scope = 'write:cart_prepare'),
  constraint cart_prepare_authorizations_state_check check (state in ('issued', 'used', 'expired')),
  constraint cart_prepare_authorizations_action_check check (action in ('prepare_cart', 'create_checkout_session')),
  constraint cart_prepare_authorizations_subject_hash_check check (
    external_subject_ref_hash ~ '^hmac_sha256:[0-9a-f]{64}$'
  ),
  constraint cart_prepare_authorizations_task_hash_check check (
    external_task_ref_hash ~ '^hmac_sha256:[0-9a-f]{64}$'
  ),
  constraint cart_prepare_authorizations_idempotency_hash_check check (
    idempotency_key_hash ~ '^hmac_sha256:[0-9a-f]{64}$'
  ),
  constraint cart_prepare_authorizations_item_hash_check check (
    item_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'
  ),
  constraint cart_prepare_authorizations_payload_object check (jsonb_typeof(authorization_payload) = 'object'),
  constraint cart_prepare_authorizations_window_check check (confirmed_at < expires_at)
);

create index if not exists cart_prepare_authorizations_scope_idx
  on cart_prepare_authorizations (integration_id, external_subject_ref_hash, created_at desc);

create index if not exists cart_prepare_authorizations_task_idx
  on cart_prepare_authorizations (integration_id, external_task_ref_hash, created_at desc);

create index if not exists cart_prepare_authorizations_receipt_idx
  on cart_prepare_authorizations (decision_receipt_id, created_at desc);

create index if not exists cart_prepare_authorizations_expiry_idx
  on cart_prepare_authorizations (expires_at);

alter table cart_prepare_attempts
  drop constraint if exists cart_prepare_attempts_state_check;

alter table cart_prepare_attempts
  add column if not exists merchant_result_payload jsonb,
  add column if not exists recovery_payload jsonb,
  add column if not exists merchant_reference_hash text,
  add column if not exists handoff_url_hash text,
  add column if not exists merchant_write_started_at timestamptz,
  add column if not exists merchant_result_recorded_at timestamptz,
  add column if not exists audit_recorded_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists reconciliation_reason text;

alter table cart_prepare_attempts
  add constraint cart_prepare_attempts_state_check check (
    state in (
      'merchant_write_not_started',
      'processing',
      'merchant_result_recorded',
      'audit_pending',
      'completed',
      'failed_before_merchant_write',
      'reconciliation_required',
      'expired',
      'ready',
      'limited',
      'unavailable'
    )
  );

create index if not exists cart_prepare_attempts_state_lease_idx
  on cart_prepare_attempts (state, lease_expires_at)
  where state in ('merchant_write_not_started', 'processing');

create index if not exists cart_prepare_attempts_audit_pending_idx
  on cart_prepare_attempts (updated_at)
  where state = 'audit_pending';

create table if not exists checkout_handoff_receipts (
  handoff_receipt_id text primary key,
  attempt_id text not null references cart_prepare_attempts(attempt_id) on delete cascade,
  integration_id text not null,
  surface text not null,
  external_subject_ref_hash text not null,
  external_task_ref_hash text not null,
  business_id text not null,
  decision_receipt_id text not null,
  authorization_ref text not null,
  state text not null,
  cart_id_hash text,
  checkout_reference_hash text,
  handoff_url_hash text,
  selected_items jsonb not null,
  totals jsonb,
  source_label jsonb,
  expires_at timestamptz,
  handed_off_at timestamptz not null,
  last_authoritative_refresh_at timestamptz,
  authoritative_order_reference_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkout_handoff_receipts_state_check check (
    state in (
      'handed_off',
      'completion_unknown',
      'completed',
      'expired',
      'canceled',
      'unavailable',
      'reconciliation_required'
    )
  ),
  constraint checkout_handoff_receipts_subject_hash_check check (
    external_subject_ref_hash ~ '^hmac_sha256:[0-9a-f]{64}$'
  ),
  constraint checkout_handoff_receipts_task_hash_check check (
    external_task_ref_hash ~ '^hmac_sha256:[0-9a-f]{64}$'
  ),
  constraint checkout_handoff_receipts_selected_items_array check (jsonb_typeof(selected_items) = 'array')
);

create unique index if not exists checkout_handoff_receipts_attempt_idx
  on checkout_handoff_receipts (attempt_id);

create index if not exists checkout_handoff_receipts_scope_idx
  on checkout_handoff_receipts (integration_id, external_subject_ref_hash, created_at desc);

create index if not exists checkout_handoff_receipts_state_idx
  on checkout_handoff_receipts (business_id, state, updated_at desc);

create index if not exists checkout_handoff_receipts_expiry_idx
  on checkout_handoff_receipts (expires_at)
  where expires_at is not null;
