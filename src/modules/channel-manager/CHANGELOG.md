# Changelog — channel manager

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **Since 17 September the SU connection is being built (D17-66);
nothing is sent to SU or any booking site until the owner has SU's test keys.**

---

## 2026-09-18 · SU connection, part 4: the bookings SU pushes

**Asked for:** part 4 of D17-66, to the owner's D17-79 (SU pushes each booking
the moment it happens, to one address on this server) and the design the master
approved on 17 September.

**Shipped**
- **109 the inbox:** `channel_bookings` - one row per message SU pushes, whole,
  keyed unique on (hotel, SU booking id, notification id) because SU resends
  every ten minutes for an hour until it is told the message arrived. Row
  security per hotel, forced; insert and update for the application, never
  delete; audited. And `app.channel_hotel_for`, which answers which hotel an SU
  hotel id is - and only a hotel on SU and switched on for the channel manager.
- **The door** (`POST /api/channel/su/reservations`, not mounted yet): SU's key
  compared as a hash in constant time, a wrong one refused with 401 and no
  detail, no key on the server at all and the door is shut; a flood refused;
  **the card fields cut out before anything else touches the message**; the
  message stored; SU told we have it; then, and only then, worked out.
- **What becomes of a booking** (`inbound/handle.ts`): no room of that type free
  means **no booking is made** (D17-80), those dates go straight back to SU as 0
  rooms left, and it is listed for the GM; a room free means it waits for
  reservations' machine door, which is the master's to build; an unmapped room,
  a modified or cancelled booking, or anything missing waits for a person.
  Nothing is guessed, and no half-booking is written.
- **The screen:** *Bookings from the booking sites* - each one with the guest,
  the site, the nights, the money, what became of it and why, whether SU has
  been told, whether card details were dropped, and *I have dealt with this*.

**Found**
- **CM-4, the master's to fix, and it stops a deploy:** switching a hotel on for
  the channel manager makes the next deploy roll back. 087 re-adds
  `hotel_modules_known` with its old list on every replay, before 108 widens it,
  and Postgres checks the old list against the rows there. Seen by switching 5EL
  on in this copy and running `db/migrate.sh`: 087 raised 23514 and the whole run
  rolled back; the row deleted, 109 migrations applied clean. Reported to the
  master with the fix they used after MEMORY 284 and the gate that would have
  caught it (`rerun.sh` switching a module on between passes). Not in production:
  nothing is switched on anywhere yet.
- SU's own documents do not say what this server should answer SU with; it
  answers `{"Status":"Success"}` once the message is stored, which is SU's own
  shape and is true at that moment.

**Proved** - in `D:\fidato-channel-manager`, on this commit's tree
- `api: npm test`: 990 passed, 59 files, exit 0 (9 new). **Broken on purpose,
  seen to fail, restored:** the card scrub, the key check, the "no room free"
  check, answering a repeat with the first answer, and the switched-on condition
  in `app.channel_hotel_for` - five red tests, one per guard.
- `api: npm run strip-check`: 113 files load. `npx tsc -b --force`: clean.
- `bash db/tests/run.sh`: 814 assertions, su mapping 27. `rerun.sh`: re-runnable.
- Opened as the owner at `/h/5EL/channels` on this copy's servers: the new card
  with a refused booking, its reason, "card details were not kept", and *I have
  dealt with this* marking it dealt with and taking the button away.
- The door itself is not reachable on a running server yet: it is exported and
  unmounted until the master adds `["/api/channel", inbound]`, so its proof is
  its tests, which call the router directly.

**Left open**
- The master: mounting `/api/channel`, the nginx limit, CM-4, and reservations'
  `createChannelBooking` / `amendChannelBooking` / `cancelChannelBooking`
  (MODULE.md requests 6 and 7). Until the door exists, a pushed booking that
  could be made waits on the screen saying so.
- The owner: SU's keys, the push key, and P3-b (may a rack price go to SU).

---

## 2026-09-17 · SU connection, part 3: rooms left, prices and closures

**Asked for:** part 3 of D17-66 - push availability, prices and restrictions
whenever they change and on demand - and the owner's answers that came back
through the master while it was being built (D17-79 to D17-85).

**Shipped**
- **108 what SU was last sent:** `channel_ari_sent` (one row per room type, or
  room type and meal plan, per date, holding exactly what SU received, written
  only after SU accepted it), `channel_ari_pushes` (every push and what SU said),
  `channel_hotels.run_as` (the service account a hotel's minute job runs as) and
  `app.channel_manager_due()`, the one security-definer function that answers
  which hotels are due before anybody has a session.
- **A push:** a year from the hotel's business date or today where the hotel is,
  whichever is later; rooms left once per room type with no rate; price and
  restrictions per room type and meal plan; runs of identical days as one range;
  requests cut at 1,000 entries. Prices for one guest up to what the room sleeps.
  `all` sends the year, `changes` only what differs from what SU accepted last.
- **Two routes** (`GET/POST .../channel-manager/availability`) and a **job**
  exported from the front door as `jobs` for `server.ts` to start after listen:
  every minute, a `changes` push for each due hotel, as its service account,
  never overlapping itself.
- **The owner's answers, built in:** an unpriced date goes to SU **closed**
  (D17-81, and nothing is "opened" by sending `closed: 0` for a date with no
  price); the setup is the **owner's and an administrator's** (D17-85) - two
  lists, server and screen, held together by a test; the phone is **formatted**
  (spaces and hyphens out) when it is sent, never in the hotel record.
- The screen's **Rooms left, prices and closures** card: *Send a year*, *Send
  what changed*, and the last ten pushes with what SU said.

**Found**
- **CM-3, mine, serious:** part 1 shipped two classes using constructor parameter
  properties. The server strips types and emits nothing, so it could not have
  loaded them: the next deploy would have failed to start. `tsc` and the tests
  were green; `cd api && npm run strip-check`, which I had never run, was red.
  Fixed here (fields written out), and the gate is now in this service's list.
  The master fixed the same two constructors on cp6 the same evening.
- **A year of prices took 11 seconds** as `pms_app`: `app.tariff_for` per date
  and per guest count asks for the price and the extra-person figures again each
  time, each under row security. Reading the price and the extra figures once a
  date and working the guest counts out in the same query: 2.8 seconds.
  ⚠ That is a second copy of `tariff_for`'s arithmetic, held to the first by a
  test that compares them date by date and guest by guest. A set-based tariff in
  inventory would end the copy; asked of the master.
- **Breakfast at the room-only price.** With no dated price for a meal plan, the
  PMS falls back to the room type's rack rate, which is the same figure for room
  only and for breakfast. Sending it would have sold breakfast free. Nothing with
  source `rack` is sent, pending the owner's answer (P3-b).
- A **typed price of zero** is not sent either: on a booking site it sells the
  room for nothing.
- **`maximumstay` has no documented "none"** in SU's papers, so a maximum the PMS
  clears is not guessed at; recorded as a question for SU.

**Proved** - in `D:\fidato-channel-manager`, on this commit's tree
- `api: npm test`: 950 passed, 56 files, exit 0 (12 new: 8 for the push, 4 for
  the job). **Broken on purpose, seen to fail, restored:** the unpriced rule, the
  zero-price rule, recording a refused push as sent, sending the rack fallback,
  the per-guest arithmetic, and the "switched on" condition in
  `app.channel_manager_due()` - six red tests, one per guard.
- `api: npm run strip-check`: 97 files load. `npx tsc -b --force`: clean.
- `bash db/tests/run.sh`: 808 assertions, su mapping 21. `rerun.sh`: all 107
  migrations re-runnable.
- Opened as the owner at `/h/5EL/channels`: the new card, both buttons disabled
  with the reason ("Send the hotel, its room types and its meal plans to SU
  first"), no console error after a reload.

**Left open**
- Part 4: SU pushes bookings (D17-79). The door's design goes to the master
  first. Nothing of part 4 is built.
- P3-b (the rack price) with the owner; the reservations change for a price per
  night (D17-82); `integration` widened to an administrator in the grant matrix.
- The job does nothing until the master's switch exists and a hotel has a service
  account in `run_as`.

---

## 2026-09-17 · SU connection, part 2: the hotel, its room types and rate plans

**Asked for:** part 2 of D17-66, in order after the login: the property, its room
types and its rate plans sent to SU from the PMS, with a mapping table per hotel.
The master's answers to part 1 (17 September): migration **107** (106 is the
Store's); SU settings stay in `su/config.ts`; owner only until the owner answers.

**Shipped**
- **107 the SU mapping:** `channel_hotels` (SU hotel id, unique in the group in any
  case; postcode, country, position, contact name, description; `on_su`; the last
  send), `channel_room_types` (SU room id unique per hotel in any case, SU room type,
  children at most, `is_connected`, `on_su`, the last send), `channel_rate_plans`
  (a meal plan as an SU rate plan). Row security per hotel, forced; no delete for
  the application; audited; nothing created for any hotel.
- Routes under `/api/hotels/:code/channel-manager`: `GET content`, `PUT hotel`,
  `PUT room-types/:id`, `PUT rate-plans/:mealPlan`, `POST content/send`. Owner of the
  hotel only (`access.ts`, the `integration` grant).
- Sending: everything SU requires is checked first and every gap named at once;
  then the property (New, then Overlay, whole every time), room types (Initial,
  Modify, Deactivated, Active), rate plans (New, Overlay, Remove, Activate), one
  request each; `on_su` moves only on SU's acceptance; an SU id cannot change once
  SU has it; the live account only for a hotel switched on
  (`app.module_enabled(hotel, 'channel_manager')`, the master's switch, off today).
- The owner's SU setup on the channel manager page (`components/SuSetup.tsx`,
  `data/su.ts`): the login, the hotel on SU, room types, meal plans, *Send to SU*.
  Nothing suggested or filled in; rack rate "-" when none. Admin and GM see the page
  without it.

**Found**
- The demo 5 Elements' phone is `+91 2181 220 555`. SU refuses spaces, so the send
  names it rather than rewriting the number: the hotel record is the owner's.
- The design system's `Checkbox` gives the checkbox itself no accessible name (the
  label sits beside it). Seen with the browser's accessibility read; not changed,
  the component is the master's.

**Proved** — in `D:\fidato-channel-manager`, on this commit's tree
- `api: npm test`: 937 passed, 54 files, exit 0 (11 new in `suContent.test.ts`).
  **Broken on purpose, seen to fail, restored:** the check-before-send skipped (2
  red), `on_su` moved on a refusal (1 red), an SU id allowed to change (1 red), the
  live account allowed for a hotel not switched on (1 red).
- `bash db/tests/run.sh`: 808 assertions passed, su mapping 21. **Broken on
  purpose:** the rate plan id made case-sensitive, and "a second rate plan cannot
  take ep" went red; restored. `bash db/tests/rerun.sh`: all migrations re-runnable.
- `npx tsc -b --force`: clean. `npx vitest run`: 346 passed, 1 failed, exit 1 - the
  failure is `migrationNumbers` ("no gaps"), because 107 is here and the Store's 106
  is not yet in cp6; expected, told to the master. The 2 new screen tests: owner sees
  the setup with *Send to SU* disabled; a GM does not, and the setup is never asked
  for. **Broken on purpose:** the setup shown to everybody, and the GM test went red.
- `npm run build`: exit 0, no test sign-in in dist.
- Opened as the owner at `/h/5EL/channels` on this copy's servers: saved the hotel's
  SU details (toast "Saved. Nothing has been sent to SU."; the list of what SU needs
  shrank to the phone's format), saved Deluxe as DLX, Triple, 2 children, to SU; the
  rows are in the database and the audit log; after a reload the row reads back DLX /
  Triple, not sent; no console error after the reload.
- `npm run lane -- channel-manager`: all mine but `db/migrations/107_…` (shared core;
  the number is the master's).

**Left open**
- A real send: SU's test keys (the owner).
- Part 3, rates and availability: next. Part 4 waits on the owner's answers through the
  master.

---

## 2026-09-17 · SU connection, part 1: the token login

**Asked for:** the owner, 17 September (D17-66): build SU's mandatory set in
order (token login, content mapping, rates and availability, reservations); the
SU token only in the server's environment; ask before anything goes live; tell the
master the branch after each part. Branch `channel-manager/su-connection`, copy
`D:\fidato-channel-manager`, database `fidato_channel_manager`, API port 8801.

**Shipped**
- `api/src/modules/channel-manager/su/` — the SU client. Settings
  `SU_ENVIRONMENT` (sandbox | live), `SU_CLIENT_ID`, `SU_CLIENT_SECRET`, read from
  the server's environment at call time; the host comes from SU's two, never from a
  setting. The token holder follows SU's "Token Based Authentication": one token
  reused and renewed five minutes before its hour, one request however many callers,
  SU's 30 logins an hour counted and never exceeded, a minute's wait after a refused
  login, a live token from test keys (or the reverse) refused, the keys scrubbed
  from any message SU sends back. A call is signed `Bearer`, SU's `Status: Fail` on
  HTTP 200 is read as a refusal, "Authorization Required" gets one fresh login and
  no second, "Limit has been reached" is named as a limit.
- `connection.ts`, mounted under `/api`: `GET /api/channel-manager/su` (set up or
  not, which account, what is missing, the last login) and
  `POST /api/channel-manager/su/login` (log in now). Owner only: the `integration`
  grant is the owner's alone. No answer carries the id, the secret or the token.
- The status page says SU, "being built, and nothing is sent to any booking site
  yet", and what it still needs before it goes live (SU's test account, SU's
  certification, the room type and meal plan mapping, each hotel switched on by
  itself, one rate or a rate per channel). "within seconds" removed: nobody has
  decided how fast. The long dash left every sentence a person reads (D17-59).
- `MODULE.md` rewritten for the build; `DEFECTS.md` CM-1.

**Found**
- **CM-1:** `npm run load-demo`, run in this copy, connected to the master's
  development database (`fidato`), not this copy's, and began tearing down 5EL. The
  append-only stock guard stopped it inside its transaction; checked afterwards,
  nothing was kept. Request to the master in `MODULE.md`.

**Proved** — run in `D:\fidato-channel-manager` on 17 September, on this commit's tree
- `api: npm test -- channel-manager`: 18 passed (SU stood in for by the answers
  SU's documents give; no test reaches the internet). **Broken on purpose, seen to
  fail, restored:** the key scrubbing removed, the test/live check removed, the owner
  check removed: three tests red, one per guard.
- `api: npm test`: 926 passed, 53 files, exit 0.
- `npx tsc -b --force`: clean. `npx vitest run`: 345 passed, 38 files, exit 0.
  `npm run build`: exit 0, "no test sign-in in dist".
- `npm run lane -- channel-manager`: all inside the lane (the tests in
  `api/test/modules/channel-manager/`, nobody's in particular).
- Opened as the owner at `/h/5EL/channels` (this copy's servers): the new words,
  the four recorded OTAs. `GET /api/channel-manager/su` as the owner: not set up,
  naming the three settings; the login refused 409 for the same reason; as reception:
  403 "The SU connection is for the owner. Ask the owner."

**Left open**
- SU's test keys (the owner): nothing has logged in to a real SU yet.
- Whether an administrator or a GM should reach the SU connection (today owner only).
- Part 2, content mapping, next.

---

## 2026-09-16 · into the Coming soon section

**Asked for:** the owner, 16 September — every service the system does not have
yet in one Coming soon section, for the owner, admins and general managers.

**Shipped:** `nav.ts` — the entry moves from Inventory (`listed: false`) to
the Coming soon section, seen by the owner, admins and GMs
(`seesComingSoon`); `routes.tsx` — the page is now guarded
(`RequireAccess`), so it is refused to anybody the menu does not show it to.
Before, anybody holding the `rate` grant could find it by search and open it.
The page itself is unchanged.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16.

---

## 2026-09-15 · moved into its own folder

**Asked for:** the owner's request of 15 September — the code split into one
folder per hotel service, including the services not built yet
(`docs/SERVICE-FOLDERS-PLAN.md`). For this folder: its brief.

**Shipped**
- Step 3 (`e9dd6b1`): `nav.ts` — the one entry, in nobody's menu
  (`listed: false`); `routes.tsx`; `index.ts`; a first `MODULE.md`. No server
  folder — there is no server code.
- `610bee7` (the guests move): the status page reads the companies list
  through `@/modules/guests`.
- Step 4 (`a932fdf`): moved in — `pages/ChannelManager.tsx` (from `src/pages/`).
- This brief: `MODULE.md` rewritten from the code — the status, the one
  screen, what a connection would build on; this file; `DEFECTS.md` indexing
  two root entries.

**Found** — nothing.

**Proved** — run in this worktree on 15 September, on the commit that adds
this file
- `npx tsc -b`: clean.
- `npx vitest run src/test/boundaries.test.ts`: 4 passed. With
  `src/modules/crs/MODULE.md` taken away it failed naming that file; put back,
  it passed.
- `npx vitest run`: 204 passed in 15 files, with placeholder
  `VITE_FIREBASE_*` values supplied. Without them 31 tests in
  `src/App.test.tsx` fail here — this worktree has no `.env` (gitignored) —
  and the same 31 failed with the brief-only folders taken out. Every run also
  reports 2 unhandled rejections from `src/lib/outbox.ts` under jsdom.
- Every line under "Before the move" below, and in `DEFECTS.md`, was matched
  against the root files' headings by a script: all exact.

**Left open**
- The owner's decision to start, and the four questions the status page
  lists (which channel manager, the account, room-name mapping, one rate or a
  rate per channel).

**Commits:** `e9dd6b1` · `610bee7` · `a932fdf`, and the commit that added this
file.

---

## Before the move — entries in the root CHANGELOG.md

- 2026-09-15 (step 3) · A menu for each person, and the search it depends on
- 2026-09-08 (phase 1) · Three gates aimed at an act, applied to a screen

Earlier than the root file: commit `72ccec5` (5 September), "The OTA
connection is named rather than omitted", made the status page.
