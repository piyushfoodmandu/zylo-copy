alter table ucp_payment_actions
  drop constraint if exists ucp_payment_actions_action_type_check,
  add constraint ucp_payment_actions_action_type_check
    check (action_type in (
      'x402',
      'mpp',
      'host_supplied',
      'google_pay',
      'processor_tokenizer'
    ));

alter table ucp_payment_actions
  drop constraint if exists ucp_payment_actions_route_check,
  add constraint ucp_payment_actions_route_check
    check (route is null or route in (
      'x402',
      'mpp',
      'trusted_host',
      'google_pay',
      'processor_tokenizer',
      'merchant_hosted'
    ));

comment on table ucp_payment_actions is
  'Checkout-bound, consume-once payment actions. x402 and MPP credentials remain encrypted in the runtime vault; PostgreSQL stores only redacted continuity metadata.';
