-- =============================================================================
-- ACCOUNTING: the ledger names in a hotel's Tally (the owner's D27-382)
-- =============================================================================
-- Refers to its migration by what it does ("tally ledger names"), never by
-- number. Who may change them is the API's (api/test/modules/accounting/
-- ledgers.test.ts). What is proved here is the database's half: each hotel keeps
-- to its own, a name stays as typed, it is setup, and nothing is ever seeded.
--
-- This block UNDOES WHAT IT MAKES at the end (a sentinel raised inside, caught
-- one level up), so its assertions are gathered in a variable a rollback does
-- not touch and written to test.results after.
-- =============================================================================
-- A statement's refusal, as text; null when it went through, and then undone.
create or replace function test.ledger_err(p_sql text)
returns text
language plpgsql
as $$
begin
  begin
    execute p_sql;
    raise exception using errcode = 'TL002', message = 'went through';
  exception when sqlstate 'TL002' then
    return null;
  end;
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
-- Asked as the application role too, inside this file only (revoked at its end).
grant usage on schema test to pms_app;
grant execute on function test.ledger_err(text) to pms_app;

do $$
declare
  res   jsonb := '[]';
  owner uuid; agra uuid;
  agr uuid; pun uuid; r uuid; t uuid;
  n int; v text; a jsonb;
begin
  begin
    select id into owner from staff where email = 'owner@fidato.in';
    select id into agra from staff where email = 'agra@fidato.in';
    select id into agr from hotels where code = 'AGR';
    select id into pun from hotels where code = 'PUN';
    perform set_config('app.user_id', owner::text, true);
    perform set_config('app.hotel_code', '', true);

    res := res || jsonb_build_object('n', 'row security is forced on the table',
      'ok', (select relrowsecurity and relforcerowsecurity from pg_class where relname = 'tally_ledger_names'));
    res := res || jsonb_build_object('n', 'nothing is seeded: no hotel has a ledger name until one is typed',
      'ok', not exists (select 1 from tally_ledger_names));

    -- ---------- a new hotel starts blank, and its test hotel takes a copy ----------
    r := app.provision_property_unchecked('TLN', 'Tally Ledger Names', 'Nowhere');
    res := res || jsonb_build_object('n', 'a new hotel gets no name',
      'ok', not exists (select 1 from tally_ledger_names where hotel_id = r));
    insert into tally_ledger_names (hotel_id, ledger, name) values (r, 'room', 'ROOM Rent & Guests'' Stay');
    t := app.create_test_hotel(r);
    res := res || jsonb_build_object('n', 'a test hotel takes a copy with the rest of the setup, as typed',
      'ok', (select name from tally_ledger_names where hotel_id = t and ledger = 'room') = 'ROOM Rent & Guests'' Stay');
    res := res || jsonb_build_object('n', 'it is classed setup',
      'ok', exists (select 1 from app.test_hotel_classes() c
                     where c.table_name = 'tally_ledger_names' and c.class = 'setup'));
    res := res || jsonb_build_object('n', 'the full reset does not touch it',
      'ok', not exists (select 1 from owner_reset.steps(true) where table_name = 'tally_ledger_names')
        and not exists (select 1 from owner_reset.steps(false) where table_name = 'tally_ledger_names'));

    -- ---------- a name stays as typed ----------
    v := test.ledger_err(format('insert into tally_ledger_names (hotel_id, ledger, name) values (%L, ''a'', '' padded'')', r));
    res := res || jsonb_build_object('n', 'spaces at the ends are refused', 'ok', v like '23514%', 'd', v);
    v := test.ledger_err(format('insert into tally_ledger_names (hotel_id, ledger, name) values (%L, ''b'', '''')', r));
    res := res || jsonb_build_object('n', 'a blank is no row, never an empty name', 'ok', v like '23514%', 'd', v);
    v := test.ledger_err(format('insert into tally_ledger_names (hotel_id, ledger, name) values (%L, ''c'', E''a\x01b'')', r));
    res := res || jsonb_build_object('n', 'a control character is refused: it cannot be written in XML', 'ok', v like '23514%', 'd', v);
    v := test.ledger_err(format('insert into tally_ledger_names (hotel_id, ledger, name) values (%L, ''room'', ''Again'')', r));
    res := res || jsonb_build_object('n', 'one name per ledger', 'ok', v like '23505%', 'd', v);

    -- ---------- each hotel keeps to its own ----------
    insert into tally_ledger_names (hotel_id, ledger, name) values
      (agr, 'room', 'Agra rent'), (pun, 'room', 'Pune rent');
    perform set_config('app.user_id', agra::text, true);
    set local role pms_app;
    select count(*) into n from tally_ledger_names where hotel_id = pun;
    res := res || jsonb_build_object('n', 'one hotel''s clerk reads no other hotel''s names', 'ok', n = 0, 'd', n);
    select count(*) into n from tally_ledger_names where hotel_id = agr;
    res := res || jsonb_build_object('n', 'and reads their own', 'ok', n = 1, 'd', n);
    v := test.ledger_err(format('insert into tally_ledger_names (hotel_id, ledger, name) values (%L, ''food'', ''Mine'')', pun));
    res := res || jsonb_build_object('n', 'and writes no name into another hotel', 'ok', v like '42501%', 'd', v);
    reset role;

    -- ---------- every change is in the audit trail ----------
    res := res || jsonb_build_object('n', 'a name typed is in the audit trail',
      'ok', exists (select 1 from audit_log where table_name = 'tally_ledger_names'
                      and hotel_id = agr and action = 'INSERT'));

    raise exception using errcode = 'TL001', message = 'undo';
  exception when sqlstate 'TL001' then
    null;
  end;

  for a in select * from jsonb_array_elements(res) loop
    perform test.ok('tally ledger names', a ->> 'n', (a ->> 'ok')::boolean, coalesce(a ->> 'd', '-'));
  end loop;
end $$;

revoke execute on function test.ledger_err(text) from pms_app;
revoke usage on schema test from pms_app;
