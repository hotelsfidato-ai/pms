-- =============================================================================
-- 052 — the rate grid, from one definition
-- =============================================================================
-- The revenue manager's daily screen needs a price per room type, per meal
-- plan, per date. The API was deriving that itself, and its copy of the rule
-- disagreed with the other three in two ways that both hid real prices:
--
--   1 · AN OPEN-ENDED RATE WAS INVISIBLE. `valid_to` is NULL for a rack rate —
--       the most common rate a property has — and the filter read
--       `r.valid_to >= from`. Against NULL that is NULL, not true, so the row
--       was dropped. A property whose only rate is its rack rate showed an
--       ENTIRELY EMPTY GRID, which reads exactly like "nothing has been priced
--       yet" and is the one message this screen must never get wrong.
--
--   2 · A SEASON COVERED ONE DAY TOO MANY. Ranges here are half-open — the
--       table says so, the exclusion constraint builds `[)`, and app.rate_for
--       tests `p_date < r.valid_to`. The grid used `least(valid_to, to)`,
--       which INCLUDES valid_to. Two contiguous seasons therefore both claimed
--       the boundary date, and the grid showed the outgoing season's price on
--       the first day of the incoming one.
--
-- The rule was already written correctly in three places: the exclusion
-- constraint (033), `is_current` on the rate-plan list, and `app.rate_for`.
-- The grid was the fourth copy and the only wrong one — which is the argument
-- for not having four. It now calls `app.rate_for`, so a change to what a
-- price means on a date happens in exactly one function.
--
-- EVERY CELL IS RETURNED, INCLUDING THE UNPRICED ONES. `app.rate_for` answers
-- NULL when nothing covers the date and the type has no rack rate, and NULL is
-- what the screen must render as a dash. A grid built only from rows that
-- exist in `rates` has nowhere to type the FIRST price, which is precisely the
-- state an unpriced property is in — and no price ever ships, so that is the
-- state every new property starts in.
-- =============================================================================

/* Dropped first because the shape changed and `create or replace` cannot
   change a return type — the error 028 hit. It also makes this file
   re-runnable, which the glob-loop deployment requires of everything. */
drop function if exists app.rate_grid(uuid, date, date);

create function app.rate_grid(
  p_hotel uuid, p_from date, p_to date
)
returns table (
  room_type_id uuid,
  room_type    text,
  meal_plan    text,
  meal_plan_name text,
  for_date     date,
  price        numeric,
  season       text,
  -- 'rate' · a row in `rates` covers this date
  -- 'rack' · nothing does, so this is the room type's own rack rate
  -- NULL   · nothing covers it and the type has no rack rate either
  source       text
)
language sql stable as $$
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  ),
  plans as (
    /* What the property SELLS, not what has been priced. Room type × meal
       plan is exactly the shape `rates` is keyed on. */
    select rt.id, rt.name, mp.code, mp.name as plan_name
      from room_types rt
      cross join meal_plans mp
     where rt.hotel_id = p_hotel
  )
  select
    p.id, p.name, p.code, p.plan_name, d.d,
    /* One definition. Falls back to the room type's rack rate, and to NULL
       when there is not one — never to zero, because an unpriced room is not
       a free room. */
    app.rate_for(p.id, p.code, d.d),
    /* The season's own name, for the cell to show where the price came from.
       Same half-open test as app.rate_for, and it has to be: a label from a
       season that does not cover the date would explain the wrong number. */
    (select r.label
       from rates r
      where r.room_type_id = p.id
        and r.meal_plan    = p.code
        and d.d >= r.valid_from
        and (r.valid_to is null or d.d < r.valid_to)
      limit 1),
    /* WHERE THE NUMBER CAME FROM, which on this screen is half the
       information. ₹4,099 because somebody priced this Saturday and ₹4,099
       because nobody has touched it and the room type carries that rack rate
       are different facts, and a revenue manager deciding what to change
       needs to tell them apart. Rendering both the same way is how a whole
       season gets left at the default because it looked set. */
    case
      when exists (
        select 1 from rates r
         where r.room_type_id = p.id
           and r.meal_plan    = p.code
           and d.d >= r.valid_from
           and (r.valid_to is null or d.d < r.valid_to)
      ) then 'rate'
      when (select rt.base_rate from room_types rt where rt.id = p.id)
             is not null then 'rack'
      else null
    end
  from plans p
  cross join days d
  order by p.name, p.code, d.d;
$$;

comment on function app.rate_grid(uuid, date, date) is
  'Price per room type per meal plan per date, for the rate grid. Returns a '
  'row for every cell including unpriced ones, where the price is NULL and the '
  'screen must render a dash — never a zero. `source` says whether the number '
  'was priced for that date or inherited from the room type, which is the '
  'difference between a rate somebody chose and one nobody has looked at. '
  'Delegates to app.rate_for so the meaning of "the price on this date" lives '
  'in one place.';

grant execute on function app.rate_grid(uuid, date, date) to pms_app;
