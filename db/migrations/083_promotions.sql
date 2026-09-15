-- =============================================================================
-- 083 · A free hand up to 10%, and a named promotion beyond it
-- =============================================================================
-- ⚠ THIS IS NOT THE APPROVAL QUEUE THAT WAS PLANNED, AND THE OWNER IS RIGHT.
--
-- The plan was "discounts above a threshold need an approval". Asked what the
-- threshold should be, the owner answered with a different design:
--
--     "for this it's just max 10% off. Anything else needs to be a predefined
--      discount category like a promotion — the staff just add the code and it
--      cuts automatically. Like if there are owner's friends, there is a
--      predefined rule for this."
--
-- That is better, and for a reason worth writing down: an approval queue asks
-- somebody to decide the same question again every night. "The owner's guests
-- eat at 50%" is not a decision, it is a POLICY, and a policy typed in fresh
-- by a biller at 11pm is a policy that drifts. Decide it once, name it, and
-- let the till apply it.
--
-- It also answers a question the approval design could not: at the end of the
-- month, what did each concession COST. `pos_orders.promotion_id` makes that a
-- group-by. A free-hand discount with the words "owner's friends" typed into
-- the reason box makes it a search through text nobody spelled the same way
-- twice.
--
-- ⚠ THE APPROVAL ENGINE REMAINS UNREACHABLE, and this migration does not
-- change that. 076 built the tables, `app.request_approval` and the routes;
-- NOTHING in the running system calls it, and `discount` was never one of its
-- kinds. It is recorded as still-unreachable rather than quietly counted as
-- done.
--
-- ⚠ NO PROMOTION IS SEEDED. Not one. Every rate in this table is a decision
-- about money that somebody at the hotel has to make, and a shipped "STAFF —
-- 50%" would be defect 63 wearing an apron.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- How far a biller may go on their own
-- -----------------------------------------------------------------------------
-- ⚠ ONE NUMBER, IN ONE PLACE. The cap is checked by the API, shown by the
-- discount dialog, and will be checked by anything else that ever discounts a
-- bill. Written three times it would be wrong in one of them, which is the
-- most expensive shape in this codebase — five copies of the booking-source
-- label had already disagreed by the time anybody looked.
--
-- A FUNCTION rather than a column, because today it is one number for the
-- group. When a property wants its own, this becomes a lookup and every caller
-- keeps working — which is exactly what a column here would not give.
-- -----------------------------------------------------------------------------
create or replace function app.pos_freehand_discount_cap()
returns numeric language sql immutable as $$
  select 10::numeric;
$$;

comment on function app.pos_freehand_discount_cap() is
  'The largest share of a bill a biller may take off without a named '
  'promotion, as a percentage. Set by the owner on 9 September 2026. The ONE '
  'definition — the API refuses against it and the till shows it.';

grant execute on function app.pos_freehand_discount_cap() to pms_app;


-- -----------------------------------------------------------------------------
-- The promotions themselves
-- -----------------------------------------------------------------------------
create table if not exists pos_promotions (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id) on delete cascade,

  -- What a biller types. Short, because it is typed at a terminal with a
  -- queue behind it.
  code       text not null,
  -- What prints on the bill and appears in the report. "Owner's guests", not
  -- "OWNG" — the guest reads one and the owner reads the other.
  name       text not null,

  kind       text not null,
  value      numeric(12,2) not null,

  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table pos_promotions drop constraint if exists pos_promotions_kind_valid;
alter table pos_promotions add constraint pos_promotions_kind_valid
  check (kind in ('percent', 'fixed'));

-- A promotion worth nothing is a promotion that does nothing, and zero here
-- would print "Owner's guests −₹0.00" on a bill. Above 100% is a refund.
alter table pos_promotions drop constraint if exists pos_promotions_value_sane;
alter table pos_promotions add constraint pos_promotions_value_sane
  check (value > 0 and (kind <> 'percent' or value <= 100));

create unique index if not exists pos_promotions_code_unique
  on pos_promotions (hotel_id, lower(trim(code)));

comment on table pos_promotions is
  'Named discounts a biller applies by code. The alternative to typing a '
  'percentage into a free-hand box every night and hoping it is the same one '
  'as last night.';
comment on column pos_promotions.code is
  'What is typed at the till. Unique within the property, case-insensitively.';
comment on column pos_promotions.name is
  'What prints on the bill and groups the report. The guest reads this.';

drop trigger if exists pos_promotions_touch on pos_promotions;
create trigger pos_promotions_touch before update on pos_promotions
  for each row execute function app.touch_updated_at();


-- -----------------------------------------------------------------------------
-- Which promotion this bill used
-- -----------------------------------------------------------------------------
-- ⚠ THE POINT OF THE WHOLE FILE. Without this column a promotion is just a
-- faster way to fill in the same free-text reason, and "what did the owner's
-- guests cost us in September" stays a question nobody can answer.
--
-- NULL on a free-hand discount, and that is a real distinction rather than a
-- missing value: one was a policy, the other was somebody's judgement at the
-- table. A report that cannot tell them apart is reporting on neither.
-- -----------------------------------------------------------------------------
alter table pos_orders
  add column if not exists promotion_id uuid references pos_promotions(id);

comment on column pos_orders.promotion_id is
  'The named promotion this discount came from. NULL when a biller applied a '
  'free-hand discount within the cap — a different kind of act, deliberately '
  'told apart.';

create index if not exists pos_orders_promotion_idx
  on pos_orders (hotel_id, promotion_id)
  where promotion_id is not null;


-- -----------------------------------------------------------------------------
-- Row level security, the same shape as every other POS table
-- -----------------------------------------------------------------------------
alter table pos_promotions enable row level security;
alter table pos_promotions force row level security;

-- `app.auth_hotel_ids()` and the shared policy name. Spelling this predicate
-- by hand cost nine API tests in 080, and the lesson is written down there.
drop policy if exists hotel_isolation on pos_promotions;
create policy hotel_isolation on pos_promotions
  using (hotel_id in (select app.auth_hotel_ids()))
  with check (hotel_id in (select app.auth_hotel_ids()));

grant select, insert, update on pos_promotions to pms_app;
-- No delete: a bill that used a promotion points at it, and a discount whose
-- reason vanished is one nobody can explain. It is switched off instead.
