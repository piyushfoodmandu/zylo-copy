create table if not exists ucp_checker_registry_merchants (
  canonical_origin text primary key,
  domain text not null,
  profile_url text not null,
  display_name text,
  platform text,
  advisory_score integer,
  capabilities_json jsonb not null default '[]'::jsonb,
  provider text not null default 'ucp_checker',
  source_ref text,
  observed_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  stale_after timestamptz not null,
  constraint ucp_checker_registry_merchants_origin_check
    check (canonical_origin ~ '^https://[^[:space:]]+$'),
  constraint ucp_checker_registry_merchants_profile_check
    check (profile_url ~ '^https://[^[:space:]]+/.well-known/ucp$'),
  constraint ucp_checker_registry_merchants_capabilities_json_check
    check (jsonb_typeof(capabilities_json) in ('array', 'object')),
  constraint ucp_checker_registry_merchants_advisory_score_check
    check (advisory_score is null or (advisory_score >= 0 and advisory_score <= 100))
);

create index if not exists ucp_checker_registry_merchants_domain_idx
  on ucp_checker_registry_merchants (domain);

create index if not exists ucp_checker_registry_merchants_stale_idx
  on ucp_checker_registry_merchants (stale_after);

create index if not exists ucp_checker_registry_merchants_score_idx
  on ucp_checker_registry_merchants (advisory_score desc nulls last, refreshed_at desc);
