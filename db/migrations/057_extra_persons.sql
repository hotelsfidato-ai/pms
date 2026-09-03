-- =============================================================================
-- 057 — the third person in the room
-- =============================================================================
-- A room type sleeps two and takes three. Nothing has ever priced the third,
-- so a family booking a Deluxe was charged the same as a couple — and the
-- backlog put this after the rate grid for a good reason: an extra bed costs
-- more in Diwali week than in June, so the price belongs beside the season's,
-- not on a settings page.
--
-- WHO IS EXTRA. Persons beyond `base_occupancy`, adults counted first:
--
--   base 2 · 3 adults, 0 children   → 1 extra adult
--   base 2 · 2 adults, 1 child      → 1 extra child
--   base 2 · 1 adult,  1 child      → nobody is extra
--   base 2 · 1 adult,  2 children   → 1 extra child
--
-- A child takes a base slot when one is free. Charging a couple's toddler as
-- an extra person while an identical room with two adults pays nothing is the
-- kind of arithmetic a guest notices at the desk.
--
-- WHAT COUNTS AS A CHILD IS THE HOTEL'S POLICY AND IS NOT MODELLED HERE.
-- Under five free, under twelve half — every property answers it differently
-- and changes the answer. A child is whoever the clerk counted as one.
--
-- NO EXTRA RATE SHIPS, exactly as no room rate ships. An unpriced extra adult
-- makes the TOTAL null rather than adding zero: a booking that quietly treats
-- the third person free is worse than one that says it does not know, because
-- the first is only discovered at check-out.
-- =============================================================================

alter table rates add column if not exists extra_adult numeric(12,2);
alter table rates add column if not exists extra_child numeric(12,2);

alter table rates drop constraint if exists rates_extra_sane;
alter table rates add constraint rates_extra_sane check (
  (extra_adult is null or extra_adult >= 0)
  and (extra_child is null or extra_child >= 0)
);

comment on column rates.extra_adult is
  'Per extra adult per night for this season. NULL means nobody has priced it '
  '— which makes the tariff unknown, never free.';

-- The fallback, beside base_rate and for the same reason: a property that has
-- not built seasons yet still has to be able to quote.
alter table room_types add column if not exists extra_adult_rate numeric(12,2);
alter table room_types add column if not exists extra_child_rate numeric(12,2);

alter table room_types drop constraint if exists room_types_extra_sane;
alter table room_types add constraint room_types_extra_sane check (
  (extra_adult_rate is null or extra_adult_rate >= 0)
  and (extra_child_rate is null or extra_child_rate >= 0)
);


-- -----------------------------------------------------------------------------
-- What an extra person costs
-- -----------------------------------------------------------------------------
-- Same shape and same fallback chain as app.rate_for: the covering season, then
-- the room type's own, then NULL. Never zero.
-- -----------------------------------------------------------------------------
create or replace function app.extra_person_rates(
  p_room_type uuid, p_meal_plan text, p_date date
)
returns table (adult numeric, child numeric)
language sql stable as $$
  select
    coalesce(
      (select r.extra_adult from rates r
        where r.room_type_id = p_room_type and r.meal_plan = p_meal_plan
          and p_date >= r.valid_from
          and (r.valid_to is null or p_date < r.valid_to)
        limit 1),
      (select rt.extra_adult_rate from room_types rt where rt.id = p_room_type)),
    coalesce(
      (select r.extra_child from rates r
        where r.room_type_id = p_room_type and r.meal_plan = p_meal_plan
          and p_date >= r.valid_from
          and (r.valid_to is null or p_date < r.valid_to)
        limit 1),
      (select rt.extra_child_rate from room_types rt where rt.id = p_room_type));
$$;


-- -----------------------------------------------------------------------------
-- One night, fully priced
-- -----------------------------------------------------------------------------
-- `unpriced` is the point of this function. A booking screen must be able to
-- say "the third adult has no price" rather than quietly quoting for two, and
-- the total must be NULL rather than short.
-- -----------------------------------------------------------------------------
create or replace function app.tariff_for(
  p_room_type uuid,
  p_meal_plan text,
  p_date      date,
  p_adults    int,
  p_children  int
)
returns table (
  base            numeric,
  extra_adults    int,
  adult_rate      numeric,
  extra_children  int,
  child_rate      numeric,
  total           numeric,   -- NULL when anything needed has no price
  unpriced        text       -- what is missing, in words
)
language plpgsql stable as $$
declare
  v_base_occ int;
  v_missing  text[] := '{}';
begin
  select rt.base_occupancy into v_base_occ
    from room_types rt where rt.id = p_room_type;

  base := app.rate_for(p_room_type, p_meal_plan, p_date);

  /* Adults first, then children into whatever base slots are left. */
  extra_adults   := greatest(p_adults - coalesce(v_base_occ, 2), 0);
  extra_children := greatest(
    p_children - greatest(coalesce(v_base_occ, 2) - p_adults, 0), 0);

  select a.adult, a.child into adult_rate, child_rate
    from app.extra_person_rates(p_room_type, p_meal_plan, p_date) a;

  /* array_append, not `||`. Against an untyped literal the operator is
     ambiguous and Postgres tries to read 'the room' AS an array. */
  if base is null then
    v_missing := array_append(v_missing, 'the room');
  end if;
  if extra_adults > 0 and adult_rate is null then
    v_missing := array_append(v_missing, case when extra_adults = 1
      then 'the extra adult' else extra_adults || ' extra adults' end);
  end if;
  if extra_children > 0 and child_rate is null then
    v_missing := array_append(v_missing, case when extra_children = 1
      then 'the extra child' else extra_children || ' extra children' end);
  end if;

  if array_length(v_missing, 1) is null then
    total := base
           + extra_adults   * coalesce(adult_rate, 0)
           + extra_children * coalesce(child_rate, 0);
    unpriced := null;
  else
    /* NOT a partial total. A number that silently omits the third person is
       the one nobody checks, and it is discovered at check-out. */
    total := null;
    unpriced := array_to_string(v_missing, ' and ');
  end if;

  return next;
end $$;

comment on function app.tariff_for(uuid, text, date, int, int) is
  'One night for a given party: the room, the extra persons beyond base '
  'occupancy, and the total — which is NULL, with `unpriced` naming what is '
  'missing, whenever any part of it has no price. An unpriced extra person is '
  'not a free one.';

grant execute on function app.extra_person_rates(uuid, text, date) to pms_app;
grant execute on function app.tariff_for(uuid, text, date, int, int) to pms_app;


-- -----------------------------------------------------------------------------
-- Setting them from the grid
-- -----------------------------------------------------------------------------
-- app.set_rate gains the two prices. Dropped and recreated rather than given
-- defaulted parameters: a defaulted overload leaves the old signature in place
-- and every existing call becomes ambiguous.
-- -----------------------------------------------------------------------------
drop function if exists app.set_rate(uuid, uuid, text, date, date, numeric, text, uuid);

create function app.set_rate(
  p_hotel       uuid,
  p_room_type   uuid,
  p_meal_plan   text,
  p_from        date,
  p_to          date,
  p_price       numeric,
  p_label       text,
  p_by          uuid,
  p_extra_adult numeric default null,
  p_extra_child numeric default null
)
returns int
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
  if (p_extra_adult is not null and p_extra_adult < 0)
     or (p_extra_child is not null and p_extra_child < 0) then
    raise exception 'a price is zero or more';
  end if;

  for r in
    select id, valid_from, valid_to, price, meal_plan, label,
           extra_adult, extra_child
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
      delete from rates where id = r.id;

    elsif r.valid_from < p_from
          and coalesce(r.valid_to, 'infinity'::date) > v_end then
      /* The rack-rate split. Its tail keeps the ORIGINAL extra prices — they
         belong to that season, not to the one being inserted between. */
      update rates set valid_to = p_from where id = r.id;
      insert into rates (hotel_id, room_type_id, meal_plan, price,
                         valid_from, valid_to, label, created_by,
                         extra_adult, extra_child)
      values (p_hotel, p_room_type, r.meal_plan, r.price,
              v_end, r.valid_to, r.label, p_by, r.extra_adult, r.extra_child);

    elsif r.valid_from < p_from then
      update rates set valid_to = p_from where id = r.id;

    else
      update rates set valid_from = v_end where id = r.id;
    end if;
  end loop;

  if p_price is not null then
    insert into rates (hotel_id, room_type_id, meal_plan, price,
                       valid_from, valid_to, label, created_by,
                       extra_adult, extra_child)
    values (p_hotel, p_room_type, p_meal_plan, p_price,
            p_from, p_to, nullif(trim(coalesce(p_label, '')), ''), p_by,
            p_extra_adult, p_extra_child);
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
  'already covers it. A NULL price clears the range rather than writing a zero. '
  'The extra-person prices travel with the season, because an extra bed costs '
  'more in Diwali week than in June.';

revoke all on function app.set_rate(uuid, uuid, text, date, date, numeric, text, uuid, numeric, numeric)
  from public;
grant execute on function app.set_rate(uuid, uuid, text, date, date, numeric, text, uuid, numeric, numeric)
  to pms_app;
