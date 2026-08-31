-- =============================================================================
-- 035_housekeeping_assignment.sql — whose rooms are these
-- =============================================================================
-- The housekeeping board showed every room in the property to everybody who
-- opened it. That is a status display, not a work list. A housekeeper arriving
-- at eight has one question — WHICH ROOMS ARE MINE — and the system had no
-- answer, so the answer lived on a paper sheet the supervisor wrote out each
-- morning and the board was decoration beside it.
--
-- Asked directly, the answer was "rooms assigned to a named housekeeper". Not
-- a floor, not a wing, not a shift: a person. So that is what this stores.
--
-- WHY THE ASSIGNMENT CARRIES A DATE
--
-- A room is not assigned to Sunita forever. It is assigned to her TODAY, and
-- tomorrow the rota changes. Without the date the table would hold one row per
-- room that somebody has to remember to clear, and a housekeeper who left the
-- hotel in March would still own room 204 in September.
--
-- The date also makes the record answer a question worth asking later: who was
-- responsible for 204 on the night a guest complained. An assignment table with
-- no date cannot be asked that.
--
-- WHY THIS IS NOT A COLUMN ON `rooms`
--
-- Same reason room_blocks is not a column on rooms: `rooms` holds the state NOW
-- and is overwritten in place. An assignment has a day, an author and a time it
-- was made, and none of those survive on a column that the next write replaces.
-- =============================================================================


create table if not exists housekeeping_assignments (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  room_id       uuid not null references rooms(id)  on delete cascade,

  -- The business date the work belongs to, never now(). A supervisor setting
  -- tomorrow's rota at eleven at night must not have it land on today.
  work_date     date not null,

  -- The named housekeeper. NOT NULL: an assignment to nobody is the absence of
  -- an assignment, and it should be represented by the absence of a row.
  staff_id      uuid not null references staff(id),

  note          text,

  assigned_by   uuid references staff(id),
  assigned_at   timestamptz not null default now(),

  -- One housekeeper per room per day. Two people told to clean 204 is how 204
  -- gets cleaned twice and 205 not at all.
  constraint housekeeping_assignments_one_per_room
    unique (room_id, work_date)
);

create index if not exists housekeeping_assignments_sheet
  on housekeeping_assignments (hotel_id, work_date);

-- "What is on Sunita's list today" — the query the housekeeper's own screen
-- runs, and the one that must not table-scan on a busy morning.
create index if not exists housekeeping_assignments_by_staff
  on housekeeping_assignments (staff_id, work_date);


-- -----------------------------------------------------------------------------
-- Isolation
-- -----------------------------------------------------------------------------
-- The suite asserts every table in public has RLS. Stated here rather than
-- discovered by that assertion, as room_blocks was.
-- -----------------------------------------------------------------------------
alter table housekeeping_assignments enable row level security;
alter table housekeeping_assignments force row level security;

drop policy if exists housekeeping_assignments_isolation on housekeeping_assignments;
create policy housekeeping_assignments_isolation on housekeeping_assignments
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );


-- -----------------------------------------------------------------------------
-- The room and the housekeeper must both belong to this hotel
-- -----------------------------------------------------------------------------
-- D7 from 012 covers the staff side: a housekeeper with no access to this
-- property cannot be given work here. The comment in 012 describes this exact
-- case — "a Pune housekeeper can be assigned an Agra room. The task is created,
-- appears on nobody's list, and the room is never cleaned" — written before
-- there was an assignment table to attach it to. There is one now.
-- -----------------------------------------------------------------------------
drop trigger if exists housekeeping_assignments_staff_scope on housekeeping_assignments;
create trigger housekeeping_assignments_staff_scope
  before insert or update on housekeeping_assignments
  for each row execute function app.assert_staff_has_hotel('staff_id');

-- The room side. A composite key is available here because rooms carries
-- hotel_id, so this is a foreign key rather than a trigger — cheaper, and
-- enforced by the same machinery that enforces the rest of the schema.
alter table housekeeping_assignments
  drop constraint if exists housekeeping_assignments_room_in_hotel;
alter table housekeeping_assignments
  add constraint housekeeping_assignments_room_in_hotel
  foreign key (hotel_id, room_id) references rooms (hotel_id, id)
  on delete cascade;


comment on table housekeeping_assignments is
  'Which named housekeeper is responsible for which room on which day. The '
  'board without this shows every room to everybody, which is a status '
  'display and not a work list.';

comment on column housekeeping_assignments.work_date is
  'The business date the work belongs to. Never now(): a rota set at eleven '
  'at night is for tomorrow.';
