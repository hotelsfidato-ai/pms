-- =============================================================================
-- 216 · The tax invoice goes by itself only when it is made out to the guest
--       (the owner's D27-313 (2), 13 October; D27-284 before it)
-- =============================================================================
-- Refer to it by what it does - "the invoice made out to the guest" - never by
-- its number.
--
-- The day check of 13 October: Harsha Kamat's 5EL/2026-27/00001 reads "Billed
-- to Expedia" and was emailed to him by itself. His bill is the guest's
-- (bill_to 'guest'), but finance's recipient rule (RECIPIENT_COMPANY,
-- api/src/modules/finance/invoices.ts) makes a guest's bill out to the
-- booking's company - an OTA, an agent or a company, all `companies` rows -
-- while the stay has no company bill of its own. app.guest_invoices_owed asked
-- only bill_to.
--
-- Now its "by itself" branch asks who the invoice is made out to, by the same
-- expression the issuing route and the Invoices list's "Billed to" read: by
-- itself only when that names no company. The desk's Send invoice (p_invoice
-- given) is unchanged and still sends any invoice, a company's too (Q5). Every
-- automatic send - the sweep's list and its re-check before each send - reads
-- this one function, through `invoicesOwed` in
-- api/src/modules/guest-messaging/invoices.ts.
--
-- ⚠ TWO COPIES OF ONE RULE: finance's RECIPIENT_COMPANY (TypeScript) and the
-- `case` below. Change both, or neither. messagesAndReports.test.ts issues
-- through finance's route and asks this function, so a drift fails there.
--
-- ponytail: asked at send time, as bill_to always was, not frozen with the
-- invoice (the invoice keeps the recipient's name, not which company it was).
-- A booking's company changed between issue and the send is read as it is now.
--
-- Re-runnable: create or replace, the same signature, columns, language and
-- security as 193 (MEMORY 317). Only the "by itself" branch changed.
-- =============================================================================

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
             -- Made out to the guest: finance's RECIPIENT_COMPANY names no
             -- company (D27-313 (2)). A company's bill always names one
             -- (folios_company_present).
             and (case when f.bill_to = 'company' then f.company_id
                       when not exists (select 1 from folios o
                                         where o.reservation_id = f.reservation_id
                                           and o.bill_to = 'company') then r.company_id
                  end) is null
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
  'by itself only an invoice made out to the guest (D27-313: finance''s '
  'recipient rule names no company), issued after the hotel''s switch was last '
  'turned on; for the desk''s button, the one invoice. Never a credit note.';

revoke all on function app.guest_invoices_owed(integer, uuid, uuid) from public;
grant execute on function app.guest_invoices_owed(integer, uuid, uuid) to pms_app;
