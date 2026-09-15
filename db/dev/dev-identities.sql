-- =============================================================================
-- dev-identities.sql — sign-in identities for LOCAL DEVELOPMENT ONLY
-- =============================================================================
-- ⚠ THIS IS NOT A MIGRATION, AND IT MUST NEVER BECOME ONE.
--
-- It lives in db/dev/ rather than db/migrations/ so a production migration run
-- cannot pick it up. 017 had to go back and DELETE seven placeholder properties
-- that a seed migration would otherwise have shipped; the lesson is that dev
-- fixtures do not belong in the numbered set at all.
--
-- WHAT IT DOES:
--   Gives the seeded staff a firebase_uid, so the interface can sign in without
--   a Firebase service account. `app.current_user_id()` already resolves a uid
--   through staff.firebase_uid — migration 017 did that work — so these go
--   straight into app.user_id with no extra function, no extra policy, and no
--   read of `staff` outside RLS.
--
--   That also means the dev path exercises the REAL resolution path rather than
--   a parallel one. The only thing missing in development is Firebase verifying
--   the token; everything after that is the production code.
--
-- WHY THESE UIDS ARE SAFE TO WRITE DOWN:
--   They are only usable through the API's ALLOW_DEV_AUTH header, and
--   api/src/env.ts THROWS at startup if that is set with NODE_ENV=production.
--   A real Firebase uid overwrites these the moment a person actually signs up.
-- =============================================================================

update staff set firebase_uid = 'dev-owner' where email = 'owner@fidato.in';
update staff set firebase_uid = 'dev-agra'  where email = 'agra@fidato.in';
update staff set firebase_uid = 'dev-pune'  where email = 'pune@fidato.in';

-- Every uid must land on exactly one row, or the sign-in page offers an
-- identity that does not resolve and the failure looks like a bug in auth.
do $$
declare n int;
begin
  select count(*) into n
    from staff
   where firebase_uid in ('dev-owner', 'dev-agra', 'dev-pune');

  if n <> 3 then
    raise exception
      'dev-identities: expected 3 staff with dev uids, found %. '
      'Has 008_seed.sql changed the demo emails?', n;
  end if;
end $$;

\echo '  ✓ dev identities: dev-owner, dev-agra, dev-pune'
