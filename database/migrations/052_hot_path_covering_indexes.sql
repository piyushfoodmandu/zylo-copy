-- Replace prefix-only indexes with indexes that match the actual bounded-history
-- reads used by the shopper/data-rights and step-up hot paths.

create index if not exists ucp_checkout_sessions_subject_created_idx
  on ucp_checkout_sessions (integration_id, external_subject_ref_hash, created_at desc)
  where external_subject_ref_hash is not null;

drop index if exists ucp_checkout_sessions_subject_idx;

-- Retention touches only terminal sessions. Keep both dry-run counts and apply
-- deletes on a small partial index rather than scanning active checkout state.
create index if not exists ucp_checkout_sessions_terminal_retention_idx
  on ucp_checkout_sessions (updated_at, transaction_id)
  where last_checkout_status in ('completed', 'canceled');

create index if not exists ucp_orders_transaction_last_seen_idx
  on ucp_orders (transaction_id, last_seen_at desc);

drop index if exists ucp_orders_transaction_idx;

create index if not exists purchase_step_up_actions_job_history_idx
  on purchase_step_up_actions (
    job_id,
    purchase_id,
    mandate_id,
    mandate_version,
    created_at desc
  )
  where job_id is not null;

-- Frequency-window checks happen while the parent mandate row is locked. Keep
-- that count bounded to the active/consumed states and ordered by recency so a
-- high-use mandate does not repeatedly scan its full reservation history.
create index if not exists purchase_mandate_reservations_frequency_idx
  on purchase_mandate_reservations (mandate_id, created_at desc)
  where status in ('reserved', 'execution_in_progress', 'reconciliation_required', 'committed');

-- Order IDs are merchant-scoped and therefore intentionally not globally
-- unique. Principal-scoped continuity lookup binds order_id to the globally
-- unique purchase transaction before reading the merchant Order.
create index if not exists ucp_orders_order_id_transaction_idx
  on ucp_orders (order_id, transaction_id);


-- Source-state policy is cached, but each refresh must stay independent of the
-- append-only evidence-table size. The repository reads only a bounded recent
-- window plus the newest still-valid conformance record per business.
drop index if exists target_business_evidence_business_idx;

create index if not exists target_business_evidence_business_idx
  on target_business_evidence (business_id, observed_at desc, id desc);

create index if not exists target_business_evidence_conformance_idx
  on target_business_evidence (business_id, observed_at desc, id desc)
  where kind = 'zylo_conformance';
