# Inventory and rates

What this hotel has to sell — its room types and rooms — and what each costs,
on which dates, under which terms.

**Folder name:** `inventory` — the same word in all three places:

```
src/modules/inventory/          the screens, their data calls, their tests
api/src/modules/inventory/      the server's routes for this service
db/tests/modules/inventory.sql  NEW database checks only — db/tests/suite.sql is frozen history
```

Before your first edit: read `docs/briefs/inventory.md`, claim the service in
`.claims/inventory.md` (one file per service, since 16 September — not
`HANDOVER.md`), read this file, then this folder's `DEFECTS.md` and
`CHANGELOG.md`. Written 15 September 2026 from the code at `880a5b6`; brought
up to date 16 September (INV-3, INV-5, INV-6).

"Inventory" means rooms and prices. The shelves are the Store — the `stores`
service (`docs/SERVICE-FOLDERS-PLAN.md`).

---

## What it is

The person setting up a hotel enters its room types (who they sleep, what
they cost on the rack) and its rooms, by hand or from a file. The revenue
manager then sets prices: rate plans per room type and meal plan, seasons
over date ranges, a price for a run of dates typed straight onto the rate
calendar, extra adults and children, and restrictions — stop sell, closed to
arrival or departure, minimum and maximum nights. The hotel writes down its
cancellation terms and may mark one as the default; the terms freeze onto
each booking. "Rate performance" compares the rack rate with what rooms
actually sold for, fourteen days out.

---

## Screens

| Menu name | Address (`routes.tsx`) | Page file | Working menus (`nav.ts`) |
|---|---|---|---|
| Room types | `/h/:code/room-types` | `pages/RoomSetup.tsx` | none |
| Rate plans | `/h/:code/rate-plans` | `pages/RatePlans.tsx` | none |
| Cancellation terms | `/h/:code/cancellation-terms` | `pages/CancellationTerms.tsx` | none |
| Pricing | `/h/:code/pricing` | `pages/Pricing.tsx` | none |
| Rate calendar | `/h/:code/grids` | `pages/Grids.tsx` | none |
| Rate performance | `/h/:code/rates` | `pages/Rates.tsx` | none |
| — routed nowhere | — | `pages/UnroutedLists.tsx` (`RoomTypesPage`, `RatePlansPage`) | kept, pending the owner |

- The first three sit in the menu's **Configuration** section, the last three in
  **Inventory**. Room types needs the `room_config` grant; the others the
  `rate` grant (the default test, no `canSee`) — **except Pricing and the Rate
  calendar**, which carry `canSee: setsRates` and a `RequireAccess` route
  guard: they set prices, and `rate: READ` is reception's grant. Who may:
  `RATE_SETTER_ROLES` in `src/lib/permissions.ts` (the master's file — owner,
  admin, GM today; the revenue manager is being added). The Rate calendar was
  closed on 16 September on the owner's approval (INV-5). **Rate plans still
  writes prices and is still open to `rate: READ`** — see INV-5 "Still open".

**Pricing (16 September)** — one base figure, Deluxe · one person · room only,
and every other price a difference from it in rupees, with dates. Migration
090, `api/src/modules/inventory/pricing.ts`, `data/pricing.ts`. The plan and
every decision behind it: `docs/PRICING-PLAN.md`. A price says what it covers
(`rates.covers_persons`), which is how nothing already sold was repriced.
- No working menu lists any of them. Owner, admin, GM, hotel manager, finance
  and read-only see them where their permissions allow; others reach them by
  Find a screen, if allowed.
- The Room types page also carries three pieces that belong elsewhere:
  `CommissioningCard` (admin — what the property still needs),
  `TaxRulesCard` (finance — GST rules), and "The front desk's hours"
  (check-in and check-out times and early/late charges — the form is here,
  and so is its server endpoint).

---

## Server endpoints — 27

The code is in `api/src/modules/inventory/` (moved 15 September):
`rates.ts`, `inventorySetup.ts`, `pricing.ts` (16 September), and the parts
split out of two mixed files — `rateGrid.ts` (from billing.ts) and
`roomTypesAndPlans.ts` (from directory.ts). The door `index.ts` mounts all
five at `/api/hotels`. `rateSetters.ts` holds no route: it is `setsRates`, the
server's answer to "may this person set a price here" (INV-5), and its list is
a copy of the website's held together by a test.

**Only `PUT /:code/rate-grid` asks a role.** Every other write here is guarded
by RLS alone, which asks which hotel, not who (PMS-2; INV-5 "Still open").

`rates.ts` — 13:

```
GET    /:code/rate-plans                          the rates board
PUT    /:code/room-types/:id/rate                 a room type's rack rate
POST   /:code/rate-plans                          a season on a plan
DELETE /:code/rate-plans/:id
GET    /:code/cancellation-policies
POST   /:code/cancellation-policies
DELETE /:code/cancellation-policies/:id           retire one
PUT    /:code/cancellation-policies/:id/default   the property's own default
GET    /:code/inventory                           rooms left, by type and date
GET    /:code/rate-grid                           price per type, plan and date
PUT    /:code/rate-grid                           set a price on a run of dates (app.set_rate) —
                                                  RATE_SETTER_ROLES only, 403 otherwise (INV-5)
GET    /:code/tariff                              a stay's price, extra persons included — used by New booking
POST   /:code/restrictions
```

`inventorySetup.ts` — 8 of the original file's 12:

```
POST   /:code/room-types
PATCH  /:code/room-types/:id
POST   /:code/rooms
PATCH  /:code/rooms/:number
POST   /:code/room-types/import
POST   /:code/rooms/import
GET    /:code/room-setup
PATCH  /:code/front-desk          check-in and check-out times, early and late charges
```

(The other four went to finance — `GET /:code/tax`, `PUT /:code/tax/:kind`,
`PATCH /:code/menu-categories/:name/tax-kind`, in `finance/tax.ts` — and to
admin — `GET /:code/commissioning`, in `admin/commissioning.ts`. The plan had
given the front desk's hours to admin; the split kept them here, with the
form.)

`pricing.ts` (16 September, migration 090) — 4:

```
GET    /:code/pricing                             the base, the differences, and a price per date
PUT    /:code/pricing/basis                       which room type and meal plan is the base
PUT    /:code/pricing/base                        the base price, for a date or a range
PUT    /:code/pricing/offset                      a difference from the base, in rupees
```

`rateGrid.ts` (split out of billing.ts) — 1:

```
GET    /:code/rates                               Rate performance: rack against achieved, by date.
                                                  An unpriced type's rack is null, never 0 (INV-3)
```

`roomTypesAndPlans.ts` (split out of directory.ts) — 1, read only by the routed-nowhere room-type list:

```
GET    /:code/room-types                          the old room-type list. Rack null when unpriced (INV-3)
```

(`GET /rate-plans`, the old meal-plan list, was removed on 16 September — it
could never run, INV-1.)

`/rates` and `/rate-plans` are two questions on two paths on purpose: the
older `/rates` route (`rateGrid.ts`, out of billing.ts) wins any collision
because it is mounted first (MEMORY 70) — an order the server split kept. Grep the route table before adding a route.

---

## Data

```
data/rates.ts          getInventory, getPriceGrid, setRate, setRestriction, getTariff.
                       getInventory and getTariff are the front door's exports.
data/rateSetup.ts      getRates, setRackRate, addRate, removeRate; cancellation
                       policies — list, add, retire, set the default. Split out of
                       the old admin.ts on 15 September.
data/rateGrid.ts       getRateGrid — Rate performance. Split out of the old billing.ts.
data/roomSetup.ts      getRoomSetup, addRoomType, amendRoomType, addRoom, amendRoom,
                       amendFrontDesk, importSetup.
data/unroutedLists.ts  listRoomTypes, listRatePlans — for the two screens no address
                       reaches. Split out of the old directory.ts.
```

No `lib/`, `components/` or `flows/` in this folder.

---

## Database

```
room_types, rooms                  003_rooms.sql
  rate can't be negative           016_audit_coverage.sql
  smoking, connecting rooms        043_indicators.sql
  base_rate NULL until set         032_no_default_prices.sql (the templates lost their prices)
  extra adult / child rack rates   057_extra_persons.sql
rates                              033_rates.sql  (rates_no_overlap; app.rate_for)
  extra adult / child per season   057_extra_persons.sql  (app.tariff_for; app.set_rate)
  the grid from one definition     052_rate_grid.sql  (app.rate_grid)
  writing a price onto the grid    053_set_rate.sql  (app.set_rate, rearranges seasons)
cancellation_policies              036_cancellation_terms.sql  (app.retention_for)
  terms freeze onto the booking    037_terms_on_booking.sql  (trigger reservations_freeze_terms;
                                   a property-chosen default)
rate_restrictions                  044_restrictions.sql  (app.sellable_rooms — the denominator
                                   of every occupancy figure)
pricing_basis, rate_offsets        090_pricing_basis.sql  (app.price_for; rates.covers_persons)
meal_plans                         011_model_additions.sql — read, not written
```

**What "sellable" means here: a room is out when a `room_blocks` row covers
the date** (inclusive at both ends), or when the room is retired. The room's
own `housekeeping_status` is NOT read — proved on 16 September for every way a
room can be marked, and the reason the Rooms screen and the bell can disagree
(INV-6).

Other services point at these tables: `rooms` is referenced by
`room_assignments` (front desk), `room_blocks` and `housekeeping_assignments`
(housekeeping), `work_orders` and `room_status_log`; `room_types` by
`reservations`; `cancellation_policies` by `reservations.cancellation_policy_id`.
Housekeeping writes `rooms.housekeeping_status`.

**A new migration needs a number from the master chat first** — the sequence
is shared and `src/test/migrationNumbers.test.ts` fails on two files with one
number or a gap. 090 is this service's; do not edit it without telling the
master. 091–093 were assigned on 16 September to reservations and the master.

---

## Front door

`src/modules/inventory/index.ts` exports `getInventory`, `getTariff` and the
type `Tariff` (from `data/rates.ts`). The only importer is
`src/modules/reservations/pages/NewBooking.tsx`.

The server's door, `api/src/modules/inventory/index.ts`, exports only
`mounts` (`roomTypesAndPlans`, `rateGrid`, `rates`, `pricing`,
`inventorySetup`), read by `api/src/server.ts`.

---

## Leans on

- **finance** — `TaxRulesCard` through `@/modules/finance`, on Room types.
- **admin** — `CommissioningCard` through `@/modules/admin`, on Room types;
  and the front desk's hours form posts to admin's `PATCH /:code/front-desk`.

Others lean on this one: reservations — the door, for New booking, and
`app.tariff_for` when a booking is priced (`api/src/modules/reservations/groups.ts`); and
reports — every occupancy figure divides by `app.sellable_rooms`
(`statistics.ts`, `manager.ts`).

---

## Rules that bind it

- **No default prices, anywhere** (`HANDOVER.md` § 5). The group's
  instruction: prices are not fixed, the team updates them, and nothing is
  standard across properties (`033_rates.sql` and `rates.ts` headers; 032).
  A room type's rate is NULL until somebody sets it, and every screen shows a
  dash — never a zero, which would be a claim the room is free
  (MEMORY 63, 65, 246). `Number()` on a nullable price is a default price in
  disguise (MEMORY 246).
- **A property-chosen default is not a shipped default.** A hotel may mark
  its own written terms as the default; the system ships none (037;
  MEMORY 81). Terms freeze onto the booking by trigger, however it is made.
- **One definition per rule.** The rate grid reads `app.rate_for`, and
  `app.set_rate` owns every write of a price — because the channel manager
  would price dates too (MEMORY 96). Every `create function` drops every
  signature it will ever have, and every `COMMENT ON FUNCTION` carries its
  argument list (MEMORY 117).
- **Grep the route table before adding a route** — Hono answers with the
  first registration on a path (MEMORY 70, 118; INV-1).
- **The menu label, the page heading and the browser tab say the same words**
  (`HANDOVER.md` § 6) — the Rate calendar does not yet ("Inventory and
  rates"), and Room types, changed on 17 September, has no test holding it
  (INV-2).
- **Every list draws four states**; **a new dialog declares its main action**
  — `src/components/ui/primaryAction.test.ts`, proved by naming
  `RoomSetup.tsx:385` (CHANGELOG 2026-09-15 step 2).
- **Offline, a rate or room write is refused** — none is listed in
  `src/lib/offline.ts`.
- **Inside `withSession`, a refusal is a commit** (MEMORY 243). These routes
  have not been checked for it (PENDING § 2) — except `PUT /:code/rate-grid`,
  whose role check is the first thing it asks.
- **Who may set a price is `RATE_SETTER_ROLES`**, on the screen AND on the
  server (INV-5). The server's copy is in `rateSetters.ts` and a test holds it
  to the website's; a role added to one is added to both, in one commit.
- **The channel manager is parked** (owner, 8 September — CHANGELOG). The
  rate calendar is what one would push; nothing here sends prices anywhere.

No Start here card and no glossary line names anything in this service.

---

## Open items

From `PENDING.md` and `PROGRESS.md`, as of 15 September:

- **The demo's rates are what the hotel is selling** — Deluxe 3,699,
  Superior 4,099, from `load-demo.ts`, not the hotel. The owner's to confirm or
  replace (PENDING § 2; PROGRESS "Still needing a person" 4).
- **Names, rooms and rates for six of the seven properties** — only 5 Elements
  Akkalkot is configured (PROGRESS "Still needing a person" 10).
- **Cancellation terms per property, if any** — the screen is built and ships
  empty (PROGRESS "Still needing a person" 11).
- **`RoomTypesPage` and `RatePlansPage` are routed nowhere** — kept, not
  deleted, pending the owner (PENDING § 5a).
- **The same chart icon on six menu entries** — Rate performance is one of
  them (PENDING § 5a).
- The plan's table lists "promotions" under this service. The only promotions
  in the code are the restaurant's (`pos_promotions`, 083) — none for rooms
  (checked 15 September).
- Found while writing this brief (15 September): **INV-1** — `GET
  /api/hotels/rate-plans` can never run; **INV-2** — Room types is headed "The
  house" and Rate calendar "Inventory and rates". Both in this folder's
  `DEFECTS.md`.

---

## Gates

```
web       npx tsc -b                     clean
          npx vitest run                 all pass (includes src/test/boundaries.test.ts)
server    cd api && npx tsc --noEmit     clean
          cd api && npm test             a scratch database; never `npx vitest run`
                                         inside api/ (MEMORY 196, 221, 264)
          cd api && npm run strip-check  the server's loader can parse every file (MEMORY 209)
database  db/tests/run.sh                a scratch database, dropped after
```

The guard this folder must respect: `src/test/boundaries.test.ts` — another
service reaches this one only through `index.ts`, and this one reaches others
only through theirs.

Where the checks are today, `api/test/modules/inventory/`:

```
inventory.test.ts     the inventory grid, restrictions, the rate grid, the tariff,
                      what a property still needs, importing rooms
pricing.test.ts       the base and the differences (090)
unpriced.test.ts      an unpriced room type is null on /rates and /room-types (INV-3)
outOfService.test.ts  what the inventory subtracts, every way a room is marked (INV-6)
rateSetters.test.ts   who may set a price on the Rate calendar, every role (INV-5)
```

Database: `db/tests/suite.sql` groups `rates`, `set rate`, `rate grid`,
`restrictions`, `extra persons`, `cancellation terms`, `inventory`, `no shipped
prices` (frozen), and `db/tests/modules/inventory.sql` for everything new
(090). Web: `src/modules/inventory/inventory.test.tsx` — who reaches Pricing
and the Rate calendar, and the refusal on the page; `src/App.test.tsx` "find a
screen" reaches Rate plans.

---

## Requests from other services

None yet. To ask for a change here, add a line below — date, your service,
what you need and why — and leave the change to whoever holds this
service's claim.

## Requests from this service

- **16 Sep · to the master** — when the revenue manager joins
  `RATE_SETTER_ROLES` in `src/lib/permissions.ts`, add it to
  `RATE_SETTER_ROLES` in `api/src/modules/inventory/rateSetters.ts` in the same
  commit. `api/test/modules/inventory/rateSetters.test.ts` fails until the two
  lists match, and its role loop names the roles by hand, so the new role goes
  there too.
- **16 Sep · to housekeeping, front desk and the master (INV-6)** — releasing
  one of a room's blocks sets the room `dirty` while another block still covers
  today (`api/src/modules/housekeeping/roomStatus.ts`), and the Rooms screen
  reads `status` rather than `blocks` (`src/modules/front-desk/data/stayview.ts`).
  Which record defines "out of service" is the owner's decision first.
