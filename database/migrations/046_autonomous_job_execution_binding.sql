alter table autonomous_purchase_jobs
  add column if not exists authorization_route text,
  add column if not exists host_id text,
  add column if not exists agent_session_id text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists failed_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'autonomous_purchase_jobs_authorization_route_check'
  ) then
    alter table autonomous_purchase_jobs
      add constraint autonomous_purchase_jobs_authorization_route_check
      check (authorization_route is null or authorization_route = 'trusted_host');
  end if;
end $$;
