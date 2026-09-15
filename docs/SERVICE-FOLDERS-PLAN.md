# One folder per service — the plan (15 September 2026)

**Status: PLANNED. Nothing has moved. Four decisions are waiting on the owner
(end of this file). Do not start before they are answered.**

The owner's request, 15 September: split the code so each segment of the hotel
system — front desk, reservations, housekeeping, inventory, CRS, reports, POS
and the rest — lives in its own folder, so one agent can be given one segment
and several agents can run at once. Also a folder for each service a hotel
system offers, including the ones not built yet.

The owner's page: https://claude.ai/artifact/2hxwNWXdAC9DpfitP935xR (private;
everything on it is in this file).

---

## What the code is today

Sorted by kind of file, not by service. Counted 15 September:

```
src/pages/                  51 screens
src/components/flows/       24 dialogs and panels
src/data/repositories/      22 data files, one barrel imported by 79 files
api/src/routes/             26 server files, mounted by hand in server.ts (27 mounts)
db/migrations/              89 files, one fixed order, replayed on every deploy
db/tests/suite.sql          5,867 lines — every database check
src/App.test.tsx            881 lines — most screen tests
```

---

## The services

Folder names are the same in the web app, the server and the database checks.

| Service | Folder | Screens | Server | Leans on |
|---|---|---|---|---|
| Front desk | `front-desk` | Rooms, Calendar, Arrivals, In house, Due out, Walk-ins; check in/out, moves, exchanges, the stay panel | stays, stayExtras, front-desk half of operations (9 endpoints) | finance (Bill tab), housekeeping (room status) |
| Reservations | `reservations` | New booking, All bookings, Groups | groups, booking creation | inventory, guests |
| Housekeeping | `housekeeping` | The board, assignments, Work orders, out of service | housekeeping; room status and blocks from property | rooms list |
| Inventory and rates | `inventory` | Room types and rooms, Rate plans, Rate calendar, Rate performance, restrictions, promotions, Cancellation terms | rates; room setup from inventorySetup | — |
| Guests and companies | `guests` | Guests, Companies and agents, Booking sources, ID capture, Form C | bookingSources; guests/companies from directory; Form C from invoices | reservations (read) |
| Finance | `finance` | Folios, Payments, Invoices, credit notes, Cashiering, Company accounts, tax rules | folios, invoices, payments; money half of operations (8 endpoints) | — (others post into it) |
| Night audit | `night-audit` | Night audit | nightAudit | front desk, finance, POS — alone because it is the worst to break |
| Restaurant (POS) | `pos` | Tables, Till, Terminal, Kitchen, Menu, Close restaurant day, Docket, the POS bill, Charges to rooms | till (3,555 lines), pos bridge (`/api/pos`) | finance (charge to room) |
| Banquet | `banquet` | Diary, event, Halls and packages | banquet | POS menu (banquet food, 061) |
| Store | `stores` | Store | stores | — |
| Reports | `reports` | Dashboard, All reports, Manager report, statistics, ledgers, registers | reports, manager, statistics | everything, read only |
| Administration | `admin` | People, Properties, Users, Roles, Settings, Integrations, Audit log, Console, module switches | admin; parts of directory, property, inventorySetup | — |
| Shared core | stays in place | shell, menu, Find a screen, sign-in, design system, session, offline queue, live updates, approvals, notifications, attachments | server, auth, db, env, identity, realtime, storage, businessDate, hotels, live, approvals, attachments | one owner; others ask |

**Not built — a folder with a one-page brief and no code, until the owner asks:**

| Service | Folder | Status |
|---|---|---|
| CRS connection | `crs` | waiting on the CRS's API documents |
| Channel manager | `channel-manager` | parked by the owner; its status page moves here |
| Online payments | `payments` | parked by the owner |
| Booking engine | `booking-engine` | not built; may belong in the CRS — ask first |
| Guest messages | `guest-messaging` | not built |
| Accounting export | `accounting` | not built |

"Inventory" means rooms and prices. The shelves are "Store".

---

## One service, after the move (the restaurant)

```
src/modules/pos/            MODULE.md · index.ts (the only door in) · nav.ts · routes.tsx
                            data.ts · pages/ · flows/ · pos.test.tsx
api/src/modules/pos/        index.ts (mounted by the server) · till/ (in parts) · bridge.ts · test/
db/tests/modules/pos.sql    its database checks
db/migrations/              shared history; a new file needs a CLAIMED number
```

Why three places rather than one top-level folder: the web app and the server
are separate installs, and the server's install is what `deploy/launch.sh`
runs. One folder per service holding both would mean changing both installs
and the live deploy. Why migrations stay one sequence: 001–089 run in one
order every deploy and later ones build on earlier ones across services.

---

## The six mixed server files

Split endpoint by endpoint; the code inside each endpoint does not change.

```
operations.ts      1,965 lines, 17 endpoints  → front desk (check-in/out, walk-ins, assign, move,
                                                 amend, void, early arrival) · finance (charges,
                                                 reverse, payments, cash drawer ×5)
inventorySetup.ts  1,037 lines, 12 endpoints  → inventory (room types, rooms, imports, room setup)
                                                 · finance (tax, menu tax kind) · admin (commissioning,
                                                 front-desk hours)
invoices.ts          645 lines,  7 endpoints  → finance (invoices, series) · guests (Form C)
billing.ts           558 lines,  5 endpoints  → finance (payments, billable) · inventory (rates)
                                                 · night audit · core (notifications)
directory.ts         496 lines,  8 endpoints  → guests (guests, companies) · admin (audit log,
                                                 settings, staff) · inventory (room types, rate plans)
property.ts          442 lines,  7 endpoints  → core (hotel details) · housekeeping (room status,
                                                 blocks) · admin (modules)
```

Found while mapping: `RoomTypesPage` and `RatePlansPage` in
`src/pages/Directory.tsx` are routed nowhere (PENDING).

---

## Shared files that become lists

```
navigation.ts (615 lines)      → each service declares its entries and who sees them
App.tsx (653 lines)            → each service lists its routes
server.ts (27 mounts)          → mounts a list of services
data/repositories barrel       → each service's data file; core keeps api()
App.test.tsx, suite.sql        → tests beside their service
CHANGELOG.md, MEMORY.md        → owner's decision (below)
```

---

## Rules for parallel agents, afterwards

1. **Own copy:** each agent works in its own git worktree and branch. Never two
   agents in one folder on disk (the incident in MEMORY, "Two processes, one
   folder").
2. **Own database and ports:** its own local database and API/web ports.
3. **Claimed in writing:** service, branch and date in HANDOVER's folder claims
   before the first edit. Writes only inside that service.
4. **Other services are asked:** a needed change elsewhere goes on that service's
   Requests list in its MODULE.md.
5. **Guards:** a test fails on a reach into another service's insides (only its
   `index.ts` may be imported) and on two migrations with one number.
6. **Merged one at a time** by the core owner, all gates after each. Deploys stay
   the owner's.
7. **Start with three** agents plus the core owner. The owner's answers are the
   limit.

---

## The order of work (one agent, all others paused; ~2–4 working days)

Every step leaves every gate green and the app working; safe to stop after any.

1. Pause other agents; tag the start; write down every gate count.
2. Guards first: door check (report-only), migration-number check, a database
   test runner that takes several files.
3. Shared files become lists (menu, routes, server mounts, data). No screen moves.
   Done when adding a service needs no edit to a shared file.
4. Move the small services: stores, banquet, reports, admin, guests, inventory,
   housekeeping. One commit each, screens checked.
5. Split the six mixed server files. Server tests follow their endpoints.
6. Move the most connected last: reservations, front desk, finance, night audit,
   POS.
7. Split `App.test.tsx` and `suite.sql` by service.
8. MODULE.md for every service, including the six not built; HANDOVER and
   AGENTS.md learn the new claims.
9. Door guard on; all gates, build, strip-check, screens as Owner, GM, Reception.
   Done when behaviour is unchanged and every count matches step 1.
10. Deploy on the owner's yes, on its own.

---

## Waiting on the owner

1. **How deep:** screens and server per service, database history shared
   *(recommended)* — or one top-level folder per service holding everything.
2. **Which folders:** all, with the six not built as brief-only folders
   *(recommended)* — or only the built ones.
3. **When:** now, before a second agent starts, all others paused
   *(recommended)*.
4. **Notes and mistakes:** each service keeps its own CHANGELOG and MEMORY; the
   root keeps an index and project-wide lessons *(recommended)* — or keep the
   single files.
