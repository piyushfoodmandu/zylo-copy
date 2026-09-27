create table if not exists commerce_memory_proposal_policy_reviews (
  review_id text primary key,
  proposal_id text not null references commerce_memory_proposals(proposal_id) on delete cascade,
  reviewer_kind text not null check (reviewer_kind in ('system_policy')),
  decision text not null check (decision in ('approved_for_commit', 'denied')),
  issues jsonb not null default '[]'::jsonb,
  agent_integration_id text,
  agent_surface text,
  requested_action_scope text,
  external_subject_ref_hash text,
  external_task_ref_hash text,
  reviewed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint commerce_memory_policy_reviews_id_not_blank check (length(trim(review_id)) > 0),
  constraint commerce_memory_policy_reviews_proposal_not_blank check (length(trim(proposal_id)) > 0),
  constraint commerce_memory_policy_reviews_issues_array check (jsonb_typeof(issues) = 'array'),
  constraint commerce_memory_policy_reviews_subject_hash_format check (external_subject_ref_hash is null or external_subject_ref_hash ~ '^[a-f0-9]{64}$'),
  constraint commerce_memory_policy_reviews_task_hash_format check (external_task_ref_hash is null or external_task_ref_hash ~ '^[a-f0-9]{64}$')
);

create index if not exists commerce_memory_policy_reviews_proposal_idx
  on commerce_memory_proposal_policy_reviews (proposal_id, reviewed_at desc);

create index if not exists commerce_memory_policy_reviews_decision_idx
  on commerce_memory_proposal_policy_reviews (decision, reviewed_at desc);
