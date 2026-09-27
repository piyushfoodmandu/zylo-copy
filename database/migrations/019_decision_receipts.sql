create table if not exists decision_receipts (
  receipt_id text primary key,
  intent_record_id text not null,
  idempotency_key text,
  integration_id text not null,
  surface text not null check (surface in (
    'chatgpt',
    'claude',
    'generic_mcp',
    'direct_http',
    'managed_channel',
    'internal'
  )),
  requested_action_scope text not null check (requested_action_scope in (
    'read:search',
    'read:product_detail',
    'read:compare',
    'read:source_state',
    'write:decision_receipt',
    'write:memory',
    'write:cart_prepare',
    'write:checkout_handoff',
    'write:complete_checkout'
  )),
  external_subject_ref_hash text not null,
  external_task_ref_hash text,
  related_request_id text,
  source_mode text not null check (source_mode in (
    'approved_sources',
    'connected_sources',
    'unconfigured'
  )),
  subject_kind text not null check (subject_kind in (
    'search',
    'product_detail',
    'comparison',
    'sanity_check',
    'cart_prepare',
    'checkout_continuation',
    'gated_completion',
    'blocked_state'
  )),
  outcome text not null check (outcome in (
    'recommend',
    'no_buy',
    'compare',
    'wait',
    'blocked',
    'continue_checkout',
    'gated_completion_ready',
    'gated_completion_blocked',
    'completed'
  )),
  no_buy boolean not null default false,
  source_count integer not null default 0 check (source_count >= 0),
  caveat_count integer not null default 0 check (caveat_count >= 0),
  evidence_gap_count integer not null default 0 check (evidence_gap_count >= 0),
  receipt_payload jsonb not null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint decision_receipts_id_not_blank check (length(trim(receipt_id)) > 0),
  constraint decision_receipts_intent_id_not_blank check (length(trim(intent_record_id)) > 0),
  constraint decision_receipts_idempotency_not_blank check (idempotency_key is null or length(trim(idempotency_key)) >= 8),
  constraint decision_receipts_integration_not_blank check (length(trim(integration_id)) > 0),
  constraint decision_receipts_subject_hash_format check (external_subject_ref_hash ~ '^[a-f0-9]{64}$'),
  constraint decision_receipts_task_hash_format check (external_task_ref_hash is null or external_task_ref_hash ~ '^[a-f0-9]{64}$'),
  constraint decision_receipts_payload_object check (jsonb_typeof(receipt_payload) = 'object')
);

create unique index if not exists decision_receipts_idempotency_idx
  on decision_receipts (integration_id, external_subject_ref_hash, idempotency_key)
  where idempotency_key is not null;

create index if not exists decision_receipts_scope_idx
  on decision_receipts (integration_id, external_subject_ref_hash, created_at desc);

create index if not exists decision_receipts_outcome_idx
  on decision_receipts (outcome, created_at desc);

create index if not exists decision_receipts_expiry_idx
  on decision_receipts (expires_at)
  where expires_at is not null;
