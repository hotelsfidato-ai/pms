-- =============================================================================
-- INVENTORY — the module's own assertions
-- =============================================================================
-- One file per service (docs/SERVICE-FOLDERS-PLAN.md); run after suite.sql, in
-- the same session. Everything here builds its own property and removes it,
-- so it depends on nothing the suite left behind and leaves nothing for what
-- runs next.
-- =============================================================================


-- =============================================================================
-- PRICING (090) — one base, everything else a difference
-- =============================================================================
-- The load-bearing assertions are the two that protect a live hotel:
--
--   1. nothing derives until somebody sets a basis — so this migration changes
--      the price of nothing already sold;
--   2. a typed price beats a derived one — so a number the owner typed is
--      never quietly overruled by arithmetic.
--
-- And the oldest rule in this schema, which the new layer must not break: an
-- unpriced thing answers NULL, never zero.
-- =============================================================================
do $$
declare
  h uuid; dlx uuid; std uuid; admin uuid;
  p numeric; c int; s text; t record; n int;
begin
  select id into admin from staff where is_group_admin limit 1;

  h := app.provision_property_unchecked('PBS','Pricing Basis Test','Nowhere');

  select id into dlx from room_types where hotel_id = h and code = 'DLX';
  select id into std from room_types where hotel_id = h and code = 'STD';

  perform test.ok('pricing','the fixture has two room types to price',
    dlx is not null and std is not null);

  -- ---------- 1 · nothing is priced, and nothing pretends otherwise ----------
  perform test.ok('pricing','an unpriced room answers null, not zero',
    app.rate_for(dlx, 'EP', date '2026-12-14') is null);

  select p2.source into s from app.price_for(dlx, 'EP', date '2026-12-14') p2;
  perform test.ok('pricing','and names no source for a price that does not exist',
    s is null, coalesce(s, '<null>'));

  -- ---------- 2 · a basis alone derives nothing ----------
  -- The pointer is set but the figure it points at does not exist yet. A
  -- system that answered anything here would be inventing the base.
  insert into pricing_basis (hotel_id, room_type_id, meal_plan, set_by)
  values (h, dlx, 'EP', admin);

  perform test.ok('pricing','a basis with no figure behind it derives nothing',
    app.rate_for(std, 'EP', date '2026-12-14') is null);

  -- ---------- 3 · the base is typed, and everything follows it ----------
  -- One person, room only: the owner's decision of 16 September.
  insert into rates (hotel_id, room_type_id, meal_plan, price, covers_persons,
                     valid_from, created_by)
  values (h, dlx, 'EP', 2000, 1, date '2026-01-01', admin);

  perform test.ok('pricing','the base answers for the room it is set on',
    app.rate_for(dlx, 'EP', date '2026-12-14') = 2000);

  perform test.ok('pricing','a type with no difference set sells at the base',
    app.rate_for(std, 'EP', date '2026-12-14') = 2000);

  select p2.source, p2.covers into s, c
    from app.price_for(std, 'EP', date '2026-12-14') p2;
  perform test.ok('pricing','a derived price says it is derived',
    s = 'derived', coalesce(s, '<null>'));
  perform test.ok('pricing','and that it covers one person',
    c = 1, c || ' covered');

  -- ---------- 4 · a difference is added, in rupees ----------
  insert into rate_offsets (hotel_id, kind, room_type_id, amount,
                            valid_from, label, created_by)
  values (h, 'room_type', std, 500, date '2026-01-01', 'The standard room', admin);

  perform test.ok('pricing','a room-type difference is added to the base',
    app.rate_for(std, 'EP', date '2026-12-14') = 2500);

  insert into rate_offsets (hotel_id, kind, meal_plan, amount,
                            valid_from, label, created_by)
  values (h, 'meal_plan', 'CP', 300, date '2026-01-01', 'Breakfast', admin);

  perform test.ok('pricing','a meal-plan difference is added on top of it',
    app.rate_for(std, 'CP', date '2026-12-14') = 2800);

  -- ---------- 5 · CHANGE THE BASE AND EVERYTHING MOVES ----------
  -- This is the sentence the owner asked for, asserted.
  update rates set price = 2100
   where hotel_id = h and room_type_id = dlx and meal_plan = 'EP';

  perform test.ok('pricing','changing the base moves every derived price',
    app.rate_for(std, 'EP', date '2026-12-14') = 2600
    and app.rate_for(std, 'CP', date '2026-12-14') = 2900
    and app.rate_for(dlx, 'CP', date '2026-12-14') = 2400);

  -- ---------- 6 · A TYPED PRICE BEATS A DERIVED ONE ----------
  insert into rates (hotel_id, room_type_id, meal_plan, price,
                     valid_from, valid_to, label, created_by)
  values (h, std, 'EP', 4000, date '2026-12-10', date '2026-12-20',
          'Typed by the owner', admin);

  perform test.ok('pricing','a typed price wins inside its own range',
    app.rate_for(std, 'EP', date '2026-12-14') = 4000);
  perform test.ok('pricing','and the derived price returns outside it',
    app.rate_for(std, 'EP', date '2026-12-21') = 2600);

  select p2.source, p2.covers into s, c
    from app.price_for(std, 'EP', date '2026-12-14') p2;
  perform test.ok('pricing','a typed row with no covers_persons still covers the room type''s own',
    s = 'typed' and c = (select base_occupancy from room_types where id = std),
    coalesce(s,'<null>') || ' / ' || c);

  -- ---------- 7 · a difference applies only inside its dates ----------
  -- On the STANDARD type, which is derived. 2100 base + 500 its own standing
  -- difference + 900 for the fortnight.
  -- Through app.set_offset, because a standing difference already covers
  -- these dates and two covering one day are refused. The function trims the
  -- standing row, writes the fortnight, and puts the tail back.
  perform app.set_offset(h, 'room_type', std, null,
                         date '2026-11-01', date '2026-11-15', 900, 'Diwali', admin);

  perform test.ok('pricing','a difference applies on the first day of its range',
    app.rate_for(std, 'EP', date '2026-11-01') = 3000,
    coalesce(app.rate_for(std, 'EP', date '2026-11-01')::text, '<null>'));
  perform test.ok('pricing','and not on the last, which is excluded',
    app.rate_for(std, 'EP', date '2026-11-15') = 2600,
    coalesce(app.rate_for(std, 'EP', date '2026-11-15')::text, '<null>'));

  -- THE TAIL. The standing difference must come back the day the season ends,
  -- and still be there in a year. 053's comment calls this the case that
  -- silently loses a property its pricing.
  perform test.ok('pricing','the standing difference is put back after the season',
    app.rate_for(std, 'EP', date '2027-06-01') = 2600,
    coalesce(app.rate_for(std, 'EP', date '2027-06-01')::text, '<null>'));
  perform test.ok('pricing','and is still there before it',
    app.rate_for(std, 'EP', date '2026-10-31') = 2600,
    coalesce(app.rate_for(std, 'EP', date '2026-10-31')::text, '<null>'));

  -- Clearing a range leaves the base applying, not a zero.
  perform app.set_offset(h, 'room_type', std, null,
                         date '2026-11-01', date '2026-11-15', null, null, admin);
  perform test.ok('pricing','clearing a difference leaves the base, not a zero',
    app.rate_for(std, 'EP', date '2026-11-01') = 2100,
    coalesce(app.rate_for(std, 'EP', date '2026-11-01')::text, '<null>'));

  -- ---------- 7a · THE BASE HAS NO DIFFERENCE FROM ITSELF ----------
  -- Found by this file getting it wrong: a room-type difference on the basis
  -- type cannot reach the base itself, because the base is a typed price. It
  -- must not reach the base's OTHER plans either, or breakfast on the base
  -- room would cost the difference as well. A season on the base is a typed
  -- base row for those dates.
  insert into rate_offsets (hotel_id, kind, room_type_id, amount,
                            valid_from, label, created_by)
  values (h, 'room_type', dlx, 750, date '2026-01-01', 'Ignored by design', admin);

  perform test.ok('pricing','a difference on the base type does not touch the base',
    app.rate_for(dlx, 'EP', date '2026-12-14') = 2100,
    coalesce(app.rate_for(dlx, 'EP', date '2026-12-14')::text, '<null>'));
  perform test.ok('pricing','nor the base type on another plan',
    app.rate_for(dlx, 'CP', date '2026-12-14') = 2400,
    coalesce(app.rate_for(dlx, 'CP', date '2026-12-14')::text, '<null>'));

  -- ---------- 8 · TWO DIFFERENCES FOR ONE DAY ARE REFUSED ----------
  perform test.raises('pricing','two differences covering one day are refused',
    format($q$insert into rate_offsets (hotel_id, kind, room_type_id, amount,
                                        valid_from, valid_to)
              values (%L,'room_type',%L,100,'2026-11-05','2026-11-20')$q$,
           h, std), '23P01');

  -- ---------- 9 · a row names the thing its kind is about ----------
  perform test.raises('pricing','a room-type difference may not name a meal plan',
    format($q$insert into rate_offsets (hotel_id, kind, room_type_id, meal_plan,
                                        amount, valid_from)
              values (%L,'room_type',%L,'CP',100,'2027-01-01')$q$,
           h, dlx), '23514');
  perform test.raises('pricing','a meal-plan difference may not name a room type',
    format($q$insert into rate_offsets (hotel_id, kind, room_type_id, meal_plan,
                                        amount, valid_from)
              values (%L,'meal_plan',%L,'CP',100,'2027-01-01')$q$,
           h, dlx), '23514');

  -- ---------- 10 · THE PARTY: COUNTING STARTS AT THE FIRST PERSON ----------
  -- The owner, 16 September: two adults are the base plus one extra adult.
  -- The extra-adult figure is unset here, so the total must be NULL and say
  -- so — a second guest who has not been priced is not a free one.
  select * into t from app.tariff_for(dlx, 'EP', date '2026-12-14', 2, 0);
  perform test.ok('pricing','a derived price makes the second adult an extra',
    t.extra_adults = 1, t.extra_adults || ' extra');
  perform test.ok('pricing','and an unpriced extra adult makes the total null, in words',
    t.total is null and t.unpriced = 'the extra adult',
    coalesce(t.unpriced, '<null>'));

  update room_types set extra_adult_rate = 700 where id = dlx;
  select * into t from app.tariff_for(dlx, 'EP', date '2026-12-14', 2, 0);
  perform test.ok('pricing','two adults are the base plus one extra adult',
    t.total = 2800, coalesce(t.total::text, '<null>'));
  select * into t from app.tariff_for(dlx, 'EP', date '2026-12-14', 3, 0);
  perform test.ok('pricing','three adults are the base plus two',
    t.total = 3500, coalesce(t.total::text, '<null>'));

  -- ---------- 11 · A TYPED PRICE KEEPS THE MEANING IT WAS WRITTEN WITH ----
  -- THE ASSERTION THAT PROTECTS EVERY BOOKING MADE BEFORE TODAY. The standard type's
  -- row above carries no covers_persons, so it covers what the room type says
  -- — two — and a two-adult stay on it costs the typed price and nothing else.
  select * into t from app.tariff_for(std, 'EP', date '2026-12-14', 2, 0);
  perform test.ok('pricing','a price typed before 090 still covers what it always did',
    t.extra_adults = 0 and t.total = 4000,
    t.extra_adults || ' extra / ' || coalesce(t.total::text, '<null>'));

  -- ---------- 12 · a property with no basis is untouched ----------
  -- Every property in this database is in this state until somebody sets one.
  delete from pricing_basis where hotel_id = h;
  perform test.ok('pricing','remove the basis and nothing derives any more',
    app.rate_for(dlx, 'CP', date '2026-12-14') is null);

  -- ---------- 13 · the category groups types without selling anything ------
  update room_types set category = 'Deluxe' where id in (dlx, std);
  select count(*) into n from room_types
   where hotel_id = h and category = 'Deluxe';
  perform test.ok('pricing','a category groups sellable types and leaves them sellable',
    n = 2 and (select count(*) from room_types where hotel_id = h) >= 2,
    n || ' grouped');

  -- ---------- and the fixture goes ----------
  -- `hotels_no_delete` refuses a plain delete, correctly; lifted for one
  -- statement exactly as the suite's own price fixture does.
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code = 'PBS';
  perform test.ok('pricing','the pricing fixture does not outlive the test',
    n = 0, n || ' left behind');
end $$;
