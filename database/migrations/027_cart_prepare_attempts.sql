create table if not exists cart_prepare_attempts (
  attempt_id text primary key,
  idempotency_key text not null,
  integration_id text not null,
  surface text not null,
  requested_action_scope text not null,
  external_subject_ref_hash text not null,
  external_task_ref_hash text,
  business_id text not null,
  decision_receipt_id text not null,
  authorization_ref text not null,
  state text not null check (state in ('processing', 'ready', 'limited', 'unavailable')),
  request_payload jsonb not null,
  request_fingerprint text not null,
  response_payload jsonb,
  cart_id_hash text,
  failure_code text,
  failure_message text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cart_prepare_attempts_idempotency_idx
  on cart_prepare_attempts (integration_id, external_subject_ref_hash, idempotency_key);

create index if not exists cart_prepare_attempts_external_task_idx
  on cart_prepare_attempts (integration_id, external_task_ref_hash)
  where external_task_ref_hash is not null;

create index if not exists cart_prepare_attempts_business_created_idx
  on cart_prepare_attempts (business_id, created_at desc);

create index if not exists cart_prepare_attempts_expires_idx
  on cart_prepare_attempts (expires_at)
  where expires_at is not null;
