-- =============================================================================
-- 146 · New booking records every field of the owner's screenshot (D27-33)
-- =============================================================================
-- Phase 1 of docs/PLATFORM-PLAN.md § 3. What a booking gains here, each read
-- and written by api/src/modules/reservations/book.ts:
--
--   reservations.expected_departure   the hour they said they would leave
--   reservations.discount_*           the restaurant's rule for rooms (D27-36)
--   room_promotions                   the named discounts over 10%, per hotel
--   sales_people                      the list the owner keeps (D27-37)
--   guests.title                      Mr, Ms, Mrs, Dr or none (the owner, 27 Sep)
--   guest_documents.state, .pincode   beside the address, which 013 moved there
--                                     for privacy - so the rest of it goes too
--
-- Market segment, sales person, Waiting (status 'tentative'), complimentary
-- and the company billed already had their columns (005, 020, 042).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · The hour they leave
-- -----------------------------------------------------------------------------
-- NULL when they did not say, which is most bookings - the arrival hour's
-- rule (064). A late check-out and its charge stay front desk's (063).
alter table reservations add column if not exists expected_departure time;

comment on column reservations.expected_departure is
  'The hour the guest said they would leave. NULL when they did not say - '
  'never the hotel''s check-out time filled in for them.';


-- -----------------------------------------------------------------------------
-- 2 · Room promotions - a discount over 10% is only ever one of these
-- -----------------------------------------------------------------------------
-- Per hotel, like the restaurant's (083). A percentage only: the discount is
-- taken off each night's rate, which is the one figure a booking keeps.
create table if not exists room_promotions (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id) on delete cascade,
  name       text not null,
  percent    numeric(5,2) not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table room_promotions drop constraint if exists room_promotions_percent_sane;
alter table room_promotions add constraint room_promotions_percent_sane
  check (percent > 0 and percent <= 100);

create unique index if not exists room_promotions_name_unique
  on room_promotions (hotel_id, lower(btrim(name)));

drop trigger if exists room_promotions_touch on room_promotions;
create trigger room_promotions_touch before update on room_promotions
  for each row execute function app.touch_updated_at();

alter table room_promotions enable row level security;
alter table room_promotions force row level security;
drop policy if exists hotel_isolation on room_promotions;
create policy hotel_isolation on room_promotions
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));

-- No delete: a booking that used a promotion points at it. Switched off instead.
grant select, insert, update on room_promotions to pms_app;

comment on table room_promotions is
  'Named room discounts (D27-36). Over the free-hand cap only through one of '
  'these. Kept by the owner, an administrator or the GM, asked in the API.';


-- -----------------------------------------------------------------------------
-- 3 · The discount on a booking
-- -----------------------------------------------------------------------------
-- The nightly rate a booking keeps (agreed_rate) is already the discounted
-- one, so the night audit, the tax slab and the bill follow with no second
-- sum. These say how it got there: by hand, with a reason, up to the
-- restaurant's cap (083's app.pos_freehand_discount_cap, 10); or by a promotion.
alter table reservations
  add column if not exists discount_percent  numeric(5,2),
  add column if not exists discount_reason   text,
  add column if not exists room_promotion_id uuid references room_promotions(id);

-- ⚠ `discount_percent is not null` is spelled out: a NULL compared to 0 is
-- unknown, and a CHECK that comes out unknown PASSES - so a promotion with no
-- percent was let in until the suite's own test refused to be refused.
-- Guarded (MEMORY 284, 403): 191 rewrote this rule to allow a discount in
-- rupees (discount_amount). On a replay, re-adding this older rule over a
-- booking with a rupee promotion refused it and the whole replay rolled back,
-- so it is written only while the rule does not know discount_amount yet.
do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'reservations_discount_rule'
                    and pg_get_constraintdef(oid) like '%discount_amount%') then
    alter table reservations drop constraint if exists reservations_discount_rule;
    alter table reservations add constraint reservations_discount_rule check (
      (discount_percent is null and room_promotion_id is null)
      or (discount_percent is not null and discount_percent > 0 and discount_percent <= 100
          and (room_promotion_id is not null
               or (discount_percent <= app.pos_freehand_discount_cap()
                   and nullif(btrim(discount_reason), '') is not null)))
    );
  end if;
end $$;

comment on column reservations.discount_percent is
  'The discount taken off the nightly rate at booking. Up to the free-hand cap '
  'with a reason; more only with room_promotion_id (D27-36).';


-- -----------------------------------------------------------------------------
-- 4 · Sales people - the list the owner keeps (D27-37)
-- -----------------------------------------------------------------------------
-- One list for the group: the same people sell every hotel. A booking keeps
-- the NAME in reservations.sales_person (042, free text), so "Other" can still
-- be typed and a name taken off the list stays on its old bookings.
create table if not exists sales_people (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sales_people_name_unique
  on sales_people (lower(btrim(name)));

drop trigger if exists sales_people_touch on sales_people;
create trigger sales_people_touch before update on sales_people
  for each row execute function app.touch_updated_at();

-- Every clerk reads it (they pick from it); the owner, an administrator or a
-- GM changes it - app.is_crm_manager() is exactly those three (122).
alter table sales_people enable row level security;
alter table sales_people force row level security;
drop policy if exists sales_people_read on sales_people;
create policy sales_people_read on sales_people
  for select using ( app.is_active_staff() );
drop policy if exists sales_people_write on sales_people;
create policy sales_people_write on sales_people
  for insert with check ( app.is_crm_manager() );
drop policy if exists sales_people_update on sales_people;
create policy sales_people_update on sales_people
  for update using ( app.is_crm_manager() ) with check ( app.is_crm_manager() );

grant select, insert, update on sales_people to pms_app;


-- -----------------------------------------------------------------------------
-- 5 · The guest's title, and the rest of their address
-- -----------------------------------------------------------------------------
alter table guests add column if not exists title text;
alter table guests drop constraint if exists guests_title_valid;
alter table guests add constraint guests_title_valid
  check (title is null or title in ('Mr', 'Ms', 'Mrs', 'Dr'));

alter table guest_documents
  add column if not exists state   text,
  add column if not exists pincode text;

comment on column guest_documents.pincode is
  'The PIN code of the address, as typed at booking. Kept beside address_line '
  'for the same reason 013 moved the address here.';
