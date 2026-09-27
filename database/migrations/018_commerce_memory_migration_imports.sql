create table if not exists commerce_memory_migration_imports (
  import_id text primary key,
  import_status text not null check (import_status in ('queued_for_policy_review', 'rejected')),
  proposal_id text not null,
  accepted_proposal_id text references commerce_memory_proposals(proposal_id) on delete cascade,
  adapter_id text not null,
  source_kind text not null check (source_kind in (
    'host_memory',
    'external_memory_provider',
    'vector_store',
    'user_modeling_system',
    'agent_session_log'
  )),
  source_system text not null,
  source_record_ref_hash text not null,
  integration_id text not null,
  external_subject_ref_hash text not null,
  external_task_ref_hash text,
  record_kind text not null check (record_kind in (
    'region',
    'currency',
    'size',
    'budget',
    'fulfillment_preference',
    'accepted_alternative',
    'rejected_alternative',
    'saved_product_reference',
    'comparison_reference',
    'cart_handoff_reference',
    'checkout_completion_reference',
    'decision_receipt_reference',
    'source_state_reference',
    'no_buy_warning',
    'stale_reference'
  )),
  retention_class text not null check (retention_class in (
    'session_only',
    'user_controlled',
    'time_limited',
    'receipt_bound'
  )),
  prompt_exposure_class text not null check (prompt_exposure_class in (
    'never_prompt',
    'summary_only',
    'retrieval_allowed'
  )),
  consent_basis text not null check (consent_basis = 'typed_migration_authorization'),
  issues jsonb not null default '[]'::jsonb,
  imported_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_memory_migration_imports_id_not_blank check (length(trim(import_id)) > 0),
  constraint commerce_memory_migration_imports_proposal_not_blank check (length(trim(proposal_id)) > 0),
  constraint commerce_memory_migration_imports_adapter_not_blank check (length(trim(adapter_id)) > 0),
  constraint commerce_memory_migration_imports_source_system_not_blank check (length(trim(source_system)) > 0),
  constraint commerce_memory_migration_imports_source_ref_hash_format check (source_record_ref_hash ~ '^[a-f0-9]{64}$'),
  constraint commerce_memory_migration_imports_integration_not_blank check (length(trim(integration_id)) > 0),
  constraint commerce_memory_migration_imports_subject_hash_format check (external_subject_ref_hash ~ '^[a-f0-9]{64}$'),
  constraint commerce_memory_migration_imports_task_hash_format check (external_task_ref_hash is null or external_task_ref_hash ~ '^[a-f0-9]{64}$'),
  constraint commerce_memory_migration_imports_issues_array check (jsonb_typeof(issues) = 'array'),
  constraint commerce_memory_migration_imports_status_consistency check (
    (
      import_status = 'queued_for_policy_review'
      and accepted_proposal_id = proposal_id
      and jsonb_array_length(issues) = 0
    )
    or (
      import_status = 'rejected'
      and accepted_proposal_id is null
      and jsonb_array_length(issues) > 0
    )
  )
);

create unique index if not exists commerce_memory_migration_imports_source_dedupe_idx
  on commerce_memory_migration_imports (
    adapter_id,
    source_record_ref_hash,
    integration_id,
    external_subject_ref_hash
  );

create index if not exists commerce_memory_migration_imports_proposal_idx
  on commerce_memory_migration_imports (proposal_id, import_status, imported_at desc);

create index if not exists commerce_memory_migration_imports_scope_idx
  on commerce_memory_migration_imports (
    integration_id,
    external_subject_ref_hash,
    source_kind,
    imported_at desc
  );
