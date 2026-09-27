-- =============================================================================
-- 148 · The group's name and logo, chosen in Settings (D27-53, D27-65)
-- =============================================================================
-- D27-53: "One logo for the whole group, chosen in Settings, printed on every
-- bill. A setting, not code (D21-27)." D27-65: every bill's masthead is the
-- property's name and under it "by <group name>", and the group's name comes
-- from the same group setting as the logo. Every copy of this system belongs
-- to ONE group (D21-1), so the setting is one row, GROUP-LEVEL like `hotels`
-- itself: no hotel_id.
--
-- ⚠ NEITHER THE NAME NOR THE LOGO EVER GOES IN A MIGRATION. This file makes
-- the table and leaves it EMPTY. Migrations replay in every buyer's copy, and
-- a buyer's copy starts with neither: bills print the hotel's name alone until
-- somebody types the group's and uploads a logo. The Fidato copy is filled
-- through Settings like any other.
--
-- WHO (the owner, 27 September): the owner, an administrator or a general
-- manager - at any hotel of the group - and a group administrator. The server
-- asks the same through the role gate before anything is written; this is the
-- database's own answer, which holds whatever route reaches the table.
--
-- WHAT: a name of 1 to 80 characters, or none; a PNG or an SVG logo, 200 KB at
-- most (the owner, 27 September), or none. The server checks the file by its
-- content, not its name, and refuses an SVG carrying a script; the
-- constraints here are the backstop.
-- =============================================================================

create table if not exists group_settings (
  id          smallint primary key default 1,
  name        text,
  logo_type   text,
  logo        bytea,
  changed_by  uuid references staff(id),
  changed_at  timestamptz not null default now(),

  constraint group_settings_one_row check (id = 1),
  constraint group_settings_name check (name is null or (name = btrim(name) and length(name) between 1 and 80)),
  constraint group_settings_logo_whole check ((logo is null) = (logo_type is null)),
  constraint group_settings_logo_type check (logo_type in ('image/png', 'image/svg+xml')),
  constraint group_settings_logo_size check (octet_length(logo) between 1 and 204800)
);

comment on table group_settings is
  'The group''s name and logo (D27-53, D27-65), printed on every bill. At most '
  'one row; no name prints no "by <group>", no logo prints no logo.';


-- -----------------------------------------------------------------------------
-- Who may change them: owner, administrator or GM anywhere, or a group
-- administrator. Named for its decision, so another rule that happens to name
-- the same three today (app.is_crm_manager) can change without moving this.
-- -----------------------------------------------------------------------------
create or replace function app.sets_group_settings()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.is_group_admin() or exists (
    select 1 from staff_hotels sh
      join staff s on s.id = sh.staff_id
     where sh.staff_id = app.current_user_id()
       and s.is_active
       and sh.role in ('owner', 'admin', 'gm')
  )
$$;

comment on function app.sets_group_settings() is
  'The owner, an administrator or a general manager at any hotel, or a group '
  'administrator (the owner, 27 September): who may change the group''s name '
  'and logo.';

revoke all on function app.sets_group_settings() from public;
grant execute on function app.sets_group_settings() to public;


alter table group_settings enable row level security;
alter table group_settings force  row level security;

-- Everybody who prints a bill reads it.
drop policy if exists group_settings_read on group_settings;
create policy group_settings_read on group_settings
  for select using ( app.is_active_staff() );

drop policy if exists group_settings_add on group_settings;
create policy group_settings_add on group_settings
  for insert with check ( app.sets_group_settings() );

drop policy if exists group_settings_change on group_settings;
create policy group_settings_change on group_settings
  for update using ( app.sets_group_settings() ) with check ( app.sets_group_settings() );

drop policy if exists group_settings_remove on group_settings;
create policy group_settings_remove on group_settings
  for delete using ( app.sets_group_settings() );

grant select, insert, update, delete on group_settings to pms_app;

-- Printed on every bill, as the GSTIN on `hotels` is: who changed it, and
-- what it was before, is a question somebody will ask.
drop trigger if exists group_settings_audit on group_settings;
create trigger group_settings_audit after insert or update or delete on group_settings
  for each row execute function app.write_audit();
