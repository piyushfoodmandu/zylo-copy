update search_audit_logs
set route = '/v1/catalog/search'
where route = '/v1/search/universal';

alter table search_audit_logs
  drop constraint if exists search_audit_logs_route_check;

alter table search_audit_logs
  add constraint search_audit_logs_route_check
  check (route = '/v1/catalog/search');
