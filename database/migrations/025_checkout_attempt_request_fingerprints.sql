alter table checkout_attempts
  add column if not exists request_fingerprint text;

update checkout_attempts
set request_fingerprint = concat('legacy:', attempt_id)
where request_fingerprint is null;

alter table checkout_attempts
  alter column request_fingerprint set not null;

alter table checkout_attempts
  drop constraint if exists checkout_attempts_request_fingerprint_check,
  add constraint checkout_attempts_request_fingerprint_check check (
    request_fingerprint ~ '^hmac_sha256:[0-9a-f]{64}$'
    or request_fingerprint ~ '^legacy:.+'
  );
