# Changelog — Spa

**This service's own log. One entry per working session on this service,
newest first.** Use the entry shape in the root `CHANGELOG.md` ("How to write
an entry"): Asked for · Shipped · Found · Proved · Left open · Commits — and
its three rules: numbers you ran, not numbers you remember; a guard is not
proved until it has refused something; "Left open" is the handover.

Work that touches the core or several services still goes in the root
`CHANGELOG.md`. **Part built since 18 September: the database and the server
are done, the screens are not** (`MODULE.md`).

---

## 2026-09-18 · treatments, therapists and the day diary — database and server

**Asked for:** build the spa, smallest thing that works end to end, in the
brief's order (`docs/briefs/spa.md`) — the switch, a price list, a day diary,
booked by the desk, closed to the room or settled at the spa.

**Shipped**
- `db/migrations/116_the_spa.sql` — **the number is provisional and is the
  master's to give.** `spa_treatments` (name, minutes, price NULL until typed),
  `spa_therapists` (a name, not an account — D18-8), `spa_appointments`
  (against a stay, a time range, snapshotted amount), hotel isolation on all
  three, and three functions: `app.spa_conflicts`, `app.book_spa_appointment`,
  `app.spa_diary`.
- `db/tests/modules/spa.sql` — 30 assertions.

**Decisions inside my own lane, with the reasoning in the file's header**
- **A therapist is a LIST, not a text box.** The guard is "this person is
  already busy", and that question cannot be asked of a string somebody typed
  two ways.
- **The length comes from the treatment, not the caller** — a caller that could
  say when it ends could book ninety minutes into a thirty-minute slot.
- **A booking holds the therapist from the moment it is taken**, unlike the
  hall in 060: a hall has enquiries, a telephone booking is the booking. A
  cancellation releases the slot; a treatment already given does not.
- **Every appointment is against a stay** (`reservation_id` NOT NULL). The
  brief excludes the walk-in who is not staying until the owner is asked, so
  the schema cannot express one.

**Found**
- **SPA-1** — the Spa switch is drawn live on Settings and the server answers
  409. Laundry and the channel manager the same. Not my lane; reported.
- **cp6's database suite is already red, without any of my files.** Migration
  115 made `spa` a known module; `db/tests/suite.sql:2097` uses `'spa'` as its
  example of an unknown one. Proved by moving my two files aside and running
  the suite at HEAD. The master's file; reported.
- **`db/migrate.sh --with-dev-identities` prints "✓ local sign-in accounts
  linked" and exits 0 after the step raised an ERROR and linked nothing.**
  MEMORY 274's family, in the master's tooling. Reported.

**Then, on the owner's two answers of 18 September**
- **The spa bills under its own GST rule** — `spa` added to `tax_rules.kind`
  in 116, guarded by what it adds. A property that has not set the rate cannot
  bill a treatment: `app.gst_rate` raises rather than falling back.
- **Reception books; housekeeping looks** — enforced on the server
  (`SPA_READ_ROLES`, `SPA_BOOK_ROLES`, `SPA_LIST_ROLES`), exported through this
  service's door so the test holds them and the menu's copy to the same shape.
  No change to the shared permissions matrix.
- `api/src/modules/spa/spa.ts` — the module gate and nine routes; mounted
  through this service's own `index.ts`, and `server.ts` untouched.
- `api/test/modules/spa/spa.test.ts` — 18 tests, asking in UTC throughout.

**Found in my own work, by my own tests**
- **A permission refusal and a business refusal left this service as the same
  status.** Housekeeping trying to book answered 409, the same as "that hour is
  taken", so no screen could tell "ask your manager" from "that is not
  possible". **403 is "you may not", 409 is "that cannot be done"** now, kept
  apart to the status line.
- **`pms_app` gets DELETE on every new table** from a default ACL, so a grant
  listing three privileges withholds nothing. My assertion caught the claim
  being false the first time I made it; 116 revokes.
- **`app.gst_rate` raises `23514`, not `P0001`** — 067 sets
  `errcode = check_violation` deliberately: a missing rate is a rule nobody has
  set, not a program fault. I had guessed; the test corrected me.

**Proved** — numbers I ran, on the tree as it stands
- `bash db/tests/run.sh` — **30 spa assertions pass** (clock 2, diary 13,
  list 7, money 8). **1 failure, and it is not mine**: `modules · an unknown
  module is refused`, which fails identically at HEAD with my two files moved
  aside — proved that way, not assumed.
- `bash db/tests/rerun.sh` — **all 116 migrations re-runnable**, with a
  property created between the passes (MEMORY 284).
- `cd api; npm test` — **the WHOLE suite, 1067 tests in 65 files, exit 0.**
  Not my file alone: a fixture's damage lands in somebody else's test
  (MEMORY 292). My 18 are in it.
- `npx vitest run` — **369 tests in 42 files, exit 0.**
- `npx tsc -b --force` — exit 0.
- `npm run lane -- spa` — 7 files, 5 mine, 1 nobody's, **1 shared core**:
  `db/migrations/116_the_spa.sql`, said out loud here and to the master.
- **Both guards seen to refuse, with the fault put back in the migration:**
  - a bare `p_starts_local::timestamptz` instead of `app.hotel_moment` —
    eleven o'clock at the hotel became **16:30**, the sixty-minute treatment
    ended at **17:30**, and the stored moment read 11:00 UTC instead of 05:30.
    3 assertions failed. This is root MEMORY 297 exactly, and the test sets
    the session to UTC on purpose so it fails on this laptop rather than in
    Akkalkot.
  - skipping the `spa_conflicts` check so the exclusion constraint answers —
    `23P01 conflicting key value violates exclusion constraint
    "sa_one_therapist_at_a_time"` instead of the sentence naming Priya, the
    guest and the treatment. 3 assertions failed. The overlap was still
    refused; what broke is what the receptionist reads.
  - the DELETE revoke — seen failing before it was written.
  - **the module gate** — disabled, and a property with the spa switched OFF
    answered every route. The switch test failed.
  - **the role check on booking** — removed, and housekeeping booked a
    treatment. That test failed.

**Left open** — every one is somebody else's answer
- **The migration number.** Taken from cp6 provisionally; the master gives it.
- **A front door for posting a charge.** `api/src/modules/finance/index.ts`
  exports no in-process function, and the brief forbids writing
  `folio_postings` here. The master's.
- **Which existing door records money taken AT the spa** — the brief says ask
  before inventing a second way to take a payment.
- **A `spa` section in `src/components/app/navigation.ts`**, gated
  `module: "spa"`, as banquet has. The master's file; laundry needs the same.
- **The screens.** Everything behind them is done and proved; they wait on the
  section above, which is one line in a file only the master may touch.
- **Closing a treatment** (D18-6, D18-7) — the schema carries `settlement`,
  `closed_by`, `closed_at` and `posting_id`, and the routes for it wait on the
  two doors above. Nothing half-written was left in place.

**Commits:** `074526d` — on `spa/phase-1`. The migration number in it is
provisional and is the master's to confirm or renumber at merge.

---

## 2026-09-16 · a folder and a Coming soon page

**Asked for:** the owner, 16 September — "a HMS with all the requested services
which are currently missing in the current system". Asked how, they chose a
folder and a Coming soon page for every missing service, one Coming soon
section for the owner, admins and general managers, on a branch after the
service-folder move.

**Shipped** — this folder: `MODULE.md`, this file, `DEFECTS.md`, `index.ts`
(an empty front door), `nav.ts` (one entry in the Coming soon section),
`routes.tsx` (`/coming-soon/spa`, guarded), `pages/Spa.tsx` (the shared
Coming soon page with this service's words). No server code, no table.

**Proved:** in the root `CHANGELOG.md`, 2026-09-16 — the gates and the
screens opened.

**Left open:** everything the page lists under "What it needs before it can
be built".
