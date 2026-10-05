-- =============================================================================
-- SHARED — tables no single service owns
-- =============================================================================
-- One file per service lives beside this one. These tables are used by several
-- services at once and were built by the master chat, so their checks are here
-- rather than in any one service's file (docs/STOCK-AND-EQUIPMENT-PLAN.md § 2).
-- Builds its own property and removes it.
-- =============================================================================


-- =============================================================================
-- SUPPLIERS AND LOCATIONS (094)
-- =============================================================================
do $$
declare
  h uuid; other uuid; n int;
begin
  h     := app.provision_property_unchecked('SUP','Suppliers Test','Nowhere');
  other := app.provision_property_unchecked('SUQ','Suppliers Other','Nowhere');

  -- ---------- nothing ships ----------
  select count(*) into n from suppliers where hotel_id = h;
  perform test.ok('suppliers and locations','a new property has no suppliers', n = 0, n || ' arrived');
  /* Until 17 September a new property had no places at all. The owner's D17-3:
     a Main, Kitchen and Bar store at every hotel (migration 104) — and nothing
     else is invented. */
  select count(*) into n from locations where hotel_id = h;
  perform test.ok('suppliers and locations',
    'a new property gets a Main, Kitchen and Bar store, and no other place', n = 3, n || ' arrived');
  perform test.ok('suppliers and locations','all three are stores, by the owner''s names',
    (select array_agg(name order by name) from locations where hotel_id = h and kind = 'store')
      = array['Bar store', 'Kitchen store', 'Main store']);

  -- ---------- a supplier ----------
  insert into suppliers (hotel_id, name, phone, gstin)
  values (h, 'Akkalkot Oil Traders', '+91 00000 00000', '27ABCDE1234F1Z5');
  perform test.ok('suppliers and locations','a supplier with a valid GSTIN is accepted',
    (select count(*) from suppliers where hotel_id = h) = 1);

  perform test.raises('suppliers and locations','a malformed GSTIN is refused',
    format($q$insert into suppliers (hotel_id, name, gstin)
              values (%L, 'Wrong GST Co', 'NOT-A-GSTIN')$q$, h), '23514');

  perform test.raises('suppliers and locations','a supplier with no name is refused',
    format($q$insert into suppliers (hotel_id, name) values (%L, '   ')$q$, h), '23514');

  perform test.raises('suppliers and locations','the same supplier twice at one property is refused',
    format($q$insert into suppliers (hotel_id, name) values (%L, 'Akkalkot Oil Traders')$q$, h),
    '23505');

  insert into suppliers (hotel_id, name) values (other, 'Akkalkot Oil Traders');
  perform test.ok('suppliers and locations','the same name at ANOTHER property is its own supplier',
    (select count(*) from suppliers where name = 'Akkalkot Oil Traders' and hotel_id in (h, other)) = 2);

  -- ---------- locations ----------
  insert into locations (hotel_id, name, kind) values
    (h, 'Back office', 'office'), (h, 'Lobby', 'public_area');
  perform test.ok('suppliers and locations','places of each kind can be added beside the three stores',
    (select count(*) from locations where hotel_id = h) = 5);

  -- ---------- the three stores are never brought back (104, replayed) ----------
  update locations set name = 'Main godown' where hotel_id = h and name = 'Main store';
  update locations set is_active = false where hotel_id = h and name = 'Bar store';
  perform test.ok('suppliers and locations',
    'a replay adds nothing to a hotel that renamed one store and switched one off',
    app.default_stores(h) = 0 and (select count(*) from locations where hotel_id = h) = 5);

  perform test.raises('suppliers and locations','a kind the hotel does not have is refused',
    format($q$insert into locations (hotel_id, name, kind) values (%L, 'Garage', 'car_park')$q$, h),
    '23514');

  perform test.raises('suppliers and locations','two places with one name at a property are refused',
    format($q$insert into locations (hotel_id, name, kind) values (%L, 'Lobby', 'office')$q$, h),
    '23505');

  -- ---------- neither can be deleted by the application ----------
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'pms_app' and table_name in ('suppliers', 'locations')
     and privilege_type = 'DELETE';
  perform test.ok('suppliers and locations',
    'the application cannot delete a supplier or a place — it switches them off', n = 0,
    n || ' delete grants');

  -- ---------- and the fixtures go ----------
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;

  select count(*) into n from hotels where code in ('SUP', 'SUQ');
  perform test.ok('suppliers and locations','the fixtures do not outlive the test', n = 0,
    n || ' left behind');
end $$;


-- =============================================================================
-- EQUIPMENT LEAVING THE STORE (095) — the owner's S12 to S15, 16 September
-- =============================================================================
-- Who may decide is checked by the API (api/test/equipmentApproval.test.ts),
-- as it is for every approval. What is proved here is the data it decides on:
-- the rule exists at every property, new ones included, and the request
-- freezes the first approver AND the backups.
do $$
declare
  h uuid; asker uuid; other uuid; a uuid; p uuid; n int;
begin
  select id into asker from staff where email = 'agra@fidato.in';
  select id into other from staff where email = 'owner@fidato.in';

  h := app.provision_property_unchecked('EQA','Equipment Approval Test','Nowhere');

  -- ---------- the rule, everywhere ----------
  select count(*) into n from approval_rules
   where hotel_id = h and kind = 'equipment_issue' and approver_role = 'stores'
     and over_amount is null and is_active
     and also_decided_by = array['owner', 'admin', 'gm'];
  perform test.ok('equipment approvals',
    'a property created today gets the rule: the Inventory Manager, the owner, admin and GM behind them',
    n = 1, n || ' matching rules');

  select count(*) into n from hotels x
   where x.code not in ('AGR')   -- the API approvals test clears Agra's rules for itself
     and not exists (select 1 from approval_rules r
                      where r.hotel_id = x.id and r.kind = 'equipment_issue'
                        and r.approver_role = 'stores');
  perform test.ok('equipment approvals','every property has the rule', n = 0, n || ' without it');

  -- ---------- a request freezes who decides, and who may instead ----------
  a := app.request_approval(h, 'equipment_issue', 'equipment_moves',
         gen_random_uuid(), 'A kettle for room 104', null, asker);
  perform test.ok('equipment approvals','taking equipment out of the store raises a request', a is not null);
  perform test.ok('equipment approvals','the request is for the Inventory Manager',
    (select approver_role from approvals where id = a) = 'stores');
  perform test.ok('equipment approvals','and names the owner, admin and GM as the backups',
    (select also_decided_by from approvals where id = a) = array['owner', 'admin', 'gm']);

  update approval_rules set also_decided_by = '{}'
   where hotel_id = h and kind = 'equipment_issue';
  perform test.ok('equipment approvals','changing the rule does not re-route a request already waiting',
    (select also_decided_by from approvals where id = a) = array['owner', 'admin', 'gm']);

  -- ---------- a purchase keeps one decider ----------
  insert into approval_rules (hotel_id, kind, approver_role, over_amount, set_by)
  values (h, 'purchase', 'owner', null, other);
  p := app.request_approval(h, 'purchase', 'purchase_invoices',
         gen_random_uuid(), 'Vegetables for the week', 4200, asker);
  perform test.ok('equipment approvals','a purchase names no backups — the GM still cannot take the owner''s decision',
    (select also_decided_by from approvals where id = p) = '{}'::text[]);

  perform test.raises('equipment approvals','a kind nobody decided on is still refused',
    format($q$insert into approval_rules (hotel_id, kind, approver_role)
              values (%L, 'equipment_theft', 'gm')$q$, h), '23514');

  -- ---------- nobody approves their own, backups included ----------
  perform test.raises('equipment approvals','the person who asked cannot approve it',
    format($q$select app.decide_approval(%L, 'approved', %L, null)$q$, a, asker), '23514');

  -- ---------- and the fixtures go ----------
  delete from approvals where hotel_id = h;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id = h;
  alter table hotels enable trigger hotels_no_delete;
  select count(*) into n from hotels where code = 'EQA';
  perform test.ok('equipment approvals','the fixture does not outlive the test', n = 0, n || ' left behind');
end $$;


-- =============================================================================
-- A COLLEAGUE'S NAME, AND RETIREMENT IN THE SAME INBOX (096) — the owner, 16 Sep
-- =============================================================================
do $$
declare
  h uuid; far uuid; me uuid; mate uuid; stranger uuid; n int; nm text;
begin
  h   := app.provision_property_unchecked('NMA','Names Test','Nowhere');
  far := app.provision_property_unchecked('NMB','Names Elsewhere','Nowhere');

  insert into staff (email, full_name, firebase_uid) values
    ('names-me@fidato.in',       'Names Me',       'test-uid-names-me'),
    ('names-mate@fidato.in',     'Names Mate',     'test-uid-names-mate'),
    ('names-stranger@fidato.in', 'Names Stranger', 'test-uid-names-stranger');
  select id into me       from staff where email = 'names-me@fidato.in';
  select id into mate     from staff where email = 'names-mate@fidato.in';
  select id into stranger from staff where email = 'names-stranger@fidato.in';
  insert into staff_hotels (staff_id, hotel_id, role) values
    (me, h, 'stores'), (mate, h, 'housekeeping'), (stranger, far, 'housekeeping');

  perform set_config('app.user_id', me::text, true);

  perform test.ok('names','a colleague at my property: their name',
    app.colleague_name(mate, h) = 'Names Mate', coalesce(app.colleague_name(mate, h), 'null'));
  perform test.ok('names','somebody rostered only at another property: nothing',
    app.colleague_name(stranger, h) is null);
  perform test.ok('names','a property I am not at: nothing, even for its own staff',
    app.colleague_name(stranger, far) is null);

  select count(*) into n from information_schema.routine_privileges
   where routine_schema = 'app' and routine_name = 'colleague_name' and grantee = 'PUBLIC';
  perform test.ok('names','nobody but the application may call it', n = 0, n || ' public grants');

  perform set_config('app.user_id', '', true);

  -- ---------- retirement: the same inbox ----------
  select count(*) into n from approval_rules
   where hotel_id = h and kind = 'equipment_retire' and approver_role = 'stores'
     and also_decided_by = array['owner', 'admin', 'gm'];
  perform test.ok('names','a new property gets the retirement rule too: Inventory Manager, owner, admin, GM',
    n = 1, n || ' matching rules');

  select count(*) into n from hotels x
   where x.code not in ('AGR')
     and not exists (select 1 from approval_rules r
                      where r.hotel_id = x.id and r.kind = 'equipment_retire');
  perform test.ok('names','every property has the retirement rule', n = 0, n || ' without it');

  -- ---------- and the fixtures go ----------
  delete from staff_hotels where staff_id in (me, mate, stranger);
  update staff set is_active = false where id in (me, mate, stranger);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, far);
  alter table hotels enable trigger hotels_no_delete;
end $$;


-- =============================================================================
-- A PROPERTY WITH EQUIPMENT OR STOCK IS NOT DELETED (098, EQ-2)
-- =============================================================================
-- The fixture cannot be deleted by design, so it is built inside a block that
-- is rolled back on purpose; what the refusal said is kept in variables, which
-- a rollback does not touch, and asserted afterwards.
do $$
declare
  h uuid; loc uuid; cat uuid; item uuid; rice uuid; who uuid;
  eq_state text; eq_detail text; st_detail text;
begin
  select id into who from staff where email = 'owner@fidato.in';

  begin
    h := app.provision_property_unchecked('EQD','Equipment Delete Test','Nowhere');
    select id into loc from locations where hotel_id = h and name = 'Main store';   -- made by 104
    insert into equipment_categories (hotel_id, name) values (h, 'Appliance') returning id into cat;
    insert into equipment_items (hotel_id, name, category_id, held_as, tag, created_by)
    values (h, 'Test TV', cat, 'tagged', 'EQ-0001', who) returning id into item;
    insert into equipment_moves (hotel_id, item_id, kind, to_location_id, moved_by)
    values (h, item, 'placed', loc, who);

    begin
      delete from hotels where id = h;
    exception when others then
      get stacked diagnostics eq_state = returned_sqlstate, eq_detail = pg_exception_detail;
    end;
    raise exception 'fixture rolled back on purpose';
  exception when others then
    if sqlerrm <> 'fixture rolled back on purpose' then raise; end if;
  end;

  begin
    h := app.provision_property_unchecked('STD','Stock Delete Test','Nowhere');
    insert into stock_items (hotel_id, name, unit) values (h, 'Test rice', 'kg') returning id into rice;
    insert into stock_movements (hotel_id, item_id, business_date, kind, quantity, moved_by)
    values (h, rice, current_date, 'receipt', 10, who);

    begin
      delete from hotels where id = h;
    exception when others then
      get stacked diagnostics st_detail = pg_exception_detail;
    end;
    raise exception 'fixture rolled back on purpose';
  exception when others then
    if sqlerrm <> 'fixture rolled back on purpose' then raise; end if;
  end;

  perform test.ok('property delete',
    'a property with a register is refused, and the refusal says equipment',
    eq_detail like '%equipment items%', coalesce(eq_state, '-') || ' · ' || coalesce(eq_detail, 'no detail'));
  perform test.ok('property delete',
    'a property with stock movements is refused, and the refusal says stock',
    st_detail like '%stock movements%', coalesce(st_detail, 'no detail'));
  perform test.ok('property delete','neither fixture outlived its block',
    (select count(*) from hotels where code in ('EQD', 'STD')) = 0);
end $$;

-- =============================================================================
-- OWNERSHIP AFTER ONE RUN (1 October). A first deploy migrates once. Every
-- table and every app function must end that run owned by pms_migrate, or a
-- definer that existed before is refused a table the same run made (the
-- voucher's "permission denied for table hotel_bank_details"). db/ownership.sql
-- runs last and makes it so; this database was built in one run, as a first
-- deploy is.
-- =============================================================================
do $$
declare stray_tables text; stray_functions text;
begin
  select string_agg(tablename, ', ') into stray_tables
    from pg_tables where schemaname = 'public' and tableowner <> 'pms_migrate';
  select string_agg(p.proname, ', ') into stray_functions
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and pg_get_userbyid(p.proowner) <> 'pms_migrate';
  perform test.ok('ownership', 'every table is pms_migrate''s after one run',
    stray_tables is null, coalesce(stray_tables, ''));
  perform test.ok('ownership', 'every app function is pms_migrate''s after one run',
    stray_functions is null, coalesce(stray_functions, ''));
end $$;


-- =============================================================================
-- EVERY HOTEL TABLE HAS A WRITTEN RULE (200, the owner, 4 October)
-- =============================================================================
-- The same question db/verify-backup.sh asks of every nightly restore. Asked
-- only there, guest_digilocker_attempts (182) went live with none and the
-- check reported it every night; asked here, a new table without one is red
-- before it ships. A table nobody may read says so with a policy of its own.
do $$
declare
  bare text;
begin
  select string_agg(distinct c.table_name, ', ') into bare
    from information_schema.columns c
   where c.table_schema = 'public' and c.column_name = 'hotel_id'
     and not exists (select 1 from pg_policies p
                      where p.schemaname = 'public' and p.tablename = c.table_name);
  perform test.ok('row security', 'every hotel-scoped table has a policy',
    bare is null, coalesce(bare, ''));
end $$;


-- =============================================================================
-- THE SPARE LOGINS CANNOT SIGN IN (202, the owner's D27-279, 4 October)
-- =============================================================================
-- pms_migrate owns everything and bypasses row security; both it and
-- pms_readonly were created with the placeholder passwords printed in 010.
do $$
declare
  open_ text;
begin
  select string_agg(rolname, ', ') into open_
    from pg_roles where rolname in ('pms_migrate', 'pms_readonly') and rolcanlogin;
  perform test.ok('row security', 'pms_migrate and pms_readonly cannot log in',
    open_ is null, coalesce(open_, ''));
end $$;
