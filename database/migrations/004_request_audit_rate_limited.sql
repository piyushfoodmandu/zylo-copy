alter table request_audit_log
  drop constraint if exists request_audit_log_decision_check;

alter table request_audit_log
  add constraint request_audit_log_decision_check check (decision in (
    'allowed',
    'authentication_required',
    'invalid_api_key',
    'insufficient_scope',
    'authentication_unavailable',
    'rate_limited'
  ));