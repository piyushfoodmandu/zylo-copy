-- Product rename: Zylo -> Arro.
--
-- Migrations 001-052 stay byte-identical because they are checksummed history.
-- This migration renames the schema identifiers that carried the old product
-- name so the durable schema matches the code, and rewrites the existing rows
-- that used the old enum values.

alter table commerce_memory_proposals rename column zylo_user_id to arro_user_id;
alter table commerce_memory_records rename column zylo_user_id to arro_user_id;
alter table commerce_memory_record_stale_marks rename column zylo_user_id to arro_user_id;
alter table commerce_memory_record_refreshes rename column zylo_user_id to arro_user_id;

-- Evidence kind. Widen the constraint, move the rows, then narrow it again so no
-- window exists where a legal value is rejected.
alter table target_business_evidence
  drop constraint if exists target_business_evidence_kind_check;

update target_business_evidence set kind = 'arro_discovery' where kind = 'zylo_discovery';
update target_business_evidence set kind = 'arro_conformance' where kind = 'zylo_conformance';

alter table target_business_evidence
  add constraint target_business_evidence_kind_check
  check (kind in (
    'arro_discovery',
    'arro_conformance',
    'public_readiness_snapshot',
    'managed_channel_signal',
    'manual_review'
  ));

drop index if exists target_business_evidence_conformance_idx;

create index if not exists target_business_evidence_conformance_idx
  on target_business_evidence (business_id, observed_at desc, id desc)
  where kind = 'arro_conformance';

-- Commerce-memory consent basis.
alter table commerce_memory_proposals
  drop constraint if exists commerce_memory_proposals_consent_basis_check;

update commerce_memory_proposals
  set consent_basis = 'arro_account_setting'
  where consent_basis = 'zylo_account_setting';

alter table commerce_memory_proposals
  add constraint commerce_memory_proposals_consent_basis_check
  check (consent_basis in (
    'explicit_user_request',
    'session_policy',
    'arro_account_setting',
    'typed_migration_authorization'
  ));

-- Mandate authorization provider. 'zylo' was the first-party approval route and
-- is renamed with the product; the other providers are external names.
alter table purchase_mandates
  drop constraint if exists purchase_mandates_authorization_provider_check;

update purchase_mandates set authorization_provider = 'arro' where authorization_provider = 'zylo';

alter table purchase_mandates
  add constraint purchase_mandates_authorization_provider_check
  check (authorization_provider in (
    'arro',
    'ap2',
    'trusted_host'
  ));
