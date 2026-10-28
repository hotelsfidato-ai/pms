-- =============================================================================
-- restore-hotel.sql - what deploy/restore-hotel.sh runs inside the databases
-- =============================================================================
-- Never run by hand: the script runs it, and says what it found.
--
--   -v export=1   in the BACKUP's copy: every row of one hotel, from every
--                 hotel table, and every row of every shared table something
--                 can point at (guests, companies, ...), one line each: the
--                 table, and the row as jsonb.
--   -v export=0   in the LIVE database, reading those lines on its stdin: what
--                 is missing, changed since and new since, and what could come
--                 back. The transaction is READ ONLY: the database itself
--                 refuses a write.
--     -v write=1  the second step: the same, then the missing rows go back,
--                 parents first, in ONE transaction - all of them or none.
--
-- The tables come from app.test_hotel_classes() (D27-296): every table is in
-- exactly one class, and db/tests/modules/test-hotels.sql fails on a new table
-- that is not, so a table added later is covered without touching this file.
-- =============================================================================
\set ON_ERROR_STOP 1
\pset footer off
set client_min_messages = warning;

-- The hotel's tables and how to find its rows in each: its own hotel_id, or
-- the parent it hangs off (app.copy_hotel_setup's way). Plus every shared
-- table that something points at, whole.
create temp table scope as
select c.table_name::text tbl, c.class::text class,
       case
         when c.class = 'group' then 'true'
         when exists (select 1 from pg_attribute a
                       where a.attrelid = r.oid and a.attname = 'hotel_id' and not a.attisdropped)
           then format('x.hotel_id = %L', :'hid')
         else (select format('x.%I in (select p.%I from public.%I p where p.hotel_id = %L)',
                             ca.attname, pa.attname, pr.relname, :'hid')
                 from pg_constraint k
                 join pg_class pr on pr.oid = k.confrelid
                 join pg_attribute ca on ca.attrelid = k.conrelid and ca.attnum = k.conkey[1]
                 join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = k.confkey[1]
                where k.conrelid = r.oid and k.contype = 'f'
                  and exists (select 1 from pg_attribute h where h.attrelid = pr.oid
                                 and h.attname = 'hotel_id' and not h.attisdropped)
                order by ca.attname limit 1)
       end cond
  from app.test_hotel_classes() c
  join pg_class r on r.oid = to_regclass('public.' || c.table_name)
 where c.class <> 'group'
    or exists (select 1 from pg_constraint k where k.contype = 'f' and k.confrelid = r.oid);

do $$
begin
  if exists (select 1 from scope where cond is null) then
    raise exception 'No way to find a hotel''s rows in: %',
      (select string_agg(tbl, ', ') from scope where cond is null);
  end if;
end $$;

\if :export
select format('copy (%s) to stdout',
              string_agg(format('select %L, to_jsonb(x) from public.%I x where %s', tbl, tbl, cond),
                         ' union all '))
  from scope
\gexec
\quit
\endif


-- =============================================================================
-- THE LIVE DATABASE
-- =============================================================================
-- What a row is known by: its primary key, or (a table with none) all of it.
create temp table pk as
select r.relname::text tbl,
       coalesce((select array_agg(a.attname::text order by u.i)
                   from pg_index i
                  cross join unnest(i.indkey::int2[]) with ordinality u(attnum, i)
                   join pg_attribute a on a.attrelid = i.indrelid and a.attnum = u.attnum
                  where i.indrelid = r.oid and i.indisprimary),
                (select array_agg(a.attname::text order by a.attnum) from pg_attribute a
                  where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped)) cols
  from pg_class r
 where r.relnamespace = 'public'::regnamespace and r.relkind in ('r', 'p');

-- Every foreign key, as the columns on each side, in order.
create temp table fk as
select k.oid id, ch.relname::text c, pa.relname::text p,
       array(select a.attname::text from unnest(k.conkey) with ordinality u(n, i)
               join pg_attribute a on a.attrelid = k.conrelid and a.attnum = u.n order by u.i) cc,
       array(select a.attname::text from unnest(k.confkey) with ordinality u(n, i)
               join pg_attribute a on a.attrelid = k.confrelid and a.attnum = u.n order by u.i) pc
  from pg_constraint k
  join pg_class ch on ch.oid = k.conrelid
  join pg_class pa on pa.oid = k.confrelid
 where k.contype = 'f' and ch.relnamespace = 'public'::regnamespace;

-- Append-only: the tables whose rows a trigger never lets change or go - the
-- ledger, the issued tax documents, stock and equipment movements, kitchen
-- timings. A wrong one is reversed in the PMS; a missing one is the owner's.
create temp table frozen as
select distinct c.relname::text tbl
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_proc p on p.oid = t.tgfoid
 where not t.tgisinternal
   and p.proname in ('forbid_mutation', 'reject_invoice_change', 'pos_line_events_append_only');

create temp table b (
  n     serial primary key,
  tbl   text not null,
  row   jsonb not null,
  class text,
  k     jsonb,                   -- the row's key
  live  jsonb,                   -- the live row with that key, if any
  state text,                    -- same | changed | missing | not needed
  was   text,                    -- the state before the second step wrote
  why   text,                    -- a missing row that stays missing, and why
  depth int                      -- a row coming back: after every parent
);
create temp table fresh (tbl text primary key, n bigint, was bigint);   -- new since
create temp table ref (id oid, side "char", n int, v text);
create temp table dep (child int, parent int);

\copy b (tbl, row) from pstdin
create index on b (tbl, k);

-- Every backup row against live, by key; and the hotel's live rows that the
-- backup does not have. Run again after the second step writes.
create function pg_temp.compare() returns void language plpgsql as $f$
declare
  t text; v_cols text[]; v_cond text; kb text; kx text;
begin
  update b set live = null;
  for t, v_cols, v_cond in
    select p.tbl, p.cols, s.cond from pk p left join scope s on s.tbl = p.tbl
     where s.tbl is not null or exists (select 1 from b where b.tbl = p.tbl)
  loop
    select 'jsonb_build_object(' || string_agg(format('%L, b.row -> %L', c, c), ', ') || ')',
           'jsonb_build_object(' || string_agg(format('%L, to_jsonb(x.%I)', c, c), ', ') || ')'
      into kb, kx
      from unnest(v_cols) c;
    execute format('update b set k = %s where tbl = %L', kb, t);
    execute format('update b set live = to_jsonb(x) from public.%I x where b.tbl = %L and b.k = %s',
                   t, t, kx);
    if v_cond is not null and v_cond <> 'true' then
      execute format('insert into fresh (tbl, n) select %L, count(*) from public.%I x where %s
                        and not exists (select 1 from b where b.tbl = %L and b.k = %s)
                      on conflict (tbl) do update set n = excluded.n',
                     t, t, v_cond, t, kx);
    end if;
  end loop;
  -- Changed: compared on the columns both have, so a backup from before a
  -- release (a column added since) is not "everything changed".
  update b set state = case
    when live is null then 'missing'
    when (select jsonb_object_agg(e.key, e.value) from jsonb_each(row) e where live ? e.key)
       = (select jsonb_object_agg(e.key, e.value) from jsonb_each(live) e where row ? e.key)
      then 'same'
    else 'changed' end
   where state is distinct from 'not needed';
end $f$;

\if :write
begin isolation level repeatable read;
\else
begin isolation level repeatable read read only;
\endif

do $$ begin perform pg_temp.compare(); end $$;
update b set class = c.class from app.test_hotel_classes() c where c.table_name = b.tbl;

-- What stays missing, whatever the second step says.
update b set why = case
    when not exists (select 1 from pk where pk.tbl = b.tbl)
      then 'its table is not in the live database'
    when tbl = 'hotels'
      then 'a property is never brought back by this tool'
    when tbl = 'staff'
      then 'a person (and their sign-in) is never brought back by this tool'
    when tbl in (select tbl from frozen)
      then 'append-only: a wrong record is reversed in the PMS, a missing one is yours to decide'
    when class = 'never'
      then 'kept apart (access, numbering, devices, outside systems, what was sent): yours to decide'
  end
 where state = 'missing';

-- Which missing row points at which: each foreign key's values, as one text
-- per row and side (any null: it points at nothing).
insert into ref
select fk.id, 'c', b.n, (select string_agg(b.row ->> x, chr(31) order by i)
                          from unnest(fk.cc) with ordinality u(x, i))
  from b join fk on fk.c = b.tbl
 where b.state = 'missing' and not exists (select 1 from unnest(fk.cc) x where b.row ->> x is null)
union all
select fk.id, 'p', b.n, (select string_agg(b.row ->> x, chr(31) order by i)
                          from unnest(fk.pc) with ordinality u(x, i))
  from b join fk on fk.p = b.tbl
 where b.state = 'missing';
insert into dep
select distinct c.n, p.n from ref c join ref p on p.id = c.id and p.v = c.v and p.side = 'p'
 where c.side = 'c' and c.n <> p.n;

-- A row that needs one that stays missing stays missing too.
do $$
begin
  loop
    update b set why = 'needs a row that stays missing (' || p.tbl || ')'
      from dep d, b p
     where d.child = b.n and p.n = d.parent
       and b.state = 'missing' and b.why is null and p.why is not null;
    exit when not found;
  end loop;
end $$;

-- A shared row (a guest, a company) is the hotel's business only when one of
-- its missing rows needs it; and it comes back only for one that comes back.
with recursive a(n) as (
  select n from b where state = 'missing' and class is distinct from 'group'
  union
  select d.parent from dep d join a on a.n = d.child)
update b set state = 'not needed'
 where state = 'missing' and class = 'group' and n not in (select n from a);

with recursive a(n) as (
  select n from b where state = 'missing' and class is distinct from 'group' and why is null
  union
  select d.parent from dep d join a on a.n = d.child)
update b set why = 'only rows that stay missing need it'
 where state = 'missing' and class = 'group' and why is null and n not in (select n from a);

-- Parents first: a row's step comes after every parent's (a guest before its
-- booking, a booking before its bill).
do $$
declare v_step int := 0;
begin
  loop
    update b set depth = v_step
     where state = 'missing' and why is null and depth is null
       and not exists (select 1 from dep d join b p on p.n = d.parent
                        where d.child = b.n and p.state = 'missing' and p.why is null
                          and p.depth is null);
    exit when not found;
    v_step := v_step + 1;
  end loop;
end $$;
update b set why = 'points at rows that point back at it, in a circle'
 where state = 'missing' and why is null and depth is null;


-- =============================================================================
-- WHAT IT FOUND
-- =============================================================================
\echo
\echo '  WHAT DIFFERS, this hotel''s rows (and the shared rows they need):'
select s.tbl as "table",
       case when s.class = 'group' then 'shared' else s.class end as "class",
       case when s.class = 'group' then '' else count(b.n)::text end as "in the backup",
       count(b.n) filter (where b.state = 'missing') as "missing in live",
       case when s.class = 'group' then ''
            else (count(b.n) filter (where b.state = 'changed'))::text end as "changed since",
       case when s.class = 'group' then '' else coalesce(max(f.n), 0)::text end as "new since"
  from scope s
  left join b on b.tbl = s.tbl
  left join fresh f on f.tbl = s.tbl
 group by s.tbl, s.class
having count(b.n) filter (where b.state = 'missing') > 0
    or (s.class <> 'group'
        and (count(b.n) filter (where b.state = 'changed') > 0 or coalesce(max(f.n), 0) > 0))
 order by 1;

\echo '  Changed and new rows are never touched: the live database is right about them.'
\echo
\echo '  STAYS MISSING - this tool never writes these:'
select tbl as "table", count(*) as "rows", why as "why" from b
 where state = 'missing' and why is not null
 group by tbl, why order by 1, 3;

\if :write
\else
\echo
\echo '  COULD COME BACK with the second step, in this order (parents first):'
select depth + 1 as "step", tbl as "table", count(*) as "rows",
       array_to_string((array_agg((select string_agg(value #>> '{}', '/') from jsonb_each(k))
                                   order by n))[1:3], ', ')
       || case when count(*) > 3 then ', ...' else '' end as "which"
  from b where state = 'missing' and why is null
 group by depth, tbl order by 1, 2;
\endif

select count(*) as come from b where state = 'missing' and why is null \gset
\echo
\echo '  can come back:' :come 'rows'

\if :write
-- =============================================================================
-- THE SECOND STEP
-- =============================================================================
-- Exactly what was shown, or nothing: the live database moved since the look.
select set_config('restore.expect', :'expect', false) as expect_set \gset
do $$
begin
  if (select count(*) from b where state = 'missing' and why is null)
     <> current_setting('restore.expect')::bigint then
    raise exception 'The live database changed since you looked: run the look again.';
  end if;
end $$;

update b set was = state;
update fresh set was = n;

-- Only rows missing in live, only by insert: a changed row is never written.
-- Every rule of the live database (its triggers, keys and checks) applies,
-- and any refusal undoes all of it.
do $$
declare
  r record; v_into text; v_from text; v_detail text;
begin
  for r in select distinct depth, tbl from b where state = 'missing' and why is null order by 1, 2
  loop
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum),
           string_agg('x.' || quote_ident(a.attname), ', ' order by a.attnum)
      into v_into, v_from
      from pg_attribute a
     where a.attrelid = to_regclass('public.' || quote_ident(r.tbl))
       and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
       and exists (select 1 from b where b.tbl = r.tbl and b.row ? a.attname);
    begin
      execute format('insert into public.%I (%s) overriding system value
                      select %s from b, jsonb_populate_record(null::public.%I, b.row) x
                       where b.tbl = %L and b.depth = %s and b.state = %L and b.why is null',
                     r.tbl, v_into, v_from, r.tbl, r.tbl, r.depth, 'missing');
    exception when others then
      get stacked diagnostics v_detail = pg_exception_detail;
      raise exception 'Bringing back % (step %) was refused: %', r.tbl, r.depth + 1, sqlerrm
        using detail = coalesce(v_detail, ''),
              hint = 'Nothing was brought back: it is all of it or none.';
    end;
  end loop;
end $$;

do $$ begin perform pg_temp.compare(); end $$;

\echo
\echo '  BROUGHT BACK:'
select tbl as "table",
       count(*) filter (where state = 'same') as "as in the backup",
       count(*) filter (where state <> 'same') as "changed on the way in by the database's own rules"
  from b where was = 'missing' and why is null
 group by tbl order by 1;

\echo '  ALSO DONE BY THE DATABASE''S OWN RULES while they went in:'
select coalesce(c.tbl, f.tbl) as "table",
       coalesce(c.n, 0) as "rows changed", coalesce(f.n - f.was, 0) as "rows added"
  from (select tbl, count(*) n from b where was = 'same' and state = 'changed' group by tbl) c
  full join (select * from fresh where n <> was) f on f.tbl = c.tbl
 order by 1;

commit;
\echo '  committed.'
\else
rollback;
\endif
