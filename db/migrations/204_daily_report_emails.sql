-- =============================================================================
-- 204 · Daily report emails: each report On/Off per hotel, to typed addresses
--       (the owner's D27-280, 5 October)
-- =============================================================================
-- Refer to it by what it does - "daily report emails" - never by its number.
--
-- After a hotel's night audit closes the day, each report switched on goes to
-- each address typed for it: its key figures in the email, the whole report as
-- a PDF. Four reports (api/src/modules/guest-messaging/reportEmails.ts):
--
--   night-audit        the Night audit report       ON when nothing is saved
--   manager            the Manager report           off until switched on
--   money-owed         guest ledger and city ledger off until switched on
--   restaurant-stock   the restaurant's day,        off until switched on
--                      closing stock and wastage
--
-- NOBODY GETS ANYTHING UNTIL AN ADDRESS IS TYPED. No default address, ever: a
-- report switched on with no address sends nothing.
--
-- REPLACES "reports by email" of "messages and reports" (D27-261, Q7), which
-- sent to the hotel's own people's sign-in emails. Its table and function are
-- left in place, unread, until the owner says to drop them.
--
-- Re-runnable.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · Each report, per hotel
-- -----------------------------------------------------------------------------
create table if not exists daily_report_emails (
  hotel_id    uuid    not null references hotels(id) on delete cascade,
  report      text    not null,
  is_on       boolean not null,
  -- Typed, checked by the API (one address each, lower case, no repeats).
  addresses   text[]  not null default '{}',
  -- Who saved it last: the report is built as that person sees it, while they
  -- still run the hotel (app.daily_reports_owed).
  changed_by  uuid references staff(id),
  changed_at  timestamptz not null default now(),

  primary key (hotel_id, report),
  constraint daily_report_emails_report_known
    check (report in ('night-audit', 'manager', 'money-owed', 'restaurant-stock')),
  constraint daily_report_emails_few_addresses
    check (coalesce(array_length(addresses, 1), 0) <= 20)
);

comment on table daily_report_emails is
  'Each daily report On or Off for one hotel, and the addresses it goes to after '
  'the night audit (D27-280). No row: the night audit report on, the rest off; '
  'no address, nothing sent.';

-- THE SHARED POLICY NAME. Read by the hotel's people; written only by the
-- people who set the hotel up (owner, Administrator, GM, a group
-- administrator). No delete: switched off is a row with is_on false.
alter table daily_report_emails enable row level security;
alter table daily_report_emails force  row level security;
drop policy if exists hotel_isolation on daily_report_emails;
create policy hotel_isolation on daily_report_emails
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( app.manages_hotel(hotel_id) );
revoke all on daily_report_emails from pms_app;
grant select, insert, update on daily_report_emails to pms_app;

drop trigger if exists daily_report_emails_audit on daily_report_emails;
create trigger daily_report_emails_audit after insert or update or delete on daily_report_emails
  for each row execute function app.write_audit();


-- -----------------------------------------------------------------------------
-- 2 · What is owed: each report, to each address, once per business date
-- -----------------------------------------------------------------------------
-- Each night audit completed in the last two days; each report ON whose
-- addresses were saved before that audit completed (a report switched on at
-- ten in the morning does not send last night's); each address not sent yet
-- for that business date and report, under the tries.
--
-- BUILT BY: the person who saved it, while they still run the hotel; else
-- whoever runs it now (a group administrator or the hotel's owner, GM or
-- Administrator). The figures are the hotel's either way; nobody leaving
-- quietly stops the reports. A hotel nobody runs is owed nothing.
--
-- A DEFINER: the sweep has nobody signed in, and the table is FORCE
-- row-secured. Recorded as kind 'daily-report' about 'night-audit',
-- '<business date>/<report>/<address>'.
create or replace function app.daily_reports_owed(p_most_attempts integer, p_hotel uuid default null)
returns table (
  hotel_id uuid, hotel_code text, hotel_name text, timezone text, business_date text,
  report text, address text, built_by uuid
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select n.hotel_id, h.code, h.name, h.timezone, n.business_date::text,
         e.report, a.address, b.id
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
   where n.status = 'completed'
     and n.completed_at > now() - interval '2 days'
     and (p_hotel is null or n.hotel_id = p_hotel)
     and not exists (select 1 from messages_sent m
                      where m.hotel_id = n.hotel_id and m.about_kind = 'night-audit'
                        and m.kind = 'daily-report'
                        and m.about_id = n.business_date::text || '/' || e.report || '/' || a.address
                        and m.status = 'sent')
     and (select count(*) from messages_sent m
           where m.hotel_id = n.hotel_id and m.about_kind = 'night-audit'
             and m.kind = 'daily-report'
             and m.about_id = n.business_date::text || '/' || e.report || '/' || a.address
             and m.status = 'failed') < p_most_attempts
   order by n.completed_at, e.report, a.address
$fn$;

comment on function app.daily_reports_owed(integer, uuid) is
  'The daily report emails owed after each completed night audit (D27-280): each '
  'report switched on, to each address typed for it, once per business date.';

revoke all on function app.daily_reports_owed(integer, uuid) from public;
grant execute on function app.daily_reports_owed(integer, uuid) to pms_app;
