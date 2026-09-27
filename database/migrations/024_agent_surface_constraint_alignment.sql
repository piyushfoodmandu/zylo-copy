alter table decision_receipts
  drop constraint if exists decision_receipts_surface_check,
  drop constraint if exists decision_receipts_requested_action_scope_check,
  add constraint decision_receipts_surface_check check (
    surface in (
      'chatgpt',
      'claude',
      'hermes_agent',
      'generic_mcp',
      'direct_http',
      'managed_channel',
      'internal'
    )
  ),
  add constraint decision_receipts_requested_action_scope_check check (
    requested_action_scope in (
      'read:search',
      'read:product_detail',
      'read:compare',
      'read:source_state',
      'read:sanity_check',
      'write:decision_receipt',
      'write:memory',
      'write:cart_prepare',
      'write:checkout_handoff',
      'write:complete_checkout'
    )
  );

alter table checkout_attempts
  drop constraint if exists checkout_attempts_surface_check,
  add constraint checkout_attempts_surface_check check (
    surface in (
      'chatgpt',
      'claude',
      'hermes_agent',
      'generic_mcp',
      'direct_http',
      'managed_channel',
      'internal'
    )
  );
