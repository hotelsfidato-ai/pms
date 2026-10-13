# Front desk

Checking guests in and out, and everything the desk does to a stay in between.

**Folder name:** `front-desk` — the same word in all three places:

```
src/modules/front-desk/          the screens, their data calls, their tests
api/src/modules/front-desk/      the server's routes for this service
db/tests/modules/front-desk.sql  NEW database checks only — db/tests/suite.sql is frozen history
```

Every screen, address, endpoint, table and number below was checked in the
code on branch `service-folders` at `c804aa2` (15 September 2026), after the
server split and the test split were merged. Where the code could not settle
something, it says so.

## What it is

The receptionist's working day. They see every room at a glance (Rooms) or
across two weeks (Calendar), check in today's arrivals, take a walk-in into
an empty room, move a guest or swap two guests, change a stay's dates or
number of guests, void a booking entered by mistake, and check a guest out
once the bill is settled. Everything done to one stay happens in the **stay
panel**, which opens over whichever screen the clerk came from. The bill
inside that panel (the Bill tab) is finance's.

## Screens

Who works from each is `workingMenus` in `nav.ts` (the owner's menu of
15 September). Roles without a working menu — owner, admin, GM, hotel
manager, accountant, viewer — see these in the full menu where their
permission allows; anyone whose permission allows can reach them with Find
a screen (Ctrl K).

| Menu entry (section) | Address | Page file | Working menu |
|---|---|---|---|
| Rooms (top) | `/h/:code/stay` | `pages/StayView.tsx` (`view="floor"`) | Reception |
| Calendar (top) | `/h/:code/calendar` | `pages/StayView.tsx` (`view="calendar"`) | Reception |
| Arrivals → Today (Front desk) | `/h/:code/arrivals` | `pages/Arrivals.tsx` | Reception |
| Arrivals → Upcoming | `/h/:code/arrivals/upcoming` | `pages/Arrivals.tsx` | Reception |
| In house → In house now | `/h/:code/in-house` | `pages/InHouse.tsx` | Reception |
| In house → Due out | `/h/:code/in-house/due-out` | `pages/InHouse.tsx` | Reception |
| Walk-ins | `/h/:code/walk-ins` | `pages/WalkIns.tsx` | Reception |

Seven addresses, four page files. The menu gate is `dashboard` for Rooms and
`reservation` for the rest (`nav.ts`).

- **The stay panel** — `flows/StayDrawer.tsx`. It opens over Rooms and
  Calendar from a deep link (`/h/:code/stay?res=<booking id>`; every link to
  a booking points there, which is why `/stay` stayed Rooms — `routes.tsx`)
  and from every stay list through `components/StayTable.tsx`. It holds check
  in (`CheckInFlow`: ONE page under one Check in since D27-163, laid out like New booking since D27-236 - the room, ID, early arrival and offers on the left, the stay's dates, party, meal plan and rate on the right, each fact with its Change; an Indian guest whose ID THIS stay's online check-in confirmed is shown it, not asked again, D27-242), the actions menu (`StayActions`: amend, move or
  unassign, exchange, inclusions, void), the marks (`StayMarks`), the
  group's rooms (reservations' `GroupRoomsList`) and the Bill (finance's
  `FolioPanel`, which calls back into this service for check-out and
  `LateCheckOutFlow`).
- **On Rooms** the room tiles (`flows/HouseFloor.tsx`); **on both Rooms and
  Calendar** the Assign room button (`flows/AssignRoomFlow.tsx`), and an
  empty room that opens New booking's one page on it
  (`/h/:code/book?room=<room>&date=<date>`, reservations; D27-163): tonight's
  is a walk-in: the booking on the Walk-in channel, then the check-in.
  `WalkInFlow.tsx` and its client door `createWalkIn` went, and the server's
  `POST /:code/walk-ins` followed on 30 September (Rule 2b: no screen called
  it). The Walk-ins screen is the record of walk-ins, not a form (`WalkIns.tsx`
  header).
- `StayTable` is also used by reservations' All bookings and finance's
  Folios.

## Server endpoints

All hang from `/api/hotels`, in three files in `api/src/modules/front-desk/`,
mounted by its `index.ts` in this order: `stays`, `operations`, `stayExtras`.
They moved there in the server split of 15 September (`3424882`, `b772047`).

**`api/src/modules/front-desk/stays.ts`** (was `api/src/routes/stays.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/stays` | every stay with the room it is in; "due out" is worked out here, stored nowhere |
| GET | `/:code/stays/:id` | one stay |
| GET | `/:code/stays/:id/express-check-in` | `{ express, document: { type, number } }`: whether THIS stay's own online check-in was confirmed with an ID type and number, for a guest who is not foreign - the number masked to its last four (D27-242). A document kept from an earlier visit never counts. Also `advance` (the amount still owed before check-in, in the refusal's words, or null), `bookingSite` and `prepaidOnSite`; `?prepaid=false` asks as if the desk had unticked it (D27-243 3.3, D27-246) |
| GET | `/:code/house-now` | every room on the business date - in house, out of order or Empty - and the In house and Empty counts (rooms), from `app.house_now` (the one in-house rule, D21-36 and D21-37). Rooms, the Dashboard, In house, the property page and the housekeeping board read this and nothing else for either number |
| GET | `/:code/calendar-prices?from&days` | each room type's price on each night of the window, `[{ type, date, price }]`: `app.price_for` on EP, the Rates screen's main row - the night's own price, else the standard (rack) price, else null (a dash). One read for the Calendar's whole window (D27-271 item 3). Gate: `reservation` view, the Calendar's readers |
| GET | `/:code/groups` | the groups list that reservations' Groups screen reads — see the warning below |

⚠ `GET /:code/groups` lives in `stays.ts`, not in reservations' `groups.ts`.
`stays.ts` is mounted first and the server answers with the first match, so
a second copy in `groups.ts` would never run (MEMORY 118). The plan gives
`stays.ts` to this service whole and calls "groups" reservations'; the split
kept this endpoint here. Whether it should move is not settled — ask before
moving it.

**`api/src/modules/front-desk/operations.ts`** (the front-desk half of the
old `api/src/routes/operations.ts`; the money half is finance's `postings.ts`
and `cashier.ts`)

| Method | Path | What it does |
|---|---|---|
| POST | `/:code/stays/:id/check-in` | check in; refuses, last of all and before any write, an advance the hotel asks before check-in and the stay still owes, with the amount (187, D27-243 3.3; never a company's booking, a room the group's host pays for, a complimentary room, or a booking-site booking prepaid there - `prepaidOnSite` false unticks it, saved with the check-in); records the ID document - or, with none sent and no reason to skip, takes the ID THIS stay's confirmed online check-in gave, for a guest who is not foreign (express, D27-242; decided here, never by the screen); the release of the stay's other advance room comes before it is marked checked in, so that room is not dirtied (FD-10, 185); posts an early-arrival charge; refuses a room somebody is still in by `app.in_house` (FD-11), and a waive of the early charge by somebody who may not give it (FD-14) - both before the first write; a move of the arrival by more than a day only with `confirmMove: true` (FD-22, D27-193). A moved arrival is checked against the room's other holds FROM TODAY and the hold is written (or stretched back) from today (FD-24). An early arrival's fee is posted with source `early_checkin` (D27-223). **Its last write posts the first night's room charge and GST** (D27-204) - or a day-use stay's day, "Room N · day use" (D27-225), dated the business date, through the night audit's own `roomNightsDue` and `postRoomNight` (source `check_in`, in the clerk's name): nothing for a complimentary room, and nothing where the property has no GST rule for rooms - the guest is still checked in and the audit posts that night (D27-205) |
| GET | `/:code/early-arrival` | is arriving now early, with the hotel's times and charges (063) — null, never 0; and `mayWaive`, whether the server takes a waive of either charge from this person (the screens draw the tick from it, D24-16) |
| POST | `/:code/stays/:id/check-out` | check out; closes the folio. A late departure - the business date on or after the departure date AND past the check-out time on the property's clock (`app.departure_is_late`, migration "late departure on the day") - needs a reason and posts the late charge (or a manager's waiver) ONCE: a stay whose late departure is already recorded (`late_checkout_at`) is not asked again and not charged again, whatever the body sends (D27-314, FD-27, FD-28). A guest leaving before the departure date is never asked or charged |
| POST | `/:code/stays/:id/assign` | give a booking a room; for a guest already checked in, refuses a room somebody is still in (`stillIn`, D24-15) - a booking not yet here is only held |
| POST | `/:code/stays/:id/move` | move a guest to another room (`app.move_room`, 054); a checked-in guest moved from tonight or earlier is refused a room somebody is still in (`stillIn`, D24-15). With a new rate (`agreedRate`) on the arrival day, tonight's night - posted at check-in - is put right to it by finance's `editFolioCharge`, reason "Room move: …", before `app.move_room` writes (D27-205). **The desk may do this through the move**, though it edits no other charge; the corrected line keeps the first room's number in its words |
| PATCH | `/:code/stays/:id` | amend the dates and number of guests (`app.amend_stay`, 055; 176: a day use is a stay too). A day use stays a day use and a stay stays a stay (D27-229): the rate is a day's or a night's, so turning one into the other is refused in words |
| POST | `/:code/stays/:id/unassign` | take the room back (`app.unassign_room`, 054) |
| POST | `/:code/stays/:id/void` | void a booking entered by mistake (042) |

**`api/src/modules/front-desk/stayExtras.ts`** (was `api/src/routes/stayExtras.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/stays/:id/exchangeable` | who this guest could swap rooms with |
| POST | `/:code/stays/:id/exchange` | swap two guests' rooms (`app.exchange_rooms`, 065); from tonight or earlier, refused where a third guest is still in either room (`stillIn`, D24-15) |
| GET | `/:code/inclusions` | the hotel's list of inclusions |
| POST | `/:code/inclusions` | add one — **no screen calls it** (`addInclusion` is on `KNOWN_UNREACHABLE`) |
| GET | `/:code/stays/:id/inclusions` | what this stay includes |
| POST | `/:code/stays/:id/inclusions` | add an inclusion to a stay |
| DELETE | `/:code/stays/:id/inclusions/:lineId` | take it off |

19 endpoints. Server tests that exercise them still sit in `api/test/` (for
example `identity.test.ts` — check-in and documents — and
`concurrency.test.ts` "ra_no_double_booking"); there is no
`api/test/modules/front-desk/` yet, and new ones go there (the plan's
refinement).

## Data

`src/modules/front-desk/data/`:

| File | What it does |
|---|---|
| `stays.ts` | reads stays over HTTP and slices one list three ways — arrivals, in house, departures — plus `fetchStays` (the raw read other services reuse) |
| `operations.ts` | the writes behind the desk's flows: check in and out, assign, move, unassign, amend, void, and the early-arrival read; check-in and check-out ask `src/lib/rules.ts` first |
| `stayExtras.ts` | exchanging two rooms, and inclusions |
| `stayview.ts` | the Calendar's data — a fourteen-day window, bars and their tones, room rates from the room type (null when unpriced) — and the counts the Dashboard shows |
| `stayview.test.ts` | the Calendar's data: the window, rooms and bars, counts that agree with their filters, the footer, and rates (a dash, never a zero) |

The screen tests sit at the folder's root: `front-desk.test.tsx` — the tape
chart and the stay panel, split out of `src/App.test.tsx` on 15 September
(`f02c781`).

`listVacant` (`stays.ts`), `windowFrom` (`stayview.ts`) and `addInclusion`
(`stayExtras.ts`) have no caller and are listed in `KNOWN_UNREACHABLE` in
`src/data/repositories/repositories.test.ts` — a list that may only shrink.

## Database

Tables this service writes (from the SQL in its route files), and the
migrations that made or changed them:

| Table | What front desk does to it | Migrations |
|---|---|---|
| `reservations` | checks in, checks out, voids; records early and late times and reasons | created `005_reservations.sql`; `011_model_additions.sql` (the room moved out to `room_assignments`), `015_edge_cases.sql` (day use, dates in order), `042_void_and_sources.sql` (void and its reason), `043_indicators.sql` (single-lady mark), `055_amend_stay.sql`, `063_early_late.sql`, `064_expected_arrival.sql`, `085_walk_in_channel.sql` |
| `room_assignments` | which room a stay holds, night by night: assign, move, exchange, unassign, release | created `011_model_additions.sql` (`ra_no_double_booking`); `015_edge_cases.sql` (an assignment stays inside its booking), `054_room_move.sql`, `065_exchange_and_inclusions.sql`, `070_vacating_dirties.sql`, `072_room_tonight.sql` (`app.room_on`, `app.room_for`), `073_no_show_releases_rooms.sql`, `074_nobody_slept_there.sql`, `086_stay_room.sql` (`app.stay_room`), `130_moved_out_room_is_dirty.sql` (a move dirties the room left, FD-9) |
| `rooms` (`occupancy_status`) | NOT written here any more (22 September, FD-8): set from `app.in_house` by the one in-house rule's triggers, on every assignment and every status change | `003_rooms.sql`; `043_indicators.sql` (smoking, connected rooms); `070_vacating_dirties.sql`; the one in-house rule (`app.in_house`, `app.house_now`, `app.sync_room_occupancy`) |
| `inclusions`, `reservation_inclusions` | what a rate includes, its price snapshotted onto the stay | `065_exchange_and_inclusions.sql` |

It also writes into other services' tables, directly in SQL: `guests`
(nationality at check-in) and `guest_documents` (the ID recorded at check-in,
`026_identity_capture.sql`) — guests' tables; and `folios` and
`folio_postings` (a folio opened at check-in if the booking has none; the
early-arrival and late check-out charges; the folio closed at check-out) — finance's tables, append-only (`006_folio.sql`). It reads the
hotel's check-in and check-out times and early and late charges (`hotels`,
`063_early_late.sql`), which are set in administration.

A new migration needs a number claimed in `HANDOVER.md` first; the guard is
`src/test/migrationNumbers.test.ts` (numbered from 001 up, once each, no gaps).

## Front door

What `index.ts` exports, and who uses each (grep of `@/modules/front-desk`,
15 September):

| Export | Used by |
|---|---|
| `StayTable`, types `StayColumn`, `StayRow` | finance (`pages/Folios.tsx`), reservations (`pages/Reservations.tsx`) |
| `checkOut`, `checkOutAllowed`, `earlyArrival` | finance (`flows/FolioPanel.tsx`) |
| type `Posting` | finance (`data/postings.ts`) |
| `fetchStays` | finance (`data/folios.ts`), reservations (`data/groups.ts`) |
| `getStay` | finance (`data/postings.ts`); the core test `repositories.test.ts` |
| `listStays` | housekeeping (`data/housekeeping.ts`), reservations (`pages/Reservations.tsx`); the core test |
| `listArrivals`, `listInHouse`, `listDepartures` | the core test `repositories.test.ts` only |
| `getStayView`, `fetchStays`, type `ChartRoom` | reports (`pages/Dashboard.tsx`, 3 October) |
| `getHouseNow`, types `HouseNow`, `HouseNowRoom` | admin (`pages/Property.tsx`), housekeeping (`data/housekeeping.ts`) - 22 September |
| `LateCheckOutFlow` | finance (`flows/FolioPanel.tsx`) |

**21 September - the Central CRM** (`src/modules/crm/MODULE.md`). The walk-in
asks an optional phone and email; they suggest a returning guest ("stayed
with the group N times - same person?") and warn of a blacklisted one, and
the name list that matched a shared surname is gone (the owner). `POST
/:code/walk-ins` took `phone`, `email`, `guestId`, `whatsappAgreed`,
`noOffers` (the route went 30 September; the booking takes them). The stay panel (`flows/GuestMarks.tsx`) shows "stayed with the
group N times" (not counting this stay), the WhatsApp tick the desk may
change (`GET /:code/stays/:id/guest-marks`, `POST /:code/stays/:id/whatsapp`,
in `stayExtras.ts`), and a Guest 360 link for the owner, an administrator and
the GM. It leans on **guests** (`ReturningGuest`, `ConsentTicks`,
`stayedWords`) and **crm** (`seesGuest360`, `guest360Path`).

## Leans on

Other services, through their doors only:

- **finance** — `getFolio` and `FolioPanel` (the stay panel's Bill tab),
  `getFolioBalance` (`data/operations.ts`, `pages/InHouse.tsx`),
  `listOpenFolios` (`data/stayview.ts`).
- **guests** — `setGuestVip` (the VIP mark in the stay panel).
- **reservations** — `GroupRoomsList`, `GROUP_ROOMS_ID` (a group stay's rooms).

And the core: `src/data/repositories/rooms.ts` (`listAllRooms`, `getRoom`),
the shared types and `queryKeys`, `setMyPreferences` (the Room type / Floor
switch), and `src/lib/rules.ts` (`canCheckIn`, `canCheckOut`,
`canConfirmWalkIn`, `rateOverrideNeedsReason`). Whether a room needs cleaning is not
imported from housekeeping — the database sets it when a room is vacated
(070, 074).

## Rules that bind it

- **No default prices; a missing figure is a dash, never a zero** (the
  owner's standing rule, `HANDOVER.md` § 5). Broken here before: the Calendar
  and the walk-in pre-filled invented rack rates (MEMORY 65), and "Rack rate
  ₹0" showed for an unpriced room type (MEMORY 246).
- **Rooms and Calendar are two menu entries with their own addresses**
  (owner, 14 September, `HANDOVER.md` § 4; MEMORY 252).
- **The first screen after sign-in is set per person by the GM** — Dashboard,
  Rooms or Calendar — and the person may change their own (owner,
  14 September; `087_first_screen_and_reception_pos.sql`).
- **The Room type / Floor switch on Rooms stays, remembered per person on the
  server** (owner, 14 September; `staff.room_grouping`, 087).
- **Bill at the desk, Folio in Finance** (owner, 15 September). Desk screens
  say "bill"; the last three desk "folio"s were fixed on 15 September
  (MEMORY 265). The desk's glossary also says Booking, not Reservation, and
  Guests, not Pax (`HANDOVER.md` § 6).
- **Room states, one set of words** — Empty, Free, In house, Arriving,
  Reserved, Out of service, Due out, Needs cleaning — and a number is renamed
  by what it counts (`HANDOVER.md` § 6; MEMORY 258).
- **A shorter menu keeps everything reachable by search** (owner,
  15 September). Reception's working menu carries Rooms, Calendar, Arrivals
  (and Upcoming), In house (and Due out) and Walk-ins from here. A new screen
  goes into the right working menus or it is search-only for those roles;
  give it `keywords` (`HANDOVER.md` § 3.2).
- **Start here, reception's card** (`src/components/app/startHereCards.ts`):
  "Check a guest in — Pick the guest from today's arrivals, then **Check
  in**" (`/h/:code/arrivals`); "Take a payment" (`/h/:code/in-house`) and
  "Check a guest out" (`/h/:code/in-house/due-out`) go through the stay
  panel's **Bill** tab. The card shows on Rooms and Calendar
  (`START_HERE_ON`). Rename a button and the card changes too
  (`HANDOVER.md` § 3.3).
- **Glossary:** the Form C hint at check-in uses the `formC` line of
  `src/lib/glossary.ts`; if the rule changes, the line changes.
- **One main action per screen** (clarity step 2, 15 September): the stay
  panel is pinned by "shows one main action on each tab of the stay panel"
  (`front-desk.test.tsx`); Void is a danger button; any new dialog must pass
  `src/components/ui/primaryAction.test.ts` (`HANDOVER.md` § 3.1).
- **Business rules live in `src/lib/rules.ts`, and a blocked action is shown
  disabled with its reason** (`MASTER.md` § 2, Rules 3 and 6). When an action
  moves, its gate moves in the same commit (MEMORY 14).
- **The hotel's business date, never the clock** — for a move date and for an
  early or late charge (MEMORY 19, 98, 158), and for whether a departure is
  late at all: before the departure date it is an early departure, whatever
  the hour (D27-314 (2)); the hour is the property's clock.
- **A late departure is recorded once** (D27-314 (1)): the second Check out
  reuses the reason recorded and posts nothing again - decided in the route,
  under the stay's row lock, not on the screen.
- **Every booking records its channel, walk-ins included** (MEMORY 242,
  085). Guarded by `api/test/modules/reservations/reservationInserts.test.ts`,
  which reads every `insert into reservations` under `api/src`.
- **A refusal goes above the first write** — `withSession` commits a refusal
  like any other return (MEMORY 243).
- **Cash of ₹2,00,000 or more from one guest is refused** (Income-tax Act
  s.186, D25-40), counted by `app.cash_taken` over the stay, its group - its
  rooms and, since D27-307 (5), its master bill - and the guest's other stays
  that day (migrations "cash limit and PAN", "cash with the master bill").
  Proved in `db/tests/modules/front-desk.sql` and
  `api/test/modules/front-desk/cashLimit.test.ts`; the check itself is
  finance's (`cashLimit.ts`, `postings.ts`).
- **At check-in, "IN" typed never replaces a foreign nationality on file**
  (D27-197, FD-23): the ID block opens on IN, and Form III is asked of the
  nationality on the guest's record. A wrong nationality is corrected on the
  guest's record, not by a check-in. Guarded by guests' `formIII.test.ts`.
- **With the line down** (`src/lib/offline.ts`, core; guarded by
  `src/lib/offline.test.ts`): check in, assign and unassign may be
  held and sent later, with a warning; check-out, void and move are refused;
  any write not named there — amend, exchange, inclusions — is refused too. A
  new write that must work offline is a request to the core owner.
- **Never deploy during the night audit** (`HANDOVER.md` § 9); production
  deploys are the owner's (`HANDOVER.md` § 5).

## Open items

From `PENDING.md`, and one found while writing this brief:

- **Defect 243's shape in the other routes** — the walk-in route (gone
  30 September) put its refusals before its first write; "the other routes have not been checked"
  (PENDING § 2 and § 5).
- **Rooms on a phone** — the controls take 376px of an 812px screen before
  the first room (PENDING § 5a; MEMORY 268).
- **`const USER = "front desk"`** — FIXED here 16 September (FD-2): gone from
  `CheckInFlow.tsx` and `WalkInFlow.tsx`, and the server never read it.
  Finance's `FolioPanel.tsx` still holds one — see Requests below.
- **A hotel with no rooms** — FIXED 17 September (FD-5, D17-23): Rooms and
  Calendar say "No rooms set up yet. Add them in Room types."
  (`stayViewNoRooms.test.tsx`).
- **"Today" three pixels past a phone's edge** after paging a week (FD-7) —
  the row wraps since 17 September (D17-41), held since 26 September by
  `front-desk.test.tsx` (D25-27); FD-7 is fixed.
- **Two "in house" numbers** — the property page said 11 in house / 9 vacant
  while the Dashboard and Rooms (the stay-view counts) said 10 / 7, same
  minute, 14 September. Needs one definition, the owner's to choose
  (PENDING § 6; MEMORY "Open"; CHANGELOG 14 September).
  **CHOSEN 21 September:** in house = checked in and not yet checked out,
  whatever the departure date (D21-36); vacant = nobody in it AND sellable
  tonight, with out-of-order and blocked rooms their own count (D21-37).
  **BUILT 22 September:** `app.in_house` and `app.house_now` in the
  database, served by `GET /:code/house-now`; Rooms, the Dashboard, In
  house, the property page and the housekeeping board read it. The counts
  are ROOMS - 201 holding a guest due out and the guest who arrived into it
  is one room in house (a question for the owner in the 22 September
  CHANGELOG entry). Proved by `inHouseRule.test.tsx` (every screen) and
  `api/test/modules/front-desk/inHouseRule.test.ts`.
- **"Which room was this stay in" written by hand** —
  `api/src/modules/front-desk/stays.ts` holds one of the seven copies; `app.stay_room()` (086) is the one rule; moving onto it
  is tidying, not a fix (PENDING § 6).
- **Unreachable helpers** — `addInclusion` (so `POST /:code/inclusions` has
  no screen), `listVacant`, `windowFrom` (PENDING § 4).
- **Find a screen does not search bookings or guests** — screens only
  (PENDING § 5a).
- **The plan's own test has not been run** — somebody new books, checks in,
  takes a payment and checks out without being told; the owner's to arrange
  (PENDING § 5a; `HANDOVER.md` § 3.3).
- **Defect 242** (the walk-in channel) is still marked "FIXED, NOT DEPLOYED"
  in PENDING § 2, while `HANDOVER.md` § 2 records 085 live since
  15 September. PENDING is out of date on this point.
- **Where `GET /:code/groups` belongs** — the server split left it in this
  service's `stays.ts`; see Server endpoints.

## Gates

Before the first edit: claim this service from your copy's folder with
`npm run claim -- front-desk "one line"` (since 16 September claims live in
the git directory every copy shares — never a file in `.claims/`, never
committed), and `npm run release -- front-desk` when you stop. Work in your
own worktree with your own database and ports — how, in `AGENTS.md` ("Before
your first write"); the rules for parallel agents, in
`docs/SERVICE-FOLDERS-PLAN.md`.

```
# the PC, in your worktree's folder (PowerShell or Git Bash)
npx tsc -b                      # web types — no output at all
npx vitest run                  # web tests
cd api && npx tsc --noEmit      # server types
cd api && npm test              # server tests — never `npx vitest run` inside api/ (MEMORY 196, 221, 264)

# the PC, Git Bash, in your worktree's folder — needs the local Postgres (HANDOVER.md § 7)
db/tests/run.sh                 # every database check, on a scratch database
db/tests/rerun.sh               # only if you added a migration: it must run twice
```

⚠ A fresh worktree has no copy of the main folder's untracked `.env`;
`AGENTS.md` ("Before your first write") gives your copy a `.env.local` with
`VITE_API_URL` and `VITE_ALLOW_DEV_AUTH=1`. Measured at `c804aa2` in the
worktree this brief was written in: with no env file, `npx vitest run` failed
31 of 204 (19 in `src/App.test.tsx`, 10 in `front-desk.test.tsx`, 2 in
reports'); with only `VITE_ALLOW_DEV_AUTH=1` it still exited 1; with that and
`VITE_DEMO_MODE=1`, 4 of 204 failed, all in `src/App.test.tsx` (not
investigated). A gate's answer is its exit code (MEMORY 274). Never print an
env file.

The guards this service must respect:

- `src/test/boundaries.test.ts` — another service is reached only through its
  `index.ts`; every service folder keeps its `index.ts` and `MODULE.md`.
- `src/test/migrationNumbers.test.ts` — one number, one migration.
- `src/components/app/navigation.test.ts` — pins Reception's working menu.
- `src/components/ui/primaryAction.test.ts` — every dialog declares its main
  action.
- `src/data/repositories/repositories.test.ts` — no exported data function
  without a caller, across every service's `data/`.
- `src/modules/front-desk/front-desk.test.tsx` — "the tape chart at
  /h/:code/stay", the stay panel's one main action per tab.
- `src/modules/front-desk/stayViewStates.test.tsx` — Rooms when the server
  does not answer: loading in the house's shape, "did not load" with Try
  again, and the last good house kept under a strip (FD-6). The file's cache
  lives as long as the file, so its first test must stay first.
- `src/modules/front-desk/actorFromSession.test.ts` — no `const USER = "…"`
  and no `user:` field in this folder's sources (FD-2).
- `src/App.test.tsx` — "start here" (reception's card).
- `src/lib/offline.test.ts` — which writes may be held offline.
- `api/test/modules/reservations/reservationInserts.test.ts` — every
  reservation records its channel.

## Requests from this service

Changes this service needs in files it may not touch. Written 16 September by
the front-desk chat; each also told to the owner.

- ~~**To the master — `src/App.tsx`, `PERSISTED`.**~~ **Done 24 September**
  by the admin lane (D22-23, the owner): `PERSISTED` keeps `stay-view` - the
  Rooms board's rooms, their states and the fortnight, which the Calendar
  reads too - so a reload with the server down shows the last house. `stays`
  (the names under the tiles) is deliberately not kept: the owner chose to
  keep the hotel's whole booking list off the desk computer.
- **To the master — the lane setup.** (1) On a fresh lane database
  `load-demo` fails with `undefined.id` unless `db/tests/harness.sql` and
  `suite.sql` load first, as `api/scripts/with-test-db.sh:99` knows and
  `docs/briefs/README.md` does not say. (2) `db/migrate.sh
  --with-dev-identities` prints "✓ local sign-in accounts linked" straight
  after that step's psql ERROR. (3) With `node_modules` linked to the main
  checkout, Vite refuses the Inter font from `D:\fidato pms\node_modules`
  (403, `server.fs.allow`), so every lane's screens render in a fallback font
  — a visual check in a lane is not quite the real screen.
- **To finance** — `api/src/modules/finance/billing.ts:98` returns
  `user: "admin"`, `folios.ts:206` prints `posted_by ?? "admin"` on a bill
  line, and `flows/FolioPanel.tsx:38` sends `const USER = "front desk"` that
  its routes do not read (they use `app.current_user_id()`). MEMORY 256 and
  266's shape: a name nobody gave.
- **To inventory — `pages/Rates.tsx`, `refresh()`** (4 October, D27-271
  item 3): a price saved on Rates does not reach the Calendar's window until
  something else refreshes it, because `stay-view` is kept with
  `staleTime: Infinity` and persisted. One line there -
  `qc.invalidateQueries({ queryKey: ["stay-view", hotelId] })` - fixes it.
- **To the master, a lesson for the root `MEMORY.md`** — React Query's
  `placeholderData` is shown only while a query is pending and dropped when it
  fails, so it cannot keep old data on screen through an error (FD-6). Any
  service reaching for it to survive an outage will meet the same wall.

## Requests from other services

None yet.

Another service's agent that needs a change here writes it in this list —
what, why, who asked, the date — and the front desk's agent does it.
