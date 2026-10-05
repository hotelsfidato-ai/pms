-- =============================================================================
-- crs-run-as.sql — the account the CRS reader works as, at ONE hotel
-- =============================================================================
-- D27-284 (3), the owner, 5 October: the last step of connecting the CRS to the
-- live PMS. Run once per hotel, ON THE SERVER, after a backup
-- (deploy/README.md, "Connect the CRS", says when and how):
--
--   sudo -u postgres psql -d fidato -v hotel=AMR -f /opt/fidato/deploy/crs-run-as.sql
--
-- WHY. The reader (api/src/modules/crs/) has nobody signed in. Every five
-- minutes app.crs_due() names each hotel that is switched on AND has an active
-- account in crs_hotels.run_as; the reader then works inside withUser(run_as),
-- so row security lets it see and book that hotel only, and the audit log
-- names that account on every booking it makes (reservations'
-- createChannelBooking: a waiting booking, refused when full). run_as null:
-- the hotel is never read, whatever the switch says. Nothing in the PMS sets
-- it (setup.ts leaves it to go-live), so this does.
--
-- WHAT IT WRITES — three rows, nothing else:
--   staff          crs+<code>@fidatohotels.com, "CRS reader (<code>, service
--                  account)". No Firebase sign-in, so nobody can ever sign in
--                  as it; not a group administrator. One per hotel, as a POS
--                  outlet's (api/scripts/pos-outlet.ts) and the channel
--                  manager's (107) are.
--   staff_hotels   read_only (shown as Viewer) at that ONE hotel. The least
--                  role there is, and enough: the machine door asks no role
--                  (makeBooking asks one only for a complimentary room, which
--                  the CRS never sends), row security asks only that the
--                  account works there, and app.assert_staff_has_hotel('run_as')
--                  refuses run_as without this row - so it is written first.
--   crs_hotels     run_as = that account.
--   Proved, with the reader making a booking as it, by
--   api/test/modules/crs/crsRunAs.test.ts.
--
-- THE ORDER: the card "Connection to the CRS" saved with its switch OFF, then
-- this, then the switch ON - which starts reading from that moment.
--
-- IT REFUSES AND CHANGES NOTHING when: no hotel was named; the hotel is not
-- there or is switched off; this database has no CRS bridge (migration 160);
-- the hotel is not connected yet (no crs_hotels row); its switch is ON with
-- nobody to read as (reading would start from the old switch-on and book
-- twice what the desk typed in by hand meanwhile); the address is somebody
-- who is not exactly this service account (one with a sign-in, a group
-- administrator, switched off, or holding any other access); or the reader
-- already runs as somebody else. Each refusal is one ERROR line saying what
-- to do. psql stops there (ON_ERROR_STOP) and the transaction rolls back.
--
-- ONE TRANSACTION. RE-RUNNABLE: a second run finds it all in place, says so,
-- and writes nothing. No secret and nobody's personal data are in this file.
--
-- UNDO: switch the card OFF (reading stops at the next turn), then
--   sudo -u postgres psql -d fidato -c "update crs_hotels set run_as = null
--     where hotel_id = (select id from hotels where code = 'AMR')"
-- The account stays, unused and unable to sign in; a later run reuses it.
-- =============================================================================

\set ON_ERROR_STOP on
\set QUIET on

-- No -v hotel=...: an empty name, which the block below refuses in words.
\if :{?hotel}
\else
  \set hotel ''
\endif

begin;

set local crs_run_as.hotel = :'hotel';

do $$
declare
  v_code    text := upper(btrim(current_setting('crs_run_as.hotel')));
  v_hotel   uuid;
  v_name    text;
  v_open    boolean;
  v_on      boolean;
  v_run_as  uuid;
  v_email   text;
  v_id      uuid;
  v_active  boolean;
  v_admin   boolean;
  v_uid     text;
  v_elsewhere text;
  v_other   text;
  v_types   integer;
  v_n       integer;
  v_did     integer := 0;
begin
  if v_code = '' then
    raise exception 'Say which hotel: add  -v hotel=AMR  to the command. Nothing was changed.';
  end if;

  select id, name, is_active into v_hotel, v_name, v_open from hotels where code = v_code;
  if v_hotel is null then
    raise exception 'There is no hotel with the code %. Nothing was changed.', v_code;
  end if;
  if not v_open then
    raise exception 'Hotel % (%) is switched off. Nothing was changed.', v_code, v_name;
  end if;

  if to_regclass('public.crs_hotels') is null then
    raise exception 'This database has no CRS bridge yet (migration 160): release the code first. Nothing was changed.';
  end if;

  -- The hotel must already be connected: its CRS id, source and room types
  -- are the owner's, typed on the card, never guessed here.
  select run_as, is_on into v_run_as, v_on from crs_hotels where hotel_id = v_hotel for update;
  if not found then
    raise exception 'Hotel % is not connected to the CRS yet. In the PMS: Bookings, CRS bookings, the card "Connection to the CRS": type the property''s CRS id, pick the source, match the room types, leave "Read bookings from the CRS" OFF and Save. Then run this again. Nothing was changed.', v_code;
  end if;

  -- Switched on with nobody to read as: nothing has been read since the
  -- switch, and the desk may have typed those CRS bookings in by hand. Given
  -- an account now, the reader would book every one of them a second time.
  -- Switching off and on again on the card starts from that moment instead
  -- (setup.ts), which is the card's own rule.
  if v_on and v_run_as is null then
    raise exception 'Reading is switched ON at % with no account to read as, so nothing has been read since it was switched on. First switch "Read bookings from the CRS" OFF on the card and Save; run this again; then switch it ON. It then reads the CRS bookings made from that moment, so none the desk typed in by hand meanwhile is booked twice. Nothing was changed.', v_code;
  end if;

  -- The service account, if a run before this one made it. citext, as 088.
  v_email := 'crs+' || lower(v_code) || '@fidatohotels.com';
  select id, is_active, is_group_admin, firebase_uid
    into v_id, v_active, v_admin, v_uid
    from staff where email = v_email::citext;

  if v_id is not null then
    if v_uid is not null or v_admin or not v_active then
      raise exception '% exists but is not a plain service account (%). Nothing was changed: ask the master.',
        v_email, concat_ws(', ',
          case when v_uid is not null then 'it has a sign-in' end,
          case when v_admin then 'it is a group administrator' end,
          case when not v_active then 'it is switched off' end);
    end if;
    select string_agg(h.code || ' as ' || sh.role, ', ' order by h.code) into v_elsewhere
      from staff_hotels sh join hotels h on h.id = sh.hotel_id
     where sh.staff_id = v_id and not (sh.hotel_id = v_hotel and sh.role = 'read_only');
    if v_elsewhere is not null then
      raise exception '% holds other access (%). It must reach % alone, as Viewer. Nothing was changed: ask the master.',
        v_email, v_elsewhere, v_code;
    end if;
  end if;

  -- The reader already runs as somebody else: theirs to undo, not this file's.
  if v_run_as is not null and v_run_as is distinct from v_id then
    select format('%s (%s)', s.email, s.full_name) into v_other from staff s where s.id = v_run_as;
    raise exception 'The CRS reader at % already runs as %. Nothing was changed: ask the master.', v_code, v_other;
  end if;

  if v_id is null then
    insert into staff (email, full_name, is_group_admin)
    values (v_email, format('CRS reader (%s, service account)', v_code), false)
    returning id into v_id;
    raise notice 'Made the service account % (no sign-in).', v_email;
    v_did := v_did + 1;
  end if;

  insert into staff_hotels (staff_id, hotel_id, role)
  values (v_id, v_hotel, 'read_only')
  on conflict (staff_id, hotel_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    raise notice 'Gave it Viewer (read_only) at %, and nothing anywhere else.', v_code;
    v_did := v_did + 1;
  end if;

  update crs_hotels set run_as = v_id
   where hotel_id = v_hotel and run_as is distinct from v_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    raise notice 'The CRS reader at % now runs as %.', v_code, v_email;
    v_did := v_did + 1;
  end if;

  if v_did = 0 then
    raise notice 'Nothing to change: the CRS reader at % already runs as %.', v_code, v_email;
  end if;

  -- What is still the owner's, said rather than left to be found later.
  select count(*) into v_types from crs_room_types where hotel_id = v_hotel;
  if v_types = 0 then
    raise notice 'No CRS room type is matched at % yet: every CRS booking will wait under "Needs attention" until the card matches them.', v_code;
  end if;
  if not v_on then
    raise notice 'Reading is switched OFF at %: switch on "Read bookings from the CRS" on the card when ready.', v_code;
  end if;
end $$;

commit;

-- How it stands now, whatever this run did.
select h.code as hotel, s.email as reads_as, sh.role, ch.is_on as switched_on,
       (select count(*) from crs_room_types t where t.hotel_id = h.id) as room_types_matched
  from hotels h
  join crs_hotels ch on ch.hotel_id = h.id
  left join staff s on s.id = ch.run_as
  left join staff_hotels sh on sh.staff_id = s.id and sh.hotel_id = h.id
 where h.code = upper(btrim(:'hotel'));
