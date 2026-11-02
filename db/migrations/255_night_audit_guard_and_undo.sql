-- =============================================================================
-- 255 · The night audit's 16 hours, and cancelling an audit (D27-389, D27-390)
-- =============================================================================
-- 1 November at Amrapali: the audit closed 1 November at 23:36 and again at
-- 23:37, closing 2 November before it had begun. The owner, 2 November:
--
--   D27-389  under 16 hours since the last audit, the owner or an Admin go on
--            with a reason; the GM is warned and gives a reason; everyone else
--            is refused. A day that has not begun is never closed (the API).
--   D27-390  the owner or an Admin cancels audits, from the Admin section: back
--            to a chosen day ("any earlier date", the default) or one audit at
--            a time - a group setting; the bills made since move back to that
--            day, recorded; refused while a GST tax invoice stands on them.
--
-- What this migration holds:
--   1 · night_audit_runs: who passed the 16 hours and why; status 'cancelled'
--   2 · group_settings.night_audit_undo: the two ways, 'any_date' by default
--   3 · night_audit_undos: every cancel, kept - append-only by grant
--   4 · app.undoes_night_audits: who may cancel - the owner or an Admin at the
--       hotel, or a group administrator
--   5 · app.audit_undo_allows, and the five guards that ask it: a date moved
--       back by a cancel, and nothing else, inside that cancel's own transaction
--   6 · app.undo_night_audits: the dry run and the cancel, one function
--   7 · the test hotel's classes and the full reset's steps know the new table
--
-- Re-runnable.
-- =============================================================================


-- =============================================================================
-- 1 · The run's record
-- =============================================================================
alter table night_audit_runs add column if not exists early_reason text;
alter table night_audit_runs add column if not exists early_by uuid references staff(id);

comment on column night_audit_runs.early_reason is
  'D27-389: why this day was closed under 16 hours after the last audit, as typed by '
  'the owner, an Admin or the GM. Null for an audit that waited.';

alter table night_audit_runs drop constraint if exists night_audit_status_valid;
alter table night_audit_runs add constraint night_audit_status_valid
  check (status in ('running', 'completed', 'failed', 'cancelled'));


-- =============================================================================
-- 2 · The setting
-- =============================================================================
alter table group_settings add column if not exists night_audit_undo text not null default 'any_date';
alter table group_settings drop constraint if exists group_settings_night_audit_undo;
alter table group_settings add constraint group_settings_night_audit_undo
  check (night_audit_undo in ('any_date', 'one_at_a_time'));

comment on column group_settings.night_audit_undo is
  'D27-390: how far a cancel goes back. any_date (the default): to a chosen closed day, '
  'every audit from it on; one_at_a_time: the latest audit only.';


-- =============================================================================
-- 3 · Every cancel, kept
-- =============================================================================
create table if not exists night_audit_undos (
  id         uuid primary key default gen_random_uuid(),
  hotel_id   uuid not null references hotels(id) on delete cascade,
  back_to    date not null,                 -- the day the hotel is on again
  last_day   date not null,                 -- the last day whose audit was undone
  reason     text not null check (btrim(reason) <> ''),
  undone_by  uuid not null references staff(id),
  undone_at  timestamptz not null default now(),
  mode       text not null,
  audits     jsonb not null,                -- each audit as it stood
  summary    jsonb not null,                -- what was reversed, restored and moved
  tx         xid8 not null default pg_current_xact_id()
);

comment on table night_audit_undos is
  'D27-390: every night audit cancelled - the audits as they stood, the reason (recorded '
  'as a mistake), who and when, and what the cancel did. Written only by '
  'app.undo_night_audits; never changed.';

create index if not exists night_audit_undos_hotel on night_audit_undos (hotel_id, undone_at desc);

alter table night_audit_undos enable row level security;
alter table night_audit_undos force row level security;
drop policy if exists hotel_isolation on night_audit_undos;
create policy hotel_isolation on night_audit_undos
  using (hotel_id in (select app.auth_hotel_ids()));
revoke all on night_audit_undos from pms_app;
grant select on night_audit_undos to pms_app;

drop trigger if exists night_audit_undos_audit on night_audit_undos;
create trigger night_audit_undos_audit after insert on night_audit_undos
  for each row execute function app.write_audit();


-- =============================================================================
-- 4 · Who may cancel
-- =============================================================================
-- Written out, as 134's corrects_closed_days is: this is the owner's D27-390 and
-- changes only with them.
create or replace function app.undoes_night_audits(p_hotel uuid)
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
       and sh.role in ('owner', 'admin'));
$$;

comment on function app.undoes_night_audits(uuid) is
  'D27-390: the owner or an Admin at this hotel, or a group administrator, may cancel '
  'its night audits.';

grant execute on function app.undoes_night_audits(uuid) to pms_app;


-- =============================================================================
-- 5 · A date moved back by a cancel, and nothing else
-- =============================================================================
-- True only inside the transaction of a cancel of THIS hotel, which wrote its
-- night_audit_undos row in this same transaction. pms_app may set the setting,
-- but it cannot write that row (no insert grant), so it cannot open this door.
create or replace function app.audit_undo_allows(p_hotel uuid)
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select p_hotel is not null
     and coalesce(current_setting('app.audit_undo', true), '') = p_hotel::text
     and exists (select 1 from night_audit_undos u
                  where u.hotel_id = p_hotel and u.tx = pg_current_xact_id())
$$;

grant execute on function app.audit_undo_allows(uuid) to public;

-- The append-only guard (forbid_mutation, latest in "test hotels"): the same,
-- and an update that changes the business date alone, inside a cancel.
create or replace function app.forbid_mutation()
returns trigger
language plpgsql
as $function$
begin
  -- D27-296: a test hotel's own ledger, during its reset.
  if tg_op = 'DELETE'
     and app.test_reset_allows(nullif(to_jsonb(old) ->> 'hotel_id', '')::uuid) then
    return old;
  end if;
  -- D27-390: a cancelled night audit moves the day's trade back to its day.
  if tg_op = 'UPDATE'
     and (to_jsonb(old) - 'business_date') = (to_jsonb(new) - 'business_date')
     and app.audit_undo_allows(nullif(to_jsonb(old) ->> 'hotel_id', '')::uuid) then
    return new;
  end if;
  raise exception
    '% is append-only. Post a reversing entry instead of % on row %.',
    tg_table_name, tg_op, coalesce(old.id::text, '?')
    using hint = 'Insert a negative/reversing posting that references the original.';
end
$function$;

create or replace function app.cashier_shift_is_final()
returns trigger
language plpgsql
as $function$
begin
  if (to_jsonb(old) - 'business_date') = (to_jsonb(new) - 'business_date')
     and app.audit_undo_allows(old.hotel_id) then
    return new;                                     -- D27-390
  end if;
  if old.closed_at is not null then
    raise exception 'that shift is already closed'
      using hint = 'A correction is a movement on the current shift, not an '
                   'edit of a finished one.';
  end if;
  return new;
end $function$;

create or replace function app.pos_day_end_is_final()
returns trigger
language plpgsql
as $function$
begin
  if (to_jsonb(old) - 'business_date') = (to_jsonb(new) - 'business_date')
     and app.audit_undo_allows(old.hotel_id) then
    return new;                                     -- D27-390
  end if;
  if old.closed_at is not null then
    raise exception 'the day end for % is already closed', old.business_date
      using hint = 'A correction is a movement on today, not an edit of '
                   'yesterday.';
  end if;
  return new;
end $function$;

create or replace function app.cash_deposit_verified_once()
returns trigger
language plpgsql
as $function$
begin
  if (to_jsonb(old) - 'business_date') = (to_jsonb(new) - 'business_date')
     and app.audit_undo_allows(old.hotel_id) then
    return new;                                     -- D27-390
  end if;
  if old.verified_at is not null then
    raise exception 'that deposit is already verified';
  end if;
  if (new.id, new.hotel_id, new.business_date, new.amount, new.deposited_on,
      new.bank, new.slip_no, new.reverses_id, new.reason, new.recorded_by,
      new.recorded_at)
     is distinct from
     (old.id, old.hotel_id, old.business_date, old.amount, old.deposited_on,
      old.bank, old.slip_no, old.reverses_id, old.reason, old.recorded_by,
      old.recorded_at) then
    raise exception 'a deposit is never edited'
      using hint = 'Reverse it with a reason and record it again.';
  end if;
  return new;
end $function$;


-- =============================================================================
-- 6 · The cancel
-- =============================================================================
-- app.undo_night_audits(hotel, back_to, reason, go):
--   go = false  the dry run: what would be undone, reversed, restored and moved,
--               and the refusal if there is one. Writes nothing.
--   go = true   the same, then all of it - or, refused, the dry run's answer and
--               nothing done.
--
-- Undone, for every completed audit from back_to to the latest:
--   * the run is kept, status 'cancelled', and copied whole into the cancel's row;
--   * every charge it posted (room nights, no-show retentions) is reversed by a
--     line naming the cancel (source 'night_audit_undo'), on its own day;
--   * every booking it made a no-show is confirmed again, its room held again
--     where nobody holds it since, and named where somebody does.
-- Moved back to back_to, every row of trade dated after it: restaurant bills,
-- bill lines (not a room night: a room line says which night it pays for), the
-- desk's and the till's drawers and their cash, POS tickets, stock movements and
-- counts, deposits, laundry, the bar's requests and closed days.
-- Refused, before anything is written:
--   * anybody but the owner, an Admin or a group administrator; no reason;
--   * a day that is not a closed one; in one-at-a-time, any but the latest;
--   * a GST tax invoice or a VAT bill standing on any of those days, or on a bill
--     a reversed charge sits on - a credit note first, and the CA should confirm;
--   * a room line on a later day that the cancel did not post (a check-in, a
--     correction): moving it would change the night it pays for;
--   * a closed day's correction on a later day; two till days or two bar closed
--     days that would land on one day.
create or replace function app.undo_night_audits(
  p_hotel uuid, p_back_to date, p_reason text, p_go boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_mode    text := coalesce((select night_audit_undo from group_settings where id = 1), 'any_date');
  v_latest  date;
  v_last    date;
  v_runs    jsonb;
  v_refusal text;
  v_moves   jsonb := '[]';
  v_charges bigint;
  v_total   numeric;
  v_noshows bigint;
  v_held    bigint := 0;
  v_kept    jsonb := '[]';
  v_undo    uuid;
  v_summary jsonb;
  v_days    jsonb;
  v_noshow_list jsonb;
  m         record;
  r         record;
  -- What moves: [table, what the owner reads, extra condition]
  v_tables  jsonb := $t$[
    ["pos_orders",         "Restaurant bills",                 ""],
    ["folio_postings",     "Charges and payments on room bills", "and category <> 'room' and coalesce(source_type, '') not in ('night_audit', 'night_audit_undo')"],
    ["pos_tickets",        "Restaurant bills sent to rooms",   ""],
    ["pos_tender_changes", "Changes to how a bill was paid",   ""],
    ["pos_cash_movements", "The till's cash in and out",       ""],
    ["pos_day_ends",       "The till's day end",               ""],
    ["cashier_shifts",     "The front desk's drawers",         ""],
    ["cash_deposits",      "Bank deposits",                    ""],
    ["cash_deposit_notes", "Deposit notes",                    ""],
    ["stock_movements",    "Stock movements",                  ""],
    ["stock_count_lines",  "Stock counts",                     ""],
    ["laundry_dockets",    "Laundry",                          ""],
    ["bar_requests",       "The bar's requests",               ""],
    ["bar_closed_days",    "Bar closed for the day",           ""]
  ]$t$::jsonb;
begin
  -- One audit, or one cancel, at a time at a hotel: the run's own lock (NA-3).
  perform pg_advisory_xact_lock(hashtext('night_audit:' || p_hotel::text));

  select max(business_date) into v_latest
    from night_audit_runs where hotel_id = p_hotel and status = 'completed';

  v_refusal := case
    when not app.undoes_night_audits(p_hotel) then
      'Only the owner or an administrator may cancel a night audit.'
    when v_latest is null then
      'This hotel has no night audit to cancel.'
    when p_back_to is null or not exists (
           select 1 from night_audit_runs
            where hotel_id = p_hotel and business_date = p_back_to and status = 'completed') then
      'Choose a day whose night audit was run.'
    when v_mode = 'one_at_a_time' and p_back_to <> v_latest then
      format('Audits are cancelled one at a time here: the latest, %s, comes first.',
             to_char(v_latest, 'FMDD Mon YYYY'))
  end;

  if v_refusal is null then
    select jsonb_agg(jsonb_build_object(
             'businessDate', to_char(n.business_date, 'YYYY-MM-DD'),
             'startedAt', n.started_at, 'completedAt', n.completed_at,
             'ranBy', app.colleague_name(n.run_by, n.hotel_id),
             'roomsPosted', n.rooms_posted, 'revenuePosted', n.revenue_posted,
             'noShows', n.no_shows, 'earlyReason', n.early_reason)
             order by n.business_date)
      into v_runs
      from night_audit_runs n
     where n.hotel_id = p_hotel and n.status = 'completed' and n.business_date >= p_back_to;
    v_last := v_latest;

    -- The charges the audits posted, still standing.
    select count(*), coalesce(sum(fp.amount + fp.tax_amount), 0) into v_charges, v_total
      from folio_postings fp
     where fp.hotel_id = p_hotel and fp.source_type = 'night_audit'
       and fp.reverses_id is null and fp.business_date between p_back_to and v_last
       and not exists (select 1 from folio_postings rv where rv.reverses_id = fp.id);

    -- The bookings they made no-shows, and not changed since.
    select count(*) into v_noshows
      from night_audit_runs n
      join audit_log a on a.hotel_id = n.hotel_id and a.table_name = 'reservations'
                      and a.action = 'UPDATE' and a.at = n.started_at
                      and a.before ->> 'status' = 'confirmed' and a.after ->> 'status' = 'no_show'
      join reservations res on res.id::text = a.row_id and res.status = 'no_show'
     where n.hotel_id = p_hotel and n.status = 'completed' and n.business_date >= p_back_to;

    -- What moves back, by day.
    for m in select e ->> 0 as t, e ->> 1 as what, e ->> 2 as extra
               from jsonb_array_elements(v_tables) e loop
      execute format(
        'select coalesce(jsonb_object_agg(d, n), ''{}'') from (
           select to_char(business_date, ''YYYY-MM-DD'') as d, count(*) as n
             from public.%I where hotel_id = $1 and business_date > $2 %s
            group by business_date) x', m.t, m.extra)
        into v_days using p_hotel, p_back_to;
      if v_days <> '{}' then
        v_moves := v_moves || jsonb_build_object('table', m.t, 'what', m.what, 'byDay', v_days);
      end if;
    end loop;

    -- The refusals that depend on what is there.
    select format('GST tax invoice %s, of %s, stands on a bill these days touch. Issue a '
                  'credit note first - and your CA should confirm it.',
                  i.number, to_char(i.business_date, 'FMDD Mon'))
      into v_refusal
      from invoices i
     where i.hotel_id = p_hotel and i.credits_id is null
       and not exists (select 1 from invoices cn where cn.credits_id = i.id)
       and (i.business_date > p_back_to
            or i.folio_id in (select fp.folio_id from folio_postings fp
                               where fp.hotel_id = p_hotel and fp.source_type = 'night_audit'
                                 and fp.reverses_id is null
                                 and fp.business_date between p_back_to and v_last))
     order by i.issued_at limit 1;

    if v_refusal is null then
      select format('VAT bill %s, of %s, stands on a bill these days touch. Cancel it first.',
                    v.number, to_char(v.business_date, 'FMDD Mon'))
        into v_refusal
        from vat_bills v
       where v.hotel_id = p_hotel and v.cancels_id is null
         and not exists (select 1 from vat_bills c where c.cancels_id = v.id)
         and (v.business_date > p_back_to
              or v.folio_id in (select fp.folio_id from folio_postings fp
                                 where fp.hotel_id = p_hotel and fp.source_type = 'night_audit'
                                   and fp.reverses_id is null
                                   and fp.business_date between p_back_to and v_last))
       order by v.issued_at limit 1;
    end if;

    if v_refusal is null then
      select format('A room was charged on %s by a check-in or a correction. Moving that line '
                    'would change the night it pays for, so this is not cancelled here.',
                    to_char(fp.business_date, 'FMDD Mon'))
        into v_refusal
        from folio_postings fp
       where fp.hotel_id = p_hotel and fp.business_date > p_back_to and fp.category = 'room'
         and coalesce(fp.source_type, '') not in ('night_audit', 'night_audit_undo')
       order by fp.business_date limit 1;
    end if;

    if v_refusal is null then
      select format('%s was corrected after it closed. Cancelling would leave that correction '
                    'on a day that is open again.', to_char(c.business_date, 'FMDD Mon'))
        into v_refusal
        from closed_day_corrections c
       where c.hotel_id = p_hotel and c.business_date > p_back_to
       order by c.business_date limit 1;
    end if;

    if v_refusal is null then
      select format('The till''s day was ended more than once from %s on, and two day ends '
                    'cannot both move to that day.', to_char(p_back_to, 'FMDD Mon'))
        into v_refusal
        from pos_day_ends d
       where d.hotel_id = p_hotel and d.business_date >= p_back_to
       group by d.outlet_id having count(*) > 1 limit 1;
    end if;

    if v_refusal is null
       and (select count(*) from bar_closed_days
             where hotel_id = p_hotel and business_date >= p_back_to) > 1 then
      v_refusal := format('The bar was marked closed on more than one day from %s on, and both '
                          'cannot move to that day.', to_char(p_back_to, 'FMDD Mon'));
    end if;

    if v_refusal is null and length(btrim(coalesce(p_reason, ''))) = 0 and p_go then
      v_refusal := 'Say why: the reason is kept with the cancel, as a mistake.';
    end if;
  end if;

  v_summary := jsonb_build_object(
    'ok', v_refusal is null,
    'refusal', v_refusal,
    'mode', v_mode,
    'latest', to_char(v_latest, 'YYYY-MM-DD'),
    'backTo', to_char(p_back_to, 'YYYY-MM-DD'),
    'audits', coalesce(v_runs, '[]'),
    'chargesReversed', coalesce(v_charges, 0),
    'chargesTotal', coalesce(v_total, 0),
    'noShowsRestored', coalesce(v_noshows, 0),
    'moves', v_moves);

  if not p_go or v_refusal is not null then
    return v_summary;
  end if;

  -- ── From here, everything or nothing ────────────────────────────────
  insert into night_audit_undos (hotel_id, back_to, last_day, reason, undone_by, mode, audits, summary)
  values (p_hotel, p_back_to, v_last, btrim(p_reason), app.current_user_id(), v_mode, v_runs, v_summary)
  returning id into v_undo;
  perform set_config('app.audit_undo', p_hotel::text, true);

  -- The bookings made no-shows, read before the runs change: each with the
  -- moment its run released its room (the run's own now()).
  select coalesce(jsonb_agg(jsonb_build_object('id', res.id, 'at', n.started_at)), '[]')
    into v_noshow_list
    from night_audit_runs n
    join audit_log a on a.hotel_id = n.hotel_id and a.table_name = 'reservations'
                    and a.action = 'UPDATE' and a.at = n.started_at
                    and a.before ->> 'status' = 'confirmed' and a.after ->> 'status' = 'no_show'
    join reservations res on res.id::text = a.row_id and res.status = 'no_show'
   where n.hotel_id = p_hotel and n.status = 'completed' and n.business_date >= p_back_to;

  -- The days are open again.
  update night_audit_runs
     set status = 'cancelled', error_message = 'Cancelled: ' || btrim(p_reason)
   where hotel_id = p_hotel and status = 'completed' and business_date >= p_back_to;

  -- Every charge the audits posted, reversed on its own day.
  insert into folio_postings
    (hotel_id, folio_id, reservation_id, business_date, category, description,
     amount, tax_rate, tax_amount, tax_scheme, tax_kind, source_type, source_id,
     reverses_id, posted_by)
  select fp.hotel_id, fp.folio_id, fp.reservation_id, fp.business_date, fp.category,
         'Night audit cancelled: ' || fp.description,
         -fp.amount, fp.tax_rate, -fp.tax_amount, fp.tax_scheme, fp.tax_kind,
         'night_audit_undo', v_undo, fp.id, app.current_user_id()
    from folio_postings fp
   where fp.hotel_id = p_hotel and fp.source_type = 'night_audit'
     and fp.reverses_id is null and fp.business_date between p_back_to and v_last
     and not exists (select 1 from folio_postings rv where rv.reverses_id = fp.id);

  -- The no-shows booked again, and their rooms held where nobody holds them since.
  update reservations set status = 'confirmed'
   where id in (select x.id from jsonb_to_recordset(v_noshow_list) as x(id uuid, at timestamptz))
     and status = 'no_show';
  for r in
    select ra.id, ra.room_id, ra.from_date, ra.to_date, res.reference
      from jsonb_to_recordset(v_noshow_list) as u(id uuid, at timestamptz)
      join room_assignments ra on ra.reservation_id = u.id and ra.released_at = u.at
      join reservations res on res.id = u.id
  loop
    if exists (select 1 from room_assignments o
                where o.room_id = r.room_id and o.released_at is null and o.id <> r.id
                  and daterange(o.from_date, o.to_date, '[)') && daterange(r.from_date, r.to_date, '[)')) then
      v_kept := v_kept || to_jsonb(r.reference);
    else
      update room_assignments set released_at = null where id = r.id;
      v_held := v_held + 1;
    end if;
  end loop;

  -- The trade since, back to the day it belongs to.
  for m in select e ->> 0 as t, e ->> 2 as extra from jsonb_array_elements(v_tables) e loop
    execute format('update public.%I set business_date = $2 where hotel_id = $1 and business_date > $2 %s',
                   m.t, m.extra)
      using p_hotel, p_back_to;
  end loop;

  perform set_config('app.audit_undo', '', true);

  return v_summary || jsonb_build_object(
    'id', v_undo, 'roomsHeldAgain', v_held, 'roomsNotHeld', v_kept,
    'businessDate', to_char(app.business_date(p_hotel), 'YYYY-MM-DD'));
end
$$;

revoke all on function app.undo_night_audits(uuid, date, text, boolean) from public;
grant execute on function app.undo_night_audits(uuid, date, text, boolean) to pms_app;


-- =============================================================================
-- 7 · The test hotel's classes and the full reset's steps
-- =============================================================================
-- Both lists as 254 and 253 left them, with night_audit_undos: trading, and
-- cleared before night_audit_runs.
create or replace function app.test_hotel_classes()
returns table (table_name text, class text)
language sql
immutable
as $$
  values
  -- setup ------------------------------------------------------------------
  ('room_types', 'setup'), ('rooms', 'setup'), ('room_type_amenities', 'setup'),
  ('room_type_photos', 'setup'), ('rates', 'setup'), ('rate_offsets', 'setup'),
  ('rate_plan_settings', 'setup'), ('rate_plan_sources', 'setup'),
  ('rate_restrictions', 'setup'), ('pricing_basis', 'setup'),
  ('booking_source_rates', 'setup'), ('room_promotions', 'setup'),
  ('cancellation_policies', 'setup'), ('inclusions', 'setup'),
  ('hotel_meal_days', 'setup'), ('hotel_holidays', 'setup'), ('tax_rules', 'setup'),
  ('tax_sac', 'setup'), ('payment_methods', 'setup'), ('hotel_lists', 'setup'),
  ('hotel_modules', 'setup'), ('hotel_texts', 'setup'), ('hotel_amenities', 'setup'),
  ('hotel_logos', 'setup'), ('hotel_photos', 'setup'), ('guest_message_settings', 'setup'),
  ('pos_outlets', 'setup'), ('pos_sections', 'setup'), ('pos_tables', 'setup'),
  ('pos_menu_categories', 'setup'), ('pos_menu_items', 'setup'),
  ('pos_item_variations', 'setup'), ('pos_addon_groups', 'setup'), ('pos_addons', 'setup'),
  ('pos_item_addon_groups', 'setup'), ('pos_numbered_addons', 'setup'),
  ('pos_kot_kinds', 'setup'), ('pos_promotions', 'setup'), ('locations', 'setup'),
  ('stock_items', 'setup'), ('bar_pours', 'setup'), ('recipe_lines', 'setup'),
  ('tally_ledger_names', 'setup'),
  ('stock_levels', 'setup'), ('suppliers', 'setup'),
  ('equipment_categories', 'setup'), ('laundry_price_items', 'setup'),
  ('spa_therapists', 'setup'), ('spa_treatments', 'setup'), ('banquet_venues', 'setup'),
  ('banquet_packages', 'setup'), ('approval_rules', 'setup'),
  ('purchase_requesters', 'setup'), ('review_links', 'setup'),
  -- trading ----------------------------------------------------------------
  ('reservations', 'trading'), ('reservation_inclusions', 'trading'),
  ('stay_companions', 'trading'),
  ('room_assignments', 'trading'), ('room_blocks', 'trading'),
  ('room_status_log', 'trading'), ('housekeeping_assignments', 'trading'),
  ('folios', 'trading'), ('folio_postings', 'trading'), ('payments', 'trading'), ('refunds', 'trading'),
  ('invoices', 'trading'), ('vat_bills', 'trading'), ('closed_day_corrections', 'trading'),
  ('night_audit_runs', 'trading'), ('night_audit_undos', 'trading'), ('form_c_filings', 'trading'),
  ('form_iii_stays', 'trading'), ('guest_links', 'trading'), ('guest_link_codes', 'trading'),
  ('guest_unlocks', 'trading'), ('guest_desk_replies', 'trading'),
  ('guest_detail_submissions', 'trading'), ('guest_digilocker_attempts', 'trading'),
  ('guest_food_orders', 'trading'), ('guest_id_photos', 'trading'),
  ('guest_id_photo_views', 'trading'), ('guest_requests', 'trading'),
  ('key_cards', 'trading'), ('wake_up_calls', 'trading'), ('lost_items', 'trading'),
  ('work_orders', 'trading'), ('work_order_costs', 'trading'), ('attachments', 'trading'),
  ('approvals', 'trading'), ('pos_orders', 'trading'), ('pos_order_lines', 'trading'),
  ('pos_order_tenders', 'trading'), ('pos_line_events', 'trading'),
  ('pos_tickets', 'trading'), ('pos_kot_prints', 'trading'), ('pos_kot_reprints', 'trading'),
  ('pos_bill_prints', 'trading'), ('bar_purchases', 'trading'), ('bar_purchase_lines', 'trading'),
  ('bar_requests', 'trading'), ('bar_request_lines', 'trading'), ('bar_closed_days', 'trading'),
  ('pos_tender_changes', 'trading'), ('pos_requests', 'trading'), ('pos_table_moves', 'trading'),
  ('pos_cash_movements', 'trading'), ('pos_day_ends', 'trading'),
  ('pos_denominations', 'trading'), ('cashier_shifts', 'trading'),
  ('cashier_movements', 'trading'), ('cashier_denominations', 'trading'),
  ('cashier_float_claims', 'trading'), ('cash_deposits', 'trading'),
  ('cash_deposit_notes', 'trading'), ('company_payments', 'trading'),
  ('credit_limit_allowances', 'trading'), ('contracts', 'trading'),
  ('contract_rates', 'trading'), ('banquet_events', 'trading'),
  ('banquet_event_packages', 'trading'), ('table_bookings', 'trading'),
  ('spa_appointments', 'trading'), ('laundry_dockets', 'trading'),
  ('laundry_docket_lines', 'trading'), ('loyalty_members', 'trading'),
  ('loyalty_points', 'trading'), ('stock_movements', 'trading'),
  ('stock_count_lines', 'trading'), ('purchase_requests', 'trading'),
  ('purchase_request_lines', 'trading'), ('supplier_bills', 'trading'),
  ('supplier_payments', 'trading'), ('supplier_credit_notes', 'trading'),
  ('supplier_reversals', 'trading'), ('equipment_items', 'trading'),
  ('equipment_history', 'trading'), ('equipment_moves', 'trading'),
  -- never ------------------------------------------------------------------
  ('staff_hotels', 'never'), ('channel_hotels', 'never'), ('channel_room_types', 'never'),
  ('channel_rate_plans', 'never'), ('channel_ari_sent', 'never'),
  ('channel_ari_pushes', 'never'), ('channel_bookings', 'never'), ('crs_hotels', 'never'),
  ('crs_room_types', 'never'), ('crs_bookings', 'never'), ('market_rate_settings', 'never'),
  ('market_rates', 'never'), ('daily_report_emails', 'never'), ('invoice_series', 'never'),
  ('vat_bill_series', 'never'), ('audit_log', 'never'), ('messages_sent', 'never'),
  ('hotel_bank_details', 'never'), ('pos_kot_stations', 'never'),
  ('hotel_setup_steps', 'never'),
  -- group ------------------------------------------------------------------
  ('hotels', 'group'), ('staff', 'group'), ('guests', 'group'), ('companies', 'group'),
  ('reservation_groups', 'group'), ('guest_documents', 'group'), ('guest_joins', 'group'),
  ('guest_not_same', 'group'), ('offer_opt_ins', 'group'), ('offer_opt_outs', 'group'),
  ('guest_messaging_began', 'group'), ('meal_plans', 'group'), ('booking_sources', 'group'),
  ('sales_people', 'group'), ('vip_levels', 'group'), ('amenities', 'group'),
  ('group_settings', 'group'), ('room_type_templates', 'group'),
  ('provisioning_keys', 'group'), ('sign_ins', 'group'), ('telemetry_events', 'group'),
  ('telemetry_requests', 'group'), ('schema_migrations', 'group')
$$;

create or replace function owner_reset.steps(p_fresh boolean)
returns table (step int, table_name text, where_sql text)
language sql
immutable
as $fn$
  select s.step::int, s.e ->> 0, s.e ->> 1
    from (
      select e, o as step from jsonb_array_elements($list$[
        ["vat_bills",                 "hotel_id = $1"],
        ["guest_food_orders",         "hotel_id = $1"],
        ["pos_order_tenders",         "order_id in (select id from pos_orders where hotel_id = $1)"],
        ["pos_order_lines",           "hotel_id = $1"],
        ["pos_tender_changes",        "hotel_id = $1"],
        ["pos_requests",              "hotel_id = $1"],
        ["pos_orders",                "hotel_id = $1"],
        ["pos_tickets",               "hotel_id = $1"],
        ["pos_cash_movements",        "hotel_id = $1"],
        ["pos_denominations",         "day_end_id in (select id from pos_day_ends where hotel_id = $1)"],
        ["pos_day_ends",              "hotel_id = $1"],
        ["banquet_event_packages",    "hotel_id = $1"],
        ["cashier_float_claims",      "closed_shift_id in (select id from cashier_shifts where hotel_id = $1)"],
        ["cashier_denominations",     "shift_id in (select id from cashier_shifts where hotel_id = $1)"],
        ["cashier_movements",         "hotel_id = $1"],
        ["cashier_shifts",            "hotel_id = $1"],
        ["cash_deposit_notes",        "hotel_id = $1"],
        ["cash_deposits",             "hotel_id = $1"],
        ["company_payments",          "hotel_id = $1"],
        ["spa_appointments",          "hotel_id = $1"],
        ["laundry_dockets",           "hotel_id = $1"],
        ["table_bookings",            "hotel_id = $1"],
        ["guest_id_photo_views",      "hotel_id = $1"],
        ["guest_id_photos",           "hotel_id = $1"],
        ["guest_digilocker_attempts", "hotel_id = $1"],
        ["guest_links",               "hotel_id = $1"],
        ["form_c_filings",            "hotel_id = $1"],
        ["form_iii_stays",            "hotel_id = $1"],
        ["stay_companions",           "hotel_id = $1"],
        ["closed_day_corrections",    "hotel_id = $1"],
        ["invoices",                  "hotel_id = $1"],
        ["refunds",                   "hotel_id = $1"],
        ["payments",                  "hotel_id = $1"],
        ["loyalty_points",            "hotel_id = $1"],
        ["folio_postings",            "hotel_id = $1"],
        ["folios",                    "hotel_id = $1"],
        ["guest_documents",           "guest_id in (select guest_id from reservations where hotel_id = $1) and not exists (select 1 from reservations r where r.guest_id = guest_documents.guest_id and r.hotel_id <> $1) and not exists (select 1 from stay_companions c where c.guest_id = guest_documents.guest_id and c.hotel_id <> $1)"],
        ["housekeeping_assignments",  "hotel_id = $1"],
        ["room_assignments",          "hotel_id = $1"],
        ["room_status_log",           "hotel_id = $1"],
        ["work_order_costs",          "hotel_id = $1"],
        ["work_orders",               "hotel_id = $1"],
        ["wake_up_calls",             "hotel_id = $1"],
        ["lost_items",                "hotel_id = $1"],
        ["room_blocks",               "hotel_id = $1"],
        ["banquet_events",            "hotel_id = $1"],
        ["reservations",              "hotel_id = $1"],
        ["reservation_groups",        "(lead_hotel_id is null or lead_hotel_id = $1) and not exists (select 1 from reservations r where r.group_id = reservation_groups.id and r.hotel_id <> $1) and not exists (select 1 from folios f where f.group_id = reservation_groups.id and f.hotel_id <> $1)"],
        ["night_audit_undos",         "hotel_id = $1"],
        ["night_audit_runs",          "hotel_id = $1"],
        ["bar_request_lines",         "hotel_id = $1"],
        ["bar_requests",              "hotel_id = $1"],
        ["bar_closed_days",           "hotel_id = $1"],
        ["supplier_reversals",        "hotel_id = $1"],
        ["supplier_payments",         "hotel_id = $1"],
        ["supplier_credit_notes",     "hotel_id = $1"],
        ["supplier_bills",            "hotel_id = $1"],
        ["bar_purchase_lines",        "hotel_id = $1"],
        ["stock_count_lines",         "hotel_id = $1"],
        ["stock_movements",           "hotel_id = $1"],
        ["bar_purchases",             "hotel_id = $1"]
      ]$list$::jsonb) with ordinality as x(e, o)
      union all
      select e, 1000 + o from jsonb_array_elements($list$[
        ["equipment_moves",           "hotel_id = $1"],
        ["equipment_history",         "hotel_id = $1"],
        ["purchase_request_lines",    "hotel_id = $1"],
        ["purchase_requests",         "hotel_id = $1"],
        ["approvals",                 "hotel_id = $1"],
        ["crs_bookings",              "hotel_id = $1"],
        ["channel_bookings",          "hotel_id = $1"],
        ["messages_sent",             "hotel_id = $1"]
      ]$list$::jsonb) with ordinality as x(e, o)
       where p_fresh
    ) s
   order by s.step
$fn$;
