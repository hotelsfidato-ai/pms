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

## 2026-10-12 · A price added later is for new bookings only; MODULE.md corrected (D27-305 (7), (9))

**Asked for:** the owner's D27-305 (7): the screens stop saying a booking can be closed once the treatment is priced - the price is copied when the booking is taken, so a price added later applies to new bookings only, and one already taken keeps its dash and is booked again. (9): MODULE.md said a treatment could not be closed.
**Shipped:** `SpaDiary.tsx` (the unpriced row; the booking window's note), `SpaSetup.tsx` (Treatments' (i)), and `spa.ts`'s close refusal now say so ("This booking was taken with no price, ... cancel this one and book it again"). `MODULE.md`: Charge to room exists (D18-22), the close route listed, requests 4 and 5 answered.
**Proved:** `spa.test.tsx` 14/14, its unpriced-row case now asserts "applies to new bookings only" - seen failing with the sentence taken out; `api/test/modules/spa/spa.test.ts` 28/28. Opened on a scratch copy of the demo (`fidato_test_15178`, spa switched on there, not on the master's `fidato`): the unpriced row, the booking window with an unpriced treatment chosen, Treatments' (i).
**Left open:** the manual's A13 (on `manual-rest`) quotes the old Modules note; its A13.5 "Watch out" already says pricing later does not change the booking.

## 2026-09-28 · Fix round F (QA leftovers, D27-149): the screens with the module off (QA X-5)

**Asked for:** QA X-5. Branch `fix/leftovers-28sep`, copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Shipped:** Treatments and therapists with the spa off reads one sentence, "Treatments and therapists is not available" and the server's reason, as Halls and packages does (was two cards, "The treatments is not available", with Add buttons). The page's description and the therapists' empty line lost their long dash. Wording only, no test.
**Proved:** web spa tests passed; seen on screen with the module off in fidato_s30.

---

## 2026-09-24 · SPA-2: the matrix names the server's six

On `admin/finish-24sep` (the helper's `admin/hotel-admin-menus`, finished):
`spa` is off the accountant and the viewer in `api/src/permissions.ts`, and the
diary's entry reads the matrix again (`SEES_THE_DIARY` gone). **Proved:**
`api/test/modules/spa/spa.test.ts` holds the matrix to `SPA_READ_ROLES`;
`navigation.test.ts` "offers the spa diary to exactly the server's six" fails
with the accountant's grant put back (seen 24 September). Screen:
`.local/screenshots/2026-09-24-admin/06-accountant-no-spa-*`.

---

## 2026-09-19 · the screens: a day diary, a price list, and a booking taken by telephone

**Asked for:** the screens, and only the screens. The database and the server
were done and merged on 18 September; what a person could see was still the
Coming soon page.

**Shipped** — everything inside `src/modules/spa/`
- `data/spa.ts` — the typed client for all nine routes, the menu's copy of the
  server's three role lists, and `clockTime` / `clockDate` / `shiftDay`.
- `pages/SpaDiary.tsx` — therapist by therapist, one day at a time, with the
  booking and the cancellation.
- `pages/SpaSetup.tsx` — treatments (name, how long, price) and therapists.
- `nav.ts` — two entries in the `spa` section the master wrote, `module: "spa"`,
  so the whole service is absent where the switch is off. The Coming soon entry
  and `pages/Spa.tsx` are gone: a service that is built cannot also be coming
  soon.
- `routes.tsx` — `/h/:code/spa` and `/h/:code/spa/setup`, both guarded.
- `spa.test.tsx` — 14 tests.

**Decisions inside my own lane, with the reasoning in the files**
- **The times are read as STRINGS, not parsed.** `app.hotel_clock` writes
  `YYYY-MM-DDTHH:MM` with no offset, so `format.ts`'s `dateShort()` and
  `timeOnly()` — which call `new Date()` first — would read the property's day
  in THIS browser's zone. `clockDate` and `clockTime` slice; `shiftDay` does
  its arithmetic in UTC. Proved by running the whole file in
  `TZ=America/New_York`.
- **The guest list is who is HERE OR COMING**, not who is in the house. The
  server refuses a cancelled or checked-out stay and accepts everything else,
  and a stricter rule here would be this screen inventing one. Found by opening
  the dialog on the demo property, where nobody is checked in and the list came
  back empty.
- **`canSee` reads the SERVER's role lists, not the permissions matrix.** The
  matrix gives finance and a viewer `spa: view`, which the server does not — so
  the matrix would have put a Spa section in two people's menus that answers
  403. **SPA-2**, reported; theirs to settle.

**Found**
- **SPA-2** — `src/lib/permissions.ts` and `api/src/modules/spa/spa.ts`
  disagree about finance and `read_only`. Not my lane; worked around in `nav.ts`
  and written down.
- **`src/components/app/navigation.test.ts` fails on this change**, in two
  assertions that name the Coming soon page this service no longer has. The
  master's file; the laundry chat needs the identical edit.
- **`db/migrations/119_the_spa.sql` had never been applied to the development
  database `fidato`.** The screens answered 500 until it was. Applied here,
  additively, and the spa switched on for 5EL by hand — because **SPA-1** is
  still open and the Settings switch still answers 409.
- **`addDays` in `src/modules/banquet/pages/Banquet.tsx` is off by a day** at
  every property east of Greenwich. Not my lane; written down below.

**Proved** — numbers I ran, on the tree as it stands
- `npx vitest run src/modules/spa` — **14 tests, exit 0**, and **again with
  `TZ=America/New_York`, 14, exit 0.**
- `npx tsc -b --force` — exit 0.
- **Every screen opened**, signed in through the DEVELOPMENT ONLY buttons at
  `localhost:5173`, against the live API and database: the diary empty, the
  diary with a booking, the price list, both dialogs, at 1280px and at **375px
  with no horizontal scroll**.
- **A booking taken end to end**: Rohit Deshpande, Aromatherapy massage, Priya,
  11:00 → the diary drew **11:00 AM → 12:00 PM, ₹2,500**. Eleven at the hotel,
  eleven on the screen.
- **Guards seen to refuse, each broken and put back:**
  - the unpriced dash → `money(t.price ?? 0)`: the test failed, and ₹0.00
    appeared where "-" belongs.
  - the server's own sentence → `setProblem("That time is unavailable.")`: both
    refusal tests failed.
  - `shiftDay` → banquet's `new Date(\`${on}T00:00:00\`)` version: **"2026-09-20"
    came back as "2026-09-19"** on this machine.
  - `clockDate` → parsing through `new Date`: under `TZ=America/New_York` the
    property's **19 September read as 18 September**.
  - `mayBook` → `true`: housekeeping was offered the booking button, and the
    test failed.
  - **the module gate, on the real screen**: `spa` switched off in the database,
    and the diary showed the server's own sentence — *"This property has no spa.
    Turn it on in the property's settings if that is wrong."* Switched back on.
  - **the role guard, on the real screen**: signed in as Housekeeping —
    the diary drew, with no Book, no Cancel and no price list, and
    `/h/5EL/spa/setup` was refused outright.
  - **the cancellation reason, on the real screen**: Cancel with an empty box
    returned the server's *"Why is it cancelled? This is the line somebody asks
    about."*
  - **the overlap, on the real screen**: a second booking for Priya at 11:30
    was refused with the DATABASE's own sentence — *"Priya is already with
    Rohit Deshpande: Aromatherapy massage at 27 Aug 11:00"*.

**Left open** — none of it is mine to do
- **CLOSING A TREATMENT IS NOT BUILT, and nothing half-built was left behind.**
  `api/src/modules/spa/spa.ts` has no close route: the schema carries
  `settlement`, `closed_by`, `closed_at` and `posting_id`, and `postCharge` has
  been exported from finance since 18 September, but no route joins them. The
  diary SHOWS a settlement where one exists and offers no button that would
  answer 404. See MODULE.md's requests.
- **`src/components/app/navigation.test.ts`** — two assertions to edit, the
  master's.
- **SPA-1** — the Settings switch still refuses `spa`.
- **SPA-2** — the permissions matrix.

**Commits:** on `cp6`, not pushed (the owner, 19 September).

---

## 2026-09-18 · treatments, therapists and the day diary — database and server

**Asked for:** build the spa, smallest thing that works end to end, in the
brief's order (`docs/briefs/spa.md`) — the switch, a price list, a day diary,
booked by the desk, closed to the room or settled at the spa.

**Shipped**
- `db/migrations/119_the_spa.sql` — **the number is provisional and is the
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
  in 119, guarded by what it adds. A property that has not set the rate cannot
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
  being false the first time I made it; 119 revokes.
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
  `db/migrations/119_the_spa.sql`, said out loud here and to the master.
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
