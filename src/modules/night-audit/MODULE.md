# Night audit

Closing the hotel's day: one night's room charge for every guest in house,
the arrivals who never came marked no-show, and the business date moved on.

**Folder name:** `night-audit` — the same word in all three places:

```
src/modules/night-audit/          the screens, their data calls, their tests
api/src/modules/night-audit/      the server's routes for this service
db/tests/modules/night-audit.sql  NEW database checks only — db/tests/suite.sql is frozen history
```

Every screen, address, endpoint, table and number below was checked in the
code on branch `service-folders` at `c804aa2` (15 September 2026), after the
server split and the test split were merged. Where the code could not settle
something, it says so.

## What it is

Late at night a manager opens the Night audit screen. It shows the day being
closed and the one that will open, and a list of pre-flight checks. If a
person still has to decide something — a guest due out who was never checked
out, no tax rule, the desk's cash drawer or the restaurant's till still
open — the Run button stays grey with the reason on it. When nothing is
outstanding they press **Run night audit**, and in one transaction the
server posts tonight's room charge on every in-house stay, marks the
arrivals who never came as no-shows (charging a retention only where the
booking carries terms), and completes the run — which is what moves the
business date on. It never checks anybody out. It is its own service
because it touches front desk, finance and the restaurant, and it is the
worst thing in the system to break.

## Screens

| Menu entry (section) | Address | Page file | Working menu |
|---|---|---|---|
| Night audit (Reports, first) | `/h/:code/night-audit` | `pages/NightAudit.tsx` | none |

One address, one page file. The menu gate is `report` (`nav.ts`). No working
menu lists it: the roles without one — owner, admin, GM, hotel manager,
accountant, viewer — see it in Reports, which for everybody lists only
Night audit, All reports and Manager report (owner, 15 September,
`HANDOVER.md` § 3.2). For reception it is search-only; `navigation.test.ts`
failed when it was planted on reception's list (CHANGELOG 15 September,
step 3).

## Server endpoints

All hang from `/api/hotels`, in two files mounted by
`api/src/modules/night-audit/index.ts` in this order: `checklist`,
`nightAudit`. Both arrived in the server split of 15 September (`489271d`):
`nightAudit.ts` moved whole, and the checklist was cut out of the old
`api/src/routes/billing.ts`.

**`api/src/modules/night-audit/nightAudit.ts`** (was `api/src/routes/nightAudit.ts`)

| Method | Path | What it does |
|---|---|---|
| POST | `/:code/night-audit/run` | close the day (the steps in the file's header, one transaction, one audit at a time per property — an advisory lock, NA-3). Body `{ businessDate }` — the day the screen says it is closing, **required** (400 if missing or not a date). A day already closed: **409 "… was already closed. Reload to see today."** with `alreadyClosed` and the `record` that was made, changing nothing (NA-2, D17-12). A day the property is not on: 409, changing nothing. Records who ran it in `run_by` |
| GET | `/:code/night-audit/runs` | the screen's **Closed days**: the last 60 completed days, newest first — day, who ran it (`app.colleague_name`), started, closed, rooms posted, room revenue, no-shows; null where the record holds nothing (D17-13). Read-only. `api/scripts/capture-demo.ts` reads it too. Since 24 September also `corrections` (how many) and `correctedRevenue`: the audit's room revenue after corrections of the room charges IT posted (a walk-in's check-in line was never in it), null where none (D24-6) |
| GET | `/:code/night-audit/days/:date/charges` | a closed day's charges still standing - every one but payments, refunds and discounts since 25 September (D25-5) - each with its kind (room, no-show, restaurant, or the bill's category), guest, amount, tax, the tax invoice standing on the bill and, for drinks under VAT, the VAT bill standing on it; and the day's corrections (old, new, reason, who, when). Read-only (D22-18) |
| POST | `/:code/night-audit/days/:date/corrections` | **correct a closed day** (D22-18, D24-1 to D24-8, D25-5 to D25-10). Body `{ postingId, newAmount, reason }`; `newAmount` 0 takes the charge off. Refused before any write: no reason (400), a day not closed, older than last month, not a standing charge of that day (a payment, refund or discount never is), a bill with a standing tax invoice ("Issue a credit note instead."), drinks whose VAT bill stands ("Cancel the VAT bill instead.", D25-7), the figure it already has (409). Then one `closed_day_corrections` row, a reversing line and (above 0) the right charge, both ON THE CLOSED DAY and naming the correction. A room charge's GST follows its new figure; every other charge keeps the rate and scheme (GST or VAT) it was charged at (D25-9). The correction keeps `origin`, where the charge first came from, so a corrected restaurant bill stays under the Manager report's "POS to PMS Posting" (D25-10). roleGate: `reservation` · approve (owner, admin, GM, D24-3) |

**`api/src/modules/night-audit/checklist.ts`** (cut from the old `api/src/routes/billing.ts`)

| Method | Path | What it does |
|---|---|---|
| GET | `/:code/night-audit` | the pre-flight checklist the screen reads, and whether the audit may run |

6 endpoints. The checklist imports `blockersFor` from `nightAudit.ts`, beside
it, so what the screen shows and what the run refuses are one function.
Server tests: `api/test/modules/night-audit/nightAudit.test.ts` and `corrections.test.ts`;
`api/test/businessDate.test.ts`, which also closes days, is still in
`api/test/`.

What stops the day closing (`blockersFor`, checked 15 September): a departure
that was never checked out; no tax rule; a front-desk cash drawer still open;
a restaurant till with orders today and no day end.

## What the screen reads, and from where

Written 16 September at `07e7f30`, from `checklist.ts`, `nightAudit.ts` and
`NightAudit.tsx`, so that a fix to how the house is counted (the master's —
"in house" reads four ways across four screens, a paid guest is listed under
BALANCE) can be traced to this screen too. **Every count on the checklist is
this service's own SQL; none comes through another service's front door.** A
fix made elsewhere does not reach them unless it changes these queries.

| On the screen | Source | Worth knowing |
|---|---|---|
| "closing X and opening Y" | X is `BUSINESS_DATE`, learned by the browser at sign-in (core, `src/data/repositories/businessDate.ts`) and sent as `?asOn=`; Y is X + 1, worked out in `checklist.ts` | **the browser's date, not the server's** — NA-2 |
| Arrivals still outstanding | `reservations`: `confirmed`, `check_in = X` | the run marks `confirmed` with `check_in <= X`, so it can mark more than this counts |
| Departures not yet checked out | `reservations`: `checked_in`, `check_out = X` | the same condition as the `departures` blocker |
| In-house folios carrying a balance | `reservations` `checked_in` whose non-reversed `folio_postings` (charges plus tax; payments are negative lines) sum above ₹0.50, per booking across all its folios | **a third copy of "balance"** — not `app.folio_balance` (006), not finance's `getFolioBalance` |
| Room charges to post | `POSTS_TONIGHT` in `nightAudit.ts`, less the complimentary stays | **the run's own text** (QA NA-5, 28 Sep): checked in, an open folio, not day-use, not charged for tonight yet - so it equals the run's "rooms posted" |
| Rooms still marked dirty | `rooms.housekeeping_status = 'dirty'` | |
| Postings reversed today | `folio_postings` with a `reverses_id`, `business_date = X` | |
| The Run button and its reason | `blockersFor(X)` in `nightAudit.ts` | the same function the run refuses with — asked for X, while the run asks for the server's date. Run sends X, and the server refuses it once X is closed (NA-2) |
| Last run | latest completed `night_audit_runs.business_date`, printed by Postgres as `DD Mon YYYY` | a date formatted in SQL, not by `src/lib/format.ts` |
| The result card | the `POST /run` answer: rooms posted, revenue, complimentary, no-shows; the restaurant from settled `pos_orders`, `pos_order_lines`, `pos_order_tenders`; the two drawers from closed `cashier_shifts` and `pos_day_ends` | the answer also carries `retentionCharged` and `noShowsWithoutTerms`; **the card shows neither** |
| "… was already closed" card | the 409 answer's `record` — the same row the Closed days list reads | shown instead of the red failure card: the day IS closed (D17-12) |
| Closed days | `GET /runs`: completed `night_audit_runs`, the name through `app.colleague_name(run_by, hotel)` | "Ran by" is a dash for every day closed before 17 September — `run_by` was never written until then. "Room revenue" is `revenue_posted`: the room charges the audit posted, before tax |

## Data

`src/modules/night-audit/data/`:

| File | What it does |
|---|---|
| `nightAudit.ts` | `getNightAudit` (the checklist, as at the business date), `runNightAudit` (sends the day being closed), `listClosedDays` (the history), `getClosedDay` and `correctClosedDay` (the correction panel, D22-18) |

`components/CorrectDay.tsx` is the correction panel, a drawer opened from each
closed day's **Correct** (owner, admin, GM: `can(role, "approve",
"reservation")`; off for a day older than last month) or, for anybody else,
**Corrections** on a corrected day.

## Database

Tables this service writes (from the SQL in `nightAudit.ts`), and the
migrations that made or changed them:

| Table | What the night audit does to it | Migrations |
|---|---|---|
| `night_audit_runs` | one row per hotel per day: running, then completed (or failed); `run_by` is who pressed Run (written since 17 September) | created `006_folio.sql` (unique per hotel and date — the safety net against a second run); `014_simulation_fixes.sql` (a completed run must carry its finish; the audit writes `running` first, posts, then completes), `016_audit_coverage.sql` (audited), **`100_closed_day_record_needs_gm.sql`** (a completed run is corrected only by the property's owner or GM, or a group administrator — D17-12) |
| `closed_day_corrections` | one row per correction of a closed day: the line, old and new figure, reason, who, when. Append-only; written only by the owner, an administrator or the GM there, or a group administrator (`app.corrects_closed_days`) | **`134_closed_day_corrections.sql`** (D22-18); `139_closed_day_other_charges.sql` adds `origin` (D25-10) — also replaces 012's `app.reject_closed_business_date` with one exception: a line may carry a closed date when it names a correction of the same property and day, posted by someone who may correct it |

It writes into other services' tables, directly in SQL: `folio_postings`
(tonight's room charge per stay, and a retention charge for a no-show whose
booking carries terms — finance's ledger) and `reservations` (status
`no_show` — front desk's and reservations' table).

The rules it lives inside:

- `023_business_date.sql` — `app.business_date()` is the day after the last
  **completed** run (or the hotel's configured date if none has run). The day
  moves when the run completes, not at midnight.
- `012_integrity.sql` — a posting onto a day with a completed run is refused;
  which is why the audit posts while its run is still `running` (014, S3).
- `036_cancellation_terms.sql` and `037_terms_on_booking.sql` —
  `app.retention_for`, and the terms frozen onto each booking.
- `056_group_billing.sql` — `app.folio_for_room_charge` (a group room's
  charge may go to the master bill); `067_tax_rules.sql` — `app.gst_rate`.
- `073_no_show_releases_rooms.sql` — a no-show gives its room back;
  `074_nobody_slept_there.sql` — and does not make it dirty.
- The checks read front desk's `reservations` and `room_assignments`,
  finance's `tax_rules` and `cashier_shifts`, and the restaurant's
  `pos_outlets`, `pos_orders` and `pos_day_ends` (`050_day_end.sql`).

A new migration needs a number claimed in `HANDOVER.md` first; the guard is
`src/test/migrationNumbers.test.ts`.

## Front door

`index.ts` exports nothing yet (`export {};`), and no other service imports
`@/modules/night-audit` (grep, 15 September). Add an export only when
another service needs one, and only through this file.

## Leans on

- On the web: no other service's door. The core only —
  `src/data/repositories/http.ts` (`fetchOr`), `BUSINESS_DATE`, `src/lib/api`.
- On the server and in the database: it reads and writes front desk's,
  finance's and the restaurant's tables, as listed above. A change to any of
  those tables can break the audit without touching this folder — which is
  why a change there is worth a line on this service's Requests list.

## Rules that bind it

- **The night audit is run by a person. It is not scheduled and should not
  be** (owner; `HANDOVER.md` § 4 "earlier"; `PROGRESS.md`, "What the owner
  has decided" — "a hotel that forgets simply stays on yesterday, which is
  safe and visible").
- **Never deploy during the night audit** (`HANDOVER.md` § 9); production
  deploys are the owner's (`HANDOVER.md` § 5).
- **It will not check anybody out** — a guest still due out is a question
  for a person, so it refuses and names the rooms (`nightAudit.ts` header).
- **A hotel's date moves when its night audit completes, never with the
  clock** (MEMORY 19; 023).
- **No default prices; a missing figure is a dash, never a zero.** A run that
  failed before posting anything shows a dash for rooms and revenue, not 0
  (the `runs` endpoint); a no-show is charged only what its booking's terms
  say, and those without terms are counted apart, never invented
  (`HANDOVER.md` § 5; MEMORY 81).
- **Glossary:** the screen uses the `nightAudit` line of
  `src/lib/glossary.ts`; that line and the `noShow` line are checked against
  `nightAudit.ts` and 073 — change what the audit does and change the lines
  (`glossary.ts` header; `HANDOVER.md` § 3.3).
- **With the line down** the night audit is refused — it closes the day for
  the whole property and needs the server (`src/lib/offline.ts`, core).
- **One main action per screen**: "Run night audit" is the one primary; it is
  shown disabled with its reason, never hidden (`MASTER.md` § 2, Rule 6).
  Any new dialog must pass `src/components/ui/primaryAction.test.ts`.
- **A shorter menu keeps everything reachable by search** (owner,
  15 September).

## Open items

From `PENDING.md` and `HANDOVER.md`, and one found while writing this brief:

- **The printed Night Audit report does not exist** — the audit runs; the
  owner's four-page, 13-section report is part of staff-first phase 2,
  **ask first** (`HANDOVER.md` § 3.4; `docs/REPORTS-SPEC.md`).
- **`GET /:code/night-audit/can-run` was removed** on 17 September (the owner's
  D17-42): no screen ever called it. Whether a day may close is the checklist's
  `canRun`, which now carries the `blockers` too, and POST /run obeys the same
  `blockersFor`.
- **Closed days corrects every charge, never money** (D25-5, 25 September). A
  payment, refund or discount on a closed day is not changed anywhere; the
  desk's Reverse says to put the difference right today (D25-11). A
  restaurant bill is corrected on the room bill only: the restaurant's own
  bill, its closed day end and its sales lines stay as rung (D25-6).
- **The audit's record itself is never rewritten** by a correction (D24-6);
  100 still lets the GM change it in the database, and no screen does.
- **A web test cannot see a refusal's payload** — the shared stub drops it
  (NA-4, core, reported to the master).
- **Defect 243's shape in these routes has not been checked** — a refusal
  written below a write keeps the write (PENDING § 2 and § 5).
- **Found while writing this brief:** the old `billing.ts` header saying
  "THE NIGHT AUDIT DOES NOT RUN" stayed behind in finance's
  `api/src/modules/finance/billing.ts` when the checklist moved here — it is
  finance's to fix (FIN-1 in `src/modules/finance/DEFECTS.md`).

## Gates

Before the first edit: claim this service in `.claims/night-audit.md` (since
16 September — no longer in `HANDOVER.md`), and work in your own worktree with
your own database and ports — how, in `AGENTS.md` ("Before your first write"); the
rules for parallel agents, in `docs/SERVICE-FOLDERS-PLAN.md`.

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
- `src/components/app/navigation.test.ts` — keeps Night audit off
  reception's working menu.
- `src/components/ui/primaryAction.test.ts` — every dialog declares its main
  action.
- `api/test/modules/night-audit/nightAudit.test.ts` — "closing a day",
  "no-shows", "a day cannot close over an uncounted drawer" and the rest. A
  test that runs the audit twice closes two different days (MEMORY 27).

## Requests from other services

None yet.

Another service's agent that needs a change here writes it in this list —
what, why, who asked, the date — and the night audit's agent does it.
