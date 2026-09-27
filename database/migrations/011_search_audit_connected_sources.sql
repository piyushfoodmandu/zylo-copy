alter table search_audit_logs
  drop constraint if exists search_audit_logs_source_mode_check;

alter table search_audit_logs
  add constraint search_audit_logs_source_mode_check check (source_mode in (
    'approved_sources',
    'connected_sources',
    'sandbox',
    'unconfigured'
  ));