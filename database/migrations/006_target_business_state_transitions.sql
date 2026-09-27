create table if not exists target_business_state_transitions (
  id bigint generated always as identity primary key,
  business_id text not null references target_businesses (business_id),
  request_id text not null,
  correlation_id text not null,
  principal_key_id text,
  owner_principal text,
  previous_launch_status text not null check (previous_launch_status in ('verification_only', 'candidate', 'outreach', 'sandbox_ready', 'launch_visible', 'blocked')),
  next_launch_status text not null check (next_launch_status in ('verification_only', 'candidate', 'outreach', 'sandbox_ready', 'launch_visible', 'blocked')),
  previous_feature_visibility text not null check (previous_feature_visibility in ('hidden', 'discovery_only', 'sandbox_only', 'catalog_visible', 'checkout_visible')),
  next_feature_visibility text not null check (next_feature_visibility in ('hidden', 'discovery_only', 'sandbox_only', 'catalog_visible', 'checkout_visible')),
  previous_access_policy_state text not null check (previous_access_policy_state in ('unknown', 'profile_fetched', 'partner_required', 'approved', 'limited', 'rate_limited', 'denied', 'error')),
  next_access_policy_state text not null check (next_access_policy_state in ('unknown', 'profile_fetched', 'partner_required', 'approved', 'limited', 'rate_limited', 'denied', 'error')),
  reason_code text not null,
  reviewer_note text,
  linked_discovery_observation_id bigint references target_business_discovery_observations (id) on delete set null,
  linked_conformance_run_id bigint,
  override_applied boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint target_business_transition_request_id_not_blank check (length(trim(request_id)) > 0),
  constraint target_business_transition_correlation_id_not_blank check (length(trim(correlation_id)) > 0),
  constraint target_business_transition_reason_code_not_blank check (length(trim(reason_code)) > 0),
  constraint target_business_transition_reviewer_note_not_blank check (reviewer_note is null or length(trim(reviewer_note)) > 0),
  constraint target_business_transition_metadata_object check (jsonb_typeof(metadata) = 'object')
);

create index if not exists target_business_state_transitions_business_idx
  on target_business_state_transitions (business_id, created_at desc);

create index if not exists target_business_state_transitions_principal_idx
  on target_business_state_transitions (principal_key_id, created_at desc)
  where principal_key_id is not null;

create index if not exists target_business_state_transitions_reason_idx
  on target_business_state_transitions (reason_code, created_at desc);

create index if not exists target_business_state_transitions_discovery_idx
  on target_business_state_transitions (linked_discovery_observation_id)
  where linked_discovery_observation_id is not null;

create index if not exists target_business_state_transitions_conformance_idx
  on target_business_state_transitions (linked_conformance_run_id)
  where linked_conformance_run_id is not null;

create or replace function prevent_target_business_state_transition_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'target_business_state_transitions is append-only';
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'target_business_state_transitions_append_only'
  ) then
    create trigger target_business_state_transitions_append_only
    before update or delete on target_business_state_transitions
    for each row execute function prevent_target_business_state_transition_mutation();
  end if;
end;
$$;