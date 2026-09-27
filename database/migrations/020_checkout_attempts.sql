create table if not exists checkout_attempts (
  attempt_id text primary key,
  idempotency_key text not null,
  integration_id text not null,
  surface text not null,
  requested_action_scope text not null,
  external_subject_ref_hash text not null,
  external_task_ref_hash text,
  business_id text not null,
  cart_id text not null,
  decision_receipt_id text not null,
  state text not null,
  request_payload jsonb not null,
  response_payload jsonb,
  continue_url text,
  completion_reference text,
  failure_code text,
  failure_message text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkout_attempts_state_check check (
    state in ('processing', 'completed', 'requires_continue_url', 'blocked', 'failed')
  ),
  constraint checkout_attempts_scope_check check (requested_action_scope = 'write:complete_checkout'),
  constraint checkout_attempts_surface_check check (
    surface in ('chatgpt', 'claude', 'generic_mcp', 'direct_http', 'managed_channel', 'internal')
  ),
  constraint checkout_attempts_subject_hash_check check (
    external_subject_ref_hash ~ '^hmac_sha256:[0-9a-f]{64}$'
  ),
  constraint checkout_attempts_task_hash_check check (
    external_task_ref_hash is null or external_task_ref_hash ~ '^hmac_sha256:[0-9a-f]{64}$'
  ),
  constraint checkout_attempts_response_state_check check (
    response_payload is null or response_payload->>'state' = state
  )
);

create unique index if not exists checkout_attempts_integration_subject_idempotency_idx
  on checkout_attempts (integration_id, external_subject_ref_hash, idempotency_key);

create index if not exists checkout_attempts_integration_created_idx
  on checkout_attempts (integration_id, created_at desc);

create index if not exists checkout_attempts_business_state_idx
  on checkout_attempts (business_id, state, created_at desc);

create index if not exists checkout_attempts_expires_at_idx
  on checkout_attempts (expires_at)
  where expires_at is not null;
