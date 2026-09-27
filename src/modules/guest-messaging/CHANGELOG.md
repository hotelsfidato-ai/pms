# Changelog — guest messages

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`.

---

## 2026-09-27 · Touched by Phase 1, New booking (reservations session)

`POST /:code/stays/:id/confirmation` (`voucher.ts`): Send voucher from New booking's Booked card, the sweep's own confirmation now, with the clerk's name. `claimTurn` / `sendIfOwed` in `jobs.ts`: the sweep's sender takes the same per-booking turn and asks again, so a voucher never goes twice (D27-35). `getGuestMessages` on the web front door.
See `src/modules/reservations/CHANGELOG.md`, 27 September.

---

## 2026-09-24 · a group's lead, decided once (D22-52, D22-53)

**Asked for:** the owner's D22-52 - a group's lead guest is, by default, the
room booked first that still stands, and the desk can assign another; the
group's one confirmation (D22-41) goes to the lead - and D22-53: on a group's
other rooms, the desk's Guest messages shows the group's messages. (First
numbered D22-47..49 by mistake; D22-54, the "Rooms" template line, is not
part of this.) Started by a helper on `guest-messaging/group-lead` (stopped
mid-task, 23 September), finished on `front-desk/finish-24sep`.

**Shipped**
- Migration **131** (`131_a_groups_lead.sql`; the master settles the number):
  `reservation_groups.lead_reservation_id` (the desk's choice, NULL for the
  default) and **`app.group_lead(group)`**, the one answer - the assigned
  room if it still stands, else the room booked first that still stands;
  definer, granted to `pms_app` only. `app.guest_messages_due` asks it: same
  signature and return type, only its `lead` step changed (checked line by
  line against 126).
- **No foreign key on the new column** (changed 24 September): bookings point
  at their group, and a key back made a loop the property reset cannot order
  - `resetOrder.test.ts` failed in the first full API run. `app.group_lead`
  ignores a lead that is not a standing room of the group, so the key added
  nothing.
- The desk assigns the lead on the group's screen (reservations' route and
  panel, `reservations/CHANGELOG.md`).
- **D22-53 was already built** (22 September, `partyOf`): asked about any
  room of a group, Guest messages shows the group's messages. Shown on
  screen: asked about room 302 of the demo's Pancham Hall function, it lists
  the confirmation that went to its lead, 303.
- **Guest messages is in reception's menu** (the owner, 24 September), where a
  guest's message to the front desk waits (D23-14,
  `online-checkin/CHANGELOG.md`).

**Proved** - `db/tests/modules/guest-messaging.sql`, `app.group_lead` called
directly (MEMORY 318): the default, the assigned lead, its confirmation going
to that lead's guest, an assigned lead that stops standing giving way, a room
of another group ignored, no group no lead, and who may execute it
(guest-messaging 54 assertions, 0 failed, in the full database run). The API
half is in `reputation/CHANGELOG.md`. On screen:
`.local/screenshots/2026-09-24-front-desk/05-group-lead-*`,
`06-group-messages-on-another-room-*` (the message row there was written
into `fidato_s2` for the picture - nothing can send here).

**Left open** - D22-54 (a "Rooms" line in the group's confirmation) waits on
the next WhatsApp template edit, as decided.

**Commits:** `8e3c1e2` (the helper's), merged in `891790f`; numbered 131 in
`1ce2d3f`; the foreign key dropped in `3cb7c36`; the menu entry `252658c`.

---

## 2026-09-22 (later) · one message per group, and the catch-up hours

**Asked for:** by the master, after the owner answered D22-39 to D22-42: keep
the 10:00 reminder (D22-39) and the one-message rule for a booking made the day
before (D22-40), as built; build **one confirmation and one reminder per group,
to the lead guest** (D22-41), and **catch-up confirmations - for bookings made
before sending was switched on - only between 09:00 and 21:00 hotel time**, new
bookings at once, any hour (D22-42), with "made before switch-on" defined so it
cannot drift. On top of `a9625cf`, without merging cp6 again.

**Shipped** (migration "what the guest is owed" changed in place - it is not
merged anywhere yet - and still re-runnable)
- **One per group (D22-41).** `app.guest_messages_due` treats the rooms of a
  group as one party (`coalesce(group_id, id)`, the key `app.guest_visits`
  already uses). The party is owed one confirmation and one reminder, about its
  **lead booking** - the group's room booked first that still stands - to that
  booking's guest by that booking's tick. `reservation_groups` names no lead
  guest; every room of a booking made together carries the one guest who made
  it (`reservations/book.ts`), so the first room is theirs. A message sent about
  any room counts for the whole group, and so do failed attempts; the other
  rooms are never owed on their own, not even when the lead is cancelled after
  the message went. A booking in no group is its own party, unchanged.
- **The desk sees it as covered.** `?reservation=<a room of a group>` shows the
  group's messages, and the MSG-3 list names a group once, by its lead.
- **The catch-up hours (D22-42).** A confirmation owed to a booking made before
  switch-on comes back `held` outside `CATCH_UP_FROM` 09:00 to `CATCH_UP_UNTIL`
  21:00 on the property's clock. Still owed - the MSG-3 list does not change
  with the hour - and the sweep leaves it without taking a place in the pace
  (`waiting` in the sweep's result).
- **"Made before switch-on", exactly.** New table `guest_messaging_began`, one
  row by construction, written only by `app.guest_messages_begin()`, which
  inserts `now()` on the sweep's FIRST switched-on pass (`owedNow`) and never
  updates; the API's role has no privilege on the table at all. A booking is a
  catch-up when `created_at` is before that moment, or when none is recorded.
  The desk's screen reads without recording.
- `app.guest_messages_due` gained two parameters and a `held` column. It is
  dropped by both signatures it has had and made again each run (MEMORY 317 -
  the function is this migration's own).

**Found** - nothing that shipped. Two test-writing slips caught at once: an
uncorrelated `count(*)` beside a function call in one expression can be planned
to run BEFORE the call (so it counted the row the call had not written yet); and
a refused insert that is not undone stops every assertion after it (MEMORY
289). Both written the safe way round in the database file.

**Proved** - in this copy, on `a9625cf` plus this work, 22 September:

```
npx tsc -b --force                           exit 0
api  npx tsc --noEmit -p .                   exit 0
npx vitest run src/modules/guest-messaging   1 file, 12 tests passed, exit 0
api  npm test -- guest                       7 files, 121 tests passed, exit 0
bash db/tests/run.sh                         all 1012 assertions passed (47 guest-messaging), exit 0
bash db/tests/rerun.sh                       all 125 migrations re-runnable, exit 0
```

**Guards seen to fail, with the change taken out** - every new test:
- database (20 new assertions, 47 in the file): 10 new breaks - every room its
  own party, the lead by the latest room, a cancelled room able to lead, a
  message counting only for its own room, never held, every booking a
  catch-up, no record meaning nothing is a catch-up, `begin` moving the moment,
  the API role able to write the record, more than one row allowed - each failed
  the assertions that name it. The 20 earlier breaks, re-pointed at the
  rewritten function, all still fail theirs.
- API: 8 breaks - a held confirmation sent anyway, a held confirmation taking a
  place in the pace, the catch-up hours wrong, the sweep not recording the
  moment, the moment recorded when not switched on, the desk screen recording
  it, a room asked about without its group, and the database with no groups.
- A power cut stopped the first run of these; the source files were checked
  against their backups (identical) and the runs repeated.

**Not opened in a browser** - the master's rule for this job. Nothing on the
screen changed shape; the route's answers are proved by the API tests.

**Left open**
- To the owner, in `MODULE.md`: the pace (D21-34); the new list's words;
  whether a group's confirmation should say how many rooms; who the "lead
  guest" is (built: the room booked first that still stands); and what the desk
  sees for a group's other rooms (built: the group's messages).
- At merge: as before - the two `server.ts` lines, the number, `linkFor`,
  `app.guest_link_expires` in `guestDoor.ts`, the third stage-3 setting.

**Commits:** see the branch `guest-messaging/phase-1`.

---

## 2026-09-22 · phase 1 finished: what the guest is owed, and their booking's own link

**Asked for:** by the master, 22 September - finish phase 1 now the owner has
answered: D21-33 (every future booking gets the confirmation), D21-34 (soonest
arrival first, at the owner's pace), D21-35 and D21-72 (WhatsApp only to a
booking ticked "guest agreed to WhatsApp", else email, else nothing), D21-73
(English only). The migration the sweep was waiting on, the two functions behind
it, and MSG-3 if small. Sending stays off (D21-76); `server.ts` is the master's.

**Shipped**
- **Migration "what the guest is owed"** (written as 125; the master renumbers).
  `app.guest_messages_due(within_hours, most_attempts, remind_from, hotel)` -
  which confirmed bookings are owed their confirmation or their day-before
  reminder, soonest arrival first; `app.guest_booking_link_issue(reservation,
  token_hash)` - one CONFIRMED booking's own page, from the hash of a token the
  API made (named for a booking, beside 121's room cards); and
  `app.guest_link_expires(hotel, check_out)`, the link's expiry rule. The two
  are SECURITY DEFINER, `revoke all from public`, granted to `pms_app`. No table.
- **The sweep, finished and not started** - `jobs.ts`: `dueFromDatabase`,
  `linkFromDatabase`, `runOnce` and `jobs.start()` / `.stop()`, the channel
  manager's shape. `channelFor` takes the tick (D21-72); `CONFIRM_WITHIN_HOURS`
  is null (D21-33); the pace is the server setting `GUEST_MESSAGES_PER_MINUTE`
  and **nothing is sent until it is given** (D21-34: nobody guesses it).
- **MSG-3** - the screen lists the bookings no message can reach, and why, from
  the sweep's own answer and the sweep's own `channelFor`.

**Found** (in `DEFECTS.md`)
- **MSG-5 · one transaction for the whole sweep would send every message
  twice** - found by reading before it ran; proved with a real Postgres error.
- Found while designing, and built the safe way round: a booking nobody can
  reach is owed for ever, so counted against the pace it would starve everyone
  else (the pace now counts only reachable bookings); and "the day before
  arrival" with no hour is one minute past midnight (`REMIND_FROM`, asked).

**Proved** - in this copy, 22 September, on the branch merged up to cp6 `fde1e82`:

```
npx tsc -b --force                     exit 0
api  npx tsc --noEmit -p .             exit 0
npx vitest run src/modules/guest-messaging   1 file, 12 tests passed, exit 0
npx vitest run src/test                2 files, 5 tests passed, exit 0
api  npm test -- guest                 7 files, 114 tests passed, exit 0
bash db/tests/run.sh                   all 992 assertions passed (27 guest-messaging), exit 0
bash db/tests/rerun.sh                 all 125 migrations re-runnable, exit 0
```

**Guards seen to fail, with the change taken out** - every new test:
- the database file (27 assertions): 20 breaks of the migration, one clause
  each - no window, a tentative booking, a past stay, failures never stopping,
  a sent confirmation or reminder owed again, no gap after the confirmation, a
  reminder while the confirmation is owed, no hour, every property answered,
  latest arrival first, no definer, any string as a hash, a link for any
  booking, the wrong expiry, no floor of a day, the read-only role granted,
  pms_app not granted, D21-33 undone to 48 hours, the tick answered true - each
  failed the assertion that names it.
- the API (37 tests in the lane): 13 breaks - no pace needed, D21-33 undone,
  D21-72 undone (4 tests, two of them MSG-3's), no pace applied, the pace
  counted before the unreachable are set aside, a second timer, one
  transaction for the pass, the wrong hash, a refused link not noticed, and
  MSG-3's list emptied, its reasons swapped, not narrowed, and gated on sending.
- the web (12 tests): the MSG-3 card removed, and drawn when empty.

**Not opened in a browser** - the master's rule for this job: no servers on
8787 or 5173 and no browser pane. The new card is proved by the web tests only.

**Left open**
- **At merge (the master):** the two `server.ts` lines, the number, exporting
  `linkFor`, `guestDoor.ts` calling `app.guest_link_expires`, and a third stage-3
  setting - all in `MODULE.md`, Requests.
- **To the owner**, six questions with recommendations in `MODULE.md`: the pace,
  the reminder's hour, one message or two for a booking made the day before,
  several rooms for one guest, switch-on night, and the list's words.
- **MSG-4** - the date formatted twice, unchanged.

**Commits:** see the branch `guest-messaging/phase-1`.

---

## 2026-09-19 · the record of what was sent, and the deciding behind the two messages

**Asked for:** the owner's D18-11 and D18-12, through `docs/BUILD-PLAN-2026-09-18.md`
§ 4 and `docs/briefs/guest-messaging.md`: the booking confirmation with the
check-in link when a booking is confirmed from anywhere, the same link again the
day before arrival, a screen showing what was sent against each booking, and -
where nothing can send yet - screens that say so plainly rather than looking
broken.

**Shipped**
- **The screen** - `/h/:code/guest-messages`, and `?reservation=<id>` for one
  booking. Read only: no button on it sends anything in any state, and a test
  walks every button to say so. `src/modules/guest-messaging/pages/GuestMessages.tsx`,
  `data/guestMessages.ts`.
- **Its menu entry left Coming soon** for "Bookings", on the existing
  `reservation` resource - **no new section and no new resource**, because
  `reservation` is already exactly who may see a guest's name, number and
  address, so nobody gains a screen. `nav.ts`, `routes.tsx`; the Coming soon
  page is deleted.
- **The route** - `GET /api/hotels/:code/guest-messages`, in
  `api/src/modules/guest-messaging/messages.ts`, mounted through this service's
  own front door. It **reads `messages_sent` and never writes it** - the sender
  records its own attempt - and it answers `connected` from `canSend()` at the
  moment the screen is drawn, so the owner finishing their n8n steps changes the
  screen without a deploy.
- **The deciding** - `api/src/modules/guest-messaging/jobs.ts`: which bookings
  are owed a confirmation or a reminder, which way each goes, and when to stop.
  Everything leaves through `api/src/sending.ts` and nothing else.
- **`src/components/app/navigation.test.ts`** - one word: "Guest messages"
  removed from `SOON`. **Outside this lane**, the same edit the purchasing chat
  made when its service landed, and flagged for the master.

**Found** (both in `DEFECTS.md`, MSG-1 and MSG-2)
- **MSG-1 · a guard beside a cast is not a guard.** `about_id` is text and is
  not always a booking, so the lateral guarded the uuid cast with a regex
  written before it. It passed - then the row count changed and the same query
  answered **500** on a purchase order, because **Postgres does not promise to
  evaluate a `where` in the order it is written**. The regex was wrong too:
  `[0-9a-fA-F-]{36}` accepts `'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa-'`, which the
  cast still refuses. Fixed with `case` (whose arms only evaluate when their
  condition holds) and the uuid's real shape.
- **MSG-2 · "The system" for a message a person sent.** Found by **opening the
  screen as housekeeping**, not by a test. The sender's name comes through a
  join to `staff`, which is row-secured, so a reader who may not see a colleague
  got null - and null read as "nobody sent it". Fixed: the route also answers
  `byAPerson` off a column the reader can already see, so the screen says the
  name, or "A member of staff", or "The system" - three answers where there
  were two.

**Proved** - every gate run in this copy, 19 September, quoted as seen. There is
no Action and no Linux run (the owner's rule, 19 September), so this is the whole
of the proof.

```
npx tsc -b --force                   exit 0
api  npm run typecheck               exit 0
api  npm run strip-check             134 files load under --experimental-strip-types
npx vitest run                       46 files, 411 tests passed, exit 0
api  npm test                        73 files, 1149 tests passed, exit 0  (422.54s)
bash db/tests/run.sh                 all 938 assertions passed, exit 0
npm run build                        exit 0 - "no test sign-in in dist (6 files checked)"
```

**Guards seen to fail, with the fault put back**
- the role check, refusing everybody → `['owner', 403]` where 200 was expected
- `VIEW_ROLES` widened by one role (`chef`) → the matrix-copy test named the
  drift, and the door test let the chef in: `['chef', 200]` where 403 was expected
- the old `where`-guarded uuid cast → **both** non-booking tests answered 500,
  with `invalid input syntax for type uuid: "PO/2026/00017"` in the log - which
  is also how MSG-1 was found
- the `channelFor` check moved below the link minting → a link was minted for a
  booking with nowhere to send it
- the two empties collapsed into one wording → the screen stopped saying which
  empty it was, in two tests
- "Sent by" back to `sentBy ?? "The system"` → a person's message read as the
  system's

**Not broken, and said plainly rather than claimed:** the `canSend()` guard in
`runOnce` could not be removed - the harness refuses an edit that deletes a
check of it. It is pinned from both sides instead, which is the stronger form
MEMORY 304 asks for: one test proves the sweep does not even ASK which bookings
are due while nothing is connected, and the tests that send all fail unless
`connected()` has run first. A test that passed in both states would be the
fault 304 records.

**The screen was opened**, at 1025px and at 375px, signed in as Reception,
Owner and Housekeeping: the not-connected notice, the two empties, the populated
table, the `?reservation=` filter, the card list on a phone, and no console
errors. MSG-2 was found doing it.

**Left open**
- **The sweep does not run.** It has no staff session, and `reservations` and
  `guest_links` are both FORCE row-secured on `app.auth_hotel_ids()`, so it can
  neither read which bookings are due nor mint the guest's link. Both need a
  SECURITY DEFINER function, exactly as `messages_sent` needed
  `app.record_message_sent` in 117. **Waiting on a migration number from the
  master**, with `app.guest_link_issue` offered to the master instead, since it
  belongs to migration 114's family. `listDue` and `makeLink` are parameters of
  `runOnce` until then, and there is deliberately **no `jobs.start()`**: a timer
  over an empty list is machinery pretending to work.
- **One line in `server.ts`** at merge, once there is a sweep to start.
- **Two answers from the owner**, each recommended in `MODULE.md`: whether
  bookings made before sending was switched on get a confirmation
  (recommended: no, 48 hours), and which way the two messages go (recommended:
  WhatsApp where there is a number, email where there is only an address).
- **MSG-3** - a booking with no number and no address leaves no trace on the
  screen, because nothing is recorded where nothing was attempted. Phase 2.
- **MSG-4** - the date is formatted here and in the reports service; ask for the
  door rather than copy it a third time.

**Commits:** see the branch `guest-messaging/phase-1`.

---

## 2026-09-16 · its Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
Coming soon page for every service the system does not have, one section
for the owner, admins and general managers.

**Shipped:** `nav.ts` (one entry in the Coming soon section), `routes.tsx`
(`/coming-soon/guest-messaging`, guarded), `pages/GuestMessaging.tsx` (the shared Coming soon page
with this service's words); `index.ts` and `MODULE.md` say so. No server
code.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16.

**Left open:** everything the page lists under "What it needs before it can
be built".
