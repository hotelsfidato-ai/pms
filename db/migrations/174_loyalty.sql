-- =============================================================================
-- 174 · Loyalty: members, their points, and points taken off a bill
-- =============================================================================
-- Numbered 174 for now (the master's number for this lane, 30 September); the
-- master settles it at merge. Refer to this file by what it does - "loyalty" -
-- never by its number.
--
-- The owner's rules (D27-178, D27-179; src/modules/loyalty/MODULE.md, L1-L18):
--
--   1  the programme's name and its earn rate are group settings with NO
--      default: no rate, nothing earns (L1, L8)
--   2  a switch per hotel, off until somebody turns it on (L2)
--   3  a member is a PERSON across the group (D21-22): the guest record that
--      stands for them, with the words they agreed to (L3, L4); two records
--      joined as one share one balance, and an undo splits it back
--   4  the points ledger is append-only, like the folio
--   5  earning at check-out, before GST, not alcohol, not an OTA's or an
--      agent's room, once per stay (L7, L9, L10)
--   6  points off the member's own room charges while checked in: from 500,
--      up to the room charges, direct bookings only, as a DISCOUNT line under
--      the nights - never a zero price (L13, L14, L16)
--   7  leaving lapses what is left (L5); a manager's adjustment has a reason (L6)
--
-- Not here, deliberately: tiers (L12, the owner: none at the start), and the
-- 24-month expiry (L17) - no point can lapse before October 2028. ponytail:
-- write the lapse row before then.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1 · The rules: group settings, no defaults (L1, L8)
-- -----------------------------------------------------------------------------
-- On group_settings, beside the group's name: set by the same people
-- (app.sets_group_settings, the owner, 27 September), read by everybody,
-- audited by its trigger. 1 point = ₹1 off is the unit, not a setting.
alter table group_settings add column if not exists loyalty_name text;
alter table group_settings add column if not exists loyalty_points_per_100 numeric(6,2);

alter table group_settings drop constraint if exists group_settings_loyalty_name;
alter table group_settings add constraint group_settings_loyalty_name
  check (loyalty_name is null or (loyalty_name = btrim(loyalty_name) and length(loyalty_name) between 1 and 40));
alter table group_settings drop constraint if exists group_settings_loyalty_rate;
alter table group_settings add constraint group_settings_loyalty_rate
  check (loyalty_points_per_100 is null or (loyalty_points_per_100 > 0 and loyalty_points_per_100 <= 100));

comment on column group_settings.loyalty_points_per_100 is
  'Loyalty points earned per ₹100 spent before GST (the owner, D27-179: system '
  'configuration). NULL: nothing earns, and the screens say so.';


-- -----------------------------------------------------------------------------
-- 2 · The switch per hotel (L2): off until somebody turns it on
-- -----------------------------------------------------------------------------
-- ADDED TO the list the constraint already holds, never a list written out
-- here: other lanes add modules in the same days, and a full list would drop
-- theirs on whichever replays second (MEMORY 293). app.module_enabled answers
-- OFF for a module with no row.
do $$
declare def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'hotel_modules'::regclass and conname = 'hotel_modules_known';
  if def not like '%''loyalty''%' then
    alter table hotel_modules drop constraint hotel_modules_known;
    execute 'alter table hotel_modules add constraint hotel_modules_known '
         || replace(def, 'ARRAY[', 'ARRAY[''loyalty''::text, ');
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 3 · Members (L3, L4, L5)
-- -----------------------------------------------------------------------------
create table if not exists loyalty_members (
  id             uuid primary key default gen_random_uuid(),
  -- The record that stood for the person when they joined. A later join of
  -- two records is followed at read time (app.guest_standing).
  guest_id       uuid not null references guests(id),
  hotel_id       uuid not null references hotels(id),
  joined_by      uuid references staff(id),
  joined_at      timestamptz not null default now(),
  -- Exactly what they agreed to (DPDP s.6: the fiduciary proves consent).
  consent_words  text not null,
  left_at        timestamptz,
  left_by        uuid references staff(id),
  left_hotel_id  uuid references hotels(id),

  constraint loyalty_members_left_whole check ((left_at is null) = (left_hotel_id is null))
);

create unique index if not exists loyalty_members_one_open
  on loyalty_members (guest_id) where left_at is null;

comment on table loyalty_members is
  'A guest who joined the loyalty programme, with the words they agreed to '
  '(D27-179, L4). Written only by app.loyalty_join and app.loyalty_leave.';


-- -----------------------------------------------------------------------------
-- 4 · The points ledger - append-only, like the folio
-- -----------------------------------------------------------------------------
-- A balance is the sum of its rows. A redemption whose discount line on the
-- bill was reversed (↺) does not count: the points come back by themselves,
-- from the folio's own record of the reversal.
create table if not exists loyalty_points (
  id               bigserial primary key,
  member_id        uuid not null references loyalty_members(id),
  hotel_id         uuid not null references hotels(id),
  kind             text not null,
  points           integer not null,
  reservation_id   uuid references reservations(id),
  folio_posting_id bigint references folio_postings(id),
  reason           text,
  recorded_by      uuid references staff(id),
  recorded_at      timestamptz not null default now(),

  constraint loyalty_points_kind check (kind in ('earn', 'redeem', 'adjust', 'lapse')),
  constraint loyalty_points_signed check (
    points <> 0
    and (kind <> 'earn' or points > 0)
    and (kind not in ('redeem', 'lapse') or points < 0)),
  constraint loyalty_points_redeem_line check (kind <> 'redeem' or folio_posting_id is not null),
  constraint loyalty_points_adjust_reason check (
    kind <> 'adjust' or (reason is not null and length(btrim(reason)) > 0))
);

-- One earning per stay: a stay reopened and checked out again earns nothing more (L9).
create unique index if not exists loyalty_points_earn_once
  on loyalty_points (reservation_id) where kind = 'earn';
create index if not exists loyalty_points_member_idx on loyalty_points (member_id);

drop trigger if exists loyalty_points_append_only on loyalty_points;
create trigger loyalty_points_append_only
  before update or delete on loyalty_points
  for each row execute function app.forbid_mutation();


-- Read by any active staff (the desk shows a balance); written only through
-- the functions below, which say who may.
alter table loyalty_members enable row level security;
alter table loyalty_members force  row level security;
drop policy if exists loyalty_members_read on loyalty_members;
create policy loyalty_members_read on loyalty_members for select using ( app.is_active_staff() );

alter table loyalty_points enable row level security;
alter table loyalty_points force  row level security;
drop policy if exists loyalty_points_read on loyalty_points;
create policy loyalty_points_read on loyalty_points for select using ( app.is_active_staff() );

grant select on loyalty_members, loyalty_points to pms_app;


-- -----------------------------------------------------------------------------
-- 5 · Reading: the member, the balance, the words
-- -----------------------------------------------------------------------------
-- ponytail: guest_standing per member row; an index on the standing record if
-- the group ever has tens of thousands of members.
create or replace function app.loyalty_member(p_guest uuid)
returns uuid
language sql
stable
set search_path = public, pg_temp
as $$
  select m.id from loyalty_members m
   where m.left_at is null
     and app.guest_standing(m.guest_id) = app.guest_standing(p_guest)
   order by m.joined_at
   limit 1
$$;

-- Definer: a discount reversed at another hotel is behind that hotel's row
-- security, and a clerk here must still see the points come back.
create or replace function app.loyalty_balance(p_guest uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(lp.points), 0)::int
    from loyalty_points lp
    join loyalty_members m on m.id = lp.member_id
   where app.guest_standing(m.guest_id) = app.guest_standing(p_guest)
     and not (lp.kind = 'redeem'
              and exists (select 1 from folio_postings rev where rev.reverses_id = lp.folio_posting_id))
$$;

-- The one sentence a guest agrees to (L4): the screen shows it, the join keeps it.
create or replace function app.loyalty_consent_words()
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select 'Join ' || loyalty_name || ': we keep your stays and points to give you rewards. I am 18 or over.'
    from group_settings where id = 1 and loyalty_name is not null
$$;


-- -----------------------------------------------------------------------------
-- 6 · Joining and leaving (L3, L4, L5)
-- -----------------------------------------------------------------------------
-- Each answers NULL when done, or the sentence that says why not - never a
-- raise, so a refusal leaves the caller's transaction whole (MEMORY 243).
create or replace function app.loyalty_join(p_hotel uuid, p_guest uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare g uuid; words text;
begin
  if p_hotel is null or p_hotel not in (select app.auth_hotel_ids()) then return 'No such property.'; end if;
  if not app.module_enabled(p_hotel, 'loyalty') then
    return 'Loyalty is off at this hotel. The owner or an administrator turns it on in Settings.';
  end if;
  words := app.loyalty_consent_words();
  if words is null then return 'The programme has no name yet. Set it on the Loyalty screen first.'; end if;
  g := app.guest_standing(p_guest);
  if g is null then return 'No such guest.'; end if;
  if app.phone_key((select phone from guests where id = g)) is null then
    return 'A member needs a mobile number. Add it to the guest first.';
  end if;
  if app.loyalty_member(g) is not null then return 'This guest is already a member.'; end if;
  insert into loyalty_members (guest_id, hotel_id, joined_by, consent_words)
  values (g, p_hotel, app.current_user_id(), words);
  return null;
end
$$;

create or replace function app.loyalty_leave(p_hotel uuid, p_guest uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare m uuid; bal int;
begin
  if p_hotel is null or p_hotel not in (select app.auth_hotel_ids()) then return 'No such property.'; end if;
  m := app.loyalty_member(p_guest);
  if m is null then return 'This guest is not a member.'; end if;
  perform pg_advisory_xact_lock(hashtext('loyalty:' || app.guest_standing(p_guest)));
  bal := app.loyalty_balance(p_guest);
  if bal > 0 then
    insert into loyalty_points (member_id, hotel_id, kind, points, reason, recorded_by)
    values (m, p_hotel, 'lapse', -bal, 'Left the programme', app.current_user_id());
  end if;
  update loyalty_members set left_at = now(), left_by = app.current_user_id(), left_hotel_id = p_hotel
   where left_at is null and app.guest_standing(guest_id) = app.guest_standing(p_guest);
  return null;
end
$$;


-- -----------------------------------------------------------------------------
-- 7 · Earning at check-out (L7, L9, L10, L11)
-- -----------------------------------------------------------------------------
-- Called by the check-out, after the stay is checked out, in its transaction.
-- Everything on the stay's bills (a company's too, L10) before GST and after
-- discounts - so not the part paid with points - except GST lines, refunds,
-- payments, alcohol (VAT) and, on an OTA's or an agent's booking, the room.
-- Whole points, rounded down. Answers the points earned, 0 for none.
create or replace function app.loyalty_earn(p_reservation uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r record; m uuid; rate numeric; net numeric; pts int;
begin
  select res.id, res.hotel_id, res.guest_id, bs.kind as source_kind into r
    from reservations res
    left join booking_sources bs on bs.id = res.booking_source_id
   where res.id = p_reservation and res.status = 'checked_out'
     and res.hotel_id in (select app.auth_hotel_ids());
  if r.id is null or not app.module_enabled(r.hotel_id, 'loyalty') then return 0; end if;
  select loyalty_points_per_100 into rate from group_settings where id = 1;
  m := app.loyalty_member(r.guest_id);
  if rate is null or m is null then return 0; end if;

  select coalesce(sum(fp.amount), 0) into net
    from folio_postings fp
    join folios f on f.id = fp.folio_id
   where f.reservation_id = r.id
     and fp.category not in ('payment', 'refund', 'tax')
     and fp.tax_scheme = 'gst'
     and not (fp.category = 'room' and r.source_kind in ('ota', 'travel_agent'))
     and fp.reverses_id is null
     and not exists (select 1 from folio_postings rev where rev.reverses_id = fp.id);

  pts := floor(net * rate / 100);
  if pts <= 0 then return 0; end if;
  insert into loyalty_points (member_id, hotel_id, kind, points, reservation_id, recorded_by)
  values (m, r.hotel_id, 'earn', pts, r.id, app.current_user_id())
  on conflict (reservation_id) where kind = 'earn' do nothing;
  return case when found then pts else 0 end;
end
$$;


-- -----------------------------------------------------------------------------
-- 8 · Points off the bill (L13, L14, L15, L16)
-- -----------------------------------------------------------------------------
-- The nights stay on the bill at their price; the points go under them as a
-- DISCOUNT line (category 'discount', negative), which the tax invoice
-- already reads as reducing the taxable value (finance/invoices.ts). One line
-- per bill and rate, earliest nights first, so "a free night" is simply enough
-- points to cover one.
--
-- ponytail: THE CA'S ANSWER LANDS HERE (CA-L1 to CA-L3). Until then the
-- discount carries the GST rate of the nights it reduces (CA-L1's
-- recommendation, D27-179). If the CA says a night brought to ₹7,500 or below
-- is taxed at 5% (CA-L2), or that GST is due on the full value (CA-L1), the
-- `tax_rate` below is the one line that changes.
create or replace function app.loyalty_redeem(p_reservation uuid, p_points integer, p_key uuid default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r record; m uuid; bal int; room_left numeric; want int; take int; g record;
        name text; day date; pid bigint;
begin
  select res.id, res.hotel_id, res.guest_id, res.status, bs.kind as source_kind into r
    from reservations res
    left join booking_sources bs on bs.id = res.booking_source_id
   where res.id = p_reservation and res.hotel_id in (select app.auth_hotel_ids());
  if r.id is null then return 'No such stay here.'; end if;
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
  if r.source_kind in ('ota', 'travel_agent') then
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


-- -----------------------------------------------------------------------------
-- 9 · A manager's adjustment (L6): owner, admin or GM, with a reason
-- -----------------------------------------------------------------------------
create or replace function app.loyalty_adjust(p_hotel uuid, p_guest uuid, p_points integer, p_reason text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare m uuid; bal int;
begin
  if p_hotel is null or p_hotel not in (select app.auth_hotel_ids()) then return 'No such property.'; end if;
  if not app.is_crm_manager() then
    return 'Points are added or taken by the owner, an administrator or the general manager.';
  end if;
  m := app.loyalty_member(p_guest);
  if m is null then return 'This guest is not a member.'; end if;
  if p_points is null or p_points = 0 then return 'How many points?'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then return 'Say why. The reason stays on the statement.'; end if;
  perform pg_advisory_xact_lock(hashtext('loyalty:' || app.guest_standing(p_guest)));
  bal := app.loyalty_balance(p_guest);
  if bal + p_points < 0 then return format('The guest has %s points; a balance cannot go below 0.', bal); end if;
  insert into loyalty_points (member_id, hotel_id, kind, points, reason, recorded_by)
  values (m, p_hotel, 'adjust', p_points, btrim(p_reason), app.current_user_id());
  return null;
end
$$;


-- -----------------------------------------------------------------------------
-- 10 · The member card and statement (L6), and the month by hotel (L18)
-- -----------------------------------------------------------------------------
-- For the owner, an administrator and the GM, like Guest 360 (D21-4), and
-- definer for the same reason as the balance: a stay at another hotel is
-- behind that hotel's row security. NULL for anybody else.
create or replace function app.loyalty_card(p_guest uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'member', (select jsonb_build_object('since', m.joined_at, 'hotelName', h.name)
                 from loyalty_members m join hotels h on h.id = m.hotel_id
                where m.id = app.loyalty_member(p_guest)),
    'points', app.loyalty_balance(p_guest),
    'statement', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', lp.id, 'kind', lp.kind, 'points', lp.points, 'reason', lp.reason,
               'at', lp.recorded_at, 'hotelName', h.name, 'reference', r.reference,
               'undone', lp.kind = 'redeem' and exists (
                 select 1 from folio_postings rev where rev.reverses_id = lp.folio_posting_id))
             order by lp.recorded_at desc, lp.id desc)
        from loyalty_points lp
        join loyalty_members m on m.id = lp.member_id
        join hotels h on h.id = lp.hotel_id
        left join reservations r on r.id = lp.reservation_id
       where app.guest_standing(m.guest_id) = app.guest_standing(p_guest)), '[]'))
   where app.is_crm_manager()
$$;

-- Points earned and used at each hotel in one month, in rupees (1 point = ₹1),
-- so the owner can settle between hotels outside the system (L18). A use
-- reversed on the bill is not counted.
create or replace function app.loyalty_by_hotel(p_month date)
returns table (hotel_code text, hotel_name text, earned bigint, used bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select h.code, h.name,
         coalesce(sum(lp.points) filter (where lp.kind = 'earn'), 0),
         coalesce(-sum(lp.points) filter (where lp.kind = 'redeem' and not exists (
           select 1 from folio_postings rev where rev.reverses_id = lp.folio_posting_id)), 0)
    from loyalty_points lp
    join hotels h on h.id = lp.hotel_id
   where app.is_crm_manager()
     and date_trunc('month', app.hotel_day(lp.hotel_id, lp.recorded_at)) = date_trunc('month', p_month)
   group by h.code, h.name
   order by h.code
$$;


do $$
declare f text;
begin
  foreach f in array array[
    'app.loyalty_card(uuid)', 'app.loyalty_by_hotel(date)',
    'app.loyalty_member(uuid)', 'app.loyalty_balance(uuid)', 'app.loyalty_consent_words()',
    'app.loyalty_join(uuid, uuid)', 'app.loyalty_leave(uuid, uuid)', 'app.loyalty_earn(uuid)',
    'app.loyalty_redeem(uuid, integer, uuid)', 'app.loyalty_adjust(uuid, uuid, integer, text)']
  loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to pms_app', f);
  end loop;
end $$;
