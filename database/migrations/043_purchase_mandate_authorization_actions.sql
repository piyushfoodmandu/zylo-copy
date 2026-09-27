alter table purchase_mandates
  drop constraint if exists purchase_mandates_authorization_provider_check;

update purchase_mandates
set authorization_provider = case authorization_provider
    when 'trusted_host' then 'trusted_host_signature'
    when 'ap2' then 'ap2_trusted_surface'
    when 'zylo' then 'user_approval_action'
    else authorization_provider
  end,
  mandate_json = jsonb_set(
    mandate_json,
    '{authorizationProvider}',
    to_jsonb(case authorization_provider
      when 'trusted_host' then 'trusted_host_signature'
      when 'ap2' then 'ap2_trusted_surface'
      when 'zylo' then 'user_approval_action'
      else authorization_provider
    end),
    false
  )
where authorization_provider in ('trusted_host', 'ap2', 'zylo');

alter table purchase_mandates
  add constraint purchase_mandates_authorization_provider_check check (authorization_provider in (
    'user_approval_action',
    'passkey_webauthn',
    'ap2_trusted_surface',
    'trusted_host_signature'
  ));

create table if not exists purchase_mandate_authorization_actions (
  action_id text primary key,
  mandate_id text not null references purchase_mandates(mandate_id) on delete cascade,
  mandate_version integer not null,
  owner_key_id text not null,
  owner_principal_hash text not null,
  integration_id text not null,
  authorization_hash text not null,
  mode text not null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_mandate_authorization_hash_check
    check (authorization_hash ~ '^sha256:[0-9a-f]{64}$'),
  constraint purchase_mandate_authorization_status_check check (status in (
    'pending',
    'consumed',
    'revoked',
    'expired'
  )),
  constraint purchase_mandate_authorization_mode_check check (mode in (
    'user_approval_action',
    'passkey_webauthn',
    'ap2_trusted_surface',
    'trusted_host_signature'
  )),
  constraint purchase_mandate_authorization_lifecycle_check check (
    (status = 'pending' and consumed_at is null and revoked_at is null)
    or (status = 'consumed' and consumed_at is not null and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null and consumed_at is null)
    or (status = 'expired' and revoked_at is not null and consumed_at is null)
  ),
  unique (mandate_id, mandate_version, authorization_hash, mode)
);

create index if not exists purchase_mandate_authorization_owner_idx
  on purchase_mandate_authorization_actions (
    owner_key_id,
    owner_principal_hash,
    integration_id,
    status,
    expires_at
  );
