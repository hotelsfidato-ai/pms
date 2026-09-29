-- =============================================================================
-- 181 — a room's price is a BASE plus ADD-ONS (D27-188, D27-194; 30 September)
-- =============================================================================
-- The owner, 30 September: rates are a base and add-ons. Either each room type
-- has its own base, or the room types are derived from one base room type
-- (+₹ or +%). The add-ons are set ONCE per hotel and ride on top of any base:
-- breakfast (CP), MAP, AP, all-inclusive (AI), double occupancy, extra adult,
-- extra child. The daily calendar changes only the base; the add-ons follow.
--
-- THE BASE IS WHAT 090 ALREADY MADE IT: a `rates` row on the base meal plan
-- (EP) that covers ONE guest (covers_persons = 1). Nothing new stores it.
--
--   mode a   no base room type: every type carries its own base rows
--   mode b   pricing_basis names the base type; another type's base is the
--            base type's plus its difference (+₹ or +%, whole rupees), and a
--            difference never set is not priced (155's rule, kept)
--
-- A NIGHT ON A BASE (D27-194): 1 guest = the base; 2 guests (adult or child)
-- = base + double occupancy; from the 3rd, extra adult / extra child, adults
-- first; every guest, children too, pays the meal plan's add-on. An add-on
-- nobody set is a dash, and anything needing it is not sold. 0 is a typed
-- "Free" (D27-120), never a default.
--
-- NOTHING ALREADY TYPED MOVES (D27-194). A price written before this - a
-- season, a Rate calendar cell, a rack rate, with its own extra adult and
-- child - covers what it always covered and prices exactly as before. No row
-- of data is inserted, updated or deleted here. 090's two triggers, which
-- stamped "one guest" onto rows of the base pair however they got there, go:
-- choosing a base type later would have re-read an older two-guest price as a
-- one-guest base, which is the silent re-pricing the owner ruled out.
--
-- SIGNATURES KEPT (MEMORY 317): price_for, rate_for, extra_person_rates,
-- tariff_for, set_rate, set_offset and set_basis_price keep their names,
-- arguments and return types. app.price_parts is the one definition they all
-- read; app.tariff_guests gives the channel manager the same arithmetic.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · the add-ons live beside the differences
-- -----------------------------------------------------------------------------
-- rate_offsets already holds the meal plans' add-ons (090) and the room types'
-- differences. Three more kinds, which name no room type or plan, and a unit
-- so a room type may be derived by a percentage.
--
-- Written ONCE (app.set_addon): one row from -infinity, open-ended. Dated rows
-- written before today keep their dates and keep working.
-- -----------------------------------------------------------------------------
alter table rate_offsets add column if not exists unit text not null default 'rupees';

alter table rate_offsets drop constraint if exists rate_offsets_kind_valid;
alter table rate_offsets add constraint rate_offsets_kind_valid
  check (kind in ('room_type', 'meal_plan', 'double', 'extra_adult', 'extra_child'));

alter table rate_offsets drop constraint if exists rate_offsets_names_its_subject;
alter table rate_offsets add constraint rate_offsets_names_its_subject check (
  (kind = 'room_type' and room_type_id is not null and meal_plan is null)
  or (kind = 'meal_plan' and meal_plan is not null and room_type_id is null)
  or (kind in ('double', 'extra_adult', 'extra_child')
      and room_type_id is null and meal_plan is null)
);

/* Only a room type is derived by a percentage; an add-on is rupees. */
alter table rate_offsets drop constraint if exists rate_offsets_unit_valid;
alter table rate_offsets add constraint rate_offsets_unit_valid
  check (unit = 'rupees' or (unit = 'percent' and kind = 'room_type'));

/* An add-on is never below zero. A room type's difference may be (090). */
alter table rate_offsets drop constraint if exists rate_offsets_addon_sane;
alter table rate_offsets add constraint rate_offsets_addon_sane
  check (kind not in ('double', 'extra_adult', 'extra_child') or amount >= 0);

comment on column rate_offsets.unit is
  'rupees, or percent for a room type derived from the base type (D27-188): '
  'the base x (1 + %), rounded to the whole rupee (D27-194).';


-- -----------------------------------------------------------------------------
-- 2 · 090's stamping triggers go
-- -----------------------------------------------------------------------------
-- A base row now says it covers one guest because the one function that
-- writes bases (app.set_base_price, below) says so, and app.set_rate keeps
-- it on a split. Nothing re-reads an older price.
-- -----------------------------------------------------------------------------
drop trigger if exists rates_basis_covers_one on rates;
drop trigger if exists basis_stamps_its_prices on pricing_basis;
drop function if exists app.rates_basis_covers_one();
drop function if exists app.basis_stamps_its_prices();


-- -----------------------------------------------------------------------------
-- 3 · a split keeps what the price covers
-- -----------------------------------------------------------------------------
-- 057's app.set_rate, with ONE change: the tail it puts back after a range
-- written into the middle of a row keeps that row's covers_persons. Without
-- it, a one-guest base split by a season came back as a two-guest price after
-- the season - 090 hid that with its trigger on the base pair only.
-- -----------------------------------------------------------------------------
create or replace function app.set_rate(
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
           extra_adult, extra_child, covers_persons
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
      update rates set valid_to = p_from where id = r.id;
      insert into rates (hotel_id, room_type_id, meal_plan, price,
                         valid_from, valid_to, label, created_by,
                         extra_adult, extra_child, covers_persons)
      values (p_hotel, p_room_type, r.meal_plan, r.price,
              v_end, r.valid_to, r.label, p_by, r.extra_adult, r.extra_child,
              r.covers_persons);

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

/* The same for a difference: a split keeps its unit. */
create or replace function app.set_offset(
  p_hotel     uuid,
  p_kind      text,
  p_room_type uuid,
  p_meal_plan text,
  p_from      date,
  p_to        date,
  p_amount    numeric,
  p_label     text,
  p_by        uuid
)
returns int
language plpgsql
as $$
declare
  v_end date := coalesce(p_to, 'infinity'::date);
  r     record;
  n     int;
begin
  if p_kind not in ('room_type', 'meal_plan') then
    raise exception 'a difference is about a room type or a meal plan';
  end if;

  if p_to is not null and p_to <= p_from then
    raise exception 'a difference range ends after it starts'
      using hint = 'The last day is not included, so a difference through the '
                   '31st ends on the 1st of the next month.';
  end if;

  for r in
    select id, valid_from, valid_to, amount, label, unit
      from rate_offsets
     where hotel_id = p_hotel
       and kind = p_kind
       and (p_kind <> 'room_type' or room_type_id = p_room_type)
       and (p_kind <> 'meal_plan' or meal_plan    = p_meal_plan)
       and valid_from < v_end
       and coalesce(valid_to, 'infinity'::date) > p_from
     order by valid_from
  loop
    if r.valid_from >= p_from
       and coalesce(r.valid_to, 'infinity'::date) <= v_end then
      delete from rate_offsets where id = r.id;

    elsif r.valid_from < p_from
          and coalesce(r.valid_to, 'infinity'::date) > v_end then
      update rate_offsets set valid_to = p_from where id = r.id;
      insert into rate_offsets (hotel_id, kind, room_type_id, meal_plan,
                                amount, valid_from, valid_to, label, created_by, unit)
      values (p_hotel, p_kind, p_room_type, p_meal_plan,
              r.amount, v_end, r.valid_to, r.label, p_by, r.unit);

    elsif r.valid_from < p_from then
      update rate_offsets set valid_to = p_from where id = r.id;

    else
      update rate_offsets set valid_from = v_end where id = r.id;
    end if;
  end loop;

  if p_amount is not null then
    insert into rate_offsets (hotel_id, kind, room_type_id, meal_plan,
                              amount, valid_from, valid_to, label, created_by)
    values (p_hotel, p_kind, p_room_type, p_meal_plan, p_amount,
            p_from, p_to, nullif(trim(coalesce(p_label, '')), ''), p_by);
  end if;

  select count(*)::int into n
    from rate_offsets
   where hotel_id = p_hotel
     and kind = p_kind
     and (p_kind <> 'room_type' or room_type_id = p_room_type)
     and (p_kind <> 'meal_plan' or meal_plan    = p_meal_plan);
  return n;
end $$;


-- -----------------------------------------------------------------------------
-- 4 · THE ONE DEFINITION: a price and its parts
-- -----------------------------------------------------------------------------
-- For a room type on a plan on a date:
--
--   price        what the first `covers` guests pay
--   covers       1 for a base price; an older price's own count (the type's
--                base_occupancy where it does not say)
--   source       'typed' | 'derived' | 'rack' | NULL, as 090
--   second       a base price's second guest: double occupancy + the meal
--   extra_adult  each adult past the covered ones: an older price's own
--   extra_child  figures (057), a base price's add-ons + the meal
--
-- Order, as 090 and 155:
--   1 typed    a rates row for this very type and plan. Covering more than one
--              guest, it is an older price and answers exactly as before.
--   2 derived  the type's own base row on the base plan, else (mode b) the
--              base type's plus this type's difference; plus the meal's add-on
--              for one guest. A difference or meal never set: not priced.
--   3 rack     where no base covers the date, as 090.
--   4 NULL     nobody priced it. Never zero.
-- -----------------------------------------------------------------------------
drop function if exists app.price_parts(uuid, text, date);

create function app.price_parts(
  p_room_type uuid,
  p_meal_plan text,
  p_date      date
)
returns table (
  price       numeric,
  covers      int,
  source      text,
  second      numeric,
  extra_adult numeric,
  extra_child numeric
)
language plpgsql
stable
as $$
declare
  v_hotel      uuid;
  v_occ        int;
  v_basis_type uuid;
  v_plan       text;
  v_row        record;
  v_base       numeric;
  v_diff       numeric;
  v_unit       text;
  v_meal       numeric;
begin
  select rt.hotel_id, rt.base_occupancy into v_hotel, v_occ
    from room_types rt where rt.id = p_room_type;
  select b.room_type_id, b.meal_plan into v_basis_type, v_plan
    from pricing_basis b where b.hotel_id = v_hotel;
  v_plan := coalesce(v_plan, 'EP');

  /* The meal's add-on for one guest. On the base plan nothing is added unless
     somebody typed one (155); on any other plan, never set = not priced. */
  v_meal := case when p_meal_plan = v_plan
                 then app.offset_for(v_hotel, 'meal_plan', null, p_meal_plan, p_date)
                 else app.offset_if_set(v_hotel, 'meal_plan', null, p_meal_plan, p_date) end;

  /* 1 · typed */
  select r.price, r.covers_persons, r.extra_adult, r.extra_child into v_row
    from rates r
   where r.room_type_id = p_room_type
     and r.meal_plan    = p_meal_plan
     and p_date >= r.valid_from
     and (r.valid_to is null or p_date < r.valid_to)
   limit 1;

  if v_row.price is not null and coalesce(v_row.covers_persons, v_occ, 2) > 1 then
    /* An older price: its own count, its own extras, else the type's (057). */
    price  := v_row.price;
    covers := coalesce(v_row.covers_persons, v_occ, 2);
    source := 'typed';
    select coalesce(v_row.extra_adult, rt.extra_adult_rate),
           coalesce(v_row.extra_child, rt.extra_child_rate)
      into extra_adult, extra_child
      from room_types rt where rt.id = p_room_type;
    return next;
    return;
  end if;

  if v_row.price is not null then
    price  := v_row.price;
    source := 'typed';
  else
    /* 2 · derived - the type's own base first (mode a, or an override) */
    select r.price into v_base
      from rates r
     where r.room_type_id = p_room_type
       and r.meal_plan    = v_plan
       and r.covers_persons = 1
       and p_date >= r.valid_from
       and (r.valid_to is null or p_date < r.valid_to)
     limit 1;

    if v_base is null and v_basis_type is not null and p_room_type <> v_basis_type then
      select r.price into v_base
        from rates r
       where r.room_type_id = v_basis_type
         and r.meal_plan    = v_plan
         and r.covers_persons = 1
         and p_date >= r.valid_from
         and (r.valid_to is null or p_date < r.valid_to)
       limit 1;

      if v_base is not null then
        select o.amount, o.unit into v_diff, v_unit
          from rate_offsets o
         where o.hotel_id = v_hotel and o.kind = 'room_type'
           and o.room_type_id = p_room_type
           and p_date >= o.valid_from
           and (o.valid_to is null or p_date < o.valid_to)
         limit 1;
        /* Set for other dates only: the base applies (16 Sep). Never set:
           not priced, and no rack in its place (155). */
        if v_diff is null and exists (
          select 1 from rate_offsets o
           where o.hotel_id = v_hotel and o.kind = 'room_type'
             and o.room_type_id = p_room_type) then
          v_diff := 0;
          v_unit := 'rupees';
        end if;

        if v_diff is null then
          price := null; covers := coalesce(v_occ, 2); source := null;
          return next;
          return;
        end if;

        v_base := case when v_unit = 'percent'
                       then round(v_base * (100 + v_diff) / 100, 0)
                       else v_base + v_diff end;
      end if;
    end if;

    if v_base is null then
      /* 3 · rack - only where no base covers the date, as 090. */
      select rt.base_rate, rt.extra_adult_rate, rt.extra_child_rate
        into price, extra_adult, extra_child
        from room_types rt where rt.id = p_room_type;
      if price is not null then
        covers := coalesce(v_occ, 2);
        source := 'rack';
        return next;
        return;
      end if;

      /* 4 · nobody has priced it. The add-ons still answer for the extras,
         so a contract's own figure can use the calendar's extra person. */
      price := null; covers := coalesce(v_occ, 2); source := null;
      second      := app.offset_if_set(v_hotel, 'double', null, null, p_date) + v_meal;
      extra_adult := app.offset_if_set(v_hotel, 'extra_adult', null, null, p_date) + v_meal;
      extra_child := app.offset_if_set(v_hotel, 'extra_child', null, null, p_date) + v_meal;
      return next;
      return;
    end if;

    price  := v_base + v_meal;      -- NULL where the meal was never priced
    source := case when price is null then null else 'derived' end;
  end if;

  /* A one-guest price, and the add-ons that ride on it (D27-194). */
  covers      := 1;
  second      := app.offset_if_set(v_hotel, 'double', null, null, p_date) + v_meal;
  extra_adult := app.offset_if_set(v_hotel, 'extra_adult', null, null, p_date) + v_meal;
  extra_child := app.offset_if_set(v_hotel, 'extra_child', null, null, p_date) + v_meal;
  return next;
end $$;

comment on function app.price_parts(uuid, text, date) is
  'A room type on a plan on a date: the price for the guests it covers, how '
  'many, where it came from, and what each further guest adds - a base '
  'price''s second guest (double occupancy + meal) and extras (add-on + meal), '
  'or an older price''s own extras. NULL wherever nobody set a figure (D27-194).';

grant execute on function app.price_parts(uuid, text, date) to pms_app;


-- -----------------------------------------------------------------------------
-- 5 · the old doors, the same shape, reading the one definition
-- -----------------------------------------------------------------------------
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
language sql
stable
as $$
  select p.price, p.covers, p.source
    from app.price_parts(p_room_type, p_meal_plan, p_date) p;
$$;

comment on function app.price_for(uuid, text, date) is
  'What a room type costs on a plan on a date and how many guests that covers '
  '(app.price_parts): a typed row, else a base + add-ons (D27-188), else the '
  'rack where no base is in use, else NULL. Never zero by default.';

grant execute on function app.price_for(uuid, text, date) to pms_app;

create or replace function app.extra_person_rates(
  p_room_type uuid, p_meal_plan text, p_date date
)
returns table (adult numeric, child numeric)
language sql stable as $$
  select p.extra_adult, p.extra_child
    from app.price_parts(p_room_type, p_meal_plan, p_date) p;
$$;

comment on function app.extra_person_rates(uuid, text, date) is
  'What each guest past the covered ones adds, per night: an older price''s '
  'own figures (057), or the hotel''s extra adult / child add-on plus the meal '
  '(D27-194). NULL where nobody priced it - an unpriced guest is not a free one.';

grant execute on function app.extra_person_rates(uuid, text, date) to pms_app;


-- -----------------------------------------------------------------------------
-- 6 · a night for a party
-- -----------------------------------------------------------------------------
-- Unchanged for an older price. For a one-guest price there is a second slot,
-- sold as double occupancy, to an adult or a child (D27-194); `base` then
-- includes it, so base + extra_adults x adult_rate + extra_children x
-- child_rate is still the total.
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
  total           numeric,
  unpriced        text
)
language plpgsql stable as $$
declare
  v_covers  int;
  v_second  numeric;
  v_slots   int;
  v_two     boolean := p_adults + p_children >= 2;
  v_missing text[] := '{}';
begin
  select p.price, p.covers, p.second, p.extra_adult, p.extra_child
    into base, v_covers, v_second, adult_rate, child_rate
    from app.price_parts(p_room_type, p_meal_plan, p_date) p;
  v_covers := coalesce(v_covers, 2);
  v_slots  := case when v_covers = 1 then 2 else v_covers end;

  extra_adults   := greatest(p_adults - v_slots, 0);
  extra_children := greatest(p_children - greatest(v_slots - p_adults, 0), 0);

  if base is null then
    v_missing := array_append(v_missing, 'the room');
  elsif v_covers = 1 and v_two then
    if v_second is null then
      v_missing := array_append(v_missing, 'the second guest');
    else
      base := base + v_second;
    end if;
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
    total := null;
    unpriced := array_to_string(v_missing, ' and ');
  end if;

  return next;
end $$;

comment on function app.tariff_for(uuid, text, date, int, int) is
  'One night for a given party: the room (with the second guest on a one-guest '
  'base, D27-194), the extra persons past it, and the total - NULL, with '
  '`unpriced` naming what is missing, whenever any part has no price.';

grant execute on function app.tariff_for(uuid, text, date, int, int) to pms_app;


-- -----------------------------------------------------------------------------
-- 7 · the same arithmetic for 1, 2 … n adults, for the channel manager
-- -----------------------------------------------------------------------------
-- The channel manager sends SU a price per guest count. It used to work that
-- out itself from price_for and extra_person_rates - a copy of tariff_for's
-- rule that would not know about double occupancy. One read per date here,
-- held to tariff_for by db/tests/modules/inventory.sql.
-- -----------------------------------------------------------------------------
drop function if exists app.tariff_guests(uuid, text, date, int);

create function app.tariff_guests(
  p_room_type uuid, p_meal_plan text, p_date date, p_max int
)
returns numeric[]
language sql stable as $$
  select array(
    select case
             when p.price is null then null
             when p.covers = 1 and n = 1 then p.price
             when p.covers = 1 and n = 2 then p.price + p.second
             when p.covers = 1 then p.price + p.second + (n - 2) * p.extra_adult
             when n <= p.covers then p.price
             else p.price + (n - p.covers) * p.extra_adult
           end
      from app.price_parts(p_room_type, p_meal_plan, p_date) p
      cross join generate_series(1, p_max) n
     order by n);
$$;

comment on function app.tariff_guests(uuid, text, date, int) is
  'app.tariff_for''s total for 1, 2 … p_max adults and no children, in one '
  'read: what the channel manager sends per guest count.';

grant execute on function app.tariff_guests(uuid, text, date, int) to pms_app;


-- -----------------------------------------------------------------------------
-- 8 · writing: a base, and an add-on or a difference
-- -----------------------------------------------------------------------------
drop function if exists app.set_base_price(uuid, uuid, date, date, numeric, text, uuid);

create function app.set_base_price(
  p_hotel     uuid,
  p_room_type uuid,
  p_from      date,
  p_to        date,          -- exclusive; NULL is open-ended
  p_price     numeric,       -- NULL clears the range
  p_label     text,
  p_by        uuid
)
returns int
language plpgsql
as $$
declare
  v_plan text;
  n      int;
begin
  select coalesce((select meal_plan from pricing_basis where hotel_id = p_hotel), 'EP')
    into v_plan;
  n := app.set_rate(p_hotel, p_room_type, v_plan, p_from, p_to,
                    p_price, p_label, p_by, null, null);
  if p_price is not null then
    update rates set covers_persons = 1
     where hotel_id = p_hotel and room_type_id = p_room_type
       and meal_plan = v_plan and valid_from = p_from;
  end if;
  return n;
end $$;

comment on function app.set_base_price(uuid, uuid, date, date, numeric, text, uuid) is
  'Sets a room type''s base - one guest, the base plan - over a date range '
  '(D27-188). The only writer of a base row.';

revoke all on function app.set_base_price(uuid, uuid, date, date, numeric, text, uuid) from public;
grant execute on function app.set_base_price(uuid, uuid, date, date, numeric, text, uuid) to pms_app;

/* 090's door for the base type's figure, now a base like any other. */
create or replace function app.set_basis_price(
  p_hotel uuid,
  p_from  date,
  p_to    date,
  p_price numeric,
  p_label text,
  p_by    uuid
)
returns int
language plpgsql
as $$
declare v_type uuid;
begin
  select room_type_id into v_type from pricing_basis where hotel_id = p_hotel;
  if v_type is null then
    raise exception 'this property has no base yet'
      using hint = 'Choose the room type and meal plan the base is before '
                   'setting its price.';
  end if;
  return app.set_base_price(p_hotel, v_type, p_from, p_to, p_price, p_label, p_by);
end $$;

drop function if exists app.set_addon(uuid, text, uuid, text, numeric, text, uuid);

create function app.set_addon(
  p_hotel     uuid,
  p_kind      text,          -- room_type | meal_plan | double | extra_adult | extra_child
  p_room_type uuid,          -- room_type only
  p_meal_plan text,          -- meal_plan only
  p_amount    numeric,       -- NULL clears it: a dash, not sold
  p_unit      text,          -- 'rupees' | 'percent' (room_type only)
  p_by        uuid
)
returns void
language plpgsql
as $$
begin
  if p_kind not in ('room_type', 'meal_plan', 'double', 'extra_adult', 'extra_child') then
    raise exception 'an add-on is a meal plan, double occupancy, an extra adult or child, or a room type''s difference';
  end if;
  if p_kind <> 'room_type' and p_amount < 0 then
    raise exception 'an add-on is zero or more';
  end if;

  /* Set once (D27-188): whatever was on file for this, dated or not, is
     replaced by one figure for every date. */
  delete from rate_offsets
   where hotel_id = p_hotel and kind = p_kind
     and room_type_id is not distinct from p_room_type
     and meal_plan    is not distinct from p_meal_plan;

  if p_amount is not null then
    insert into rate_offsets (hotel_id, kind, room_type_id, meal_plan, amount,
                              unit, valid_from, valid_to, created_by)
    values (p_hotel, p_kind, p_room_type, p_meal_plan, p_amount,
            coalesce(p_unit, 'rupees'), '-infinity'::date, null, p_by);
  end if;
end $$;

comment on function app.set_addon(uuid, text, uuid, text, numeric, text, uuid) is
  'Sets one add-on (a meal plan, double occupancy, extra adult, extra child) or '
  'a room type''s difference from the base type, for every date (D27-188). '
  'NULL clears it: a dash, and nothing needing it is sold.';

revoke all on function app.set_addon(uuid, text, uuid, text, numeric, text, uuid) from public;
grant execute on function app.set_addon(uuid, text, uuid, text, numeric, text, uuid) to pms_app;
