-- =============================================================================
-- 110 · The SU channel manager: which figure went to SU for a night, and why
-- =============================================================================
-- D17-92 (18 September): where a meal plan has no price of its own, SU gets the
-- ROOM TYPE'S RACK RATE rather than the date being closed. The owner's reason is
-- occupancy — a closed date sells nothing at all, while the rack rate keeps the
-- room selling until somebody prices that plan. D17-81 still holds where there is
-- no price anywhere: that date goes to SU closed.
--
-- This sells a room at a figure nobody typed for that meal plan, so a night's
-- price must be answerable afterwards. `channel_ari_sent` already holds exactly
-- what SU received for the night; what it could not say is WHERE the figure came
-- from. `price_source` says it:
--
--     typed    somebody set this price for this meal plan and date
--     derived  worked out from another plan's price (the PMS's own rule)
--     rack     nothing was set for this plan, so the room type's rack rate went
--              (D17-92)
--     null     the cell carries no price: rooms left, or a date with no price
--              anywhere, which goes closed (D17-81)
--
-- And `channel_ari_pushes.rack_only` becomes `rack_dates`: the same count, but it
-- no longer means "held back". Before today a rack-rate date was kept from SU and
-- counted; from today it is sent and counted.
--
-- Re-runnable; touches no table outside the channel manager's; creates no rows.
-- Nothing is rewritten: rows written before today keep a null `price_source`,
-- because what SU was sent for them is known and where it came from is not.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Where the figure came from
-- -----------------------------------------------------------------------------
alter table channel_ari_sent add column if not exists price_source text;

alter table channel_ari_sent drop constraint if exists channel_ari_sent_price_source_known;
alter table channel_ari_sent add constraint channel_ari_sent_price_source_known
  check (price_source is null or price_source in ('typed', 'derived', 'rack'));

comment on column channel_ari_sent.price_source is
  'Where the price SU was sent for this night came from: typed (set for this meal '
  'plan and date), derived (the PMS worked it out from another plan), rack (nothing '
  'was set for the plan, so the room type''s rack rate went - D17-92). Null: the '
  'cell carries no price (rooms left, or a date closed for want of one).';


-- -----------------------------------------------------------------------------
-- The count in the push log means "sent at the rack rate", not "held back"
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'channel_ari_pushes'
       and column_name = 'rack_only'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'channel_ari_pushes'
       and column_name = 'rack_dates'
  ) then
    alter table channel_ari_pushes rename column rack_only to rack_dates;
  end if;
end $$;

comment on column channel_ari_pushes.rack_dates is
  'Dates in the window this push looked at whose price was the room type''s rack '
  'rate because the meal plan had none of its own (D17-92) - counted like '
  '`unpriced`, over the window rather than over what this push happened to carry. '
  'The owner reads it as how much is selling at a figure nobody typed for that plan.';
