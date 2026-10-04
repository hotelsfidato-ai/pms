-- =============================================================================
-- 193 · Each guest message switched per hotel; the invoice; reports by email
--       (Settings phase 6; the owner's D27-252, D27-261; numbered for now)
-- =============================================================================
-- Refer to it by what it does - "messages and reports" - never by its number.
--
--   1  guest_message_settings   each guest message On/Off per hotel: the
--                               voucher (the confirmation, D27-264), online
--                               check-in, the invoice, the review request. NO
--                               ROW: the voucher on; the other three OFF until
--                               a hotel switches them on (D27-261, D27-266).
--   2  report_emails            which reports go to which of the hotel's
--                               people after each night audit (Q7)
--   3  "what the guest is owed" (184), as the owner's D27-264 has it: the
--                               VOUCHER is the confirmation - by email the
--                               voucher email, on WhatsApp the CRS's voucher -
--                               and NO reminder. The voucher's switch is asked. The
--                               same arguments and columns (MEMORY 317)
--   4  app.guest_invoices_owed  the tax invoices owed to their guests, each way
--   5  app.report_emails_owed   the night-audit reports owed to their people
--   6  app.online_checkin_on    whether a hotel has online check-in on (D27-266)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · Each guest message, per hotel (D27-261, Q1 and Q2)
-- -----------------------------------------------------------------------------
-- The check-in code and the desk's button (which resends the voucher, D27-264)
-- have NO switch: the first is how a guest gets in, the second a button a
-- clerk presses (Q1). The reminder is gone (D27-264).
create table if not exists guest_message_settings (
  hotel_id    uuid     not null references hotels(id) on delete cascade,
  kind        text     not null,
  is_on       boolean  not null,
  -- The invoice only (Q3): the moment it was last switched on. An invoice
  -- issued before it - or while it was off - never goes by itself.
  switched_on_at timestamptz,
  changed_by  uuid references staff(id),
  changed_at  timestamptz not null default now(),

  primary key (hotel_id, kind),
  constraint gms_kind_known check (kind in ('booking-voucher', 'online-checkin', 'invoice', 'review'))
);

comment on table guest_message_settings is
  'Each guest message switched On or Off for one hotel (D27-261, D27-264, D27-266): '
  'the voucher, online check-in, the invoice, the review request. No row: the '
  'voucher on, the other three off until switched on.';

alter table guest_message_settings enable row level security;
alter table guest_message_settings force  row level security;
drop policy if exists guest_message_settings_read on guest_message_settings;
create policy guest_message_settings_read on guest_message_settings
  for select using ( hotel_id in (select app.auth_hotel_ids()) );
drop policy if exists guest_message_settings_write on guest_message_settings;
create policy guest_message_settings_write on guest_message_settings
  for all using ( app.manages_hotel(hotel_id) ) with check ( app.manages_hotel(hotel_id) );
grant select, insert, update on guest_message_settings to pms_app;

drop trigger if exists guest_message_settings_audit on guest_message_settings;
create trigger guest_message_settings_audit after insert or update or delete on guest_message_settings
  for each row execute function app.write_audit();


-- -----------------------------------------------------------------------------
-- 2 · Reports by email after the night audit (D27-261, Q7)
-- -----------------------------------------------------------------------------
-- To a person's own sign-in email only: nobody types an address.
create table if not exists report_emails (
  hotel_id  uuid not null references hotels(id) on delete cascade,
  report    text not null,
  staff_id  uuid not null references staff(id) on delete cascade,
  added_by  uuid references staff(id),
  added_at  timestamptz not null default now(),

  primary key (hotel_id, report, staff_id),
  constraint report_emails_report_known check (report in (
    'night-audit', 'manager', 'city-ledger', 'no-show', 'lodging-tax', 'monthly-occupancy'))
);

comment on table report_emails is
  'Which reports go, as PDF, to which of the hotel''s people after each night '
  'audit (D27-261). Their own sign-in email; a night audited before the person '
  'was added is not sent to them.';

alter table report_emails enable row level security;
alter table report_emails force  row level security;
drop policy if exists report_emails_read on report_emails;
create policy report_emails_read on report_emails
  for select using ( hotel_id in (select app.auth_hotel_ids()) );
drop policy if exists report_emails_write on report_emails;
create policy report_emails_write on report_emails
  for all using ( app.manages_hotel(hotel_id) ) with check ( app.manages_hotel(hotel_id) );
grant select, insert, delete on report_emails to pms_app;

drop trigger if exists report_emails_audit on report_emails;
create trigger report_emails_audit after insert or update or delete on report_emails
  for each row execute function app.write_audit();


-- -----------------------------------------------------------------------------
-- 3 · What the guest is owed (D27-264): the voucher, both ways, once
-- -----------------------------------------------------------------------------
-- The same arguments and columns as 184, so a replay of 184 then this one is
-- the same function (MEMORY 317). p_remind_from is no longer read: there is no
-- reminder (D27-264), and arrival-reminder rows are never answered again.
-- The voucher by EMAIL keeps its kind 'booking-confirmation' (the voucher
-- email, the PDF attached); on WhatsApp it is 'booking-voucher' (the CRS's
-- voucher template, the PDF as its document). One switch, 'booking-voucher',
-- for both. No way at all: one row with no channel (the desk's MSG-3 list).
create or replace function app.guest_messages_owed(
  p_within_hours    integer,
  p_most_attempts   integer,
  p_remind_from     time,
  p_catch_up_from   time,
  p_catch_up_until  time,
  p_hotel           uuid default null
)
returns table (
  kind text, channel text, reservation_id uuid, reference text,
  hotel_id uuid, hotel_code text, hotel_name text, hotel_phone text,
  guest_name text, guest_phone text, guest_email text, whatsapp_agreed boolean,
  check_in text, check_out text, nights integer, held boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  with future as (
    select r.group_id, coalesce(r.group_id, r.id) as party
      from reservations r
      join hotels h on h.id = r.hotel_id
     where r.status = 'confirmed'
       and (p_hotel is null or r.hotel_id = p_hotel)
       and r.check_in >= (now() at time zone h.timezone)::date
  ),
  lead as (
    select f.party, coalesce(app.group_lead(f.group_id), f.party) as id
      from (select distinct group_id, party from future) f
  ),
  booking as (
    select l.party, r.id, r.reference, r.hotel_id, r.created_at, r.check_in, r.check_out,
           r.whatsapp_agreed, h.code, h.name as hotel_name, h.phone as hotel_phone,
           g.full_name, g.phone, g.email::text as email,
           now() at time zone h.timezone as here,
           r.whatsapp_agreed and coalesce(btrim(g.phone), '') <> '' as by_whatsapp,
           coalesce(btrim(g.email::text), '') <> ''                   as by_email,
           coalesce(r.created_at < (select began_at from guest_messaging_began), true)
             as catch_up,
           p_within_hours is null
             or r.created_at > now() - make_interval(hours => p_within_hours) as recent,
           -- The voucher's switch at this hotel; no row is on (D27-261).
           coalesce((select s.is_on from guest_message_settings s
                      where s.hotel_id = r.hotel_id and s.kind = 'booking-voucher'), true) as voucher_on
      from lead l
      join reservations r on r.id = l.id
      join hotels h on h.id = r.hotel_id
      join guests g on g.id = r.guest_id
     where r.status = 'confirmed'
       and (p_hotel is null or r.hotel_id = p_hotel)
       and r.check_in >= (now() at time zone h.timezone)::date
  ),
  tried as (
    select coalesce(x.group_id, x.id) as party, m.kind, m.channel,
           max(m.sent_at) filter (where m.status = 'sent') as sent_at,
           count(*) filter (where m.status = 'failed')     as failed
      from messages_sent m
      join reservations x on x.hotel_id = m.hotel_id and x.id::text = m.about_id
     where m.about_kind = 'reservation'
       and m.kind in ('booking-confirmation', 'booking-voucher')
       and coalesce(x.group_id, x.id) in (select party from booking)
     group by 1, 2, 3
  ),
  -- Every way the voucher goes, and its kind on that way.
  way as (
    select b.party, w.channel,
           case when w.channel = 'whatsapp' then 'booking-voucher' else 'booking-confirmation' end as kind
      from booking b
      cross join lateral (
        select 'whatsapp'::text as channel where b.by_whatsapp
        union all select 'email' where b.by_email
        union all select null where not b.by_whatsapp and not b.by_email
      ) w
  ),
  due as (
    select w.kind, w.channel, b.*
      from way w
      join booking b on b.party = w.party
      left join tried t on t.party = w.party and t.kind = w.kind
                       and t.channel is not distinct from w.channel
     where t.sent_at is null
       and coalesce(t.failed, 0) < p_most_attempts
       and b.recent
       and b.voucher_on
  )
  select d.kind, d.channel, d.id, d.reference,
         d.hotel_id, d.code, d.hotel_name, d.hotel_phone,
         d.full_name, d.phone, d.email, d.whatsapp_agreed,
         d.check_in::text, d.check_out::text, (d.check_out - d.check_in)::int,
         d.catch_up
           and not (d.here::time >= p_catch_up_from and d.here::time < p_catch_up_until)
    from due d
   order by d.check_in, d.created_at, d.kind, d.channel nulls last
$fn$;

comment on function app.guest_messages_owed(integer, integer, time, time, time, uuid) is
  'The voucher owed to each confirmed booking (D27-264): by email (kind '
  'booking-confirmation) and on WhatsApp (booking-voucher), each way once, while '
  'the hotel''s voucher switch is on. No reminder. p_remind_from is not read.';


-- -----------------------------------------------------------------------------
-- 4 · The tax invoices owed to their guests (D27-252; D27-261 Q3 to Q6)
-- -----------------------------------------------------------------------------
-- By itself (p_invoice NULL): a tax invoice (not a credit note, and not since
-- credited) made out to the GUEST (its bill's bill_to), issued once the
-- hotel's invoice switch was last turned on, for a stay - each way not sent
-- yet, under the tries. One row per way; no way, no row.
-- From the desk's button (p_invoice given): that one invoice, its switch and
-- its bill_to not asked (Q5: a company's goes by the button); never a credit
-- note.
create or replace function app.guest_invoices_owed(
  p_most_attempts integer,
  p_hotel         uuid default null,
  p_invoice       uuid default null
)
returns table (
  invoice_id uuid, number text, channel text, issued_by uuid,
  hotel_id uuid, hotel_code text, hotel_name text, hotel_phone text,
  reservation_id uuid, reference text,
  guest_name text, guest_phone text, guest_email text, total numeric
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  with inv as (
    select i.id, i.number, i.issued_by, i.total, i.hotel_id,
           h.code, h.name as hotel_name, h.phone as hotel_phone,
           r.id as reservation_id, r.reference,
           g.full_name, g.phone, g.email::text as email,
           r.whatsapp_agreed and coalesce(btrim(g.phone), '') <> '' as by_whatsapp,
           coalesce(btrim(g.email::text), '') <> ''                   as by_email
      from invoices i
      join folios f       on f.id = i.folio_id
      join reservations r on r.id = f.reservation_id
      join guests g       on g.id = r.guest_id
      join hotels h       on h.id = i.hotel_id
     where i.credits_id is null
       and not exists (select 1 from invoices c where c.credits_id = i.id)
       and (p_hotel is null or i.hotel_id = p_hotel)
       and (
         (p_invoice is not null and i.id = p_invoice)
         or (p_invoice is null
             and f.bill_to = 'guest'
             and exists (select 1 from guest_message_settings s
                          where s.hotel_id = i.hotel_id and s.kind = 'invoice'
                            and s.is_on and i.issued_at >= s.switched_on_at))
       )
  ),
  way as (
    select v.*, w.channel
      from inv v
      cross join lateral (
        select 'whatsapp'::text as channel where v.by_whatsapp
        union all select 'email' where v.by_email
      ) w
  )
  select w.id, w.number, w.channel, w.issued_by,
         w.hotel_id, w.code, w.hotel_name, w.hotel_phone,
         w.reservation_id, w.reference,
         w.full_name, w.phone, w.email, w.total
    from way w
   where not exists (select 1 from messages_sent m
                      where m.about_kind = 'invoice' and m.about_id = w.id::text
                        and m.channel = w.channel and m.status = 'sent')
     and (select count(*) from messages_sent m
           where m.about_kind = 'invoice' and m.about_id = w.id::text
             and m.channel = w.channel and m.status = 'failed') < p_most_attempts
   order by w.number, w.channel
$fn$;

comment on function app.guest_invoices_owed(integer, uuid, uuid) is
  'The tax invoices owed to their guests, one row per way (D27-252, D27-261): '
  'by itself only a guest''s invoice issued after the hotel''s switch was last '
  'turned on; for the desk''s button, the one invoice. Never a credit note.';

revoke all on function app.guest_invoices_owed(integer, uuid, uuid) from public;
grant execute on function app.guest_invoices_owed(integer, uuid, uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- 5 · The night-audit reports owed to their people (D27-261, Q7)
-- -----------------------------------------------------------------------------
-- Each completed night audit of the last two days, each report chosen before
-- it ran, each person still active and still at the hotel (or a group
-- administrator) - not sent yet, under the tries. The sweep builds each report
-- under THAT PERSON's own session, so it holds only what they may read.
create or replace function app.report_emails_owed(p_most_attempts integer, p_hotel uuid default null)
returns table (
  run_id uuid, hotel_id uuid, hotel_code text, hotel_name text, timezone text, business_date text,
  report text, staff_id uuid, staff_name text, staff_email text
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select n.id, n.hotel_id, h.code, h.name, h.timezone, n.business_date::text,
         e.report, s.id, s.full_name, s.email::text
    from night_audit_runs n
    join hotels h        on h.id = n.hotel_id
    join report_emails e on e.hotel_id = n.hotel_id and e.added_at <= n.completed_at
    join staff s         on s.id = e.staff_id and s.is_active
   where n.status = 'completed'
     and n.completed_at > now() - interval '2 days'
     and (p_hotel is null or n.hotel_id = p_hotel)
     and (s.is_group_admin
          or exists (select 1 from staff_hotels sh where sh.staff_id = s.id and sh.hotel_id = n.hotel_id))
     and not exists (select 1 from messages_sent m
                      where m.about_kind = 'night-audit' and m.kind = 'report'
                        and m.about_id = n.id::text || '/' || e.report || '/' || s.id::text
                        and m.status = 'sent')
     and (select count(*) from messages_sent m
           where m.about_kind = 'night-audit' and m.kind = 'report'
             and m.about_id = n.id::text || '/' || e.report || '/' || s.id::text
             and m.status = 'failed') < p_most_attempts
   order by n.completed_at, e.report, s.full_name
$fn$;

comment on function app.report_emails_owed(integer, uuid) is
  'The reports owed by email after each completed night audit (D27-261): each '
  'chosen report to each chosen person still at the hotel, once.';

revoke all on function app.report_emails_owed(integer, uuid) from public;
grant execute on function app.report_emails_owed(integer, uuid) to pms_app;


-- -----------------------------------------------------------------------------
-- 6 · Is online check-in on at this hotel? (D27-266)
-- -----------------------------------------------------------------------------
-- Online check-in comes later: until a hotel switches it on, no guest page is
-- minted for the voucher, so its PDF prints no link and no QR and the email has
-- no link line; the desk's Send check-in link is hidden. No saved switch: OFF.
-- A definer, because the sweep has nobody signed in.
create or replace function app.online_checkin_on(p_hotel uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select coalesce((select s.is_on from guest_message_settings s
                    where s.hotel_id = p_hotel and s.kind = 'online-checkin'), false)
$fn$;

revoke all on function app.online_checkin_on(uuid) from public;
grant execute on function app.online_checkin_on(uuid) to pms_app;
