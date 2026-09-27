create table if not exists commerce_buyer_profiles (
  owner_key_id text not null,
  owner_principal_hash text not null,
  owner_id text not null,
  profile_json jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_key_id, owner_principal_hash),
  constraint commerce_buyer_profiles_profile_object check (jsonb_typeof(profile_json) = 'object'),
  constraint commerce_buyer_profiles_owner_matches check (profile_json ->> 'ownerId' = owner_id)
);

create table if not exists autonomous_purchase_jobs (
  job_id text primary key,
  owner_key_id text not null,
  owner_principal_hash text not null,
  owner_id text not null,
  integration_id text not null,
  mandate_id text not null,
  mandate_version integer not null,
  status text not null,
  trigger_json jsonb not null,
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  purchase_id text,
  reservation_id text,
  last_safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint autonomous_purchase_jobs_status_check check (status in (
    'scheduled',
    'searching',
    'checkout_prepared',
    'waiting_for_condition',
    'waiting_for_step_up',
    'executing',
    'reconciliation_required',
    'completed',
    'cancelled',
    'failed'
  )),
  constraint autonomous_purchase_jobs_trigger_object check (jsonb_typeof(trigger_json) = 'object'),
  constraint autonomous_purchase_jobs_attempt_count_check check (attempt_count >= 0),
  constraint autonomous_purchase_jobs_mandate_version_check check (mandate_version > 0)
);

create unique index if not exists autonomous_purchase_jobs_one_active_execution_idx
  on autonomous_purchase_jobs (owner_key_id, owner_principal_hash, mandate_id, mandate_version)
  where status in (
    'scheduled',
    'searching',
    'checkout_prepared',
    'waiting_for_condition',
    'waiting_for_step_up',
    'executing',
    'reconciliation_required'
  );

create index if not exists autonomous_purchase_jobs_claim_idx
  on autonomous_purchase_jobs (status, next_attempt_at, lease_expires_at, created_at)
  where status in ('scheduled', 'waiting_for_condition', 'reconciliation_required');

alter table purchase_mandate_reservations
  add column if not exists reconciliation_attempt_count integer not null default 0,
  add column if not exists last_reconciliation_attempt_at timestamptz,
  add column if not exists last_authoritative_evidence_json jsonb,
  add column if not exists final_reconciliation_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'purchase_mandate_reservations_reconciliation_attempt_count_check'
  ) then
    alter table purchase_mandate_reservations
      add constraint purchase_mandate_reservations_reconciliation_attempt_count_check
      check (reconciliation_attempt_count >= 0);
  end if;
end $$;
