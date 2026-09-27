-- =============================================================================
-- 149 · Telemetry on our own server, for the System health screen (D27-91, D27-92)
-- =============================================================================
-- The owner, 28 September: "telemetry to measure all the things", kept on our
-- own server for 180 days (CERT-In), shown to the owner and administrators on
-- System health. api/src/telemetry.ts counts in memory and writes ONE MINUTE at
-- a time through app.record_telemetry(); nothing here is a row per request.
--
-- ⚠ NO GUEST DATA, EVER. A route is stored as its PATTERN
-- (/api/hotels/:code/stays/:id), never an address with an id, a code, a name,
-- a body or a query value in it. An error is its KIND (a database error code
-- and the constraint it broke, or a program error's name), never its message,
-- because a message can carry a guest's name. A slow query is the start of its
-- SQL text with every literal taken out. The API builds these; the columns
-- below have no room for anything else to be meant.
--
-- Group-level, like `hotels` itself: no hotel_id, and no hotel in any row.
-- =============================================================================

create table if not exists telemetry_requests (
  minute    timestamptz not null,
  method    text not null,
  route     text not null,
  status    smallint not null,
  count     integer not null,
  total_ms  bigint not null,
  max_ms    integer not null,
  -- How many answered within each step of api/src/telemetry.ts STEPS_MS
  -- (25 ms ... 10 s, and the last over 10 s). The 95% figure is read off these.
  buckets   integer[] not null,
  primary key (minute, method, route, status)
);

create table if not exists telemetry_events (
  minute  timestamptz not null,
  kind    text not null,
  place   text not null,        -- "POST /api/hotels/:code/..." for an error; '' for a query
  what    text not null,        -- the error's kind, or the query's value-free name
  count   integer not null,
  max_ms  integer,
  primary key (minute, kind, place, what),
  constraint telemetry_events_kind check (kind in ('error', 'slow_query'))
);

comment on table telemetry_requests is
  'Requests per minute by route PATTERN, method and status (D27-92). No ids, '
  'no names, no values. Kept 180 days by app.record_telemetry().';
comment on table telemetry_events is
  'Server errors by kind and slow queries by value-free name, per minute '
  '(D27-92). Kept 180 days by app.record_telemetry().';


-- -----------------------------------------------------------------------------
-- Who may read them: the owner and an administrator (D27-91). The server asks
-- the same through the role gate (GET /api/hotels/:code/system-health); this is
-- the database's own answer, whatever route reaches the tables.
-- -----------------------------------------------------------------------------
create or replace function app.reads_system_health()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.is_group_admin() or exists (
    select 1 from staff_hotels sh
      join staff s on s.id = sh.staff_id
     where sh.staff_id = app.current_user_id()
       and s.is_active
       and sh.role in ('owner', 'admin')
  )
$$;

comment on function app.reads_system_health() is
  'The owner or an administrator at any hotel, or a group administrator '
  '(D27-91): who may read the server''s telemetry.';

revoke all on function app.reads_system_health() from public;
grant execute on function app.reads_system_health() to public;

alter table telemetry_requests enable row level security;
alter table telemetry_events   enable row level security;

drop policy if exists telemetry_requests_read on telemetry_requests;
create policy telemetry_requests_read on telemetry_requests
  for select using (app.reads_system_health());
drop policy if exists telemetry_events_read on telemetry_events;
create policy telemetry_events_read on telemetry_events
  for select using (app.reads_system_health());

-- Read only. Rows arrive and leave through app.record_telemetry() alone, so the
-- API can neither rewrite nor empty the record (CERT-In asks that logs be kept).
-- ⚠ 010's default privileges give pms_app all four on every new table: taking
-- them from `public` alone would leave them.
revoke all on telemetry_requests, telemetry_events from public, pms_app;
grant select on telemetry_requests, telemetry_events to pms_app;


-- -----------------------------------------------------------------------------
-- One minute (or a few) in, and anything older than 180 days out, in one call.
-- Called by the API every minute, so the 180 days are kept by the same clock
-- that fills them: no night audit or separate timer needed. A minute written
-- twice (a flush retried after a failure) adds to itself rather than failing.
-- -----------------------------------------------------------------------------
create or replace function app.record_telemetry(p_requests jsonb, p_events jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into telemetry_requests as t
         (minute, method, route, status, count, total_ms, max_ms, buckets)
  select r.minute, r.method, r.route, r.status, r.count, r.total_ms, r.max_ms, r.buckets
    from jsonb_to_recordset(coalesce(p_requests, '[]')) as r(
           minute timestamptz, method text, route text, status smallint,
           count integer, total_ms bigint, max_ms integer, buckets integer[])
  on conflict (minute, method, route, status) do update
     set count    = t.count + excluded.count,
         total_ms = t.total_ms + excluded.total_ms,
         max_ms   = greatest(t.max_ms, excluded.max_ms),
         buckets  = array(select coalesce(a, 0) + coalesce(b, 0)
                            from unnest(t.buckets, excluded.buckets) as u(a, b));

  insert into telemetry_events as t (minute, kind, place, what, count, max_ms)
  select e.minute, e.kind, e.place, e.what, e.count, e.max_ms
    from jsonb_to_recordset(coalesce(p_events, '[]')) as e(
           minute timestamptz, kind text, place text, what text,
           count integer, max_ms integer)
  on conflict (minute, kind, place, what) do update
     set count  = t.count + excluded.count,
         max_ms = greatest(t.max_ms, excluded.max_ms);

  delete from telemetry_requests where minute < now() - interval '180 days';
  delete from telemetry_events   where minute < now() - interval '180 days';
end $$;

comment on function app.record_telemetry(jsonb, jsonb) is
  'Adds a minute of request counts and events, and deletes both older than '
  '180 days (D27-92, CERT-In). The only way rows arrive or leave.';

revoke all on function app.record_telemetry(jsonb, jsonb) from public;
grant execute on function app.record_telemetry(jsonb, jsonb) to pms_app;
