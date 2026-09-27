alter table search_audit_logs
  drop constraint if exists search_audit_query_normalized_not_blank;

alter table search_audit_logs
  alter column query_normalized drop not null;
