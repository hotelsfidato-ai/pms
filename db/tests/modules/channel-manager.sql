-- =============================================================================
-- CHANNEL MANAGER — the SU mapping (the Su channel manager, D17-66)
-- =============================================================================
-- Refers to its migration by what it does, "the SU mapping", never by number.
--
-- Builds two properties of its own and removes them. Runs as the superuser,
-- like every file here: what the APPLICATION may do is checked through its
-- grants, and row isolation through ENABLE and FORCE. Who may send to SU is
-- the API's (api/test/modules/channel-manager/).
--
--   1. nothing is connected by default: a new property has no SU rows;
--   2. SU's id rules are the database's, not only the screen's: at most 20
--      letters, digits and hyphens;
--   3. one SU hotel id per group and one SU room or rate plan id per hotel,
--      whatever the case — SU treats "dlx" and "DLX" as one room;
--   4. a room type can only be mapped at its own property;
--   5. the application may read, add and change, never delete: a room type
--      once on SU is taken off, not forgotten, so its id is never reused;
--   6. every write is audited.
-- =============================================================================
do $$
declare
  h uuid; other uuid; dlx uuid; dlx_other uuid; n int;
begin
  h     := app.provision_property_unchecked('CMQ', 'Channel Test', 'Nowhere');
  other := app.provision_property_unchecked('CMR', 'Channel Other', 'Nowhere');
  select id into dlx       from room_types where hotel_id = h     and code = 'DLX';
  select id into dlx_other from room_types where hotel_id = other and code = 'DLX';
  perform test.ok('su mapping', 'the fixture has a room type at each property',
    dlx is not null and dlx_other is not null);

  -- ---------- 1 · nothing connected by default ----------
  select (select count(*) from channel_hotels     where hotel_id in (h, other))
       + (select count(*) from channel_room_types where hotel_id in (h, other))
       + (select count(*) from channel_rate_plans where hotel_id in (h, other))
    into n;
  perform test.ok('su mapping', 'a new property has no SU hotel, room type or rate plan', n = 0, n || ' arrived');
  perform test.ok('su mapping', 'no property is switched on for the channel manager by default',
    not app.module_enabled(h, 'channel_manager'));

  -- ---------- 2 · SU's id rules ----------
  perform test.allows('su mapping', 'an SU hotel id of letters, digits and a hyphen',
    format($q$insert into channel_hotels (hotel_id, su_hotel_id) values (%L, 'CMQ-1')$q$, h));
  perform test.raises('su mapping', 'an SU hotel id with a space is refused',
    format($q$insert into channel_hotels (hotel_id, su_hotel_id) values (%L, 'CM R')$q$, other), '23514');
  perform test.raises('su mapping', 'an SU hotel id over 20 characters is refused',
    format($q$insert into channel_hotels (hotel_id, su_hotel_id) values (%L, 'ABCDEFGHIJKLMNOPQRSTU')$q$, other), '23514');
  perform test.raises('su mapping', 'a country that is not two capital letters is refused',
    format($q$update channel_hotels set country_code = 'India' where hotel_id = %L$q$, h), '23514');
  perform test.raises('su mapping', 'a latitude past 90 is refused',
    format($q$update channel_hotels set latitude = 91 where hotel_id = %L$q$, h), '23514');
  perform test.raises('su mapping', 'children below zero are refused',
    format($q$insert into channel_room_types (room_type_id, hotel_id, su_room_id, su_room_type, max_children)
              values (%L, %L, 'DLX', 7, -1)$q$, dlx, h), '23514');

  -- ---------- 3 · one id, whatever the case ----------
  perform test.raises('su mapping', 'another property cannot take the same SU hotel id in lower case',
    format($q$insert into channel_hotels (hotel_id, su_hotel_id) values (%L, 'cmq-1')$q$, other), '23505');

  perform test.allows('su mapping', 'a room type mapped at its own property',
    format($q$insert into channel_room_types (room_type_id, hotel_id, su_room_id, su_room_type, max_children)
              values (%L, %L, 'DLX', 7, 2)$q$, dlx, h));
  perform test.allows('su mapping', 'the same SU room id at another property is a different room',
    format($q$insert into channel_room_types (room_type_id, hotel_id, su_room_id, su_room_type, max_children)
              values (%L, %L, 'DLX', 7, 2)$q$, dlx_other, other));

  perform test.allows('su mapping', 'a meal plan as a rate plan',
    format($q$insert into channel_rate_plans (hotel_id, meal_plan, su_rate_plan_id, su_meal_plan)
              values (%L, 'EP', 'EP', 15)$q$, h));
  perform test.raises('su mapping', 'a second rate plan cannot take "ep" at the same property',
    format($q$insert into channel_rate_plans (hotel_id, meal_plan, su_rate_plan_id, su_meal_plan)
              values (%L, 'CP', 'ep', 2)$q$, h), '23505');
  perform test.raises('su mapping', 'SU state is only active or deactivated',
    format($q$update channel_rate_plans set on_su = 'pending' where hotel_id = %L$q$, h), '23514');

  -- ---------- 4 · a room type only at its own property ----------
  delete from channel_room_types where room_type_id = dlx_other;
  perform test.raises('su mapping', 'a room type cannot be mapped under another property',
    format($q$insert into channel_room_types (room_type_id, hotel_id, su_room_id, su_room_type, max_children)
              values (%L, %L, 'DLX2', 7, 2)$q$, dlx_other, h), '23503');

  -- ---------- 5 · read, add, change; never delete ----------
  perform test.ok('su mapping', 'every SU table has row security on and forced',
    (select bool_and(c.relrowsecurity and c.relforcerowsecurity) from pg_class c
      where c.relname in ('channel_hotels', 'channel_room_types', 'channel_rate_plans')
        and c.relkind = 'r'));
  perform test.ok('su mapping', 'the application may read, add and change the SU tables',
    has_table_privilege('pms_app', 'channel_hotels', 'select, insert, update')
    and has_table_privilege('pms_app', 'channel_room_types', 'select, insert, update')
    and has_table_privilege('pms_app', 'channel_rate_plans', 'select, insert, update'));
  perform test.ok('su mapping', 'the application may not delete from the SU tables',
    not has_table_privilege('pms_app', 'channel_hotels', 'delete')
    and not has_table_privilege('pms_app', 'channel_room_types', 'delete')
    and not has_table_privilege('pms_app', 'channel_rate_plans', 'delete'));

  -- ---------- 6 · audited ----------
  select count(*) into n from audit_log
   where table_name in ('channel_hotels', 'channel_room_types', 'channel_rate_plans')
     and hotel_id = h;
  perform test.ok('su mapping', 'the SU writes at the test property are in the audit log', n >= 3, n || ' entries');

  -- ---------- and the fixtures go ----------
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;

  select (select count(*) from hotels where code in ('CMQ', 'CMR'))
       + (select count(*) from channel_hotels where hotel_id in (h, other))
    into n;
  perform test.ok('su mapping', 'the fixtures and their SU rows do not outlive the test', n = 0, n || ' left behind');
end $$;
