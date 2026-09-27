alter table ucp_payment_actions
  add column if not exists connector_host_id text,
  add column if not exists authorization_mode text,
  add column if not exists mandate_id text,
  add column if not exists mandate_version integer,
  add column if not exists route text,
  add column if not exists presentation text,
  add column if not exists provider_session_id text,
  add column if not exists provider_reference_id text,
  add column if not exists provider_event_id text,
  add column if not exists approved_at timestamptz,
  add column if not exists credential_ready_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists failure_code text,
  add column if not exists display_metadata_json jsonb not null default '{}'::jsonb;

alter table ucp_payment_actions
  drop constraint if exists ucp_payment_actions_status_check;

update ucp_payment_actions
set status = case
  when status = 'pending' then 'pending_user_approval'
  when status = 'completed' then 'credential_ready'
  else status
end;

update ucp_payment_actions
set credential_ready_at = coalesce(credential_ready_at, consumed_at, updated_at)
where status = 'credential_ready'
  and credential_ready_at is null;

alter table ucp_payment_actions
  add constraint ucp_payment_actions_status_check
    check (status in (
      'pending_user_approval',
      'approved',
      'credential_ready',
      'consumed',
      'failed',
      'revoked',
      'expired'
    ));

alter table ucp_payment_actions
  drop constraint if exists ucp_payment_actions_display_metadata_object,
  add constraint ucp_payment_actions_display_metadata_object
    check (jsonb_typeof(display_metadata_json) = 'object');

alter table ucp_payment_actions
  drop constraint if exists ucp_payment_actions_route_check,
  add constraint ucp_payment_actions_route_check
    check (route is null or route in (
      'trusted_host',
      'google_pay',
      'processor_tokenizer',
      'merchant_hosted'
    ));

alter table ucp_payment_actions
  drop constraint if exists ucp_payment_actions_presentation_check,
  add constraint ucp_payment_actions_presentation_check
    check (presentation is null or presentation in (
      'host_native',
      'embedded_component',
      'external_action',
      'merchant_hosted',
      'none_autonomous'
    ));

create index if not exists ucp_payment_actions_lifecycle_idx
  on ucp_payment_actions (status, credential_ready_at, consumed_at, failed_at);

create index if not exists ucp_payment_actions_mandate_idx
  on ucp_payment_actions (mandate_id, mandate_version)
  where mandate_id is not null;
