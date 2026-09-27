-- Shopper accounts.
--
-- Arro's first-party surfaces have run on an anonymous, device-bound shopper
-- session: enough to prepare and complete a checkout, but nothing that survives
-- a new browser. This adds the optional identity a shopper can choose to create
-- so a cart, a saved list and their contact details follow them between devices.
--
-- It stays optional by design. The product rule is that no permanent account is
-- required to shop, so nothing here gates the existing anonymous flow.
--
-- Passwords are stored only as a scrypt verifier: a random per-account salt and
-- the derived key, never the password and never a reversible form of it.

create table if not exists shopper_accounts (
  account_id text primary key,
  -- Case-insensitive uniqueness without a citext dependency: the normalised
  -- form is what the unique index sees, the display form is what the shopper
  -- typed and what any mail would be addressed to.
  email_normalized text not null,
  email text not null,
  password_salt text not null,
  password_hash text not null,
  password_algorithm text not null default 'scrypt',
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz,
  -- Bounded lockout state. Enough to make online guessing expensive without
  -- turning a forgotten password into a permanent denial of service.
  failed_login_count integer not null default 0,
  locked_until timestamptz
);

create unique index if not exists shopper_accounts_email_normalized_key
  on shopper_accounts (email_normalized);

-- A shopper session that has been bound to an account. Rows are the revocation
-- list: deleting one signs that session out everywhere it was presented.
create table if not exists shopper_account_sessions (
  session_id text primary key,
  account_id text not null references shopper_accounts (account_id) on delete cascade,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now()
);

create index if not exists shopper_account_sessions_account_id_idx
  on shopper_account_sessions (account_id, expires_at desc);

create index if not exists shopper_account_sessions_expires_at_idx
  on shopper_account_sessions (expires_at);
