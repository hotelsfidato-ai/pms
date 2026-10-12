-- =============================================================================
-- 214 · A room's cash count includes its group's master bill (the owner's
--       D27-307 (5), 12 October)
-- =============================================================================
-- Income-tax Act 2025 s.186 (was 269ST): no cash of ₹2,00,000 or more for one
-- event. The owner counted it "stay, group and day" (D25-40, migration "cash
-- limit and PAN"). Since the master bill could be settled (D27-305), cash
-- taken there counted the group's rooms, but a room's own count did not see
-- cash taken on its group's master bill ("Host pays") - so the host could pay
-- ₹1,90,000 in cash on the master and a room ₹1,90,000 more on its own bill.
-- Now each room of the group counts the master's cash too, on any day, as it
-- counts the group's other rooms.
--
-- One change in the one count every desk payment asks (postings.ts reads
-- app.cash_taken): the master folio (group_id set, no stay) is joined once,
-- through the stay itself. A stay in no group has group_id null, which
-- matches no folio, so its figure is unchanged.
--
-- Re-runnable: create or replace, same signature, return type, language and
-- security (invoker) as before (MEMORY 317). The replay runs the old body
-- first, then this one.
-- =============================================================================

create or replace function app.cash_taken(p_stay uuid, p_date date)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(sum(p.amount), 0)
    from reservations me
    join reservations r on r.id = me.id
                        or r.group_id = me.group_id
                        or r.guest_id = me.guest_id
    join folios f         on f.reservation_id = r.id
                          or (r.id = me.id and f.group_id = me.group_id)
    join folio_postings fp on fp.folio_id = f.id
    join payments p       on p.posting_id = fp.id
   where me.id = p_stay
     and p.method = 'cash'
     and not exists (select 1 from folio_postings x where x.reverses_id = fp.id)
     and (r.id = me.id
          or r.group_id = me.group_id
          or fp.business_date = p_date)
$$;

comment on function app.cash_taken(uuid, date) is
  'Cash already received from this guest (D25-40): the stay, its group - its '
  'rooms and its master bill (D27-307) - and this guest''s other stays on this '
  'day. Reversed payments left out; refunds not subtracted.';
