-- =============================================================================
-- EQUIPMENT — the register (phase 1B, docs/STOCK-AND-EQUIPMENT-PLAN.md)
-- =============================================================================
-- Refers to its migration by what it does — "the equipment register" — never
-- by its number (plan § 7).
--
-- Builds two properties of its own and removes them. Runs as the superuser,
-- like every file here; what the APPLICATION may do is checked through its
-- grants, and row isolation through FORCE. Who may DECIDE an approval is the
-- API's (api/test/equipmentApproval.test.ts); what is proved here is what a
-- decision MEANS for the register.
-- =============================================================================
do $$
declare
  h uuid; other uuid;
  clerk uuid; keeper uuid; elsewhere uuid;
  r101 uuid; r102 uuid; r_other uuid;
  store uuid; store2 uuid; lobby uuid; lobby_other uuid;
  sup uuid; sup_other uuid;
  cat uuid; cat_other uuid;
  tv uuid; kettles uuid; two uuid; lamp uuid; fridge uuid;
  mv uuid; ap uuid;
  n int; v text; hist equipment_history; pr record;
begin
  -- ---------- two properties; the rules arrive with them (095, 096) ----------
  h     := app.provision_property_unchecked('EQP','Equipment Test','Nowhere');
  other := app.provision_property_unchecked('EQQ','Equipment Other','Nowhere');
  perform app.bulk_create_rooms(h,     'STD', 1::smallint, 101, 102);
  perform app.bulk_create_rooms(other, 'STD', 1::smallint, 201, 201);
  select id into r101    from rooms where hotel_id = h     and number = '101';
  select id into r102    from rooms where hotel_id = h     and number = '102';
  select id into r_other from rooms where hotel_id = other and number = '201';

  insert into staff (email, full_name) values ('eq-clerk@fidato.in', 'Equipment Clerk')
  on conflict (email) do update set is_active = true returning id into clerk;
  insert into staff (email, full_name) values ('eq-keeper@fidato.in', 'Equipment Keeper')
  on conflict (email) do update set is_active = true returning id into keeper;
  insert into staff (email, full_name) values ('eq-elsewhere@fidato.in', 'Equipment Elsewhere')
  on conflict (email) do update set is_active = true returning id into elsewhere;
  delete from staff_hotels where staff_id in (clerk, keeper, elsewhere);
  insert into staff_hotels (staff_id, hotel_id, role) values
    (clerk, h, 'hotel_manager'), (keeper, h, 'stores'), (elsewhere, other, 'gm');

  -- The Main and Kitchen stores exist already: every new property gets them (104, D17-3).
  select id into store  from locations where hotel_id = h and name = 'Main store';
  select id into store2 from locations where hotel_id = h and name = 'Kitchen store';
  insert into locations (hotel_id, name, kind) values (h, 'Lobby', 'public_area') returning id into lobby;
  insert into locations (hotel_id, name, kind) values (other, 'Lobby', 'public_area') returning id into lobby_other;
  insert into suppliers (hotel_id, name) values (h, 'Solapur Electricals') returning id into sup;
  insert into suppliers (hotel_id, name) values (other, 'Solapur Electricals') returning id into sup_other;

  perform set_config('app.user_id', clerk::text, true);

  -- ---------- nothing ships ----------------------------------------------------
  select count(*) into n from equipment_categories where hotel_id = h;
  perform test.ok('equipment register','a new property has no categories', n = 0, n || ' arrived');
  select count(*) into n from equipment_items where hotel_id = h;
  perform test.ok('equipment register','a new property has no equipment', n = 0, n || ' arrived');
  perform test.ok('equipment register','the first tag a property is offered is EQ-0001',
    app.next_equipment_tag(h) = 'EQ-0001', app.next_equipment_tag(h));

  -- ---------- categories ------------------------------------------------------
  insert into equipment_categories (hotel_id, name, created_by) values (h, 'Appliance', clerk)
  returning id into cat;
  insert into equipment_categories (hotel_id, name) values (other, 'Appliance') returning id into cat_other;
  perform test.raises('equipment register','"appliance " is the same category as "Appliance"',
    format($q$insert into equipment_categories (hotel_id, name) values (%L, 'appliance ')$q$, h), '23505');
  perform test.raises('equipment register','a category with no name is refused',
    format($q$insert into equipment_categories (hotel_id, name) values (%L, '  ')$q$, h), '23514');

  -- ---------- adding: an item and where it is, together -----------------------
  insert into equipment_items
    (hotel_id, name, category_id, held_as, tag, supplier_id, purchase_date, warranty_ends, created_by)
  values (h, 'LED TV 43 inch', cat, 'tagged', 'EQ-0001', sup, '2025-04-01', '2027-03-31', clerk)
  returning id into tv;
  insert into equipment_moves (hotel_id, item_id, kind, to_location_id, moved_by)
  values (h, tv, 'placed', store, clerk);

  select * into hist from equipment_history where item_id = tv order by id limit 1;
  perform test.ok('equipment register','adding records it: added, where, who',
    hist.kind = 'added' and hist.location_id = store and hist.done_by = clerk
    and hist.to_status = 'in_use' and hist.quantity = 1, coalesce(hist.kind, 'no history row'));
  select * into pr from app.equipment_place(tv);
  perform test.ok('equipment register','where it is comes from its moves', pr.location_id = store);
  perform test.ok('equipment register','a cost nobody typed stays NULL — never zero',
    (select unit_cost is null and amc_ends is null from equipment_items where id = tv));
  perform test.ok('equipment register','the next tag follows the highest EQ-number',
    app.next_equipment_tag(h) = 'EQ-0002', app.next_equipment_tag(h));

  -- An item nowhere is refused WHEN THE TRANSACTION ENDS. Tried in its own
  -- block: the deferred check fires at the end of the statement's transaction
  -- here, so it is forced now.
  begin
    insert into equipment_items (hotel_id, name, held_as, tag) values (h, 'Nowhere sofa', 'tagged', 'EQ-0090');
    set constraints equipment_items_has_place immediate;
    perform test.ok('equipment register','an item with no room or place is refused', false, 'it was accepted');
  exception when check_violation then
    perform test.ok('equipment register','an item with no room or place is refused', true);
  end;
  set constraints equipment_items_has_place deferred;

  perform test.raises('equipment register','a tag is unique at a property, in any capitals and spacing',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag) values (%L, 'Another TV', 'tagged', ' eq-0001')$q$, h),
    '23505');
  perform test.raises('equipment register','a tagged item is one thing — a quantity of 2 is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, quantity) values (%L, 'Two TVs', 'tagged', 'EQ-0050', 2)$q$, h),
    '23514');
  perform test.raises('equipment register','a counted line carries no tag',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, quantity) values (%L, 'Kettles', 'counted', 'EQ-0051', 12)$q$, h),
    '23514');
  perform test.raises('equipment register','a supplier at another property is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, supplier_id) values (%L, 'Sofa', 'tagged', 'EQ-0064', %L)$q$, h, sup_other),
    '23514');
  perform test.raises('equipment register','a category at another property is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, category_id) values (%L, 'Sofa', 'tagged', 'EQ-0065', %L)$q$, h, cat_other),
    '23503');
  perform test.raises('equipment register','a negative cost is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, unit_cost) values (%L, 'Sofa', 'tagged', 'EQ-0066', -1)$q$, h),
    '23514');
  perform test.raises('equipment register','a warranty that ends before the purchase is refused',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, purchase_date, warranty_ends) values (%L, 'Sofa', 'tagged', 'EQ-0067', '2025-05-01', '2025-04-30')$q$, h),
    '23514');
  perform test.raises('equipment register','an item cannot be added already retired',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, status, retired_at, retired_by, retire_reason) values (%L, 'Sofa', 'tagged', 'EQ-0068', 'retired', now(), %L, 'x')$q$, h, clerk),
    '23514');

  perform test.raises('equipment register','a place at another property is refused',
    format($q$insert into equipment_moves (hotel_id, item_id, kind, to_location_id) values (%L, %L, 'move', %L)$q$, h, tv, lobby_other),
    '23514');
  perform test.raises('equipment register','an item is placed once — after that it moves',
    format($q$insert into equipment_moves (hotel_id, item_id, kind, to_room_id) values (%L, %L, 'placed', %L)$q$, h, tv, r101),
    '23514');

  -- ---------- S12: leaving the store waits ------------------------------------
  perform test.ok('equipment register','the property has the rule for equipment leaving the store',
    app.equipment_issue_rule_applies(h));
  perform test.raises('equipment register','taking it out of the store with no request is refused',
    format($q$insert into equipment_moves (hotel_id, item_id, kind, to_room_id, moved_by) values (%L, %L, 'move', %L, %L)$q$, h, tv, r101, clerk),
    '23514');

  perform test.allows('equipment register','into another store needs nobody (the owner, 16 September)',
    format($q$insert into equipment_moves (hotel_id, item_id, kind, to_location_id, moved_by) values (%L, %L, 'move', %L, %L)$q$, h, tv, store2, clerk));
  select * into pr from app.equipment_place(tv);
  perform test.ok('equipment register','and counts at once', pr.location_id = store2);

  mv := gen_random_uuid();
  ap := app.request_approval(h, 'equipment_issue', 'equipment_moves', mv, 'The lobby needs a screen', null, clerk);
  insert into equipment_moves (id, hotel_id, item_id, kind, to_location_id, note, approval_id, moved_by)
  values (mv, h, tv, 'move', lobby, 'The lobby needs a screen', ap, clerk);

  select * into pr from app.equipment_place(tv);
  perform test.ok('equipment register','a move out of the store that waits leaves the item in the store',
    pr.location_id = store2);
  perform test.ok('equipment register','the move records where it came from, worked out — not what was sent',
    (select from_location_id from equipment_moves where id = mv) = store2);
  perform test.ok('equipment register','and it is waiting', app.equipment_move_waiting(tv));
  perform test.raises('equipment register','while it waits, the item does not move again',
    format($q$insert into equipment_moves (hotel_id, item_id, kind, to_location_id, moved_by) values (%L, %L, 'move', %L, %L)$q$, h, tv, store, clerk),
    '23514');
  perform test.raises('equipment register','while it waits, its status does not change',
    format($q$update equipment_items set status = 'under_repair' where id = %L$q$, tv), '23514');
  perform app.decide_approval(ap, 'approved', keeper, null);
  select * into pr from app.equipment_place(tv);
  perform test.ok('equipment register','once the Inventory Manager approves, it IS in the lobby',
    pr.location_id = lobby and not app.equipment_move_waiting(tv));

  -- A refusal: nothing moves, nothing has to be undone.
  perform test.allows('equipment register','back into the store needs nobody',
    format($q$insert into equipment_moves (hotel_id, item_id, kind, to_location_id, moved_by) values (%L, %L, 'move', %L, %L)$q$, h, tv, store, clerk));
  mv := gen_random_uuid();
  ap := app.request_approval(h, 'equipment_issue', 'equipment_moves', mv, 'Room 101 asked for it', null, clerk);
  insert into equipment_moves (id, hotel_id, item_id, kind, to_room_id, note, approval_id, moved_by)
  values (mv, h, tv, 'move', r101, 'Room 101 asked for it', ap, clerk);
  perform app.decide_approval(ap, 'rejected', keeper, 'Room 101 has one already.');
  select * into pr from app.equipment_place(tv);
  perform test.ok('equipment register','a refused move leaves it exactly where it was', pr.location_id = store);
  perform test.ok('equipment register','and nothing waits any more', not app.equipment_move_waiting(tv));
  perform test.raises('equipment register','a move cannot borrow another move''s approval',
    format($q$insert into equipment_moves (hotel_id, item_id, kind, to_room_id, approval_id, moved_by) values (%L, %L, 'move', %L, %L, %L)$q$, h, tv, r101, ap, clerk),
    '23514');

  -- Between rooms needs nobody.
  insert into equipment_items (hotel_id, name, held_as, quantity, unit_cost, created_by)
  values (h, 'Electric kettle', 'counted', 12, 1200, clerk) returning id into kettles;
  insert into equipment_moves (hotel_id, item_id, kind, to_room_id, moved_by) values (h, kettles, 'placed', r101, clerk);
  perform test.allows('equipment register','between rooms needs nobody',
    format($q$insert into equipment_moves (hotel_id, item_id, kind, to_room_id, moved_by) values (%L, %L, 'move', %L, %L)$q$, h, kettles, r102, clerk));
  perform test.raises('equipment register','a room at another property is refused',
    format($q$insert into equipment_moves (hotel_id, item_id, kind, to_room_id, moved_by) values (%L, %L, 'move', %L, %L)$q$, h, kettles, r_other, clerk),
    '23503');
  perform test.raises('equipment register','a move to a room AND a place is refused',
    format($q$insert into equipment_moves (hotel_id, item_id, kind, to_room_id, to_location_id, moved_by) values (%L, %L, 'move', %L, %L, %L)$q$, h, kettles, r101, lobby, clerk),
    '23514');
  perform test.raises('equipment register','a move to where it already is, is refused',
    format($q$insert into equipment_moves (hotel_id, item_id, kind, to_room_id, moved_by) values (%L, %L, 'move', %L, %L)$q$, h, kettles, r102, clerk),
    '23514');
  perform test.raises('equipment register','a move that needs no request cannot carry one',
    format($q$insert into equipment_moves (hotel_id, item_id, kind, to_room_id, approval_id, moved_by) values (%L, %L, 'move', %L, %L, %L)$q$, h, kettles, r101, ap, clerk),
    '23514');

  -- ---------- part of a count -------------------------------------------------
  perform test.raises('equipment register','a count cannot be typed over — 11 over 12 loses a kettle',
    format($q$update equipment_items set quantity = 11 where id = %L$q$, kettles), '23514');

  insert into equipment_items (hotel_id, name, held_as, quantity, unit_cost, split_from, created_by)
  values (h, 'Electric kettle', 'counted', 2, 1200, kettles, clerk) returning id into two;

  perform test.ok('equipment register','taking 2 of 12 leaves 10 on the line and 2 on a new one',
    (select quantity from equipment_items where id = kettles) = 10
    and (select quantity from equipment_items where id = two) = 2);
  select * into pr from app.equipment_place(two);
  perform test.ok('equipment register','the new line starts where its line is', pr.room_id = r102);
  perform test.ok('equipment register','a split is recorded on BOTH lines, each naming the other',
    exists (select 1 from equipment_history where item_id = kettles and kind = 'split' and quantity = 2 and related_item_id = two)
    and exists (select 1 from equipment_history where item_id = two and kind = 'split' and quantity = 2 and related_item_id = kettles));
  perform test.ok('equipment register','a split line is not also recorded as added',
    not exists (select 1 from equipment_history where item_id = two and kind = 'added'));
  perform test.ok('equipment register','every kettle is still on a line — the lines add up to 12',
    (select sum(quantity) from equipment_items where id in (kettles, two)) = 12);
  perform test.raises('equipment register','taking all 10 of 10 is a move of the line, not a split',
    format($q$insert into equipment_items (hotel_id, name, held_as, quantity, split_from) values (%L, 'Electric kettle', 'counted', 10, %L)$q$, h, kettles),
    '23514');
  perform test.raises('equipment register','a tagged item cannot be split',
    format($q$insert into equipment_items (hotel_id, name, held_as, tag, split_from) values (%L, 'LED TV 43 inch', 'tagged', 'EQ-0070', %L)$q$, h, tv),
    '23514');

  -- ---------- retiring --------------------------------------------------------
  perform test.raises('equipment register','retiring with no reason is refused — who, when AND why',
    format($q$update equipment_items set status = 'retired', retired_at = now(), retired_by = %L where id = %L$q$, clerk, two),
    '23514');
  update equipment_items set status = 'retired', retired_at = now(), retired_by = keeper,
         retire_reason = 'Elements burnt out' where id = two;
  select * into hist from equipment_history where item_id = two and kind = 'retired';
  perform test.ok('equipment register','retiring directly records who, why, and where it stood',
    hist.done_by = keeper and hist.note = 'Elements burnt out' and hist.room_id = r102,
    coalesce(hist.kind, 'no retired row'));
  perform test.raises('equipment register','a retired item is kept exactly as it was retired',
    format($q$update equipment_items set name = 'Renamed' where id = %L$q$, two), '23514');
  perform test.raises('equipment register','a retired item does not move',
    format($q$insert into equipment_moves (hotel_id, item_id, kind, to_room_id, moved_by) values (%L, %L, 'move', %L, %L)$q$, h, two, r101, clerk),
    '23514');

  -- S16: in the shared inbox.
  insert into equipment_items (hotel_id, name, held_as, tag, created_by)
  values (h, 'Chest fridge', 'tagged', 'EQ-0003', clerk) returning id into fridge;
  insert into equipment_moves (hotel_id, item_id, kind, to_location_id, moved_by) values (h, fridge, 'placed', lobby, clerk);
  ap := app.request_approval(h, 'equipment_retire', 'equipment_items', fridge, 'Compressor gone', null, clerk);
  perform test.ok('equipment register','a retirement request waits, and the item is not retired yet',
    app.equipment_retire_waiting(fridge) and not app.equipment_is_retired(fridge));
  perform test.raises('equipment register','while a retirement waits, the item does not move',
    format($q$insert into equipment_moves (hotel_id, item_id, kind, to_room_id, moved_by) values (%L, %L, 'move', %L, %L)$q$, h, fridge, r101, clerk),
    '23514');
  perform test.raises('equipment register','while a retirement waits, nobody retires it behind the inbox',
    format($q$update equipment_items set status = 'retired', retired_at = now(), retired_by = %L, retire_reason = 'x' where id = %L$q$, keeper, fridge),
    '23514');
  perform app.decide_approval(ap, 'approved', keeper, null);
  perform test.ok('equipment register','once approved in the inbox, it IS retired',
    app.equipment_is_retired(fridge));
  perform test.raises('equipment register','and an item retired in the inbox never changes either',
    format($q$update equipment_items set name = 'Renamed' where id = %L$q$, fridge), '23514');

  -- A declined one leaves it in use.
  insert into equipment_items (hotel_id, name, held_as, tag, created_by)
  values (h, 'Floor lamp', 'tagged', 'EQ-0004', clerk) returning id into lamp;
  insert into equipment_moves (hotel_id, item_id, kind, to_room_id, moved_by) values (h, lamp, 'placed', r101, clerk);
  ap := app.request_approval(h, 'equipment_retire', 'equipment_items', lamp, 'Old', null, clerk);
  perform app.decide_approval(ap, 'rejected', keeper, 'It works; it only needs a bulb.');
  perform test.ok('equipment register','a refused retirement leaves it as it was',
    not app.equipment_is_retired(lamp) and not app.equipment_retire_waiting(lamp));

  -- ---------- edits are recorded -----------------------------------------------
  update equipment_items set unit_cost = 32000 where id = tv;
  select changes -> 'unitCost' ->> 'to' into v from equipment_history where item_id = tv and kind = 'edited';
  perform test.ok('equipment register','an edited cost records what it was and what it became',
    v = '32000.00', coalesce(v, 'no edited row'));
  perform test.raises('equipment register','an item does not change property',
    format($q$update equipment_items set hotel_id = %L where id = %L$q$, other, tv), '23514');
  perform test.raises('equipment register','tagged or counted is decided when it is added',
    format($q$update equipment_items set held_as = 'counted', tag = null where id = %L$q$, tv), '23514');

  -- ---------- nothing is rewritten ---------------------------------------------
  perform test.raises('equipment register','the history cannot be edited',
    format($q$update equipment_history set note = 'nothing happened' where item_id = %L$q$, tv), 'P0001');
  perform test.raises('equipment register','the history cannot be deleted',
    format($q$delete from equipment_history where item_id = %L$q$, tv), 'P0001');
  perform test.raises('equipment register','a move cannot be edited',
    format($q$update equipment_moves set to_room_id = %L where item_id = %L$q$, r101, tv), 'P0001');

  -- ---------- the next tag never truncates ------------------------------------
  insert into equipment_items (hotel_id, name, held_as, tag) values
    (h, 'Printed label, not ours', 'tagged', 'LOBBY-TV-2'), (h, 'Chest freezer', 'tagged', 'eq-9999');
  insert into equipment_moves (hotel_id, item_id, kind, to_room_id)
  select h, id, 'placed', r102 from equipment_items where hotel_id = h and tag in ('LOBBY-TV-2', 'eq-9999');
  perform test.ok('equipment register','a typed label neither blocks nor bends the numbers',
    app.next_equipment_tag(h) = 'EQ-10000', app.next_equipment_tag(h));

  -- ---------- what the application may do -------------------------------------
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'pms_app' and privilege_type = 'DELETE'
     and table_name in ('equipment_items', 'equipment_categories', 'equipment_history', 'equipment_moves');
  perform test.ok('equipment register','the application cannot delete equipment, a category, a move or its history',
    n = 0, n || ' delete grants');
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'pms_app' and privilege_type = 'UPDATE'
     and table_name in ('equipment_moves', 'equipment_history');
  perform test.ok('equipment register','the application cannot rewrite a move or the history', n = 0, n || ' update grants');
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'pms_app' and table_name = 'equipment_history' and privilege_type = 'INSERT';
  perform test.ok('equipment register','the application can only READ the history — the triggers write it',
    n = 0, n || ' insert grants');
  select count(*) into n from pg_class
   where relname in ('equipment_items', 'equipment_categories', 'equipment_history', 'equipment_moves')
     and relrowsecurity and relforcerowsecurity;
  perform test.ok('equipment register','all four tables force row-level security', n = 4, n || ' of 4');

  -- ---------- and the fixtures go ---------------------------------------------
  perform set_config('app.equipment_note', '', true);
  alter table equipment_history disable trigger equipment_history_append_only;
  alter table equipment_moves disable trigger equipment_moves_append_only;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
  alter table equipment_moves enable trigger equipment_moves_append_only;
  alter table equipment_history enable trigger equipment_history_append_only;
  delete from staff_hotels where staff_id in (clerk, keeper, elsewhere);
  update staff set is_active = false where id in (clerk, keeper, elsewhere);

  select count(*) into n from hotels where code in ('EQP', 'EQQ');
  perform test.ok('equipment register','the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);
