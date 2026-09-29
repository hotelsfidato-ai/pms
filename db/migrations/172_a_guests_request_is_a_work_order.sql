-- =============================================================================
-- 172 · A guest's request is a work order for a stay (D27-178, D27-181)
-- =============================================================================
-- The owner, 30 September: in-stay requests - towels, a broken tap, a pot of
-- tea - raised by the desk or by the guest from their own page, routed to the
-- team that does them, from open to done, with who took it and how long it
-- took. Housekeeping's work orders (058) already are that: a room, what, a
-- category, open -> in progress -> done, who has it, who closed it and when.
-- So a request is a work order that carries the stay it is for. No second
-- table, no second set of states.
--
-- Three kinds, one per team (D27-181): 'housekeeping', 'maintenance'
-- ("something broken") and 'fnb' (food and drink, new here).
--
-- The master renumbers at merge; refer to this file as "a guest's request is a
-- work order".
-- =============================================================================

alter table work_orders
  add column if not exists reservation_id uuid references reservations(id);
alter table work_orders
  add column if not exists raised_by_guest boolean not null default false;

create index if not exists work_orders_stay_idx
  on work_orders (reservation_id) where reservation_id is not null;

comment on column work_orders.reservation_id is
  'The stay an in-stay request is for (D27-178). Null for a repair nobody '
  'staying asked for.';
comment on column work_orders.raised_by_guest is
  'Raised by the guest from their own page, so there is no member of staff '
  'in raised_by.';

alter table work_orders drop constraint if exists work_orders_category_valid;
alter table work_orders add constraint work_orders_category_valid check (category in (
  'maintenance', 'housekeeping', 'electrical', 'plumbing',
  'furniture', 'it', 'other', 'fnb'));

-- A guest's request names no member of staff and always names its stay.
alter table work_orders drop constraint if exists work_orders_guest_has_a_stay;
alter table work_orders add constraint work_orders_guest_has_a_stay check (
  not raised_by_guest or (raised_by is null and reservation_id is not null));


-- -----------------------------------------------------------------------------
-- The stay belongs to the property the order does - 058's room check, widened.
-- Same name, same signature: 058's replay makes the old body, this the new.
-- -----------------------------------------------------------------------------
create or replace function app.work_order_room_is_here()
returns trigger language plpgsql as $$
declare v_hotel uuid;
begin
  if new.room_id is not null then
    select hotel_id into v_hotel from rooms where id = new.room_id;
    if v_hotel is distinct from new.hotel_id then
      raise exception 'that room is at another property';
    end if;
  end if;
  if new.reservation_id is not null then
    select hotel_id into v_hotel from reservations where id = new.reservation_id;
    if v_hotel is distinct from new.hotel_id then
      raise exception 'that stay is at another property';
    end if;
  end if;
  return new;
end $$;


-- -----------------------------------------------------------------------------
-- The guest's page (D27-181: while they are checked in). Bodies only; the
-- arguments and what each returns are 121's (MEMORY 317).
-- -----------------------------------------------------------------------------

-- The three kinds join the offers once the stay is checked in.
create or replace function app.guest_link_open(p_token_hash text, p_unlock_hash text default null)
returns table (
  link_id uuid, kind text, hotel_id uuid, hotel_code text, hotel_name text,
  room_number text, occupied boolean,
  reservation_id uuid, reference text, guest_name text,
  check_in text, check_out text, status text,
  verified boolean, phone_hint text, offers text[]
)
language sql
security definer
set search_path = pg_catalog, public
as $fn$
  update guest_links set last_seen_at = now()
   where token_hash = p_token_hash
     and revoked_at is null
     and expires_at > now();

  with s as (select * from app.guest_link_stay(p_token_hash)),
       u as (select exists (select 1 from app.guest_unlocked(p_token_hash, p_unlock_hash)) as ok)
  select s.link_id,
         case when s.room_id is null then 'booking' else 'room' end,
         h.id, h.code, h.name,
         rm.number,
         s.reservation_id is not null,
         case when s.room_id is null or u.ok then r.id end,
         case when s.room_id is null or u.ok then r.reference end,
         case when s.room_id is null or u.ok then g.full_name end,
         case when s.room_id is null or u.ok then r.check_in::text end,
         case when s.room_id is null or u.ok then r.check_out::text end,
         case when s.room_id is null or u.ok then r.status end,
         u.ok,
         case when s.room_id is not null then null
              when g.phone is null or length(g.phone) < 4 then null
              else '…' || right(g.phone, 4) end,
         case when u.ok then array(
           select k from unnest(array['spa', 'laundry']) k
            where app.module_enabled(s.hotel_id, k))
           || case when r.status = 'checked_in'
                   then array['housekeeping', 'maintenance', 'fnb']
                   else array[]::text[] end end
    from s
    cross join u
    join hotels h on h.id = s.hotel_id
    left join rooms rm       on rm.id = s.room_id
    left join reservations r on r.id = s.reservation_id
    left join guests g       on g.id = r.guest_id;
$fn$;

-- A team's kind becomes a work order for the stay, in the room it is in now;
-- spa, laundry and the desk stay guest requests (121, 132). Ten open at most
-- for the stay, counting both.
create or replace function app.guest_request_make(
  p_token_hash text, p_unlock_hash text, p_kind text, p_what text, p_wanted text)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v record;
  v_team boolean := p_kind in ('housekeeping', 'maintenance', 'fnb');
begin
  select * into v from app.guest_unlocked(p_token_hash, p_unlock_hash);
  if v.reservation_id is null
     or not (v_team or p_kind in ('spa', 'laundry', 'desk'))
     or (p_kind in ('spa', 'laundry') and not app.module_enabled(v.hotel_id, p_kind))
     or (v_team and not exists (select 1 from reservations
                                 where id = v.reservation_id and status = 'checked_in'))
     or (select count(*) from guest_requests
          where reservation_id = v.reservation_id and status = 'open')
      + (select count(*) from work_orders
          where reservation_id = v.reservation_id and status in ('open', 'in_progress')) >= 10 then
    return false;
  end if;

  if v_team then
    insert into work_orders (hotel_id, room_id, reservation_id, raised_by_guest,
                             title, detail, category)
    values (v.hotel_id,
            (select ra.room_id from room_assignments ra
              where ra.reservation_id = v.reservation_id and ra.released_at is null
              order by ra.from_date desc, ra.created_at desc limit 1),
            v.reservation_id, true, trim(p_what), nullif(trim(p_wanted), ''), p_kind);
  else
    insert into guest_requests (hotel_id, reservation_id, kind, what, wanted)
    values (v.hotel_id, v.reservation_id, p_kind, trim(p_what), nullif(trim(p_wanted), ''));
  end if;
  return true;
end
$fn$;

comment on function app.guest_request_make(text, text, text, text, text) is
  'A spa or laundry request where the hotel offers it (D21-63), a message to '
  'the front desk (D23-14), or - while checked in - a request for housekeeping, '
  'maintenance or food and drink, which is a work order for the stay (D27-181). '
  'Behind this phone''s unlock, ten open at most.';

-- The guest sees their own team requests beside the rest: waiting, being
-- done, done, declined. Not what the desk raised for them - staff words.
create or replace function app.guest_requests_mine(p_token_hash text, p_unlock_hash text)
returns table (kind text, what text, wanted text, status text, created_at timestamptz)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select q.kind, q.what, q.wanted, q.status, q.created_at
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    join guest_requests q on q.reservation_id = v.reservation_id
  union all
  select w.category, w.title, w.detail,
         case w.status when 'open' then 'waiting'
                       when 'cancelled' then 'declined' else w.status end,
         w.raised_at
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    join work_orders w on w.reservation_id = v.reservation_id and w.raised_by_guest
   order by 5 desc;
$fn$;
