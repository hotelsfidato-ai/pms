-- =============================================================================
-- 269 · The resets know the allotments and the waitlist (D27-383 item 8)
-- =============================================================================
-- Two lists every hotel-scoped table must be on, and 267 and 268 added three:
--
--   app.test_hotel_classes()  212's rule: every table is setup, trading, never
--                             or group (db/tests/modules/test-hotels.sql fails
--                             on one in none). allotments, allotment_releases
--                             and waitlist are trade, as contracts and
--                             contract_rates are: a test hotel's Reset clears
--                             them with the rest.
--   owner_reset.steps()       the owner's full reset clears a hotel's trade in
--                             foreign-key order (api/test/resetOrder.test.ts).
--                             A waitlist entry points at its booking, so the
--                             hotel's waitlist goes just before its bookings.
--                             Allotments stay, as their contracts do.
--
-- Each is added where it stands, beside an entry every version carries, as
-- cp6's own migrations add theirs (262, 266): the list is never copied whole,
-- so another migration's entries are kept. Re-runnable: once added, it is not
-- added again.
-- =============================================================================

do $$
declare d text := pg_get_functiondef('app.test_hotel_classes()'::regprocedure);
begin
  if position('allotment_releases' in d) = 0 then
    execute replace(d, $q$('contract_rates', 'trading')$q$,
      $q$('contract_rates', 'trading'), ('allotments', 'trading'), ('allotment_releases', 'trading'), ('waitlist', 'trading')$q$);
  end if;
end $$;

do $$
declare d text := pg_get_functiondef('owner_reset.steps(boolean)'::regprocedure);
begin
  if position('["waitlist"' in d) = 0 then
    execute replace(d, $q$["reservations",$q$,
      $q$["waitlist",                  "hotel_id = $1"],
        ["reservations",$q$);
  end if;
end $$;
