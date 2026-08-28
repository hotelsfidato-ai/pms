-- =============================================================================
-- harness.sql — the regression net
-- =============================================================================
-- THIS FILE EXISTS TO STOP ME BREAKING WORKING CODE.
--
-- Every guard that currently passes is recorded here as an assertion. Any
-- change to the schema runs the whole suite before and after. A guard that
-- passed yesterday and fails today is a regression, and the run exits non-zero
-- so it cannot be ignored.
--
-- The rule this enforces:
--   NEVER change a migration without running this suite first, to establish
--   the baseline, and again afterwards. "It still looks right" is not the
--   same fact as "the 30 things that worked still work."
-- =============================================================================

create schema if not exists test;

drop table if exists test.results;
create table test.results (
  id       serial primary key,
  suite    text not null,
  name     text not null,
  passed   boolean not null,
  detail   text,
  ran_at   timestamptz not null default now()
);


-- -----------------------------------------------------------------------------
-- test.ok() — assert a condition
-- -----------------------------------------------------------------------------
create or replace function test.ok(p_suite text, p_name text, p_cond boolean,
                                   p_detail text default null)
returns void language plpgsql as $$
begin
  insert into test.results (suite, name, passed, detail)
  values (p_suite, p_name, coalesce(p_cond, false), p_detail);
end $$;


-- -----------------------------------------------------------------------------
-- test.raises() — assert a statement FAILS
-- -----------------------------------------------------------------------------
-- Most guards in this schema are refusals, so this is the workhorse. Pass an
-- SQLSTATE to require a specific failure rather than any failure — otherwise a
-- typo in the test would "pass" by raising a syntax error.
-- -----------------------------------------------------------------------------
create or replace function test.raises(p_suite text, p_name text, p_sql text,
                                       p_sqlstate text default null)
returns void language plpgsql as $$
declare v_state text; v_msg text;
begin
  begin
    execute p_sql;
    insert into test.results (suite, name, passed, detail)
    values (p_suite, p_name, false, 'expected a failure, statement succeeded');
    return;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
  end;

  if p_sqlstate is not null and v_state <> p_sqlstate then
    insert into test.results (suite, name, passed, detail)
    values (p_suite, p_name, false,
            format('raised %s (%s), expected %s', v_state, left(v_msg,60), p_sqlstate));
  else
    insert into test.results (suite, name, passed, detail)
    values (p_suite, p_name, true, format('%s: %s', v_state, left(v_msg, 70)));
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- test.allows() — assert a statement SUCCEEDS
-- -----------------------------------------------------------------------------
create or replace function test.allows(p_suite text, p_name text, p_sql text)
returns void language plpgsql as $$
declare v_msg text;
begin
  begin
    execute p_sql;
    insert into test.results (suite, name, passed, detail)
    values (p_suite, p_name, true, null);
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into test.results (suite, name, passed, detail)
    values (p_suite, p_name, false, left(v_msg, 90));
  end;
end $$;


-- -----------------------------------------------------------------------------
-- test.report() — summary, and the exit signal
-- -----------------------------------------------------------------------------
create or replace function test.report()
returns table (suite text, passed bigint, failed bigint)
language sql as $$
  select r.suite, count(*) filter (where r.passed), count(*) filter (where not r.passed)
    from test.results r group by r.suite order by r.suite
$$;

create or replace function test.failures()
returns table (suite text, name text, detail text)
language sql as $$
  select r.suite, r.name, r.detail from test.results r where not r.passed order by r.id
$$;

-- Raises if anything failed, so the runner exits non-zero under ON_ERROR_STOP.
create or replace function test.assert_all_passed()
returns void language plpgsql as $$
declare n int;
begin
  select count(*) into n from test.results where not passed;
  if n > 0 then
    raise exception 'REGRESSION: % assertion(s) failed', n;
  end if;
end $$;
