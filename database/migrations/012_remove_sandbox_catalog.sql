delete from target_businesses
where source_type = 'sandbox'
   or feature_visibility = 'sandbox_only'
   or launch_status in ('verification_only', 'sandbox_ready');

delete from target_business_evidence
where kind = 'sandbox_fixture';

delete from target_business_state_transitions
where previous_launch_status in ('verification_only', 'sandbox_ready')
  or next_launch_status in ('verification_only', 'sandbox_ready')
  or previous_feature_visibility = 'sandbox_only'
  or next_feature_visibility = 'sandbox_only';

delete from search_audit_logs
where source_mode = 'sandbox';

alter table target_businesses drop constraint if exists target_businesses_source_type_check;
alter table target_businesses add constraint target_businesses_source_type_check
  check (source_type in ('direct_ucp', 'managed_channel', 'approved_feed', 'unsupported'));

alter table target_businesses drop constraint if exists target_businesses_launch_status_check;
alter table target_businesses add constraint target_businesses_launch_status_check
  check (launch_status in ('candidate', 'outreach', 'launch_visible', 'blocked'));

alter table target_businesses drop constraint if exists target_businesses_feature_visibility_check;
alter table target_businesses add constraint target_businesses_feature_visibility_check
  check (feature_visibility in ('hidden', 'discovery_only', 'catalog_visible', 'checkout_visible'));

alter table target_business_evidence drop constraint if exists target_business_evidence_kind_check;
alter table target_business_evidence add constraint target_business_evidence_kind_check
  check (kind in ('zylo_discovery', 'zylo_conformance', 'public_readiness_snapshot', 'managed_channel_signal', 'manual_review'));

alter table search_audit_logs drop constraint if exists search_audit_logs_source_mode_check;
alter table search_audit_logs add constraint search_audit_logs_source_mode_check
  check (source_mode in ('approved_sources', 'connected_sources', 'unconfigured'));

alter table target_business_state_transitions drop constraint if exists target_business_state_transitions_previous_launch_status_check;
alter table target_business_state_transitions add constraint target_business_state_transitions_previous_launch_status_check
  check (previous_launch_status in ('candidate', 'outreach', 'launch_visible', 'blocked'));

alter table target_business_state_transitions drop constraint if exists target_business_state_transitions_next_launch_status_check;
alter table target_business_state_transitions add constraint target_business_state_transitions_next_launch_status_check
  check (next_launch_status in ('candidate', 'outreach', 'launch_visible', 'blocked'));

alter table target_business_state_transitions drop constraint if exists target_business_state_transitions_previous_feature_visibility_check;
alter table target_business_state_transitions add constraint target_business_state_transitions_previous_feature_visibility_check
  check (previous_feature_visibility in ('hidden', 'discovery_only', 'catalog_visible', 'checkout_visible'));

alter table target_business_state_transitions drop constraint if exists target_business_state_transitions_next_feature_visibility_check;
alter table target_business_state_transitions add constraint target_business_state_transitions_next_feature_visibility_check
  check (next_feature_visibility in ('hidden', 'discovery_only', 'catalog_visible', 'checkout_visible'));