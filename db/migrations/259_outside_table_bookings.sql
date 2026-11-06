-- =============================================================================
-- 263 · Table bookings for outside diners (D27-383 item 9; built under D27-396)
-- =============================================================================
-- "a table for the guest" (172) is a hotel guest's request from their own
-- page. The restaurant also takes bookings from people who are not staying: a
-- phone call, a walk-in for later. A person at the restaurant types those in -
-- name, phone, party, date and time, a table or an area, a note - and on the
-- night marks each one arrived, seats it at a table (which opens that table's
-- bill, as Tables does), or a no-show, or cancels it. A hotel guest's confirmed
-- booking is seated, marked and cancelled the same way.
--
--   * table_bookings.reservation_id may be empty: an outside diner, who then
--     has a name and a phone of their own (diner_name, diner_phone).
--   * section_id: the area asked for when no table is named.
--   * status gains arrived, seated and no_show; arrived_at, and order_id - the
--     bill seating opened.
--   * The staff may now INSERT, but only an outside diner's booking: a hotel
--     guest's is still made only by the guest's own function (172).
--   * The guest's page keeps its four words: arrived and seated read as
--     confirmed, a no-show too (app.guest_table_bookings_mine).
--
-- Re-runnable.
-- =============================================================================

alter table table_bookings alter column reservation_id drop not null;
alter table table_bookings add column if not exists diner_name  text;
alter table table_bookings add column if not exists diner_phone text;
alter table table_bookings add column if not exists section_id  uuid references pos_sections(id);
alter table table_bookings add column if not exists arrived_at  timestamptz;
alter table table_bookings add column if not exists order_id    uuid references pos_orders(id);

comment on column table_bookings.diner_name is
  'An outside diner''s name (259): set exactly when the booking is for nobody staying.';
comment on column table_bookings.section_id is
  'The area asked for (259), when no table is named.';
comment on column table_bookings.order_id is
  'The bill seating this booking opened on its table (259).';

alter table table_bookings drop constraint if exists table_bookings_status;
alter table table_bookings add constraint table_bookings_status check (
  status in ('requested', 'confirmed', 'declined', 'cancelled', 'arrived', 'seated', 'no_show'));

/* A table on any booking somebody has said yes to - not on one still waiting
   or declined. (172's rule allowed it on a confirmed one only.) */
alter table table_bookings drop constraint if exists table_bookings_table_when_confirmed;
alter table table_bookings drop constraint if exists table_bookings_table_when_answered;
alter table table_bookings add constraint table_bookings_table_when_answered check (
  table_id is null or status not in ('requested', 'declined'));

/* Whose: a stay, or an outside diner with a name and a phone - never both. */
alter table table_bookings drop constraint if exists table_bookings_whose;
alter table table_bookings add constraint table_bookings_whose check (
  (reservation_id is not null and diner_name is null and diner_phone is null)
  or (reservation_id is null
      and nullif(btrim(diner_name), '') is not null and char_length(diner_name) <= 60
      and nullif(btrim(diner_phone), '') is not null and char_length(diner_phone) <= 20));

/* An outside diner's booking is taken by a person, so it starts confirmed:
   it is never a request waiting, and so never declined. */
alter table table_bookings drop constraint if exists table_bookings_outside_confirmed;
alter table table_bookings add constraint table_bookings_outside_confirmed check (
  reservation_id is not null or status not in ('requested', 'declined'));

/* Seated means a table and the bill it opened. */
alter table table_bookings drop constraint if exists table_bookings_seated_has_bill;
alter table table_bookings add constraint table_bookings_seated_has_bill check (
  status <> 'seated' or (table_id is not null and order_id is not null));

/* 172's check, with an empty stay allowed, and the area and bill this hotel's. */
create or replace function app.table_booking_is_here()
returns trigger language plpgsql as $$
begin
  if (select hotel_id from pos_outlets where id = new.outlet_id) is distinct from new.hotel_id then
    raise exception 'that restaurant is at another property';
  end if;
  if new.reservation_id is not null
     and (select hotel_id from reservations where id = new.reservation_id) is distinct from new.hotel_id then
    raise exception 'that stay is at another property';
  end if;
  if new.table_id is not null
     and (select hotel_id from pos_tables where id = new.table_id) is distinct from new.hotel_id then
    raise exception 'that table is at another property';
  end if;
  if new.section_id is not null
     and (select hotel_id from pos_sections where id = new.section_id) is distinct from new.hotel_id then
    raise exception 'that area is at another property';
  end if;
  if new.order_id is not null
     and (select hotel_id from pos_orders where id = new.order_id) is distinct from new.hotel_id then
    raise exception 'that bill is at another property';
  end if;
  return new;
end $$;

/* The staff make an outside diner's booking - and only that. */
drop policy if exists table_bookings_outside on table_bookings;
create policy table_bookings_outside on table_bookings
  for insert
  with check ( hotel_id in (select app.auth_hotel_ids()) and reservation_id is null );
grant insert on table_bookings to pms_app;

/* The guest's page: its four words, whatever the restaurant marks on the night. */
create or replace function app.guest_table_bookings_mine(p_token_hash text, p_unlock_hash text)
returns table (id uuid, outlet_name text, night date, at_time text, party smallint,
               note text, status text, answer text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select b.id, o.name, (b.at at time zone h.timezone)::date,
         to_char(b.at at time zone h.timezone, 'HH24:MI'), b.party, b.note,
         case when b.status in ('arrived', 'seated', 'no_show') then 'confirmed' else b.status end,
         case when b.status = 'declined' then b.answer end
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    join table_bookings b on b.reservation_id = v.reservation_id
    join pos_outlets o on o.id = b.outlet_id
    join hotels h on h.id = b.hotel_id
   order by b.at;
$fn$;

revoke all on function app.guest_table_bookings_mine(text, text) from public;
grant execute on function app.guest_table_bookings_mine(text, text) to pms_app;
