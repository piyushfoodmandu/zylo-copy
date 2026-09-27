alter table decision_receipts
  add column if not exists request_fingerprint text;

update decision_receipts
set request_fingerprint = concat('legacy:', receipt_id)
where request_fingerprint is null;

alter table decision_receipts
  alter column request_fingerprint set not null;

alter table decision_receipts
  drop constraint if exists decision_receipts_request_fingerprint_check,
  add constraint decision_receipts_request_fingerprint_check check (
    request_fingerprint ~ '^hmac_sha256:[0-9a-f]{64}$'
    or request_fingerprint ~ '^legacy:.+'
  );
