-- =============================================================================
-- 179 · Key cards, recorded against the stay (D27-178, room-systems lane)
-- =============================================================================
-- 179, the master's number (2 Oct): 177 is contracts', 178 loyalty's (migrationNumbers
-- refuses a gap). Referred to by what it does: "the key-card record".
--
-- Every key card the desk cuts, and every cancellation, is one row here: what
-- was asked of the lock system, for which stay and room, and what the lock
-- system answered. The lock vendor is not known yet (D27-178), so nothing here
-- names one: `driver` is whatever answered (the stand-in in development).
--
-- APPEND-ONLY, like the folio. A card that was cut stays cut in the record; a
-- cancellation is a new row. The cards live now are the stay's last row that
-- the lock system accepted: an issue means those cards, a cancel means none.
-- =============================================================================

create table if not exists key_cards (
  -- An identity, not a uuid: a lost card is a cancel and an issue in ONE
  -- transaction, and "the last row" must be the issue - now() is the same for
  -- both, the id is not.
  id             bigint generated always as identity primary key,
  -- Cascade, and still never deleted: the append-only trigger below refuses a
  -- cascaded delete too. A test that removes its own property turns that
  -- trigger off first, as it does the folio's.
  hotel_id       uuid not null references hotels(id) on delete cascade,
  reservation_id uuid not null references reservations(id) on delete cascade,
  room_id        uuid not null references rooms(id) on delete cascade,
  act            text not null check (act in ('issue', 'cancel')),
  -- How many cards, and until when - an issue's, never a cancel's.
  cards          smallint check (cards > 0),
  valid_until    timestamptz,
  why            text not null check (why in
                   ('check_in', 'reissue', 'lost', 'check_out', 'move')),
  -- done: the lock system accepted it. failed: it did not, in its own words.
  outcome        text not null check (outcome in ('done', 'failed')),
  answer         text check (answer is null or length(answer) <= 500),
  driver         text not null check (btrim(driver) <> ''),
  by_staff       uuid not null default app.current_user_id() references staff(id),
  at             timestamptz not null default now(),
  constraint key_cards_issue_has_cards
    check ((act = 'issue') = (cards is not null and valid_until is not null)),
  constraint key_cards_why_fits_act
    check ((act = 'issue') = (why in ('check_in', 'reissue', 'lost'))
        or (act = 'cancel' and why = 'lost'))
);

comment on table key_cards is
  'D27-178: every key card issued or cancelled for a stay, and what the lock '
  'system answered. Append-only. The cards live now are the stay''s last done '
  'row: issue = those cards, cancel = none.';

create index if not exists key_cards_stay on key_cards (reservation_id, id);

alter table key_cards enable row level security;
alter table key_cards force  row level security;
drop policy if exists hotel_isolation on key_cards;
create policy hotel_isolation on key_cards
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

grant select, insert on key_cards to pms_app;
revoke update, delete on key_cards from pms_app;

drop trigger if exists key_cards_append_only on key_cards;
create trigger key_cards_append_only
  before update or delete on key_cards
  for each row execute function app.forbid_mutation();

-- WHO is the signed-in person, whatever the insert said: the record answers
-- "who cut a card for room 104 at two in the morning", so it cannot be told.
create or replace function app.key_cards_by_whoever()
returns trigger
language plpgsql
as $$
begin
  new.by_staff := app.current_user_id();
  return new;
end $$;

drop trigger if exists key_cards_by_whoever on key_cards;
create trigger key_cards_by_whoever
  before insert on key_cards
  for each row execute function app.key_cards_by_whoever();
