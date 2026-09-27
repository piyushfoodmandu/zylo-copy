create table if not exists target_business_discovery_observations (
  id bigint generated always as identity primary key,
  request_id text not null,
  correlation_id text not null,
  principal_key_id text,
  owner_principal text,
  business_id text references target_businesses (business_id) on delete set null,
  domain text not null,
  profile_url text not null,
  discovery_status text not null check (discovery_status in ('fetched', 'blocked', 'not_found', 'invalid_profile', 'error')),
  access_policy_state text not null check (access_policy_state in ('unknown', 'profile_fetched', 'partner_required', 'approved', 'limited', 'rate_limited', 'denied', 'error')),
  profile_hash text,
  profile_shape text check (profile_shape in ('canonical_ucp', 'root_profile')),
  protocol_versions text[] not null default '{}',
  supported_version_urls text[] not null default '{}',
  capabilities text[] not null default '{}',
  services jsonb not null default '[]'::jsonb,
  payment_handlers text[] not null default '{}',
  signing_key_count integer check (signing_key_count is null or signing_key_count >= 0),
  cache_summary jsonb not null default '{}'::jsonb,
  dns_summary jsonb not null default '{}'::jsonb,
  http_status integer check (http_status is null or http_status between 100 and 599),
  content_type text,
  response_bytes integer check (response_bytes is null or response_bytes >= 0),
  latency_ms numeric(12, 3) check (latency_ms is null or latency_ms >= 0),
  fetched_at timestamptz not null,
  validated_at timestamptz,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint discovery_observation_request_id_not_blank check (length(trim(request_id)) > 0),
  constraint discovery_observation_correlation_id_not_blank check (length(trim(correlation_id)) > 0),
  constraint discovery_observation_domain_not_blank check (length(trim(domain)) > 0),
  constraint discovery_observation_profile_url_not_blank check (length(trim(profile_url)) > 0)
);

create index if not exists target_business_discovery_observations_domain_idx
  on target_business_discovery_observations (domain, created_at desc);

create index if not exists target_business_discovery_observations_business_idx
  on target_business_discovery_observations (business_id, created_at desc)
  where business_id is not null;

create index if not exists target_business_discovery_observations_profile_hash_idx
  on target_business_discovery_observations (profile_hash)
  where profile_hash is not null;

create index if not exists target_business_discovery_observations_state_idx
  on target_business_discovery_observations (discovery_status, access_policy_state, created_at desc);

create index if not exists target_business_discovery_observations_request_idx
  on target_business_discovery_observations (request_id, created_at desc);