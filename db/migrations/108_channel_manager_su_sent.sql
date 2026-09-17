-- =============================================================================
-- 108 · The SU channel manager: what SU was last sent, date by date, and each push
-- =============================================================================
-- D17-66, part 3 of four: rooms left, prices and restrictions pushed to SU
-- "whenever they change and on demand" (docs/briefs/channel-manager.md).
--
-- "Whenever they change" is answered by COMPARING, not by triggers on inventory's
-- tables: what the PMS says now for each date is compared with what SU was last
-- sent for it, and only the dates that differ go. That needs the last thing sent,
-- which is `channel_ari_sent`: one row per room type (rooms left) or room type and
-- meal plan (price and restrictions) per date, holding exactly the fields SU
-- received. A row is written only after SU accepted the request that carried it,
-- so a refused or unanswered push is sent again next time rather than forgotten.
--
-- It is a copy of what left, not a record of the hotel's business, so it is not
-- audited row by row (a year of dates for every room type and meal plan would
-- bury the audit log). What IS the record is `channel_ari_pushes`: every push,
-- who or what started it, how many requests and dates, and what SU said.
--
-- Re-runnable; touches no table outside the channel manager's (it adds `run_as`
-- to the SU mapping's channel_hotels); creates no rows.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- What SU was last sent, per date
-- -----------------------------------------------------------------------------
create table if not exists channel_ari_sent (
  hotel_id      uuid not null references hotels(id) on delete cascade,
  room_type_id  uuid not null,
  -- The meal plan for a price-and-restrictions cell; '-' for rooms left, which
  -- the PMS counts per room type. Not null, so the primary key can hold it.
  meal_plan     text not null,
  for_date      date not null,
  value         jsonb not null,
  sent_at       timestamptz not null default now(),

  primary key (hotel_id, room_type_id, meal_plan, for_date),
  foreign key (hotel_id, room_type_id)
    references room_types (hotel_id, id) on delete cascade,
  constraint channel_ari_sent_meal_plan_present
    check (length(btrim(meal_plan)) > 0)
);

comment on table channel_ari_sent is
  'Exactly what SU was last sent for each room type (meal_plan ''-'': rooms left) '
  'or room type and meal plan on each date. Written only after SU accepted it. '
  'Compared with the PMS to send only what changed.';


-- -----------------------------------------------------------------------------
-- Every push
-- -----------------------------------------------------------------------------
create table if not exists channel_ari_pushes (
  id           bigint generated always as identity primary key,
  hotel_id     uuid not null references hotels(id) on delete cascade,
  -- 'all' sends every date in the window (a hotel's first year, or on demand);
  -- 'changes' sends the dates that differ from what SU was last sent.
  kind         text not null,
  started_by   uuid references staff(id),
  window_from  date not null,
  window_to    date not null,
  requests     int  not null,
  dates        int  not null,
  ok           boolean not null,
  result       text not null,
  ticket_ids   text[] not null default '{}',
  unpriced     int  not null default 0,
  rack_only    int  not null default 0,
  sent_at      timestamptz not null default now(),

  constraint channel_ari_pushes_kind_known check (kind in ('all', 'changes')),
  constraint channel_ari_pushes_counts_sane check (requests >= 0 and dates >= 0),
  constraint channel_ari_pushes_window_sane check (window_to >= window_from)
);

create index if not exists channel_ari_pushes_latest
  on channel_ari_pushes (hotel_id, sent_at desc);

comment on table channel_ari_pushes is
  'Each push of rooms left, prices and restrictions to SU: what started it, how '
  'much went, and what SU said. The record the owner reads.';


-- -----------------------------------------------------------------------------
-- The hotel's own people see them; the application adds and changes the copy,
-- and only adds to the log.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['channel_ari_sent', 'channel_ari_pushes'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists hotel_isolation on %I', t);
    execute format(
      'create policy hotel_isolation on %I for all '
      'using ( hotel_id in (select app.auth_hotel_ids()) ) '
      'with check ( hotel_id in (select app.auth_hotel_ids()) )', t);
  end loop;
end $$;

grant select, insert, update on channel_ari_sent to pms_app;
revoke delete on channel_ari_sent from pms_app;

grant select, insert on channel_ari_pushes to pms_app;
revoke update, delete on channel_ari_pushes from pms_app;

drop trigger if exists channel_ari_pushes_started_by_scope on channel_ari_pushes;
create trigger channel_ari_pushes_started_by_scope
  before insert on channel_ari_pushes
  for each row execute function app.assert_staff_has_hotel('started_by');


-- -----------------------------------------------------------------------------
-- Pushing by itself: which account a hotel's automatic push runs as
-- -----------------------------------------------------------------------------
-- "Whenever they change" is a push nobody pressed. It still writes what it sent
-- under row-level security, so it runs as somebody: a service account for the
-- hotel, made the way a POS outlet's is (024), never a person's login. Until
-- that account exists and is named here, the hotel is not pushed automatically;
-- the owner's on-demand push is unaffected.
alter table channel_hotels add column if not exists run_as uuid references staff(id);

comment on column channel_hotels.run_as is
  'The service account the automatic push (every minute, changes only) runs as '
  'at this hotel. Null: nothing is pushed without a person.';

drop trigger if exists channel_hotels_run_as_scope on channel_hotels;
create trigger channel_hotels_run_as_scope
  before insert or update on channel_hotels
  for each row execute function app.assert_staff_has_hotel('run_as');

-- The job asks this before it has anybody's session: which hotels are due. It
-- names a hotel and the account to run as, and nothing else, and only for a
-- hotel SU has, that is switched on for the channel manager (D17-45), and whose
-- account is active.
create or replace function app.channel_manager_due()
returns table (hotel_id uuid, run_as uuid)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select ch.hotel_id, ch.run_as
    from channel_hotels ch
    join staff s on s.id = ch.run_as and s.is_active
   where ch.on_su
     and app.module_enabled(ch.hotel_id, 'channel_manager')
$fn$;

revoke all on function app.channel_manager_due() from public;
grant execute on function app.channel_manager_due() to pms_app;

comment on function app.channel_manager_due() is
  'Hotels whose rooms left, prices and restrictions are pushed to SU by themselves: '
  'on SU, switched on for the channel manager, with an active service account to '
  'run as. Hotel id and account id only.';
