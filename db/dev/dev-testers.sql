-- =============================================================================
-- dev-testers.sql — a General Manager and a Reception clerk at 5EL,
--                   for LOCAL TESTING ONLY
-- =============================================================================
-- ⚠ NOT A MIGRATION, AND IT MUST NEVER BECOME ONE. Same reasons as
-- dev-identities.sql beside it: these are sign-ins with no password, usable
-- only through the API's ALLOW_DEV_AUTH header, which the API refuses to
-- start with under NODE_ENV=production.
--
-- Asked for on 14 September: "a bypass login for testing, with a switcher
-- between the property and the GM of the hotel, so I can see both views".
-- The owner already had one (dev-owner, a group administrator). These two
-- are ordinary property staff, so the GM's view and the desk's view can be
-- tested as themselves — every permission still comes from staff_hotels,
-- exactly as for a real person. Nothing here overrides a role.
--
-- Kept out of dev-identities.sql on purpose: that file also seeds every
-- API test database, and two more staff there would change what those
-- tests count. This one is for the local `fidato` database only, and needs
-- the demo property to exist:
--
--   cd "D:\fidato pms\api" && npm run load-demo        (5EL, if not there)
--   psql -h 127.0.0.1 -p 55432 -U postgres -d fidato -f db/dev/dev-testers.sql
--
-- Re-runnable: a second run changes nothing.
-- =============================================================================

do $$
declare
  v_hotel uuid;
  v_gm    uuid;
  v_desk  uuid;
begin
  select id into v_hotel from hotels where code = '5EL';
  if v_hotel is null then
    raise notice 'dev-testers: there is no 5EL here — run load-demo first. Nothing done.';
    return;
  end if;

  insert into staff (email, full_name, is_group_admin, is_active, firebase_uid)
  values ('gm@fidato.in', 'Test GM', false, true, 'dev-gm')
  on conflict (email) do update
     set firebase_uid = excluded.firebase_uid, is_active = true
  returning id into v_gm;

  insert into staff (email, full_name, is_group_admin, is_active, firebase_uid)
  values ('desk@fidato.in', 'Test Reception', false, true, 'dev-desk')
  on conflict (email) do update
     set firebase_uid = excluded.firebase_uid, is_active = true
  returning id into v_desk;

  insert into staff_hotels (staff_id, hotel_id, role) values (v_gm, v_hotel, 'gm')
  on conflict (staff_id, hotel_id) do update set role = excluded.role;
  insert into staff_hotels (staff_id, hotel_id, role) values (v_desk, v_hotel, 'front_desk')
  on conflict (staff_id, hotel_id) do update set role = excluded.role;

  raise notice 'dev-testers: Test GM (gm at 5EL) and Test Reception (front desk at 5EL) are ready.';
end $$;

-- -----------------------------------------------------------------------------
-- One tester per role, for the owner's QA (18 September)
-- -----------------------------------------------------------------------------
-- The owner asked for "one test account per role" before testing. A screen is
-- only proved by the person who actually holds it: housekeeping sees no
-- revenue, the Inventory Manager sees the store, the accountant sees the money.
--
-- Same shape as the GM and the desk above: an ordinary staff row rostered at
-- 5EL, with the role deciding everything. Nothing here overrides a permission.
-- Re-runnable: a second run changes nothing.
-- -----------------------------------------------------------------------------
do $$
declare
  v_hotel uuid;
  v_staff uuid;
  r record;
begin
  select id into v_hotel from hotels where code = '5EL';
  if v_hotel is null then
    raise notice 'dev-testers: there is no 5EL here - run load-demo first. Nothing done.';
    return;
  end if;

  for r in
    select * from (values
      ('dev-admin',          'admin',           'Test Admin',            true),
      ('dev-hotel-manager',  'hotel_manager',   'Test Hotel Manager',    false),
      ('dev-revenue',        'revenue_manager', 'Test Revenue Manager',  false),
      ('dev-housekeeping',   'housekeeping',    'Test Housekeeper',      false),
      ('dev-stores',         'stores',          'Test Inventory Manager', false),
      ('dev-kitchen',        'kitchen_manager', 'Test Kitchen Manager',  false),
      ('dev-chef',           'chef',            'Test Chef',             false),
      ('dev-finance',        'finance',         'Test Accountant',       false)
    ) as t(uid, role, full_name, group_admin)
  loop
    insert into staff (email, full_name, is_group_admin, is_active, firebase_uid)
    values (r.uid || '@fidato.in', r.full_name, r.group_admin, true, r.uid)
    on conflict (email) do update
      set full_name      = excluded.full_name,
          is_group_admin = excluded.is_group_admin,
          is_active      = true,
          firebase_uid   = excluded.firebase_uid
    returning id into v_staff;

    /* The roster, not the role on the staff row: every permission in this
       system comes from staff_hotels, and an administrator is a group
       administrator rather than somebody rostered everywhere. */
    if not r.group_admin then
      insert into staff_hotels (staff_id, hotel_id, role)
      values (v_staff, v_hotel, r.role)
      on conflict (staff_id, hotel_id) do update set role = excluded.role;
    end if;
  end loop;

  raise notice 'dev-testers: one sign-in per role at 5EL';
end $$;
