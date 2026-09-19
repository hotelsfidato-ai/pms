-- =============================================================================
-- 120 · The link a departing guest is asked to leave a review on
-- =============================================================================
-- ⚠ THE NUMBER IS PROVISIONAL. 117, 118 and 119 are taken on the cp6 this copy
-- was cut from, so 120 is the next free one this chat can see. The master
-- settles it at merge, in merge order - a number cannot be booked ahead,
-- because `src/test/migrationNumbers.test.ts` refuses a gap as well as a
-- duplicate (MEMORY 301, 302).
--
-- The owner's D18-14: after check-out, a message asking for a review, with the
-- group's own review link.
--
-- ⚠ THE OWNER HAS NOT GIVEN THE LINK YET, and this file is written so that the
-- system cannot pretend otherwise. There is no default, no placeholder, no
-- example Google address, and no column that quietly holds ''. A property that
-- has no link has NO ROW here, the screen shows a dash, and the route that
-- sends refuses by name. It is the no-default-prices rule applied to a
-- sentence instead of a figure: a thing nobody has set is a dash, not a guess,
-- and a review request carrying an invented link is worse than one never sent.
--
-- ONE ROW PER PROPERTY, not one for the group. The brief asks for a setting
-- per property; seven properties may hold the same link, and that is a thing
-- somebody types seven times rather than a thing this file decides for them.
--
-- THIS MIGRATION REPLAYS FROM 001 ON EVERY DEPLOY, like every other. It
-- creates its own table and its own constraints and rewrites nothing any other
-- file defines, so there is no constraint here for an earlier migration to put
-- back over it (MEMORY 284, 293, 299).
-- =============================================================================

create table if not exists review_links (
  hotel_id uuid primary key references hotels(id) on delete cascade,

  -- NOT NULL, and the absence of the row is the empty state. A nullable column
  -- would have given the same fact two spellings - NULL and '' - and something
  -- would eventually have tested only one of them.
  url      text not null,

  -- This address is put in front of a guest, so it is checked where it is
  -- stored and not only where it is typed. http:// is refused with everything
  -- else: a link the hotel sends out is one the hotel vouches for.
  constraint review_links_is_an_https_link
    check (url ~ '^https://[^[:space:]]{3,}$'),

  set_at   timestamptz not null default now(),
  set_by   uuid references staff(id)
);

comment on table review_links is
  'The review link a departing guest is sent, one row per property. NO ROW '
  'MEANS NO LINK: nothing is sent from a property that has not got one, and '
  'there is no default, no placeholder and no example address anywhere. The '
  'owner had not given the group''s link when this was written (D18-14).';

comment on column review_links.set_at is
  'Absolute, like every other stored moment. Read back through '
  'app.hotel_clock so it reads in the property''s own time (113).';

-- -----------------------------------------------------------------------------
-- Row level security: a property's link is its own
-- -----------------------------------------------------------------------------
-- The same shape as `messages_sent` beside it (117). No definer function here:
-- unlike a send, which the system does for itself with no staff session behind
-- it, typing a link in is always a person doing it while signed in.
alter table review_links enable row level security;
alter table review_links force  row level security;

drop policy if exists review_links_by_hotel on review_links;
create policy review_links_by_hotel on review_links
  for all
  using      ( hotel_id in (select app.auth_hotel_ids()) )
  with check ( hotel_id in (select app.auth_hotel_ids()) );

-- `delete` is granted on purpose: a link typed wrong has to be removable back
-- to nothing, and nothing is exactly the state that refuses to send.
grant select, insert, update, delete on review_links to pms_app;
