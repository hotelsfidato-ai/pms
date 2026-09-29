# Night audit — changelog

This service's own log, newest first. One entry per working session, in the
same shape as the root `CHANGELOG.md` ("How to write an entry"): **Asked
for · Shipped · Found · Proved · Left open · Commits** — numbers you ran,
not numbers you remember. Work that spans several services, or the whole
project, still goes in the root `CHANGELOG.md`.

---

## 2026-09-28 · Fix round F (QA leftovers, D27-149), part B: the screen guarded by its menu entry

**Shipped:** `routes.tsx`: `RequireAccess` (resource `report`), as round B guarded the reports: the server refuses its reads to a role without `report` (D27-141). On screen, Housekeeping: "This page is not part of your role". Web night-audit tests passed.

---

## 2026-09-28 · Fix round F (QA leftovers, D27-149): "Room charges to post" counts what the run posts (QA NA-5)

**Asked for:** QA NA-5: the checklist said 6, the run posted 0. Branch `fix/leftovers-28sep`, copy `.claude\worktrees\great-villani-44a38c`, database `fidato_s30`, API 8867, web 5267.
**Shipped:** the run's stay predicate is one exported text, `POSTS_TONIGHT` (`nightAudit.ts`), used by the run and by the checklist's count, which also leaves out complimentary rooms (the run skips them) and stays due out today (the run is refused until they leave). The card's sentence says what is and is not counted. NA-11.
**Proved:** `api/test/modules/night-audit/nightAudit.test.ts` 23 passed; the walk-in test now asserts the count drops by one once the whole stay is posted, and failed with `checklist.ts` put back ("expected 1 to be +0"). On screen (fidato_s30, 26 Aug): 0 to post, with two in-house stays already charged for both nights at check-in.

---

## 2026-09-28 · Fix round C: the audit asks first; the restaurant's struck dishes in its figures

**Asked for:** the owner's D27-116/117 through the master: QA NA-1 (Run night audit on one click); D27-119's reason "in the day's report" - the owner chose the night audit as well (fix round C, answer 4). Branch `fix/restaurant-audit-28sep` from cp6 `631ce1f`.
**Shipped:** the confirm on Run (`pages/NightAudit.tsx`); `restaurant.struck` in the run's result (`nightAudit.ts`, through `../pos/index.ts`). Nothing the audit posts, marks or moves changed.
**Proved:** see DEFECTS NA-10. **Left open:** nothing of this round. **Commits:** on the branch.

---

## 2026-09-25/26 · Correcting a closed day's other charges (D24-13, D25-5 to D25-11)

**Asked for:** the master's lane brief of 25 September: D24-13, left open on
the 24th - Closed days corrected only a closed day's room and no-show charges.
Extend 134's correction (same table, same exception, same panel), not a second
mechanism; update the desk's Reverse; prove the Night Audit and Manager reports
for that day move by exactly the correction. Branch
`night-audit/other-charges-25sep`, from cp6 `fb7b2e2`; cp6 `59b5776` merged
before the checks.

**The owner's answers** (`docs/briefs/decisions-2026-09-25.md`, D25-5 to
D25-11, each the recommended answer): every charge, never a payment, refund or
discount (D25-5); a restaurant bill on a room is corrected on the room bill
only, the restaurant's own bill, day end and sales stay as rung (D25-6); drinks
whose VAT bill stands are refused, "Cancel the VAT bill instead." (D25-7); the
same limits as a room charge (D25-8); a charge that is not the room keeps the
tax it was charged at (D25-9); a corrected restaurant bill stays under "POS to
PMS Posting" (D25-10); the desk's Reverse words (D25-11).

**Shipped:**
- `db/migrations/139_closed_day_other_charges.sql` - one column,
  `closed_day_corrections.origin`: where the charge first came from, carried
  through a correction of a correction. Nothing else in 134 changes.
- `api/src/modules/night-audit/nightAudit.ts` - `CORRECTABLE` is every standing
  charge but payment, refund, discount and tax lines (the reports' own list);
  the day's list names each line's kind (room, no-show, restaurant, or its
  category) and the VAT bill standing on a drinks line; the correction refuses
  a standing VAT bill before any write, keeps `origin`, and gives the right
  charge its tax scheme (a drink's VAT stays VAT).
- `api/src/modules/reports/builders/manager.ts` (reports', approved by the
  master) - a correction whose origin is the till stays in the POS bucket.
- `api/src/modules/finance/postings.ts` (finance's) - the Reverse's two
  sentences (D25-11).
- `components/CorrectDay.tsx`, `data/nightAudit.ts` - the panel lists every
  charge by its kind, refuses a drinks line with a VAT bill on sight, and says
  "The tax stays at the rate it was charged at." for a charge that is not the
  room.

**Proved:** the six checks on the merged tree (`ee68680`, cp6 `59b5776` in),
26 September 21:03-21:59, each exit 0: web types; api types; web tests 71
files, 662 tests; api tests 94 files, 1468 tests (139 migrations); database
tests, all 1154 assertions; the replay, all 139 migrations re-runnable.
`corrections.test.ts` 17 tests; each new rule was broken on purpose and a
test failed without it (four runs: the Manager bucket, the Reverse words, the
VAT bill refusal and the VAT scheme - 5 failed; the origin carried through a
second correction - 1 failed; "every charge" - 5 failed; the refund kept out -
2 failed). `nightAudit.test.tsx` 6 tests; the new one fails without the panel
change. On the screen (fidato_s8, 5EL, 25 Aug closed through the audit route
after the desk and till had done their day): the panel at 1280 and 390, the
drinks line refused with its VAT bill, the restaurant food corrected 1,660 →
1,460 and the minibar taken off through the screen, the desk's Reverse on the
closed day's drinks line. The Night Audit and Manager reports for 25 Aug moved
by exactly -550 net, -27.50 tax (-577.50), nothing else; POS to PMS Posting
-210, Food 0. Screens and both reports' PDFs, before and after, in
`.local/screenshots/2026-09-25-closed-day-others/`.

**Found:**
- The Manager report's Revenue summary counts the restaurant from its own bills
  (`pos_orders`), so a corrected restaurant bill moves it only by the other
  charges: D25-6's answer, as the owner was told when asked.
- The Night Audit report's Misc. Charges joins `pos_orders.id` to a till line's
  `source_id`, which is the TICKET's id (till.ts, pos.ts), so its Outlet and
  Order columns are never filled for a restaurant line. Read in the code, not
  fixed (reports' file).
- An outside till voiding a ticket whose line was corrected on Closed days
  would hit 021's one-reversal index and answer 500 (pos.ts void has no
  "already reversed" check). Read in the code, not reproduced.
- NA-7: mine, a `grep -r` through the copy's node_modules junction.

**Left open:** the three found above.

**Commits:** see the branch.

## 2026-09-24 · Correcting a closed day (D22-18), and a walk-in charged twice (NA-5)

**Asked for:** the master's lane brief of 24 September: D22-18, the owner's "a
GM screen; a reason is required, and the old and new figures are both kept",
built to the plan in `docs/briefs/closed-day-correction-plan.md` once the owner
answered its eight questions; and the three questions the menu heading picker
left (POS). Branch `night-audit/finish-24sep`, from cp6 `c4a6c75`.

**The owner's answers**, all in `docs/briefs/decisions-2026-09-24.md`:
D24-1 to D24-8 (the plan's eight, each the recommended answer), D24-9 (the
desk's Reverse says where to go), D24-10 to D24-12 (the menu picker, all as
built), D24-13 (the desk's Reverse on a closed day's minibar or laundry: said,
fixed later) and D24-14 (NA-5, below: fix the audit now).

**Shipped:**
- `db/migrations/134_closed_day_corrections.sql` (134: cp6 took
  130-133 after this branch left it) - `closed_day_corrections`, append-only,
  hotel-isolated; written only by the owner, an administrator or the GM there,
  or a group administrator (`app.corrects_closed_days`), and the row names who
  really did it. 012's `app.reject_closed_business_date`, same signature, with
  one exception: a line naming a correction of the same property and day,
  posted by someone who may correct it. Every other door refused as before, in
  the same words. Re-runnable (the posting is referenced by its own id: 014
  re-adds `(hotel_id, id)` on every run and a dependent stopped it halfway).
- `api/src/modules/night-audit/nightAudit.ts` - `GET days/:date/charges`,
  `POST days/:date/corrections` (every refusal before the first write; the
  reversal and the right charge on the closed day; a room charge's GST worked
  out again by `app.gst_rate` for its new amount, a no-show charge keeps its
  rate); `GET /runs` adds `corrections` and `correctedRevenue`, which moves only
  for the room charges the AUDIT posted (a walk-in's line never was in its
  figure - found on the screen, where it would have read "₹0 → -₹500").
  NA-5: the audit's "already charged tonight?" reads the nights a line pays for.
- `api/src/roleGate.ts` - the corrections route on `reservation` · approve.
- `api/src/modules/finance/postings.ts` (finance's) - the desk's Reverse on a
  closed day's line: NA-6, D24-9, D24-13.
- `api/src/modules/reports/index.ts` (reports') - `POSTING_NIGHTS` exported,
  so the audit reads a line's nights the way the reports do.
- `api/scripts/reset-property.ts` - clears `closed_day_corrections` before the
  bill lines, its append-only guard lifted with the others
  (`resetOrder.test.ts` named it).
- `src/modules/night-audit/` - `components/CorrectDay.tsx` (the panel),
  `data/nightAudit.ts` (two calls), `pages/NightAudit.tsx` (Correct or
  Corrections on each day, "Corrected", old → new, the rule under the heading).

**Found:**
- NA-5 (fixed, D24-14) and NA-6 (fixed): `DEFECTS.md`.
- A copy's own dev server never reloaded: `vite.config.ts` ignored
  `**/.claude/worktrees/**`, which is every file in a copy. Already fixed on
  cp6 (`9dfdd3f`) after this branch left it.
- The folio shows the night audit's line as "room · <a staff uuid>" where the
  desk's line shows a name (finance's FolioPanel; seen, not touched).
- The printed Night audit report's Room Charges and Checked Out columns overlap
  (reports' PDF; seen in the saved PDFs, not touched).
- **Two mistakes of mine, caught by the whole API suite** (for the root
  MEMORY): the correction test's booking outlives the file (it sits on a closed
  day) and its reference ended in `Date.now()`; `app.next_reference` takes the
  largest number a reference at the property ends in, so every later booking at
  Pune became `FH-PUN-2609-1790239558818` and two booking-reference tests
  failed. And a release dirties the room (074): my two new stays left two more
  of Pune's ten rooms dirty, and the identity and guest tests found no clean,
  free room. Both tests now leave the room released and clean.

**Proved** (in this copy). The six checks, on this branch with cp6 `a733ca4`
merged in, exactly the tree the master merges: web `tsc` exit 0; API `tsc`
exit 0; web suite 629/629 in 68 files, exit 0; API suite 1433/1433 in 90
files on 134 migrations, exit 0; `db/tests/run.sh` all 1131 assertions,
exit 0; `db/tests/rerun.sh` all 134 migrations re-runnable, exit 0.
- `db/tests/modules/night-audit.sql` - 14 new checks. Each guard was switched
  off in turn and its check failed: the line's role test, its day, its
  property, the whole exception, who writes a correction, the name it keeps,
  append-only, the reason, the administrator.
- `api/test/modules/night-audit/corrections.test.ts` - 12 tests: the GM's
  correction leaves the old line, puts the reversal and the right charge on the
  closed day, and moves the Night Audit report's Room Charges, its tax and its
  Daily Sales and the Manager report's Room Charges by exactly -500 (and -25
  tax); Closed days old → new; reception 403; no reason, a line already
  corrected, a laundry line, a day not closed, a day older than last month, an
  invoiced bill each refused writing nothing; a checked-out guest's charge
  taken off (D24-8), and a correction of a correction still moves the audit's
  figure; the desk's two Reverse sentences. Seen failing with the invoice,
  month, closed-day and desk checks removed, and with the roleGate row removed
  (roleGate's own test named the route).
- `nightAudit.test.ts` - "does not charge a night a walk-in's whole-stay line
  already paid for": `expected '2' to be '1'` with the old condition.
- `nightAudit.test.tsx` - 2 new: reception sees Corrections and no Correct, and
  old → new; the GM's Save waits for a reason, an invoiced bill's line is off,
  an older day's Correct is off, and the figure is sent. Seen failing with each
  rule removed.
- **The screen, opened** at 5EL in `fidato_s4`: 25 and 26 August closed with
  the real Run button as the GM; the correction saved with a real click; the
  26 August reports saved before and after as PDFs and pictures in
  `.local/screenshots/2026-09-24-night-audit/`. Every figure for the day moved
  by exactly the correction, -₹3,373.66 (Night Audit report Room Charges
  ₹14,063.04 → ₹10,689.38; Manager report today ₹16,920.04 → ₹13,546.38, month
  so far ₹4,26,610.28 → ₹4,23,236.62). A day-use charge on 25 August moved
  Day Use Sales and Total Sales by exactly -₹300, and left the audit's ₹0.

**Left open:**
- A closed day's minibar, laundry or restaurant line cannot be corrected
  anywhere (D24-13).
- Live bills were not looked at for NA-5's double charges (D24-14: the GM takes
  them off on Closed days; an invoiced bill needs a credit note).
- A no-show who arrived: only the charge comes off here (D24-7); the booking is
  the front desk's, not asked yet.

**Commits** (on `night-audit/finish-24sep`): `a0ce93d` the work; `3df72f0` and
`7d911f3` cp6 merged in (`9dfdd3f`, then `a733ca4`); `c900afb` and `de424c8`
the migration renumbered to 133, then 134, and who may correct written out
rather than read from `app.manages_hotel` (which the admin lane's 133 widened);
and this entry.

---

## 2026-09-17 · D17-12 and D17-13: a second press shows the record; the closed days are listed

**Asked for:** the master chat, relaying the owner's answers of 17 September
(`docs/briefs/decisions-2026-09-17.md`). **D17-12** (NA-3): a day already closed
is not run again — a second press, at the same moment or later, changes nothing
and shows the record that was made; any correction to a closed day's record
needs the GM. **D17-13** (NA-1): a history of closed days on the Night audit
screen — who ran it, rooms posted, revenue, no-shows. And: `nightAudit.test.tsx`
waited one second for "Run night audit" and failed on a busy machine.

**Shipped** — on `night-audit/closed-days-d17`
- `api/src/modules/night-audit/nightAudit.ts` — `POST /run` takes the advisory
  lock 006 described; a day already closed answers 409 with `alreadyClosed` and
  the `record`; the day is required (400 without it); a day the property is not
  on is refused; `run_by` is written. `GET /runs` lists completed days with who
  ran each, through `app.colleague_name`. One reader, `closedDays`, serves both.
- **`db/migrations/100_closed_day_record_needs_gm.sql`** — a completed run is
  corrected only by the property's owner or GM, or a group administrator.
  Re-runnable, writes no rows. **Renumbered 100 by the master at merge (099 went to POS).**
- `src/modules/night-audit/pages/NightAudit.tsx` — the **Closed days** card
  (day · ran by · closed · rooms posted · room revenue · no-shows; a dash where
  the record holds nothing; loading, failed and empty states from `DataTable`),
  and the record card shown when Run meets a day already closed.
  `data/nightAudit.ts` — `listClosedDays`, `ClosedDay`.
- Tests: API "a stale screen" (five) and "the closed days"; database
  `db/tests/modules/night-audit.sql` (new, 11 assertions); web
  `nightAudit.test.tsx` (three), with 10-second waits inside a 30-second test.
- `DEFECTS.md` — NA-1 and NA-3 fixed, NA-4 new. `MODULE.md` — the endpoints,
  what the screen reads, the table and 100.

**Found**
- **`run_by` has existed since 006 and nothing wrote it**, so "who ran it" needed
  no migration — and every day closed before today shows a dash.
- **NA-4:** the shared test setup's `StubApiError` drops the refusal body, so no
  web test can see a payload; the real class keeps it (checked in the built
  bundle). Worked around in this service's test; the stub is the master's.
- My first race test fired two requests side by side and they did not overlap
  (one came back refused on the OLD code) — it would have passed or failed by
  timing. It now holds the run table until both presses are seen waiting.
- My first round of new API tests used three-night stays and pushed Pune out of
  clean rooms, breaking "lets a manager waive it". One-night stays now.
- A `timeout 580` around `npm test` killed the harness before its cleanup on a
  loaded machine and left `fidato_test_4380` behind (created 14:11:50, unused);
  dropped. Long suites run in the background without a timeout now.

**Proved**
- **Seen to fail first.** API, against the old server: 5 failed — the stale
  test (no record), no day (200, closed a day), a day the property is not on
  (200), the race (**both presses 200**) and the closed days (no `ranBy`).
  Database, without 099: a clerk's four corrections all went through (6 of 11
  failed). Web, against the old page and data: all 3 failed.
- **The screen, opened** on this copy's own API (8797) and web (5197), database
  `fidato_night_audit`, signed in as the Owner, Pune. Two tabs on the Night
  audit screen, both "closing Wednesday, 16 September 2026". Tab 1: Run → "is
  closed", and Closed days read `16 Sep 2026 · Group Owner · 17 Sep 2026, 3:15
  PM · 0 · ₹0 · 0`. Tab 2, still saying the 16th: Run → "16 September was
  already closed. Reload to see today. Nothing was run again. The record that
  was made: Ran by Group Owner · closed 17 Sep 2026, 3:15 PM · rooms posted 0 ·
  room revenue ₹0 · no-shows 0", and its list refreshed. Database afterwards:
  one run at Pune, `run_by` owner@fidato.in, business date 17 September. Console:
  only the 409 of the refused press. At 375px: the list is one card per day,
  no sideways scroll, nothing outside the viewport.
- **Gates, on the tree committed:** `npx tsc -b --force` exit 0 · `npx vitest
  run` 28 files, 271 passed, exit 0 · `cd api; npx tsc --noEmit` exit 0 ·
  `cd api; npm test` 39 files, 760 passed, exit 0 · `bash db/tests/run.sh` all
  747 assertions, "closed day record" 11/11, exit 0 · `bash db/tests/rerun.sh`
  all 99 migrations re-runnable, with a property between passes, exit 0 ·
  `npm run build` exit 0, "no test sign-in in dist".
- **Two red runs on the way, both read before they were believed.** The first
  full web run: 2 front-desk tests killed at vitest's 5 s under load; both files
  passed alone (14/14). The second full API run: `isolation.test.ts` lost its
  Postgres connection and `padTotal.test.ts`'s setup passed 30 s, with 85 node
  processes on the machine; the next run, on a quiet database, was the green
  one quoted above.

**Left open**
- `GET /:code/night-audit/can-run` still has no caller; not decided.
- No screen corrects a closed day's record; the database allows only the GM.

## 2026-09-16 · NA-2 fixed: a stale close is refused — and NA-3 found

**Asked for:** the master chat, relaying the owner's decision of 16 September:
fix NA-2 by refusing a stale close. The Run button sends the business date the
screen says it is closing; `POST /run` refuses when that day is already closed,
says so ("25 August was already closed. Reload to see today.") and changes
nothing. Do not change what the audit posts, marks or moves. Commit the
stale-screen test. The next deploy waits on this fix.

**Shipped** (`91f7bb7`)
- `api/src/modules/night-audit/nightAudit.ts` — `POST /run` reads
  `{ businessDate }`. A day with a completed run is refused (409) before the
  first write; a date that is not a date is a 400; no date is answered as
  before. The header and the unreachable "already closed" branch's comment say
  what now catches a second press.
- `src/modules/night-audit/data/nightAudit.ts`, `pages/NightAudit.tsx` — Run
  sends the day the heading names.
- Tests: `api/test/modules/night-audit/nightAudit.test.ts` "a stale screen"
  (two) and `src/modules/night-audit/nightAudit.test.tsx` (new, the first web
  test in this folder). A test that never sent a request is renamed to what it
  checks.
- `DEFECTS.md` — NA-2 fixed; NA-3 new. `MODULE.md` — the run's body and
  answers.

**Found**
- **NA-3:** two presses of Run for the same day at the same moment charge
  correctly and move the date once, but leave the day's record at 0 rooms and
  ₹0 and tell one person "0 rooms posted". Proved on a scratch database. Not
  fixed — the owner decides; the recommendation is in `DEFECTS.md`.
- The claim I made in round 1 was a file in `.claims/`, which no other copy
  could see (root `MEMORY.md` 281); it was never committed. Removed, and the
  service claimed with `npm run claim`.

**Proved**
- Each new test run against the code before the change and seen to fail: the
  API stale-screen test got 200 and the old code closed the next day
  (`2026-09-22`, 1 no-show, 1 room posted); the bad-date test did not get a
  400; the web test failed with "Run sent no date".
- Gates, in `D:\fidato-night-audit` at `91f7bb7`: `npx tsc -b --force` exit 0 ·
  `npx vitest run` 24 files, 237 passed, exit 0 · `cd api; npx tsc --noEmit`
  exit 0 · `cd api; npm test` 34 files, 425 passed, exit 0 · `npm run build`
  exit 0, "no test sign-in in dist" · `npm run lane -- night-audit` exit 0.
  Not run: `db/tests/run.sh` — no migration or SQL function changed.

**Left open**
- **The screen, in the browser, not yet opened** at the time of this entry —
  this session's preview reads the master's folder, and the check needs this
  copy's own servers.
- NA-3, the owner's. NA-1's history screen, the owner's.
- A caller that sends no date still closes the server's day. None does today.

**Commits:** `91f7bb7`, and the commit that adds this entry.

---

## 2026-09-16 · NA-1 investigated, read-only — and NA-2 found

**Asked for:** the owner started the night-audit chat with its brief
(`docs/briefs/night-audit.md`): claim the service, then NA-1 as an
investigation only — dead code or a missing button? — and write down which
sources the screen reads. Change nothing the audit posts, marks or moves.

**Shipped** — documentation only; no code, no migration.
- `DEFECTS.md` — NA-1's answer, and **NA-2**, new.
- `MODULE.md` — "What the screen reads, and from where"; the endpoint table
  says which routes write and which date each one uses; the claim now points
  at `.claims/`.
- `.claims/night-audit.md` — made first, deleted when this session stops.

**Found**
- **NA-1:** neither uncalled route writes anything. All three routes were born
  in `2a8076e` (29 August), and no screen has ever called either GET. `runs` is
  a history screen that was scored built on its endpoint alone (`PROGRESS.md`,
  Stage 5, unit 9). `can-run` duplicates the checklist's `canRun`, except that
  it answers for the server's date. Recommendation to the owner: keep `runs`
  and build the history; keep `can-run` until NA-2 is decided.
- **NA-2:** a Night audit screen that did not see the day close keeps offering
  to close it, and Run closes the NEXT day — the next night's room charges,
  the next day's arrivals marked no-show and their rooms released — provided
  nobody is due out that day. `POST /run` takes no date, and its "already
  closed, here is what that run did" branch can never be reached.
- **Production, read-only:** 5 Elements closed 9 and 10 September in the same
  minute (10 Sep, 16:01 IST, 0 rooms posted), and nothing since. Its business
  date is 11 September; the 17 postings dated 11 September were made between
  10 and 16 September. Nobody in house, no confirmed arrival pending, no desk
  drawer open.
- **Not this service's:** `DB=… ./db/migrate.sh --with-dev-identities` on a new
  lane database printed `ERROR: dev-identities: expected 3 staff with dev uids,
  found 0` and then a green "✓ local sign-in accounts linked", and exited 0.
  Reported to the owner for the master.
- The result card never shows `retentionCharged` or `noShowsWithoutTerms`,
  which the run returns (in `MODULE.md`; a change a person would see, so the
  owner's).

**Proved**
- NA-2, with a throwaway test in `api/test/modules/night-audit/` run once
  through `npm test` (the harness's scratch database, dropped afterwards), then
  deleted: 1 passed, exit 0. The figures are in `DEFECTS.md`. Afterwards
  `git status` showed only the claim, and no `fidato_test_*` database was left.
- The production figures: two `psql` reads over ssh with
  `default_transaction_read_only=on`. Nothing was written.
- Gates, run in `D:\fidato-night-audit` at `07e7f30` plus these Markdown
  changes: `npx vitest run` — 19 files, 212 passed, exit 0;
  `cd api; npm test -- night-audit` — 15 passed, exit 0;
  `npm run lane -- night-audit` — "All inside the night-audit lane", exit 0.
  Not run, because nothing they check changed: `tsc`, the full API suite,
  `db/tests/run.sh`, the build.

**Left open** — NA-1 and NA-2 wait on the owner. Nothing is fixed.

**Commits:** on `night-audit/na-1-investigation`, not merged.

## 2026-09-15 · moved into its own folder

**Asked for:** the owner, 15 September — one folder per hotel service, so
one agent can be given one service and several can work at once
(`docs/SERVICE-FOLDERS-PLAN.md`).

**Shipped**
- Step 3 (`e9dd6b1`): the menu entry in `nav.ts`, the screen address in
  `routes.tsx`, the front door `index.ts` and a stub `MODULE.md`; on the
  server, `api/src/modules/night-audit/index.ts`, at first mounting
  `api/src/routes/nightAudit.ts`.
- Step 4a (`23cd2e4`): the night audit's calls were cut out of `billing.ts`
  into their own `nightAudit.ts`, in place.
- Step 4 (`66a685c`), moved into this folder:
  - page — `NightAudit.tsx` (from `src/pages/`)
  - data — `nightAudit.ts` (from `src/data/repositories/`)
- Step 5, the server (`489271d`): `nightAudit.ts` moved to
  `api/src/modules/night-audit/`, and the pre-flight checklist came out of
  the old `billing.ts` into `checklist.ts`; `nightAudit.test.ts` had moved to
  `api/test/modules/night-audit/` in `3424882`.
- This brief (`MODULE.md`), this log and `DEFECTS.md`, written from the code
  at `c804aa2`.

**Found**
- Writing the brief: `GET /:code/night-audit/can-run` and
  `GET /:code/night-audit/runs` have no screen calling them (the API tests
  and `api/scripts/capture-demo.ts` do). The stale "THE NIGHT AUDIT DOES NOT
  RUN" header stayed behind in finance's `billing.ts` (finance's FIN-1).

**Proved**
- The move commits report web types clean and 204 web tests.
- For the brief, at `c804aa2`: `npx vitest run src/test/boundaries.test.ts`
  — 4 passed, exit code 0. The whole web suite in this worktree, which has
  no copy of the untracked root `.env`: 173 of 204, exit code 1 (19 failures
  in `src/App.test.tsx`, 10 in front desk's, 2 in reports'); with
  `VITE_ALLOW_DEV_AUTH=1` and `VITE_DEMO_MODE=1` set, 200 of 204 (the 4 left
  in `src/App.test.tsx`, not investigated). This change is Markdown only.

**Left open**
- The two endpoints with no screen.

**Commits:** `e9dd6b1`, `23cd2e4`, `66a685c`, `3424882`, `489271d`, and the
commit that adds this file.

---

## Before the move — entries in the root CHANGELOG.md

Read them there. Date · title:

- 2026-09-15 (plan) · One folder per service
- 2026-09-15 (step 4) · Help where the question is
- 2026-09-15 (step 3) · A menu for each person, and the search it depends on

Before 8 September the root file records nothing: `git log` and
`PROGRESS.md` are the record for that time (the root file's own note).
