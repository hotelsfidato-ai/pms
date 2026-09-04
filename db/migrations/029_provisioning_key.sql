-- =============================================================================
-- 029_provisioning_key.sql — no DDL without the key
-- =============================================================================
-- `app.require_group_admin()` already asks WHO you are. This asks something
-- different: whether this particular act was authorised, on this deployment,
-- by somebody holding a secret that is not in the database.
--
-- The two are not redundant. A group admin's session is a bearer token in a
-- browser — stolen, borrowed, or left signed in on a desk. Creating a
-- property is not an act you want reachable from a session alone, because it
-- is the one act that manufactures a whole tenant: rooms, an invoice series,
-- a folio namespace. Deleting is guarded everywhere in this schema; creating
-- was not guarded at all.
--
-- THE KEY IS NEVER IN THIS DATABASE.
--
-- Only its hash is, exactly as `pos_outlets.api_key_hash` holds only the hash
-- of an outlet's key. A dump of this database, or a backup on somebody's
-- laptop, does not let the holder provision anything. The key itself lives
-- where the deployment puts it — Firestore config, or the API's environment.
--
-- WHAT IT DOES NOT DO
--
-- It is not authentication and it is not a second password. It cannot tell
-- you who acted; `require_group_admin()` does that and still runs. This only
-- says "this deployment permits structural changes right now", and its most
-- valuable state is ABSENT: a production box with no key configured cannot
-- have a property created on it by anyone, including whoever holds the
-- database superuser.
-- =============================================================================


create table if not exists provisioning_keys (
  id          uuid primary key default gen_random_uuid(),

  -- What the key is for, so a rotation leaves a trail rather than a mystery.
  label       text not null,

  -- sha256 of the key, hex. NEVER the key.
  key_hash    text not null unique,

  is_active   boolean not null default true,

  -- Who minted it and when. A key that appears with no author is the row
  -- nobody can account for during an audit.
  created_by  uuid references staff(id),
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  revoked_by  uuid references staff(id),

  -- Last use, so a key nobody has touched in a year is visible as such.
  last_used_at timestamptz,

  constraint provisioning_keys_revoked_complete check (
    (revoked_at is null) = (revoked_by is null)),
  constraint provisioning_keys_revoked_is_inactive check (
    revoked_at is null or not is_active)
);

comment on table provisioning_keys is
  'Hashes of the keys that permit structural change. The keys themselves are '
  'never stored here — a dump of this database provisions nothing.';


-- -----------------------------------------------------------------------------
-- The gate
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER because the caller must not need SELECT on this table to
-- be checked against it — the same reason app.pos_outlet_for_key() is.
--
-- Takes the HASH. The API hashes the key it was given and sends the digest,
-- so the key never travels to the database and never reaches a query log.
-- -----------------------------------------------------------------------------
create or replace function app.require_provisioning_key(p_key_hash text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_id uuid;
begin
  if p_key_hash is null or length(p_key_hash) <> 64 then
    raise exception
      'A provisioning key is required for this operation. This deployment '
      'permits no structural change without one.'
      using errcode = 'insufficient_privilege';
  end if;

  select id into v_id
    from provisioning_keys
   where key_hash = p_key_hash and is_active;

  if v_id is null then
    /* Deliberately the same message as a missing key. A caller probing for
       a valid one learns nothing from the difference between "absent" and
       "wrong". */
    raise exception
      'A provisioning key is required for this operation. This deployment '
      'permits no structural change without one.'
      using errcode = 'insufficient_privilege';
  end if;

  update provisioning_keys set last_used_at = now() where id = v_id;
end $$;

comment on function app.require_provisioning_key(text) is
  'Raises unless the digest matches an active provisioning key. Takes the '
  'hash, never the key.';


-- -----------------------------------------------------------------------------
-- The mechanism and the door are different functions
-- -----------------------------------------------------------------------------
-- The first attempt at this ADDED an eight-argument overload beside the
-- existing seven-argument one, so that old callers would "fail to compile".
-- They failed, but not usefully:
--
--     ERROR: function app.provision_property(unknown, unknown, unknown,
--            unknown, unknown) is not unique
--
-- An ambiguous overload is a worse error than a missing function, because it
-- reads as a typo rather than as a rule. And it left a completely unguarded
-- path in place under the same name, which is the opposite of the intent.
--
-- So: the seven-argument function is RENAMED to say what it is. It still
-- exists, because migrations and the demo loader legitimately need it — they
-- run as the owner, outside any session, where require_group_admin() has no
-- session to check and would fail on its own correctness.
--
--     provision_property_unchecked()   the mechanism
--     provision_property()             the door
--
-- The same separation this codebase already makes between `pos` (a machine
-- with a key) and `posAdmin` (a person with a session).
-- -----------------------------------------------------------------------------

/* RE-RUNNABLE. A rename is a one-way move: on a second deploy 009 and 014
   have recreated the seven-argument `provision_property`, while
   `provision_property_unchecked` still exists from the first run — and this
   statement aborts with "function ... already exists".

   Clearing both first is deliberate rather than merely convenient: the point
   of the rename is that `_unchecked` holds whatever 009 and 014 most
   recently defined. Keeping the old copy would leave a deploy running last
   year's provisioning logic under a name nobody thinks to look at.

   The eight-argument door goes too, because it depends on `_unchecked`. It
   is recreated below. */
do $rerun$
begin
  if exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app' and p.proname = 'provision_property_unchecked'
  ) then
    drop function if exists
      app.provision_property(text,text,text,text,text,text,text,text);
    drop function if exists
      app.provision_property_unchecked(text,text,text,text,text,text,text);
  end if;
end $rerun$;

alter function app.provision_property(text, text, text, text, text, text, text)
  rename to provision_property_unchecked;

comment on function app.provision_property_unchecked(text,text,text,text,text,text,text) is
  'Creates a property and its rooms. NO authorisation of any kind — for '
  'migrations, the demo loader and the test suite, which run as the owner '
  'outside any session. Application code calls provision_property().';


-- -----------------------------------------------------------------------------
-- One role, one function, and nothing else
-- -----------------------------------------------------------------------------
-- 013_policies.sql gives `hotels` no INSERT policy at all, on purpose:
--
--     "No insert policy: properties arrive only through
--      app.provision_property()."
--
-- That is right — it is what stops a half-built property with no room types
-- and no invoice series. But it also means the API could not create one, and
-- the first attempt at this route came back with
--
--     new row violates row-level security policy for table "hotels"
--
-- SECURITY DEFINER alone does not fix it. `hotels`, `room_types` and `rooms`
-- are owned by pms_migrate and carry FORCE row level security, which applies
-- to the owner as well; and pms_migrate has no BYPASSRLS. A definer function
-- owned by it is still subject to the policy.
--
-- The options were: add an INSERT policy for group admins (which reopens the
-- half-built-property hole 013 closed), give pms_migrate BYPASSRLS (which
-- weakens every table at once), or this — a role that exists solely to own
-- this one function.
--
-- pms_provisioner has BYPASSRLS and NOLOGIN. Nothing can connect as it and
-- nothing else is owned by it. The privilege reaches exactly one function,
-- and that function refuses twice before it uses it.
-- -----------------------------------------------------------------------------
do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'pms_provisioner') then
    create role pms_provisioner nologin bypassrls;
  else
    alter role pms_provisioner nologin bypassrls;
  end if;
end
$role$;

create or replace function app.provision_property(
  p_code          text,
  p_name          text,
  p_city          text,
  p_key_hash      text,
  p_state         text default null,
  p_gstin         text default null,
  p_template_set  text default 'standard',
  p_timezone      text default 'Asia/Kolkata'
)
returns uuid
language plpgsql
security definer
-- Pinned. A definer function with a searchable path is how a caller gets
-- their own `staff` table in front of the real one.
set search_path = public, pg_temp
as $$
begin
  /* Order matters. WHO first, then WHETHER — somebody who is not an admin
     should be told that, rather than handed a key prompt to probe against. */
  perform app.require_group_admin();
  perform app.require_provisioning_key(p_key_hash);

  return app.provision_property_unchecked(
    p_code         => p_code,
    p_name         => p_name,
    p_city         => p_city,
    p_state        => p_state,
    p_gstin        => p_gstin,
    p_template_set => p_template_set,
    p_timezone     => p_timezone
  );
end $$;

alter function app.provision_property(text,text,text,text,text,text,text,text)
  owner to pms_provisioner;

/* The definer role needs to reach what the function calls. Without this it
   authenticates, passes both guards, and then fails on
   `permission denied for schema app` — which reads like a bug in the guards
   and is not.

   USAGE on the schema, EXECUTE on the three functions it actually calls.
   Not blanket EXECUTE on the schema: this role bypasses RLS, and the list
   of things it may run should be readable in one glance. */
grant usage on schema app to pms_provisioner;
grant execute on function app.require_group_admin()          to pms_provisioner;
grant execute on function app.require_provisioning_key(text) to pms_provisioner;
grant execute on function
  app.provision_property_unchecked(text,text,text,text,text,text,text)
  to pms_provisioner;

/* BYPASSRLS bypasses POLICIES, not GRANTS. The role still needs table
   privileges, and the second failure after the schema one was
   `permission denied for table hotels`.

   These are exactly the four tables the provisioning function touches —
   three written, one read — and nothing else. A role that can bypass row
   security should not also be able to reach tables it has no business in. */
grant insert, select on hotels         to pms_provisioner;
grant insert, select on room_types     to pms_provisioner;
grant insert, select on invoice_series to pms_provisioner;
grant select          on room_type_templates to pms_provisioner;

/* And only pms_app may call it. Not PUBLIC: a definer function that
   bypasses RLS should not be callable by anything that happens to have a
   connection. */
revoke all on function app.provision_property(text,text,text,text,text,text,text,text)
  from public;
grant execute on function app.provision_property(text,text,text,text,text,text,text,text)
  to pms_app;

comment on function app.provision_property(text,text,text,text,text,text,text,text) is
  'The door. A group admin AND an active provisioning key, then it provisions. '
  'Owned by pms_provisioner (BYPASSRLS, NOLOGIN) because 013 gives hotels no '
  'INSERT policy by design — the privilege reaches this function and nothing '
  'else.';


-- -----------------------------------------------------------------------------
-- Who may read the keys
-- -----------------------------------------------------------------------------
-- Nobody, through the application. The API needs to CHECK a key, which
-- require_provisioning_key() does for it as SECURITY DEFINER; it never needs
-- to list them. Reading the table would hand an attacker the hashes to
-- attack offline.
--
-- Minting and revoking are administrative acts performed with a superuser
-- connection, like creating a POS outlet. There is deliberately no API for
-- it: a system that can mint its own provisioning keys does not have a
-- provisioning key.
-- -----------------------------------------------------------------------------
revoke all on provisioning_keys from pms_app;
grant execute on function app.require_provisioning_key(text) to pms_app;

alter table provisioning_keys enable row level security;
alter table provisioning_keys force  row level security;
-- No policy at all: RLS with no permissive policy denies everything, which
-- is the intent. The SECURITY DEFINER function is the only way in.
