-- =============================================================================
-- 056 — a group, and who pays for it
-- =============================================================================
-- Twelve rooms under "Sharma Wedding". The host settles the accommodation;
-- every guest pays their own bar tab. That is not a choice between one folio
-- and twelve — it is both at once, and 006 said so before any of this existed:
--
--   "Usually one per reservation, but not always: a company pays the room
--    while the guest pays their own bar tab, which is two folios on one stay.
--    Model that from the start; retrofitting split billing is genuinely
--    painful."
--
-- `folios.reservation_id` was made nullable for exactly this. What was missing
-- is the other end of the link: nothing said which GROUP an unattached folio
-- belongs to, so a master folio could exist and could not be found.
--
-- ── THE TRAP THIS MIGRATION IS MOSTLY ABOUT ─────────────────────────────────
--
-- The night audit decides it has already charged a stay tonight by asking
-- whether the FOLIO holds a room charge for the business date:
--
--   and not exists (select 1 from folio_postings fp
--                    where fp.folio_id = f.id
--                      and fp.category = 'room'
--                      and fp.business_date = $2)
--
-- That is exactly right while every stay has its own folio, and it is the
-- thing that makes an interrupted audit safe to restart. Point twelve rooms at
-- one master folio and it silently becomes: charge the first room, then skip
-- the other eleven, every night, for ever. Twelve rooms occupied and one
-- night's revenue — and nothing in the run's own summary looks wrong, because
-- it reports what it posted.
--
-- So `folio_postings` gains `reservation_id`: a posting knows which stay
-- produced it, the check becomes per stay rather than per folio, and a master
-- folio holding twelve room charges can say which room each is for without
-- parsing the description text.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A folio can belong to a group instead of a reservation
-- -----------------------------------------------------------------------------
alter table folios add column if not exists
  group_id uuid references reservation_groups(id);

comment on column folios.group_id is
  'Set on a MASTER folio: one account for a whole group, with no reservation '
  'of its own. Exactly one of reservation_id and group_id is set.';

-- Every folio belongs to exactly one thing. A folio attached to neither is
-- unreachable from any screen; one attached to both has two owners and two
-- answers to "who settles this".
alter table folios drop constraint if exists folios_belongs_to_one;
alter table folios add constraint folios_belongs_to_one check (
  (reservation_id is not null) <> (group_id is not null)
);

create index if not exists folios_group_idx on folios (group_id)
  where group_id is not null;

-- One open master per group. Two would split the host's bill in half with
-- nothing saying which is which.
create unique index if not exists folios_one_open_master
  on folios (group_id) where group_id is not null and status = 'open';


-- -----------------------------------------------------------------------------
-- A posting knows which stay produced it
-- -----------------------------------------------------------------------------
alter table folio_postings add column if not exists
  reservation_id uuid references reservations(id);

comment on column folio_postings.reservation_id is
  'The stay this line is for. Equal to the folio''s own reservation on an '
  'ordinary folio, and the whole point on a master folio, where twelve rooms '
  'post to one account and the night audit must still be able to ask "have I '
  'charged THIS room tonight".';

create index if not exists folio_postings_reservation_idx
  on folio_postings (reservation_id, category, business_date)
  where reservation_id is not null;

-- Backfill from the folio, which is where the answer already was for every
-- posting made before routing existed.
--
-- The append-only guard is lifted for exactly this statement and put straight
-- back. It refuses UPDATE on a posting, and it is right to: a wrong amount is
-- REVERSED, never edited. This changes no amount, no date and no category — it
-- writes down a fact that was already true and previously only reachable
-- through a join. Doing it any other way would mean reversing and re-posting
-- every historical line to add a column, which is not a correction of
-- anything.
--
-- Re-runnable, like everything else here: the `is null` filter means a second
-- application updates nothing at all.
do $$
begin
  alter table folio_postings disable trigger folio_postings_append_only;
  update folio_postings fp
     set reservation_id = f.reservation_id
    from folios f
   where f.id = fp.folio_id
     and fp.reservation_id is null
     and f.reservation_id is not null;
  alter table folio_postings enable trigger folio_postings_append_only;
end $$;


-- -----------------------------------------------------------------------------
-- And it is filled in whether or not the caller remembers
-- -----------------------------------------------------------------------------
-- The backfill above only fixes rows that existed when this migration ran. Any
-- writer that does not set the column keeps producing postings the night
-- audit's per-stay check cannot see — and the failure is the worst possible
-- shape: the audit decides it has NOT charged that stay tonight, and charges
-- it again. The demo loader did exactly this, and two tests caught it within a
-- minute of the check changing.
--
-- So the database fills it in. On an ordinary folio the answer is already
-- there — the folio's own reservation — and no caller can forget it.
--
-- On a MASTER folio there is nothing to infer from: the folio belongs to a
-- group, and which of twelve rooms a line is for is knowable only to whoever
-- posts it. That stays the caller's job, and the night audit does supply it.
-- -----------------------------------------------------------------------------
create or replace function app.posting_names_its_stay()
returns trigger language plpgsql as $$
begin
  if new.reservation_id is null then
    select f.reservation_id into new.reservation_id
      from folios f where f.id = new.folio_id;
  end if;
  return new;
end $$;

drop trigger if exists folio_postings_name_stay on folio_postings;
create trigger folio_postings_name_stay
  before insert on folio_postings
  for each row execute function app.posting_names_its_stay();

comment on function app.posting_names_its_stay() is
  'Fills folio_postings.reservation_id from the folio when the caller did not. '
  'Without it a writer that forgets produces postings the night audit cannot '
  'see, and it charges the stay a second time.';


-- -----------------------------------------------------------------------------
-- Which stays send their room charge to the master
-- -----------------------------------------------------------------------------
-- Per reservation rather than per group, because a group is rarely uniform:
-- the couple's own room is often settled by them while the rest go to the
-- host, and a group-level switch cannot express that.
--
-- ROOM CHARGES ONLY. A bar tab follows the person who ordered it unless
-- somebody says otherwise, which is the arrangement every hotel actually
-- operates and the one a guest expects when they sign for a drink.
-- -----------------------------------------------------------------------------
alter table reservations add column if not exists
  route_room_to_group boolean not null default false;

comment on column reservations.route_room_to_group is
  'When true the night audit posts this stay''s room charge to the group''s '
  'master folio. Extras still follow the guest — a bar tab belongs to whoever '
  'signed for it unless somebody says otherwise.';


-- -----------------------------------------------------------------------------
-- Where a room charge goes
-- -----------------------------------------------------------------------------
-- One definition, because the night audit is not the only thing that will ask.
-- Falls back to the stay's own folio whenever routing is off, the booking is
-- in no group, or the group has no open master — a charge must always land
-- somewhere, and silently posting nothing is the failure this cannot have.
-- -----------------------------------------------------------------------------
create or replace function app.folio_for_room_charge(p_reservation uuid)
returns uuid
language sql stable as $$
  select coalesce(
    (select m.id
       from reservations r
       join folios m on m.group_id = r.group_id and m.status = 'open'
      where r.id = p_reservation
        and r.route_room_to_group
        and r.group_id is not null),
    (select f.id from folios f
      where f.reservation_id = p_reservation and f.status = 'open'
      limit 1)
  );
$$;

comment on function app.folio_for_room_charge(uuid) is
  'The folio a room charge for this stay belongs on: the group master when the '
  'stay is routed there and the master is open, else the stay''s own folio. '
  'Never null for a stay with an open folio — a charge that lands nowhere is '
  'worse than one on the wrong account, because nobody sees it.';


-- -----------------------------------------------------------------------------
-- What a group looks like
-- -----------------------------------------------------------------------------
create or replace function app.group_rooms(p_hotel uuid, p_group uuid)
returns table (
  reservation_id uuid,
  reference      text,
  guest          text,
  room           text,
  room_type      text,
  check_in       date,
  check_out      date,
  nights         int,
  status         text,
  agreed_rate    numeric,
  routed         boolean,
  balance        numeric      -- on the stay's OWN folio, not the master
)
language sql stable as $$
  select
    r.id, r.reference, g.full_name,
    (select rm.number from room_assignments ra
       join rooms rm on rm.id = ra.room_id
      where ra.reservation_id = r.id and ra.released_at is null
      order by ra.from_date limit 1),
    rt.name, r.check_in, r.check_out, (r.check_out - r.check_in)::int,
    r.status, r.agreed_rate, r.route_room_to_group,
    coalesce((
      select sum(fp.amount + fp.tax_amount)
        from folio_postings fp
        join folios f on f.id = fp.folio_id
       where f.reservation_id = r.id
    ), 0)
  from reservations r
  join guests g on g.id = r.guest_id
  join room_types rt on rt.id = r.room_type_id
 where r.hotel_id = p_hotel
   and r.group_id = p_group
   -- A void booking never happened, so it is not one of the group's rooms.
   and r.status <> 'void'
 order by r.check_in, g.full_name;
$$;

comment on function app.group_rooms(uuid, uuid) is
  'The rooms in a group with each stay''s own balance. The master folio''s '
  'balance is asked for separately — adding them into one number would hide '
  'which half a person actually owes.';

grant select, insert, update on folios to pms_app;
grant execute on function app.folio_for_room_charge(uuid) to pms_app;
grant execute on function app.group_rooms(uuid, uuid) to pms_app;
