-- =============================================================================
-- TEST HOTELS (D27-296, the owner, 10 October)
-- =============================================================================
-- Refers to its migration by what it does ("test hotels"), never by number.
--
-- A test hotel inside the live system: a copy of a real hotel's whole setup,
-- used only by the people switched on for it, reset at will, and kept apart
-- from everything real. What is proved here is the database's half: the
-- classes every table is in, the two sides of the group's guests, the mixing
-- guard, the copy, the reset and the re-copy. The API's half is
-- api/test/modules/admin/testHotels.test.ts.
--
-- The second block builds two hotels, a dozen people and a few days of trade,
-- and UNDOES ALL OF IT at the end (it raises a sentinel inside, caught one
-- level up): nothing it makes outlives it, so no guard is lifted to clean up.
-- Its assertions are gathered in a variable, which a rollback does not touch,
-- and written to test.results after.
-- =============================================================================

-- A statement's refusal, as text; null when it went through - and then it is
-- undone, so a guard that has been taken out cannot change what the checks
-- after it see (a test hotel turned real stopped the whole file, and the
-- assertion that should have failed was never written).
create or replace function test.th_err(p_sql text)
returns text
language plpgsql
as $$
begin
  begin
    execute p_sql;
    raise exception using errcode = 'TH002', message = 'went through';
  exception when sqlstate 'TH002' then
    return null;
  end;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
-- Asked as the application role too, inside this file only (revoked at its end).
grant usage on schema test to pms_app;
grant execute on function test.th_err(text) to pms_app;


-- =============================================================================
-- EVERY TABLE IS DECIDED, AND THE GUARD IS ON EVERY TABLE IT MUST BE
-- =============================================================================
-- These fail the day somebody adds a table and does not say whether a test
-- hotel copies it, clears it or never touches it - or adds a hotel table that
-- points at a guest without the mixing guard.
-- =============================================================================
do $$
declare
  v text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into v
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
     and not exists (select 1 from app.test_hotel_classes() t where t.table_name = c.relname);
  perform test.ok('test hotels', 'every table is in a class: setup, trading, never or group',
    v is null, 'in no class: ' || coalesce(v, '-'));

  select string_agg(t.table_name, ', ') into v
    from app.test_hotel_classes() t
   where to_regclass('public.' || t.table_name) is null;
  perform test.ok('test hotels', 'every table a class names exists', v is null, coalesce(v, '-'));

  select string_agg(table_name, ', ') into v
    from (select table_name from app.test_hotel_classes() group by table_name having count(*) > 1) d;
  perform test.ok('test hotels', 'no table is in two classes', v is null, coalesce(v, '-'));

  select string_agg(t.table_name, ', ') into v
    from app.test_hotel_classes() t
   where (t.class in ('group', 'never')) and (t.class = 'group') = exists (
           select 1 from pg_attribute a where a.attrelid = to_regclass('public.' || t.table_name)
              and a.attname = 'hotel_id' and not a.attisdropped);
  perform test.ok('test hotels', 'a group table has no hotel, and a never-copied one has',
    v is null, coalesce(v, '-'));

  -- A setup or trading table with no hotel of its own hangs off one that has.
  select string_agg(t.table_name, ', ') into v
    from app.test_hotel_classes() t
   where t.class in ('setup', 'trading')
     and not exists (select 1 from pg_attribute a where a.attrelid = to_regclass('public.' || t.table_name)
                        and a.attname = 'hotel_id' and not a.attisdropped)
     and not exists (
       select 1 from pg_constraint k join pg_class p on p.oid = k.confrelid
         join app.test_hotel_classes() pc on pc.table_name = p.relname and pc.class = t.class
        where k.conrelid = to_regclass('public.' || t.table_name) and k.contype = 'f'
          and (t.class = 'setup' or k.confdeltype = 'c'));
  perform test.ok('test hotels', 'a setup or trading table with no hotel hangs off its own class (trading by cascade)',
    v is null, coalesce(v, '-'));

  select string_agg(a.attname, ', ') into v
    from pg_attribute a
   where a.attrelid = 'public.hotels'::regclass and a.attnum > 0 and not a.attisdropped
     and not exists (select 1 from app.test_hotel_hotels_columns() c where c.column_name = a.attname);
  perform test.ok('test hotels', 'every column of a property is decided: copied to its test hotel or not',
    v is null, 'undecided: ' || coalesce(v, '-'));

  -- The reset clears trading tables; nothing outside them may point at one
  -- and stop it (resetOrder.test.ts's lesson, for this list).
  select string_agg(distinct ch.relname || ' -> ' || pa.relname, ', ') into v
    from pg_constraint k
    join pg_class ch on ch.oid = k.conrelid
    join pg_class pa on pa.oid = k.confrelid
    join app.test_hotel_classes() pc on pc.table_name = pa.relname and pc.class = 'trading'
    join app.test_hotel_classes() cc on cc.table_name = ch.relname and cc.class <> 'trading'
   where k.contype = 'f' and k.confdeltype not in ('c', 'n');
  perform test.ok('test hotels', 'nothing outside the trading tables points at one, so a reset is never stopped',
    v is null, coalesce(v, '-'));

  -- A copied table must be able to drop a key to what is not copied.
  select string_agg(distinct ch.relname || '.' || at.attname, ', ') into v
    from pg_constraint k
    join pg_class ch on ch.oid = k.conrelid
    join pg_class pa on pa.oid = k.confrelid
    join pg_attribute at on at.attrelid = ch.oid and at.attnum = any (k.conkey)
    join app.test_hotel_classes() cc on cc.table_name = ch.relname and cc.class = 'setup'
    join app.test_hotel_classes() pc on pc.table_name = pa.relname and pc.class in ('trading', 'never')
   where k.contype = 'f' and at.attnotnull and at.attname <> 'hotel_id';
  perform test.ok('test hotels', 'no setup table must point at something a test hotel does not copy',
    v is null, coalesce(v, '-'));

  -- THE MIXING GUARD, ON EVERY TABLE THAT NEEDS IT.
  select string_agg(c.relname || '.' || a.attname, ', ' order by c.relname) into v
    from pg_constraint k
    join pg_class c on c.oid = k.conrelid
    join pg_class f on f.oid = k.confrelid
    join pg_attribute a on a.attrelid = c.oid and a.attnum = k.conkey[1]
   where k.contype = 'f'
     and f.relname in ('guests', 'companies', 'reservation_groups')
     and c.relnamespace = 'public'::regnamespace
     and exists (select 1 from pg_attribute h where h.attrelid = c.oid
                    and h.attname = 'hotel_id' and not h.attisdropped)
     and not exists (
       select 1 from pg_trigger t
        where t.tgrelid = c.oid and not t.tgisinternal
          and t.tgfoid = 'app.keep_sides()'::regprocedure
          and position((E'\\000' || a.attname || E'\\000') in (E'\\000' || encode(t.tgargs, 'escape'))) > 0);
  perform test.ok('test hotels', 'every hotel table that points at a guest, a company or a group carries the mixing guard',
    v is null, 'unguarded: ' || coalesce(v, '-'));
end $$;


-- =============================================================================
-- THE TWO SIDES, THE COPY, THE RESET AND THE RE-COPY
-- =============================================================================
do $$
declare
  res   jsonb := '[]';
  owner uuid; tester uuid; clerk uuid; gm uuid; mixed uuid;
  r uuid; t uuid; t_new uuid; t_code text; rt uuid; rt_t uuid; r101 uuid; r102 uuid; t101 uuid; t102 uuid;
  g1 uuid; g2 uuid; c1 uuid; c2 uuid; real_res uuid;
  outlet uuid; sec uuid; kitchen uuid; cat uuid; item uuid; grp uuid; station uuid;
  loc uuid; si uuid;
  t_outlet uuid; t_item uuid; t_var uuid; t_loc uuid; t_si uuid;
  stay uuid; fol uuid; pid bigint; ord uuid; line bigint; struck bigint; fy text; bd date; inv uuid;
  n bigint; m bigint; v text; ok boolean; j jsonb; tbl record;
  setup_before jsonb; removed bigint;
begin
  begin
    select id into owner from staff where email = 'owner@fidato.in';
    perform set_config('app.user_id', owner::text, true);
    perform set_config('app.hotel_code', '', true);

    -- ---------- a real hotel, with a setup worth copying ----------
    r := app.provision_property_unchecked('THR', 'Test Hotels Real', 'Nowhere');
    select id into rt from room_types where hotel_id = r and code = 'STD';
    update hotels set gstin = '27AAAAA0000A1Z5', check_in_time = '13:00', early_checkin_charge = 750
     where id = r;
    insert into rooms (hotel_id, room_type_id, number) values (r, rt, '101') returning id into r101;
    insert into rooms (hotel_id, room_type_id, number) values (r, rt, '102') returning id into r102;
    update rooms set connected_room_id = r102 where id = r101;
    insert into rates (hotel_id, room_type_id, meal_plan, price, valid_from) values (r, rt, 'CP', 3200, '2026-01-01');
    insert into rate_plan_settings (hotel_id, room_type_id, meal_plan) values (r, rt, 'CP');
    insert into inclusions (hotel_id, name) values (r, 'Breakfast');
    insert into room_promotions (hotel_id, name, percent) values (r, 'Early bird', 10);
    insert into hotel_texts (hotel_id, kind, body) values (r, 'about', 'A real hotel.');
    insert into hotel_modules (hotel_id, module, is_enabled) values (r, 'loyalty', true), (r, 'banquet', true);
    insert into pos_outlets (hotel_id, code, name, staff_id, api_key_hash)
    values (r, 'REST', 'Restaurant', owner, repeat('a', 64)) returning id into outlet;
    insert into pos_sections (hotel_id, outlet_id, name) values (r, outlet, 'Hall') returning id into sec;
    insert into pos_tables (hotel_id, section_id, label) values (r, sec, 'T1');
    insert into pos_kot_stations (hotel_id, device, name) values (r, 'thdevice01', 'Bar PC') returning id into station;
    select id into kitchen from pos_kot_kinds where hotel_id = r order by sort limit 1;
    update pos_kot_kinds set station_id = station, station_since = now() where id = kitchen;
    insert into pos_menu_categories (hotel_id, name, kot_kind_id) values (r, 'Mains', kitchen) returning id into cat;
    insert into pos_menu_items (hotel_id, category_id, name, price) values (r, cat, 'Dal', 180) returning id into item;
    insert into pos_item_variations (hotel_id, item_id, label, price) values (r, item, 'Full', 220);
    insert into pos_addon_groups (hotel_id, label) values (r, 'Extras') returning id into grp;
    insert into pos_addons (hotel_id, group_id, label, price) values (r, grp, 'Ghee', 20);
    insert into pos_item_addon_groups (item_id, group_id) values (item, grp);
    insert into pos_numbered_addons (hotel_id, number, name, price) values (r, 1, 'Raita', 60);
    select id into loc from locations where hotel_id = r order by name limit 1;
    insert into stock_items (hotel_id, name, unit) values (r, 'Rice', 'kg') returning id into si;
    insert into stock_levels (hotel_id, item_id, location_id, reorder_level) values (r, si, loc, 10);
    insert into suppliers (hotel_id, name) values (r, 'Grain Co');
    insert into equipment_categories (hotel_id, name) values (r, 'Kitchen kit');
    insert into spa_treatments (hotel_id, name, minutes) values (r, 'Massage', 60);
    insert into banquet_venues (hotel_id, name) values (r, 'Hall A');
    insert into channel_hotels (hotel_id, su_hotel_id) values (r, 'SU-THR');

    -- ---------- its test hotel ----------
    t := app.create_test_hotel(r);
    select code into t_code from hotels where id = t;
    select * into j from (select to_jsonb(h) from hotels h where h.id = t) x;
    res := res || jsonb_build_object('n', 'a test hotel is "<name> · TEST", "T<CODE>" (D27-320), the real one''s, with no tax numbers',
      'ok', j ->> 'name' = 'Test Hotels Real · TEST' and t_code = 'TTHR'
            and (j ->> 'test_of')::uuid = r and j ->> 'gstin' is null,
      'd', concat_ws(' ', j ->> 'name', t_code, j ->> 'gstin'));
    res := res || jsonb_build_object('n', 'it takes the real hotel''s house settings',
      'ok', (j ->> 'check_in_time') = '13:00:00' and (j ->> 'early_checkin_charge')::numeric = 750,
      'd', concat_ws(' ', j ->> 'check_in_time', j ->> 'early_checkin_charge'));
    v := test.th_err(format('select app.create_test_hotel(%L)', r));
    res := res || jsonb_build_object('n', 'one test hotel per real hotel', 'ok', v like '%already has a test hotel%', 'd', v);
    v := test.th_err(format('insert into hotels (code, name, city, test_of) values (''THRX'', ''TH twin'', ''Nowhere'', %L)', r));
    res := res || jsonb_build_object('n', 'and the database holds it: a second row naming the same real hotel is refused',
      'ok', v like '23505%hotels_one_test_each%', 'd', v);
    v := test.th_err(format('select app.create_test_hotel(%L)', t));
    res := res || jsonb_build_object('n', 'a test hotel has no test hotel of its own', 'ok', v like '%no test hotel of its own%', 'd', v);
    v := test.th_err(format('update hotels set gstin = %L where id = %L', '27AAAAA0000A1Z5', t));
    res := res || jsonb_build_object('n', 'a test hotel never takes a GSTIN', 'ok', v like '23514%', 'd', v);
    v := test.th_err(format('update hotels set test_of = null where id = %L', t));
    res := res || jsonb_build_object('n', 'a test hotel never becomes real', 'ok', v like '%never changes%', 'd', v);
    v := test.th_err(format('update hotels set test_of = %L where id = (select id from hotels where code = ''PUN'')', r));
    res := res || jsonb_build_object('n', 'and a real one never becomes a test hotel', 'ok', v like '%never changes%', 'd', v);

    -- ---------- the copy: every setup table, row for row, keys remapped ----------
    v := null;
    for tbl in select c.table_name from app.test_hotel_classes() c where c.class = 'setup' loop
      if exists (select 1 from pg_attribute where attrelid = ('public.' || tbl.table_name)::regclass
                   and attname = 'hotel_id') then
        execute format('select count(*) from public.%I where hotel_id = $1', tbl.table_name) into n using r;
        execute format('select count(*) from public.%I where hotel_id = $1', tbl.table_name) into m using t;
        if tbl.table_name = 'hotel_modules' then n := n - 1; end if;   -- loyalty is not copied
        if n <> m then v := concat_ws(', ', v, tbl.table_name || ' ' || n || '/' || m); end if;
      end if;
    end loop;
    select count(*) into n from pos_item_addon_groups x join pos_menu_items i on i.id = x.item_id where i.hotel_id = t;
    if n <> 1 then v := concat_ws(', ', v, 'pos_item_addon_groups ' || n); end if;
    res := res || jsonb_build_object('n', 'every setup table is copied row for row', 'ok', v is null, 'd', coalesce(v, '-'));

    -- Every key in a copied row points at a row of the TEST hotel, never the real one.
    v := null;
    for tbl in
      select ch.relname as child, a.attname as col, pa.relname as parent
        from pg_constraint k
        join pg_class ch on ch.oid = k.conrelid
        join pg_class pa on pa.oid = k.confrelid
        join pg_attribute a on a.attrelid = ch.oid and a.attnum = k.conkey[array_position(k.confkey,
               (select attnum from pg_attribute where attrelid = pa.oid and attname = 'id'))]
        join app.test_hotel_classes() cc on cc.table_name = ch.relname and cc.class = 'setup'
        join app.test_hotel_classes() pc on pc.table_name = pa.relname and pc.class = 'setup'
       where k.contype = 'f'
         and exists (select 1 from pg_attribute h where h.attrelid = ch.oid and h.attname = 'hotel_id')
         and exists (select 1 from pg_attribute h where h.attrelid = pa.oid and h.attname = 'hotel_id')
    loop
      execute format('select count(*) from public.%I c join public.%I p on p.id = c.%I '
                     'where c.hotel_id = $1 and p.hotel_id <> $1', tbl.child, tbl.parent, tbl.col)
         into n using t;
      if n > 0 then v := concat_ws(', ', v, tbl.child || '.' || tbl.col || ' ' || n); end if;
    end loop;
    res := res || jsonb_build_object('n', 'every copied key points at the test hotel''s own copy',
      'ok', v is null, 'd', coalesce(v, '-'));

    select id into t101 from rooms where hotel_id = t and number = '101';
    select id into t102 from rooms where hotel_id = t and number = '102';
    res := res || jsonb_build_object('n', 'a room pointing at its own table is remapped too (connecting rooms)',
      'ok', (select connected_room_id from rooms where id = t101) = t102
            and (select connected_room_id from rooms where id = t102) = t101,
      'd', coalesce((select connected_room_id::text from rooms where id = t101), 'null'));
    res := res || jsonb_build_object('n', 'every room starts empty and clean',
      'ok', not exists (select 1 from rooms where hotel_id = t
                          and (occupancy_status <> 'vacant' or housekeeping_status <> 'clean')));
    select id into t_outlet from pos_outlets where hotel_id = t;
    res := res || jsonb_build_object('n', 'an outside till''s key and a KOT computer are never copied',
      'ok', (select api_key_hash is null and kot_station_device is null from pos_outlets where id = t_outlet)
            and not exists (select 1 from pos_kot_stations where hotel_id = t)
            and not exists (select 1 from pos_kot_kinds where hotel_id = t and station_id is not null));
    res := res || jsonb_build_object('n', 'nor SU''s connection',
      'ok', not exists (select 1 from channel_hotels where hotel_id = t));
    res := res || jsonb_build_object('n', 'loyalty is off in a test hotel, on in the real one',
      'ok', not app.module_enabled(t, 'loyalty') and app.module_enabled(r, 'loyalty')
            and app.module_enabled(t, 'banquet'));
    res := res || jsonb_build_object('n', 'it numbers its own documents, from one',
      'ok', exists (select 1 from invoice_series where hotel_id = t and prefix = 'TTHR' and next_number = 1));
    res := res || jsonb_build_object('n', 'the audit names who made it',
      'ok', exists (select 1 from audit_log where hotel_id = t and action = 'TEST_CREATE' and actor = owner));

    -- ---------- people ----------
    insert into staff (email, full_name, test_only) values ('th-tester@fidato.in', 'TH Tester', true)
    on conflict (email) do update set is_active = true returning id into tester;
    insert into staff (email, full_name) values ('th-clerk@fidato.in', 'TH Clerk')
    on conflict (email) do update set is_active = true returning id into clerk;
    insert into staff (email, full_name) values ('th-gm@fidato.in', 'TH GM')
    on conflict (email) do update set is_active = true returning id into gm;
    insert into staff (email, full_name) values ('th-mixed@fidato.in', 'TH Mixed')
    on conflict (email) do update set is_active = true returning id into mixed;
    insert into staff_hotels (staff_id, hotel_id, role) values
      (tester, t, 'gm'), (clerk, r, 'front_desk'), (gm, r, 'gm'), (mixed, r, 'front_desk'), (mixed, t, 'front_desk');

    perform set_config('app.user_id', gm::text, true);
    v := test.th_err(format('insert into staff_hotels (staff_id, hotel_id, role) values (%L, %L, ''front_desk'')', clerk, t));
    res := res || jsonb_build_object('n', 'a real hotel''s GM cannot give anybody its test hotel',
      'ok', v like '42501%Only the owner or a group administrator%', 'd', v);
    perform set_config('app.user_id', tester::text, true);
    v := test.th_err(format('delete from staff_hotels where staff_id = %L and hotel_id = %L', mixed, t));
    res := res || jsonb_build_object('n', 'nor the test hotel''s own GM take it away',
      'ok', v like '42501%', 'd', v);
    perform set_config('app.user_id', owner::text, true);
    v := test.th_err(format('insert into staff_hotels (staff_id, hotel_id, role) values (%L, %L, ''front_desk'')', tester, r));
    res := res || jsonb_build_object('n', 'a person added for testing never works at a real hotel',
      'ok', v like '%added for testing%', 'd', v);
    v := test.th_err(format('update staff set is_group_admin = true, long_password = true where id = %L', tester));
    res := res || jsonb_build_object('n', 'nor becomes a group administrator', 'ok', v like '23514%', 'd', v);
    v := test.th_err(format('update staff set test_only = true where id = %L', clerk));
    res := res || jsonb_build_object('n', 'somebody at a real hotel cannot be made test-only', 'ok', v like '%works at a real hotel%', 'd', v);

    -- ---------- the two sides ----------
    insert into guests (full_name, phone) values ('TH Real Guest', '9811100001') returning id into g1;
    insert into guest_documents (guest_id, id_type, id_number) values (g1, 'passport', 'Z1234567');
    insert into companies (name) values ('TH Real Co') returning id into c1;
    insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, company_id)
    values (r, app.next_reference(r), g1, rt, current_date + 30, current_date + 31, 3000, c1) returning id into real_res;

    -- The tester, in their test hotel, makes a guest and a company the way the desk does.
    perform set_config('app.user_id', tester::text, true);
    perform set_config('app.hotel_code', t_code, true);
    set local role pms_app;
    insert into guests (full_name, phone) values ('TH Test Guest', '9811100001') returning id into g2;
    insert into companies (name) values ('TH Test Co') returning id into c2;
    reset role;
    res := res || jsonb_build_object('n', 'a guest and a company made in a test hotel are marked with it, untold',
      'ok', (select test_hotel_id from guests where id = g2) = t and (select test_hotel_id from companies where id = c2) = t);

    -- What each person reads, where.
    for tbl in
      select * from (values
        ('the tester, in their test hotel',           'tester', 'T', false, true),
        ('the tester, naming the real hotel',         'tester', 'R', false, false),
        ('the tester, with no hotel in the address',  'tester', '',  false, false),
        ('reception at the real hotel',               'clerk',  'R', true,  false),
        ('reception at the real hotel, naming the test one', 'clerk', 'T', false, false),
        ('somebody at both, in the test hotel',       'mixed',  'T', false, true),
        ('somebody at both, at the real hotel',       'mixed',  'R', true,  false),
        ('the owner, in the test hotel',              'owner',  'T', false, true),
        ('the owner, at the real hotel',              'owner',  'R', true,  false),
        ('the owner, with no hotel in the address',   'owner',  '',  true,  false)
      ) as w(who, person, place, sees_real, sees_test)
    loop
      perform set_config('app.user_id', (case tbl.person when 'tester' then tester when 'clerk' then clerk
                                              when 'mixed' then mixed else owner end)::text, true);
      perform set_config('app.hotel_code', case tbl.place when 'T' then t_code when 'R' then 'THR' else '' end, true);
      set local role pms_app;
      ok := (exists (select 1 from guests where id = g1)) = tbl.sees_real
        and (exists (select 1 from guests where id = g2)) = tbl.sees_test
        and (exists (select 1 from companies where id = c1)) = tbl.sees_real
        and (exists (select 1 from companies where id = c2)) = tbl.sees_test
        and ((select count(*) from guest_documents where guest_id = g1) > 0) = tbl.sees_real;
      reset role;
      res := res || jsonb_build_object('n', 'reads its own side only: ' || tbl.who, 'ok', ok);
    end loop;

    -- A test-only person never reads a real guest's ID document, by any door.
    perform set_config('app.user_id', tester::text, true);
    perform set_config('app.hotel_code', t_code, true);
    set local role pms_app;
    select count(*) into n from guest_documents where guest_id = g1;
    select count(*) into m from audit_log where table_name in ('guests', 'guest_documents', 'companies')
       and row_id in (g1::text, c1::text);
    reset role;
    res := res || jsonb_build_object('n', 'a test-only person reads no real ID document, and no real guest in the audit',
      'ok', n = 0 and m = 0, 'd', n || ' documents, ' || m || ' audit rows');
    set local role pms_app;
    select count(*) into n from audit_log where row_id = g2::text;
    reset role;
    res := res || jsonb_build_object('n', 'their own test guest''s audit is filed under the test hotel, for them',
      'ok', n > 0 and exists (select 1 from audit_log where row_id = g2::text and hotel_id = t), 'd', n::text);

    -- The definer doors answer on the side in view too.
    select count(*) into n from app.guest_search('TH ') s where s.id = g1;
    select count(*) into m from app.guest_search('TH ') s where s.id = g2;
    res := res || jsonb_build_object('n', 'guest search in a test hotel finds its test guest, never the real one',
      'ok', n = 0 and m = 1, 'd', n || '/' || m);
    select count(*) into n from app.guest_suggestions('9811100001', null) s where s.guest_id = g1;
    res := res || jsonb_build_object('n', 'and the booking suggestions never offer the real guest with the same phone',
      'ok', n = 0 and exists (select 1 from app.guest_suggestions('9811100001', null) s where s.guest_id = g2));
    res := res || jsonb_build_object('n', 'Guest 360 and the loyalty card of a real guest are nothing, from a test hotel',
      'ok', app.guest_360(g1) is null and app.loyalty_card(g1) is null
            and not exists (select 1 from app.guest_cards(array[g1])));
    v := test.th_err(format('select app.guest_join(%L, %L)', g2, g1));
    res := res || jsonb_build_object('n', 'a test guest is never joined to a real one: the real one is not there',
      'ok', v = 'P0001: One of those guests does not exist.', 'd', v);
    v := test.th_err(format('insert into guest_joins (kept_id, joined_id) values (%L, %L)', g2, g1));
    res := res || jsonb_build_object('n', 'nor recorded as one, by any door', 'ok', v like '%never matched with a real one%', 'd', v);
    v := test.th_err(format('insert into guest_not_same (a, b) values (%L, %L)', least(g1, g2), greatest(g1, g2)));
    res := res || jsonb_build_object('n', 'nor as two people, either', 'ok', v like '%never matched with a real one%', 'd', v);

    perform set_config('app.user_id', gm::text, true);
    perform set_config('app.hotel_code', 'THR', true);
    select count(*) into n from app.guest_search('TH ') s where s.id = g2;
    res := res || jsonb_build_object('n', 'and guest search at the real hotel never finds the test guest',
      'ok', n = 0 and exists (select 1 from app.guest_search('TH ') s where s.id = g1));

    -- Writes: a test-only person never writes a real row, nor the group's lists.
    perform set_config('app.user_id', tester::text, true);
    perform set_config('app.hotel_code', t_code, true);
    set local role pms_app;
    v := test.th_err('insert into guests (full_name, test_hotel_id) values (''TH Sneaky'', null)');
    reset role;
    res := res || jsonb_build_object('n', 'a test-only person cannot make a real guest', 'ok', v like '42501%', 'd', v);
    set local role pms_app;
    v := test.th_err('insert into booking_sources (name, kind) values (''TH Source'', ''direct'')');
    reset role;
    res := res || jsonb_build_object('n', 'nor add to the group''s booking sources, though a GM in their test hotel',
      'ok', v like '42501%', 'd', v);
    perform set_config('app.user_id', gm::text, true);
    perform set_config('app.hotel_code', 'THR', true);
    set local role pms_app;
    v := test.th_err('insert into booking_sources (name, kind) values (''TH Source'', ''direct'')');
    reset role;
    res := res || jsonb_build_object('n', 'which a real GM still may', 'ok', v is null, 'd', v);

    -- The offer answers: one per side, a test yes never clears a real no, nor a
    -- test no a real yes. Asked as the superuser, past row security: the
    -- functions themselves keep to the side in view.
    perform set_config('app.user_id', gm::text, true);
    perform set_config('app.hotel_code', 'THR', true);
    perform app.record_no_offers('9811100001', null);
    perform app.record_offers_yes('9811100002', null);
    perform set_config('app.user_id', tester::text, true);
    perform set_config('app.hotel_code', t_code, true);
    perform app.record_no_offers('9811100002', null);
    res := res || jsonb_build_object('n', 'a "no offers" said in a test hotel never takes away a real guest''s yes',
      'ok', exists (select 1 from offer_opt_ins where value = app.phone_key('9811100002') and test_hotel_id is null)
            and exists (select 1 from offer_opt_outs where value = app.phone_key('9811100002') and test_hotel_id = t));
    perform set_config('app.user_id', tester::text, true);
    perform set_config('app.hotel_code', t_code, true);
    perform app.record_no_offers('9811100001', null);
    perform app.record_offers_yes('9811100001', null);
    res := res || jsonb_build_object('n', 'a "no offers" and a "yes" said in a test hotel never touch the real guest''s answer',
      'ok', exists (select 1 from offer_opt_outs where value = app.phone_key('9811100001') and test_hotel_id is null)
            and not exists (select 1 from offer_opt_outs where value = app.phone_key('9811100001') and test_hotel_id = t)
            and exists (select 1 from offer_opt_ins where value = app.phone_key('9811100001') and test_hotel_id = t)
            and not exists (select 1 from offer_opt_ins where value = app.phone_key('9811100001') and test_hotel_id is null));

    -- ---------- the mixing guard ----------
    perform set_config('app.user_id', owner::text, true);
    perform set_config('app.hotel_code', '', true);
    select id into rt_t from room_types where hotel_id = t and code = 'STD';
    v := test.th_err(format($q$insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate)
                               values (%L, 'TH-X1', %L, %L, current_date, current_date + 1, 100)$q$, t, g1, rt_t));
    res := res || jsonb_build_object('n', 'a test hotel never books a real guest', 'ok', v like '%works only with the guests and companies made in it%', 'd', v);
    v := test.th_err(format($q$insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate)
                               values (%L, 'TH-X2', %L, %L, current_date, current_date + 1, 100)$q$, r, g2, rt));
    res := res || jsonb_build_object('n', 'a real hotel never books a test guest', 'ok', v like '%never with ones made in a test hotel%', 'd', v);
    v := test.th_err(format('insert into folios (hotel_id, company_id) values (%L, %L)', t, c1));
    res := res || jsonb_build_object('n', 'a test bill never goes to a real company, so never counts on its credit', 'ok', v like '%works only with%', 'd', v);
    v := test.th_err(format('update reservations set company_id = %L where id = %L', c2, real_res));
    res := res || jsonb_build_object('n', 'and a real booking never takes a test company', 'ok', v like '%never with ones made in a test hotel%', 'd', v);
    v := test.th_err(format('insert into reservation_groups (name, company_id, test_hotel_id) values (''TH G'', %L, %L)', c1, t));
    res := res || jsonb_build_object('n', 'a test group never names a real company', 'ok', v like '%works only with%', 'd', v);
    v := test.th_err(format('update guests set test_hotel_id = %L where id = %L', t, g1));
    res := res || jsonb_build_object('n', 'a real guest never moves into a test hotel', 'ok', v like '%stays there%', 'd', v);

    -- ---------- nothing leaves ----------
    v := test.th_err(format('insert into channel_hotels (hotel_id, su_hotel_id) values (%L, ''SU-T'')', t));
    res := res || jsonb_build_object('n', 'SU cannot be connected to a test hotel', 'ok', v like '%nothing is sent from it%', 'd', v);
    v := test.th_err(format('insert into crs_hotels (hotel_id, crs_hotel_id, booking_source_id) select %L, ''CRS-T'', id from booking_sources limit 1', t));
    res := res || jsonb_build_object('n', 'nor the CRS', 'ok', v like '%nothing is sent from it%', 'd', v);
    v := test.th_err(format('insert into market_rate_settings (hotel_id, is_on) values (%L, true)', t));
    res := res || jsonb_build_object('n', 'nor rivals'' prices', 'ok', v like '%nothing is sent from it%', 'd', v);
    v := test.th_err(format('insert into daily_report_emails (hotel_id, report, is_on) values (%L, ''manager'', true)', t));
    res := res || jsonb_build_object('n', 'nor the daily report emails', 'ok', v like '%nothing is sent from it%', 'd', v);
    v := test.th_err(format('insert into hotel_modules (hotel_id, module, is_enabled) values (%L, ''channel_manager'', true)', t));
    res := res || jsonb_build_object('n', 'the channel manager cannot be switched on there', 'ok', v like '%cannot be switched on here%', 'd', v);
    v := test.th_err(format('insert into loyalty_members (guest_id, hotel_id, consent_words) values (%L, %L, ''x'')', g2, t));
    res := res || jsonb_build_object('n', 'nor anybody join loyalty there', 'ok', v like '%loyalty is not used here%', 'd', v);

    -- ---------- a few days of trade in the test hotel ----------
    bd := app.business_date(t);
    fy := app.current_fin_year(t);
    insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status, company_id)
    values (t, app.next_reference(t), g2, rt_t, bd - 1, bd + 1, 3000, 'checked_in', c2) returning id into stay;
    insert into folios (hotel_id, reservation_id) values (t, stay) returning id into fol;
    insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount, tax_rate, tax_amount)
    values (t, fol, bd - 1, 'room', 'Room 101 · 1 night', 3000, 12, 360);
    -- the day closed behind it
    insert into night_audit_runs (hotel_id, business_date, status, completed_at)
    values (t, bd - 1, 'completed', now());
    insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount)
    values (t, fol, bd, 'payment', 'Cash', -3360) returning id into pid;
    insert into payments (hotel_id, posting_id, method, amount) values (t, pid, 'cash', 3360);
    insert into invoices (hotel_id, folio_id, fin_year, number, recipient_name, total, tax_total)
    values (t, fol, fy, app.next_invoice_number(t, fy), 'TH Test Guest', 3360, 360) returning id into inv;
    insert into key_cards (hotel_id, reservation_id, room_id, act, cards, valid_until, why, outcome, driver)
    values (t, stay, t101, 'issue', 2, now() + interval '1 day', 'check_in', 'done', 'stand-in');
    insert into company_payments (hotel_id, company_id, amount, received_on, method, recorded_by)
    values (t, c2, 1000, bd, 'upi', owner);
    select id into t_item from pos_menu_items where hotel_id = t;
    select id into t_var from pos_item_variations where item_id = t_item;
    insert into pos_orders (hotel_id, outlet_id, order_no, business_date, opened_by)
    values (t, t_outlet, app.pos_next_order_no(t, bd), bd, owner) returning id into ord;
    insert into pos_order_lines (order_id, hotel_id, item_id, variation_id, name, qty, unit_price, tax_rate, added_by)
    values (ord, t, t_item, t_var, 'Dal', 1, 180, 5, owner) returning id into line;
    insert into pos_order_lines (order_id, hotel_id, item_id, variation_id, name, qty, unit_price, tax_rate, added_by,
                                 voided, voided_by, voided_at)
    values (ord, t, t_item, t_var, 'Dal', 2, 180, 5, owner, true, owner, now()) returning id into struck;
    insert into pos_line_events (hotel_id, line_id, order_id, status, by_staff)
    values (t, line, ord, 'sent', owner);
    insert into pos_order_tenders (order_id, hotel_id, method, amount, taken_by)
    values (ord, t, 'cash', 189, owner);
    update pos_orders set status = 'settled', settled_by = owner, settled_at = now(), payment_method = 'cash'
     where id = ord;
    select id into t_loc from locations where hotel_id = t order by name limit 1;
    select id into t_si from stock_items where hotel_id = t;
    insert into stock_movements (hotel_id, item_id, business_date, kind, quantity, location_id, moved_by)
    values (t, t_si, bd, 'receipt', 25, t_loc, owner);
    update rooms set occupancy_status = 'occupied', housekeeping_status = 'dirty' where id = t101;

    -- The guards stand for anybody, at any hotel, outside a reset.
    v := test.th_err(format('delete from folio_postings where hotel_id = %L', t));
    res := res || jsonb_build_object('n', 'outside a reset a test hotel''s ledger is append-only like any', 'ok', v like '%append-only%', 'd', v);
    perform set_config('app.test_reset', r::text, true);
    v := test.th_err(format('delete from folio_postings where hotel_id = %L', r));
    perform set_config('app.test_reset', '', true);
    insert into folios (hotel_id, reservation_id) values (r, real_res) returning id into fol;
    insert into folio_postings (hotel_id, folio_id, business_date, category, description, amount)
    values (r, fol, app.business_date(r), 'misc', 'TH real charge', 100);
    perform set_config('app.test_reset', r::text, true);
    v := test.th_err(format('delete from folio_postings where hotel_id = %L', r));
    perform set_config('app.test_reset', '', true);
    res := res || jsonb_build_object('n', 'the reset''s setting never lets a real hotel''s row through, whoever sets it',
      'ok', v like '%append-only%', 'd', v);
    perform set_config('app.test_reset', t::text, true);
    v := test.th_err(format('delete from folio_postings where hotel_id = %L', r));
    perform set_config('app.test_reset', '', true);
    res := res || jsonb_build_object('n', 'not even while a test hotel is being reset', 'ok', v like '%append-only%', 'd', v);
    v := test.th_err(format('select app.test_hotel_clear(%L, ''trading'')', t));
    res := res || jsonb_build_object('n', 'nothing clears a test hotel but its reset', 'ok', v like '42501%', 'd', v);

    -- ---------- who may reset, and what ----------
    perform set_config('app.user_id', tester::text, true);
    v := test.th_err(format('select app.reset_test_hotel(%L)', t));
    res := res || jsonb_build_object('n', 'a tester cannot reset, not even their own test hotel''s GM', 'ok', v like '42501%', 'd', v);
    perform set_config('app.user_id', owner::text, true);
    v := test.th_err(format('select app.reset_test_hotel(%L)', r));
    res := res || jsonb_build_object('n', 'a real hotel is never reset', 'ok', v like '%Only a test hotel is reset%', 'd', v);

    select jsonb_object_agg(c.table_name, (xpath('/row/n/text()',
             query_to_xml(format('select count(*) as n from public.%I where hotel_id = %L', c.table_name, t),
                          false, true, '')))[1]::text)
      into setup_before
      from app.test_hotel_classes() c
     where c.class = 'setup'
       and exists (select 1 from pg_attribute where attrelid = ('public.' || c.table_name)::regclass and attname = 'hotel_id');

    select max(id) into m from audit_log;
    removed := app.reset_test_hotel(t);
    res := res || jsonb_build_object('n', 'the reset says how many rows went', 'ok', removed >= 15, 'd', removed::text);

    v := null;
    for tbl in select c.table_name from app.test_hotel_classes() c where c.class = 'trading'
                 and exists (select 1 from pg_attribute where attrelid = ('public.' || c.table_name)::regclass and attname = 'hotel_id') loop
      execute format('select count(*) from public.%I where hotel_id = $1', tbl.table_name) into n using t;
      if n > 0 then v := concat_ws(', ', v, tbl.table_name || ' ' || n); end if;
    end loop;
    res := res || jsonb_build_object('n', 'after a reset no test activity is left - a paid bill, a closed day, an invoice, key cards and a struck KOT line included',
      'ok', v is null, 'd', coalesce(v, '-'));
    res := res || jsonb_build_object('n', 'its test guests and companies are gone',
      'ok', not exists (select 1 from guests where test_hotel_id = t) and not exists (select 1 from companies where test_hotel_id = t)
            and not exists (select 1 from offer_opt_ins where test_hotel_id = t));
    res := res || jsonb_build_object('n', 'and nothing real went with them',
      'ok', exists (select 1 from guests where id = g1) and exists (select 1 from guest_documents where guest_id = g1)
            and exists (select 1 from companies where id = c1) and exists (select 1 from reservations where id = real_res)
            and exists (select 1 from offer_opt_outs where value = app.phone_key('9811100001') and test_hotel_id is null)
            and exists (select 1 from folio_postings where hotel_id = r and description = 'TH real charge'));
    v := null;
    for tbl in select key, value from jsonb_each_text(setup_before) loop
      execute format('select count(*) from public.%I where hotel_id = $1', tbl.key) into n using t;
      if n::text <> tbl.value then v := concat_ws(', ', v, tbl.key || ' ' || tbl.value || '->' || n); end if;
    end loop;
    res := res || jsonb_build_object('n', 'the setup stays as it was', 'ok', v is null, 'd', coalesce(v, '-'));
    res := res || jsonb_build_object('n', 'and the testers stay',
      'ok', exists (select 1 from staff_hotels where staff_id = tester and hotel_id = t)
            and exists (select 1 from staff_hotels where staff_id = mixed and hotel_id = t));
    res := res || jsonb_build_object('n', 'rooms empty and clean, on today, numbering from the start',
      'ok', not exists (select 1 from rooms where hotel_id = t and (occupancy_status <> 'vacant' or housekeeping_status <> 'clean'))
            and (select business_date from hotels where id = t) = (now() at time zone (select timezone from hotels where id = t))::date
            and (select next_number from invoice_series where hotel_id = t and fin_year = fy) = 1);
    res := res || jsonb_build_object('n', 'one audit entry for the reset, naming who - and not one per row',
      'ok', (select count(*) from audit_log where hotel_id = t and action = 'TEST_RESET' and actor = owner) = 1
            and (select count(*) from audit_log where hotel_id = t and id > m) = 1,
      'd', (select string_agg(table_name || ' ' || action, ', ') from audit_log where hotel_id = t and id > m));
    res := res || jsonb_build_object('n', 'and its next tax invoice is number one of its own series',
      'ok', app.next_invoice_number(t, fy) like 'TTHR/%/00001');

    -- ---------- re-copy ----------
    insert into room_types (hotel_id, code, name) values (r, 'THS', 'TH Suite');
    update hotels set check_out_time = '10:30' where id = r;
    update rooms set connected_room_id = null where id = t101;
    delete from rooms where id = t102;
    j := app.recopy_test_hotel(t);
    res := res || jsonb_build_object('n', 're-copy brings the real hotel''s setup as it is now',
      'ok', exists (select 1 from room_types where hotel_id = t and code = 'THS')
            and (select count(*) from rooms where hotel_id = t) = 2
            and (select check_out_time from hotels where id = t) = '10:30',
      'd', j::text);
    res := res || jsonb_build_object('n', 're-copy keeps the testers and says what it did',
      'ok', exists (select 1 from staff_hotels where staff_id = tester and hotel_id = t)
            and (j ->> 'copied')::int > 0 and (j ->> 'removed') is not null
            and exists (select 1 from audit_log where hotel_id = t and action = 'TEST_RECOPY' and actor = owner));
    v := null;
    for tbl in select c.table_name from app.test_hotel_classes() c where c.class = 'setup' loop
      if exists (select 1 from pg_attribute where attrelid = ('public.' || tbl.table_name)::regclass and attname = 'hotel_id') then
        execute format('select count(*) from public.%I where hotel_id = $1', tbl.table_name) into n using r;
        execute format('select count(*) from public.%I where hotel_id = $1', tbl.table_name) into m using t;
        if tbl.table_name = 'hotel_modules' then n := n - 1; end if;
        if n <> m then v := concat_ws(', ', v, tbl.table_name || ' ' || n || '/' || m); end if;
      end if;
    end loop;
    res := res || jsonb_build_object('n', 'after a re-copy every setup table matches the real hotel again', 'ok', v is null, 'd', coalesce(v, '-'));
    perform set_config('app.user_id', clerk::text, true);
    v := test.th_err(format('select app.recopy_test_hotel(%L)', t));
    res := res || jsonb_build_object('n', 'only the owner or a group administrator re-copies', 'ok', v like '42501%', 'd', v);

    -- ---------- its code: "T" + the real code, the first free one (D27-320) ----------
    perform set_config('app.user_id', owner::text, true);
    t_new := app.create_test_hotel(app.provision_property_unchecked('SHI', 'Test Hotels Shirdi', 'Nowhere'));
    v := (select code from hotels where id = t_new);
    res := res || jsonb_build_object('n', 'a test hotel''s code is "T" + the real code: SHI''s is TSHI, never SHIT',
      'ok', v = 'TSHI', 'd', v);
    perform app.provision_property_unchecked('TAMR', 'Test Hotels Taken', 'Nowhere');
    t_new := app.create_test_hotel(app.provision_property_unchecked('AMR', 'Test Hotels Amr', 'Nowhere'));
    v := (select code from hotels where id = t_new);
    res := res || jsonb_build_object('n', 'a "T" + code already taken (a real TAMR) gives the first free number: TAMR2',
      'ok', v = 'TAMR2', 'd', v);

    raise exception using errcode = 'TH001', message = 'undo';
  exception when sqlstate 'TH001' then
    null;
  end;

  insert into test.results (suite, name, passed, detail)
  select 'test hotels', x ->> 'n', coalesce((x ->> 'ok')::boolean, false), x ->> 'd'
    from jsonb_array_elements(res) x;
end $$;

select set_config('app.user_id', '', false);
select set_config('app.hotel_code', '', false);
revoke execute on function test.th_err(text) from pms_app;
revoke usage on schema test from pms_app;
