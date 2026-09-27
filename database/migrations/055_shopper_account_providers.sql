-- Federated sign-in for shopper accounts.
--
-- An account may now be reached by password, by an identity provider, or by
-- both. Password columns therefore become nullable: an account created through
-- Google has no password and must not be given a fake one.
--
-- Linking is on the provider's stable subject, never on the email address. An
-- email can change hands; a subject identifies the same person at the provider
-- for the life of the account.

alter table shopper_accounts
  alter column password_salt drop not null,
  alter column password_hash drop not null;

create table if not exists shopper_account_identities (
  provider text not null check (provider in ('google', 'apple')),
  subject text not null,
  account_id text not null references shopper_accounts (account_id) on delete cascade,
  email text,
  linked_at timestamptz not null default now(),
  primary key (provider, subject)
);

create index if not exists shopper_account_identities_account_id_idx
  on shopper_account_identities (account_id);
