-- =============================================================================
-- 271 · Housekeeping checklists (D27-383 item 10, built under D27-396)
-- =============================================================================
-- Refer to this file by what it does, "housekeeping checklists" - the master
-- renumbers it.
--
--   * hotels.checklists_required: a room is marked clean or inspected only by
--     ticking its checklist. OFF by default, so today's flow does not change
--     until a hotel turns it on (D27-396). Owner, administrator or GM
--     (app.manages_hotel, as every hotel setting).
--   * hk_checklists: per hotel, a list of items for one job - checkout clean,
--     stay-over, deep clean, inspection - for one room type, or for every room
--     type that has none of its own (room_type_id NULL).
--   * hk_checklist_runs: one ticking of a checklist in one room: who, when,
--     each item as it read then, ticked or failed with a note. Written once,
--     never changed. A cleaning job's run is always passed (a room is clean
--     only when every item is ticked); an inspection may fail items, and the
--     room goes back to Needs cleaning.
--
-- Also: both of the test hotel's lists (255's, with the minibar's two tables
-- and these two added) - the classes, and the full reset's steps.
--
-- Re-runnable: replayed on every deploy.
-- =============================================================================

alter table hotels add column if not exists checklists_required boolean not null default false;
comment on column hotels.checklists_required is
  'D27-383 item 10: a room is marked clean or inspected only by ticking its checklist. '
  'Off by default (D27-396).';
grant update (checklists_required) on hotels to pms_app;

create table if not exists hk_checklists (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references hotels(id) on delete cascade,
  job          text not null,
  -- NULL: every room type that has no list of its own for this job.
  room_type_id uuid,
  items        text[] not null,
  updated_by   uuid references staff(id),
  updated_at   timestamptz not null default now(),
  constraint hk_checklists_job_known
    check (job in ('checkout', 'stayover', 'deep', 'inspection')),
  constraint hk_checklists_type_here
    foreign key (hotel_id, room_type_id) references room_types (hotel_id, id) on delete cascade,
  constraint hk_checklists_items_sane
    check (cardinality(items) between 1 and 60 and array_position(items, null) is null)
);

create unique index if not exists hk_checklists_one_per_job
  on hk_checklists (hotel_id, job, coalesce(room_type_id, '00000000-0000-0000-0000-000000000000'::uuid));

comment on table hk_checklists is
  'A housekeeping checklist (D27-383 item 10): the items of one job for one room type, '
  'or for every room type without its own (room_type_id NULL).';

create table if not exists hk_checklist_runs (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  room_id       uuid not null,
  job           text not null,
  business_date date not null,
  -- [{item, ok, note}] in the checklist's order, as the items read then.
  results       jsonb not null,
  passed        boolean not null,
  done_by       uuid not null references staff(id),
  done_at       timestamptz not null default now(),
  constraint hk_checklist_runs_room_here
    foreign key (hotel_id, room_id) references rooms (hotel_id, id),
  constraint hk_checklist_runs_job_known
    check (job in ('checkout', 'stayover', 'deep', 'inspection')),
  constraint hk_checklist_runs_results_present
    check (jsonb_typeof(results) = 'array' and jsonb_array_length(results) > 0),
  -- Passed is every item ticked; a cleaning job is never failed, only finished.
  constraint hk_checklist_runs_passed_true
    check (passed = not jsonb_path_exists(results, '$[*] ? (@.ok == false)')),
  constraint hk_checklist_runs_cleaning_passes
    check (job = 'inspection' or passed)
);

create index if not exists hk_checklist_runs_room
  on hk_checklist_runs (hotel_id, room_id, done_at desc);

comment on table hk_checklist_runs is
  'One ticking of a checklist in one room (D27-383 item 10): who, when, each item ticked '
  'or failed with a note. Written once.';

drop trigger if exists hk_checklist_runs_done_by_scope on hk_checklist_runs;
create trigger hk_checklist_runs_done_by_scope
  before insert on hk_checklist_runs
  for each row execute function app.assert_staff_has_hotel('done_by');

alter table hk_checklists enable row level security;
alter table hk_checklists force  row level security;
drop policy if exists hotel_isolation on hk_checklists;
create policy hotel_isolation on hk_checklists
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

alter table hk_checklist_runs enable row level security;
alter table hk_checklist_runs force  row level security;
drop policy if exists hotel_isolation on hk_checklist_runs;
create policy hotel_isolation on hk_checklist_runs
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

-- A list is the hotel's to change or remove (a run keeps its own words);
-- a run is written once. REVOKED: 010's default privileges grant DELETE.
revoke all on hk_checklists from pms_app;
grant select, insert, update, delete on hk_checklists to pms_app;
revoke all on hk_checklist_runs from pms_app;
grant select, insert on hk_checklist_runs to pms_app;


-- =============================================================================
-- The test hotel's lists and the full reset's steps, patched in place
-- =============================================================================
-- As 262-264 do, never a full copy, so every later addition stays: minibar_items
-- and hk_checklists are setup; minibar_records and hk_checklist_runs are trading
-- and cleared first in the full reset (nothing points at them); a test hotel
-- copies checklists_required like its other settings.
do $$
declare d text := pg_get_functiondef('app.test_hotel_classes()'::regprocedure);
begin
  if position('minibar_records' in d) = 0 then
    execute replace(d, $q$('daily_report_emails', 'never')$q$,
      $q$('daily_report_emails', 'never'), ('minibar_items', 'setup'), ('minibar_records', 'trading'), ('hk_checklists', 'setup'), ('hk_checklist_runs', 'trading')$q$);
  end if;
end $$;

do $$
declare d text := pg_get_functiondef('owner_reset.steps(boolean)'::regprocedure);
begin
  if position('minibar_records' in d) = 0 then
    execute replace(d, $q$["vat_bills",$q$,
      $q$["minibar_records", "hotel_id = $1"], ["hk_checklist_runs", "hotel_id = $1"], ["vat_bills",$q$);
  end if;
end $$;

do $$
declare d text := pg_get_functiondef('app.test_hotel_hotels_columns()'::regprocedure);
begin
  if position('checklists_required' in d) = 0 then
    execute replace(d, $q$('id', false)$q$, $q$('checklists_required', true), ('id', false)$q$);
  end if;
end $$;
