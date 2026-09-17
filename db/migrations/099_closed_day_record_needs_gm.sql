-- =============================================================================
-- 099_closed_day_record_needs_gm.sql — a closed day's record is the GM's to correct
-- =============================================================================
-- The owner, 17 September (D17-12): a day already closed is not run again — a
-- second press of Run night audit, at the same moment or later, changes
-- nothing and shows the record that was made — and "any correction to a closed
-- day's record needs the GM".
--
-- The API keeps the first half: it waits on the advisory lock 006 always
-- described and answers a closed day with its record (NA-3). Until now nothing
-- kept the second half. `pms_app` may update any row of night_audit_runs at its
-- own property, and 016 audits the table precisely because the day-close figure
-- was "rewritable after the fact". The race NA-3 measured on 16 September did
-- exactly that: it rewrote a completed record to 0 rooms and ₹0, as whoever
-- pressed second.
--
-- So the database refuses a change to a COMPLETED run from anyone who does not
-- manage the property — app.manages_hotel (084): the property's owner or GM, or
-- a group administrator. What stays allowed, because none of it corrects a
-- closed day:
--
--   · the audit completing its own run (the row was 'running' before)
--   · anything on a run that has not completed — it has closed nothing
--   · naming who ran a closed day that names nobody: `run_by` was never written
--     before 17 September, and a blank is filled once, never changed
--
-- Deleting a run is not touched here: nothing in the application deletes one,
-- and the property reset and the test fixtures that do run as the superuser.
--
-- Re-runnable: a function replaced and a trigger dropped and re-created; no
-- rows are written.
-- =============================================================================

create or replace function app.closed_day_record_needs_gm()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'completed' then
    return new;
  end if;

  if (new.hotel_id, new.business_date, new.status, new.rooms_posted,
      new.revenue_posted, new.no_shows, new.started_at, new.completed_at,
      new.error_message)
     is not distinct from
     (old.hotel_id, old.business_date, old.status, old.rooms_posted,
      old.revenue_posted, old.no_shows, old.started_at, old.completed_at,
      old.error_message)
     and (old.run_by is null or new.run_by is not distinct from old.run_by) then
    return new;                          -- nothing corrected
  end if;

  if app.manages_hotel(old.hotel_id) then
    return new;
  end if;

  raise exception 'The night audit for % is closed. Only the GM can correct its record.',
    to_char(old.business_date, 'FMDD FMMonth YYYY')
    using errcode = '42501';
end $$;

comment on function app.closed_day_record_needs_gm() is
  'D17-12: a completed night audit run is corrected only by someone who manages '
  'the property (owner, GM, group administrator). The audit completing its own '
  'run, a run still running, and naming a runner where none was recorded are '
  'not corrections.';

drop trigger if exists night_audit_runs_closed_needs_gm on night_audit_runs;
create trigger night_audit_runs_closed_needs_gm
  before update on night_audit_runs
  for each row execute function app.closed_day_record_needs_gm();
