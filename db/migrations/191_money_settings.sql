-- ════════════════════════════════════════════════════════════════════
-- 191 — the hotel's own ways of paying, its extra charges, a ₹ discount
--       (the settings plan's Money, the owner's D27-259)
--
--   1 payment_methods     each hotel's list: the word on the bill, what it is
--                         in the books (payments_method_valid's kind), On/Off,
--                         order. The default stays hotels.default_payment_method
--                         (187) and must name a method on the list that is On.
--   2 payments.method_label  the word the clerk picked ("Agoda"), kept; the
--                         reports go on counting by kind (Bill to company).
--   3 inclusions          the extra charges' list (065): a pickup or drop is one
--                         marked is_transport (D27-259 Q6); delete when unused.
--   4 room_promotions     % or ₹ off each night, exactly one.
--   5 reservations.discount_amount  ₹ off each night; free-hand up to 10% of
--                         the night with a reason (book.ts), more only by a
--                         named promotion - as the percentage.
-- ════════════════════════════════════════════════════════════════════

-- 1 · Payment methods --------------------------------------------------------
create table if not exists payment_methods (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id) on delete cascade,
  label      text not null,
  kind       text not null,
  is_active  boolean not null default true,
  sort_order int not null default 0,
  constraint payment_methods_label_present check (length(btrim(label)) > 0),
  constraint payment_methods_kind_known check (kind in
    ('cash','card','upi','netbanking','wallet','cheque','bank_transfer','city_ledger'))
);
create unique index if not exists payment_methods_label_unique
  on payment_methods (hotel_id, lower(btrim(label)));

alter table payment_methods enable row level security;
alter table payment_methods force  row level security;
drop policy if exists hotel_isolation on payment_methods;
create policy hotel_isolation on payment_methods
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );
revoke all on payment_methods from pms_app;
grant select, insert, update, delete on payment_methods to pms_app;

drop trigger if exists payment_methods_audit on payment_methods;
create trigger payment_methods_audit after insert or update or delete on payment_methods
  for each row execute function app.write_audit();

-- What the screens offered until today, so nothing changes until somebody edits.
create or replace function app.seed_payment_methods(p_hotel uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $fn$
  insert into payment_methods (hotel_id, label, kind, sort_order)
  select p_hotel, m.label, m.kind, m.n * 10
    from (values (1, 'Cash', 'cash'), (2, 'UPI', 'upi'), (3, 'Credit Card', 'card'),
                 (4, 'Debit Card', 'card'), (5, 'Bill to company', 'city_ledger'))
         as m(n, label, kind)
  on conflict do nothing;
$fn$;
revoke all on function app.seed_payment_methods(uuid) from public;

select app.seed_payment_methods(id) from hotels;

create or replace function app.payment_methods_for_new_property()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform app.seed_payment_methods(new.id);
  return new;
end $fn$;
revoke all on function app.payment_methods_for_new_property() from public;

drop trigger if exists hotels_payment_methods on hotels;
create trigger hotels_payment_methods
  after insert on hotels
  for each row execute function app.payment_methods_for_new_property();

-- The default names a method on the list that is On (187's four-word check goes).
alter table hotels drop constraint if exists hotels_default_payment_method_valid;

create or replace function app.default_payment_method_on_list()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
begin
  if not exists (select 1 from payment_methods
                  where hotel_id = new.id and label = new.default_payment_method
                    and is_active) then
    raise exception 'The default way of paying must be a payment method that is On.'
      using errcode = 'check_violation';
  end if;
  return new;
end $fn$;
revoke all on function app.default_payment_method_on_list() from public;

drop trigger if exists hotels_default_payment_method on hotels;
create trigger hotels_default_payment_method
  before update of default_payment_method on hotels
  for each row when (new.default_payment_method is distinct from old.default_payment_method)
  execute function app.default_payment_method_on_list();

-- The default is never switched off or removed; renamed, the default follows.
create or replace function app.payment_method_keeps_default()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_default text;
begin
  select default_payment_method into v_default from hotels where id = old.hotel_id;
  if old.label is distinct from v_default then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' or not new.is_active then
    raise exception 'This is the default way of paying. Make another one the default first.'
      using errcode = 'check_violation';
  end if;
  if tg_when = 'AFTER' and new.label <> old.label then
    update hotels set default_payment_method = new.label where id = old.hotel_id;
  end if;
  return new;
end $fn$;
revoke all on function app.payment_method_keeps_default() from public;

drop trigger if exists payment_methods_keep_default on payment_methods;
create trigger payment_methods_keep_default
  before update or delete on payment_methods
  for each row execute function app.payment_method_keeps_default();
drop trigger if exists payment_methods_default_follows on payment_methods;
create trigger payment_methods_default_follows
  after update of label on payment_methods
  for each row execute function app.payment_method_keeps_default();

-- 2 · The word on the payment ------------------------------------------------
alter table payments add column if not exists method_label text;
comment on column payments.method_label is
  'The payment method as the clerk picked it (191): "Agoda" where method is '
  'city_ledger. NULL on payments before 192.';

-- 3 · Extra charges: the inclusions list (065) --------------------------------
alter table inclusions add column if not exists is_transport boolean not null default false;
comment on column inclusions.is_transport is
  'A pickup or a drop (D27-259 Q6); its time and flight go in the booking''s note.';
grant delete on inclusions to pms_app;
drop trigger if exists inclusions_audit on inclusions;
create trigger inclusions_audit after insert or update or delete on inclusions
  for each row execute function app.write_audit();

-- 4 · A promotion is % or ₹ off each night ------------------------------------
alter table room_promotions alter column percent drop not null;
alter table room_promotions add column if not exists amount numeric(12,2);
alter table room_promotions drop constraint if exists room_promotions_percent_sane;
alter table room_promotions add constraint room_promotions_percent_sane check (
  (percent is not null and amount is null and percent > 0 and percent <= 100)
  or (amount is not null and percent is null and amount > 0));
grant delete on room_promotions to pms_app;
drop trigger if exists room_promotions_audit on room_promotions;
create trigger room_promotions_audit after insert or update or delete on room_promotions
  for each row execute function app.write_audit();

-- 5 · A booking's ₹ off each night -------------------------------------------
alter table reservations add column if not exists discount_amount numeric(12,2);
alter table reservations drop constraint if exists reservations_discount_rule;
alter table reservations add constraint reservations_discount_rule check (
  (discount_percent is null and discount_amount is null and room_promotion_id is null)
  or (discount_amount is null
      and discount_percent is not null and discount_percent > 0 and discount_percent <= 100
      and (room_promotion_id is not null
           or (discount_percent <= app.pos_freehand_discount_cap()
               and nullif(btrim(discount_reason), '') is not null)))
  or (discount_percent is null
      and discount_amount is not null and discount_amount > 0
      and (room_promotion_id is not null
           or nullif(btrim(discount_reason), '') is not null))
);
comment on column reservations.discount_amount is
  '₹ taken off each night''s rate at booking (191): up to the free-hand cap of the '
  'night with a reason (book.ts), more only with room_promotion_id.';
