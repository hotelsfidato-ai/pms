-- =============================================================================
-- 049 — the kitchen docket has its own number
-- =============================================================================
--   06/02/24 15:45
--   KOT - 5
--   Dine In
--   Table No: AC4
--   ------------------------------------
--   Item                            Qty.
--   Kebab Platter (Medium)            1
--   Bhaaji Pau (Butter)               1
--     Sides: Onions - 1,
--     Sides: Coriander Chutney - 1
--     [Note] Less Spicy
--
-- THE NUMBER BELONGS TO A BATCH OF LINES, NOT TO THE ORDER. One table sends
-- starters, then mains, then a dessert somebody changed their mind about —
-- three dockets, three numbers, one bill. Putting the number on `pos_orders`
-- would give all three the same one, and a kitchen holding three pieces of
-- paper that all say KOT-5 cannot tell the chef which is which.
--
-- It is also NOT the bill number. A guest queries a bill; a chef queries a
-- docket; the two are looked up by different people in different rooms, and
-- sharing a sequence means the numbers on the pass have gaps wherever a
-- takeaway was rung.
--
-- The QR is deliberately absent. The kitchen pass already marks food ready and
-- does it better than a phone camera over a hotplate.
-- =============================================================================

alter table pos_order_lines
  add column if not exists kot_no int;

comment on column pos_order_lines.kot_no is
  'The docket this line went out on. Several per order: starters, then mains, '
  'then whatever was added later. Null until the line is sent.';

create index if not exists pos_order_lines_kot_no_idx
  on pos_order_lines (order_id, kot_no) where kot_no is not null;

-- -----------------------------------------------------------------------------
-- Backfill, before the constraint can hold
-- -----------------------------------------------------------------------------
-- Lines sent to the kitchen before this migration have no docket number, and
-- the constraint below would refuse the whole table. They are numbered by the
-- batch they went out in — order plus the moment they were sent, which is
-- exactly what a docket was — so a kitchen looking back at yesterday sees the
-- same grouping it worked from.
-- -----------------------------------------------------------------------------
with batches as (
  select l.id,
         dense_rank() over (
           partition by o.outlet_id, o.business_date
           order by l.kot_sent_at, l.order_id
         ) as no
    from pos_order_lines l
    join pos_orders o on o.id = l.order_id
   where l.kot_status <> 'pending' and l.kot_no is null
)
update pos_order_lines l
   set kot_no = b.no
  from batches b
 where l.id = b.id;

do $$
begin
  -- A sent line has a docket number and an unsent one does not. Either alone
  -- is a line the kitchen has and cannot be handed a ticket for, or a ticket
  -- number for something never sent.
  if not exists (select 1 from pg_constraint
                  where conname = 'pos_order_lines_kot_no_with_status') then
    alter table pos_order_lines add constraint pos_order_lines_kot_no_with_status
      check ((kot_status = 'pending') = (kot_no is null));
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- The docket sequence
-- -----------------------------------------------------------------------------
-- Per OUTLET per operating day, and derived from what exists rather than kept
-- in a counter. A counter is a second source of truth that drifts the first
-- time a transaction rolls back, and the kitchen would find the gap before
-- anybody else did.
--
-- The hotel's business date, not the clock: a docket printed at 00:40 belongs
-- to the evening still being served.
-- -----------------------------------------------------------------------------
create or replace function app.pos_next_kot_no(p_outlet uuid, p_date date)
returns int language sql stable as $$
  select coalesce(max(l.kot_no), 0) + 1
    from pos_order_lines l
    join pos_orders o on o.id = l.order_id
   where o.outlet_id = p_outlet and o.business_date = p_date
$$;

comment on function app.pos_next_kot_no(uuid, date) is
  'The next docket number for this outlet today. Derived from the lines, not '
  'from a counter — a counter drifts the first time a transaction rolls back, '
  'and the kitchen finds the gap before anybody else.';


-- -----------------------------------------------------------------------------
-- One docket, as the kitchen reads it
-- -----------------------------------------------------------------------------
-- Dishes with their add-ons nested underneath, which is the whole point of the
-- printed form: a chef reads "Bhaaji Pau (Butter)" and then, indented, what
-- goes on it. Flat, the sides read as separate dishes and get plated alone.
--
-- Struck lines are EXCLUDED. A dish cancelled before the docket printed was
-- never cooked, and one cancelled after has its own loud line on the pass —
-- reprinting it here would put it back on the chef's rail.
-- -----------------------------------------------------------------------------
create or replace function app.pos_kot(p_order uuid, p_kot_no int)
returns table (
  line_id     bigint,
  parent_id   bigint,
  name        text,
  qty         numeric,
  note        text,
  is_addon    boolean
)
language sql stable as $$
  select
    l.id, l.parent_line_id, l.name, l.qty, l.note, l.addon_id is not null
  from pos_order_lines l
 where l.order_id = p_order
   and l.kot_no = p_kot_no
   and not l.voided
 order by
   /* The dish first, then its own add-ons directly under it. */
   coalesce(l.parent_line_id, l.id), l.parent_line_id nulls first, l.id;
$$;

comment on function app.pos_kot(uuid, int) is
  'One docket: dishes with their add-ons nested under them. Flat, a chef '
  'plates the sides as separate dishes.';

grant execute on function app.pos_next_kot_no(uuid, date) to pms_app;
grant execute on function app.pos_kot(uuid, int)          to pms_app;
