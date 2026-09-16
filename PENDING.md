# What is left

Written 9 September 2026, at the end of phase 2; brought up to date by
the audit of 14 September. This file is the answer
to "what is pending" — it replaces asking, and it is meant to be edited
rather than appended to.

Anything **decided against** is here too, with the reason. A gap nobody
recorded a decision about is a gap somebody rediscovers and re-argues.

---

## 1 · What is live — measured on the box, 14 September 2026

Phase 2 is deployed. The server runs `1f77239`; the frontend is current.

```
fidato-api, nginx, postgresql       active
n8n                                 active, 127.0.0.1:5678 only (local mode)
certbot-renew.timer                 active — dry run passed 14 Sep;
                                    api cert expires 7 Dec 2026
PMS backups                         nightly, 10–14 Sep present
n8n backups                         nightly 03:30, data + key
disk / memory                       17 GB free / 8.7 GB available
n8n.fidatohotels.com                does not resolve yet
```

Transactions were reset on 9 September. Since then: 4 bookings, 4 guests,
5 till orders.

---

## 1a · SECURITY — found 15 September, fixed, DEPLOYED 15 September

**Any hotel manager could take over the owner's login** (MEMORY 263).
"Add somebody" set the password of an account that already existed before
checking whose it was. Live in production since 9 September. Fixed in 088
(`app.require_claimable_address`, asked before Firebase is touched); proved
by API and database tests. **Live since 15 September, 13:09 GMT: closed.**

`demo@fidatohotels.com` holds the owner role at 5EL and its password has been
shared. With 088 live it no longer opens the takeover, but it is still an
owner-role account at 5EL. **The owner's decision, 15 September: leave it
active while testing goes on.** Do not deactivate it unasked.

**Asked, not yet answered (15 September):** change `008_seed.sql` so a deploy
never re-creates the placeholder administrator where a group administrator
already exists (MEMORY 271). Recommended; a small change with a database test.
Until then, preflight catches it and § 9 of `HANDOVER.md` says what to do.

**Checked 15 September, read-only: it was not used.** The takeover needs a
password change, and a password change resets an account's tokens. Of the
project's real accounts, the owner's last reset on 8 September — before the
hole existed — and `demo@fidatohotels.com` and `rozariojaison7@gmail.com`
only at their creation on 9 September. Nothing else was touched but the
two strays below.

---

### Two stray accounts on the live sign-in service — mine, 15 September

`owner@fidato.in` and `pune@fidato.in`, display name "Anybody", created
10:38 GMT by a test run of mine that reached production Firebase (MEMORY
264). Never signed in, linked to no staff row, so they reach nothing — but
they carry a known password. **The owner's decision, 15 September: leave
them for now.** When they go: Firebase console → Authentication → Users, the
two created 15 Sep 10:38 GMT. The test suite can no longer reach Firebase.

---

## 2 · Found in the 14 September audit

### The walk-in desk did not record a channel — defect 242, FIXED, DEPLOYED 15 September

Fixed on the owner's yes, 14 September: migration 085 and the walk-in
route. The deploy back-fills FH-2609-5001 by itself — proved on the local
database, 18 demo walk-ins without a channel to 0, no commission invented,
nothing else touched. A walk-in taken on screen afterwards saved "Walk-in".
Live since the 15 September deploy: both production walk-ins got their channel
(checked read-only after it).

### A refusal after a write keeps the write — defect 243, one route fixed

`withSession` commits a refusal like any other return. Fixed in the walk-in
route, where a refused walk-in left a guest that can never be deleted.
**The other routes have not been checked for the same shape** — and one has
now been found by reading: RES-1 below, the booking form.

### Every backup is on the same disk as the thing it backs up — P0

PMS dumps, n8n data and the n8n encryption key all sit on the boot volume.
One failed disk loses the hotel, the automations and every copy of both.
Off-box storage (OCI Object Storage, or copies pulled to the office) is a
decision for the owner.

### The configuration is still the demo's

```
room rates     Deluxe 3,699 · Superior 4,099     from load-demo.ts, not the hotel
menu           17 items, 20 tables               demo
companies      Agoda, Booking.com, Expedia, ...  channels filed as companies
```

Real bookings are already being taken against those rates. Either they
are the hotel's rates too, or they need replacing — only the owner knows.

### `demo@fidatohotels.com` holds the owner role at 5EL

Re-added after the reset, active, can sign in. The owner role does
everything at that property. Fine for a demo in the owner's hands; not
for a password that has been shared.

### Owner-side, not code

- Rotate the Firebase Admin key — it passed through a chat.
- Put the n8n encryption key in a password manager, off the box.
- `owner@fidato.in` is inactive but still linked to a development login.
- n8n reaches the PMS through the API as its own account — that account
  (`n8n@fidatohotels.com`, Viewer) does not exist yet. The path is proved:
  from inside the n8n container the API answers, refuses without a token,
  and Firebase accepts the web key.
- n8n.fidatohotels.com needs its DNS record. `deploy/n8n.sh` now publishes
  it with the screen locked to the owner's address and the webhook paths
  open (owner's choice, 14 September), and `allow` swaps the address when
  the broadband changes it. Proved in a throwaway nginx on the box; the
  domain path itself has never run there.

---

## 2a · Found while writing the service briefs, 15 September — NOT FIXED

The agents who wrote each service's `MODULE.md` read its code end to end and
found these. Each is recorded in that service's `DEFECTS.md`; none is fixed,
because each changes what somebody sees and is the owner's to decide. Most
urgent first.

- **RES-1 · a refused booking can leave records behind** (reservations).
  `POST /:code/bookings` saves the guest — and the group, for several rooms —
  before four of its refusals, and the transaction commits a refusal like any
  other result; in a booking of several room types, rooms saved before a
  later one is refused stay booked. The shape of defect 243. Found by
  reading; not reproduced.
- **REP-2 · the Manager report's year starts on 1 April 2026, typed in**
  (`manager.ts`). Correct until 31 March 2027; wrong from April 2027.
- **REP-1 · Monthly occupancy and Monthly statistics always show August 2026;
  Yearly statistics always 2026** (reports).
- **ADM-2 · Settings and the Properties cards show a flat 2.5% + 2.5% GST**
  that the tax rules (067) replaced, and Settings adds "— demo, not a real
  GSTIN" to every property's GSTIN (admin). A figure the database no longer
  agrees with.
- **ADM-1 · the Audit log names "admin" as the person behind every entry**
  (admin).
- **BQ-1 · a restaurant bill cannot be charged to a banquet function** —
  nothing in the till sets `pos_orders.event_id`; `PROGRESS.md` says it can
  (banquet).
- **INV-1 · `GET /api/hotels/rate-plans` can never run:** the core's
  `GET /:code` answers it first. Harmless today — its only caller is a screen
  no address reaches (inventory).
- **Headings that do not match their menu entries** — Diary opens "Banquet"
  (BQ-2), Room types opens "The house" (INV-2), Rate calendar opens
  "Inventory and rates" and All reports opens "Reports" (REP-3), Companies and
  agents opens "Booking sources", the same name as the real Booking sources
  screen (GUE-1).
- **FIN-1 · a stale comment:** `api/src/modules/finance/billing.ts`'s header
  still says no invoice number is issued and the night audit does not run.

Found by the read-only readiness audit of 15 September
(`docs/audits/2026-09-15-pms-readiness.md`), for the integration plan
(`docs/HMS-INTEGRATION-PLAN.md`); none fixed, each the owner's call:

- **API-1 · the server enforces no role on writes.** `src/lib/permissions.ts`
  is read by the screens only; the API's authorisation is row-level security,
  which scopes by hotel, not by role. A `read_only` account can
  `POST /:code/bookings` and `PUT /:code/rate-grid`. The role matrix shown in
  Administration → Roles is not what the API enforces. Its own project, after
  the integration wires (plan decision D12).
- **INV-3 · two responses turn an unpriced room into ₹0:** `GET /:code/rates`
  (`rateGrid.ts:97`) and `GET /:code/room-types` (`roomTypesAndPlans.ts:66`)
  do `Number(null)`. The owner's rule broken on the wire; a channel manager
  reading either would push ₹0. Two one-line fixes (plan step 1.5).
- **RES-2 · the booking reference is generated without a lock, in two copies
  (`groups.ts:397-401`, `operations.ts:939-942`), with a hard-coded `FH-`
  prefix and the server's calendar date;** `app.next_reference` (005,
  advisory-locked) has no caller. Two bookings in the same second lose one to
  a 500. One locked generator, prefix from `hotels.code` (plan step 1.3).
- **RES-3 · `POST /:code/bookings` has no idempotency** (062 covers work
  orders and banquet events only); a retried request books twice (plan step
  1.3). And RES-1 is worse than written above: in a booking of several room
  types, the first type's rooms are confirmed with open folios before the
  second type is refused.

Marked unverified by the briefs, worth a look: `getFolioBalance` returns 0
for a stay with no bill, and check-out and In house read it; `WalkInFlow.tsx`
holds a third `const USER = "front desk"` (MEMORY 256 names two);
`GET /:code/night-audit/can-run` and `/runs` have no screen calling them;
`GET /:code/groups` stayed in front desk's `stays.ts` though groups are
reservations' (the owner's call); `pages/Pos.tsx` has two headings.

## 2c · Found in the route and screen audit, 16 September — NOT FIXED

Every route called and every screen opened against the local copy;
production read read-only. The audit is
`docs/audits/2026-09-16-routes-and-pending.md`.

- **PEO-1 · the People screen has no route guard.** `/people` opens for a
  reception clerk and shows Add somebody, Give a property, Password, Edit and
  Deactivate. Its menu entry needs the `user` grant, which reception does not
  have, so the entry is hidden — but `src/modules/admin/routes.tsx` mounts the
  page without `RequireAccess`. A clerk sees only their own row (the database
  scopes it) and every button is refused by the server, so nothing leaks; it
  is the rule that the screens and the guard must agree, broken. **One line:
  wrap it, and `App.test.tsx` covers it.**
- **POS-2 · two restaurant add-on routes are unreachable.**
  `POST /:code/till/addons/:id/on` and `/off` (`api/src/modules/pos/till.ts`)
  have no caller anywhere. Menu items can be switched from the Menu screen;
  add-ons cannot. Either the Menu screen gains the switch, or the routes go.
- **API-2 · a clerk can read the audit log and the property settings through
  the API**, though both screens are refused to them (no `audit_log`, no
  `setting` grant): `GET /:code/audit-log` answered 28 KB and
  `GET /:code/settings` answered, as `dev-desk`. The roster and the password
  routes are safe — row-level security hides other people's rows, and staff
  creation is refused ("Only a group administrator may provision a
  property"). The owner's call: should the API refuse what the screens do?
- **POS-3 · the Kitchen screen has no heading.** Every other screen carries a
  `PageHeader`; the kitchen wallboard opens straight into its two columns.
  Deliberate or not, it is the only screen with no `h1`.
- **INV-1 confirmed by running it:** `GET /api/hotels/rate-plans` answers
  404 "No such property" because `GET /api/hotels/:code` is registered first.
  Nothing calls it. Delete it rather than reorder the mounts.

**Also measured:** 214 routes (92 GET, 92 POST, 13 PATCH, 10 PUT, 7 DELETE);
81 GET routes proven answering as the owner, 69 as a clerk; 13 routes with no
caller anywhere (5 attachments, 4 approvals, 2 night-audit, 2 add-ons) plus 5
called by something other than the website on purpose (`/health` and the four
POS-bridge routes); 86 of 89 screen addresses opened and rendered with no
console errors.

## 2b · What the service-folder move leaves

- **Merge and deploy — the owner's.** The move is built and verified on
  branch `service-folders`; `cp6` is still what production runs. The plan says
  deploy it on its own, so anything off can only be the move.
- **The till is 3,555 lines in one file** (`api/src/modules/pos/till.ts`).
  Splitting it into parts matters only if two agents ever work on the
  restaurant at once.
- **The web tests need this machine's root `.env`.** In a fresh copy without
  it, 31 of them fail on the sign-in screen. AGENTS.md says to copy it (the
  website's settings — never `api/.env`); a suite that sets its own would be
  better.
- **The six agents' copies are still in `.claude/worktrees/`** (merged, and
  ignored by git). Each holds a `node_modules` junction into this folder —
  remove the junction before deleting a copy, or the delete can follow it.

## 3 · Deferred by the owner, on the record

### Housekeeping never refreshes itself — defect 218

The board shows the morning as it was when the page loaded. A housekeeper
marks 204 clean on a stairwell landing and the supervisor's screen does
not change until somebody reloads.

Measured: five requests, no duplicates, all under 15 ms. **It is not
slow. It has no refresh of any kind.**

The fix is known and small: extend the Postgres `NOTIFY` trigger from
075 to housekeeping changes, and add `useLiveOrders`-style invalidation
to that screen. The live channel already reaches Floor, Kitchen and Till.

> Deferred on 8 September at the owner's instruction — *"leave this for
> now and keep this in the upcoming files."*

### Attachments — parked, needs architecture

All four uses are in scope eventually. 077 built the table. Nothing
reaches it. **Parked deliberately**, not forgotten: the storage question
(where the bytes live, who may read them, what happens to them when a
guest checks out) has not been decided, and building the screen first
would decide it by accident.

### Channel manager — excluded for now

The **foundation for it is built**: `booking_sources.channel_code` is
what a channel manager will send, unique across the group, and the
source-mix report already counts by source. Connecting one is out of
scope until the owner asks.

### Payment gateway — excluded for now

Said plainly by the owner on 8 September.

---

## 4 · Built and still unreachable

The project's signature defect. Each of these is real work nobody can
use. **They are listed rather than quietly counted as done.**

### The approvals engine — defect 222

```
076_approvals.sql        approvals, approval_rules,
                         app.request_approval(), app.decide_approval()
api/routes/approvals.ts  the queue, the decide endpoint, the rules
─────────────────────────────────────────────────────────────────────
callers of request_approval   NONE
screens showing the queue     NONE
```

`approvals.ts` opens by saying it exists *because* the engine would
otherwise be unreachable. The routes were added; the callers never were,
so the fault moved up a level instead of closing.

Phase 2 was going to wire discounts into it. **The owner replaced that
design with promotions** — a free hand up to 10%, named promotions
beyond it — which is better and is built. So the engine is still
unreachable, and its remaining kinds (`purchase`, `cash_expense`,
`stock_adjustment`) have no path either.

**Decision needed before this is worth building:** does the owner want
purchase and expense approvals at all? If not, the engine should be
deleted rather than left looking finished.

### Twelve seam functions with no caller

Listed in `KNOWN_UNREACHABLE` in
`src/data/repositories/repositories.test.ts`. All are helpers overtaken
by later screens — no capability among them since `setOutletClosed` came
off. The list can only shrink: the gate fails if an entry gains a caller
and stays.

---

## 5 · Gates that do not exist yet

### No reachability gate for API routes — the gap defect 224 names

`repositories.test.ts` fails when a function on the frontend seam has no
importer. It cannot see an **API route with no caller**, which is exactly
how four admin endpoints sat unreachable for months and how the whole
approvals engine still does.

Not built because the route table is not a static list the way
`export function` is — Hono registers them at runtime, so this needs
real work rather than a regex.

**16 September: it has been done once, as a script** (the audit
`docs/audits/2026-09-16-routes-and-pending.md`, § 3): import the app, read
`app.routes` at run time, match each route against every `/api/...` path the
website builds, and check the rest by hand. It found 13 routes with no caller
— including two nobody had recorded. Making it a test is the remaining work:
a `KNOWN_UNREACHABLE` list that may only shrink, exactly like the seam
test's.

### `mayReach` fails open, and only a test stops it now

`RequireAccess` asks the navigation whether a role may reach a path.
`mayReach` returns **true** for a path the navigation does not contain,
so a guarded route whose menu entry is deleted or never written is open
to every signed-in role while still looking guarded. Defect 227.

A test in `App.test.tsx` now asserts that every `RequireAccess` path is
one the navigation knows, and it was proved to fail. **The function
itself still fails open.** Making it fail closed would break any route
whose menu entry is conditional, which is a change to make deliberately
rather than during an audit.

### No gate for a refusal written after a write — defect 243

The walk-in route refused below an insert, and the insert committed. A
static check would have to know which statements write and which `return`
is a refusal inside a `withSession` callback — real work, not a regex, the
same reason the route gate above is not built.

### No gate for `app.*` SQL functions with no caller

Same shape, one layer further down. `app.request_approval` is the live
example.

---

## 5a · The clarity plan — steps 2 to 4 (critique of 15 September)

Scored 22/40 against "a new receptionist manages their first shift without
asking". All four steps are built: 1 (one vocabulary), 2 (one primary
action), 3 (a menu per person) and 4 (help where the question is). The owner chose, 15 September:
Bill at the desk and Folio in Finance; a shorter menu still reaches
everything by search; report names stay, in sentence case.

- **Step 2 · one primary action per screen — done 15 September.** Guarded by
  `primaryAction.test.ts` (a button beside a Cancel must declare a variant)
  and the stay-panel test in `App.test.tsx`. Not covered: the full-screen POS
  terminal (`Terminal.tsx`), which draws its own touch buttons rather than
  `<Button>` — its send action is not yet marked.
- **Step 3 · the menu by person — done 15 September.** Per-role working menus
  (`HANDOVER.md` § 3.2) and "Find a screen" (Ctrl K). **Not built:** searching
  guests and bookings from the palette — it finds screens only, and says so.
  **Worth asking the owner:** the kitchen manager's list has no Store and the
  housekeeping list no Rooms — both approved as listed, both one search away.
- **Step 4 · help where the question is — done 15 September.** Start here
  per role (gone on "Got it", 089, back from the account menu), tap-to-explain
  terms from one glossary, an empty state on every table, Housekeeping's
  loading/error/empty states. **Not run: the plan's own test** — somebody new
  books, checks in, takes a payment and checks out untold. Needs a real new
  person; the owner's to arrange. The waiter's and chef's cards are proved by
  tests only (no local waiter or chef sign-in).
- **Rooms on a phone:** the controls take 376px of an 812px screen before the
  first room (measured 15 September). Start here now scrolls away inside the
  rooms; the controls themselves want a compact phone layout.
- **Dead code:** `RoomTypesPage` and `RatePlansPage` in `src/pages/Directory.tsx`
  are routed nowhere (App uses `RoomSetupPage` and `RatePlansEditor`).
- **Still named, not fixed:** the same chart icon on six menu entries;
  `FolioPanel.tsx` and `CheckInFlow.tsx` still hold `const USER = "front
  desk"` (MEMORY 256).

---

## 6 · Known rough edges, small

- **Two "in house" numbers.** The property page says In house now 11 /
  Vacant 9 where the Dashboard and Rooms say 10 / 7, same moment (14
  September). Two definitions, neither labelled. Needs one, named.
- **The till's reads turn every error into an empty list.** `PosGate`
  (Phase 1) catches the refusal case; a server fault still reads as
  "nothing here" (MEMORY 251).
- **The Manager Report's City Ledger section is all dashes** — it exists,
  but fills only when OTA balances are kept here. The plan's "9 of 14"
  counted it as present; it is present and empty.
- **"Which room was this stay in" is still written out by hand in seven
  queries** — billing (2), directory, reports (2), stays, pos. All seven
  have the RIGHT rule today; 086 made it `app.stay_room()` and moved the
  three that had the wrong one. Moving the seven onto the function is
  tidying, not a fix — but it is how the next wrong copy is prevented.
- **Three tables are owned by `postgres`, the other 63 by `pms_migrate`.**
  `booking_sources`, `booking_source_rates` and `pos_promotions` were
  created by the phase 2 deploy, which ran as the superuser. Harmless while
  migrations run as `postgres`; a migration run as `pms_migrate` that
  alters them will fail with "must be owner".

- **`pos_promotions` has no validity dates.** A promotion runs until
  somebody switches it off. Deliberate — dates were not asked for and
  inventing scope is how a feature stops matching what was wanted — but
  a seasonal offer will want them.
- **The source-mix report does not show commission totals yet.** The data
  is there (`reservations.commission_pct`, stamped at booking). Nothing
  sums it.
- **`hotels.address_line` duplicates city and state** in the demo data —
  the Akkalkot card reads "Akkalkot, Solapur District, Maharashtra
  413216, Akkalkot, MH". Data, not code, and now editable on
  `/properties`.
- **`api/.env` now matters more than it did.** Adding somebody creates a
  real Firebase account, so a deployment without `FIREBASE_SERVICE_ACCOUNT`
  will refuse to add staff rather than silently creating people who cannot
  sign in. The Oracle box already has the key; a new environment needs it
  before People or the property screen will work.
- **Nothing is emailed, anywhere.** There is no SMTP in this deployment,
  so a password is typed by a manager and told to the person.
  `identity.ts` keeps `passwordSetLink` for the day email invitations are
  asked for; the route that called it was removed rather than shipped
  with no caller.
- **`companies` contains channels.** "Walk-in", "Fidato Hotels" and
  "Walk-In" are rows in the corporate-accounts table, left over from
  when the booking form put the companies list in the channel box. They
  are harmless and still offered as Business source. Cleaning them up
  means checking nothing points at them first.
