create unique index if not exists ucp_payment_actions_provider_reference_unique
  on ucp_payment_actions (provider_reference_id)
  where provider_reference_id is not null;

comment on index ucp_payment_actions_provider_reference_unique is
  'A processor reference such as a Stripe PaymentIntent can authorize only one Arro payment action.';
