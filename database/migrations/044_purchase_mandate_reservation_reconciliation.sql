alter table purchase_mandate_reservations
  drop constraint if exists purchase_mandate_reservations_status_check;

alter table purchase_mandate_reservations
  add column if not exists execution_started_at timestamptz,
  add column if not exists reconciliation_required_at timestamptz,
  add column if not exists completion_operation_id text,
  add column if not exists payment_action_id text,
  add column if not exists payment_result_id text,
  add column if not exists provider_reference text,
  add column if not exists reconciliation_state text,
  add column if not exists recovered_order_id text,
  add column if not exists failure_evidence_json jsonb;

alter table purchase_mandate_reservations
  add constraint purchase_mandate_reservations_status_check check (status in (
    'reserved',
    'execution_in_progress',
    'reconciliation_required',
    'committed',
    'released'
  ));

alter table purchase_mandate_reservations
  add constraint purchase_mandate_reservations_unknown_outcome_check check (
    (status = 'reserved' and execution_started_at is null and reconciliation_required_at is null)
    or (status = 'execution_in_progress' and execution_started_at is not null and released_at is null)
    or (status = 'reconciliation_required' and reconciliation_required_at is not null and released_at is null)
    or (status = 'committed' and committed_at is not null and released_at is null)
    or (status = 'released' and released_at is not null and committed_at is null)
  );

create index if not exists purchase_mandate_reservations_reconciliation_idx
  on purchase_mandate_reservations (status, reconciliation_state, created_at)
  where status in ('execution_in_progress', 'reconciliation_required');
