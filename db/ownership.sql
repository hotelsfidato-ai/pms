-- =============================================================================
-- ownership.sql — run LAST, after every migration, in the same transaction
-- =============================================================================
-- 014 hands every table and every app function to pms_migrate, but only the
-- ones that exist when 014 runs. A table or function a LATER migration makes
-- in the same run stays owned by whoever ran it (the superuser) until the next
-- deploy replays 014.
--
-- That mixed state is exactly a first deploy's: a definer function that
-- already existed (owned by pms_migrate after 014) is refused the table the
-- same run just made ("permission denied for table hotel_bank_details" broke
-- the voucher on the first migrate of a working database, 1 October). The
-- second deploy would have healed it; the first day would not have worked.
--
-- So every run ends in the state every later run would reach anyway: 014's
-- transfer, again, at the end. Nothing else. pms_migrate has BYPASSRLS (010),
-- so owning the tables changes nothing about who can read what through the
-- policies; it only stops a definer being refused its own schema's tables.
-- Applied by db/migrate.sh, api/scripts/with-test-db.sh and db/tests/run.sh.
-- =============================================================================

alter schema app owner to pms_migrate;
grant usage, create on schema app to pms_migrate;

do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I owner to pms_migrate', t.tablename);
  end loop;

  for t in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
  loop
    execute format('alter function app.%I(%s) owner to pms_migrate', t.proname, t.args);
  end loop;
end
$$;

-- ── A privileged function is the API's to run, not anybody's (audit, 10 Nov,
-- item 10) ────────────────────────────────────────────────────────────────────
-- Postgres lets EVERY login run a new function. For a security definer that
-- means any login at all ran with pms_migrate's rights: 80 of them on 10 Nov.
-- Harmless while pms_app is the only login that reaches them, but the preflight's
-- reader, the reset login and any login added later had them too. pms_app keeps
-- each one it could run (granted here first, so nothing it does changes);
-- everybody else loses them. Here, not in a migration, so a function a LATER
-- migration makes is closed the same way without anybody remembering to.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.prosecdef
       and has_function_privilege('public', p.oid, 'execute')
  loop
    execute format('grant execute on function %s to pms_app', f.sig);
    execute format('revoke execute on function %s from public', f.sig);
  end loop;
end
$$;
