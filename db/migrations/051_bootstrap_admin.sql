-- =============================================================================
-- 051 — the first real person
-- =============================================================================
-- 008 seeded a bootstrap group admin with a deliberately fake address,
-- 'REPLACE@fidato.in', and said so: the thing that creates users requires a
-- user, so the first one cannot be made from inside the app.
--
-- This is that replacement. It is a migration rather than a dev fixture
-- because PRODUCTION needs it: `launch.sh` runs the migrations and then a
-- person has to sign in, and a Firebase account with no matching staff row
-- authenticates perfectly and then sees nothing at all. Every policy resolves
-- through `app.current_user_id()`, which resolves a 28-character uid through
-- `staff.firebase_uid` — no row, no hotels, an empty application and no error
-- message explaining why.
--
-- THE UID IS NOT A SECRET. It is a public subject identifier, the same thing
-- that travels in every ID token. The service account private key is the
-- secret, and that lives in api/.env, which is gitignored.
--
-- WHEN THE ACCOUNT CHANGES: deleting and recreating the Firebase user issues a
-- NEW uid, and this row then points at nobody. The symptom is the same empty
-- application. The fix is one update, and this file is where to make it.
--
-- RE-RUNNABLE, deliberately. Migrations on this project are applied by a glob
-- loop that does not track what it has already run, so a file that only works
-- once breaks the second deploy. This one can be applied any number of times.
-- =============================================================================

-- Take over the placeholder if it is still standing and the real account has
-- not already been created. Preserves the row's id, so anything that grew a
-- reference to the bootstrap admin keeps pointing at the same person.
update staff
   set email        = 'influvateseo@gmail.com',
       full_name    = 'Jaison Rozario',
       firebase_uid = 'DDRtG1cUhdds8iWzMwJ4u2ZMB5n2',
       is_group_admin = true,
       is_active    = true
 where email = 'REPLACE@fidato.in'
   and not exists (
     select 1 from staff where email = 'influvateseo@gmail.com');

-- And if there was no placeholder — a database seeded some other way, or this
-- file running a second time — make sure the account exists and is linked.
insert into staff (email, full_name, is_group_admin, firebase_uid, is_active)
values ('influvateseo@gmail.com', 'Jaison Rozario', true,
        'DDRtG1cUhdds8iWzMwJ4u2ZMB5n2', true)
on conflict (email) do update
   set firebase_uid   = excluded.firebase_uid,
       is_group_admin = true,
       is_active      = true;

-- A group admin sees every hotel through app.auth_hotel_ids() without any
-- staff_hotels rows, so there is nothing further to grant.

comment on column staff.firebase_uid is
  'The Firebase subject. Development identities use readable placeholders '
  '(dev-owner and friends, set by db/dev/dev-identities.sql, never a '
  'migration); real accounts carry the 28-character uid. A staff row with no '
  'uid can never sign in — it can only be acted upon by somebody who can.';
