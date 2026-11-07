-- =============================================================================
-- 277 · A guest's preferences (D27-383 item 10; built under D27-396)
-- =============================================================================
-- Refer to it as the migration "a guest's preferences": the master renumbers
-- at the merge.
--
-- What a guest likes, on the guest's own record - so it is the same at every
-- hotel the record already is (a guest belongs to the group, 004), and nowhere
-- it is not. Typed by the desk (whoever may edit the guest, roleGate's GUEST)
-- or by the guest on their own page, behind the code (online-checkin rule 8).
--
--   floor      "low" | "high"
--   bed        "double" | "twin"
--   quiet      true
--   smoking    true - offered only where the hotel has a room marked Smoking
--              room (043); a save at a hotel with none keeps what was there
--   food       "veg" | "jain"
--   allergies  text, up to 200 - shown in red wherever it is shown, never
--              hidden by a setting
--   pillow, newspaper   text, up to 60 each
--   notes      text, up to 300
--
-- A key is there only when it says something: no false, no blank. `{}` is no
-- preferences. New column and functions only; nothing earlier is changed.
-- Re-runnable.
-- =============================================================================

create or replace function app.guest_preferences_ok(p jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $fn$
  select jsonb_typeof(p) = 'object'
     and not exists (
       select 1 from jsonb_each(p) e
        where e.key not in ('floor', 'bed', 'quiet', 'smoking', 'food',
                            'allergies', 'pillow', 'newspaper', 'notes')
           or (e.key = 'floor' and e.value not in ('"low"'::jsonb, '"high"'::jsonb))
           or (e.key = 'bed'   and e.value not in ('"double"'::jsonb, '"twin"'::jsonb))
           or (e.key = 'food'  and e.value not in ('"veg"'::jsonb, '"jain"'::jsonb))
           or (e.key in ('quiet', 'smoking') and e.value <> 'true'::jsonb)
           or (e.key in ('allergies', 'pillow', 'newspaper', 'notes')
               and (jsonb_typeof(e.value) <> 'string'
                    or char_length(btrim(e.value #>> '{}')) not between 1 and
                       case e.key when 'allergies' then 200 when 'notes' then 300 else 60 end)));
$fn$;

alter table guests add column if not exists preferences jsonb not null default '{}'::jsonb;
alter table guests drop constraint if exists guests_preferences_ok;
alter table guests add constraint guests_preferences_ok check (app.guest_preferences_ok(preferences));

comment on column guests.preferences is
  'What the guest likes (D27-383 item 10): floor, bed, quiet, smoking, food, allergies, pillow, '
  'newspaper, notes. On the record, so it travels with the guest as the record does.';

-- Whether this hotel may offer a smoking room at all: it has one.
create or replace function app.hotel_offers_smoking(p_hotel uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $fn$
  select exists (select 1 from rooms where hotel_id = p_hotel and smoking and is_active);
$fn$;

-- What a save keeps. The smoking choice is not offered where the hotel has no
-- smoking room, so a save there keeps whatever the record already said rather
-- than clearing a choice the person was never shown. One rule, for the desk's
-- route and the guest's page alike.
create or replace function app.preferences_kept(p_new jsonb, p_old jsonb, p_hotel uuid)
returns jsonb
language sql
stable
set search_path = pg_catalog, public
as $fn$
  select case when app.hotel_offers_smoking(p_hotel) then p_new
              else (p_new - 'smoking')
                   || case when p_old ? 'smoking' then jsonb_build_object('smoking', p_old -> 'smoking')
                           else '{}'::jsonb end
         end;
$fn$;

grant execute on function app.guest_preferences_ok(jsonb)            to pms_app;
grant execute on function app.hotel_offers_smoking(uuid)             to pms_app;
grant execute on function app.preferences_kept(jsonb, jsonb, uuid)   to pms_app;

-- ── The guest's page, behind the code (online-checkin rule 8) ────────────────
-- Only the stay's own guest - the one app.guest_unlocked answers - and only
-- with this phone's unlock. The link alone reads and writes nothing.
create or replace function app.guest_preferences(p_token_hash text, p_unlock_hash text)
returns table (preferences jsonb, smoking_offered boolean)
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select g.preferences, app.hotel_offers_smoking(v.hotel_id)
    from app.guest_unlocked(p_token_hash, p_unlock_hash) v
    join guests g on g.id = v.guest_id;
$fn$;

create or replace function app.guest_preferences_save(p_token_hash text, p_unlock_hash text, p_preferences jsonb)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare v record;
begin
  select * into v from app.guest_unlocked(p_token_hash, p_unlock_hash);
  if v.guest_id is null then
    return false;
  end if;
  update guests g
     set preferences = app.preferences_kept(p_preferences, g.preferences, v.hotel_id)
   where g.id = v.guest_id;
  return true;
end
$fn$;

comment on function app.guest_preferences(text, text) is
  'The stay''s own guest''s preferences, for their page (D27-383). Behind this phone''s unlock.';
comment on function app.guest_preferences_save(text, text, jsonb) is
  'The guest sets their own preferences from their page. False, and nothing written, without the unlock.';

revoke all on function app.guest_preferences(text, text)              from public;
revoke all on function app.guest_preferences_save(text, text, jsonb)  from public;
grant execute on function app.guest_preferences(text, text)             to pms_app;
grant execute on function app.guest_preferences_save(text, text, jsonb) to pms_app;
