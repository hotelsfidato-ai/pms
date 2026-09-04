# Memory — what this project learned the hard way

Every entry here cost something. Read it before you repeat it.

---

## Ten faults that repeat

146 entries below is a reference, not a reading list. These are the patterns
that have recurred, with the count and the check that would have caught each.
**If you read nothing else here, read this.**

| # | The fault | Seen | The check |
|---|-----------|------|-----------|
| 1 | **Answered from memory instead of the file.** Quoted a function, a screen, a limit or a schema I had not opened. | 32 · 64 · 78 · 85 · 87 · 90 · 91 · 108 | Open the file in the same turn you describe it. |
| 2 | **Claimed it worked without opening the screen.** Typecheck, tests and build all clean; the page was blank, inert, clipped, or signed the clerk out. | 19 defects | Open the screen. Every time, at 375px, and with the server stopped. |
| 3 | **Test debris left in the shared demo database.** Phantom guests and bookings nobody can tell from real ones. | 27 · 41 · 54 · 79 · 100 · 112 · 114 · 115 · 116 | Count rows before and after a run — do not grep for teardowns. |
| 4 | **A test that could not fail.** Vacuous assertion, swallowed error, filtered exit status, wrong verb. | 8 · 18 · 22 · 25 · 34 · 37 · 47 · 84 · 97 · 111 | Break it on purpose and watch it go red. |
| 5 | **Invented a number.** A price, a total, an occupancy, a zero standing in for "nobody knows". | 5 · 35 · 43 · 58 · 63 · 65 · 68 · 106 | A dash is honest; a zero is a claim. Derive it or show a dash. |
| 6 | **A rule written in N places, wrong in one.** The copy nobody remembered was the one that ran. | 30 · 65 · 96 · 102 | Grep the constant before you write the second copy. One definition. |
| 7 | **Order of operations against a guard.** Resized before moving, deleted a parent before a child, re-enabled a trigger mid-teardown. | 101 · 103 · 104 · 115 | A teardown is a migration run backwards, with the same ordering rules. |
| 8 | **Blamed the code for the environment**, or broke the environment myself. Empty database, stale API, TLS interception, a contaminated reproduction, a destructive measurement. | 72 · 77 · 92 · 94 · 95 · 109 · 119 | Reproduce twice from clean. Measure on a scratch copy, never the live one. |
| 9 | **Guessed the schema instead of querying it.** Constraint values, column names, a uuid column fed a slug. | 13 · 28 · 67 · 82 · 83 · 113 | `\d table` costs one command. Column POSITION is not column NAME. |
| 10 | **Built every piece and never wired the act.** The endpoint, the function and the screen all existed; nothing called them. | 16 · 24 · 81 · 118 | Trace the click through to the write before calling it done. |

Two habits sit under all ten: **read the source in the turn you describe it**,
and **measure rather than infer**. Nine of the ten were caught by an audit or by
opening a page — not by a gate.

And three of these rows are not ten separate mistakes but three decisions
still in force. They are written up as **D1-D3** in the section above,
because a fault whose cause is still standing comes back wearing
different clothes.

---

## Decisions that keep producing defects

A defect is a thing that went wrong once. A DECISION is the thing that
keeps producing them. This section is for the second kind, because
fixing eleven symptoms and leaving the cause in place is how a fault
comes back wearing different clothes.

---

### D1 · The tests shared the database the app was using — CLOSED

**The decision:** all 12 files in `api/test/` connect to the live
`fidato` database — the same one the demo loader fills, the same one
the dev server serves, the same one somebody is clicking around in.

**What it produced before it was fixed:**

| | |
|---|---|
| 27 · 41 · 54 · 79 · 100 | fixtures left behind, seen by users as real |
| 112 | a test staff row that had been "an employee" for months |
| 114 · 115 · 116 | four files leaking 7 guests, 6 bookings, 35 postings a run |
| **120** | a teardown that deleted a REAL booking somebody had just made |
| 92 · 109 | the demo wiped by a gate, twice read as a code bug |

That is **eleven defects from one decision**, and they alternate
direction: clean up too little and the demo fills with phantoms, clean
up too much and real work disappears. Both are the same root — a test
that has to reason about which rows are somebody else's is a test doing
a job it should never have been given.

**The tell:** every one of these fixes made the teardown *cleverer*.
`id <> all($2)`, pid-tagged fixture names, `moduleBefore`, recording ids
in `beforeAll`. That cleverness is load-bearing and it is all pure
overhead — it exists only because the database is shared.

**THE PATTERN IS ALREADY IN THIS REPO AND WAS NEVER APPLIED HERE.**
`db/verify-backup.sh` creates a scratch database, restores into it,
asserts, and drops it *whether it passes or fails* — its own comment
says "It is never the database the app uses." `db/tests/run.sh` builds
from zero for the same reason. The API tests are the one gate that
skipped it.

**What to do instead:** give `api/test` its own database — created from
the migrations plus the demo loader, torn down at the end. Then no
teardown needs to know what was already there, defect 120 cannot happen
in either direction, and the tests can run while somebody is using the
app.

**FIXED.** `api/scripts/with-test-db.sh` creates `fidato_test_<pid>`,
applies the 61 migrations, seeds the fixtures and the demo, runs vitest
against it, and drops it whether it passes or fails. `npm test` points
there; `npm run test:live` keeps the old behaviour for anyone who
deliberately wants it.

**Proved by measurement, not by reading the script.** A real banquet
booking was put into live `fidato`, every table in the database counted,
the full suite run, and every table counted again:

```
54 tables · unchanged · BQ-LIVE-0001 still there
```

Under the previous arrangement that run deleted it.

**Two things it did NOT do**, so this entry is not read as more than it
is. The demo staff come from `db/tests/suite.sql` rather than a
migration, so the wrapper has to apply the suite before the loader —
`load-demo` fails on `undefined.id` several hundred rows in otherwise,
which reads like a loader bug and is a missing fixture. And the
defensive teardowns in the twelve test files were KEPT rather than
deleted: they are now belt-and-braces instead of load-bearing, and
`test:live` still exists, so removing them would trade a real safety net
for tidiness.

**The rule still stands for anything that touches a shared database:
delete by what you created, never by tenant.** `where hotel_id = $1` in
a teardown is the shape of defect 120.

---

### D2 · Measuring against the working database

**The decision** (defect 119): to find out how many migrations survive a
re-run, I ran all 59 against live `fidato`. Eight failed, which was the
answer — and a failing migration does not fail cleanly. Half of
`013_policies.sql` applied, `staff`'s RLS policy went recursive, and
then `drop database` failed too because the cluster's catalog was
damaged. The cluster had to be rebuilt.

**The same root as D1**: a destructive act aimed at the one database
that matters. And the same fix was already sitting in
`db/verify-backup.sh`.

**The rule:** a measurement that can change state runs on a scratch
copy. If the question is "what happens when I run this against a real
database", the answer is worth having and the database is worth
copying first.

---

### D3 · Building where the shell has to parse what I wrote

**The decision** (defects 74, 122): writing files with prose,
apostrophes and dollar-quoted SQL through `cat << 'EOF'`. Six failures
across two sessions, all identical, none about the content.

**The rule:** the file tool writes files. A script that edits files gets
written with the file tool too, then run. Reach for a heredoc only for
something with no quotes in it.

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

### 72 · I contaminated my own reproduction, then reported it as a defect

The terminal appeared to create phantom empty orders. I cleared the `pos_orders`
table, reloaded the page, waited, and found an order with five lines — and said
so: *"reproduced with zero clicks"*, *"a real bug"*.

It was not. The browser still had the previous page live, holding an open order
in React state and earlier queued interactions resolving into it. Clearing the
database underneath a running client and then reloading is not a clean slate; it
is two states colliding.

With a genuine clean slate and `read_network_requests` watching, loading the
terminal issues **only GETs**. Zero orders, zero lines afterwards. The phantom
rows were my own automation — `tap()` calls and a coordinate click landing on a
re-rendered layout.

**Clear the client, not just the database.** And the network log answered in one
call what three rounds of theorising did not: when asking "what did this page
do", read what it actually sent.

---

### 73 · Eleven-pixel text, used one hundred and eighty-nine times

A UX pass that measured rather than looked. Sweeping eight screens and
counting every leaf node rendering below 12px:

```
tape chart   74      invoices  78      admin console  84
```

All of it one token: `--text-2xs` at 0.6875rem — **eleven pixels** — used 189
times, more than any size except body. It carries the metadata a clerk reads
all day: room codes, timestamps, who set a price, why a room is blocked.

The bottom of the scale was also not a scale. 11, 12, 13, 14, 15px are five
names for what an eye reads as one size, and body text sat at 14 against a
16px guideline for anything held in a hand.

Every step below `lg` moved up one notch — same six sizes, same order, so
nothing needed restyling. Result, measured the same way: **zero sub-12px
nodes on eight screens**, at desktop and at 375px, with the tape chart still
at 44px columns and all seventeen room rows.

**A design token used 189 times is not a detail.** One line fixed a
readability complaint across forty-eight screens, and no screen-by-screen
pass would have found it — every individual use looked deliberate.

---

### 74 · Three escaping failures writing one test

Writing the assertion that guards the floor, through a shell heredoc:

* `\s` in a template literal became `\s`, which is just `s` — the pattern
  matched nothing while reading correctly
* `"\n"` became a literal newline inside a JS string, breaking the file
* only `indexOf`, which needs no escape at all, survived

Three attempts on one twelve-line function. **When writing code through a
heredoc, prefer constructs with no backslashes** — the escaping has to survive
bash, Python and the JS parser, and each layer is a chance to lose it.

---

### 75 · A till that made six taps into six lines

Tapping a dish inserted a row unconditionally. A table ordering six butter
rotis produced six rows reading **"1 x Butter Roti"** — on the kitchen copy
and on the guest's bill. I had seen it on screen two turns earlier
(`1x Paneer Tikka` twice in one bill) and read it as test noise.

Every till in the trade increments instead, and a waiter expects it to. The
match is on the item AND the note, because "Paneer Tikka" and "Paneer Tikka,
no chilli" are two different things to a kitchen and must stay two rows.

Three more standard controls were missing entirely, all of them supported by
the API already:

* **quantity stepper** — "make that two rather than three" meant striking the
  line and re-adding, which leaves a cancelled row on the kitchen copy for
  something the guest is still getting
* **per-line notes** — the column and the endpoint have carried one since 028
  and nothing ever sent it, so "no chilli" reached the kitchen by shouting
* **menu search** — fine across sixteen demo items, unusable across a real card

**The API had the capability and the interface never offered it.** Worth
checking, for any endpoint, whether anything actually calls it with the
optional arguments.

---

### 76 · A till the kitchen never heard from

The POS could take an order and settle a bill. Nothing in between. A waiter
rang up a biryani and then **walked to the pass and said "biryani"** — exactly
what the paper system already did, so the till was making nobody's job easier.

Petpooja, Posist, Gofrugal — every POS in this market treats **KOT** and
**BILL** as different acts, because they happen at different times to
different people. Save-and-KOT fires the kitchen several times per table while
the guest keeps ordering; Bill happens once, when they leave. Collapsing them
means either the kitchen learns about the order at payment, or the bill is
settled before the food is cooked.

Two design points worth keeping:

* **Status lives on the LINE, not the order.** A table's starters are served
  while its mains are on the fire. An order-level status cannot say that, and
  the pass needs to know which DISHES are ready.
* **A struck line the kitchen already had is a VOID, not a disappearance.**
  Cancelling something nobody started is free; cancelling something in a pan
  costs food, and the ticket must say CANCELLED rather than vanish.

**"Take inspiration from X" was worth taking literally.** Looking at what the
market standard actually does found a missing act, not a missing style.

---

### 77 · The API does not reload, and I read a stale endpoint as a bug

`Put back` on an out-of-order room failed. The log said `string_to_uuid` on
`$1`, which meant the frontend had sent `undefined` where a block id belonged.

The block id was there. I had added it to the projection in `property.ts` and
the type had compiled. What I had not done was **restart the API**: `npm run
serve` is `tsx src/server.ts` with no watch, so every edit under `api/src`
sits inert until the process is killed. The running server was still returning
blocks with no `id`.

**After any `api/src` edit, restart before testing.** `npx tsc --noEmit`
passing proves the code compiles, not that it is the code answering the port.

---

### 78 · I wrote a folio posting from memory, again

Defects 64 and 67 were rewriting SQL from memory instead of reading the
schema. I did it a third time, on the retention posting, and invented:

* a `kind` column — the real one is `category`
* a value `'charge'` — `category` is a CHECK list of twelve, and `'charge'`
  is not among them
* an `idempotency_key` taking a string — it is a **uuid**

The insert would have failed on all three. Ten seconds of
`grep -A 30 "create table if not exists folio_postings"` was the whole fix.

It also turned out no idempotency key was needed at all: the update above it
matches `status = 'confirmed'` and has already moved those rows to `no_show`,
so a second audit run selects none of them. **The mechanism was already
idempotent; I was about to add machinery to guarantee something that was
guaranteed.**

---

### 79 · A test fixture broke the gate after the one it passed

The new suite left a guest called 'Terms Tester' behind — I had decided not to
delete it, reasoning that the suite rebuilds the database from zero so nothing
could leak.

Nothing leaks **into the suite**. `db/tests/run.sh` rebuilds `fidato` and then
`load-demo` runs against what the suite left, and load-demo's own hygiene
check counts guests belonging to no property:

```
load-demo failed: 1 guests have no stay at any property.
```

All 137 assertions had passed. The gate order is not decoration — each gate
runs against the previous one's leavings, so **"clean enough for my test" is
not the standard; "clean" is.**

`guests` refuses deletes (015, `guests_no_delete`). Lifting the trigger for
one statement is the established idiom in this suite — `hotels_no_delete` and
`pos_order_lines_frozen` are both lifted the same way.

---

### 80 · verify-backup caught what the suite could not

Same turn, same cause, different gate: the test property `CXL` outlived its
test. Every assertion passed. Then:

```
x  properties   4   (expected 3)
```

The suite asserts what it was told to assert. `verify-backup` asserts what a
restored database should *look like*, which is a different question and the
only one that catches a fixture nobody thought to count. **A leftover fixture
is indistinguishable from real data in a restore.**

---

### 81 · A feature that could never fire

Cancellation terms were nearly shipped as decoration. The migration modelled
policies, the audit read terms frozen on the booking, the screen wrote
policies — and **nothing put a policy onto a booking**, so
`app.retention_for` returned null for every reservation that would ever exist
and the audit went on charging nothing.

Every piece worked. The feature did not. Caught by asking what would actually
happen on the next night audit rather than whether the screen saved.

The fix needed two things that were not obvious from either end: a trigger, so
terms attach however the booking is made (walk-in, reservation, demo loader,
and the channel manager later), and a property-chosen default — which is
**not** a shipped default. The rule is that the *system* must not invent
figures nobody agreed to. A hotel marking its own written policy as the one
that applies is the hotel stating its terms, which is the opposite.

**Before claiming a feature: name the moment it fires, and check something
reaches that moment.**

---

### 82 · A field called `folioId` that held a stay id

The postings endpoint returned `folioId: c.req.param("id")` — the
**reservation** id, under the name of the folio. Harmless for as long as every
stay had exactly one folio, which is why it survived: the two were
interchangeable and nothing could tell.

They stop being interchangeable the moment split billing exists, and then the
panel cannot say which bill a line is on — the only question split billing
asks. The type even carried the contradiction in a comment:
`folioId: string; // the stay it belongs to`.

**A name that has been wrong since it was written looks right until a second
case appears.** Worth checking any identifier whose comment has to explain
that it means something other than its name.

---

### 83 · A picker keyed by a slug, into a column expecting a uuid

The split-billing dialog listed companies from `listCompanies()`, which is the
DIRECTORY's accounts report: it merges the `companies` table with booking
sources under `coalesce(co.name, source)`, groups by name, and keys the result
by a **slug**. Exactly right for the screen it was written for.

Passing that id to anything that wants a company produced:

```
invalid input syntax for type uuid: "fidato-hotels"
```

The dialog looked correct — it listed real names — and did nothing. No toast,
no error on screen, because the failure was a 500 the repo swallowed.

Two things fell out of it:

* **The list being plausible is not the list being right.** Names that read
  correctly hid an id shape that could never work.
* **Reusing a repository function because its name matches is not reuse.**
  `listCompanies` answers "how much revenue per account", not "who can be
  billed". A new endpoint returning real rows with real uuids was the fix.

Found only by driving the dialog. Both tsc passes were clean and the DB tests
were green — nothing static could see it, because the slug is a perfectly good
string right up to the moment Postgres reads it.

---

### 84 · The preflight passed every check by not being able to see

Wrote `api/scripts/preflight.ts` to catch the ways a deployment can start,
look correct, and be wrong. Ran it. Ten green ticks, two honest failures.

Then checked the green ones against the database:

```
  ✓ no demo properties          → AGR and PUN both present
  ✓ no development uids         → dev-owner, dev-agra, dev-pune, all active
```

It connects with `DATABASE_URL`, which is `pms_app` — the **application**
role. Every query therefore ran under row level security with no session set,
`app.auth_hotel_ids()` returned the empty set, and every table read as empty.
`select count(*) from hotels` returned 0, so "no demo properties" passed.

**The file written to catch checks that pass without seeing was itself a check
that passed without seeing.**

Two things came out of it:

* **Any tool that audits the database must prove it can see the database
  first.** The fix is not "use a superuser" — it is an assertion that fails
  when nothing is visible, so the failure mode is impossible rather than
  merely unlikely. `ADMIN_DATABASE_URL` is preferred; a zero-row `hotels` is
  fatal whatever the cause.
* **The same bug was in `link-staff.ts`**, written minutes earlier. `--list`
  printed an empty list against six staff, and a link would have updated zero
  rows and reported success. One wrong assumption, applied twice, in the two
  files whose entire job is to be trusted about state.

Earlier, the same file had a second version of the same fault: run through
`npm run` it never loaded `api/.env`, so it read no `ALLOW_DEV_AUTH` at all
and reported **"dev auth is off"** against a box whose `.env` sets it to 1.
A green tick over the exact hole it exists to find.

**Run the checker against a state you already know is bad, and confirm it
says so.** Green on the first run is not evidence; it is the thing most
likely to be wrong.

---

### 85 · I quoted a platform limit from memory, in three documents, for days

Told the user Oracle's Always Free Ampere allowance was **4 OCPU / 24 GB**. It
is **2 OCPU / 12 GB** — 1,500 OCPU-hours and 9,000 GB-hours a month, which
divided by 730 is 2.05 and 12.3, and which Oracle's own page states in those
words.

The figure went into the infrastructure strategy, the runbook and the free-tier
table, each time with confident headroom arithmetic built on top: *"half
spare"*, *"3× spare"*, *"you may split it across up to four VMs"*. All wrong,
and wrong in the direction that would have let somebody over-provision into a
bill.

It only surfaced because the user sent the documentation link. **I never
fetched it.** The page is public, unauthenticated, and one tool call away, and
I wrote three documents around a number I had not checked.

**A third-party limit is not something to remember. It is something to look
up** — they change, and the whole value of stating one is that it is right.
Fetch the page, quote it, and say when it was fetched.

---

### 86 · The rule I did not go looking for

The same page carries a policy I had never mentioned: Oracle **reclaims** an
idle Always Free instance when, across seven days, CPU *and* network *and*
memory are all under 20%.

A property system for thirty-five staff is under on CPU and network almost
always. The instance we were about to build could have been taken back, and
nothing in three documents warned about it.

This is the more serious half of defect 85. Getting a number wrong is a
correction; **not knowing a rule exists is not knowing what you do not know.**
Reading the source would have surfaced both at once.

The fix is honest rather than a trick: `shared_buffers` at 25% of RAM is the
ordinary recommendation for any Postgres, is better for the database, and
holds memory above the threshold so the seven-day test can never be satisfied.

---

### 87 · Four confident wrong answers about one screen

Walking the user through Oracle's image picker, in order:

* **"Avoid Minimal."** The only `aarch64` Ubuntu builds Oracle offers *are* the
  Minimal ones.
* **"Confidential computing is why your shape list is empty."** Every Ubuntu row
  on that screen carries that label. It names what the image *supports*. The
  empty list was the blank Availability Domain — which I had flagged in the
  same message, so I had both facts and picked the wrong one.
* **"Pick the build with aarch64 in the name"** — for Oracle Linux, which does
  not put the architecture in the name at all.
* And underneath all three, **"Ubuntu, because fewer workarounds in
  `launch.sh`"** — while having already written those workarounds. They were
  work done, not a cost. The user pushed back and was right.

Each answer was delivered with the confidence of the one before. **When a user
sends a screenshot, the screen is the evidence and my recollection is not.**
Read what is actually on it — the Security column said the same thing on every
row, which alone should have killed the confidential-computing theory.

---

### 88 · I argued for a tool, then found the better argument was against it

Proposed switching nginx for Caddy on the grounds it would "remove the DNS
timing failure mode entirely". It does not. Caddy still needs the name
resolving for Let's Encrypt; it retries rather than failing. I had oversold the
one benefit that mattered.

Asked to decide, the honest answer was the opposite of what I had recommended a
message earlier — and the deciding reason was one I had not raised: swapping
the TLS layer of a script that has **never run** trades a known-but-untested
path for an unfamiliar one, on the night it first executes.

Same shape as the Vault recommendation, where I argued the real gain was that a
leaked backup would not carry the key — then checked and found `db/backup.sh`
is `pg_dump` only and never archived files. **The risk I was solving did not
exist.**

**Check the premise before building the argument on it.** Both times the
argument was fine and the premise was invented.

---

### 89 · Renumbering breaks cross-references, every single time

Four rounds of restructuring the runbook, and every one silently broke the
"see step N" references — *"you need it at step 30"* when there were 28,
*"step 16 (the 443 rule)"* pointing at `Install git and clone`.

They break because the numbers are generated and the references are prose. The
document looks fine; only following a reference finds it.

**Now checked on every republish** by resolving each `step N` back to its title
and printing what it lands on. Caught it three times after that.


---

### 90 · The backup could never have run on the server

`db/backup.sh` hardcoded a Windows scratchpad path and called
`pg_dump.exe`, on the dev cluster's port, with the dev password.
`launch.sh` installed that file as `/usr/local/bin/fidato-backup` and
crontab'd it nightly at 03:00 on Oracle Linux, where no such binary
exists.

It would have failed every night, exited 1, and written into
`/var/log/fidato-backup.log` — which nobody reads. **A backup that
silently does not exist is worse than none, because you stop worrying
about it.** It would have been found on the one day it mattered.

Nothing caught it. The gate that proves backups work — `verify-backup`
— runs on the development machine, where the Windows path is correct.
The suite was green the whole time, and green about the wrong platform.

Found only because the user asked what the fallback story was and I
read the script instead of describing it from memory.

Fixed three ways, because one was not enough:

* **detect** `pg_dump` on PATH rather than assume a location
* **run as `postgres`**, not root — the socket uses peer authentication
  and root is not postgres, which was a second, independent way for the
  same cron line to fail every night
* **take a real backup during `launch.sh`** and refuse to finish if it
  fails, so the first proof is at install and not at 03:00

**A script that runs in two environments must be tested in both, and a
gate that only exercises the developer's platform is not a gate for the
server.**

---

### 91 · I changed the architecture and did not say so

`docs/MASTER-ARCHITECTURE.md` approved **Firebase Hosting** for the
frontend, with the VPS as the API — and listed **M4, "Firebase↔VPS CORS
undesigned"**, as an open medium risk.

When I wrote `deploy/launch.sh` and `deploy/nginx.conf` I made the
Oracle box serve the frontend too, on one origin. That *eliminates* M4
rather than designing it. The nginx header then states the new shape as
settled fact — *"ONE ORIGIN IS THE POINT"* — as though it had always
been the plan.

I never flagged it as a change. The two documents contradicted each
other for days, and the user was the one who noticed: *"is this still
the thing or what needs to happen here, as it's not making sense."*
They were right, and the confusion was mine to have caused.

The one-origin argument was not wrong on its merits. **Resolving a
recorded architectural risk by silently changing the topology is still
not a decision I get to make alone** — the whole point of writing the
risk down was that somebody would decide it.

Worse, the argument I then made for one-origin was weighted for *"time
to live tonight"* at 9 out of 10. For a structure meant to last three
years that weight is a 4, and re-scoring on the user's actual criterion
— many clients, vendor portability — flipped the verdict entirely.
**Optimising for today and calling it architecture.**

**When an implementation departs from a written design, the departure
is the deliverable — say it out loud, in the same breath as the code.**

### 92 · The dev database was empty and I blamed the code

The day-end screen showed **"No outlet"**. The route was right, the API
route existed, the API tests were green. I went looking for the bug in
the code I had just written.

There was no bug. `db/tests/run.sh` **rebuilds from zero**, and it had
run — so the demo was gone, and with it every outlet. The runner even
says so:

```
note  fidato was rebuilt, so the demo is gone.
      Bring it back with:  cd api && npm run load-demo
```

Two things then compounded it. I probed the database as `pms_app` to
check, got `0 hotels`, and nearly concluded the whole database was
empty — **`pms_app` is subject to RLS with no session set, so it sees
nothing by design.** That probe can never answer "is there data here".
And once the database had been dropped under a running API, its
connection pool was poisoned: every request failed with `database
"fidato" does not exist` long after the database was back.

**Before debugging a "missing data" symptom: check that the demo is
loaded, probe as a superuser, and restart anything holding a pool.**
Three cheap checks that between them explain nearly every empty screen
on this project.

### 93 · The refusal did not agree with itself

`app.pos_day_end_blockers` pluralised its subject and not its pronouns:

> There **is 1 bill** still open. Settle **them**, or close **them**
> unpaid with a reason.

It reads fine in a migration and badly on a screen, which is the only
place anybody ever reads it. Caught by opening the page, not by the 17
assertions that check the function's behaviour — **a test asserts what
a sentence does, never how it reads.**

The same applied to the second blocker: *"1 table has … Clear them"*.
Both now branch on the count for the whole sentence rather than
splicing a plural noun into a fixed frame.

### 94 · A config fault that reported itself as a bad token

`subjectFor` called `firebase()` **inside** the try block that catches
verification failures. A process with no service account therefore
answered a perfectly valid token with **"Token rejected."** — sending
whoever is debugging it to look at Firebase, the clock, the project id,
anything except the one thing actually wrong: this server was never
given a credential.

The rule the catch was protecting is right — never tell a caller
*why* a token failed, because "expired" versus "wrong project" versus
"revoked" is a probing aid. But that rule is about the **caller**. It
was silently applied to the **operator** too, and they are the one
person who needs the reason.

Now: the app is resolved outside the try; a configuration fault is
logged and raised as our failure, not theirs; and a genuine rejection
still answers "Token rejected." while writing the real reason to the
server log.

### 95 · AVG breaks real Firebase auth on this machine only

Real tokens were rejected with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`.
**AVG Antivirus intercepts TLS on this machine**, so Google's
certificate chain terminates in AVG's own root — which Node trusts only
when `NODE_EXTRA_CA_CERTS` points at `C:\ProgramData\AVG\Antivirus\wscert.pem`.

The Git Bash profile sets it, so anything run from the Bash tool works.
**The preview server launches the API without it**, so the API alone
could not verify a token. That is why the same token verified in a
script and failed one HTTP call later — the difference was never the
token, it was which process opened the socket.

```
NODE_EXTRA_CA_CERTS unset  →  every real Firebase sign-in fails locally
ALLOW_DEV_AUTH=1           →  unaffected, which is why nobody noticed
```

Not a code defect and **not a production problem** — Oracle Linux has
no interception. Fix it once at the machine level rather than per-shell:

```
setx NODE_EXTRA_CA_CERTS "C:\ProgramData\AVG\Antivirus\wscert.pem"
```

**When two processes disagree about the same input, compare their
environments before you compare their code.**

### 96 · The fourth copy of a rule was the wrong one

`rates.valid_to` is nullable and its ranges are half-open. That is
written correctly in three places — the exclusion constraint in 033,
`is_current` on the rate-plan list, and `app.rate_for`. The rate-grid
route was a fourth copy and got both halves wrong:

```
and r.valid_to >= $2::date        -- NULL >= date is NULL, not true
least(r.valid_to, $3::date)       -- includes valid_to; the range is [)
```

So **an open-ended rack rate produced no cells at all** — the commonest
rate a property has, rendering the grid identical to "nothing has been
priced yet" — and **a season covered one day too many**, which made two
contiguous seasons both claim the boundary and showed the outgoing
price on the incoming day.

Neither was visible from any test, because the only assertion on that
route inserted a fixed three-day range and asserted three cells: it
encoded the inclusive behaviour rather than checking it. Found by
writing two rows into a scratch database and counting.

**A rule written in four places will be wrong in one.** The grid now
calls `app.rate_for`, and `app.set_rate` (053) owns the write side for
the same reason — the channel manager will price dates too.

### 97 · A test helper that quietly performed the wrong verb

`as()` in `api/test/inventory.test.ts` took only a path:

```ts
const as = (path: string) => app.request(`/api/hotels${path}`, {
  headers: { "x-dev-staff-id": ownerStaffId } });
```

Passing `{ method: "PUT", body }` to it did not fail — the argument was
**ignored**, and a GET went out instead. The route answered 200 with a
grid, so five assertions downstream failed for reasons that had nothing
to do with what they were testing: writes appeared to do nothing, and
two refusal tests reported "expected 200 to be 409" about requests that
were never refusals to begin with.

Twenty minutes went into the write path before the helper. **When
several unrelated assertions fail at once, suspect the thing they
share.**

### 98 · The browser's clock instead of the hotel's day

`MoveRoomFlow` defaulted its date field to `new Date()`. Opened on a
stay running 25–27 August, it offered **3 September** — the real date —
and the server correctly refused it as outside the stay, leaving a
clerk with a rejection and no idea what they had done wrong.

The rule was already written down and I broke it anyway: **never
`now()`, always the hotel's operating day.** A property whose night
audit has not run is still on yesterday, and the difference is not
cosmetic — it is which night a move takes effect on.

The other flows already took `businessDate` as a prop. Mine now does
too, clamped into the stay at both ends so the field always opens on a
night that can be chosen.

**Found by opening the dialog. Types were clean, 122 frontend tests
passed, and neither could see it** — nothing in either knows what day
the hotel thinks it is.

### 99 · Say the most actionable true thing, not the first one found

`app.move_room` looked for the live assignment before validating the
date. A move date past check-out has no assignment covering it, so it
answered *"this booking is not in a room on 2027-04-20"* — true, and
useless. It sends a clerk to look at the room assignment when the real
problem is that the date is not part of the stay.

Checks now run date-first. **When several refusals are all true, the
order they are tested in decides which one the person reads**, and that
choice is design, not implementation detail.

### 100 · A test file that had never cleaned up after itself

`api/test/identity.test.ts` ended with:

```ts
afterAll(async () => { await closePool(); });
```

It closed the pool and deleted nothing. Every run since it was written
left reservations in the DEMO database — five of them found, **three
checked in** — holding rooms 201, 204 and 205.

The rows are not the damage. **They hold inventory**, so a later
amendment or room move is refused because a room is "taken" by a guest
who does not exist, and the refusal is perfectly worded and completely
misleading. This is defect 54 again, in a file nobody had looked at.

Found while investigating why an amendment was refused — the refusal
turned out to be legitimate, and the debris turned up beside it.

**A test that writes to the demo owns putting it back.** The fixtures
were already tagged `ID-<pid>`, so the teardown had everything it
needed and simply did not exist.

Worth checking the other files the same way rather than waiting for the
next confusing refusal.

### 101 · Order of operations against a guard

`app.amend_stay` resized the room hold before moving the booking, and a
trigger keeps every assignment inside its reservation's dates — so
extending a stay raised *"assignment 10th..16th falls outside the
booking 10th..14th"*, refusing the exact thing being asked for.

The booking moves first, then the hold follows. **When two rows must
agree and a trigger enforces it, the order of the writes is part of the
design** — and if the second write then fails, the caller made one
statement, so the whole thing rolls back and the booking is untouched.

### 102 · A new column with a name the join already had

056 added `folio_postings.reservation_id`. Four queries did:

```sql
select fp.*, f.reservation_id from folio_postings fp join folios f ...
```

`fp.*` now carries the same name, so the CTE had two columns called
`reservation_id` and **every later reference became ambiguous**. Three
endpoints broke at once — the folio list, the notification count and
the night-audit checklist — from a migration that only added a column.

One test caught it. The other two endpoints have no coverage, which is
why the error surfaced in the server log rather than in a gate.

**Before adding a column, grep the joins for its name.** And the fix
was to delete the redundant half rather than alias it: the posting's
own reservation is the better answer, because on a master folio the
folio has none.

### 103 · The backfill only fixes rows that already exist

The same migration backfilled the new column from the folio. That
handles history and nothing else: `load-demo` kept inserting postings
without it, so the night audit's new per-stay check saw no charge and
**charged every stay a second time**.

A backfill is a one-time statement; the invariant it establishes needs
something that keeps holding. A `before insert` trigger now fills the
column from the folio, so no writer — present or future, application or
script — can produce a posting the audit cannot see.

**If a column must always be set, make the database set it.** Two tests
failed within a minute of the check changing, which is the only reason
this was not shipped.

### 104 · Re-enabling a guard halfway through a teardown

`load-demo` disables `folio_postings_append_only` for its whole
teardown and re-enables it at the end. I added a delete in the middle
with its own disable/enable pair — and the `enable` re-armed the
trigger for every delete that came after, breaking the load.

**Check whether the guard is already lifted before lifting it.** A
symmetrical-looking pair is not safe when the outer scope owns the same
switch.

### 105 · `||` on an array with an untyped literal

```sql
v_missing := v_missing || 'the room';   -- malformed array literal
```

Postgres cannot tell whether `'the room'` is an element or an array, and
tries to parse it AS an array. `array_append(v_missing, 'the room')` is
unambiguous. Cost one round trip on a function that was otherwise right.

### 106 · An empty list reduces to zero, and zero is a claim

The booking summary showed **₹0** before any room was added. `reduce`
over an empty array gives 0, and every other surface in this project
has been corrected for exactly this: a dash means "nothing chosen
yet", a zero means "this is free".

It is the same rule as the unpriced rate cell and the missing host
account, and it still got written. **Whenever a total is computed by
summing, ask what it shows when there is nothing to sum.**

### 107 · Picking a fixture by sort order instead of by what it needs

A tariff test selected the first room type and quoted three adults into
it. 5EL's Superior sleeps two, so the API refused — correctly — and two
assertions failed for a reason that had nothing to do with what they
were testing.

The fixture now selects `where max_occupancy > base_occupancy`. **Pick
a fixture by the property the test depends on, not by `limit 1`.**

### 108 · I planned to build a screen that already existed

The 1.4 plan said the module switch was missing its screen: *"the gate,
the table and the disappearing navigation are all built and tested;
what is missing is the screen to flip it from."*

It was not missing. `ModulesCard` sits inside `SettingsPage`, routed at
`/admin/settings`, in the navigation, **not development-gated**, and it
works — Point of sale on, Banquet hall off and disabled with "Not built
yet".

I had written that plan item from what I remembered of the codebase
rather than from the codebase. Opening the screen took thirty seconds
and would have saved building a duplicate.

**Before planning to build something, look for it.** The plan is not
the source of truth about what exists; the repository is.

### 109 · The demo was gone again, and I read the symptom as a bug

Work orders answered 404 from a route that was plainly correct. The
cause was that `db/tests/run.sh` had rebuilt from zero and I had not
reloaded the demo — so `5EL` did not exist, and every lookup for it
failed honestly.

**This is defect 92, by me, a second time.** The runner prints the
reminder in its own output and I read past it twice.

The rule, written plainly: **`db/tests/run.sh` is always followed by
`cd api && npm run load-demo`.** Not sometimes. Every time.

### 110 · A button that did something other than what it said

The top bar carried:

```tsx
onClick={() => setMobileNavOpen(true)}   // Placeholder - AI panel dropped
aria-label="Open AI assistant"
```

Pressing "Open AI assistant" opened the **navigation drawer**. The
comment beside it said the panel had been dropped, so this was known
and left in.

A control that does something other than what it says is worse than no
control: somebody presses it, gets the nav, and stops trusting the
header. Removed. The `ai` resource stays in `permissions.ts` with a
note, so the permission does not have to be re-invented.

**A placeholder that still responds to a click is not a placeholder.**

### 111 · Measuring during a route transition

The look-and-feel audit scripted `pushState` → wait 1200ms → measure,
across thirteen routes. It reported header targets under 44px that were
44px when measured on a settled page: React was still swapping the tree
when the ruler came out.

The finding was mine, not the app's, and I nearly recorded it as a
regression. **When an automated measurement disagrees with a direct
one, suspect the measurement first** — especially anything that samples
mid-navigation.

### 112 · A test staff row that had been an employee for months

`api/test/pos.test.ts` creates a staff member for its outlet:

```ts
insert into staff (email, full_name, is_group_admin)
values ('pos+test@fidatohotels.com', 'POS test outlet', false)
```

The `false` is **is_group_admin**, not `is_active` — which defaults to
true. The teardown deleted the outlet and never the staff row, and its
own guard asserted only that the outlet was gone.

So "POS test outlet" has been an active employee of 5EL, in every staff
picker in the application. It surfaced when the cashier handover asked
who the drawer could be given to and offered an outlet.

**Deleting it is wrong**: `folio_postings.posted_by` references it, and
a posting that loses its author is worse than a stale row. It is now
retired — `is_active = false` — which every picker already filters on,
and the fixture reactivates it on conflict so it establishes its own
precondition instead of inheriting the last run's.

**Third piece of test debris found in one session** (identity.test.ts,
this, and the demo rebuild). The pattern is always the same: a fixture
writes to the shared demo database and cleans up the object it was
thinking about, not the rows around it.

**A guard that checks one of the things a fixture created is not a
teardown check.**

### 113 · Reading a column position as a column name

I read the `false` above as `is_active` and said so. It is the third
positional argument — `is_group_admin`. Checking took one look at the
insert's column list, and the wrong reading would have sent the fix at
a column that was never set.

**Count the columns before naming the value.**

### 114 · The leak was load-bearing

Fixing `nightAudit.test.ts` so it cleaned up after itself broke
`concurrency.test.ts`, whose own error message explained why:

> "No folio at Pune to reverse against. This test cannot prove
>  anything — run the night audit tests first, which create one."

It was passing because another file left debris behind. **A test that
depends on another test's leftovers passes until somebody runs it
alone**, and the dependency was written down as a hint rather than
recognised as a fault.

It now opens its own folio and removes it.

### 115 · Order is part of a teardown

Both new teardowns failed on foreign keys the first time: `folios` and
`form_c_filings` name the reservation, so deleting bookings first
leaves keys pointing at nothing. The same lesson as 101, where
`amend_stay` resized the room hold before moving the booking.

**A teardown is a migration run backwards, and it has the same
ordering rules.**

### 116 · Measure the leak, do not count the greps

Grepping for files that `insert` but never `delete` found two. Measuring
row counts against a clean load found **four**, and the two the grep
missed were the ones leaking most — they had a partial teardown, so
they matched the "cleans up" pattern while cleaning up almost nothing.

```
before   guests +7   reservations +6   postings +35
after    guests  0   reservations  0   postings +24
```

The 24 that remain are POS test lines on a real demo folio, deliberately
kept: they are ledger rows, they net to zero, and deleting from an
append-only ledger to tidy a demo is worse than the untidiness. Verified
by balance, not by assumption — the folio reads 3,890.08 before and
after.

### 117 · Two migrations of mine were not re-runnable

Found by an audit, not a gate, because the gate rebuilds from zero and a
first run is the one case that always works.

`053` wrote `COMMENT ON FUNCTION app.set_rate` with no argument list. Correct
until `057` adds a second overload — then both exist on a re-run, the name is
ambiguous, and the whole migration aborts. `057` dropped the OLD signature
before creating its own and never dropped its own, so its second run collided
with itself.

**Every `create function` needs `drop function if exists` for EVERY signature
it will ever have, and every `COMMENT ON FUNCTION` needs its argument list.**
An overload added three migrations later reaches back and breaks an older file
that was correct when it was written.

### 118 · A route that could never run, under one that could

I added `GET /:code/groups` to `api/src/routes/groups.ts`. It never executed
once: `stays.ts` is mounted first on the same prefix and already had that path.
Hono matches the first registration, so my handler was dead code that
typechecked, built and looked right in the diff.

The existing route also had the bug I was about to fix somewhere else — it was
counting void bookings into the group.

**Before adding a route, grep the path across every router, and check the mount
order in the app file.** A duplicate path is not an error anywhere in the
stack; it is silently ignored, and the half you did not write is the half that
serves.

### 119 · I measured destructively against the working database

To count how many migrations survive a second run, I ran all 59 against the
live `fidato`. Eight failed — which was the answer I wanted — but a failing
migration does not fail *cleanly*. `psql` runs statements one at a time, so
`013_policies.sql` applied roughly half its policies and aborted at the first
one that already existed.

The half it applied put `staff`'s RLS policy back to a version that calls
`app.is_group_admin()`, which reads `staff`. Any insert into `hotels` then
recursed until the stack limit. The demo loader died, 5EL was gone, and the
symptom appeared three steps from the cause — exactly the shape defect 46 and
defect 92 are about.

Then `drop database` failed too: `could not open file "global/2964"`. The
cluster's `pg_db_role_setting` catalog was gone, so the documented recovery
(`db/tests/run.sh`) could not run either. The cluster had to be rebuilt with
`initdb`.

**A destructive measurement belongs on a scratch copy.** `db/verify-backup.sh`
already builds one and drops it afterwards; the same pattern was available and
I did not reach for it. The measurement was worth having and cost an hour it
did not need to.

**And a half-applied migration is a state no migration produces.** It is not
"the old schema" or "the new schema" — it is one neither the tests nor the
application has ever seen.

### 120 · A teardown that cleared the table instead of cleaning up after itself

`banquet.test.ts` removed its fixtures with `delete from banquet_events
where hotel_id = $1`. It ran while somebody was using the app, and it
deleted the booking they had just entered — a real function, in a real
hall, gone with no trace and no error.

Three separate faults, all the same shape:

```
delete ... where hotel_id = $1              every row, not this file's
delete from hotel_modules ... 'banquet'     "restore" meant OFF, not "as it was"
expect(venues).toHaveLength(0)              passed only on an untouched property
venues[0]                                   whichever hall sorted first
name: "Emerald Hall"                        a name a REAL hall would have
```

The irony is exact: defects 114-116 were four files LEAKING into the
shared demo, and the fix for that produced a file that over-cleaned.
**Cleaning up after yourself and clearing the table are not the same
act, and the difference only shows when somebody else is using the
database.**

It now records every venue, event, package id and the module's setting
in `beforeAll`, deletes only what is not in those lists, and restores
the module to whatever it was rather than to off. Fixtures carry
`fixture-${process.pid}` in their names so they cannot collide with a
real hall, and lookups search every venue by name rather than indexing
the first.

Proved by measurement, not by reading it: 2 venues and `banquet=true`
before a run, 2 venues and `banquet=true` after.

### 121 · A shared action bar that could not wrap

`PageHeader` laid its actions out as `flex items-center gap-2 shrink-0`.
With two buttons on a 375px screen the box refused to shrink, so nothing
ever applied pressure to wrap, and the second button was cut in half at
the edge of the viewport.

Every screen with two header actions had this. It survived `tsc`, 122
frontend tests and a clean build, and was found by opening the banquet
diary at mobile width — the eighteenth defect caught that way.

`max-w-full flex-wrap justify-end` added. Desktop is untouched: there is
room, so nothing wraps.

### 122 · Three heredocs, three failures, one lesson taken too late

Writing SQL and TypeScript through `cat << 'EOF'` failed three times in
one session with `unexpected EOF while looking for matching quote` —
the same fault as defect 74, which is titled *"Three escaping failures
writing one test"*.

The content was never the problem and neither was the quoting style.
**A file with prose, apostrophes and dollar-quoted SQL in it should be
written with the file tool, or through a script written with the file
tool.** After the first failure that was already the right answer; I
paid for it twice more.

### 123 · A guard that guarded the wrong half

`005_reservations.sql` wraps its exclusion constraint in a check that the
constraint does not already exist, under a comment that says *"Guarded so the
file is re-runnable."* It is not. 011 drops the `room_id` column the
constraint names, so on a redeploy the constraint is absent — the guard passes
— and the column is absent too, and the statement fails.

The author thought about re-runnability, wrote a guard, and guarded the
condition that was easier to see rather than the one that breaks.

Three of the eight non-re-runnable migrations were like this, and **three of
the fixes already existed elsewhere in the same directory**: 038 solved the
function-signature problem and wrote the lesson into its own comment while 028
sat two hundred lines away without it.

**A pattern solved once is not solved. Grep for it.**

### 124 · A guard cannot save a statement the parser has already read

Wrapping the room_id backfill in `if exists (... column ...) then` did not
work. PL/pgSQL parses the entire block when the function is created, including
branches that never execute, so a reference to a dropped column fails at parse
time no matter what the condition says.

```sql
if exists (...) then
  insert into ... select room_id ...      -- fails even when false
end if;

if exists (...) then
  execute $sql$ insert into ... $sql$;    -- correct
end if;
```

**A conditional protects execution, not parsing.** Anything naming a column
that may not exist goes inside `execute`.

### 125 · A dropped line signed the clerk out

Every `restore` path in `session.ts` ended `load(set).catch(() => set({
status: "signed-out" }))`. Correct for a 401 and wrong for everything
else — and with no connection, everything else is what happens.

So reloading a page offline put the clerk on the sign-in screen. Which
cannot be completed, because signing in also needs the server. Every
screen cached for offline use and every held change in the outbox sat
behind a form that could not be filled in.

The whole offline feature was useless and nothing said so: it
typechecked, 122 tests passed, the build was clean. **Found by stopping
the API and pressing reload**, which is the only way it could have been
found.

The last good session is now kept for a week and restored on a NETWORK
failure. A 401 still signs out and clears it, because that is the
server saying who you are — the one answer worth believing.

### 126 · The same CORS header trap, in the file that warns about it

Adding `idempotency-key` to the drain's requests broke every retry. The
preflight answered 204 and the real request failed with `ERR_FAILED`,
which reads as the server being unreachable while it is plainly up.

`server.ts` has a paragraph directly above the header list:

> *"A custom header the browser does not already know about needs
> naming here or its preflight fails, and the failure arrives as 'could
> not reach the server' — indistinguishable from the API being down.
> The admin console spent a round of debugging on exactly that after
> `x-provisioning-key` was added."*

I added a header without reading the list I was adding it to. **A
warning only works if it is read before the change, not after the
symptom.**

### 127 · A queue in useState is not a queue

Housekeeping held a tap safely since defect 49 and lost it on the next
reload — `useState`, so a locked phone, a closed tab or a crash
discarded work somebody believed they had done. The same fault the
queue was built to prevent, moved one layer out.

Worse, it hid the durable one. Because it checked `online` and held the
tap WITHOUT ATTEMPTING, the request never reached `api()` and the
IndexedDB outbox stayed empty. Two queues, and the one that caught the
common case was the one that lost work.

The screen now always attempts; `api()` decides. One queue, one drain.

**Proved by measurement.** Tap offline, reload, and the change is still
there — then the line comes back, it drains, and `rooms.housekeeping_
status` for 209 reads `inspected`.

### 128 · An effect that could only fire before its data arrived

The auto-drain was keyed on `[online]`. Entries load from IndexedDB
after mount, so on a fresh page the effect had already run against an
empty list, and `online` never changed to re-run it. A held change sat
under a working "Send now" button that nobody should have needed.

The manual path working is what made this hard to see — the feature
looked finished.

**An effect keyed on the trigger and not on the data runs at the one
moment the data is guaranteed absent.**

### 129 · The queue forgot whose work it was

The outbox recorded what was done and not who did it, and the drain
sent everything with `authHeaders()` — whoever is signed in NOW.

A front desk is one machine, one browser profile and four clerks. The
morning clerk holds a check-in during an outage and goes home; the
evening clerk signs in and the queue drains under their token. The
ledger then says the evening clerk checked that guest in, and an
append-only ledger does not forget.

This project puts "who said so" in the schema everywhere —
`banquet_events.registered_by` is NOT NULL for exactly this reason, and
its comment says a hall booked with nobody's name against it is the
state the module exists to end. The queue was quietly undoing that.

An entry now carries the subject captured AT THE TAP, and the drain
sends only that person's work. Somebody else's waits, and the bar says
so rather than showing a count that never moves — a clerk watching "3
held" sit there will conclude the feature is broken.

**Offline moves an act away from the moment it happened. Everything the
act depended on has to travel with it, and identity is part of the
act.**

### 130 · A module mock is a second copy of an interface, and it drifts

Adding `currentSubject` to `api.ts` broke **fifteen tests in
`App.test.tsx`** — none of them about offline, sign-in, or anything the
export touches. `src/test/setup.ts` mocks `@/lib/api` wholesale, so any
export the shell reaches for and the mock lacks is a hard failure
across every test that renders the shell.

The failure names the missing export, so it is quick to fix. The point
is the shape: **a `vi.mock` factory is an interface that has to be
maintained in lockstep with the real module, and nothing enforces it.**
Adding an export to a mocked module means opening the mock.

### 131 · A button is shrink-to-fit, and it took the card with it

The till menu drew every dish card at the width of its longest word,
inside a grid cell that was already the right size. Half the panel was
empty, and the note button — positioned against the CELL rather than
the card — floated alone in that empty space.

One missing class. `<button>` is shrink-to-fit, so `flex` sized it to
its content; `w-full` is what makes a flex button fill its cell.

**Two symptoms that looked unrelated had one cause**, and the stranded
icon was the more visible of them — which is how a layout bug gets
diagnosed as a positioning bug and fixed in the wrong place.

### 132 · The window is not the thing the cards live in

The same grid used `sm:grid-cols-2`, a VIEWPORT rule, for a panel whose
width is the viewport minus a 380px bill. On a 768px tablet the panel
was 388px wide while the breakpoint saw 768, so it drew two columns of
185px and "Paneer Butter Masala" wrapped onto three lines.

Container queries are for exactly this: `@container` on the panel and
`@sm:` / `@2xl:` / `@4xl:` on the grid, which now counts columns by the
space it actually has. A 1366px till went from three cards holding two
words to four comfortable ones.

**A viewport breakpoint is only correct for something as wide as the
viewport.** Any panel beside a fixed-width sibling needs a container
query, and nothing about the wrong version fails a test.

### 133 · A screenshot is not a measurement

The bill sheet looked cut off on a phone — buttons clipped at the right
edge, the close control invisible. It was not. `getBoundingClientRect`
put the sheet at 23..375 in a 375px viewport and the button at 40..359,
both entirely inside, with `documentElement.scrollWidth` exactly 375.

The preview pane was rendering narrower than the viewport it was
emulating, and the image was the artefact. I nearly "fixed" a correct
layout — defect 72's shape, contaminating a reproduction and then
reporting it.

**When a screenshot says something is clipped, measure before
believing it.**

### 134 · A build variant nobody builds

`src/lib/sw.ts` imports `virtual:pwa-register` inside a try/catch,
which reads as careful and is not. The module is created by VitePWA,
and VitePWA runs for the PRODUCTION build only — Rollup resolves
imports at build time, so the catch never gets a chance.

Both demo builds had been failing outright since the offline work
landed:

```
[vite]: Rollup failed to resolve import "virtual:pwa-register"
```

Nothing caught it because the gate runs `npm run build` and stops, and
this project has THREE builds — production, preview and artifact — with
different plugins, different aliases and different output directories.
Two of them were broken for a day and the gates were green throughout.

`npm run build:all` builds all three, and the deploy step runs it.

**A try/catch around a dynamic import does not make a missing module
optional at build time.** Declare it external where it is genuinely
absent.

### 135 · Four reports built, listed, and unreachable

The reports index says "11 of 11 built" and the sidebar offered seven.
The GST Sales Register — the one an accountant opens every month to
file GSTR-1 — was reachable only by somebody who thought to open All
reports first and read down it. So were Form C, the Guest Ledger and
the Cashier Shift.

Found by the owner looking at his own navigation, not by a gate. Every
route existed, every endpoint answered 200, every screen rendered.

**A screen that cannot be found from the navigation does not exist to
the person looking for it.** When a screen ships, the menu entry is
part of shipping it.

### 136 · The menu slid off the screen, and `sr-only` did it

On Housekeeping alone, the whole document scrolled: the sidebar rode up
and off the top, leaving one strip of it visible. Every other page was
fine, which made it look like a Housekeeping fault and it was a shell
one.

`sr-only` is `position: absolute` by definition. **An absolutely
positioned element is clipped only by an ancestor that is its
CONTAINING BLOCK** — a static ancestor's `overflow: hidden` does not
apply to it at all. `main` was static, so every hidden label anchored
to the page itself and escaped the shell's `overflow-hidden`.

Housekeeping has one per room card down a long grid. The furthest sat
at 1662px in a 900px window, and the document grew to match:

```
housekeeping   docScrollHeight 1662   window scrolls   aside top -500
every other    docScrollHeight  900   no scroll        aside top    0
```

`position: relative` on `main` anchors them and fixes the class, not
the instance.

**Two measurement errors on the way, both mine.** I first blamed the
sidebar nav, because clipped content still reports a bounding box past
the viewport — `getBoundingClientRect` does not know about an
ancestor's overflow. And my first "what is escaping" check walked
ancestors for `overflow` without checking `position`, so it found
nothing and I nearly concluded the scroll was a viewport-emulation
artefact.

**When something escapes `overflow: hidden`, look at what its
containing block is before looking at anything else.**

### 137 · A note about what is not built, left after it was built

The stay panel carried one line under a greyed Check in button:

> *Check-in, folio and settlement arrive at Checkpoint 5.*

All three shipped months ago. Together the disabled button and that
sentence read as a feature that does not exist, and it was the first
thing the owner saw on the panel and the first thing he reported.

The button was correctly disabled — the booking arrives in five days —
but the panel threw away the REASON. `canCheckIn` returns a real
sentence and the trigger rendered only the greyed control, which is
Rule 6 with the useful half removed: a blocked action is shown WITH its
reason.

**A note saying something is not built has to be deleted the day it is
built, and no typecheck, test or build will ever mention it.** Grep for
"Checkpoint", "coming soon", "not yet" and "Stage" in anything a
user reads, whenever a stage closes.

### 138 · A deposit is not an overpayment

The balance row labelled every credit "overpaid". Most guests here pay
a token amount at booking and settle the rest at check-out, so a
negative balance before departure is an ADVANCE and completely normal —
and calling it overpaid reads as a mistake somebody has to correct
rather than money already in hand.

It says "in advance" until they have left, and "overpaid" only after.

### 139 · The same reason, twice, because I did not read the line below

The check-in trigger already passed its refusal to a `Tooltip`. I added
a paragraph showing the same sentence and shipped both, so the reason
appeared on hover AND under the button.

Two lines apart in the same file. I read the one I was changing and not
the one after it.

The paragraph is the half worth keeping: a tooltip needs a pointer, and
on the tablet at the front desk it can never be opened at all.

### 140 · run.sh again, for the third time

Ran `db/tests/run.sh` to check new assertions, then opened a screen
and found "This property did not load". The API log said
`permission denied for schema app`, which reads as a grant fault, and
underneath it said `database "fidato" does not exist`.

Neither was the cause. run.sh REBUILDS FROM ZERO — its own closing note
says so — and I had not reloaded the demo. Two hotels instead of three,
5EL missing, and every screen honestly reporting an empty database.

Defects 92 and 109 are the same event. The note exists, the gate order
in PROGRESS.md documents it, and I still lost fifteen minutes to a
permission error that was not a permission error.

**After run.sh, reload the demo. Before reading any screen, count the
hotels.**

### 141 · A gate that compared a value with itself

Check-in read

    const businessDate = body.businessDate ?? stay.check_in;

and then refused when `stay.check_in > businessDate`. With no date from
the client — which is every call the interface makes — the fallback IS
the booking''s own arrival, so the comparison was a date against itself
and could never be true.

**The arrival-date guard has never fired.** A guest booked for next week
could be checked in today, silently, with the reservation still saying
it starts next week: the night audit would not charge tonight and the
tape chart would show the room empty with somebody asleep in it.

Found while deliberately trying to make the guard refuse, and being
told `{"ok":true}`.

Defect 14 exactly — a gate reading a different source from the action
it guards. The hotel''s `business_date` is the only honest answer; the
client''s is now an override for the audit''s own replay and nothing
else.

**A default that makes a comparison trivially false is worse than no
comparison, because the code reads as though it checks something.**

### 142 · The refusal was right and the data was wrong

Reported as "check-in is not letting me do today''s guest", with a
screenshot of "This booking arrives on 2026-09-04. It cannot be checked
in early."

Both true. The property''s business date was 2026-08-25 and the real
date was 2026-09-04 — the demo pins Akkalkot ten days in the past, so
every genuine arrival looked like a future booking. The system was
correct and unusable at the same time.

**Demo data with a date in it stops being a demonstration and becomes
an obstacle the moment somebody tries to do real work.** `npm run
reset` clears a property and brings it to today.

### 143 · "The same panel" was a second copy of it

`StayTable.tsx` opens a detail drawer under a comment reading

> *the same panel the tape chart opens, so nothing is relearned*

It is not the same panel. It is a second implementation of one, and the
comment is what made it look settled. A More options menu added to the
chart''s panel appeared on Arrivals, In-house and every other list
screen exactly nowhere — which is most of the places a clerk opens a
stay from.

Found by building the menu, opening Arrivals, and not seeing it.

The actions are one component now, imported by both. **A comment
asserting two things are the same is the weakest possible guarantee of
it**, and it survived because nothing ever needed them to differ until
something did.

### 144 · A booking with nowhere to put money

A reservation made through the interface never got a folio. The walk-in
opened one and `POST /bookings` did not, so a guest booked normally was
checked in with no bill: the till could not charge their room, the desk
could not take a deposit, and check-out had nothing to settle.

It looked like a POS fault — "the POS is not detecting the rooms" — and
the POS was right. `/till/rooms` lists rooms with an OPEN FOLIO, and
there wasn''t one. The screen furthest from the cause is the one that
reports it.

The folio opens at BOOKING now, not at check-in, because most guests
here pay a token amount when they book and a deposit taken before
arrival needs somewhere to land. Check-in also calls `folioFor` as a
safety net for every booking taken before the fix.

### 145 · A button that could be pressed twice took two rooms

The walk-in had no busy guard. Two taps sent two walk-ins: the first
put a guest in the room, the second came back "Somebody is already in
that room" — so the desk saw a refusal, believed nothing had happened,
and a guest was checked in behind it.

A room is a scarce resource and the walk-in takes one in a single act.
That is exactly the button that must not be pressable twice.

### 146 · The room they were already in was not on the list

The check-in room picker filtered to the booked room type. The flow
seeds its selection from `stay.roomNumber`, so whenever a booking was
pre-assigned to a room of another type — an upgrade, a fault worked
around — the room was SELECTED AND ABSENT: eight rooms, none
highlighted, and the one the desk had already chosen nowhere.

The assigned room is always offered now, whatever its type, and is not
refused for being occupied by the very stay being checked in.

**A decision somebody already made is not one a screen gets to hide.**

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
