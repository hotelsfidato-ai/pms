-- =============================================================================
-- 269 · How many days before its use-by a delivery is flagged (D27-383 item 11)
-- =============================================================================
-- The owner's list of 6 November (D27-383, item 11): expiry alerts on stock.
-- A delivery's use-by is already recorded (180, stock_movements.expires_on);
-- what each delivery still has on the shelf is worked out on the server, first
-- expiring first out (api/src/modules/stores/expiry.ts). This is the one figure
-- the hotel sets: how many days before the use-by the Store and the bell warn.
--
-- 7 days, decided under D27-396 (the master's recommendation; the owner
-- reviews): a setting per hotel, from 1 to 90 days. It is a period, not a
-- price, so it starts filled. An item with no use-by is never warned about.
--
-- Re-runnable.
-- =============================================================================

alter table hotels add column if not exists expiry_warn_days smallint not null default 7;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hotels_expiry_warn_days_sane') then
    alter table hotels add constraint hotels_expiry_warn_days_sane check (expiry_warn_days between 1 and 90);
  end if;
end $$;

comment on column hotels.expiry_warn_days is
  'D27-383 item 11: the Store and the bell flag a delivery this many days before its use-by '
  '(and every day after it, while some of it is still on the shelf). 1 to 90; 7 to start (D27-396).';

-- ── A test hotel copies the warning, as its other settings: patched in place, as 262 does ──
-- (264 in the main line; 269 in the helper's copy), so every column added since stays.
do $$
declare d text := pg_get_functiondef('app.test_hotel_hotels_columns()'::regprocedure);
begin
  if position('expiry_warn_days' in d) = 0 then
    execute replace(d, $q$('id', false)$q$, $q$('expiry_warn_days', true), ('id', false)$q$);
  end if;
end $$;
