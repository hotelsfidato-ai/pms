-- =============================================================================
-- 130 · Correcting a closed day (D22-18, D24-1 to D24-8)
-- =============================================================================
-- The owner, 22 September: "a GM screen; a reason is required, and the old and
-- new figures are both kept." Their answers of 24 September
-- (docs/briefs/decisions-2026-09-24.md): a room charge or a no-show charge that
-- landed on a closed day wrong is put right ON THAT DAY (D24-1, D24-2), by the
-- owner, an administrator or the GM (D24-3).
--
-- Nothing that exists is changed. The wrong line stays on the bill; a reversing
-- line and the right charge sit beside it, both naming a correction row that
-- keeps the day, the old figure, the new one, the reason, who and when, and is
-- never changed or deleted.
--
-- Re-runnable: every statement is `if not exists`, guarded, or a `create or
-- replace` that keeps the signature it had (root MEMORY 317).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · Who may correct a closed day (D24-3)
-- -----------------------------------------------------------------------------
-- app.manages_hotel (084) is a group administrator, or the owner or GM AT THIS
-- HOTEL; the owner's answer adds an administrator here.
create or replace function app.corrects_closed_days(p_hotel uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.manages_hotel(p_hotel) or exists (
    select 1 from staff_hotels sh
      join staff s on s.id = sh.staff_id
     where sh.staff_id = app.current_user_id()
       and sh.hotel_id = p_hotel
       and s.is_active
       and sh.role = 'admin');
$$;

comment on function app.corrects_closed_days(uuid) is
  'D24-3: the owner, an administrator or the GM at this hotel, or a group '
  'administrator, may correct a closed day.';

grant execute on function app.corrects_closed_days(uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- 2 · The correction record
-- -----------------------------------------------------------------------------
create table if not exists closed_day_corrections (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  business_date date not null,
  -- By its own id, not (hotel_id, id): 014 drops and re-adds that key on every
  -- re-run, and a dependent here would stop it halfway.
  posting_id    bigint not null references folio_postings(id),
  old_amount    numeric(12,2) not null,
  -- 0 is the charge taken off entirely: a decision somebody made, never a default.
  new_amount    numeric(12,2) not null check (new_amount >= 0),
  reason        text not null check (btrim(reason) <> ''),
  corrected_by  uuid not null default app.current_user_id() references staff(id),
  corrected_at  timestamptz not null default now()
);

comment on table closed_day_corrections is
  'D22-18: a room charge or no-show charge on a closed day, corrected. The old '
  'line stays on the bill; the reversal and the right charge name this row '
  '(source_type correction). Append-only.';

create index if not exists closed_day_corrections_day
  on closed_day_corrections (hotel_id, business_date);

alter table closed_day_corrections enable row level security;
alter table closed_day_corrections force  row level security;
drop policy if exists hotel_isolation on closed_day_corrections;
create policy hotel_isolation on closed_day_corrections
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert on closed_day_corrections to pms_app;
-- REVOKED, not merely left out: 010's default privileges hand every new table
-- update and delete by themselves.
revoke update, delete on closed_day_corrections from pms_app;

drop trigger if exists closed_day_corrections_append_only on closed_day_corrections;
create trigger closed_day_corrections_append_only
  before update or delete on closed_day_corrections
  for each row execute function app.forbid_mutation();

-- Who, whoever writes. The row says who corrected it, and nobody can say
-- somebody else did.
create or replace function app.closed_day_correction_needs_gm()
returns trigger
language plpgsql
as $$
begin
  if not app.corrects_closed_days(new.hotel_id) then
    raise exception 'Correcting a closed day is for the owner, an administrator or the general manager.'
      using errcode = '42501';
  end if;
  new.corrected_by := app.current_user_id();
  return new;
end $$;

drop trigger if exists closed_day_corrections_needs_gm on closed_day_corrections;
create trigger closed_day_corrections_needs_gm
  before insert on closed_day_corrections
  for each row execute function app.closed_day_correction_needs_gm();


-- -----------------------------------------------------------------------------
-- 3 · The one exception to "nothing is posted to a closed day" (D24-2)
-- -----------------------------------------------------------------------------
-- 012's trigger, same name, same signature. A line may carry a closed date only
-- when it names a correction of the same property and the same day, and the
-- person posting it may correct that day. Every other door is refused exactly
-- as before, in the same words.
create or replace function app.reject_closed_business_date()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1 from night_audit_runs
     where hotel_id = new.hotel_id
       and business_date = new.business_date
       and status = 'completed'
  ) and not (
    new.source_type is not distinct from 'correction'
    and app.corrects_closed_days(new.hotel_id)
    and exists (
      select 1 from closed_day_corrections c
       where c.id = new.source_id
         and c.hotel_id = new.hotel_id
         and c.business_date = new.business_date)
  ) then
    raise exception
      'Business date % is closed for this property - post to the current date instead.',
      new.business_date
      using hint = 'Night audit has already run. Late charges belong to today.';
  end if;
  return new;
end
$$;
