-- =============================================================================
-- 156 — a billed function keeps its hall (round F, 29 Sep; the master's yes)
-- =============================================================================
-- Round E's "Bill the function" (D27-138) sets a function's status to
-- 'completed', any time after Confirm - so a wedding billed a week ahead is
-- 'completed' before it takes place. 060's two guards against selling a hall
-- twice held only 'confirmed':
--
--   app.banquet_conflicts          ... and e.status = 'confirmed'
--   be_no_double_booking           ... where (status = 'confirmed')
--
-- so once billed, a function freed its hall: round F confirmed a second
-- function into QA Hall on 28 Aug, 19:00-22:00, over a billed one 18:00-23:00,
-- and it was accepted. This restores 060's own rule ("only a CONFIRMED event
-- holds the venue") for the status a confirmed event now moves on to.
--
-- And the refusal starts with a capital (QA X-4): "the hall is taken: ..."
-- was shown as the database wrote it.
--
-- Re-runnable: the constraint is dropped if it exists and added again; the
-- functions keep their names, arguments and return types (CREATE OR REPLACE,
-- MEMORY 317).
-- =============================================================================

create or replace function app.banquet_conflicts(
  p_venue  uuid,
  p_from   timestamptz,
  p_to     timestamptz,
  p_except uuid default null      -- the event being edited holds itself
)
returns table (
  id        uuid,
  reference text,
  title     text,
  starts_at timestamptz,
  ends_at   timestamptz
)
language sql stable as $$
  select e.id, e.reference, e.title, e.starts_at, e.ends_at
    from banquet_events e
   where e.venue_id = p_venue
     and e.status in ('confirmed', 'completed')
     and (p_except is null or e.id <> p_except)
     and tstzrange(e.starts_at, e.ends_at, '[)')
      && tstzrange(p_from, p_to, '[)')
   order by e.starts_at;
$$;

alter table banquet_events drop constraint if exists be_no_double_booking;
alter table banquet_events add constraint be_no_double_booking
  exclude using gist (
    venue_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('confirmed', 'completed'));

create or replace function app.confirm_banquet_event(p_event uuid, p_by uuid)
returns uuid                       -- the folio the event will bill to
language plpgsql as $$
declare
  e       record;
  v_clash record;
  v_folio uuid;
begin
  select * into e from banquet_events where id = p_event for update;
  if not found then
    raise exception 'no such event';
  end if;

  if e.status = 'cancelled' then
    raise exception 'that function was cancelled'
      using hint = 'Register it again rather than reviving the cancelled one, '
                   'so the cancellation stays on the record.';
  end if;

  /* Named, not merely refused. The exclusion constraint would catch this
     anyway, but it would say "conflicting key value violates exclusion
     constraint" — true, and useless to a GM holding a telephone. */
  select * into v_clash
    from app.banquet_conflicts(e.venue_id, e.starts_at, e.ends_at, e.id) limit 1;
  if found then
    raise exception 'The hall is taken: % (%), % to %',
      v_clash.title, v_clash.reference,
      to_char(v_clash.starts_at, 'DD Mon HH24:MI'),
      to_char(v_clash.ends_at,   'DD Mon HH24:MI')
      using hint = 'Move this function, or cancel the one holding the hall.';
  end if;

  update banquet_events
     set status = 'confirmed', confirmed_by = p_by, confirmed_at = now()
   where id = p_event;

  /* The folio opens ON CONFIRMATION, not at registration. An enquiry that
     never became a booking should not leave an empty bill behind for
     somebody to wonder about. */
  select id into v_folio from folios
   where event_id = p_event and status = 'open';
  if v_folio is null then
    insert into folios (hotel_id, event_id, bill_to, company_id)
    values (e.hotel_id, p_event,
            case when e.company_id is not null then 'company' else 'guest' end,
            e.company_id)
    returning id into v_folio;
  end if;

  return v_folio;
end $$;
