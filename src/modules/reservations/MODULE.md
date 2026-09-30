# Reservations

Taking a booking — one guest, one set of nights, one room or many — and
keeping a group's rooms and bills together.

**Folder name:** `reservations` — the same word in all three places:

```
src/modules/reservations/          the screens, their data calls, their tests
api/src/modules/reservations/      the server's routes for this service
db/tests/modules/reservations.sql  NEW database checks only — db/tests/suite.sql is frozen history
```

Every screen, address, endpoint, table and number below was checked in the
code on branch `service-folders` at `c804aa2` (15 September 2026), after the
server split and the test split were merged. Where the code could not settle
something, it says so.

## What it is

The clerk on the phone or at the desk fills in who is coming, the nights and
the rooms, and confirms the booking. More than one room makes a group
automatically. For a wedding or a block, the Groups screen lists every group
and one group's page shows its rooms and two separate balances: what the
host owes on the master bill, and what the guests owe on their own. All
bookings is every booking on the file, in any state. Checking a booked guest
in is front desk's; their bill is finance's.

## Screens

Who works from each is `workingMenus` in `nav.ts` (the owner's menu of
15 September). Roles without a working menu see these in the full menu where
their permission allows; anyone whose permission allows can reach them with
Find a screen (Ctrl K).

| Menu entry (section) | Address | Page file | Working menu |
|---|---|---|---|
| All bookings (Bookings) | `/h/:code/reservations` | `pages/Reservations.tsx` | Reception |
| Groups (Bookings) | `/h/:code/groups` | `pages/Groups.tsx` | none — search-only for Reception |
| (no menu entry) one group; its heading is the group's name | `/h/:code/groups/:id` | `pages/GroupPanel.tsx` | — |
| New booking (Bookings) | `/h/:code/book` (`?room=&date=` from an empty room, `?lead=` from a lead) | `pages/BookingPage.tsx` | Reception |

Four addresses, four page files. The menu gate is `reservation` for all
three entries. The Bookings section interleaves these with guests' entries by
`order`: All bookings 10, Guests 20, Groups 30, Companies and agents 40,
New booking 50.

- `flows/GroupRoomsPanel.tsx` — a group's rooms as cards, grouped by room
  type. Shown inside front desk's stay panel (exported as `GroupRoomsList`).
- The list screen is before the `/:id` route on purpose, so the word
  "groups" is not swallowed as an id (`routes.tsx`).

## Server endpoints

All hang from `/api/hotels`, in one file mounted by
`api/src/modules/reservations/index.ts`. It moved there in the server split
of 15 September (`3424882`).

**`api/src/modules/reservations/groups.ts`** (was `api/src/routes/groups.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/groups/:id` | one group: its rooms (`app.group_rooms`), its lead room (`leadId`, `app.group_lead`), the host's balance and the guests' balance |
| POST | `/:code/groups/:id/lead` | make a room that still stands the group's lead (D22-52): its guest gets the group's one confirmation and its one review request. `reservation: edit` |
| POST | `/:code/groups/:id/master` | open the host's master bill for the group (056); a second press returns the one already open |
| POST | `/:code/stays/:id/routing` | send a room's charges to the group's master bill, or back (`reservations.route_room_to_group`, 056) |
| POST | `/:code/bookings` | New booking: the guest, a group when there is more than one room, one reservation per room with its channel and commission, the rate from `app.tariff_for` (057), and a folio for each booking. A sender's `externalRef` makes it safe to send twice (091) |

5 endpoints. The groups **list** the Groups screen reads, `GET /:code/groups`,
is not here: it is in front desk's `api/src/modules/front-desk/stays.ts`,
which is mounted first, so a copy here would never run (MEMORY 118; the note
at the top of `groups.ts`). The split left it there; whether it should move
is not settled — ask. Server tests: `api/test/modules/reservations/`
(`reservationInserts.test.ts`).

How `POST /:code/bookings` behaves today (its own comments): the rate is not
guessed — `app.tariff_for` answers null when any part of the party is
unpriced and the booking is refused by name, unless the clerk enters an
agreed rate; availability is reported, not enforced, because a booking is
for a room type and deliberate overbooking stays possible (005); more than
40 rooms in one booking is refused as a likely typo.

**Sent twice (RES-3, 091, 16 September).** A caller that has its own
reference for the booking — a channel manager, the CRS — sends it as
`externalRef`. Every room is stamped with it (`ota_reference`), its place in
the request (`ota_line`) and a hash of the request (`ota_fingerprint`), unique
per hotel and booking source. The same reference again from the same channel:

- **same details** → `200`, the first answer again, marked `duplicate: true`;
  nothing is written;
- **different details** → `409`, naming the references on file — a changed
  booking is not taken through this door (integration plan step 1.3;
  amendments stay at the desk, CRS-22);
- **the same reference from another channel** is another booking.

Asked before any write and before the channel is checked. Two copies arriving
together are settled by the unique index, and the loser is answered as the
repeat. The desk sends no `externalRef` and nothing changes for it.

## Data

`src/modules/reservations/data/`:

| File | What it does |
|---|---|
| `groups.ts` | one group and its rooms (`getGroup`), the master bill (`openMasterFolio`), routing a room to the group (`routeRoomToGroup`), the group's lead guest (`setGroupLead`, D22-52), taking a booking (`createBooking`), the groups list (`listGroups`), and `listGroupMembers` |

`listGroupMembers` has no caller outside a test and is on `KNOWN_UNREACHABLE`
in `src/data/repositories/repositories.test.ts`. The All bookings list reads
stays through front desk's door.

## Database

Tables this service writes (from the SQL in `groups.ts`), and the migrations
that made or changed them:

| Table | What reservations does to it | Migrations |
|---|---|---|
| `reservations` | inserts one row per room booked; sets `route_room_to_group` | created `005_reservations.sql`; `011_model_additions.sql` (meal plan, group, occupancy; the room moved out to `room_assignments`), `015_edge_cases.sql` (dates in order, day use), `016_audit_coverage.sql` (rate sane), `020_deferred_fixes.sql` (`is_complimentary`), `036_cancellation_terms.sql` (the terms columns), `037_terms_on_booking.sql` (a trigger freezes the hotel's terms onto each new booking), `042_void_and_sources.sql` (business source, market segment), `056_group_billing.sql` (`route_room_to_group`), `064_expected_arrival.sql`, `082_booking_sources.sql` (`booking_source_id`, `commission_pct`), `091_booking_external_ref.sql` (`ota_line`, `ota_fingerprint`, the unique index that makes a sender's repeat one booking) |
| `reservation_groups` | one row when a booking has more than one room | created `011_model_additions.sql` |

It also writes into other services' tables, directly in SQL: `guests` (one
guest per booking — guests' table, which can never be deleted from,
`015_edge_cases.sql`) and `folios` (a folio for every booking and the
group's master bill — finance's table; `folios.group_id`, 056). The
functions it relies on: `app.tariff_for` (057), `app.group_rooms` (056,
redefined in 071 and 086), `app.stay_room` (086).

A new migration needs a number claimed in `HANDOVER.md` first; the guard is
`src/test/migrationNumbers.test.ts`.

## Front door

What `index.ts` exports, and who uses each (grep of `@/modules/reservations`,
15 September):

| Export | Used by |
|---|---|
| `GroupRoomsList`, `GROUP_ROOMS_ID` | front desk (`flows/StayDrawer.tsx`, `flows/StayMarks.tsx`) |
| `listGroups`, `listGroupMembers` | the core test `src/data/repositories/repositories.test.ts` only |

**21 September - the Central CRM** (`src/modules/crm/MODULE.md`). The booking
form shows the returning-guest suggestion under the phone and email, and two
ticks, "Guest agreed to WhatsApp" and "Do not send offers". `POST
/:code/bookings` takes `guestId` (checked again by `app.use_returning_guest`
in `book.ts`, above the first write), `whatsappAgreed` (every room of the
booking) and `noOffers`. A machine's booking sends none of them: it makes its
own guest, as before, and arrives unticked (D21-72). The fingerprint (RES-3)
is unchanged.

## Leans on

Other services, through their doors only:

- **front desk** — `fetchStays` (`data/groups.ts`), `listStays`, `StayTable`
  and type `StayColumn` (`pages/Reservations.tsx`); and, on the server, front
  desk's `GET /:code/groups` for the Groups list.
- **guests** — `listCompanies`, `listBookingSources`, `ReturningGuest`,
  `ConsentTicks`, the ID block `GuestIdFields` (`pages/BookingPage.tsx`).
- **inventory** — `getInventory`, `getTariff` (`pages/BookingPage.tsx`): what
  is free and what it costs.
- **front desk** (the one page) — `assignRoom`, `assignableRooms`, `checkIn`,
  `earlyArrival`, `listInclusions`, `addStayInclusion`.
- **finance** (the one page) — `getTaxRate`, `listBillingCompanies`, `settle`
  (the advance).

And the core: `src/lib/api`, the shared `Stay` type, `queryKeys` and
`BUSINESS_DATE`.

## Rules that bind it

- **No default prices; a missing figure is a dash, never a zero** (the
  owner's standing rule, `HANDOVER.md` § 5). The booking summary showed ₹0
  before any room was chosen (MEMORY 106); a rate is never guessed
  (`app.tariff_for`, 057).
- **Every booking records its channel** — `POST /:code/bookings` refuses a
  booking with no booking source (MEMORY 242, 082). Guarded by
  `api/test/modules/reservations/reservationInserts.test.ts`, which reads
  every `insert into reservations` under `api/src`.
- **A booking opens its folio when it is made**, not at check-in, so a
  deposit has somewhere to land (MEMORY 144; the comment in `groups.ts`).
- **Cancellation and no-show terms are frozen onto the booking** by a
  trigger (037); without it the night audit could never charge a retention
  (MEMORY 81).
- **Say Booking, not Reservation, on desk screens** — the report name keeps
  its word (`HANDOVER.md` § 6). The menu says "All bookings" although the page
  file is `Reservations.tsx`.
- **A shorter menu keeps everything reachable by search** (owner,
  15 September). Reception's working menu carries All bookings and New
  booking; Groups is reached by search. A new screen goes into the right
  working menus or it is search-only for those roles (`HANDOVER.md` § 3.2).
- **Start here, reception's card** (`src/components/app/startHereCards.ts`):
  "Take a booking — Fill in the guest and the nights, then **Confirm the
  booking**" (`/h/:code/book`). Rename that button and the card changes too
  (`HANDOVER.md` § 3.3).
- **One main action per screen** (clarity step 2, 15 September): New booking
  has one primary, "Confirm the booking", grey until the form can be sent;
  the Groups page's view switch is the `Segmented` control, not two orange
  buttons (CHANGELOG 15 September, step 2). Any new dialog must pass
  `src/components/ui/primaryAction.test.ts`.
- **A refusal goes above the first write** — `withSession` commits a refusal
  like any other return (MEMORY 243). `POST /:code/bookings` broke it until
  16 September (RES-1, fixed): it now checks the repeat, the channel and every
  line first, and writes after the line marked *"Nothing below this line
  refuses"*. A new refusal goes above that line.
- **Before adding a route, grep the path across every router and check the
  mount order** (MEMORY 118).
- **With the line down** (`src/lib/offline.ts`, core; guarded by
  `src/lib/offline.test.ts`): routing a room to the group is refused, and a
  new booking and opening a master bill are not named there, so they are
  refused too. A write that must work offline is a request to the core owner.
- **Never deploy during the night audit** (`HANDOVER.md` § 9); production
  deploys are the owner's (`HANDOVER.md` § 5).

## Open items

From `PENDING.md` and `HANDOVER.md`:

- **RES-2 — this door done, the walk-in door not.** `POST /:code/bookings`
  takes its references from `app.next_reference` (092), inside its own
  transaction: `FH-<hotel code>-<YYMM>-<number>`. Front desk switches the
  walk-in route in `operations.ts` after its current job; until then a
  walk-in and a booking at the same moment can still build one reference
  (a 500, nothing kept).
- **Staff-first phase 4 — every reservation task in three screens or fewer**
  (`HANDOVER.md` § 3.6). Measure first: a table of every reservation task
  with its screen count today, then cut each one over three.
- **`listGroupMembers` has no caller** (PENDING § 4, `KNOWN_UNREACHABLE`).
- **Find a screen does not search bookings** — screens only (PENDING § 5a).
- **The plan's own test has not been run** — somebody new books, checks in,
  takes a payment and checks out without being told; the owner's to arrange
  (PENDING § 5a).
- **Commission is stamped on each booking and nothing sums it** — the
  source-mix report does not show commission totals yet (PENDING § 6; a
  reports item, on this service's data).
- **Where `GET /:code/groups` belongs** — the server split left it in front
  desk's `stays.ts`; see Server endpoints.

## Gates

Before the first edit: claim this service in `.claims/reservations.md` (since
16 September — no longer in `HANDOVER.md`), and work in your own worktree with
your own database and ports — how, in `docs/briefs/README.md` and `AGENTS.md`
("Before your first write"); the rules for parallel agents, in
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
31 of 204 (19 in `src/App.test.tsx`, 10 in front desk's, 2 in reports');
with only `VITE_ALLOW_DEV_AUTH=1` it still exited 1; with that and
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
  without a caller.
- `src/lib/offline.test.ts` — which writes may be held offline.
- `api/test/modules/reservations/reservationInserts.test.ts` — every
  reservation records its channel.
- `api/test/modules/reservations/bookings.test.ts` — a booking sent twice is
  one booking (RES-3), counted in the database, including two copies held
  and released together; and a refused booking leaves nothing behind (RES-1),
  refused on its second line so an earlier line would show.
- `db/tests/modules/reservations.sql` — 091's index and CHECK refuse a second
  line 1 and a line number without its reference, channel or fingerprint.

## A booking a machine makes (18 September)

The owner's D17-79: SU pushes a booking the moment a site takes one, and the
channel manager turns it into a real booking **in process**, inside its own
transaction. The server's front door
(`api/src/modules/reservations/index.ts`) exports three functions for that,
and no route:

| Export | What it does |
|---|---|
| `createChannelBooking(client, staffId, input)` | The booking. Refuses rather than overbooking (D17-43, D17-80); a repeat is answered with the booking already here (RES-3); an unpriced line comes back `unpriced`, never charged at zero; keeps the commission the site sent (D17-84) and what the guest asked for |
| `cancelChannelBooking(client, staffId, input)` | **Cancelled, not voided** - the booking was real and the guest called it off (111). Refuses a guest who has already arrived; says so when it is cancelled twice |
| `channelBookingAlreadyHere(client, input)` | For a caller that lost a race: the booking as it stands, read in a fresh session |

**The booking itself is `api/src/modules/reservations/book.ts`**, moved out of
the HTTP route on 18 September so that a person's booking and a machine's are
the same act with the same refusals. `POST /:code/bookings` now reads a
request body and calls it. Anything that changes what a booking IS belongs in
that file, not in either caller.

Still to come: each night at its own price (D17-82, migration and the night
audit's reading of it), and `amendChannelBooking` for a change SU sends.

## One page, three buttons (29 September, D27-158, D27-163)

New booking is ONE page (`pages/BookingPage.tsx`, which replaced
`pages/NewBooking.tsx`): the guest, the stay (dates, the booking source, room
type, meal plan, party, rate, an optional room), the ID and an advance;
"More about the guest" and "Booking details" fold open, and so do Company
(with the chosen company's GSTIN under the picker) and Notes, each drawn only
where Settings has it on (admin's "New booking" card, migration 159: on until
a hotel turns it off). GST folded into Company and Extras left the page on 30
September (D27-187, D27-193); inclusions are added on the booking. A cash
advance with no drawer of the clerk's own open is said under Advance and holds
the buttons (D27-118). The Booked card and the panel's menu have View voucher
(`viewVoucher`, guest messages' `voucher.pdf`); the panel's menu has Change
rate for a booking still to arrive (finance's `ChangeRateDialog`). Three
buttons at the bottom, each greyed with its reason under it:

```
Save booking          the booking call; a room picked is kept (assign)
Save and assign room  the same; live only with a room picked
Check in now          the booking call, then front desk's check-in (room, ID,
                      Form III, early reason); refused, the booking stands and
                      its room is kept
```

Then the advance (finance's payment door, held as the guest's credit, D27-4)
and the extras (the stay's inclusions, on the first room). A walk-in is this
page opened from an empty room: that room, tonight, one night and the Walk-in
source; a later night's empty cell is a booking of that room. "Book this
lead" (D27-170) opens it with `?lead=<token>`: name, phone, source and the
campaign. `POST /:code/bookings` also takes `notes`, `isSingleLady` and
`campaign` (the last written only when sent: its column is leads' 164).

## Phase 1 — New booking records every field (27 September, D27-33)

The owner's Add Reservation screenshot, in this layout (docs/PLATFORM-PLAN.md
§ 3, the "add" rows). The owner's answers of 27 September: the walk-in's five
market segments; the sales-people list and the room promotions start empty;
titles Mr, Ms, Mrs, Dr or none; complimentary, and keeping both lists, for the
owner, an administrator or the GM; a "Confirm the booking" action for a
waiting booking, for anyone who may make one; the summary shows what the bill
will carry (the first night's price for every night, as the audit posts it);
typed rates stay as they are, the 10% rule binds the Discount box.

- **New booking** gains title, address, city, state, PIN, country,
  nationality (a foreigner's form said to be due at check-in), expected
  check-out (both hours hint the hotel's own times), Confirmed / Waiting for
  the hotel, market segment, sales person (the list, or "Other" typed), bill
  to Guest / Company, a Complimentary tick and an optional room per one-room
  line, "All n left" per line, the tax beside the rate (finance's tax card,
  `getTaxRate`; the audit's rounding), a discount (up to 10% with a reason, or
  a promotion), Room charges / Taxes / Due, and "Book and check in" for one
  room arriving on the hotel's today (it books, then opens that booking on
  Arrivals, where front desk's own check-in runs).
- **The Booked card** (`flows/BookedCard.tsx`) after Confirm: references and
  rooms (a picked room goes through front desk's `assignRoom`), Confirm the
  booking (if waiting), the guest's page link (`POST /stays/:id/guest-link`),
  Send voucher once (guest messages' `POST /stays/:id/confirmation`), Check in
  now, Open the booking. A waiting booking shows no link and no voucher.
- **The two lists** (`flows/KeepListDialog.tsx`), opened from beside their
  pickers, only for the owner, an administrator or the GM.
- **The stay panel** (front desk's `StayActions`) offers "Confirm the
  booking" on a waiting booking, and "Cancel this booking" in place of Void
  (`flows/CancelWaitingFlow.tsx`, D27-64); All bookings labels it "Waiting for the
  hotel" (front desk's `StayTable`).

| Method | Path | File | What |
|---|---|---|---|
| GET / PUT | `/:code/sales-people` | `desk.ts` | the group's list; saved whole, a name left out is switched off |
| GET / PUT | `/:code/room-promotions` | `desk.ts` | this hotel's list, name and percent |
| POST | `/:code/stays/:id/confirm` | `desk.ts` | waiting -> confirmed, every waiting room of its group |
| POST | `/:code/stays/:id/cancel` | `desk.ts` | waiting -> cancelled with a reason, every waiting room of its group; no charge, nothing sent, the room free at once (D27-64); the gate's reservation-cancel grant |
|  |  |  | and since 28 Sep a CONFIRMED booking, this room only, under its frozen terms: `dryRun` answers `{ preview: { terms, charge } }` (charge null = no terms, 0 = free window); the retention goes on its bill; `waive` for owner/admin/GM (BK-1) |

`POST /:code/bookings` now also takes `tentative`, `expectedDeparture`,
`salesPerson`, `companyId`, `discount {percent, reason | promotionId}`,
`title`, `nationality`, `address {...}` and a line's `complimentary`, and
answers each booking's `id` and the `status`. All checked in `book.ts`
(`deskTerms`) above the first write. Migration 146: `expected_departure`,
the `discount_*` columns with the rule as a CHECK, `room_promotions`,
`sales_people`, `guests.title`, `guest_documents.state` and `.pincode`.
Tests: `api/test/modules/reservations/newBooking.test.ts` (13),
`db/tests/modules/reservations.sql` (new-booking), and
`newBookingFields.test.tsx`.

## Requests from other services

- **18 September, channel manager:** a booking door a machine can call, in
  process (their request 6). **Done** - the three functions above, migration
  111 (the commission a site sends, and cancelling), and
  `api/test/modules/reservations/channelDoor.test.ts`.
- **18 September, channel manager:** a reservation that keeps each night's own
  price (their request 7, the owner's D17-82). **Open** - it needs the night
  audit to post from those rows where they exist, so it lands with that
  change, not before.

- **27 September, reservations to the MASTER (core):** the `Stay` type's
  status union (`src/data/repositories/types.ts`) has no `tentative`, which
  the stays API does answer for a booking waiting for the hotel. `StayActions`
  compares it through a cast until the union has it. `StatusPill` and the
  tape chart (`StayView.tsx`) have no colour or word for it either.

Another service's agent that needs a change here writes it in this list —
what, why, who asked, the date — and the reservations agent does it.
