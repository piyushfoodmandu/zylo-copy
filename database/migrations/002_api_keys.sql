create table if not exists api_keys (
  id text primary key,
  key_hash text not null unique,
  owner_principal text not null,
  scopes text[] not null,
  environment text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint api_keys_id_format check (id ~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{7,80}$'),
  constraint api_keys_hash_not_blank check (length(trim(key_hash)) >= 64),
  constraint api_keys_owner_not_blank check (length(trim(owner_principal)) > 0),
  constraint api_keys_scopes_not_empty check (cardinality(scopes) > 0),
  constraint api_keys_environment_not_blank check (length(trim(environment)) > 0)
);

create index if not exists api_keys_active_lookup_idx on api_keys (id) where revoked_at is null;
create index if not exists api_keys_owner_idx on api_keys (owner_principal, created_at desc);
create index if not exists api_keys_last_used_idx on api_keys (last_used_at desc nulls last);