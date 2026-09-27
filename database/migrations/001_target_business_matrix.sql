create table if not exists target_businesses (
  business_id text primary key,
  domain text not null,
  display_name text not null,
  source_type text not null check (source_type in ('sandbox', 'direct_ucp', 'managed_channel', 'approved_feed', 'unsupported')),
  launch_status text not null check (launch_status in ('verification_only', 'candidate', 'outreach', 'sandbox_ready', 'launch_visible', 'blocked')),
  feature_visibility text not null check (feature_visibility in ('hidden', 'discovery_only', 'sandbox_only', 'catalog_visible', 'checkout_visible')),
  access_policy_state text not null check (access_policy_state in ('unknown', 'profile_fetched', 'partner_required', 'approved', 'limited', 'rate_limited', 'denied', 'error')),
  profile_url text,
  profile_hash text,
  last_discovered_at timestamptz,
  next_review_at timestamptz,
  user_facing_label text not null,
  user_facing_reason text not null,
  user_facing_next_action text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists target_business_capabilities (
  id bigint generated always as identity primary key,
  business_id text not null references target_businesses (business_id) on delete cascade,
  capability text not null,
  status text not null check (status in ('unknown', 'not_supported', 'discovery_only', 'limited', 'approved', 'blocked')),
  source text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, capability, source)
);

create table if not exists target_business_evidence (
  id bigint generated always as identity primary key,
  business_id text not null references target_businesses (business_id) on delete cascade,
  kind text not null check (kind in ('zylo_discovery', 'sandbox_fixture', 'public_readiness_snapshot', 'managed_channel_signal', 'manual_review')),
  source text not null,
  observed_at timestamptz not null,
  expires_at timestamptz,
  summary text not null,
  created_at timestamptz not null default now()
);

create index if not exists target_businesses_domain_idx on target_businesses (domain);
create index if not exists target_businesses_visibility_idx on target_businesses (feature_visibility, launch_status, access_policy_state);
create index if not exists target_business_capabilities_lookup_idx on target_business_capabilities (capability, status);
create index if not exists target_business_evidence_business_idx on target_business_evidence (business_id, observed_at desc);