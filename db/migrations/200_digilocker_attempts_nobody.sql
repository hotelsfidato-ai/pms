-- =============================================================================
-- 200 · The DigiLocker table's "nobody" rule, written down (the owner, 4 October)
-- =============================================================================
-- 182 locked guest_digilocker_attempts with forced row security and no grant:
-- only its three definer functions, owned by pms_migrate (BYPASSRLS), touch it.
-- With no policy at all that already denies everybody, but the nightly restore
-- check (db/verify-backup.sh) counts every hotel table without a policy as a
-- lost rule and has reported "1 (expected 0)" every night since. The owner
-- chose an explicit rule over teaching the check an exception: the same lock,
-- now in writing. The definer functions bypass row security, so nothing they
-- do changes. Re-runnable.
-- The master renumbers at merge; refer to this file as "DigiLocker nobody".
-- =============================================================================

drop policy if exists nobody on guest_digilocker_attempts;
create policy nobody on guest_digilocker_attempts
  for all using (false) with check (false);
