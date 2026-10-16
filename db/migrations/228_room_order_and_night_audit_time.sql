-- =============================================================================
-- 228 · Rooms in number order; the night audit's opening time (the owner's
--       D27-338, 16 October)
-- =============================================================================
-- (1) A plain text sort listed Mathura's rooms 10A, 10B, 11A, 11B, 1A, 1B, 2A
--     ... (and any hotel's room 10 before room 9). `app.room_order` is ICU's
--     numeric ordering: 1A, 1B, 2A ... 9B, 10A, 10B, 11A, 11B. The lists use it
--     in their ORDER BY (`number collate app.room_order`); the column itself
--     keeps the database's own collation, so every comparison and the unique
--     index are unchanged. Deterministic: equal only when the text is equal.
--
-- (2) `hotels.night_audit_opens_at`: before this time on the hotel's own
--     clock, nobody may run the night audit for today's business date; a
--     business date already behind is never locked (the night audit's
--     blockers say so). 16:00 to begin, as the owner asked; the owner or an
--     administrator changes it in Settings.
--
-- Re-runnable.
-- =============================================================================

create collation if not exists app.room_order (provider = icu, locale = 'und-u-kn-true');
comment on collation app.room_order is
  'Room numbers in number order (D27-338): 1A, 1B, 2A ... 9B, 10A, 11B; 9 before 10.';

alter table hotels add column if not exists night_audit_opens_at time not null default '16:00';
comment on column hotels.night_audit_opens_at is
  'D27-338: the night audit for today''s business date opens at this time on the '
  'hotel''s own clock (hotels.timezone); a business date already behind is never locked.';
