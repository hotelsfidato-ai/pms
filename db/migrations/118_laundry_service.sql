-- =============================================================================
-- The laundry service — a property's price list, and a docket for every bag
-- =============================================================================
-- ⚠ 116 IS PROVISIONAL AND THE MASTER RENUMBERS IT AT MERGE. Refer to this
--   file by what it does - "the laundry service" - never by its number.
--
--   The plan says to ask the master for a number and take none (PARALLEL-PLAN
--   § 5 rule 4), and the master was asked. It is written as 116 anyway because
--   `src/test/migrationNumbers.test.ts` refuses a GAP as well as a duplicate:
--   an unnumbered file, or a 117 with no 116, turns this branch's Action red
--   for everybody who reads it. Purchasing's own file is 115 in its copy and
--   becomes 116 at merge, so ONE of us is renumbered - which is the case the
--   master already handles (README, "take the next number and tell the master").
--
-- Built by the laundry chat, 18 September. The brief is docs/briefs/laundry.md;
-- the decisions are D17-54 (a per-hotel switch), D18-5 (every docket says whose
-- it is), D18-7 (a guest's docket charges straight to the room) and D18-8
-- (reception and housekeeping run it - no new roles).
--
-- THE SWITCH IS NOT HERE. The master wrote it (115) so that this chat and the
-- spa chat beside it never rewrite one constraint in two files - the fault of
-- MEMORY 284, 293 and 299. Nothing below touches `hotel_modules_known`, and
-- nothing below rewrites a constraint any other migration defines.
--
-- THE RULES THIS FILE MAKES THE DATABASE'S, NOT A SCREEN'S
--
--   NOTHING IS PRICED. A property starts with an empty list, and a line on it
--     may have no price at all: NULL, which reads as a dash and never as zero.
--   AN UNPRICED BAG CANNOT BE CHARGED. A guest's docket carrying one line
--     nobody has priced has no total - NULL, not a part-total - and the trigger
--     below refuses to attach a charge to it.
--   WHOSE IT IS IS A COLUMN, NOT A TAG (D18-5). A guest's docket names the
--     stay; the hotel's own names none, and can never carry a charge.
--   NOTHING COMES BACK TWICE. What is still out is what went out minus what
--     came back, and neither number can be talked past the other.
--   A TIME BELONGS TO ITS PROPERTY. Written through app.hotel_moment, read
--     through app.hotel_clock (113) - the server runs in GMT, Akkalkot does not.
--
-- WHAT IT DOES NOT DO: linen par levels per room type, an outside laundry's
-- bills, express surcharges, a guest sending a bag from their own page. The
-- screens say so where a person would look for them.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- The price list - item by item, by service. Empty at every property.
-- -----------------------------------------------------------------------------
-- A ROW PER (ITEM, SERVICE), not an item with three price columns: a property
-- that presses shirts and does not dry-clean them should have no dry-clean line
-- to leave blank, and "blank" and "we do not do that" are different answers.
-- -----------------------------------------------------------------------------
create table if not exists laundry_price_items (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references hotels(id) on delete cascade,

  name        text not null,                 -- Shirt, Trousers, Saree...
  service     text not null,                 -- wash | press | dry_clean

  -- NULL is the shipped state and a permanent, legal one: nobody has priced it.
  -- It reads as a dash. It is never 0, and a 0 here means somebody decided the
  -- item is free, which is a different thing and is allowed to be said.
  price       numeric(12,2),

  is_active   boolean not null default true,
  created_by  uuid references staff(id),
  created_at  timestamptz not null default now(),

  unique (hotel_id, id),
  constraint laundry_price_items_name_present check (length(btrim(name)) > 0),
  constraint laundry_price_items_service_known
    check (service in ('wash', 'press', 'dry_clean')),
  constraint laundry_price_items_price_sane check (price is null or price >= 0)
);

comment on table laundry_price_items is
  'What a property launders and what it charges. Ships empty; a price nobody '
  'has set is NULL - a dash on screen, never a zero, and never chargeable.';

comment on column laundry_price_items.price is
  'NULL means unpriced: the item shows a dash and a docket carrying it cannot '
  'be charged. 0 means somebody decided it is free, which is a decision.';

-- One line per item and service at a property, case-insensitively - "Shirt"
-- and "shirt" are the same shirt. Retired lines are left out so a name can be
-- used again after it has been retired.
create unique index if not exists laundry_price_items_one_line
  on laundry_price_items (hotel_id, lower(btrim(name)), service)
  where is_active;

alter table laundry_price_items enable row level security;
alter table laundry_price_items force  row level security;
drop policy if exists hotel_isolation on laundry_price_items;
create policy hotel_isolation on laundry_price_items
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert, update on laundry_price_items to pms_app;
revoke delete on laundry_price_items from pms_app;

drop trigger if exists laundry_price_items_staff_scope on laundry_price_items;
create trigger laundry_price_items_staff_scope
  before insert or update on laundry_price_items
  for each row execute function app.assert_staff_has_hotel('created_by');


-- -----------------------------------------------------------------------------
-- The docket - one bag, and whose it is
-- -----------------------------------------------------------------------------
create table if not exists laundry_dockets (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references hotels(id) on delete cascade,

  number          text not null,             -- LD-0001, per property

  -- D18-5, AND IT IS A COLUMN. "Both the guest's laundry and the hotel's own
  -- linen, in one place, with every docket saying whose it is." A tag can be
  -- left off; a NOT NULL column cannot.
  belongs_to      text not null,             -- guest | hotel
  reservation_id  uuid references reservations(id),

  status          text not null default 'open',   -- open | returned | cancelled

  -- The trading day it was collected on, so the charge and every report agree
  -- with the rest of the ledger about which day this was.
  business_date   date not null,

  collected_at    timestamptz not null default now(),
  returned_at     timestamptz,

  notes           text,

  -- Set when the bag is charged to the room. A hotel docket never has one.
  charge_posting_id bigint references folio_postings(id),

  created_by      uuid references staff(id),
  created_at      timestamptz not null default now(),

  unique (hotel_id, id),
  unique (hotel_id, number),

  constraint laundry_dockets_whose_it_is
    check (belongs_to in ('guest', 'hotel')),

  -- A guest's docket always names the stay; the hotel's own never does.
  constraint laundry_dockets_guest_names_a_stay check (
    (belongs_to = 'guest' and reservation_id is not null)
    or (belongs_to = 'hotel' and reservation_id is null)
  ),

  constraint laundry_dockets_status_known
    check (status in ('open', 'returned', 'cancelled')),

  -- "Returned" and "came back at" are one fact, said once.
  constraint laundry_dockets_returned_has_a_time
    check ((status = 'returned') = (returned_at is not null)),

  -- A HOTEL DOCKET IS NEVER CHARGED (D18-5). Not "is not charged by the
  -- screen" - cannot be, by the table.
  constraint laundry_dockets_hotel_is_never_charged
    check (belongs_to = 'guest' or charge_posting_id is null),

  constraint laundry_dockets_cancelled_carries_no_charge
    check (status <> 'cancelled' or charge_posting_id is null)
);

comment on table laundry_dockets is
  'One bag of laundry. Whose it is - a guest''s or the hotel''s own linen - is '
  'a required column (D18-5), not a tag: a hotel docket can never be charged, '
  'and a guest docket always names the stay it belongs to.';

create index if not exists laundry_dockets_hotel_date_idx
  on laundry_dockets (hotel_id, business_date desc);
create index if not exists laundry_dockets_stay_idx
  on laundry_dockets (reservation_id) where reservation_id is not null;

alter table laundry_dockets enable row level security;
alter table laundry_dockets force  row level security;
drop policy if exists hotel_isolation on laundry_dockets;
create policy hotel_isolation on laundry_dockets
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert, update on laundry_dockets to pms_app;
revoke delete on laundry_dockets from pms_app;

drop trigger if exists laundry_dockets_staff_scope on laundry_dockets;
create trigger laundry_dockets_staff_scope
  before insert or update on laundry_dockets
  for each row execute function app.assert_staff_has_hotel('created_by');


-- A guest docket's stay must be at the same property. `reservations` is keyed
-- by id alone, so this is a trigger rather than a composite foreign key - the
-- same reason the equipment register checks an item's place that way.
create or replace function app.laundry_docket_stay_is_here()
returns trigger language plpgsql as $fn$
declare v_hotel uuid;
begin
  if new.reservation_id is null then return new; end if;
  select hotel_id into v_hotel from reservations where id = new.reservation_id;
  if v_hotel is null or v_hotel <> new.hotel_id then
    raise exception
      'A laundry docket can only name a stay at its own property.'
      using errcode = 'check_violation';
  end if;
  return new;
end $fn$;

drop trigger if exists laundry_dockets_stay_is_here on laundry_dockets;
create trigger laundry_dockets_stay_is_here
  before insert or update on laundry_dockets
  for each row execute function app.laundry_docket_stay_is_here();


-- -----------------------------------------------------------------------------
-- What is in the bag
-- -----------------------------------------------------------------------------
-- THE DESCRIPTION AND THE PRICE ARE COPIED AT COLLECTION, not read through the
-- price list when the bill prints. Renaming "Shirt" to "Shirt (cotton)" next
-- month must not rewrite what a guest was handed a docket for, and re-pricing
-- must not change a bill that has already been posted.
-- -----------------------------------------------------------------------------
create table if not exists laundry_docket_lines (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null,
  docket_id     uuid not null,

  -- Where it came from, when it came from the list. NULL for a line somebody
  -- typed that the property does not keep a price for.
  price_item_id uuid,

  description   text not null,
  service       text not null,

  quantity          integer not null,
  -- What came back. The hotel's linen is counted out and in on exactly these
  -- two numbers; so is a guest's, which is why there is one mechanism.
  returned_quantity integer not null default 0,

  -- Copied from the price list at collection. NULL means the item was unpriced
  -- then, and the docket has no total until somebody prices it and re-reads it.
  unit_price    numeric(12,2),

  created_at    timestamptz not null default now(),

  foreign key (hotel_id, docket_id)
    references laundry_dockets (hotel_id, id) on delete cascade,

  /* WHERE IT CAME FROM, AND ONLY THAT. The description, the service and the
     price are already copied above, so a line loses nothing if the list entry
     it came from goes: it keeps saying what was collected and what was
     charged. `set null (price_item_id)` names the ONE column to clear, so the
     line does not lose its property along with its provenance.

     Written without this, and found by the API test's own teardown: removing a
     property cascades into `laundry_price_items`, and the lines still pointing
     at them refused the delete. The application cannot hit it - it has no
     DELETE on either table - but a property can never be removed, and the
     fixture that proved it is the one every future run depends on. */
  foreign key (hotel_id, price_item_id)
    references laundry_price_items (hotel_id, id)
    on delete set null (price_item_id),

  constraint laundry_docket_lines_description_present
    check (length(btrim(description)) > 0),
  constraint laundry_docket_lines_service_known
    check (service in ('wash', 'press', 'dry_clean')),
  constraint laundry_docket_lines_quantity_sane check (quantity > 0),
  constraint laundry_docket_lines_price_sane
    check (unit_price is null or unit_price >= 0),
  -- Nothing comes back that never went out, and nothing comes back twice.
  constraint laundry_docket_lines_returned_sane
    check (returned_quantity >= 0 and returned_quantity <= quantity)
);

comment on table laundry_docket_lines is
  'What is in one bag. Description and price are COPIED at collection, so '
  'renaming or re-pricing an item never rewrites a docket already handed over.';

comment on column laundry_docket_lines.returned_quantity is
  'What has come back. What is still out is quantity - returned_quantity - the '
  'hotel''s linen is counted on exactly this pair, and so is a guest''s bag.';

create index if not exists laundry_docket_lines_docket_idx
  on laundry_docket_lines (docket_id);

alter table laundry_docket_lines enable row level security;
alter table laundry_docket_lines force  row level security;
drop policy if exists hotel_isolation on laundry_docket_lines;
create policy hotel_isolation on laundry_docket_lines
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert, update on laundry_docket_lines to pms_app;
revoke delete on laundry_docket_lines from pms_app;


-- -----------------------------------------------------------------------------
-- The next docket number at a property
-- -----------------------------------------------------------------------------
-- MEMORY 280: `lpad` does not only pad, it CUTS - lpad('12345', 4, '0') is
-- '2345'. The thousandth docket at a property must not become the second.
-- -----------------------------------------------------------------------------
create or replace function app.next_laundry_docket_number(p_hotel uuid)
returns text
language sql
stable
as $$
  select 'LD-' || case when length(n::text) < 4 then lpad(n::text, 4, '0') else n::text end
    from (select coalesce(max(substring(upper(btrim(number)) from '^LD-([0-9]{1,9})$')::bigint), 0) + 1 as n
            from laundry_dockets
           where hotel_id = p_hotel
             and upper(btrim(number)) ~ '^LD-[0-9]{1,9}$') s
$$;

comment on function app.next_laundry_docket_number(uuid) is
  'The next free LD-NNNN at this property. Offered by the screen; a docket '
  'number is unique per property and the table refuses a repeat.';

grant execute on function app.next_laundry_docket_number(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- What a docket comes to - and NULL when any part of it is unpriced
-- -----------------------------------------------------------------------------
-- The banquet's rule, for the same reason: quoting for the lines that happen to
-- have prices is worse than saying nothing, because it looks like a total.
-- -----------------------------------------------------------------------------
create or replace function app.laundry_docket_total(p_docket uuid)
returns numeric
language sql
stable
as $$
  select case
           when count(*) = 0 then null
           when count(*) filter (where unit_price is null) > 0 then null
           else sum(unit_price * quantity)
         end
    from laundry_docket_lines
   where docket_id = p_docket
$$;

comment on function app.laundry_docket_total(uuid) is
  'What the bag comes to, or NULL when it is empty or ANY line is unpriced - a '
  'dash, never a part-total dressed as a total.';

grant execute on function app.laundry_docket_total(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- A charge cannot be attached to a bag that has no total
-- -----------------------------------------------------------------------------
-- The screen refuses this too, and the API refuses it independently. This is
-- the one that cannot be gone around: rule 6, all the way down.
-- -----------------------------------------------------------------------------
create or replace function app.laundry_charge_needs_a_total()
returns trigger language plpgsql as $fn$
begin
  if new.charge_posting_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.charge_posting_id is not distinct from old.charge_posting_id then
    return new;
  end if;

  if app.laundry_docket_total(new.id) is null then
    raise exception
      'This docket cannot be charged: something in it has no price yet.'
      using errcode = 'check_violation';
  end if;
  return new;
end $fn$;

drop trigger if exists laundry_dockets_charge_needs_a_total on laundry_dockets;
create trigger laundry_dockets_charge_needs_a_total
  before insert or update on laundry_dockets
  for each row execute function app.laundry_charge_needs_a_total();


-- -----------------------------------------------------------------------------
-- A charged docket's lines are settled
-- -----------------------------------------------------------------------------
-- Once the bag is on the bill, adding another shirt to it would change what the
-- guest owes without changing what was posted. The line goes on a new docket.
-- -----------------------------------------------------------------------------
create or replace function app.laundry_lines_are_settled()
returns trigger language plpgsql as $fn$
declare v_charged bigint; v_docket uuid;
begin
  v_docket := coalesce(new.docket_id, old.docket_id);
  select charge_posting_id into v_charged from laundry_dockets where id = v_docket;
  if v_charged is not null then
    raise exception
      'This docket has already been charged to the room. Open a new one.'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $fn$;

drop trigger if exists laundry_docket_lines_are_settled on laundry_docket_lines;
create trigger laundry_docket_lines_are_settled
  before insert or update of quantity, unit_price, description, service, price_item_id
  on laundry_docket_lines
  for each row execute function app.laundry_lines_are_settled();
