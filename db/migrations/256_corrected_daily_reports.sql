-- =============================================================================
-- 256 · A cancelled day's reports, sent again when it is run again (D27-390)
-- =============================================================================
-- The owner, 2 November: when a cancelled day is run again, its daily report
-- emails go again, marked Corrected in the subject and at the top, to the same
-- addresses.
--
-- "daily report emails" (204) owed each report once per business date, report
-- and address: the messages_sent key '<date>/<report>/<address>'. A day run
-- again after a cancel keeps its date, so it was owed nothing. Now a run that
-- completed after a cancel of its day is owed under a key of its own,
-- '<date>/<report>/<address>/corrected/<cancel id>' - once per cancel, three
-- tries as before - and says whether an email went for that day before
-- (`corrected`), so the email is marked only when it replaces one.
--
-- The answer gains three columns, so it is a function of its own,
-- app.daily_reports_due, which the sweep now reads: 204 makes daily_reports_owed
-- again on every deploy with its own columns, and a changed answer there would
-- stop the second deploy at 204 (db/tests/rerun.sh found it). 204's stays as it
-- was, read by nothing. Re-runnable.
-- =============================================================================

create or replace function app.daily_reports_due(p_most_attempts integer, p_hotel uuid default null)
returns table (
  hotel_id uuid, hotel_code text, hotel_name text, timezone text, business_date text,
  report text, address text, built_by uuid,
  about_id text, undo_id uuid, corrected boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  with owed as (
    select n.hotel_id, h.code, h.name, h.timezone, n.business_date::text as business_date,
           n.completed_at, e.report, a.address, b.id as built_by,
           n.business_date::text || '/' || e.report || '/' || a.address as base,
           u.id as undo_id
      from night_audit_runs n
      join hotels h              on h.id = n.hotel_id
      join daily_report_emails e on e.hotel_id = n.hotel_id and e.is_on and e.changed_at <= n.completed_at
      cross join lateral unnest(e.addresses) as a(address)
      join lateral (
        select s.id from staff s
         where s.is_active
           and (s.is_group_admin
                or exists (select 1 from staff_hotels sh
                            where sh.staff_id = s.id and sh.hotel_id = n.hotel_id
                              and sh.role in ('owner', 'gm', 'admin')))
         order by (s.id = e.changed_by) desc nulls last, s.id
         limit 1
      ) b on true
      /* The last cancel of this day before it was run again (D27-390). */
      left join lateral (
        select u.id from night_audit_undos u
         where u.hotel_id = n.hotel_id
           and n.business_date between u.back_to and u.last_day
           and u.undone_at < n.completed_at
         order by u.undone_at desc
         limit 1
      ) u on true
     where n.status = 'completed'
       and n.completed_at > now() - interval '2 days'
       and (p_hotel is null or n.hotel_id = p_hotel)
  ), keyed as (
    select o.*, o.base || coalesce('/corrected/' || o.undo_id::text, '') as key from owed o
  )
  select k.hotel_id, k.code, k.name, k.timezone, k.business_date, k.report, k.address, k.built_by,
         k.key, k.undo_id,
         /* Marked Corrected only when it replaces an email that went. */
         k.undo_id is not null and exists (
           select 1 from messages_sent m
            where m.hotel_id = k.hotel_id and m.about_kind = 'night-audit' and m.kind = 'daily-report'
              and m.status = 'sent'
              and (m.about_id = k.base
                   or left(m.about_id, length(k.base) + 11) = k.base || '/corrected/'))
    from keyed k
   where not exists (select 1 from messages_sent m
                      where m.hotel_id = k.hotel_id and m.about_kind = 'night-audit'
                        and m.kind = 'daily-report' and m.about_id = k.key and m.status = 'sent')
     and (select count(*) from messages_sent m
           where m.hotel_id = k.hotel_id and m.about_kind = 'night-audit'
             and m.kind = 'daily-report' and m.about_id = k.key and m.status = 'failed') < p_most_attempts
   order by k.completed_at, k.report, k.address
$fn$;

comment on function app.daily_reports_due(integer, uuid) is
  'The daily report emails owed after each completed night audit (D27-280): each '
  'report switched on, to each address typed for it, once per business date - and '
  'once more after each cancel of that day, marked corrected when it replaces one (D27-390).';

revoke all on function app.daily_reports_due(integer, uuid) from public;
grant execute on function app.daily_reports_due(integer, uuid) to pms_app;
