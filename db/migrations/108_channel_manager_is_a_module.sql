-- =============================================================================
-- 108 · The channel manager is a module a property is switched on for
-- =============================================================================
-- D17-66: the owner chose SU and the connection is being built. Nothing may
-- reach a live booking site by accident, so every part of it asks
-- `app.module_enabled(hotel, 'channel_manager')` first — and until this
-- migration that module name could not exist, because `hotel_modules_known`
-- (041, widened by 087) refused it.
--
-- OFF EVERYWHERE, and no row is written here. `app.module_enabled` reads an
-- absent row as off for anything but `pos`, so every property — including
-- every property made later — stays off until the owner or an administrator
-- turns it on, on the Settings screen (D17-36: the switches are theirs).
--
-- Replayed on every deploy, like every file here: the constraint is dropped
-- if it is there and put back, which is what 087 does and is safe to repeat.
-- =============================================================================

alter table hotel_modules drop constraint if exists hotel_modules_known;
alter table hotel_modules add constraint hotel_modules_known
  check (module in ('pos', 'banquet', 'reception_pos', 'channel_manager'));
