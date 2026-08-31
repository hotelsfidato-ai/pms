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

### 37 · A test written to match broken output

`amountInWords(1)` produced "One **Rupees** Only". The test I wrote for it was:

```ts
expect(amountInWords(1)).toBe("One Rupee Only".replace("Rupee ", "Rupees "));
```

I wrote the correct string and then transformed it into the wrong one so the
test would pass. That is not a test; it is a record of a bug with a green tick
beside it.

**If the expected value needs massaging to match the output, the OUTPUT is the
thing to change.**

A related one from the same file: I asserted `amountInWords(1.005)` →
"One Rupee and One Paisa". It returns one rupee flat, because the float nearest
1.005 is 1.00499999999999989 — arithmetically right for the value actually
held. The fix there was the opposite: correct the TEST, and write down why.
Telling the two cases apart is the whole skill.

---

### 38 · A credit note whose lines did not sum to its own total

The printed credit note showed the line item as **+₹8,417.97** and the total as
**−₹8,838.87**. The lines are read from the folio, where charges are positive;
only the stored totals were negated.

A document whose lines do not add up to its own footer is the one thing an
invoice may never be — and it is exactly what an assessor checks first.

**When a document has a sign, every figure on it carries that sign.**

The banner had the same shape of problem: "It cancels an earlier tax invoice",
without saying which. The id was on hand and it is a uuid; the NUMBER had to be
fetched. A reference a reader cannot use is not a reference.

---

### 39 · The application shell would have printed with the invoice

`.no-print` existed in the stylesheet and nothing wore it. The sidebar, the
top bar with its search box and notification bell, and the account menu were
all inside the print output — and `overflow-y-auto` on `<main>` clips to the
viewport, which on paper means **one page and the rest silently gone**.

The invoice page could not fix this from inside itself; it is not the thing
wrapping it.

**Print is a layout the shell participates in, not a property of one page.**

---

### 40 · A boolean where a document should have been

Check-in sent `idCaptured: true`. The client asserted a passport had been
looked at, the server filed the assertion into a note, and
**`guest_documents` — a table since migration 013 — was never written to by
anything.** A hotel could tick that box ten thousand times and have no passport
number in the database.

Two things it broke downstream, both of which had been sitting there:

- the Form C register printed "not on record" for every foreign national
- the C-Form report on the reports index still said *"needs passport capture at
  check-in"*, which had been true for the whole project

**Capture is DERIVED from a document arriving, never asserted by a client.** A
type and a number, or a stated reason for skipping. Nothing else counts.

And 013 had a SELECT policy and an INSERT policy and **no UPDATE** — with
`guest_id` as the primary key, so a returning guest's renewed visa could not be
recorded at all. The second insert conflicted and there was no other way in.

---

### 41 · The demo loader leaked its guests, 249 of them

`guests` carries no `hotel_id` — a guest belongs to the group, so a returning
one does not re-present their passport at each property. Which means the
loader's `delete from hotels` cascades the reservations and **leaves every
guest standing**.

Eight reloads had left **279 guest rows behind a demo that promises 30**, and
214 of them had no stay at any property. The Directory counted them.
`app.identity_missing()` scanned them. Nothing had ever compared the guest
count to the figure the demo advertises, so nothing said a word.

Found by opening a screen: eight rows named "Lata Bhosale".

**A fixture that grows every time you reload it is not a fixture.** The loader
now releases guests with no stay anywhere — and then COUNTS them, because a
cleanup nobody measures is one nobody knows failed (defect 25, again).

---

### 42 · Splicing by the first match when the pattern appears twice

`{!idCaptured && (` occurs twice in CheckInFlow: once opening the skip-reason
field in the ID step, once in the review step. A script that took
`next(... if line == ...)` replaced the wrong one and left the file
syntactically broken in a way `tsc` reported three lines further down.

**When editing by pattern, check how many times the pattern occurs.** Anchor on
something unique inside the block — here, the sentence `ID not captured` — not
on the opener.

---

### 43 · A revenue total that ignored every discount

The Manager Report reported **₹4,60,697.76** of revenue against a ledger
holding **₹4,59,697.76**. `w.discount` was fetched from the database, given a
type, put on the `Window` object — and never read:

```ts
const net = (w: Window) => round(w.room + w.extra);   // no discount
```

So the total was higher than the ledger by every discount the property had
ever given, and the report's own rows **did not subtract to its own closing
balance** — 4,60,698 − 3,97,042 is 63,656, and it printed 62,656.

Found by building the Guest Ledger over the same postings and watching two
reports of one figure disagree by exactly ₹1,000, which was the single discount
in the fixture.

**Second time a Manager Report column has been selected and not read** — the
first was the dead `blocked` SQL that compared two constants. A column fetched
and unused is worse than one never fetched: it looks accounted for.

Discount is now a printed ROW as well as a subtraction, because **a total
nobody can reconstruct from the rows above it is a total nobody can check.**

---

### 44 · A GST register dated by the wall clock

`reports/gst-sales` filtered invoices on `issued_at::date`. An invoice raised
at 09:00 on the 29th for a stay that closed on the 25th fell **outside an
August register entirely** — the demo returned zero rows against a property
that had issued one.

A GST return is filed by DOCUMENT date, and a hotel's document date is the day
it was operating in, not the moment somebody pressed the button. Filtering and
display both use `business_date` now; `issued_at` remains the audit timestamp.

**Every date in a hotel system has to answer "whose day is this?" before it
answers "when".**

---

### 45 · The owner could not see who worked for him

`staff` carried exactly ONE policy:

```sql
staff_self   (id = app.current_user_id())
```

So every caller saw one row — their own — **including the group owner**. The
Users screen would have listed one person to everybody and a group admin could
not administer users at all.

It went unnoticed for the whole project because the frontend GENERATED that
list from the permission matrix: one invented person per role, all at a
property named from a fixture. The moment it read the database the gap
appeared.

**A screen that invents its data cannot discover that the data is unreachable.**

Fixed with two policies — a group admin reads everybody, and anyone reads staff
they share a property with — asserted in `rls.sql` as `pms_app`.

---

### 46 · A recursion cycle that was already there, waiting

The obvious admin policy reads `staff` to find out whether the caller is a
group admin:

```sql
using (exists (select 1 from staff me
                where me.id = app.current_user_id() and me.is_group_admin))
```

A policy ON `staff` that SELECTS FROM `staff` evaluates itself forever.
Postgres said `infinite recursion detected in policy for relation "staff"`.

The fix is the SECURITY DEFINER pattern `app.current_user_id()` already uses —
but the interesting part is what it uncovered: **`staff_hotels_admin`, added in
migration 020, read `staff` inline**. Harmless while nothing on `staff` read
`staff_hotels`. The new colleague policy reads it, and the loop closed:

```
staff  →  staff_hotels  →  staff  →  ...
```

A latent cycle, dormant for six migrations, waiting for whoever next wrote a
policy in that direction. Rewritten at its source rather than routed around.

**When a policy needs a fact about the caller, get it from a SECURITY DEFINER
function — never from a table that is itself protected.**

---

### 47 · Assertions about RLS, written where RLS does not apply

The staff-visibility assertions went into `db/tests/suite.sql` first. It runs
as the **superuser**, which bypasses Row Level Security completely — so they
reported *"a clerk cannot see another property's staff: 1 leaked"* against
policies that were correct, and the "sees everybody" one passed for a reason
that had nothing to do with policy.

`rls.sql` exists for exactly this and connects as `pms_app`. Its own header
says so: *"a superuser bypasses RLS and would report success on a completely
open database."* I wrote the assertions in the wrong file anyway.

**Before asserting who can see what, check which role the test connects as.**

---

### 48 · Every button in the system was a mouse target

`SIZES` in `Button.tsx` ran `sm: h-8` (32px), `md: h-9` (36px) — only `lg`
reached 44px. The invoices screen at 375px rendered **sixty** "Issue" buttons,
the primary action of the page, at 32px.

Nothing looked wrong. A screenshot of that page reads as a normal dense table;
the number is the only thing that says otherwise. Found by measuring every
control on 23 screens, not by looking at them.

The fix keys off `pointer-coarse:`, **not** a `sm:` breakpoint. What makes a
control hard to press is the finger, not the window width — a 32px button is
fine in a narrow desktop window and miss-prone on a phone, and the browser
already knows which one it is. `min-height` beats `height` in the cascade, so
the desktop row keeps its density and grows only under a thumb. Verified in
both directions: coarse → 44, fine → 32.

**Measure tap targets. Do not look at them.**

---

### 49 · A connectivity flag that was a button, and a failure that vanished

Housekeeping had `const [online, setOnline] = useState(true)` with a
"Simulate offline" button as the only thing that ever changed it. So on a real
phone that genuinely lost signal in a stairwell — the exact case the screen was
designed for — the flag stayed `true`.

Worse, `setHousekeeping` converts an `ApiError` into `{allowed:false}` but
**re-throws** anything else. A dropped connection is a `TypeError`, not an
`ApiError`, so it threw straight past `apply`: no toast, no queue, no refusal.
The file's own header says *"an action that silently does nothing is worse than
one that refuses"*, and that is precisely what it did.

The demo prop was hiding the only case that mattered. `navigator.onLine` plus
the `online`/`offline` events costs nothing and is true.

One trap in the repair: `navigator.onLine` reports `true` on a wifi with no
route out, so a failed drain sets `online = false` rather than retrying —
`queue` is a dependency of that effect and a retry there spins.

**A simulated condition tests the simulation.**

---

### 50 · Seventeen pixels per day

The tape chart is `grid-cols-[132px_repeat(14,minmax(0,1fr))]`. `1fr` columns
do not refuse to get small, they just get smaller: at 375px the fourteen days
came out at **17px each**, narrower than the numbers printed in them.

No overflow, no error, nothing in any test. A wide instrument does not announce
that it stopped fitting.

The answer was not a redesign — it was the one the rest of the app already
uses for a wide table: a minimum width and a scroll container, so the body
never scrolls sideways and each day keeps 44px. Above 748px `1fr` expands past
the minimum and the desktop chart is byte-for-byte what it was. Confirmed at
1440px: 75px columns, no scrollbar.

---

### 51 · Pinned, and underneath

Panning the chart is useless if the room number leaves with it, so the room
column got `sticky left-0 z-10`. The reservation bars were **also** `z-10`.

That is not a tie the browser breaks in your favour: equal z-index falls back
to DOM order, the bars come later, and every booking slid straight over the
room numbers. Rooms with a reservation lost their number entirely.

Every measurement said the column was pinned, and it was — `roomColumnStaysPut:
true`. It was also invisible. **Only the screenshot showed it.** Three sticky
layers now have their order written down in one place next to the constant,
because this is exactly the kind of thing the next person rebalances by
accident.

**A measurement confirms geometry. It does not confirm you can see the thing.**

---

### 52 · The gate that empties the thing you are about to check

`db/tests/run.sh` has `DB="${DB:-fidato}"` — the same database the API and the
app use — and drops it from zero. That is correct and is the whole point: you
cannot prove migrations apply to an empty database using a full one.

What it does not do is say so. Run the gates as
`api npm test` → `db/tests/run.sh` and the second wipes what the first loaded.
Found during an audit: the app was showing 5EL with 83 reservations, and the
database had three hotels and four.

The danger is not the empty database, it is what you do next. **Open a screen
at that point and the check passes because there is nothing left to fail** —
the same shape as defect 22, where a self-test ran against fixtures that had
been deleted and returned early. A verification with nothing to verify reports
success.

`run.sh` now prints the recovery line when it rebuilds. Correct order is
run.sh → api test → vitest → verify-backup.

**A test that rebuilds shared state owes you a sentence about what it took.**

---

### 54 · Test fixtures with a seat in the application

An audit of the database, not of any failing test, found `TESTPOS / "Test
outlet"` sitting in **5EL** — the property the whole demo exists to show — and
`TILL / "Till Test Outlet"` plus a ₹100 `Test Dish` in AGR. The POS screen
listed them as real outlets.

Two different causes, one shape:

* `api/test/pos.test.ts` voided every charge it posted (defect 25 taught it
  that) and then left the OUTLET behind. Undoing the money is not the same as
  undoing the fixture.
* The db suite's till block *could not* clean up: `on delete cascade` from
  `pos_orders` fires the freeze trigger on every line, so a settled order
  cannot be deleted at all. The trigger was right; the teardown was
  impossible.

For the second, lifting the trigger to dismantle its own fixture is the
established answer here, not a workaround — `api/scripts/load-demo.ts` lifts
`folio_postings_append_only` for exactly the same reason.

Both teardowns now ASSERT that nothing survived, because a cleanup nobody
measures is a cleanup nobody knows failed — the same sentence that had to be
written for defect 25, about the same file.

**Voiding the transaction is not cleaning up the fixture.**

---

### 55 · One posting cannot carry two tax rates

The till's first settle posted a single folio row with `tax_rate 0` and the
whole tax in `tax_amount`. Postgres rejected it on the spot:

```
violates check constraint "fp_tax_consistent"
```

015 requires `tax_amount = round(amount * tax_rate / 100, 2)` within a paisa,
and a posting carries ONE rate. The demo menu mixes 5% food with 18% packaged
water **on purpose**, so this was not an edge case — it was the second bill
anyone would ring up.

A blended rate does not rescue it either: 680 at an effective 5.76% computes
to 39.17 against an actual 39.20, three paise outside the tolerance.

The constraint is right and GST agrees with it — two rates are two taxable
supplies, and the Sales Register reports them separately. **The settle posts
one row per rate**, and the guest's folio shows the split with the rate in
the description so one restaurant bill becoming two lines is explicable.

**A check constraint that fires on your first real case is a specification
you had not read yet.**

---

### 56 · Fixing the trigger instead of the caller

`pos_order_lines_frozen` blocked the demo loader from deleting its own
property: `delete from hotels` cascades to `pos_orders` and to
`pos_order_lines` by two different paths, and the order can be gone before
its lines are reached, so the trigger read a NULL status as "settled".

The fix I reached for first was to make the trigger tolerate a missing
parent. It looked reasonable. It also let `delete from pos_orders` remove a
settled order outright, and the db suite failed within seconds:

```
pos till | a settled order cannot be deleted at all | expected a failure,
                                                      statement succeeded
```

The narrow answer was to lift the trigger in the loader — which is what that
file already does for `hotels_no_delete`, `folio_postings_append_only` and
`invoices_immutable`. Three precedents were sitting in the same function.

**When a guard is inconvenient, check whether the codebase already has a
sanctioned way to step around it before weakening the guard.**

---

### 57 · Rupees on a document somebody pays from

The printed bill used `money()`, which rounds to the whole rupee. It showed:

```
CGST 2.5%   ₹16        SGST 2.5%   ₹16
CGST 9%      ₹4        SGST 9%      ₹4
TOTAL                            ₹719
```

Those components add to ₹40. The real tax is ₹39.20 and the real total
₹719.20. Nothing was miscalculated — the ledger had it right to the paisa —
but a guest checking the arithmetic on a bill they are paying finds it does
not add up, and they are correct.

`money()` for a dashboard, `moneyPrecise()` for anything a person is handed.

---

### 58 · A headline that stopped agreeing with the table above it

PROGRESS.md carried a stage table of twelve bars and, immediately under it,
**"About 90%."**

The bars sum to 101 of 144. That is **70%**.

Nothing computed the headline. It read 84%, then 87%, then 90% — bumped by
hand each time a section landed, while the bars it was supposedly summarising
were edited separately. Two numbers describing one thing, only one of them
derived, and the derived one was never read.

It survived three audits *of this very file* because an audit checks whether
the gates pass and the screens open. Nobody adds up a bar chart.

This is the rule the whole project runs on — never invent a number, a dash is
an honest answer — broken in the one document whose entire job is to report
numbers, and broken by the person enforcing it everywhere else.

The fix is not a better estimate. It is that the file now says *"add the
filled blocks and divide by 144"*, so the arithmetic is visible to anyone
reading it and cannot silently disagree with itself.

**A summary figure that is not derived from the thing it summarises is a
second source of truth, and it will drift.**

---

### 59 · Every member of staff could list every property

`hotels_read` was `using ( app.is_active_staff() )`. Anybody who could sign in
could enumerate the whole group — code, name, city, **GSTIN**, and each
property's current operating day.

Every other scoped table was correct. No guest data and not one rupee ever
crossed a tenant boundary; RLS held everywhere it was asked to. The roster of
properties itself was the one thing nobody had scoped.

Worse than the policy was the comment sitting above the query that used it:

> *"No hotel filter. RLS applies `hotels_read`, so an Agra clerk and the group
> owner run the same SQL and get different rows."*

They ran the same SQL and got the **same** rows. A comment describing an
intention the code does not implement is worse than no comment, because the
comment is what gets read.

**Found by USE, not by test.** Nothing failed. I created a clerk through the
new admin API, rostered them at one property, asked the API what they could
see, and it named all four. It had been true since the policy was written.

Two things fell out of fixing it:

* The obvious policy — `id in (select app.auth_hotel_ids())` — recurses to
  `stack depth limit exceeded`. That function READS `hotels` to answer "all of
  them" for an admin, and SECURITY DEFINER does not disable row security; it
  runs as the owner, and `hotels` has FORCE RLS, so the owner is subject too.
  **A policy on a table must not read that table**, even through a definer.

* The RLS test for "a clerk cannot grant themselves another property" found
  its target with `select from hotels where not exists (...)`. Once the leak
  was closed that subquery returned nothing, the insert touched no rows, and
  the test failed while the policy was right. **A test that enumerates the
  thing it is proving you cannot enumerate is written the wrong way round.**

---

### 60 · A read-only admin section, underneath as well as on top

`grep -c '<input|<form|onSubmit|<Button'` on the admin page returned **0**, and
there was not a single admin write endpoint. That much was visible.

What was not: the database refused too. Every policy on `staff` and
`staff_hotels` was a SELECT policy, so "can the owner add a member of staff"
was answered no by Postgres regardless of what any screen offered. Building the
form first would have produced a screen that looked finished and failed on
submit.

**Check the bottom layer before building the top one.** The provisioning
function was ready and waiting; the staff policies were not, and both facts
were one query away.

---

### 61 · A custom header that fails as "the server is down"

`x-provisioning-key` was not in the API's CORS `allowHeaders`. The browser's
preflight was rejected, `fetch` rejected without detail, and the screen showed:

> *Could not reach http://localhost:8787. Check the API is running, and that
> it allows this origin.*

The API was running. `curl` succeeded against the same endpoint in the same
second, which is exactly the shape that sends you looking at the server.

The message is not wrong — `src/lib/api.ts` names both possibilities on
purpose, because the browser withholds the difference between a dead server
and a blocked preflight. But a new custom header is the far more likely of
the two, and the allowlist is the first place to look.

`x-pos-key` is deliberately NOT in that list: an outside till is a machine
calling from a server, with no preflight to satisfy.

**A new request header is a CORS change, and its failure looks nothing like
one.**

---

### 62 · A one-level scan of a two-level menu

`navItemFor(path)` walked `section.items` and returned undefined for
`/admin/console` — a path the sidebar was visibly rendering at the time.

Nav items nest: the whole `/admin` group is one parent entry with children,
and `flatNavigationFor` walks `item.children` while my accessor did not. The
two disagreed about what the navigation contains, which is precisely the
disagreement an accessor exists to prevent.

Caught immediately because the assertion said *"the admin console is not in
the navigation at all"* and the test above it had just proved it was.

---

### 63 · The system shipped prices nobody at the hotel had chosen

`room_type_templates` carried a `default_rate`, and `provision_property()`
copied it onto every new property:

```
Standard ₹3,500   Deluxe ₹4,800   Executive ₹6,000   Suite ₹7,500
```

Invented when the templates were written. A property created through the new
admin console arrived priced — on the tape chart, defaulting a walk-in's
tariff, and reaching a folio — looking exactly like the hotel's own rates,
because everything else on that screen is.

The POS menu had this right from the start: 028 ships no dish and no price and
says so in its header. **The same rule was being broken one table over by code
written months earlier, and building the menu correctly did not prompt anyone
to check.**

Found only because the group said, in passing, that prices are updated by the
team and standard nowhere.

The rate is now NULL until somebody sets it, not zero — zero is a claim that
the room is free, and it would post a zero room charge at the night audit and
halve the day's ADR with nothing looking wrong.

**A default value is a claim about the customer's business.**

---

### 64 · Rewriting a function from memory to remove one line from it

032 needed `provision_property_unchecked` to stop copying the template rate.
I retyped the whole body and dropped
`on conflict (hotel_id, fin_year) do nothing` from the invoice-series insert
— which matters, because 025 also opens a series from a trigger on `hotels`.
Provisioning died on a duplicate key at the very first fixture in the suite.

Then, in the same migration, I added a loader update to set the demo's rack
rates "since the templates no longer do" — without checking. `load-demo.ts`
already set them from a `RACK` constant and always had. My update overwrote a
calibrated Deluxe rate of 3699 with 4200.

Two mistakes, one shape: **acting on what I assumed a file contained instead
of reading it.** When the point of a change is to remove one thing, remove one
thing.

---

### 65 · The invented prices had a second home in the frontend

032 removed the prices the templates shipped. It did not remove `RACK`:

```ts
// src/data/repositories/stayview.ts
export const RACK: Record<string, number> = { Superior: 4099, Deluxe: 3699 };
```

Read in two places, and the second is the one that mattered:

* the tape chart — `RACK[type] ?? 0`, so a property whose types are not
  called Superior or Deluxe showed **₹0** across the whole chart
* **WalkInFlow** — `RACK[room.type] ?? 4099`, so a clerk taking a walk-in
  at such a property saw a tariff of **₹4,099** pre-filled, and the
  "is this a discount that needs a reason?" check measured against that
  same invention

I had fixed this one layer down the day before — the API now refuses a
walk-in with no rate — and the form above it still filled one in.

**The same defect had two homes and fixing the database did not visit the
second.** Exactly the shape of defect 63, where building the POS menu
correctly did not prompt me to check room types. Grep for the VALUE, not
just the mechanism: `4099` would have found this in seconds.

The rate now travels from `room_types.base_rate` through the rooms
endpoint to both callers, and is null when unset. The chart prints a dash.

---

### 66 · Two controls on the busiest screen that did nothing

The tape chart carried:

```tsx
<Segmented value="Room type" onChange={() => undefined} ... />
<Button size="sm">Assign room</Button>
```

A grouping toggle hardcoded to one value that discarded every change, and
a button with no handler at all. Both sat in the header of the screen a
clerk looks at most.

A scan of every `<Button>` and every `on*={() => undefined}` in `src/`
found exactly these two plus one false positive (a `DialogTrigger asChild`,
correctly wired). So the class was small — but nobody had ever counted it,
and the user found them by clicking.

Floor grouping was implementable with no API change: every room already
carried its floor. **A control that promises a view the data can already
produce is worse than one that is missing.**

---

### 67 · Guessing a constraint's allowed values, twice in one session

The assign-room insert used `reason = 'assignment'`. `ra_reason_valid` allows
exactly six: arrival, move, upgrade, downgrade, fault, group_consolidation.
Postgres refused it and the route answered 500.

Earlier the same day I rewrote a provisioning function from memory and dropped
an `on conflict` clause (defect 64). Same shape, twice: **acting on what I
assumed the schema contained instead of reading it.** One `pg_get_constraintdef`
would have taken ten seconds.

`arrival` is the right value — this IS the assignment for their arrival, it
just happens the night before. A type change is surfaced to the clerk rather
than encoded as upgrade/downgrade, because nothing here RANKS the room types
and picking a direction would be inventing again.

---

### 68 · Counting across every property and reporting it as one

I claimed "four reservations have no room assigned" and built a dialog for
them. The dialog then correctly said **"Every arrival has a room."**

The count was right and the claim was wrong: those four were at AGR and PUN.
5EL — the property on screen — had none. My query grouped nothing:

```sql
select count(*) from reservations r where ... -- no hotel filter
```

In a system whose entire architecture is per-property isolation, a query with
no `hotel_id` in it is not a measurement of anything a user can see.

**The screen showing "none" was the thing that caught it**, which is the whole
argument for opening it rather than trusting the number that motivated the
build.

---

### 69 · A screen that looked deliberately empty and was simply broken

`GET /:code/rates` in billing.ts built a CTE:

```sql
types as (select id, name, base_rate from room_types ...)
...
group by t.id, t.name, t.base_rate, t.sort_order
order by t.sort_order
```

`sort_order` is not in the CTE. **Every call to that endpoint has always
returned 500.** The Rates screen therefore showed an empty state — and I
audited it twice, recording it both times as *"a real screen with an honest
empty state pointing at Stage 9"*.

It was not honest. It was a failed request wearing the same clothes.

**An empty screen and a broken one are indistinguishable from the outside.**
The only thing that separates them is checking the response, which an audit
that walks screens does not do. Two audits called this correct.

---

### 70 · Two different questions arriving at one path

The new rate-management endpoints were written as `/:code/rates` — which
billing.ts already owned. Hono matches the first mount, so my handler never
ran and the request fell through to the broken one, whose 500 I then spent a
round trip attributing to my own query.

They are genuinely different questions: `/rates` is the rate CALENDAR
(availability and achieved ADR by date), and what a room COSTS is what the
navigation has always called rate-plans. Moved there.

**Grep the route table before adding a route.** Nothing warns you; the older
mount just wins, quietly.

---

### 71 · Backticks inside a template literal, after reading the warning

Annotating the CTE fix, I put `column t.sort_order does not exist` in
backticks — inside a SQL template literal, which ends it. Three parse errors.

`operations.ts` carries this exact warning, in a comment, about the second
time it happened there: *"A backtick inside one ends it — that is the second
time, so: no backticks in SQL."* I had read that comment earlier in the same
session while looking at the assignment insert.

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
