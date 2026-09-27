alter table ucp_payment_results
  add column if not exists checkout_snapshot_hash text,
  add column if not exists revoked_at timestamptz,
  add column if not exists revocation_reason text;

-- Pre-existing credentials were acquired before durable snapshot binding existed.
-- Preserve the audit record, but fail closed by making those credentials unusable.
delete from ucp_payment_results as payment_result
using ucp_checkout_sessions as checkout_session
where payment_result.transaction_id = checkout_session.transaction_id
  and payment_result.checkout_snapshot_hash is null
  and checkout_session.checkout_snapshot_hash is null;

update ucp_payment_results as payment_result
set checkout_snapshot_hash = checkout_session.checkout_snapshot_hash,
    revoked_at = coalesce(payment_result.revoked_at, now()),
    revocation_reason = coalesce(
      payment_result.revocation_reason,
      'snapshot_binding_migration'
    )
from ucp_checkout_sessions as checkout_session
where payment_result.transaction_id = checkout_session.transaction_id
  and payment_result.checkout_snapshot_hash is null;

alter table ucp_payment_results
  alter column checkout_snapshot_hash set not null,
  drop constraint if exists ucp_payment_results_checkout_snapshot_hash_check,
  add constraint ucp_payment_results_checkout_snapshot_hash_check
    check (checkout_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  drop constraint if exists ucp_payment_results_revocation_reason_check,
  add constraint ucp_payment_results_revocation_reason_check
    check (
      (revoked_at is null and revocation_reason is null)
      or (revoked_at is not null and revocation_reason is not null)
    );

create index if not exists ucp_payment_results_snapshot_authority_idx
  on ucp_payment_results (
    transaction_id,
    checkout_snapshot_hash,
    created_at desc
  )
  where revoked_at is null;
