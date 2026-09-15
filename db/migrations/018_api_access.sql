-- =============================================================================
-- 018_api_access.sql — what the App API needs and the schema did not yet give it
-- =============================================================================
-- Written at CP7, when the API tier was built and immediately hit a wall.
--
-- WHAT WENT WRONG:
--   `staff_hotels` had `force row level security` and ZERO policies. For
--   pms_app that is deny-all: every select returns 0 rows, silently, with no
--   error. Isolation still worked, because `app.auth_hotel_ids()` is SECURITY
--   DEFINER and reads the table as owner — so nothing looked broken. The API
--   asked "which properties may I work in, and as what role" and got an empty
--   list back, which reads as "none" and is not the same fact as "denied".
--
--   A deny-all table nobody is allowed to query is a defensible default. A
--   deny-all table the application must query is a silent empty list, which is
--   the worst of both: no error to notice, and no data to act on.
--
-- WHAT THIS ADDS:
--   One policy. A person may read their OWN access rows and nobody else's.
--   That is exactly what the interface needs to decide which property switcher
--   entries to draw, and no more.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- staff_hotels — read your own grants.
-- -----------------------------------------------------------------------------
-- No recursion risk, and it is worth saying why, because 017 records the
-- version of this that DID recurse:
--
--   app.current_user_id() is SECURITY DEFINER. Its read of `staff` runs as
--   owner and does not re-enter `staff_self`. So this policy calls a function
--   that bypasses policies, rather than a function that triggers them.
--
-- Read only. Granting a hotel to a person is an administrative act and belongs
-- to pms_admin, never to the app role — a clerk who could insert here could
-- grant themselves the property next door.
-- -----------------------------------------------------------------------------
drop policy if exists staff_hotels_self on staff_hotels;
create policy staff_hotels_self on staff_hotels
  for select
  using ( staff_id = app.current_user_id() );


-- -----------------------------------------------------------------------------
-- The regression this closes.
-- -----------------------------------------------------------------------------
-- Recorded here rather than only in the suite, because the failure mode is an
-- empty result and not an error — the kind that passes a test written to
-- assert "no exception".
--
--   before:  select count(*) from staff_hotels  →  0   (as the Agra clerk)
--   after:   select count(*) from staff_hotels  →  1
--            and still 0 rows belonging to anyone else.
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'staff_hotels'
       and policyname = 'staff_hotels_self'
  ) then
    raise exception '018: staff_hotels_self policy was not created';
  end if;
end $$;
