-- =============================================================================
-- 105 · The All Inclusive meal plan
-- =============================================================================
-- The owner's D17-50, 17 September: add the all-inclusive meal plan now, rather
-- than refusing all-inclusive bookings until a hotel sells it (integration plan
-- D14, CRS-8). `meal_plans` is reference data every property shares (011, 020).
--
-- Its price is not set here — no default prices, ever. A hotel prices it on the
-- Pricing screen like every other plan: a difference from the base, or a typed
-- rate; until then it shows the no-figure mark.
--
-- `on conflict do nothing`: safe on every replay.
-- =============================================================================

insert into meal_plans (code, name, includes)
values ('AI', 'All Inclusive', 'Everything charged to the room')
on conflict (code) do nothing;

-- The owner's D17-68: all-inclusive covers everything charged to the room. The
-- first wording ("all meals, snacks and drinks") was the master's guess; this
-- corrects any database that ran it. Setting a text to itself is replay-safe.
update meal_plans set includes = 'Everything charged to the room'
 where code = 'AI' and includes is distinct from 'Everything charged to the room';
