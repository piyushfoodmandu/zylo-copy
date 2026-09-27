alter table purchase_mandate_reservations
  add column if not exists reserved_amount_minor numeric(78, 0),
  add column if not exists actual_order_amount_minor numeric(78, 0),
  add column if not exists reserved_currency text,
  add column if not exists actual_order_currency text;

update purchase_mandate_reservations
set reserved_amount_minor = amount_minor
where reserved_amount_minor is null;

update purchase_mandate_reservations
set reserved_currency = currency
where reserved_currency is null;

alter table purchase_mandate_reservations
  alter column reserved_amount_minor set not null,
  alter column reserved_currency set not null;

alter table purchase_mandate_reservations
  drop constraint if exists purchase_mandate_reservations_reserved_amount_check,
  add constraint purchase_mandate_reservations_reserved_amount_check
    check (reserved_amount_minor >= 0);

alter table purchase_mandate_reservations
  drop constraint if exists purchase_mandate_reservations_actual_order_amount_check,
  add constraint purchase_mandate_reservations_actual_order_amount_check
    check (actual_order_amount_minor is null or actual_order_amount_minor >= 0);

alter table purchase_mandate_reservations
  drop constraint if exists purchase_mandate_reservations_reserved_currency_check,
  add constraint purchase_mandate_reservations_reserved_currency_check
    check (reserved_currency ~ '^[A-Z]{3}$');

alter table purchase_mandate_reservations
  drop constraint if exists purchase_mandate_reservations_actual_order_currency_check,
  add constraint purchase_mandate_reservations_actual_order_currency_check
    check (actual_order_currency is null or actual_order_currency ~ '^[A-Z]{3}$');
