-- =============================================================================
-- 084 · A general manager runs their own hotel
-- =============================================================================
-- Until now every act that concerns a PERSON went through
-- `app.require_group_admin()`. That is one owner, for seven hotels, deciding
-- who may open a till in Akkalkot on a Sunday.
--
-- The owner's instruction on 9 September:
--
--     "in the admin console there needs to be the ability to add property and
--      add GM, so when GM logs in he is able to give access to his staff, and
--      this is separate for each property at the property level"
--
-- ⚠ `app.is_manager()` LOOKS LIKE THE ANSWER AND IS NOT. It returns true for
-- anybody who is owner or gm at ANY property:
--
--     ... and sh.role in ('owner','gm')                 -- no hotel_id
--
-- So the GM of Akkalkot passes `is_manager()` while standing in Pune. Used as
-- the gate on "give this person access to that hotel", it would let every
-- manager in the group roster staff at every other manager's hotel. The
-- predicate below asks about ONE hotel, and that is the whole difference.
--
-- ⚠ AND A MANAGER MAY NOT APPOINT AN OWNER. `owner` is the top role at a
-- property — `src/lib/permissions.ts` grants it every action on every
-- resource. A gm who could assign it could assign it to themselves, which is
-- escalation wearing a lateral move's clothes. They may appoint another gm,
-- because a relief manager is an ordinary thing and a gm is what they already
-- are.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Does this person run THAT hotel?
-- -----------------------------------------------------------------------------
create or replace function app.manages_hotel(p_hotel uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    -- A group administrator runs all of them, and needs no row per property.
    select 1 from staff s
     where s.id = app.current_user_id() and s.is_active and s.is_group_admin
  ) or exists (
    select 1 from staff_hotels sh
      join staff s on s.id = sh.staff_id
     where sh.staff_id = app.current_user_id()
       and sh.hotel_id = p_hotel            -- ⚠ THIS LINE IS THE POINT
       and s.is_active
       and sh.role in ('owner', 'gm')
  );
$$;

comment on function app.manages_hotel(uuid) is
  'Group administrator, or owner/gm AT THIS HOTEL. Unlike app.is_manager(), '
  'which answers "are you a manager anywhere" and would let the manager of '
  'one property roster staff at another.';

grant execute on function app.manages_hotel(uuid) to pms_app;


create or replace function app.require_hotel_admin(p_hotel uuid)
returns void
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if app.manages_hotel(p_hotel) then return; end if;
  raise exception
    'Only the manager of this property, or a group administrator, can change '
    'who works here.'
    using errcode = 'insufficient_privilege',
          hint = 'Ask the property manager, or whoever holds group access.';
end $$;

comment on function app.require_hotel_admin(uuid) is
  'The refusal a person reads, raised from the database so it holds for any '
  'caller — a route, a script, a later endpoint. Rule 6.';

grant execute on function app.require_hotel_admin(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- Which roles may this caller hand out at that hotel?
-- -----------------------------------------------------------------------------
-- ⚠ WRITTEN AS A FUNCTION SO THE LIST HAS ONE HOME. The screen greys out what
-- it may not offer and the server refuses it independently; both ask this. A
-- second copy in TypeScript is how the roles list drifted before — 078 exists
-- because `permissions.ts` offered three roles the CHECK constraint had never
-- heard of, and assigning any of them returned "Something went wrong".
-- -----------------------------------------------------------------------------
create or replace function app.grantable_roles(p_hotel uuid)
returns text[]
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    when exists (select 1 from staff s
                  where s.id = app.current_user_id()
                    and s.is_active and s.is_group_admin)
      then app.assignable_roles()
    when app.manages_hotel(p_hotel)
      -- Everything except `owner`. A gm who could appoint an owner could
      -- appoint themselves one, and `owner` grants every action on every
      -- resource at that property.
      then array(select r from unnest(app.assignable_roles()) r
                  where r <> 'owner')
    else array[]::text[]
  end;
$$;

comment on function app.grantable_roles(uuid) is
  'The roles this caller may assign at this hotel. Empty when they may not '
  'assign any — which the screen shows as a refusal rather than an empty '
  'picker with no explanation.';

grant execute on function app.grantable_roles(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- Whose password may this caller set?
-- -----------------------------------------------------------------------------
-- The owner's answer on 9 September: a manager resets anybody rostered at
-- their hotel, so a forgotten password on a Sunday does not stop somebody
-- working.
--
-- ⚠ AND NEVER A GROUP ADMINISTRATOR. A gm who could reset the owner's
-- password could sign in as the owner and reach all seven properties. That is
-- not a lateral move, and it is the one door this whole file must not open.
-- The check is here rather than in the route because a rule enforced in one
-- endpoint is enforced in that endpoint only.
-- -----------------------------------------------------------------------------
create or replace function app.may_manage_person(p_staff uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select case
    -- Anybody may change their OWN details, whatever their role.
    when p_staff = app.current_user_id() then true
    when exists (select 1 from staff s
                  where s.id = app.current_user_id()
                    and s.is_active and s.is_group_admin) then true
    -- ⚠ NEVER A GROUP ADMINISTRATOR, whatever else is true.
    when exists (select 1 from staff t where t.id = p_staff
                   and t.is_group_admin) then false
    -- A property manager: somebody rostered at a hotel they run.
    else exists (
      select 1 from staff_hotels sh
       where sh.staff_id = p_staff
         and app.manages_hotel(sh.hotel_id)
    )
  end;
$$;

comment on function app.may_manage_person(uuid) is
  'Yourself, always. A group administrator, anybody. A property manager, '
  'anybody rostered at a hotel they run — never a group administrator. '
  'The ONE definition: the row policies on `staff` ask it and so does '
  'app.may_set_password.';

grant execute on function app.may_manage_person(uuid) to pms_app;


-- Setting a password is the same question asked at the moment it matters
-- most, and it keeps its own name because that is what the endpoint and
-- the screen are about. One definition, two words for it.
create or replace function app.may_set_password(p_staff uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.may_manage_person(p_staff);
$$;

comment on function app.may_set_password(uuid) is
  'app.may_manage_person, named for the act. Resetting a group '
  'administrator''s password is how a property manager becomes one, which '
  'is why that case is refused inside the shared definition rather than '
  'here — a rule written in the endpoint protects the endpoint.';

grant execute on function app.may_set_password(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- ⚠ AND THE POLICIES, BECAUSE A PREDICATE THE ROUTES CALL IS NOT A PERMISSION
-- -----------------------------------------------------------------------------
-- The functions above were written first and the tests failed with:
--
--     new row violates row-level security policy for table "staff_hotels"
--
-- which is the database doing its job. `staff_hotels` has carried
-- INSERT/UPDATE/DELETE policies of `app.is_group_admin()` since 020, so a
-- general manager passed every check the API made and was refused by the only
-- authority that counts.
--
-- That failure is the argument for this whole design: the route's guard is
-- Rule 6 — the sentence a person reads — and the policy is the rule. If they
-- ever disagree, the policy wins and nothing is corrupted.
-- -----------------------------------------------------------------------------

-- ── staff_hotels: the row that IS the isolation ───────────────────────────
drop policy if exists staff_hotels_manager_read on staff_hotels;
create policy staff_hotels_manager_read on staff_hotels
  for select using ( app.manages_hotel(hotel_id) );

drop policy if exists staff_hotels_manager_write on staff_hotels;
create policy staff_hotels_manager_write on staff_hotels
  for insert with check ( app.manages_hotel(hotel_id) );

drop policy if exists staff_hotels_manager_update on staff_hotels;
create policy staff_hotels_manager_update on staff_hotels
  for update using ( app.manages_hotel(hotel_id) )
             with check ( app.manages_hotel(hotel_id) );

drop policy if exists staff_hotels_manager_delete on staff_hotels;
create policy staff_hotels_manager_delete on staff_hotels
  for delete using ( app.manages_hotel(hotel_id) );

comment on policy staff_hotels_manager_write on staff_hotels is
  'A manager rosters their own hotel. The hotel_id in the predicate is what '
  'stops them rostering anybody else''s — app.is_manager() has none, and '
  'would have let the manager of one property staff all seven.';


-- ── staff: creating and correcting a person ───────────────────────────────
-- ⚠ AN INSERT INTO `staff` HAS NO hotel_id, so this cannot be scoped the way
-- the grant above is. `app.is_manager()` is the only thing available, and it
-- means any manager may create a PERSON.
--
-- That is safe, and the reason is worth stating: a staff row on its own
-- grants nothing at all. Every RLS policy in this system reads
-- `app.auth_hotel_ids()`, which reads `staff_hotels` — so a person with no
-- grant sees an empty application. The dangerous half is the grant, and the
-- grant is scoped.
--
-- `not is_group_admin` is the line that matters. Without it a general manager
-- could insert somebody who reaches all seven properties, and `staff_hotels`
-- would never be consulted.
drop policy if exists staff_manager_write on staff;
create policy staff_manager_write on staff
  for insert with check ( app.is_manager() and not is_group_admin );

drop policy if exists staff_manager_update on staff;
create policy staff_manager_update on staff
  for update using ( app.may_manage_person(id) )
             -- The row after the change must still not be a group admin.
             -- Otherwise a manager promotes a clerk and inherits the group.
             with check ( not is_group_admin );

comment on policy staff_manager_update on staff is
  'A manager corrects a name, a phone or a firebase_uid for somebody at '
  'their hotel. The WITH CHECK refuses the row that comes OUT being a group '
  'administrator, which is the escalation this file exists to prevent.';


-- -----------------------------------------------------------------------------
-- Where the Firebase account is recorded
-- -----------------------------------------------------------------------------
-- `staff.firebase_uid` has existed since 002 and nothing in the application
-- ever wrote it. It was filled by `npm run link-staff` on the server, by hand,
-- from the Firebase console — which is why a person added through the screen
-- could not sign in: the row existed, the account did not, and there was no
-- password anywhere to type.
--
-- Nothing changes in the schema here. The comment is updated because the
-- sentence it carried described a workflow that is being replaced.
-- -----------------------------------------------------------------------------
comment on column staff.firebase_uid is
  'The Firebase account that signs this person in. Written by the API when '
  'somebody is added with a password; `npm run link-staff` remains for '
  'accounts that already existed in Firebase before this system did. NULL '
  'means they have no way to sign in yet, and every screen that lists people '
  'says so rather than leaving them to find out at a terminal.';
