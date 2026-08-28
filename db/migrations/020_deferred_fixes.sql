-- =============================================================================
-- 020_deferred_fixes.sql — three things that were written down instead of fixed
-- =============================================================================
-- Each of these was found during CP9, recorded in HANDOVER.md, and left. A note
-- in a handover is not a fix; it is a promise, and promises accumulate.
--
--   D1  a complimentary room was detectable only as agreed_rate = 0
--   D2  'Room Only' was inserted into group reference data by a DEMO LOADER
--   D3  nobody, including a group admin, could see anyone else's access
-- =============================================================================


-- -----------------------------------------------------------------------------
-- D1 — complimentary is a decision, not a price of zero.
-- -----------------------------------------------------------------------------
-- The Manager Report prints `Complimentary Room` on its own line, separately
-- from `Sold Room`, because they are different facts: a comp is a decision
-- somebody made and is reported to the owner and to tax as such. A zero-rate
-- sale is a different event that happens to cost nothing.
--
-- Until now the only way to find one was `agreed_rate = 0`. That worked while
-- exactly one booking in the demo sat at zero, and would have broken the first
-- time anyone booked a genuinely free room for another reason — silently, by
-- moving a number on a report an owner reads.
-- -----------------------------------------------------------------------------
alter table reservations
  add column if not exists is_complimentary boolean not null default false;

comment on column reservations.is_complimentary is
  'A room given away deliberately. Reported separately from Sold Room on the '
  'Manager Report. NOT the same as agreed_rate = 0 — that is a price, this is '
  'a decision, and occupancy statistics must exclude this rather than that.';

-- Backfill from the only marker that existed, so nothing that was
-- complimentary yesterday reads as sold today.
update reservations set is_complimentary = true
 where agreed_rate = 0 and not is_complimentary;

create index if not exists reservations_comp_idx
  on reservations (hotel_id, check_in)
  where is_complimentary;


-- -----------------------------------------------------------------------------
-- D2 — 'Room Only' belongs to the group, not to a demo loader.
-- -----------------------------------------------------------------------------
-- The live eZee Night Audit prints `Room Only` as its own plan name alongside
-- EP, and the Rate Plans screen already documents the two as distinct. So the
-- row is right. Where it was inserted was not: `api/scripts/load-demo.ts` is a
-- development script, and `meal_plans` is reference data every property shares.
--
-- A demo script quietly reshaping group reference data is how the group ends up
-- with a plan nobody chose.
-- -----------------------------------------------------------------------------
insert into meal_plans (code, name, includes)
values ('RO', 'Room Only', 'Room only')
on conflict (code) do nothing;


-- -----------------------------------------------------------------------------
-- D3 — an administrator could not see who had access to what.
-- -----------------------------------------------------------------------------
-- 018 added `staff_hotels_self`: a person reads their OWN access rows. Correct,
-- and it left nobody able to read anyone else's — including a group admin, who
-- holds no `staff_hotels` rows at all and therefore read ZERO.
--
-- The Users and Roles screens exist to show who may reach what. They cannot.
--
-- This adds the narrowest grant that fixes it: a GROUP ADMIN may read the
-- access rows of the properties they administer. Still read-only — granting a
-- hotel to a person belongs to pms_admin, and a clerk who could insert here
-- could grant themselves the property next door.
-- -----------------------------------------------------------------------------
drop policy if exists staff_hotels_admin on staff_hotels;
create policy staff_hotels_admin on staff_hotels
  for select
  using (
    exists (
      select 1 from staff s
       where s.id = app.current_user_id()
         and s.is_active
         and s.is_group_admin
    )
  );


-- -----------------------------------------------------------------------------
-- Assertions. Each names the defect it prevents coming back.
-- -----------------------------------------------------------------------------
do $$
declare n int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_name = 'reservations' and column_name = 'is_complimentary'
  ) then
    raise exception 'D1: reservations.is_complimentary was not created';
  end if;

  select count(*) into n from meal_plans where code = 'RO';
  if n <> 1 then
    raise exception 'D2: meal plan RO missing — it is group reference data, '
                    'not something a demo loader should be inserting';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'staff_hotels'
       and policyname = 'staff_hotels_admin'
  ) then
    raise exception 'D3: staff_hotels_admin policy was not created';
  end if;
end $$;
