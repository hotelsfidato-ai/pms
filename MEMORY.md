# Memory — what this project learned the hard way

Every entry here cost something. Read it before you repeat it.

---

## Defects that passed every gate

**Every one of these had `tsc -b` clean, tests passing, and a clean production
build. Every one was caught only by opening the page and reading it.** That is
now seventeen defects. The habit is not optional.

### 1 · Tailwind was entirely non-functional

`@tailwindcss/vite` was missing from `package.json` and `vite.config.ts`. In
Tailwind v4 that plugin is what processes `@import "tailwindcss"` and the
`@theme` block — without it the import silently resolves to nothing.

```
.flex        → display: block        .text-xl   → 16px
.bg-grey-50  → rgba(0,0,0,0)         font       → Times New Roman
--color-ink-900 → ""                 utilities  → 0 rules
```

Every `className` in the app was inert. The build produced 29 KB of CSS which
was entirely `@font-face` declarations nothing referenced.

### 2 · `/design-system` rendered a blank screen

A `Tooltip` was used without `TooltipProvider` above it. Radix throws, React
unmounts the tree, the page is empty. `rootChildren: 0`.

The provider lived in `AppShell`, which had correctly not been ported yet.

### 3 · A check-in ran and nothing changed on screen

The worst of the three, because it looked like it worked — the write succeeded
and the toast fired.

The chart derived every tone and count from **dates**, not status. A guest
whose booking covered tonight already read as in-house, so checking them in
moved no number. `PHASE-1-FRONTEND.md` calls this out explicitly:

> *the visible update is what tells a clerk the work landed*

**Rule: if an action does not move a number on screen, it is not finished.**

### 4 · Recharts v3 drew empty bars

`<Bar>` with `<Cell>` children and no `fill` on the Bar itself rendered
`<g class="recharts-bar-rectangle"><g class="recharts-inactive-bar"></g></g>` —
a rectangle with no path. Typecheck, tests and build were all clean; the chart
was simply blank. **Put a `fill` on the `Bar`; `Cell` overrides it, it does not
supply it.**

### 5 · The notification bell described a different hotel

The seeded notifications were hand-written prose: a ₹45,000 GoMMT settlement, a
night audit reporting ₹1,24,500 of revenue. Neither figure existed anywhere in
the ledger. Anyone comparing the bell against the Manager Report would have
found two hotels.

Rewritten so every notification is a **condition computed from the same stays
and postings every other screen reads**. Check a guest in and the arrival notice
disappears, because nothing keeps it alive. `isRead` is the only genuine state —
a dismissal is a decision a person made and cannot be recomputed.

**Rule: demo prose that carries a number is a liability. Derive it or leave it
out.**

### 6 · Three defects the ledger hid until new screens read it

None of these were visible while only Stay View, Arrivals and Folios existed.
Building Payments, Invoices and the Audit Log surfaced all three at once.

- **Receipts dated in the future.** The seed posted a settlement at
  `stay.departure`, so a booking departing 2 September carried a receipt a week
  ahead of the business date — and every balance derived from it was wrong.
- **Charges on stays that had not arrived.** Room charges posted at
  `stay.arrival` whether or not that date had happened, inflating the audit
  log, every guest's total spend, and the year-to-date column of the Manager
  Report.
- **ADR and RevPAR included extras.** ADR is room revenue over rooms sold, by
  definition. `netOf()` is room *plus* extras. ₹18,181 of extras was adding
  about ₹140 a night to the year-to-date rate.

**Rule: a fixture is only as honest as the screens that have read it. Expect
each new screen to find something, and fix the seed rather than the screen.**

### 7 · A read grant leaked an `/admin` path to the front desk

Adding `{ to: "/admin/properties", resource: "hotel" }` to the Administration
menu made it visible to every role that can *read* the property list — which is
all of them. `App.test.tsx` caught it: *keeps administration away from the front
desk*.

Nav visibility defaults to "any grant on the resource". When an entry is about
an **action** rather than a resource, override it:
`canSee: (role) => can(role, "create", "hotel")`.

### 8 · A vacuous test, written by me, at CP7

The API test *refuses a cross-tenant write* selected its source rows FROM the
other property:

```sql
insert into reservations (...)
select $1, 'X-CROSS-TENANT', g.id, rt.id, ...
  from guests g, room_types rt
 where rt.hotel_id = $1          -- the OTHER hotel
```

RLS hid those rows. The `INSERT` inserted nothing, succeeded, and the test
reported that RLS refused a write it never attempted.

This is the same defect the database suite already records at
`db/tests/suite.sql:79` — *"INSERT succeeded vacuously and the test reported a
schema failure that was really a test failure."* Knowing about it in one
codebase did not stop me writing it in another.

**Rule, restated because knowing it was not enough: assert the row count BEFORE
asserting the refusal. A test that inserts nothing can never fail.**

### 9 · A transport swap that the screen did not use

CP9 moved `rooms.ts` from the store onto HTTP, reads and writes together, and I
wrote in the handover that a clerk could no longer see a stale board.

The housekeeping screen does not call `rooms.ts`. It calls
`operations.markRoom`, which still wrote to the store. The module was
self-consistent and the product was not.

**Rule: swapping a module's transport is not finished until the SCREEN that
uses it has been clicked. Trace from the button, not from the module.**

Two more came out of the same audit, both in `operations.ts`:

- `setRoomHousekeeping(room, "occupied")` wrote an OCCUPANCY value into a
  HOUSEKEEPING field. The schema keeps them independent because a room can be
  occupied and dirty at once. Deleted, not ported — occupancy is derived from
  stay status.
- `listHousekeeping` used `departure > businessDate` and excluded day-use, so a
  guest still in the room read as gone. Defect 3 again, third occurrence.
  **Derive from status.**

### 10 · A guard that did nothing, for the whole project

`db/tests/run.sh` called the RLS suite behind `if [ -f db/tests/rls.sql ]`.
**The file did not exist.** The branch was skipped in silence from the day it
was written, so every claim about tenant isolation rested on nothing the suite
checked — while the script's own comment explained exactly why that mattered:

> a superuser bypasses RLS and would report success on a completely open database

All 51 assertions ran as `postgres`, which has `BYPASSRLS`.

**Rule: a guard that quietly does nothing when its subject is missing is worse
than no guard, because it reads as covered.** Missing is now fatal, and the
suite's output is shown rather than piped into `grep` — piping made the exit
status grep's, so a raised exception left the run green.

`rls.sql` now exists: 7 checks, run as `pms_app`, proved able to fail by
opening `hotel_isolation` on `reservations` and watching check 0 catch it.

### 11 · Three notes in a handover are not three fixes

`is_complimentary`, the `Room Only` meal plan, and admin visibility of
`staff_hotels` were each found, written down, and left. A note in a handover is
a promise, and promises accumulate. Migration 020 closes all three.

The worst of them: a complimentary room was detectable only as
`agreed_rate = 0`. That worked while exactly one booking sat at zero and would
have broken the first time anyone booked a free room for another reason —
silently, by moving a number on the Manager Report.

**Rule: when a defect is small enough to write down, it is usually small enough
to fix. Deferring is a decision, so make it one — with a reason.**

### 12 · An old server answering for the new one

Twice in CP9 a restart hit `EADDRINUSE`, the stack trace went into a log nobody
was tailing, and the previous process kept serving the port. Correct SQL was
read as broken because the code answering was not the code on disk. On Windows
`pkill -f "tsx src/server.ts"` does not reliably kill it.

Fixed rather than remembered:

- `/health` reports `startedAt`, so a stale process is visible, not suspected.
- `EADDRINUSE` is now fatal with a message naming the cause and the fix.
- `npm run serve` frees the port first (`api/scripts/free-port.mjs`).
- `npm run dev` is `tsx watch`, which reloads on edit.

**Rule: when a tool can silently serve stale code, make it say so. Anything
else is a memory test you will fail again.**

### 13 · Adding the column is not the fix

Migration 020 gave `is_complimentary` its own column, the loader wrote it, and
the API route that SERVES the data kept inferring it from `agreed_rate === 0`.
The schema was right, the data was right, and the answer on screen was still
the old guess.

**Rule: a fix has a writer and a reader. Adding a column, writing it, and
reading it are three changes, and the one that reaches a person is the read.**

### 14 · A gate that reads a different source from the action it guards

`checkIn` moved onto HTTP. `checkInAllowed` — the function that decides whether
the button is enabled — still read the in-memory store. It looked up a Postgres
uuid in a store that has never seen one, found nothing, and disabled the button
with "Reservation not found."

Permanently. A clerk would have seen a check-in they could never perform, with
no way to find out why, and nothing in any log.

**Rule: when an action moves, its GATE moves in the same commit. A gate that
consults a different source from the action it guards is not a gate.**

The same swap also produced defect 3 for the THIRD time: the room picker marked
a room taken because "a booking covers tonight", which counted the arrival being
checked in as the reason it could not be checked in. **Status, not dates.**

### 15 · A permission refusal that was a design note

The reversal endpoint took `select … for update` on the posting it was about to
reverse, to stop two clerks reversing the same charge at once.

```
ERROR:  permission denied for table folio_postings
```

`pms_app` has SELECT and INSERT on that table and deliberately not UPDATE — the
ledger is append-only. `FOR UPDATE` requires the update privilege even when
nothing is updated.

The instinct is to widen the grant. The grant was right and the lock was wrong:
a UNIQUE INDEX on `reverses_id` gets the same guarantee without one, and gets it
for every caller rather than only the one that remembers to lock.

**Rule: when a permission refuses something reasonable, ask what the permission
knows that you do not. Widening a grant to make an error go away removes the
only thing that was telling you.**

### 16 · A write that went nowhere, found by an audit not a test

`createWalkIn` wrote the new stay into the in-memory store. Every screen had
moved onto HTTP. So the walk-in reported success, and then did not exist — no
error, no row, and a guest at the desk.

No test caught it: the seam tests stub the transport, and there is no test that
takes a walk-in. It was found by grepping the seam for store writes after
everything else had moved.

**Rule: after moving a module's transport, grep the WHOLE seam for the old
one.** `grep -rn "addPosting\|mutateStay\|addStay" src/data/repositories/`
takes five seconds and would have found this the moment stays moved.

Corollary, now true and worth keeping true: `operations.ts` imports nothing from
`src/data/store.ts` but a type. When a module still imports data from the thing
it replaced, it is not finished.

### 17 · A backtick in a SQL comment, and a check that could not catch it

Three times — stays.ts, operations.ts, directory.ts — a comment written
INSIDE a SQL template literal quoted a column name the way prose does. The
backtick closes the literal, and `tsc` then reports a syntax error several lines
later pointing at whatever token first failed to parse. The real cause is
invisible.

**Symptom: `TS1005: ',' expected` on a line that looks fine, inside a file with
SQL template literals. Look for a backtick in a comment above it.**

I tried to make it a test twice, and both attempts are worth recording:

- The first was **vacuous**. It scanned for a comment-with-backtick inside a
  template literal — but the offending backtick had already terminated that
  literal, so the scanner never saw the comment. I inserted the bug, ran the
  test, and it passed. The exact failure this project has recorded twice
  already, written by me while writing the guard against it.
- The second **worked and was still wrong**: a blunt "no backtick in any block
  comment" caught the bug and also flagged every file-header comment, which are
  outside any literal and perfectly safe. A check that cries wolf is one people
  learn to ignore.

Deleted both. **`tsc` catches this every time** — the cost was never a shipped
bug, only diagnosis time, and a note naming the symptom buys back more of that
than a broad rule would.

**Rule: before writing a guard, ask what already catches the thing. If the
compiler does, the gap is the ERROR MESSAGE, and a test cannot improve it.**

---

### 18 · A test runner that reported success while a whole file errored

`db/tests/run.sh` piped the suite into `grep -iE "^ERROR"` and checked nothing.
Two independent failures, and each one hid the other:

- psql prefixes its diagnostics — `psql:db/tests/suite.sql:389: ERROR:` — so a
  pattern anchored at `^ERROR` matched **none of them**. The filter could not
  report the one thing it existed to report.
- The pipeline's exit status was never read, so `ON_ERROR_STOP=1` did its job
  and nobody asked.

Result: a `do $$` block aborted on an undefined variable, the seven assertions
after it never ran, and the run printed **"all 44 assertions passed"** — seven
FEWER than the run before it, reported as success.

**An assertion count that can only fall in silence is not a gate. Compare it to
the last run, or a deleted test looks exactly like a passing one.**

Fixed, then *proved* by reintroducing the exact bug: the run now stops with the
error quoted. Same family as defect 10 (the guard behind `if [ -f ]` whose file
never existed) and defect 17 (a check whose pattern could not match its target).

---

### 19 · The wall clock standing in for the business date, on four write paths

Found while removing the `BUSINESS_DATE` constant. Twelve API handlers defaulted
a date parameter to the literal `"2026-08-25"`, which was merely wrong for a
second property. Four **write** paths defaulted to
`new Date().toISOString().slice(0, 10)`, which was wrong for the first one:

> A clerk settles a bill at 00:40. The night audit for the 25th has not run, so
> the hotel is still operating in the 25th. The wall clock says the 26th. The
> receipt lands on the 26th, the night audit closes the 25th without it, and the
> day's cash never balances. Nobody can find the money, because it is filed
> under a day the hotel had not reached yet.

**A hotel's date advances when its night audit COMPLETES, not at midnight.**
That is the entire reason the concept exists. `now()` is never the business
date, and two properties are routinely on different ones — 5EL sat on
2026-08-25, Agra on 2027-04-02 and Pune on 2026-08-28 the day this was written.

---

### 20 · Wiring two of the three paths, and the screen finding the third

`BUSINESS_DATE` moved behind the seam and was set in `useSession.setHotelId`
and in the session load. Both correct. Opening `/h/AGR/arrivals` still showed
Agra's rooms under **5 Elements' date**, because a deep link changes the
property through a third path: a route effect calling `useUi.setHotelId` — a
*different store*, keyed by CODE where the session is keyed by UUID.

`tsc`, 81 tests and a clean build all passed. Nothing connected the three.

**Rule (again — this is defect 9 and 14 in a new costume): trace from the
BUTTON, not the module.** When two stores can name the same thing, find every
writer before claiming one of them is the place. The fix was to give the seam a
`selectProperty(codeOrId)` that both stores funnel through, so neither has to
remember.

**And: `grep` for the constant, then grep again after.** The last literal
`"2026-08-25"` in `src/` was in `admin.ts`, in a repository nobody had thought
about, showing one property's date on another property's settings screen.

---

### 21 · A grant list that read as a restriction

```sql
grant select, insert, update on pos_outlets to pms_app;
-- No DELETE on either.
```

The comment was false. `010_roles.sql` sets
`alter default privileges ... grant select, insert, update, DELETE on tables
to pms_app`, so **every new table in this schema arrives with DELETE already
granted**. Naming three privileges adds nothing and withholds nothing — it only
makes the file look like it restricted something.

**Only `revoke` takes a privilege away.** That is why `014_simulation_fixes.sql`
revokes on `folio_postings` rather than re-granting.

Caught by an assertion that checked `has_table_privilege` instead of trusting
the grant statement. **Assert the privilege, never the DDL that was meant to
set it.**

---

### 22 · A self-test that could not run, in a file lecturing about self-tests

Migration 024 ended with a `do $$` block proving the POS idempotency index
worked: insert a bill number twice, expect a unique violation. It returned
early when there was no hotel to test against — and **migration 017 deletes the
REPLACE placeholder properties**, so at 024's turn there are none. The block
proved nothing.

Found by deleting `unique (outlet_id, ticket_ref)` and watching all 24
migrations apply cleanly.

This is defect 10's exact shape, written into a file whose own header lectures
about defect 10. Two rules came out of it:

- **A self-test that can skip must fail instead.** The skip path now raises.
- **Assertions belong where the fixtures are** — `suite.sql`, which has real
  properties and real staff, and whose count run.sh now compares between runs.

---

### 23 · One room, two guests — and code that picked whichever came first

`app.pos_chargeable_rooms` returned room 201 twice: Rekha Gaikwad due out on
25 August, Tanvi Bhide arrived on 25 August, both `checked_in` with unreleased
assignments. That is not corrupt data — it is an ordinary **same-day
changeover**, and on that date the room genuinely has two open folios.

The POS charge path took `rows[0]`. It would have been right most days and
silently wrong on turnover days, billing a departing guest for the arriving
guest's dinner.

**The PMS cannot know which guest ate, so it must not guess.** It now refuses,
names both guests, returns both folio ids, and accepts `folioId` to settle it.

And a distinction that fell out of it: **a refusal that asks a question is not
recorded; a final refusal is.** Recording the ambiguity as `rejected` would
have hit the unique index and blocked that bill number forever, when the POS
is expected to resend it with the same number once a person picks the guest.

---

### 24 · A convenience UPDATE against an append-only ledger

The POS charge wrote the posting, wrote the ticket, then ran
`update folio_postings set source_id = …` to link them. Postgres refused:
`permission denied for table folio_postings`. `014_simulation_fixes.sql`
revokes UPDATE because the ledger is append-only, and **a convenience write is
still a write**.

Fixed by generating the ticket's uuid in the API before either insert, so one
pass writes both sides of the link.

---

### 25 · A cleanup that worked and a measurement that did not

The POS tests void everything they post, so the ledger nets to zero. The
`afterAll` that *checked* this joined `folio_postings` to `pos_tickets` on
`t.outlet_id = $1` with no correlation between the two — a cross join. Every
posting was summed once per ticket, and it reported **-367,575 against a ledger
that was actually balanced**.

A false alarm is not the harmless direction of a broken check. It trains people
to ignore the check.

**Before believing a number a test reports, ask what it summed.** And note the
earlier miss: `grep -E "Tests |×"` showed `31 passed` while the FILE had failed
in its hook. **Read `Test Files`, not only `Tests`.**

---

### 26 · The date moved and the interface never found out

The night audit closed 25 August, the success card said *"the property is now
operating in Wednesday, 26 August"* — and the header two lines above it still
said **"Closing Tuesday, 25 August"**. So did Arrivals, Folios, the tape chart
and every report.

`queryClient.invalidateQueries()` was called and did its job. What it could not
fix is that `BUSINESS_DATE` is a module binding the SESSION sets at sign-in, and
nothing else writes to it. Refetching against a stale date just re-caches the
wrong answer.

**When a write changes something a cache key is built FROM, invalidate the key
source before the cache.** `useSession.refresh()` now runs first, then the
queries.

Only visible by opening the screen: `tsc`, 81 tests and a clean build all
passed, and the two contradictory dates were four lines apart on one card.

---

### 27 · Fixtures that test the audit, and the audit that ate the fixture

Two lessons from one file.

**A one-night stay checked in TODAY is due out TOMORROW.** The first version of
the night-audit test created `checkInAtPune(1, …)` and expected it to block
today's close. It did not, and the failure cascaded into three other tests that
inherited the leftover guest. Obvious written down; wrong in the code.

**A test that runs the audit twice is not testing idempotence.** The first run
ADVANCES the date, so the second closes a *different* day and posts a different
night — two charges, both correct. The only thing that can double-charge is a
run interrupted after posting and before completing, so that is what the test
now simulates.

And the wider one: **the calibrated fixture is now mutable.** Since the audit
landed, closing a day at 5EL moves it, and doing so by hand once left seven
tests failing with `expected '2026-08-27' to be '2026-08-25'`. Nothing was
broken — the fixture had been *operated*. `npm test` loads the demo first for
exactly that reason.

---

### 28 · A constraint the schema documents at length and does not have

`005_reservations.sql` spends fifteen lines explaining
`reservations_no_double_booking` — "not unlikely, not the app checks first, but
rejected by Postgres". A concurrency test tried to race it and found
**`pg_constraint` had never heard of it**.

`011_model_additions.sql` drops `reservations.room_id`, and dropping a column
drops every constraint depending on it. That is right: a single room_id could
not record a room move, and the protection moved to `ra_no_double_booking` on
`room_assignments`. But anyone reading 005 — which is where you look when you
ask "are we protected from double booking" — would believe it was still there.

**A migration is history and cannot be rewritten, so the note is the fix.**
005 now says what happens to it and where the guarantee went.

**Testing a thing is how you find out whether it is there.** Six checkpoints
of comments asserted this constraint; the first test written against it found
nothing to test.

---

### 29 · Racing a lock with `Promise.all`, which cannot resolve

The first concurrency helper opened two transactions, issued both inserts, and
`await Promise.all([...])` before committing either. It hung for twenty seconds
and failed on a timeout.

**An EXCLUDE constraint does not reject the second writer — it BLOCKS it**,
holding the statement open until the first transaction ends. Which is the
guarantee under test. Waiting for both statements before committing either is
a deadlock by construction.

The shape that works: `Promise.race` to see which statement landed, commit that
one, then await the other — which unblocks the instant the winner commits and
returns the exclusion violation. That is also the order it happens in at a
front desk.

Both guards were then proved by DROPPING them and watching the tests fail:
*"The same room was assigned to two guests for the same nights"* and *"The
posting was reversed TWICE"*.

---

### 30 · The same wrong question, asked in a second place

`db/verify-backup.sh` checked receipts with `sum(amount) from payments` and
reported ₹3,97,141.93 against an expected ₹3,97,041.93. Exactly ₹100 out — the
API suite posts a payment and reverses it, the ledger entry cancels, the
receipt row stays.

That is **defect 25 again**, in a file written after defect 25 was recorded and
fixed. Correcting a query in one place does not correct the question in
another.

**When a figure has a definition, the definition belongs in one place.** The
Manager Report, the API test and the backup verifier all needed "money the
hotel actually has", and all three wrote it out longhand.

---

### 31 · An invoice that taxed the tax

The demo's real eZee export records tax on extras as its own posting: category
`'tax'`, the money in `amount`, nothing in `tax_amount`. The first invoice
summed every non-payment row into the taxable value, which put **₹925 of tax
into the taxable base** and then charged CGST and SGST on it.

Tax on tax, on a document a guest hands to their accountant.

**A posting's CATEGORY says what it is; the populated field does not.** The
split is now by category — supplies (with `discount` reducing them) into
taxable value, `tax` postings into tax — and the printed lines exclude tax
rows so the page cannot disagree with its own footer.

---

### 32 · Reading a migration instead of the database, twice more

Writing Stage 8 I read `004_guests.sql` and used `guests.id_number`. That
column moved to `guest_documents` in 013, because a group-level read let a
clerk at any property see the passport of a guest who had only stayed
elsewhere.

That is the same mistake as defect 28 — trusting the file that CREATED a thing
over the database that now holds it. Twice in two checkpoints.

**Before writing SQL against a table, ask the database what its columns are.**
`information_schema.columns` takes five seconds; the migration that created the
table may be nine files out of date.

---

### 33 · A partial index cannot see other rows

`unique (folio_id) where credits_id is null` looked like "one invoice per
folio". It is stricter than that: once an invoice is credited, GST requires a
CORRECTED invoice, and the index still counts the credited one. A predicate
cannot ask whether some other row points at this one.

The harm being prevented was a double-click producing two numbers for one
stay — a **race, not a rule**. Held now with `pg_advisory_xact_lock` on the
folio for the length of the issuing transaction: the second click waits, finds
the first invoice, and is answered with it.

**Ask whether the thing being prevented is a rule or a race.** Rules go in
constraints. Races go in locks. A constraint used for a race is usually too
strict in a way nobody notices until the exception case arrives.

---

### 34 · A verifier that fails on sound backups

`db/verify-backup.sh` asserted `count(*) = 25` tables with RLS and `= 37`
policies. Migration 025 added one of each, and a completely sound backup
reported **two failures**. It also asserted the demo property's figures against
a dump taken after `db/tests/run.sh`, which rebuilds with test fixtures only —
**eight failures, nothing wrong**.

A verifier that cries wolf is worse than none: people learn to disregard it,
and it is the one thing they must not disregard.

Both fixed by asking better questions. The structural check is now the
INVARIANT — *no table carrying `hotel_id` lacks RLS or a policy* — which stays
true when a table is added. The data checks run only when the demo is in the
dump, and say so when it is not.

**A check that must be edited on every migration will eventually be edited
wrongly, or ignored.**

---

### 35 · A counter that was honest until it wasn't

`getInvoiceSeries()` read the FIXTURE, and its comment said exactly why:

> "Still from the fixture rather than the database, because there is no
> `invoice_series` row to read until something issues from it. Modelling a
> counter nothing increments would suggest it is being kept."

Correct — right up to the moment issuing landed. The screen then showed the
fictional `5EFH154` **beside real invoice numbers from the real series**, which
is worse than the placeholder it was: a placeholder next to nothing reads as a
placeholder; a placeholder next to real data reads as data.

**A stub's comment is its removal condition, and meeting it is not the same as
noticing you met it.** Third time in three checkpoints something carried its
own condition and needed finding: `isDemoProperty()`, the night audit's Run
button, and this.

**When a stage lands, grep for the stubs that named it.**

---

### 36 · A list that invited a button it could only refuse

After issuing, the Invoices screen still read "58 ready to bill" and still
offered Issue on the stay just billed. The API would have answered
`duplicate`, so nothing would break — but a clerk would press it, get an
ambiguous result, and learn to distrust the screen.

Fixed by making `billable` report the invoice already issued against each
stay, so the row shows its NUMBER where the button was.

**Reported, not filtered out.** Hiding the row would break the stay's link to
its number and send someone hunting for where the invoice went.

---

## Verification traps

### Never test a Tailwind utility by injecting the class at runtime

The v4 JIT generates utilities by scanning source. A class injected into the
DOM by script was never scanned, so it returns the default and proves nothing —
in either direction. This produced a false alarm at CP0.

Probe a real rendered element, or read the registered custom property:

```js
getComputedStyle(document.documentElement).getPropertyValue('--color-ink-900')
```

### `document.styleSheets` enumeration is unreliable here

Returned 0 selectors on a fully styled page. Computed styles are ground truth.

### Programmatic `.focus()` mismeasures

Reports `outlineStyle: none, boxShadow: none` even on components that
demonstrably carry `focus:ring-2`. Focus *trap* can be checked structurally —
`document.querySelectorAll('[data-radix-focus-guard]').length` is 2 when a
Radix focus scope is active — but ring rendering and key handling cannot.

### A check that cannot fail is not a check

Two versions of the same mistake, a week apart in the same file:

1. A `// Verify totals` block computing three values into **unused variables**.
   It looked checked. The numbers it asserted were wrong by 13 nights.
2. A correct `throw` on drift that **nothing imported**, so it never executed.

**An assertion's reach is its import graph.** Every fixture that claims to
reconcile to a real report has a test that imports it. Both failure modes were
confirmed by deliberately breaking the fixture and watching the suite fail.

---

## Environment

| | |
|---|---|
| `npx tsc --noEmit` | **Reports zero errors on a broken build.** `tsconfig.json` is a solution file with project references and compiles nothing. **Always `tsc -b`.** |
| `npm install` | Run from **PowerShell, not Git Bash**. TLS-inspecting proxy (AVG Web/Mail Shield) makes Git Bash installs fail on certificates. |
| PowerShell 5.1 | **Never round-trip a file through it.** `Get-Content` without `-Encoding` decodes as ANSI and mangles UTF-8. It corrupted nine files in the CRS and survived a typecheck, a build and 103 tests. Use Python for file edits. |
| Vite overlay | Shows only the **first** module that fails to resolve. Fix it and the next surfaces. If `index.ts` lists modules that do not exist, you walk down the list one reload at a time. |
| Import vs type errors | An import failure white-screens the app. A type error does not — Vite strips types without checking them, so `tsc` can show 179 errors while the page renders. |

---

## The seam

**Rule 2 exists because the CRS replaced its entire backend by rewriting one
folder instead of touching 34 screens.** It only works if nothing reaches
around it, and a screen importing a fixture directly fails *silently* —
everything still renders.

So it is enforced by a test that walks `src/` and fails on any import of
`@/data/fixtures` outside `src/data`.

**Every module exports both surfaces** — named functions *and* an `xxxRepo`
object — because two conventions were in use and neither could be made to win.
One implementation, two surfaces, no second copy to drift.

**Each shim exports exactly one name.** `export *` across fourteen modules
cannot collide when only one module owns each name. A `getRoom` exported from
two modules is a runtime error the type-checker does not catch:

```
SyntaxError: ... contains conflicting star exports for name 'getRoom'
```

---

## Working with the CRS library

`src/components/ui/` is **ported from `D:\fidato crs`, not written here.**
Thirteen of fifteen files are byte-identical, verified by MD5. The two that
differ are the two that were authorised to.

**Porting it found two real accessibility defects that are live in production
today** — bugs invisible in the CRS alone, visible the moment the same code ran
in a second application:

- **`Checkbox` and `Switch` have no accessible name.** Confirmed from the
  browser's accessibility tree. Radix renders `role="checkbox"` on a `<button>`,
  so the wrapping `<label>` never names it. A screen reader announces
  "checkbox, not checked" with no indication of what it controls.
- **Nothing uses `focus-visible:`.** All eight focus utilities sit on the five
  input components. `Button`, `Checkbox`, `Switch`, `Tabs` and `Pagination`
  carry no focus styling at all.

**Neither is fixed here.** Fixing a ported file in one tree and not the other
is drift, found later by a stakeholder rather than a test.

### Signatures worth knowing before you guess

Guessing these cost twenty type errors once:

```
PageHeader   title · description · breadcrumbs · actions · badge   (not subtitle)
Section      title · description · actions
CardHeader   title · description · actions
DataTable    rows · columns · rowKey        (not data)
Field        children is a RENDER PROP: ({ id, describedBy, invalid }) => node
Stat         label · value · hint
EmptyState   icon · title · description · action · compact
Avatar       name · color · size
```

---

## Two processes, one folder

A builder agent and this session wrote `D:\fidato pms` simultaneously for two
hours. It destroyed a day's work and was **unrecoverable, because there was no
git**.

The pattern, five times over: reach zero errors, one file gets overwritten
within minutes, back to broken.

**What actually helped**, in order:

1. `git init` — this class of incident becomes `git checkout`
2. Working on a branch, so `main` holds a known-good state
3. Staging copies in `docs/restore/`, which git now makes redundant
4. Making every module the index expects **exist**, even as a shim, so a
   half-written layer cannot white-screen the app

See `AGENTS.md` for the ownership protocol that prevents it.

---

## Numbers that are real, and one that is not

Everything below came from eight production exports in `D:\reports fidato`,
dated 25–26 August 2026.

```
17 rooms    sellable on an ordinary day        Manager Report, Room Summary
18 rooms    physically exist — 308 is normally out of service
431         available room-nights, 1–25 August (PTD, 25 days, NOT a month)
132         nights sold in that window
30.63%      occupancy · ADR ₹3,178.63 · RevPAR ₹973.50
```

**`431` is a 25-day figure.** The Manager Report header reads
`As on Date 25/08/2026  PTD 01/08/2026`. Reading it as a full month produces a
33% overstatement — and once did, along with an invented explanation about
rooms being out of order. The arithmetic closes exactly:

```
19 days × 17 + 6 days × 18 = 431        132 / 431 = 30.63%
```

**The 175-room group total is unverified** and must not appear anywhere. It is
also *not* the same number as the 175 nights sold in 2026 — two unrelated
figures that happen to match, which is exactly how a wrong number reaches a
deck.

---

## Money

`format.ts` uses the `en-IN` locale and was already correct — do not hand-roll
a currency string.

```
money(993190)        → ₹9,93,190
moneyPrecise(...)    → ₹9,93,190.00
negative             → -₹11,485.07
```

**Negative money is normal, not an error state.** The real exports carry
`-784.00` (a guest overpaid), `-11,485.07` (an OTA owes the hotel), `-217.93`
discount, `-0.14` round-off. Never assume a money field is positive, never
render a negative as blank, never parenthesise it away.

**Zero rows and empty reports still print.** The real No Show report for
25 August has no rows at all — just property, title and date. That is correct
behaviour, not an `EmptyState` with a "create one" button.
