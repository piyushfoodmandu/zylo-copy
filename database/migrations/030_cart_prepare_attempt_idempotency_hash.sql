alter table cart_prepare_attempts
  add column if not exists idempotency_key_hash text;

alter table cart_prepare_attempts
  alter column idempotency_key drop not null;

alter table cart_prepare_attempts
  drop constraint if exists cart_prepare_attempts_idempotency_hash_check;

alter table cart_prepare_attempts
  add constraint cart_prepare_attempts_idempotency_hash_check check (
    idempotency_key_hash is null or idempotency_key_hash ~ '^hmac_sha256:[0-9a-f]{64}$'
  );

drop index if exists cart_prepare_attempts_idempotency_idx;

create unique index if not exists cart_prepare_attempts_idempotency_hash_idx
  on cart_prepare_attempts (
    integration_id,
    external_subject_ref_hash,
    idempotency_key_hash
  )
  where idempotency_key_hash is not null;
