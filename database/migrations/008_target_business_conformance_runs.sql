create table if not exists target_business_conformance_runs (
  id bigint generated always as identity primary key,
  business_id text not null references target_businesses (business_id) on delete cascade,
  request_id text not null,
  correlation_id text not null,
  principal_key_id text,
  owner_principal text,
  linked_discovery_observation_id bigint references target_business_discovery_observations (id) on delete set null,
  run_mode text not null check (run_mode in ('live', 'fixture')),
  run_status text not null check (run_status in ('pending', 'passed', 'failed', 'error')),
  profile_hash text,
  checks_passed integer not null default 0 check (checks_passed >= 0),
  checks_failed integer not null default 0 check (checks_failed >= 0),
  check_details jsonb not null default '[]'::jsonb,
  capability_coverage jsonb not null default '{}'::jsonb,
  failure_classification text check (failure_classification in (
    'none',
    'business_not_found',
    'discovery_missing',
    'profile_missing',
    'profile_hash_mismatch',
    'capability_missing',
    'service_insecure',
    'freshness_invalid',
    'fixture_mode_disabled',
    'internal_error'
  )),
  started_at timestamptz not null,
  completed_at timestamptz,
  expires_at timestamptz,
  reviewer_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint target_business_conformance_request_id_not_blank check (length(trim(request_id)) > 0),
  constraint target_business_conformance_correlation_id_not_blank check (length(trim(correlation_id)) > 0),
  constraint target_business_conformance_profile_hash_not_blank check (profile_hash is null or length(trim(profile_hash)) > 0),
  constraint target_business_conformance_reviewer_summary_not_blank check (reviewer_summary is null or length(trim(reviewer_summary)) > 0),
  constraint target_business_conformance_check_details_array check (jsonb_typeof(check_details) = 'array'),
  constraint target_business_conformance_capability_coverage_object check (jsonb_typeof(capability_coverage) = 'object'),
  constraint target_business_conformance_metadata_object check (jsonb_typeof(metadata) = 'object'),
  constraint target_business_conformance_completed_after_start check (completed_at is null or completed_at >= started_at),
  constraint target_business_conformance_expiry_after_completion check (expires_at is null or completed_at is null or expires_at > completed_at)
);

create index if not exists target_business_conformance_runs_business_idx
  on target_business_conformance_runs (business_id, created_at desc, id desc);

create index if not exists target_business_conformance_runs_current_passed_idx
  on target_business_conformance_runs (business_id, profile_hash, expires_at desc)
  where run_status = 'passed' and expires_at is not null;

create index if not exists target_business_conformance_runs_discovery_idx
  on target_business_conformance_runs (linked_discovery_observation_id)
  where linked_discovery_observation_id is not null;

create index if not exists target_business_conformance_runs_request_idx
  on target_business_conformance_runs (request_id, created_at desc);

create index if not exists target_business_conformance_runs_status_idx
  on target_business_conformance_runs (run_status, created_at desc);

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'target_business_evidence_kind_check'
      and conrelid = 'target_business_evidence'::regclass
  ) then
    alter table target_business_evidence drop constraint target_business_evidence_kind_check;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'target_business_evidence_kind_check'
      and conrelid = 'target_business_evidence'::regclass
  ) then
    alter table target_business_evidence
      add constraint target_business_evidence_kind_check
      check (kind in ('zylo_discovery', 'zylo_conformance', 'sandbox_fixture', 'public_readiness_snapshot', 'managed_channel_signal', 'manual_review'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'target_business_state_transitions_conformance_run_fk'
      and conrelid = 'target_business_state_transitions'::regclass
  ) then
    alter table target_business_state_transitions
      add constraint target_business_state_transitions_conformance_run_fk
      foreign key (linked_conformance_run_id)
      references target_business_conformance_runs (id);
  end if;
end;
$$;
