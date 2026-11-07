-- =============================================================================
-- 268 · Scheduled reports: any report by email, daily, weekly or monthly
--       (the owner's D27-383 item 5, built under D27-396)
-- =============================================================================
-- Refer to it by what it does - "scheduled reports" - never by its number.
--
-- A list per hotel. Each row is one report, the period it covers (yesterday,
-- last week Monday to Sunday, last month, the month so far), how often (daily
-- after the night audit, weekly on a chosen day, monthly on a chosen date), the
-- file (PDF or Excel) and the addresses. It goes AFTER THAT DAY'S NIGHT AUDIT,
-- in the same sweep as the daily report emails ("daily report emails",
-- "corrected daily reports"): a day never closed sends nothing.
--
-- Which reports may be scheduled, and with which period, is the API's
-- (api/src/modules/reports/emails.ts): a key is a word, not a constraint.
-- Each send is one messages_sent row per address (kind 'report', about
-- 'report-schedule', '<schedule>/<business date>/<address>'), so a failed send
-- shows on Connection health as the daily ones do. The last send and its
-- result are kept on the row for the list.
--
-- Re-runnable.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · The schedules
-- -----------------------------------------------------------------------------
create table if not exists report_schedules (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references hotels(id) on delete cascade,
  report        text not null,
  period        text not null,
  frequency     text not null,
  -- Weekly: ISO day of the week, 1 Monday to 7 Sunday. Monthly: 1 to 28, so
  -- every month has it. Each only with its own frequency.
  weekday       smallint,
  day_of_month  smallint,
  file_type     text not null,
  -- Typed, checked by the API (one address each, lower case, no repeats).
  addresses     text[] not null,
  is_paused     boolean not null default false,
  -- Who saved it last: the report is built as that person sees it while they
  -- still run the hotel (app.report_schedules_due), as the daily ones are.
  changed_by    uuid references staff(id),
  changed_at    timestamptz not null default now(),
  -- The last send and its result, written by the sweep. 'refused': nothing
  -- was sent that day and the reason says why (a day not yet closed, a file
  -- too large, the bar's reports switched off).
  last_date     date,
  last_status   text,
  last_detail   text,
  last_at       timestamptz,

  constraint report_schedules_period_known
    check (period in ('yesterday', 'last-week', 'last-month', 'month-to-date')),
  constraint report_schedules_when
    check ((frequency = 'daily' and weekday is null and day_of_month is null)
        or (frequency = 'weekly' and weekday between 1 and 7 and day_of_month is null)
        or (frequency = 'monthly' and day_of_month between 1 and 28 and weekday is null)),
  constraint report_schedules_file_known check (file_type in ('pdf', 'xlsx')),
  constraint report_schedules_some_addresses
    check (coalesce(array_length(addresses, 1), 0) between 1 and 20),
  constraint report_schedules_last_known check (last_status in ('sent', 'failed', 'refused'))
);

create index if not exists report_schedules_by_hotel on report_schedules (hotel_id);

comment on table report_schedules is
  'Reports emailed on a schedule after the night audit (D27-383 item 5): the report, '
  'its period, daily, weekly or monthly, the file and the addresses; the last send and '
  'its result.';

-- THE SHARED POLICY NAME. Read by the hotel's people (the addresses are offered
-- when a report is emailed by hand); written only by the people who set the
-- hotel up (owner, Administrator, GM, a group administrator), as the daily
-- report emails are.
alter table report_schedules enable row level security;
alter table report_schedules force  row level security;
drop policy if exists hotel_isolation on report_schedules;
create policy hotel_isolation on report_schedules
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( app.manages_hotel(hotel_id) );
-- A delete has no check of its own: taken off by the same people only.
drop policy if exists report_schedules_removed_by_managers on report_schedules;
create policy report_schedules_removed_by_managers on report_schedules as restrictive
  for delete using ( app.manages_hotel(hotel_id) );
revoke all on report_schedules from pms_app;
grant select, insert, update, delete on report_schedules to pms_app;

-- Audited when somebody changes what goes where; not when the sweep writes the
-- last send's result, which nobody chose.
drop trigger if exists report_schedules_audit on report_schedules;
create trigger report_schedules_audit
  after insert or delete or update of report, period, frequency, weekday, day_of_month,
                                      file_type, addresses, is_paused
  on report_schedules
  for each row execute function app.write_audit();

-- NOTHING LEAVES A TEST HOTEL (D27-296): it cannot have a schedule.
drop trigger if exists report_schedules_not_in_test_hotels on report_schedules;
create trigger report_schedules_not_in_test_hotels before insert or update on report_schedules
  for each row execute function app.refuse_in_test_hotel();


-- -----------------------------------------------------------------------------
-- 2 · What is due: each schedule, to each address, after the audit of its day
-- -----------------------------------------------------------------------------
-- Each night audit completed in the last two days; each schedule not paused,
-- saved before that audit completed, whose day it is (daily; weekly on its
-- weekday; monthly on its date - of the day the audit closed); each address
-- not sent yet for that schedule and day, under the tries; not a day the sweep
-- already refused. The period is worked out from the day closed by the API.
--
-- BUILT BY, as the daily ones: the person who saved it while they still run
-- the hotel, else whoever runs it now. A DEFINER: the sweep has nobody signed
-- in, and both tables are FORCE row-secured.
create or replace function app.report_schedules_due(p_most_attempts integer, p_hotel uuid default null)
returns table (
  schedule_id uuid, hotel_id uuid, hotel_code text, hotel_name text, timezone text,
  business_date text, report text, period text, frequency text, weekday smallint,
  day_of_month smallint, file_type text, address text, built_by uuid, about_id text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select s.id, n.hotel_id, h.code, h.name, h.timezone, n.business_date::text,
         s.report, s.period, s.frequency, s.weekday, s.day_of_month, s.file_type,
         a.address, b.id, s.id::text || '/' || n.business_date::text || '/' || a.address
    from night_audit_runs n
    join hotels h            on h.id = n.hotel_id
    join report_schedules s  on s.hotel_id = n.hotel_id and not s.is_paused
                            and s.changed_at <= n.completed_at
    cross join lateral unnest(s.addresses) as a(address)
    join lateral (
      select p.id from staff p
       where p.is_active
         and (p.is_group_admin
              or exists (select 1 from staff_hotels sh
                          where sh.staff_id = p.id and sh.hotel_id = n.hotel_id
                            and sh.role in ('owner', 'gm', 'admin')))
       order by (p.id = s.changed_by) desc nulls last, p.id
       limit 1
    ) b on true
   where n.status = 'completed'
     and n.completed_at > now() - interval '2 days'
     and (p_hotel is null or n.hotel_id = p_hotel)
     and (s.frequency = 'daily'
          or (s.frequency = 'weekly' and extract(isodow from n.business_date) = s.weekday)
          or (s.frequency = 'monthly' and extract(day from n.business_date) = s.day_of_month))
     and not coalesce(s.last_status = 'refused' and s.last_date = n.business_date, false)
     and not exists (select 1 from messages_sent m
                      where m.hotel_id = n.hotel_id and m.about_kind = 'report-schedule'
                        and m.about_id = s.id::text || '/' || n.business_date::text || '/' || a.address
                        and m.status = 'sent')
     and (select count(*) from messages_sent m
           where m.hotel_id = n.hotel_id and m.about_kind = 'report-schedule'
             and m.about_id = s.id::text || '/' || n.business_date::text || '/' || a.address
             and m.status = 'failed') < p_most_attempts
   order by n.completed_at, s.id, a.address
$fn$;

comment on function app.report_schedules_due(integer, uuid) is
  'The scheduled report emails owed after each completed night audit (D27-383 item 5): '
  'each schedule not paused whose day it is, to each address, once per day closed.';

revoke all on function app.report_schedules_due(integer, uuid) from public;
grant execute on function app.report_schedules_due(integer, uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- 3 · The test hotel's classes: report_schedules is 'never'
-- -----------------------------------------------------------------------------
-- Added beside daily_report_emails in the list as it stands, patched as 262 does, so
-- the two-step and after-check-in additions stay. A test hotel never copies schedules.
do $$
declare d text := pg_get_functiondef('app.test_hotel_classes()'::regprocedure);
begin
  if position('report_schedules' in d) = 0 then
    execute replace(d, $q$('daily_report_emails', 'never')$q$,
                       $q$('daily_report_emails', 'never'), ('report_schedules', 'never')$q$);
  end if;
end $$;
