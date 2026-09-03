-- =============================================================================
-- 053 — setting a price on the grid
-- =============================================================================
-- A revenue manager selects Friday to Sunday on the rate grid and types 4200.
-- That looks like one action and is not: `rates` forbids overlapping ranges
-- for the same room type and meal plan (033's exclusion constraint), and those
-- three days are almost always already covered — by a season, or by the
-- open-ended rack rate that covers everything.
--
-- So writing a price means REARRANGING what is already there:
--
--   existing   ├────────────── Rack, open ended ──────────────▶
--   new        ·      ├── Fri–Sun ──┤
--   result     ├─Rack─┤├── Fri–Sun ─┤├───── Rack again ───────▶
--
-- The rack rate has to be split in two, with the new row between the halves.
-- Get that wrong and the property either loses its rack rate after Sunday, or
-- the insert is refused by the constraint and the manager is told "that
-- overlaps" about a screen where everything overlaps by design.
--
-- IT LIVES HERE, NOT IN THE API, for the reason 040 moved the discount
-- apportionment: two callers doing the same arithmetic is how the folio and
-- the till drifted apart. The grid writes prices, and so will the channel
-- manager when STAAH lands.
--
-- HALF-OPEN THROUGHOUT. [p_from, p_to) — a price set from the 1st to the 15th
-- covers the 1st through the 14th, like every other range in this schema.
-- p_to NULL means open ended, which is what a rack rate is.
--
-- NO DEFAULT PRICE IS EVER WRITTEN. This function only ever stores a number a
-- person typed. Clearing a cell removes rows; it does not write a zero.
-- =============================================================================

create or replace function app.set_rate(
  p_hotel     uuid,
  p_room_type uuid,
  p_meal_plan text,
  p_from      date,
  p_to        date,          -- exclusive; NULL is open ended
  p_price     numeric,       -- NULL clears the range instead of pricing it
  p_label     text,
  p_by        uuid
)
returns int                  -- rows in `rates` touching this range afterwards
language plpgsql
as $$
declare
  v_end date := coalesce(p_to, 'infinity'::date);
  r     record;
  n     int;
begin
  if p_to is not null and p_to <= p_from then
    raise exception 'a rate range ends after it starts'
      using hint = 'The last day is not included, so a price through the 31st '
                   'ends on the 1st of the next month.';
  end if;

  if p_price is not null and p_price < 0 then
    raise exception 'a price is zero or more';
  end if;

  /* ---- make room -------------------------------------------------------
     Every existing row that overlaps [p_from, v_end). Shrink before growing:
     the exclusion constraint is checked per statement, so a row must vacate
     the range before anything moves into it. */
  for r in
    select id, valid_from, valid_to, price, meal_plan, label
      from rates
     where hotel_id = p_hotel
       and room_type_id = p_room_type
       and meal_plan = p_meal_plan
       and valid_from < v_end
       and coalesce(valid_to, 'infinity'::date) > p_from
     order by valid_from
  loop
    if r.valid_from >= p_from
       and coalesce(r.valid_to, 'infinity'::date) <= v_end then
      -- swallowed whole
      delete from rates where id = r.id;

    elsif r.valid_from < p_from
          and coalesce(r.valid_to, 'infinity'::date) > v_end then
      -- straddles both ends: keep the head, and re-create the tail after the
      -- new range. This is the rack-rate case, and the one that silently
      -- loses a property its pricing if the tail is forgotten.
      update rates set valid_to = p_from where id = r.id;
      insert into rates (hotel_id, room_type_id, meal_plan, price,
                         valid_from, valid_to, label, created_by)
      values (p_hotel, p_room_type, r.meal_plan, r.price,
              v_end, r.valid_to, r.label, p_by);

    elsif r.valid_from < p_from then
      -- overlaps the start: trim its tail back
      update rates set valid_to = p_from where id = r.id;

    else
      -- overlaps the end: push its head forward
      update rates set valid_from = v_end where id = r.id;
    end if;
  end loop;

  /* ---- write ----------------------------------------------------------
     A NULL price is a CLEARED cell, not a free room. The rows above are gone
     and nothing replaces them, so app.rate_for falls back to the room type's
     rack rate, and to NULL when there is not one — which the grid renders as
     a dash. Writing a zero here would turn "nobody has priced this" into
     "this is free", and seven assertions exist to stop exactly that. */
  if p_price is not null then
    insert into rates (hotel_id, room_type_id, meal_plan, price,
                       valid_from, valid_to, label, created_by)
    values (p_hotel, p_room_type, p_meal_plan, p_price,
            p_from, p_to, nullif(trim(coalesce(p_label, '')), ''), p_by);
  end if;

  select count(*)::int into n
    from rates
   where hotel_id = p_hotel
     and room_type_id = p_room_type
     and meal_plan = p_meal_plan;
  return n;
end $$;

comment on function app.set_rate is
  'Sets a price over a half-open date range, splitting and trimming whatever '
  'already covers it so the exclusion constraint is never violated. A NULL '
  'price clears the range rather than writing a zero — an unpriced room is not '
  'a free room.';

revoke all on function app.set_rate(uuid, uuid, text, date, date, numeric, text, uuid)
  from public;
grant execute on function app.set_rate(uuid, uuid, text, date, date, numeric, text, uuid)
  to pms_app;
