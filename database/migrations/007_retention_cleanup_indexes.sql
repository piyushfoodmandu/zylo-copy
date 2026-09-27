create index if not exists request_audit_log_created_at_idx
  on request_audit_log (created_at);

create index if not exists target_business_discovery_observations_created_at_idx
  on target_business_discovery_observations (created_at);

create index if not exists target_business_state_transitions_created_at_idx
  on target_business_state_transitions (created_at);