create index if not exists autonomous_purchase_jobs_mandate_history_idx
  on autonomous_purchase_jobs (
    mandate_id,
    owner_key_id,
    owner_principal_hash,
    created_at desc
  );
