alter table cart_prepare_authorizations
  drop constraint if exists cart_prepare_authorizations_state_check;

alter table cart_prepare_authorizations
  add constraint cart_prepare_authorizations_state_check check (
    state in ('issued', 'claimed', 'used', 'completed', 'expired', 'revoked')
  );

create unique index if not exists cart_prepare_authorizations_idempotency_scope_idx
  on cart_prepare_authorizations (
    integration_id,
    external_subject_ref_hash,
    idempotency_key_hash
  );

