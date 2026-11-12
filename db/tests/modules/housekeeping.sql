-- =============================================================================
-- HOUSEKEEPING — repairs on equipment, and what they cost (phase 2B)
-- =============================================================================
-- Refers to its migration by what it does — "repairs on equipment" — never by
-- its number (docs/STOCK-AND-EQUIPMENT-PLAN.md § 7).
--
-- What the DATABASE refuses, whichever route sends it. Who may is the API's
-- (api/test/modules/housekeeping/repairs.test.ts, every role at every door).
-- Builds a property of its own and removes it.
-- =============================================================================
do $$
declare
  h uuid; other uuid;
  keeper uuid;
  r101 uuid; r_other uuid;
  tv uuid; kettles uuid; tv_other uuid;
  wo uuid; wo_other uuid;
  cost uuid; proof uuid; proof_other uuid;
  n int;
begin
  h     := app.provision_property_unchecked('HKP','Repairs Test','Nowhere');
  other := app.provision_property_unchecked('HKQ','Repairs Other','Nowhere');
  perform app.bulk_create_rooms(h,     'STD', 1::smallint, 101, 101);
  perform app.bulk_create_rooms(other, 'STD', 1::smallint, 201, 201);
  select id into r101    from rooms where hotel_id = h     and number = '101';
  select id into r_other from rooms where hotel_id = other and number = '201';

  insert into staff (email, full_name) values ('hk-keeper@fidato.in', 'Repairs Keeper')
  on conflict (email) do update set is_active = true returning id into keeper;
  delete from staff_hotels where staff_id = keeper;
  insert into staff_hotels (staff_id, hotel_id, role) values (keeper, h, 'stores'), (keeper, other, 'stores');
  perform set_config('app.user_id', keeper::text, true);

  insert into equipment_items (hotel_id, name, held_as, tag, created_by)
  values (h, 'TV', 'tagged', 'EQ-0001', keeper) returning id into tv;
  insert into equipment_moves (hotel_id, item_id, kind, to_room_id, moved_by)
  values (h, tv, 'placed', r101, keeper);
  insert into equipment_items (hotel_id, name, held_as, quantity, created_by)
  values (h, 'Kettle', 'counted', 6, keeper) returning id into kettles;
  insert into equipment_moves (hotel_id, item_id, kind, to_room_id, moved_by)
  values (h, kettles, 'placed', r101, keeper);
  insert into equipment_items (hotel_id, name, held_as, tag, created_by)
  values (other, 'TV', 'tagged', 'EQ-0001', keeper) returning id into tv_other;
  insert into equipment_moves (hotel_id, item_id, kind, to_room_id, moved_by)
  values (other, tv_other, 'placed', r_other, keeper);

  -- ---------- a repair points at one tagged thing, at its own property -------
  perform test.allows('repairs on equipment','a repair may point at a tagged item',
    format($q$insert into work_orders (hotel_id, room_id, title, raised_by, equipment_item_id)
              values (%L, %L, 'TV no signal', %L, %L)$q$, h, r101, keeper, tv));
  select id into wo from work_orders where hotel_id = h and title = 'TV no signal';

  perform test.raises('repairs on equipment','a counted line is not repaired',
    format($q$insert into work_orders (hotel_id, title, equipment_item_id) values (%L, 'Kettle leaks', %L)$q$, h, kettles),
    '23514');
  perform test.raises('repairs on equipment','an item at another property is refused',
    format($q$insert into work_orders (hotel_id, title, equipment_item_id) values (%L, 'Wrong TV', %L)$q$, h, tv_other));
  perform test.raises('repairs on equipment','the item a repair is for is chosen when it is raised',
    format($q$update work_orders set equipment_item_id = null where id = %L$q$, wo),
    '23514');
  perform test.allows('repairs on equipment','most repairs are for no item at all',
    format($q$insert into work_orders (hotel_id, title) values (%L, 'Lobby door squeaks')$q$, h));

  -- ---------- no cost without ITS OWN proof ----------------------------------
  cost := gen_random_uuid();
  insert into attachments (hotel_id, subject_table, subject_id, filename, content_type,
                           byte_size, sha256, storage_key, uploaded_by)
  values (h, 'work_order_costs', cost, 'bill.png', 'image/png', 70, repeat('a', 64), 'k/1.png', keeper)
  returning id into proof;
  -- A file kept against something else — a purchase bill — is not this cost's proof.
  insert into attachments (hotel_id, subject_table, subject_id, filename, content_type,
                           byte_size, sha256, storage_key, uploaded_by)
  values (h, 'purchase_invoices', gen_random_uuid(), 'other.png', 'image/png', 70, repeat('b', 64), 'k/2.png', keeper)
  returning id into proof_other;

  perform test.raises('repairs on equipment','a cost with a proof that is not its own is refused',
    format($q$insert into work_order_costs (hotel_id, work_order_id, amount, proof_id, recorded_by)
              values (%L, %L, 1800, %L, %L)$q$, h, wo, proof_other, keeper),
    '23514');
  -- Refused by the guard, in its sentence, before the column's own not-null.
  perform test.raises('repairs on equipment','a cost with no proof at all is refused, in a sentence',
    format($q$insert into work_order_costs (id, hotel_id, work_order_id, amount, recorded_by)
              values (%L, %L, %L, 1800, %L)$q$, cost, h, wo, keeper),
    '23514');
  perform test.raises('repairs on equipment','a cost of nothing is refused — a dash, never ₹0',
    format($q$insert into work_order_costs (id, hotel_id, work_order_id, amount, proof_id, recorded_by)
              values (%L, %L, %L, 0, %L, %L)$q$, cost, h, wo, proof, keeper),
    '23514');
  perform test.raises('repairs on equipment','a cost is not recorded already cancelled',
    format($q$insert into work_order_costs (id, hotel_id, work_order_id, amount, proof_id, recorded_by,
                                            cancelled_by, cancelled_at, cancel_reason)
              values (%L, %L, %L, 1800, %L, %L, %L, now(), 'x')$q$, cost, h, wo, proof, keeper, keeper),
    '23514');
  perform test.allows('repairs on equipment','a cost WITH its own proof is recorded',
    format($q$insert into work_order_costs (id, hotel_id, work_order_id, amount, proof_id, recorded_by)
              values (%L, %L, %L, 1800.50, %L, %L)$q$, cost, h, wo, proof, keeper));

  -- A cost names a repair at its own property.
  insert into work_orders (hotel_id, title) values (other, 'Elsewhere') returning id into wo_other;
  perform test.raises('repairs on equipment','a cost on a repair at another property is refused',
    format($q$insert into work_order_costs (hotel_id, work_order_id, amount, proof_id, recorded_by)
              values (%L, %L, 10, %L, %L)$q$, h, wo_other, proof, keeper));

  -- ---------- never changed; cancelled once, with who, when and why ----------
  perform test.raises('repairs on equipment','a recorded amount is never changed',
    format($q$update work_order_costs set amount = 18.50 where id = %L$q$, cost), '23514');
  perform test.raises('repairs on equipment','a cancellation needs a reason',
    format($q$update work_order_costs set cancelled_by = %L, cancelled_at = now(), cancel_reason = ' ' where id = %L$q$, keeper, cost),
    '23514');
  perform test.allows('repairs on equipment','a wrong cost is cancelled with who, when and why',
    format($q$update work_order_costs set cancelled_by = %L, cancelled_at = now(), cancel_reason = 'Typed twice' where id = %L$q$, keeper, cost));
  perform test.raises('repairs on equipment','a cancelled cost stays exactly as it was cancelled',
    format($q$update work_order_costs set cancel_reason = 'Something else' where id = %L$q$, cost), '23514');

  select count(*) into n from information_schema.role_table_grants
   where grantee = 'pms_app' and table_name = 'work_order_costs' and privilege_type = 'DELETE';
  perform test.ok('repairs on equipment','the application can never delete a cost', n = 0, n || ' delete grants');
  select count(*) into n from pg_class
   where relname = 'work_order_costs' and relrowsecurity and relforcerowsecurity;
  perform test.ok('repairs on equipment','costs force row-level security', n = 1);

  -- ---------- and the fixtures go ----------------------------------------------
  delete from work_order_costs where hotel_id in (h, other);
  delete from attachments where id in (proof, proof_other);
  delete from work_orders where hotel_id in (h, other);
  perform set_config('app.equipment_note', '', true);
  alter table equipment_history disable trigger equipment_history_append_only;
  alter table equipment_moves disable trigger equipment_moves_append_only;
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
  alter table equipment_moves enable trigger equipment_moves_append_only;
  alter table equipment_history enable trigger equipment_history_append_only;
  delete from staff_hotels where staff_id = keeper;
  update staff set is_active = false where id = keeper;

  select count(*) into n from hotels where code in ('HKP', 'HKQ');
  perform test.ok('repairs on equipment','the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

-- =============================================================================
-- THE MINIBAR AND HOUSEKEEPING CHECKLISTS (D27-383 item 10) - "the minibar",
-- "housekeeping checklists"
-- =============================================================================
-- What the DATABASE refuses whichever route writes: no price of zero, a record
-- that says why it waits, a decision made once, what was recorded never
-- changed; a cleaning list never "failed". Who may is the API's
-- (api/test/modules/housekeeping/care.test.ts). A property of its own.
-- =============================================================================
do $$
declare
  h uuid; other uuid; keeper uuid; r101 uuid; r_other uuid; stay uuid;
  water uuid; water_other uuid; main uuid; mi uuid; rec uuid; n int;
  line constant jsonb := '[{"item":"x","name":"Water","quantity":1,"price":60,"alcohol":false}]';
begin
  perform set_config('app.user_id', (select id::text from staff where email = 'owner@fidato.in'), true);
  h     := app.provision_property_unchecked('HKM','Minibar Test','Nowhere');
  other := app.provision_property_unchecked('HKN','Minibar Other','Nowhere');
  perform app.bulk_create_rooms(h,     'STD', 1::smallint, 101, 101);
  perform app.bulk_create_rooms(other, 'STD', 1::smallint, 201, 201);
  perform app.default_stores(h);
  select id into r101    from rooms where hotel_id = h     and number = '101';
  select id into r_other from rooms where hotel_id = other and number = '201';
  select id into main from locations where hotel_id = h and name = 'Main store';

  insert into staff (email, full_name) values ('hk-minibar@fidato.in', 'Minibar Keeper')
  on conflict (email) do update set is_active = true returning id into keeper;
  delete from staff_hotels where staff_id = keeper;
  insert into staff_hotels (staff_id, hotel_id, role) values (keeper, h, 'housekeeping'), (keeper, other, 'housekeeping');
  perform set_config('app.user_id', keeper::text, true);

  insert into stock_items (hotel_id, name, unit) values (h, 'Water', 'bottle') returning id into water;
  insert into stock_items (hotel_id, name, unit) values (other, 'Water', 'bottle') returning id into water_other;
  insert into guests (full_name) values ('Minibar Guest') returning id into stay;
  insert into reservations (hotel_id, reference, guest_id, room_type_id, check_in, check_out, agreed_rate, status)
  values (h, app.next_reference(h), stay, (select id from room_types where hotel_id = h limit 1),
          current_date, current_date + 1, 2000, 'checked_in') returning id into stay;

  -- ---------- the list: a price is the hotel's, never zero -------------------
  perform test.raises('the minibar','a price of zero is refused',
    format($q$insert into minibar_items (hotel_id, stock_item_id, price, store_id) values (%L, %L, 0, %L)$q$, h, water, main),
    '23514');
  perform test.raises('the minibar','another property''s Store item is refused',
    format($q$insert into minibar_items (hotel_id, stock_item_id, price, store_id) values (%L, %L, 60, %L)$q$, h, water_other, main),
    '23503');
  perform test.allows('the minibar','an item with no price yet is kept',
    format($q$insert into minibar_items (hotel_id, stock_item_id, store_id) values (%L, %L, %L)$q$, h, water, main));
  select id into mi from minibar_items where hotel_id = h;
  perform test.ok('the minibar','an unpriced item is NULL, never 0',
    (select price is null from minibar_items where id = mi));

  -- ---------- a record says why it waits, and is decided once ----------------
  perform test.raises('the minibar','a record that waits says why',
    format($q$insert into minibar_records (hotel_id, room_id, reservation_id, business_date, lines, status, recorded_by)
              values (%L, %L, %L, current_date, %L, 'waiting', %L)$q$, h, r101, stay, line, keeper), '23514');
  perform test.raises('the minibar','a charge names the stay',
    format($q$insert into minibar_records (hotel_id, room_id, business_date, lines, status, recorded_by)
              values (%L, %L, current_date, %L, 'charged', %L)$q$, h, r101, line, keeper), '23514');
  perform test.raises('the minibar','a room at another property is refused',
    format($q$insert into minibar_records (hotel_id, room_id, reservation_id, business_date, lines, status, recorded_by)
              values (%L, %L, %L, current_date, %L, 'charged', %L)$q$, h, r_other, stay, line, keeper), '23503');
  perform test.raises('the minibar','a record of nothing is refused',
    format($q$insert into minibar_records (hotel_id, room_id, reservation_id, business_date, lines, status, recorded_by)
              values (%L, %L, %L, current_date, '[]', 'charged', %L)$q$, h, r101, stay, keeper), '23514');

  insert into minibar_records (hotel_id, room_id, reservation_id, business_date, lines, status, waiting_why, recorded_by)
  values (h, r101, stay, current_date, line, 'waiting', 'disputed', keeper) returning id into rec;
  perform test.raises('the minibar','not charged says why',
    format($q$update minibar_records set status = 'not_charged', decided_by = %L, decided_at = now() where id = %L$q$, keeper, rec),
    '23514');
  perform test.raises('the minibar','what was recorded is never changed',
    format($q$update minibar_records set lines = '[{"item":"x","name":"Water","quantity":9,"price":60,"alcohol":false}]',
              status = 'charged', decided_by = %L, decided_at = now() where id = %L$q$, keeper, rec), '23514');
  perform test.allows('the minibar','the desk decides a waiting one',
    format($q$update minibar_records set status = 'charged', decided_by = %L, decided_at = now() where id = %L$q$, keeper, rec));
  perform test.raises('the minibar','a decided record is decided once',
    format($q$update minibar_records set status = 'not_charged', decided_note = 'no', decided_by = %L, decided_at = now()
              where id = %L$q$, keeper, rec), '23514');

  select count(*) into n from information_schema.role_table_grants
   where grantee = 'pms_app' and table_name in ('minibar_items', 'minibar_records', 'hk_checklist_runs')
     and privilege_type in ('DELETE', 'UPDATE');
  perform test.ok('the minibar','the application deletes no item, record or run, and edits none whole',
    n = 0, n || ' grants');
  select count(*) into n from pg_class
   where relname in ('minibar_items', 'minibar_records', 'hk_checklists', 'hk_checklist_runs')
     and relrowsecurity and relforcerowsecurity;
  perform test.ok('the minibar','all four tables force row-level security', n = 4, n || ' of 4');

  -- ---------- checklists ------------------------------------------------------
  perform test.ok('housekeeping checklists','the switch is off for a new hotel',
    (select not checklists_required from hotels where id = h));
  perform test.allows('housekeeping checklists','a list for every room type',
    format($q$insert into hk_checklists (hotel_id, job, items) values (%L, 'checkout', array['Bed', 'Bath'])$q$, h));
  perform test.raises('housekeeping checklists','one list per job and room type',
    format($q$insert into hk_checklists (hotel_id, job, items) values (%L, 'checkout', array['Other'])$q$, h), '23505');
  perform test.raises('housekeeping checklists','a list has an item',
    format($q$insert into hk_checklists (hotel_id, job, items) values (%L, 'deep', array[]::text[])$q$, h), '23514');
  perform test.raises('housekeeping checklists','a cleaning job is never failed',
    format($q$insert into hk_checklist_runs (hotel_id, room_id, job, business_date, results, passed, done_by)
              values (%L, %L, 'checkout', current_date, '[{"item":"Bed","ok":false}]', false, %L)$q$, h, r101, keeper), '23514');
  perform test.raises('housekeeping checklists','passed is every item ticked',
    format($q$insert into hk_checklist_runs (hotel_id, room_id, job, business_date, results, passed, done_by)
              values (%L, %L, 'inspection', current_date, '[{"item":"Bed","ok":false,"note":"x"}]', true, %L)$q$, h, r101, keeper), '23514');
  perform test.allows('housekeeping checklists','an inspection may fail an item',
    format($q$insert into hk_checklist_runs (hotel_id, room_id, job, business_date, results, passed, done_by)
              values (%L, %L, 'inspection', current_date, '[{"item":"Bed","ok":false,"note":"x"}]', false, %L)$q$, h, r101, keeper));
  perform test.raises('housekeeping checklists','a room at another property is refused',
    format($q$insert into hk_checklist_runs (hotel_id, room_id, job, business_date, results, passed, done_by)
              values (%L, %L, 'inspection', current_date, '[{"item":"Bed","ok":true}]', true, %L)$q$, h, r_other, keeper), '23503');

  -- ---------- and the fixtures go ----------------------------------------------
  delete from hk_checklist_runs where hotel_id in (h, other);
  delete from minibar_records where hotel_id in (h, other);
  alter table hotels disable trigger hotels_no_delete;
  delete from hotels where id in (h, other);
  alter table hotels enable trigger hotels_no_delete;
  delete from staff_hotels where staff_id = keeper;
  update staff set is_active = false where id = keeper;
  select count(*) into n from hotels where code in ('HKM', 'HKN');
  perform test.ok('the minibar','the fixtures do not outlive the test', n = 0, n || ' left behind');
end $$;

select set_config('app.user_id',
       (select id::text from staff where email = 'owner@fidato.in'), false);
