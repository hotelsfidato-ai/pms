-- =============================================================================
-- 146 · One logo for the whole group, chosen in Settings (the owner's D27-53)
-- =============================================================================
-- "One logo for the whole group, chosen in Settings, printed on every bill. A
-- setting, not code (D21-27)." Every copy of this system belongs to ONE group
-- (D21-1), so the group's logo is one row, GROUP-LEVEL like `hotels` itself:
-- no hotel_id.
--
-- ⚠ THE LOGO NEVER GOES IN A MIGRATION. This file makes the table and leaves
-- it EMPTY. Migrations replay in every buyer's copy, and a buyer's copy starts
-- with no logo and prints the hotel's name until they upload their own. The
-- Fidato copy is filled by uploading the artwork through Settings.
--
-- WHO (the owner, 27 September): the owner, an administrator or a general
-- manager - at any hotel of the group - and a group administrator. The server
-- asks the same through the role gate before anything is written; this is the
-- database's own answer, which holds whatever route reaches the table.
--
-- WHAT: a PNG or an SVG, 200 KB at most (the owner, 27 September). The server
-- checks the file by its content, not its name, and refuses an SVG carrying a
-- script; the constraints here are the backstop.
-- =============================================================================

create table if not exists group_logo (
  id          smallint primary key default 1,
  image_type  text        not null,
  image       bytea       not null,
  changed_by  uuid references staff(id),
  changed_at  timestamptz not null default now(),

  constraint group_logo_one_row check (id = 1),
  constraint group_logo_type check (image_type in ('image/png', 'image/svg+xml')),
  constraint group_logo_size check (octet_length(image) between 1 and 204800)
);

comment on table group_logo is
  'The group''s one logo (D27-53), printed on every bill. At most one row; '
  'no row means bills print the hotel''s name.';


-- -----------------------------------------------------------------------------
-- Who may change it: owner, administrator or GM anywhere, or a group
-- administrator. Named for its decision, so another rule that happens to name
-- the same three today (app.is_crm_manager) can change without moving this.
-- -----------------------------------------------------------------------------
create or replace function app.sets_group_logo()
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

comment on function app.sets_group_logo() is
  'The owner, an administrator or a general manager at any hotel, or a group '
  'administrator (the owner, 27 September): who may change the group''s logo.';

revoke all on function app.sets_group_logo() from public;
grant execute on function app.sets_group_logo() to public;


alter table group_logo enable row level security;
alter table group_logo force  row level security;

-- Everybody who prints a bill reads it.
drop policy if exists group_logo_read on group_logo;
create policy group_logo_read on group_logo
  for select using ( app.is_active_staff() );

drop policy if exists group_logo_add on group_logo;
create policy group_logo_add on group_logo
  for insert with check ( app.sets_group_logo() );

drop policy if exists group_logo_change on group_logo;
create policy group_logo_change on group_logo
  for update using ( app.sets_group_logo() ) with check ( app.sets_group_logo() );

drop policy if exists group_logo_remove on group_logo;
create policy group_logo_remove on group_logo
  for delete using ( app.sets_group_logo() );

grant select, insert, update, delete on group_logo to pms_app;

-- Printed on every bill, as the GSTIN on `hotels` is: who changed it, and
-- what it was before, is a question somebody will ask.
drop trigger if exists group_logo_audit on group_logo;
create trigger group_logo_audit after insert or update or delete on group_logo
  for each row execute function app.write_audit();
