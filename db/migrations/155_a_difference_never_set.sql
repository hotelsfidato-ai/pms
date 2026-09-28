-- =============================================================================
-- 155 — a difference NEVER set is a dash, not a zero (RT-3; the owner, 28 Sep)
-- =============================================================================
-- The QA of 28 September set a base of ₹2,000 and nothing else, and Pricing
-- showed Superior, and Deluxe on every meal plan, at ₹2,000 "from the base":
-- 090's app.offset_for answers ZERO wherever no difference covers a date, so a
-- room type or meal plan nobody had ever priced sold at the base.
--
-- The owner's answer (round D, 28 September), which keeps their own 16
-- September rule where it was meant:
--
--   never set   a room type or meal plan with NO difference on file at all is
--               not priced - a dash; it cannot be sold at a guessed figure
--   set         once a difference is on file for some dates, a date outside
--               them uses the base ("where nothing is set for a date, the base
--               applies", 16 September) - 0 there, as before
--   typed 0     "the same as the base", a real answer
--
-- As before, the basis room type needs no room difference and the basis meal
-- plan no meal difference (the base has no difference from itself); one
-- typed for the basis meal plan is still applied, as 090 applied it.
--
-- NO RACK FALLBACK where a difference is missing: with a base in use, a type's
-- old rack rate is not its price for a plan it was never priced on (a rack
-- covers two people and no meals), and falling back would be the guess the
-- owner refused. Where there is no base at all the rack still answers, as 090.
--
-- Same name, arguments and return type: CREATE OR REPLACE (MEMORY 317).
-- =============================================================================

/* The difference on a date - or NULL when this room type or meal plan has
   never had one at this property. 090's app.offset_for is kept as it was. */
create or replace function app.offset_if_set(
  p_hotel uuid, p_kind text, p_room_type uuid, p_meal_plan text, p_date date
)
returns numeric
language sql
stable
as $$
  select case
    when exists (
      select 1 from rate_offsets o
       where o.hotel_id = p_hotel and o.kind = p_kind
         and (p_kind <> 'room_type' or o.room_type_id = p_room_type)
         and (p_kind <> 'meal_plan' or o.meal_plan    = p_meal_plan))
    then app.offset_for(p_hotel, p_kind, p_room_type, p_meal_plan, p_date)
  end;
$$;

comment on function app.offset_if_set(uuid, text, uuid, text, date) is
  'The difference that applies on a date, 0 where the room type or meal plan '
  'has differences on file but none covers the date (16 Sep), and NULL where '
  'it has never had one (RT-3, 28 Sep): not priced.';

grant execute on function app.offset_if_set(uuid, text, uuid, text, date) to pms_app;


create or replace function app.price_for(
  p_room_type uuid,
  p_meal_plan text,
  p_date      date
)
returns table (
  price  numeric,
  covers int,
  source text
)
language plpgsql
stable
as $$
declare
  v_hotel      uuid;
  v_base_occ   int;
  v_basis      record;
  v_base_price numeric;
  v_room_diff  numeric;
  v_meal_diff  numeric;
begin
  select rt.hotel_id, rt.base_occupancy into v_hotel, v_base_occ
    from room_types rt where rt.id = p_room_type;

  /* 1 · typed - wins outright, as 090. */
  select r.price, coalesce(r.covers_persons, v_base_occ, 2), 'typed'
    into price, covers, source
    from rates r
   where r.room_type_id = p_room_type
     and r.meal_plan    = p_meal_plan
     and p_date >= r.valid_from
     and (r.valid_to is null or p_date < r.valid_to)
   limit 1;
  if price is not null then
    return next;
    return;
  end if;

  /* 2 · derived */
  select b.room_type_id, b.meal_plan into v_basis
    from pricing_basis b where b.hotel_id = v_hotel;

  if v_basis.room_type_id is not null then
    select r.price into v_base_price
      from rates r
     where r.room_type_id = v_basis.room_type_id
       and r.meal_plan    = v_basis.meal_plan
       and p_date >= r.valid_from
       and (r.valid_to is null or p_date < r.valid_to)
     limit 1;

    if v_base_price is not null then
      v_room_diff := case when p_room_type = v_basis.room_type_id then 0
                          else app.offset_if_set(v_hotel, 'room_type', p_room_type, null, p_date) end;
      v_meal_diff := case when p_meal_plan = v_basis.meal_plan
                          then app.offset_for(v_hotel, 'meal_plan', null, p_meal_plan, p_date)
                          else app.offset_if_set(v_hotel, 'meal_plan', null, p_meal_plan, p_date) end;

      /* RT-3: a difference never set - not priced, and no rack in its place. */
      if v_room_diff is null or v_meal_diff is null then
        price := null; covers := coalesce(v_base_occ, 2); source := null;
        return next;
        return;
      end if;

      price  := v_base_price + v_room_diff + v_meal_diff;
      covers := 1;
      source := 'derived';
      return next;
      return;
    end if;
  end if;

  /* 3 · rack - only where no base is in use for the date, as 090. */
  select rt.base_rate, coalesce(v_base_occ, 2), 'rack'
    into price, covers, source
    from room_types rt where rt.id = p_room_type;
  if price is not null then
    return next;
    return;
  end if;

  /* 4 · nobody has priced it. */
  price := null; covers := coalesce(v_base_occ, 2); source := null;
  return next;
end $$;

comment on function app.price_for(uuid, text, date) is
  'What a room type costs on a plan on a date, AND how many people that price '
  'covers: a typed rate row, else a price derived from the property''s base '
  '(NULL where a needed difference was never set, RT-3), else the type''s rack '
  'rate when no base is in use, else NULL. Never zero by default.';

grant execute on function app.price_for(uuid, text, date) to pms_app;
