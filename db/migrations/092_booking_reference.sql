-- =============================================================================
-- 092 — one booking reference, made in one place, under a lock
-- =============================================================================
-- RES-2 (src/modules/reservations/DEFECTS.md). Every booking reference in this
-- system was being made by one of two copies of the same SQL, written inline
-- in two routes that belong to two different services:
--
--   front-desk   walk-ins    'FH-' || YYMM || '-' || (max + 1)
--   reservations bookings    'FH-' || DDMM || '-' || (max + 1)
--
-- Three faults, one of them hidden:
--
--   1. NO LOCK. Two bookings in the same second both read the same maximum,
--      both build the same reference, and `unique (hotel_id, reference)`
--      (005) refuses the second. A booking site and the desk booking at the
--      same moment is exactly what the channel manager will do all day.
--
--   2. TWO DATE FORMATS. `FH-2608-4858` from a walk-in is August 2026; from
--      the bookings route it is the 26th of August. Nobody reading one could
--      know which.
--
--   3. TRUNCATION — found writing this. Both copies pad the number with
--      `lpad(n, 4, '0')`, and Postgres's lpad does not only pad: it CUTS a
--      longer string to the length asked for. `lpad('12345', 4, '0')` is
--      `1234`. The numbers start at 5001, so after about five thousand
--      bookings at one hotel every new reference would be the first four
--      digits of the next number — the same four digits every time — and
--      every booking after that would be refused as a duplicate.
--
-- `app.next_reference` (005) already had the lock — a per-hotel advisory
-- lock, so a busy Akkalkot desk never blocks Pune — and nothing had ever
-- called it. This gives it the format the owner chose and makes it the one
-- place a reference comes from. The two routes are switched over to it by
-- their own services (reservations, front-desk); this file changes neither.
--
-- THE FORMAT, decided by the owner on 16 September:
--
--     FH-<hotel code>-<YYMM>-<number>          FH-5EL-2608-4858
--
--   FH           Fidato
--   hotel code   hotels.code — a reference says which property it belongs to
--   YYMM         the year and month the booking was MADE, on the hotel's own
--                clock (hotels.timezone): a booking taken at 00:30 in Akkalkot
--                on the 1st belongs to the new month, which `now()` in UTC
--                would still call the old one
--   number       the hotel's running count, continued from whatever this
--                hotel has already issued, so no reference ever repeats
--                across the change; at least four digits, never cut
--
-- OLD BOOKINGS KEEP THEIR REFERENCES. Nothing here rewrites a row. A voucher
-- already in a guest's hand still matches the booking it names.
-- =============================================================================

create or replace function app.next_reference(p_hotel_id uuid)
returns text
language plpgsql
as $$
declare
  v_code text;
  v_tz   text;
  v_next bigint;
begin
  select code, timezone into v_code, v_tz from hotels where id = p_hotel_id;
  if v_code is null then
    raise exception 'Unknown hotel %', p_hotel_id;
  end if;

  -- Serialise number allocation for THIS hotel only, until the transaction
  -- that asked for the number ends. The caller must insert the reservation
  -- in the SAME transaction: the next caller waits here, and then sees that
  -- row when it reads the maximum.
  perform pg_advisory_xact_lock(hashtext('reservation_ref:' || p_hotel_id::text));

  -- The trailing digits of every reference this hotel holds, whatever shape
  -- it was issued in: `FH-2608-5001`, `FH-5EL-2608-5002` and a reference
  -- imported from anywhere else all end in the number. 5000 is where both
  -- inline generators started, so a hotel with no bookings yet begins at
  -- 5001, as it always has.
  select coalesce(max(substring(reference from '[0-9]+$')::bigint), 5000) + 1
    into v_next
    from reservations
   where hotel_id = p_hotel_id;

  return 'FH-' || v_code
      || '-' || to_char(now() at time zone coalesce(v_tz, 'Asia/Kolkata'), 'YYMM')
      -- NOT lpad(v_next, 4, '0') alone: lpad CUTS a longer number to four
      -- digits. Pad only what is shorter.
      || '-' || case when length(v_next::text) < 4
                     then lpad(v_next::text, 4, '0')
                     else v_next::text end;
end
$$;

comment on function app.next_reference(uuid) is
  'The next booking reference for a hotel: FH-<hotel code>-<YYMM>-<number>, '
  'e.g. FH-5EL-2608-4858. Takes a per-hotel lock held until the transaction '
  'ends, so the caller must insert the reservation in that same transaction. '
  'The number continues the hotel''s existing count and is never truncated. '
  'The one place a reference comes from (RES-2).';

grant execute on function app.next_reference(uuid) to pms_app;
