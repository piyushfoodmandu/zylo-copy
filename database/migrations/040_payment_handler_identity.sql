alter table ucp_payment_actions
  add column if not exists handler_version text,
  add column if not exists handler_specification text,
  add column if not exists handler_schema text;

update ucp_payment_actions
set handler_version = coalesce(handler_version, '2026-08-25')
where handler_version is null;

create index if not exists ucp_payment_actions_handler_identity_idx
  on ucp_payment_actions (
    handler_name,
    handler_id,
    handler_version
  );
