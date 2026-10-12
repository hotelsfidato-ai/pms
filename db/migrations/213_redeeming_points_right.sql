-- =============================================================================
-- 213 · Redeeming loyalty points gets its own right (the owner's D27-305 (1),
--       12 October)
-- =============================================================================
-- Until now app.loyalty_redeem asked nobody's role, and the server let in
-- whoever may add to a bill (`invoice` create) - the Accountant among them,
-- though the programme's rule is "Reception enrols and redeems" (L6). The
-- owner: redeeming points is its own right, held by Reception and above - the
-- people who run the desk: the owner, an Administrator, the GM, the Hotel
-- Manager and Reception. The Accountant no longer redeems.
--
-- Written out, not borrowed from another answer (as app.corrects_closed_days,
-- 134): this one is the owner's D27-305 and changes only with them. The
-- server's gate asks the same five (api/src/roleGate.ts, LOYALTY_POINTS), and
-- api/test/modules/loyalty/loyalty.test.ts fails if the two ever differ.
--
-- Re-runnable: a new function, and app.loyalty_redeem replaced with the
-- signature, return type and security it had (MEMORY 317) - its body is
-- loyalty's, word for word, with the one check added after the stay is found.
-- =============================================================================

create or replace function app.redeems_loyalty_points(p_hotel uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select app.is_group_admin() or exists (
    select 1 from staff_hotels sh
      join staff s on s.id = sh.staff_id
     where sh.staff_id = app.current_user_id()
       and sh.hotel_id = p_hotel
       and s.is_active
       and sh.role in ('owner', 'admin', 'gm', 'hotel_manager', 'front_desk'));
$$;

comment on function app.redeems_loyalty_points(uuid) is
  'D27-305: who may take a member''s loyalty points off a bill at this hotel - '
  'the owner, an Administrator, the GM, the Hotel Manager or Reception, or a '
  'group administrator. Not the Accountant.';

revoke all on function app.redeems_loyalty_points(uuid) from public;
grant execute on function app.redeems_loyalty_points(uuid) to pms_app;


-- The stay is found first, through the caller's own hotels: a person not
-- rostered there is told "No such stay here", and anybody who can see it is
-- asked the right next (MEMORY 401: the check is keyed on a row they can read).
create or replace function app.loyalty_redeem(p_reservation uuid, p_points integer, p_key uuid default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r record; m uuid; bal int; room_left numeric; want int; take int; g record;
        name text; day date; pid bigint;
begin
  select res.id, res.hotel_id, res.guest_id, res.status, app.loyalty_not_direct(res.id) as not_direct into r
    from reservations res
   where res.id = p_reservation and res.hotel_id in (select app.auth_hotel_ids());
  if r.id is null then return 'No such stay here.'; end if;
  if not app.redeems_loyalty_points(r.hotel_id) then
    return 'Points are used by reception, the hotel manager, the general manager, an administrator or the owner.';
  end if;
  perform pg_advisory_xact_lock(hashtext('loyalty:' || app.guest_standing(r.guest_id)));
  -- One press, one discount: a repeat answers as the first did. After the
  -- lock, so two at once cannot both miss it.
  if p_key is not null and exists (select 1 from folio_postings
                                    where hotel_id = r.hotel_id and idempotency_key = p_key) then
    return null;
  end if;
  if r.status <> 'checked_in' then return 'Points are used while the guest is checked in.'; end if;
  if not app.module_enabled(r.hotel_id, 'loyalty') then
    return 'Loyalty is off at this hotel. The owner or an administrator turns it on in Settings.';
  end if;
  if r.not_direct then
    return 'Points are used on direct bookings only, not on a booking from a booking site or an agent.';
  end if;
  m := app.loyalty_member(r.guest_id);
  if m is null then return 'This guest is not a member.'; end if;
  if p_points is null or p_points < 500 then return 'Points are used from 500 at a time.'; end if;
  if exists (select 1 from invoices i join folios f on f.id = i.folio_id
              where f.reservation_id = r.id and i.credits_id is null
                and not exists (select 1 from invoices cn where cn.credits_id = i.id)) then
    return 'This stay has a tax invoice. Points cannot be taken off it now.';
  end if;

  bal := app.loyalty_balance(r.guest_id);
  if p_points > bal then return format('The guest has %s points.', bal); end if;

  -- The room charges on the guest's own bill (never a company's, L14), less
  -- what points already took off them - whole rupees per bill and rate,
  -- counted exactly as the loop below takes them.
  select coalesce(sum(floor(s.net)), 0) into room_left from (
    select sum(fp.amount) as net
      from folio_postings fp join folios f on f.id = fp.folio_id
     where f.reservation_id = r.id and f.bill_to = 'guest'
       and (fp.category = 'room' or (fp.category = 'discount' and fp.source_type = 'loyalty'))
       and fp.reverses_id is null
       and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)
     group by fp.folio_id, fp.tax_rate
    having sum(fp.amount) >= 1) s;
  if p_points > room_left then
    return format('Points come off room charges only, and this bill has %s of them left.',
                  '₹' || to_char(room_left, 'FM999999990'));
  end if;

  select loyalty_name into name from group_settings where id = 1;
  day := app.business_date(r.hotel_id);
  want := p_points;
  for g in
    select fp.folio_id, fp.tax_rate, sum(fp.amount) as net, min(fp.business_date) as first_day
      from folio_postings fp join folios f on f.id = fp.folio_id
     where f.reservation_id = r.id and f.bill_to = 'guest'
       and (fp.category = 'room' or (fp.category = 'discount' and fp.source_type = 'loyalty'))
       and fp.reverses_id is null
       and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id)
     group by fp.folio_id, fp.tax_rate
    having sum(fp.amount) >= 1
     order by min(fp.business_date), fp.tax_rate
  loop
    exit when want = 0;
    take := least(want, floor(g.net)::int);
    insert into folio_postings
      (hotel_id, folio_id, business_date, category, description, amount,
       tax_rate, tax_amount, source_type, posted_by, idempotency_key)
    values (r.hotel_id, g.folio_id, day, 'discount',
            format('%s: %s points', coalesce(name, 'Loyalty'), take), -take,
            g.tax_rate, -round(take * g.tax_rate / 100.0, 2), 'loyalty', app.current_user_id(),
            case when want = p_points then p_key end)
    returning id into pid;
    insert into loyalty_points (member_id, hotel_id, kind, points, reservation_id, folio_posting_id, recorded_by)
    values (m, r.hotel_id, 'redeem', -take, r.id, pid, app.current_user_id());
    want := want - take;
  end loop;
  return null;
end
$$;
