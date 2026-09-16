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
  select count(*) into n from locations where hotel_id = h;
  perform test.ok('suppliers and locations',
    'a new property has no locations — not even the three the owner chose', n = 0, n || ' arrived');

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
    (h, 'Main store', 'store'), (h, 'Kitchen store', 'store'), (h, 'Lobby', 'public_area');
  perform test.ok('suppliers and locations','places of each kind can be added',
    (select count(*) from locations where hotel_id = h) = 3);

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
