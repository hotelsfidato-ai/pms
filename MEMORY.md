# Memory — what this project learned the hard way

Every entry here cost something. Read it before you repeat it.

**Since 15 September each service keeps its own memory too:**
`src/modules/<service>/MEMORY.md`, its defects numbered with its prefix. This
file keeps the lessons that apply to the whole project; the last number is 274.
Each service's file also indexes the entries here that concern it.

```
front-desk FD · reservations RES · housekeeping HK · inventory INV · guests GUE
finance FIN · night-audit NA · pos POS · banquet BQ · stores STO · reports REP
admin ADM · channel-manager CM · crs CRS · payments PAY · booking-engine BE
guest-messaging MSG · accounting ACC · leads LEAD · marketing MKT · crm CRM
spa SPA · online-checkin OCI · laundry LDY · contracts CON · revenue-management RM
reputation REV · loyalty LOY · guest-services GS · equipment EQ
```

---

## Ten faults that repeat

167 entries below is a reference, not a reading list. These are the patterns
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

### 147 · A date typed once, on the screen an owner opens first

The group dashboard captioned itself

> *Period to date, 1–25 August 2026.*

as a literal string. The API had the right window all along —
`monthStart(business_date)` to the business date — and the figures under
the caption were correct. Only the sentence describing them was frozen
on the day somebody typed it.

Found the moment the properties moved to a real date: the heading said
August while every number under it was September.

**A date on a screen is a number like any other**, and this project''s
rule is that a number is derived or it is a dash. A hardcoded date does
not even fail loudly — it is right once, and wrong quietly forever
after.

### 148 · A SECURITY DEFINER that could not escape its own policy

Sign-in broke on the live database. Every read of `staff` died with
`stack depth limit exceeded`, hundreds of frames of `is_group_admin`.

`staff_admin_read` is a policy ON staff whose predicate is
`app.is_group_admin()`, and that function reads staff. 027 knew about
the cycle and answered it with SECURITY DEFINER, writing "running as
owner bypasses the policy and ends the loop."

**That sentence was true when written and stopped being true later.** A
table owner bypasses its own policies only until somebody says
`force row level security` — which this project says on every
hotel-scoped table. The owner, `pms_migrate`, is not a superuser, so the
definer had no escape.

**Why no gate saw it:** `db/tests/run.sh` applies migrations as
`postgres`, so in the scratch database every function is owned by a
SUPERUSER, and a superuser bypasses RLS whatever FORCE says. 419
assertions green, nine of them about isolation, while sign-in was dead.

A test environment that differs from production in a privilege still
reports on privileges with total confidence.

### 149 · A test that was a coin flip, and the wrong thing I blamed

`db/tests/suite.sql` picked its fixture staff with

```sql
select id into v_staff from staff order by id limit 1;
```

Ids are `gen_random_uuid()`. Two of the four fixture staff are clerks
with access to one property each, so "the lowest id" refused about half
the time with *"Staff X has no access to hotel Y"* — which reads as a
broken RLS policy, and whose pass reads as proof there is none.

**I nearly committed the wrong cause.** Two runs differed, the visible
difference between the harnesses was `PGCLIENTENCODING`, and one sample
each said encoding was it. I had written the explanation into a comment
before testing it again. Two samples of a coin flip will correlate with
whatever you changed between them.

**A difference that appears once is not a finding.** It took eight runs
of the same commit to be sure, and the fix is `where email = ...`.

### 150 · Four tests that only passed after 2pm

The identity tests check a guest in and assert things about passports.
Migration 063 gave the front desk an opinion about the arrival hour, and
the fixture property opens at 14:00 — so run before then, every check-in
is early, and four tests about documents fail complaining about arrival
times.

One of them kept PASSING: it asserts the refusal mentions a *"reason"*,
and *"an early arrival needs a reason"* says exactly that. Green for the
wrong cause is the failure mode that hides.

### 151 · A verifier that called a sound backup a lost hotel

`verify-backup.sh` asserted the demo's figures — three properties, 83
reservations, ₹4,19,578.76 — and decided whether to apply them by asking
whether a hotel coded 5EL existed. **5EL is now the real property.** So
it compared a working hotel against a demo's numbers and printed

> RESTORING THIS FILE WOULD NOT GIVE YOU YOUR HOTEL BACK.

over a backup that was perfectly sound. That is the worst thing a
verifier can do: it teaches people to disregard it.

The deeper fault was asserting CONSTANTS. It now compares the restore
against the SOURCE, table by table and to the paisa — a question with an
answer on the demo, on an empty database, and on a hotel with six real
bookings, that never needs editing when the data changes.

### 152 · A VALUES list infers parameter types; a SELECT does not

Converting `insert ... values ($1,$2,$3,...)` to
`insert ... select $1,$2,$3,... from (select app.gst_rate(...)) t`
so the rate could be derived in the same statement dropped every
parameter's type inference — a VALUES list takes them from the target
columns, a SELECT has nothing to take them from.

Surfaced as `500 · Something went wrong` on the walk-in, three layers
from the cast that was missing. Every converted statement now spells out
`$1::uuid`, `$3::date`, `$5::numeric`.

### 153 · A group administrator nobody owned

`008_seed.sql` seeds a bootstrap person, `REPLACE@fidato.in`, so the
first real user has something to sign in as. It sat in `staff` as an
ACTIVE GROUP ADMIN — the widest role the system has — and nothing
objected. `preflight` checked for REPLACE **properties** and had never
looked at people.

It could not sign in, because no Firebase account carried that address.
It becomes a real key the moment somebody creates one, and it is exactly
the address a person makes by accident while testing.

Found by reading the staff table after deleting the test properties —
not by a gate. There is a preflight check now, and it fails until the
account is claimed or deactivated.

**The endpoints to fix it had existed for months** behind a
development-only console, so the owner could not reach them. A feature
is not built until the people it is for can reach it — the same hole
room types had, and the front desk's hours.

### 154 · The template imported its own instructions

The menu template carries a notes row — what each column is for — and
the parser skipped it by checking whether the raw line started with `#`.

Our own CSV writer QUOTES that cell, because the notes contain commas.
So the line starts with `"`, the check never matched, and the template's
own instructions imported as a dish called
*"# REQUIRED. Starters, Main course, Spirits..."* at whatever price the
next column happened to hold.

Caught by the round-trip test — download the template, read it back,
expect exactly the example rows — written in the same commit for exactly
this reason. **A template and a parser generated from one spec still
have to be shown agreeing**, because the spec is not the only thing
between them: the writer's quoting rules sit in the middle.

The check now looks at the parsed cell, not the raw line.

### 155 · The dev server was serving code that no longer existed

A new card was wired into a screen, the typecheck passed, the endpoint
returned the right JSON when called directly — and the card did not
appear. No network request for it was made at all.

The conclusion sitting there to be drawn was "the component is broken".
It was not. **Vite was serving a stale copy of the file**: the edits
were written by a script rather than an editor, and the watcher never
saw them. Fetching the module the browser actually had settled it in one
line:

```js
const t = await (await fetch('/src/pages/RoomSetup.tsx?t=' + Date.now())).text();
t.includes('CommissioningCard')   // false
```

Restarting the dev server fixed it, with no change to the code.

**Before debugging a component that will not render, check the browser
has the code you wrote.** The sibling of defect 133 — a screenshot is
not a measurement — and of the whole run.sh family: the thing you are
looking at may not be the thing you changed.

### 156 · A guard with no way through is a wall

The server refused a late check-out without a reason — correctly, and
with the reason on screen. The interface had no way to give it one:
`checkOut()` sent `{ user }` and nothing else.

So the refusal was a **dead end**. Press the button, read why it will not
work, press it again. The owner sent a screenshot of five identical
toasts stacked up, which is exactly what that loop looks like from the
outside.

**Rule 6 says a blocked action is shown WITH its reason. It does not say
the reason is the end of the conversation.** Every refusal that has an
answer needs the answer reachable from where it is raised.

The refusal now carries `needs: "late-reason"` — a marker, not prose,
because a screen that recognises a refusal by reading its sentence
breaks silently the day somebody rewords it.

### 157 · The other end of the same feature had no guard at all

Finding 156 meant looking at its twin, and `waiveEarly` on check-in had
**no permission check whatsoever**. It arrived in the POST body and was
obeyed, so anybody who could check a guest in could make the
early-arrival charge disappear — including by sending the field by hand.

The late end had just grown a guard. The early end had never had one.
**When a feature has two ends, fixing one is the moment to go and look
at the other.**

### 158 · A charge posted to the configured date, not the real one

The late-checkout charge read `hotels.business_date`. That column is the
property's CONFIGURED date; the real one is `app.business_date()` — the
last completed night audit plus a day. They differ the moment a property
has ever closed a night.

So the posting hit 012's "that date is closed" guard and the entire
check-out came back as a 500 with no explanation. **The early check-in
charge twenty lines above had always used the resolved date.** Same
feature, two ends, one of them right.

### 159 · Links that had never opened anything

The group panel linked to `/stay?stay=<id>`. `StayView` reads `?res=`.
Every one of those links had opened the tape chart with no panel since
the day it was written, and I copied the same mistake into the new
groups list before noticing.

Found by deep-linking to a stay to test something else entirely.

### 160 · The same message five times is not five pieces of news

Identical toasts stacked, so one wall looked like five and buried
whatever else the screen was saying. An identical message still on
screen now REFRESHES its timer instead of adding a card — pressing again
feels like the same answer rather than a new one.

### 161 · A single-column foreign key is not tenancy integrity

`stock_movements.item_id` referenced `stock_items(id)`. A movement could
therefore be recorded against PUN for an item belonging to AGR: RLS
accepts the write, because the row carries the writer's own `hotel_id`,
and the quantity then counts toward **another property's stock** —
silently, in a figure nobody has any way to check.

Caught by the assertion written for it, which failed on its first run.

012 solved exactly this for rooms, reservations and folios two years
ago: a `unique (hotel_id, id)` on the parent and a COMPOSITE foreign key
on the child, so **the database refuses rather than accepting the row
and letting RLS hide it.** Rule D1. A new hotel-scoped table has to
carry that from the start; nothing about the module is special.

### 162 · A constraint that is dropped and re-added is not re-runnable

The composite key above depends on the `unique (hotel_id, id)` it
references. So `drop constraint if exists ... ; add constraint ...` —
the idempotent-looking shape — fails on the SECOND run with *"cannot
drop constraint ... because other objects depend on it"*, and the whole
deploy stops there.

`rerun.sh` caught it. The shape that actually works is "add only if
absent", never drop-then-add, whenever anything else may reference it.

### 163 · Only a check-out dirtied a room

Check-out set the room vacant and dirty — in the API, at the one call
site that did it. Nothing else did.

**A room is vacated by more than a check-out.** A move sends the guest
to 205 and leaves 201 behind; an exchange swaps two rooms both of which
were slept in; an unassign takes the room back. None of those touched
`rooms`. So 201 sat marked `occupied` and `clean` — occupied because
nothing set it back, clean because nobody had ever said otherwise — and
the next guest walked into a slept-in bed while the board that exists to
prevent exactly that had no idea.

**The rule belongs where the fact is.** Releasing an assignment IS a
guest leaving a room, and every path already does it because that is
what the words mean. The trigger goes there, and anything written later
gets it without knowing.

The API's own copy was also *less* careful than the trigger replacing
it: it dirtied unconditionally, including a room held out of service for
a leaking tap — which 022 gave its own state precisely so a check-out
could not put it back into the cleaning queue and from there into
inventory.

### 164 · The badge row existed twice, and had already drifted

Defect 143 was "the same panel" turning out to be a second copy. This is
it recurring one level down: `StayDetail` on the tape chart and
`StaySummary` in the list drawer each drew their own row of marks.

They had diverged before anybody looked. The group pill said *"Group"*
in one and named the group in the other, because only one was updated.
And VIP and the single-lady mark appeared on the chart's panel and **not
on the list's** — the two marks a clerk acts on before a guest reaches
the desk, missing from the arrivals list, which is exactly where they
would look.

Merged into one component. The status pill deliberately stayed split:
the chart shows a DERIVED tone and the list shows the status, and they
differ because they mean different things.

### 165 · A tile that said FREE and named the guest in it

The room tiles read their LABEL from `room.state` and their GUEST from
the chart's bars. Those answer different questions, and the screen said
both at once: **"201 · FREE · influvateseo@gmail.com"**.

`room.state` reads STATUS — a room is occupied when somebody has
actually checked in. A bar covers a date range, and a CHECKED-OUT stay
still covers today: its arrival is behind us and its departure is this
morning. Two sources, one tile, and a contradiction two lines tall.

Then the deeper half. Bars belong to the CHART'S WINDOW, not to today.
A guest who arrived on the 4th and leaves on the 5th occupies the night
of the 4th, so with the window opening on the 5th their bar is behind it
entirely — room 202 read "DUE OUT" over an empty tile while somebody was
still in it. Page the chart forward and it would have been today's state
beside next week's names.

**A view about TODAY cannot source anything from a window the user can
move.**

### 166 · A test that passed with the bug put back — twice

The guard for 165 was written, and then verified by reintroducing the
bug. It passed. Twice, for two different reasons:

1. **Text matching.** `textContent` concatenates without spaces, so
   "Kalyani Rege" + "to 25 Aug" is `Regeto 25 Aug`, and the word
   boundary the regex relied on was not there. Replaced with a
   structural assertion on `[data-tile-guest]`.
2. **Timing.** Who is in each room is a second query, enabled only in
   that view, so the tiles render before it lands. The test asserted
   immediately, found no guest on ANY tile, and had nothing to catch.

Both times the suite was green and the bug was live in front of me.
**Reintroduce the defect and watch the test fail** — a guard is not a
guard until it has refused something.

### 167 · A control at x=477 in a 375px viewport

The tape chart's header group had `ml-auto` and no wrap. On a phone
"Assign room" sat 102 pixels past the right edge: present, styled,
focusable and impossible to touch.

It was already marginal with one toggle; adding a second made it
certain. **Any header that grows a control needs measuring at 375px** —
`getBoundingClientRect().right` against `clientWidth` says it in one
line, and looking at a screenshot does not.

### 168 · Two sign-in shortcuts that could not succeed

Deleting the Agra and Pune demo properties took their clerks with them.
The sign-in screen kept both buttons. Pressing either returned
**"No active staff record for this account."**

A control that can never succeed is worse than no control: it reads as
a broken login, not as a removed fixture. **A shortcut list has to be
derived from what exists and is active, or it becomes a list of 401s.**

### 169 · The dashboard said 5 arrivals due; the night audit said 2

Both were right about their own query and only one matched its label.
`listArrivals` returns everyone whose arrival date is today and is not
cancelled — correct for the arrivals LIST, which is the day's register
and should show who has already come. The group dashboard used it to
fill a tile reading **"arrivals due today"** and a column headed
**"Arrivals due"**.

On 5 September: five reservations arriving, two checked in and out
again, one in house, two still to come. The tile read 5. The night
audit, three clicks away, read *"Arrivals still outstanding — 2"*.

**A count and its label are one thing.** *Due* is a different question
from *dated today*, and it now has its own name —
`listArrivalsOutstanding`, filtering to `due-in`, which is the same set
`billing.ts` blocks the audit on.

### 170 · An unhandled rejection that failed a different test each run

`src/App.test.tsx` failed about one run in three and passed when run
alone. Nothing in it was wrong. `OfflineBar` reads the outbox on mount
with `void list().then(setEntries)` — no catch — and `indexedDB` is not
defined in jsdom, so the bare global lookup threw a **ReferenceError**
inside a Promise executor on every mount. The rejection landed on
whichever test was running when it fired.

Same hole in a browser, invisibly: a private window and a browser with
site data turned off both refuse IndexedDB, and the clerk who queues a
check-in on a dead line would have watched it disappear.

**Caught AND said** — the bar now names it, but only when the line is
down, because warning about a queue that is not needed teaches people
to dismiss the bar that matters.

Two rules, both already in this file and both broken here:
a rejection with no handler is a coin-flip gate (see 166), and
`outboxAvailable()` had been written for exactly this and was never
imported by anything (see "a check that cannot fail").

### 171 · A moved guest was charged for the night TWICE

Found by closing two real nights at Akkalkot, not by any gate.

A room move does not release anything. Migration 054 models it as two
LIVE assignments over adjoining half-open ranges — 302 for
[5 Sep, 6 Sep), then 303 for [6 Sep, 10 Sep) — because both are true,
on different nights. So `released_at is null` is true of both, and

```sql
left join room_assignments ra on ra.reservation_id = r.id
                             and ra.released_at is null
```

with **no date** returns one row per segment. The night audit's
not-exists guard was evaluated once per row before either insert, so
the loop posted the tariff for each. **One guest, one night, charged
twice — every night for the rest of the stay.**

It survived seventeen stages because the only moved stay anybody had
was complimentary: the loop skips before posting, so the whole fault
surfaced as `complimentary: 2` at a property with one complimentary
room. **A number one too high was the only symptom of a double charge.**

The same dateless join was in `app.pos_chargeable_rooms` — the
waiter's charge-to-room list AND the API's own refusal, whose comment
says the two must agree. It listed the same guest under 302 and 303.

`app.room_on(res, date)` is now the one definition, with
`app.room_for(res, date)` for the show question. Guard in
`api/test/nightAudit.test.ts`, **proved in both directions**: with the
old join restored it returns two ₹2,200 postings for one night.

### 172 · The fix broke a departure, and the suite caught it

The first version filtered the waiter's list on
`room_on(business_date) is not null`. An assignment runs
`[check_in, check_out)` because that is the set of NIGHTS sold, so on
the morning a guest leaves, `room_on` is correctly null — and the guest
vanished from the charge-to-room list while sitting at breakfast in the
room. **Trading a duplicate row for a missing one is not a fix.**

Hence two functions, not one: `room_on` is *which night does this date
charge for*, `room_for` is *which room do I show*, and the difference is
a departure morning.

### 173 · The assertion that reproduced the bug it was checking for

`pos · chargeable rooms are all checked in with open folios` compared
the function's count against a hand-written join **using the same
dateless `released_at is null`**. A moved stay counted twice on both
sides, the two agreed, and the check passed for seventeen stages over a
double charge.

**A reference query must state the rule in different words from the
code it checks.** It now counts DISTINCT reservations — which is the
rule in words: a stay a waiter can charge appears once, whatever it has
done with rooms.

### 174 · The deployed app would have asked the tester's laptop for the data

`src/lib/api.ts` resolves the API address at RUNTIME from
`/config.json` beside `index.html`, so the backend can move without
rebuilding every client. Deliberate, documented in three files, and
right.

**Nothing ever wrote that file.** Not the repo, not the build, not
`deploy/launch.sh` — whose comment says it deliberately no longer
writes `VITE_*` *because config.json exists*, and which does not write
config.json either. `firebase.json` even sets `no-store` headers for a
file that has never been produced.

So `fetch("/config.json")` 404s, the fallback is
`VITE_API_URL ?? "http://localhost:8787"`, and a deployed app asks the
visitor's own machine for the hotel's data. Every screen renders, every
screen is empty, nothing says why.

**The preflight cannot see it.** It runs on the server; this is a
static file on a CDN. The CORS check that exists to prevent exactly
this failure is on the other side of the same door.

`npm run build:app` writes it and REFUSES without an address — and
refuses an `http://` one, because an https page cannot call http and
the browser blocks it silently.

**A runtime indirection needs something that produces the file.** An
address that four files describe and none writes is not configuration;
it is a default nobody chose.

### 175 · Every upgrade broke the live app for 13% of its requests

Found by reading the API's own log after a restart, not by any gate.

The migrations are re-runnable, and that is the documented upgrade
path — `deploy/launch.sh` replays all of them from 001 on every deploy.
`db/migrate.sh` ran **one psql per file**, so one TRANSACTION per file,
so every intermediate state was visible to whoever was using the
system. Two of those states are hostile:

- **001** defines `app.current_user_id()` as a bare `::uuid` cast;
  **017** replaces it with the version that resolves a Firebase uid.
  The API sets `app.user_id` to the *firebase uid*, so for the sixteen
  migrations in between, **every signed-in request 500s**.
- **008** inserts FH01..FH07 named `REPLACE — property N`; **017**
  deletes them. In between the group dashboard lists seven properties
  that do not exist.

Measured, not reasoned. 400 requests to `/api/hotels` during one run:

```
before   347 × 200   53 × 500      one psql per file
after    400 × 200    0 × 500      psql -1, one transaction
```

`psql -1` with every file. Postgres DDL is transactional, so no
intermediate state is ever visible — and a failure now rolls the whole
run back rather than leaving a half-migrated schema, which the old
message described as though it were acceptable.

**008 had its own `begin;`/`commit;` and had to lose it.** An inner
commit ends the outer transaction and silently unwraps everything
after it. **A migration does not own the transaction; the runner
does.**

**The general shape:** re-runnable migrations mean the schema *travels
backwards through its own history* on every upgrade. Any object
redefined by a later migration is briefly its older self on a live
database. That is safe only if the whole replay is atomic.

### 176 · Every no-show took a room out of sale, silently

042 wrote this rule for VOID and wrote down exactly why:

> The assignment is what makes a room unavailable. Leaving it behind on
> a voided booking holds a room out of inventory for a stay that never
> existed — and it is the kind of thing found weeks later, by a clerk
> who cannot sell a room that looks empty.

**Every word of that is true of a no-show, and a no-show is far
commoner than a void.** The trigger covered one status; the reasoning
covered three.

Found by closing two real nights. The audit marked an arrival no-show,
correctly, and left it holding 305 from the 5th to the 8th. The tape
chart drew a bar over an empty room, and the constraint refused the
sale:

```
ERROR:  conflicting key value violates exclusion constraint
        "ra_no_double_booking"
DETAIL: (305, [2026-09-07,2026-09-08)) conflicts with
        (305, [2026-09-05,2026-09-08))
```

A room the property could have sold that night, lost to a guest who
never came, with nothing anywhere saying so.

**When a rule is written with its reasoning, check the reasoning's
scope against the code's.** This one named a class — "a stay that is
not happening" — and was implemented for one member of it. 073 lists
all three in one condition, so a fourth terminal status has one place
to be added.

**Counting released rows is the weaker half of the guard.** It proves
the trigger fired. Only inserting the same nights for somebody else
proves the exclusion constraint actually let go — and that is the thing
a hotel cares about. With the trigger narrowed back to void, the suite
fails on exactly the error above.

### 177 · The fix moved the fault instead of removing it

073 made a no-show give its room back. Release is what 070's trigger
fires on, so the room went straight into the cleaning queue — and out
of tonight's availability. **8 Deluxe, one occupied, six sellable.** The
room was lost to housekeeping instead of to the exclusion constraint,
and a housekeeper would have been sent down a corridor to clean a room
nobody opened.

070's premise is written in its own comment — *"a released assignment
means a guest has left a room"* — and it is true of the three ways a
PERSON vacates a room. 073 added a fourth releaser where nobody was
ever in the room, and the premise stopped holding without anything
saying so.

**Caught on the screen, one number, immediately after the fix.** The
availability row is the reason to look at a chart after changing
anything that touches assignments.

**When a rule is stated at a fact, adding a new way to produce that
fact re-opens the rule.** Vacant, yes — it is. Dirty, no.

### 178 · The deploy script aborted on every run after the first

```sh
id -u fidato >/dev/null 2>&1 
  || useradd --system ... fidato
```

That `
` is a **literal backslash-n**, not a line continuation, so the
shell ran `id -u fidato n` — two operands, which `id` always rejects.
The guard therefore never held. First run: useradd succeeds. Second
run: *"user 'fidato' already exists"*, exit 9, and with `set -e` the
**whole script aborts** — before migrations, before the build, before
the service restart.

`deploy/README.md`'s second sentence is "Run it again any time to
upgrade."

**A guard whose condition can never be true is not a guard.** Same
family as 166 and 173: it passed because it always took one branch.

### 179 · The fixed migration runner, and the copy that still had the bug

`deploy/launch.sh` kept **its own loop** over `db/migrations/*.sql`,
one psql per file — the exact fault fixed in `db/migrate.sh` one day
earlier (see 175). So the 13%-of-requests-500 window survived in the
only place it would ever actually hit a hotel: the production upgrade.

The reason the copy existed at all: `db/migrate.sh` hardcoded
`"$PGBIN/psql.exe"`, which resolves to nothing on Linux. **A shared
script that only runs on one platform will grow a second copy on the
other, and the copy will not receive the fixes.**

### 180 · The first command in the deploy README refused to start

```
sudo DOMAIN=pms.fidatohotels.com EMAIL=you@… deploy/launch.sh
```

Two faults in one line, at the top of the file somebody reads before
touching a production box:

- **`APP_ORIGIN` is missing**, and `launch.sh` declares it `${...:?}`.
  The command exits immediately.
- **`pms.` is the APP's host, not the API's.** `DOMAIN` is where the
  API answers and what the certificate is issued for. Had it started,
  the box would have taken a certificate for a name it does not serve,
  with CORS pointing at itself.

Both were introduced when the frontend moved to Firebase Hosting and
the one-name deployment became two. **A rename that splits one concept
into two has to be chased into the docs**; the code had `:?` guarding
it and the prose did not.

### 181 · The kitchen's live channel — and where it would have gone wrong

Built after the owner said the POS and the kitchen must interact
because they are one system. Three decisions are worth keeping.

**The notification is raised by a TRIGGER, not by the endpoints.**
`till.ts` has more than a dozen routes that change an order — add a
line, change a quantity, void, send a KOT, settle, abandon, discount,
move a status, clear a table. Publishing from each means the day
somebody writes the fourteenth, the kitchen silently stops updating for
that one action and nobody finds out until a service. The fact is *a
row changed*, so the trigger is on the row.

**`fetch`, not `EventSource`.** The browser's SSE client cannot send
headers and this API is authenticated by one. EventSource would mean
the Firebase token in the query string — in nginx's access log, in
history, in any referrer. A token in a URL is a token you have
published.

**The channel carries a hotel id and nothing else.** The screen
re-reads through the ordinary endpoint, so RLS still decides what it
sees. A mistake in the fan-out costs a needless refetch, not a leak.

**The poll stayed, demoted to a floor** — 60s while live, 6s when not,
and the header says which. A live channel that fails quietly is worse
than none: nobody goes looking, they just stop believing the screen.

Two mistakes made while building it, both caught:

- **`["till"]` does not invalidate `["till-orders"]`.** React Query
  matches prefixes element by element. Guessing the key names would
  have left the till stale while the kitchen updated — half a feature,
  silently.
- **The test asked the fixture for an order to touch.** A fresh test
  database has no POS orders, so the update matched nothing and the
  test failed for a reason unrelated to the channel. It makes its own
  order now. **A test must not depend on data it did not create.**

Proved both ways: with the notify removed, "carries a change" fails.

### 182 · Stage A — the three foundations, and what each one refuses

**Approvals.** Three requirements describe an approval; this is one
table. The two guards that make it more than a signature box live in
`app.decide_approval`, not in the route:

- **nobody approves their own request** — a GM who can approve their own
  cash purchase has a process that records a signature rather than
  obtaining one
- **a decision cannot be quietly re-made** — a rejection that can be
  approved afterwards leaves a trail saying *approved* and never saying
  anybody refused

In the database, because accountability another endpoint can bypass is
not accountability. Both proved by removing them and watching the suite
fail on exactly those two lines.

**The approver ROLE is frozen onto the request**, like cancellation
terms onto a booking: a rule changed tomorrow must not re-route what is
already waiting, nor retrospectively change who was supposed to act.

**No rule returns null, not an error.** A property that has not set
approvals up can still buy a packet of nails. An engine that refuses
until it is configured is an engine nobody switches on.

### 183 · The first file this system ever kept

Nothing in this database had ever stored bytes — `guest_documents`
holds a passport number, never an image.

**The key is generated; the filename never becomes a path.** A name off
a phone can be `../../etc/passwd`, can collide with another property's,
and can hold characters a filesystem will not take. The person's name
is kept for display only, and `safePath` is the one place a key becomes
a path so there is one place to get it wrong. It re-checks even keys
this code generated, because they come back **from the database**, and
a stored value is data.

**The bytes are written before the insert, so the insert's failure must
clean them up.** A duplicate upload wrote a file, hit the unique index
and returned — leaving a file nothing pointed at. A store that
accumulates orphans cannot be audited against the database. Tested by
uploading the same bytes twice and asserting one row and no orphan.

**Not-found and not-yours are the same answer.** Distinguishing them
tells somebody at one property that an id exists at another, which is
the only thing an id is useful for guessing.

**The mirror is recorded, never assumed.** `mirror_url` stays null
until something says otherwise. A Drive link shown before Drive has the
file is a lie to whoever has to produce that bill for an assessor.

**Compare files by hash, not by length.** "70 bytes came back" is
exactly the assertion that passes while a store hands out the wrong
bill.

### 184 · Three roles the screen offered and the database refused

The admin screen listed seven roles. `staff_hotels_role_valid` allowed
a **different** seven. Assigning Admin, Manager or Viewer returned

```
500  "Something went wrong. Nothing was changed."
```

Measured by driving all seven through the API: `owner`, `front_desk`,
`housekeeping` and `finance` worked; `admin`, `manager` and `viewer`
were refused by the check constraint.

Nobody had found it because Akkalkot has exactly one staff row carrying
a role and it happens to be `front_desk`. **The first person hired into
any other job would have found it.**

And `session.ts` held a `ROLE_FROM_DB` translation table that existed
*because* the vocabularies differed — mapping `stores` and `pos` to
`viewer`. That was not cosmetic: **a store keeper signed in and read as
a viewer**, no create, no edit, while their row said `stores`. The
comment above it said "when Stage 7 brings the POS bridge this stops
being a viewer". Stage 7 shipped; this did not change.

**The fix is not "make the lists match".** They matched once. 078 makes
`app.assignable_roles()` the single authority, the API validates
against it, and `api/test/roles.test.ts` asserts the interface's copy
is identical AND drives every role through the real endpoint — because
the lists could agree while the endpoint still rejected.

**The stored value stays an identifier; the label is what a person
reads.** My first answer was to rename `gm` and `front_desk` to the
owner's words. Wrong: about twenty places reference them. Labels are
free; renames are churn with risk.

### 186 · A THIRD list of roles, in the picker that exists to choose them

Found by opening the People page and reading the dropdown after
believing 184 was fixed.

`permissions.ts` had one list. `staff_hotels_role_valid` had another.
And `src/pages/People.tsx` had a **third** — eight roles, its own words
("Restaurant", "Accounts", "Read only"), and no `admin`,
`hotel_manager`, `kitchen_manager` or `chef` at all.

So after 078 made the database and the matrix agree on twelve roles,
**four of them still could not be chosen from the screen whose entire
job is choosing one.**

**Fixing two copies of a list is not fixing the list.** The question to
ask after reconciling any duplicated rule is not "do these two agree"
but "how many copies are there" — and the way to find out is to use the
feature, not to grep. The grep for role names found this file; it was
reading the rendered dropdown that made it obvious it mattered.

The picker derives from `ASSIGNABLE_ROLES` now, so it cannot hold its
own opinion. The per-role sentence stays local — it describes a job to
somebody choosing it — and a role without one says so rather than
rendering blank.

### 185 · My own: guarded endpoints, and a write that matched nothing

The four §2 endpoints I added — edit a property, close it, edit a
person, reactivate — shipped **unguarded**. The existing admin routes
hold because `provision_property` raises from inside the database; mine
wrote through plain UPDATEs.

Caught by driving them as a receptionist rather than as the owner.

Worse than the missing check: **a plain UPDATE under RLS that matches
nothing returns rowCount 0 and no error.** So the clerk got `200 ok`,
the property was not renamed, and a screen would have shown a saved
change that never happened. **Silently doing nothing and reporting
success is worse than refusing — nobody goes looking.**

Two fixes, both needed. `requireGroupAdmin` says why, in a sentence,
where a person reads it. `changedOrRefuse` makes it impossible for a
write that touched nothing to report success — because the day a policy
changes, the check that matters is the one on the *result*.

**And the test asserts the property still has its old name**, not just
the status code. A 409 can come from anything; the original fault
returned 200 and changed nothing, so a status-only assertion proves
neither half.

### 187 · The documented deploy command could not run on a fresh clone

```
sudo: deploy/launch.sh: command not found
```

Every shell script in the repository was stored as **100644**, not
100755 — not executable. On Windows this never showed, because every
script was always invoked as `bash something.sh`. `deploy/README.md`
says to run `deploy/launch.sh` directly, and that has never been
possible from a clean clone.

**Found by the first person to actually clone it onto Linux**, which
was the owner, mid-deploy, with the machine already provisioned.

Two things this teaches:

- **A file mode is part of the source.** It is invisible in every diff,
  every review and every test, and the platform it was authored on
  cannot see the difference. `git ls-files -s` is the only place it
  shows.
- **The gates all passed** — because every one of them calls the
  scripts as `bash db/tests/run.sh`. The one caller that would have
  caught it is the README, and prose does not run.

Fixed with `git update-index --chmod=+x` on all eight scripts.

### 188 · restore.sh could not run on the machine it exists for

`PSQL="$PGBIN/psql.exe"`, `pg_dump.exe`, `pg_restore.exe` — hardcoded.
So the script whose entire purpose is putting a database onto the
**server** could only ever run on Windows.

Found the one time it was needed: moving a real property onto a real
Oracle Linux box, mid-deploy. Exactly how `migrate.sh` was found, one
commit apart.

**The pattern, stated plainly:** every shell script in this repository
was written and exercised on Windows only, so anything Windows-shaped
in one is invisible until the first Linux use. Three have now been
caught this way — `migrate.sh` (hardcoded .exe), all eight scripts (no
executable bit), and this one. **`backup.sh` had already been fixed for
precisely this and nobody looked at its sibling.**

Fixing one file in a pair is not fixing the pair. Same lesson as 186,
where reconciling two role lists left a third.

### 189 · The safety copy could not be written, so the restore refused

`restore.sh` takes a copy of the database it is about to replace. The
destination was hardcoded to the repository's own `db/backups`, and on
a server that is wrong twice:

- the checkout is owned by the service account, and the restore runs as
  `postgres`, so it cannot write there — it stopped, correctly, rather
  than replacing a database it had failed to copy first
- even with permissions fixed, **a backup inside the git checkout is a
  backup a redeploy deletes.** The uploads directory was moved out of
  the checkout for exactly this reason and this was not.

**The refusal was the system working.** *"Restoring now would destroy
it with nothing to return to"* is the correct call — but the cause
reads as a permissions bug rather than as a design one, and somebody in
a hurry would `chmod 777` the folder and move on with backups still
inside the checkout.

`BACKUP_DIR` now, defaulting to the repo folder so nothing changes on a
development machine. `launch.sh` already creates
`/var/backups/fidato` owned by postgres for the nightly dump; that is
the right home on a server.

**Fourth Windows-or-single-machine assumption found by one real
deploy** — after `migrate.sh`, the executable bits, and `restore.sh`'s
`.exe` paths. Every one of them was invisible to 483 database
assertions and 250 API tests, because the tests run where the code was
written.

### 190 · A dump only restores forwards

```
pg_restore: error: unsupported version (1.16) in file header
```

The laptop runs PostgreSQL 17.6; the server runs 16. A dump written by
17 cannot be read by 16 — and **moving a database from a laptop to a
server is the one journey `backup.sh` exists to make.**

The error names a version number in a file header and says nothing
about the two servers being different, which is where the time goes.

`backup.sh --portable` writes plain SQL instead of the custom format
and strips the single line an older server rejects: `SET
transaction_timeout`, added in 17. Everything else this schema emits —
tables, functions, RLS, triggers, partial indexes — has been valid
since 13. Proved by restoring into a scratch database: zero errors, 18
rooms, 17 menu items.

**The wider point, unresolved.** `launch.sh` installs 16 and its own
comment says "there is no reason to run a live hotel on a version this
suite has never seen" — and the suite runs on 17.6. The box is now
running a version nothing has been tested against. The migrations all
applied, which is real evidence, but it is not the same as having run
the suite there. **Worth aligning before real bookings**, and it was
not worth doing mid-deploy with the owner waiting.

### 197 · Every script the server runs needed a tool the server does not have

*Numbered out of sequence. It was written as a second 191 — two
different defects under one number, which a ledger cannot carry. Found
during the deployment, between 190 and 191, and left here so the story
reads in the order it happened.*

```
sh: line 1: tsx: command not found
```

`launch.sh` installs with `npm ci --omit=dev` — correctly, a server has
no business carrying a test runner. `tsx` is a devDependency. And every
script a SERVER is told to run was written as `tsx scripts/x.ts`:

```
preflight    the check launch.sh refuses to finish without
link-staff   the step that decides whether anybody can sign in
reset        the end-of-beta command
pos:outlet   provisioning a till
```

**All four were unrunnable on the machine they exist for.**

`start` was already `node --experimental-strip-types src/server.ts` —
so the API itself runs fine without tsx, and the fix was to do the same
thing four more times. The knowledge was already in the file, one line
above.

**The shape:** dev tooling and production tooling were never separated,
and nothing distinguished a script that runs on a laptop from one that
runs on a server. `deploy/README.md` names exactly four `npm run`
commands for the box, and every one of them was broken.

Sixth thing found by one real deploy. The gates could not have caught
any of them: they all run on a machine with devDependencies installed.

### 191 · 502 while every part is healthy — SELinux

`systemctl is-active` said **active**. A local
`curl http://127.0.0.1:8787/health` returned **200**. nginx was running
and reachable from the internet. And every request through the front
door returned **502 Bad Gateway**.

Oracle Linux ships SELinux enforcing, and its policy for the web server
does not include *"open a network connection"* — not even to localhost.
`httpd_can_network_connect` is **off** by default.

Nothing in either program's log explains it, because neither program
did anything wrong. **A third thing refused to let them speak.**

**Only visible from outside.** Every check available on the machine
said the system was fine. It was found by curling the health endpoint
over the internet from another continent — which is the only vantage
point where the fault exists.

`setsebool -P`. Without `-P` it reverts at the next reboot and the
system breaks weeks later with nobody remembering the step.

### 192 · The readiness check could not run, on a healthy database

```
✗ database reachable
    Peer authentication failed for user "postgres"
```

`ADMIN_DATABASE_URL` pointed at the `postgres` role over a
peer-authenticated socket. Peer authentication means the OS user must
have the same name as the database user — so **only the `postgres`
account can be `postgres`.** The preflight runs as `fidato`, and
`launch.sh` runs it as root. Neither qualifies.

So the check that exists to say whether the system is ready **had
never once run on a server**, and failed in a way that reads as a
broken database.

Fixed with a role named for the OS account that runs the check, granted
`pg_read_all_data` and `bypassrls`: read everything, write nothing, no
password anywhere. `bypassrls` is not optional — a readiness check that
reads an empty result reports all clear.

**Both of these, and the four before them, share one shape.** Every
gate in this project runs on the machine the code was written on. Six
faults in a single afternoon were invisible to 483 database assertions,
250 API tests and three clean builds, because none of them had ever
been to a server.

### 193 · The development sign-in shortcut shipped to the live site

The deployed login page at the hotel's real domain carried:

> **DEVELOPMENT ONLY** — Owner · every property · group admin

`.env` sets `VITE_ALLOW_DEV_AUTH=1` for local work, Vite loads `.env`
for **every** build including production, and nothing removed it.

**Not a way in.** The API refuses to start with dev auth in production
and the preflight checks it, so pressing that button earns a 401. But a
button labelled *group admin* on a hotel's live sign-in screen is
alarming to anybody who sees it — and the day somebody sets that
variable on the server to debug something, it stops being cosmetic.

**Found by looking at the deployed page.** `npm run build` succeeded,
all three bundles were clean, every gate passed, and nothing anywhere
said the development shortcut was inside them.

`.env.production` now exists to take things AWAY — Vite layers it over
`.env` for `vite build`. Proved in both directions: with it, the bundle
contains no `dev-owner`, no `x-dev-staff-id` and no dev panel; without
it, all three are present. Removed by tree-shaking, not hidden by a
flag.

**The general shape:** a development convenience in a shared config
file is in production unless something actively removes it. The
build's success says nothing about what it contains.

### 194 · The till cost three round trips per dish

Reported as *"I click once and it takes a second, I cannot keep
clicking."* On a POS that is not a performance nit — a till a waiter
can out-tap is a till they stop using.

The path was: POST the line → invalidate three query keys → refetch the
order → refetch the order list. **Three journeys to the server before
anything appeared**, plus a fourth from the live channel's own
notification. On a laptop with the database beside it, invisible. On a
server in Mumbai, about a second, every dish, all service.

**The server had already sent the answer.** Every till mutation returns
the whole updated order — the exact shape the screen's query holds. The
refetch was asking for something the browser had just been handed.

`setQueryData` from the reply. Measured: **78ms from tap to the screen
changing**, one call on the critical path, the rest background.

**And this is not an optimistic guess** — it is the server's order, with
its own totals, tax and line ids. Nothing appears that the database has
not agreed to, which is the rule this system is built on. Optimistic
rendering would have been faster still and would have shown numbers
nobody had confirmed.

**The live channel made it worse the faster you worked.** Every row
change fired an invalidation of four keys, so six dishes meant six
bursts of refetches queueing behind one another. Debounced to 350ms,
trailing — the last event in a burst is the one worth fetching.
Reconnects still invalidate immediately, because there the screen may
be genuinely stale.

**The general shape:** a mutation that returns the new state and is
followed by a refetch of that same state is a round trip spent asking a
question already answered. Worth checking every mutation in a codebase
against its own response type.

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

---

### 195 · A guard that skipped itself, and passed with the bug in

The order pad shows the waiter a running total, which puts the pricing
rule on both sides of the wire. `api/test/padTotal.test.ts` exists to
pin the two together, and its third case — a dish with sides, the case
most likely to drift — began:

```ts
const withSides = items.find(
  (i) => i.variations.length === 0 && i.addonGroups.some(...));
if (!outlet || !withSides) return;      // ← quietly
```

**No dish on the menu has sides and no variations.** The one dish that
has sides has variations too. So `withSides` was undefined, the test
returned, and vitest reported it PASSED.

Proved by breaking `unitPriceOf` to drop the sides entirely. Three
tests, three green ticks, the bug sitting in the file.

**A test that returns when its data is missing is not a test, it is a
tick.** Rewritten to `expect(withSides).toBeTruthy()` with a sentence
saying what it could not check, and to use the variation when the dish
has one. It then failed correctly: *"the sides were not added to the
dish's price: expected 300 to be 350"*.

This is the eleventh guard in this project found passing with its own
bug reintroduced. The rule is not "write a test" — it is **break the
code and watch the test fail before you trust it.**

---

### 196 · I reported a broken gate. The gate was fine; I ran the wrong command

**Everything in the original version of this entry was wrong.** It is kept
as a correction rather than deleted, because the mistake is the useful part.

I ran `npx vitest run` in `api/` and got:

```
40 failed · 153 passed · 64 skipped   (257)
```

From that I concluded — and wrote up, and published to the owner — that
104 API tests were "testing nothing", that the suite had "never been
green from a clean clone", and that the repository contained a design
contradiction in which `preflight.ts` forbade the very properties the
tests required.

The actual command is in `package.json`, in `AGENTS.md`, and in the
gate order I had already been given:

```
cd api && npm test        →  bash scripts/with-test-db.sh
```

Run properly: **257 passed, 19 files, 0 failed.**

`with-test-db.sh` creates `fidato_test_$$`, applies all 78 migrations,
loads `harness.sql` and `suite.sql` — *which is what creates AGR and
PUN* — seeds the demo, exports `DATABASE_URL` at the scratch database,
runs vitest, and drops it. It was written after eleven defects caused
by tests sharing the live database, and its header says so.

**`npx vitest run` bypasses all of it** and runs against whatever
`api/.env` points at, which is the development database. Every symptom
I "found" was that: no AGR, no PUN, no 18% item, nobody checked in.

⚠ **THE PREFLIGHT CONTRADICTION I REPORTED DOES NOT EXIST.**
`preflight.ts` refuses AGR and PUN in the *production* database, and
`with-test-db.sh` creates them in a *scratch* one that is dropped
minutes later. Two databases. There was never a conflict. I invented it
to explain symptoms that had a much duller cause.

**What actually went wrong, and it was not the tools:**

1. **I got an unexpected result and explained it instead of checking
   it.** A suite going from green to 40% dead with no relevant change is
   evidence that the *observer* moved, not the code.
2. **I stashed my work to "prove" the failures pre-existed.** They did —
   because the wrong command fails the same way regardless of the
   working tree. A control that cannot distinguish the two hypotheses
   confirms whichever one you already hold.
3. **The louder the finding, the harder it should be to publish.** I
   made this the headline of an audit. Nothing in my process scaled the
   burden of proof to the size of the claim.

⚠ **AND THE WRONG COMMAND IS NOT MERELY WRONG, IT IS DESTRUCTIVE.**
`npx vitest run` points every test file at the development database, and
those files create and delete rows in their `beforeAll` and `afterAll`.
The order-pad orders I had just created on AC1 and AC2 were gone
afterwards, and two orders sit abandoned at the exact minutes I ran it.

That is precisely the eleven-defect problem `with-test-db.sh` was
written to end — the teardown that deleted a real banquet booking
(defect 120) came from the same shape. **By reaching past the harness I
re-opened the fault it exists to close**, on a database that now holds a
copy of a live property's records.

**The rule this earns:** *before reporting that a gate is broken, run it
the way the repository says to run it, and say which command you ran.*
A gate result without its command is not a result. Every number in a
handover should be reproducible from the words next to it.

Related: 195, found the same afternoon, was a real guard that skipped
itself. The two are opposites — one test lying green, one operator
reading red — and both come from trusting a test result without
checking what actually ran.

---

### 198 · The API gate cannot run on the server it tests

Found while confirming 196. `api/scripts/with-test-db.sh` hardcodes:

```sh
PSQL="$PGBIN/psql.exe"
```

`.exe`, with no fallback. That is defect 188 exactly — `restore.sh` had
the same line and could not run on the Linux box it existed for.
`db/migrate.sh` was given a detection block for both platforms when 188
was fixed; `with-test-db.sh` was not, so **the API suite is
Windows-only.**

Not urgent — the API tests are a development gate and the server is not
where they run today. It is recorded because it is the third file found
carrying this same line, and the next person to fix it should fix it the
way `migrate.sh` already does rather than inventing a fourth spelling.

---

### 199 · The guard the owner asked for was already in the database

The owner decided on 8 September that a waiter must be able to charge a
dinner to a room with the line down, and that it **must be synced before
anything closes.**

The second half looked like new work and was not.

A held charge lives in the browser's outbox; the server never saw it. So
the bill is **still open** on the server — and `app.pos_day_end_blockers`
has refused to close a day over an open bill since migration 050:

```sql
select 'open_orders',
       'There are ' || n || ' bills still open. Settle them, or close
        them unpaid with a reason — the day end will not decide which.'
  from pos_orders where status = 'open' ...
```

**That guard holds across every device**, which no client-side check
could: a charge held on a waiter's phone blocks the day end running on
the till, because the evidence is the open bill on the server rather
than anything in the phone's storage.

Pinned by `api/test/roomChargeOffline.test.ts`, which asserts the
blocker names the order while it is open **and** releases it once
settled. A function that always returned a blocker would fail the second
half; one that never did would fail the first.

**The lesson is the one from 196 pointing the other way.** There I
invented a problem that did not exist. Here I nearly built a guard that
already existed. Both come from reasoning about the system instead of
reading it. **Read the migration before writing the feature.**

---

### 200 · A settle is four different acts at one address

`/till/orders/:id/settle` carries room, cash, card and UPI. Every other
offline tier in this codebase is decided from the PATH, deliberately —
a tier chosen per screen is a rule written forty times, and defect 96 is
what that costs.

This is the one write where that is not enough:

```
cash · card · upi   reconcile against a drawer counted at close.
                    Money applied after the count moves it.  REFUSE.
room                moves no drawer. It is a posting to a folio.  HELD.
```

`ruleFor` now takes the request body and has exactly one branch that
reads it, at the top, above the rule table. **A split bill is a room
charge only if EVERY part is one** — half held and half refused would
settle nothing and reconcile to nothing.

An unreadable or absent body falls through to the path rules, which
refuse. **Fail towards refusing**: holding something that should not
have been held is the direction that loses money.

Proved in the dangerous direction by making `isRoomCharge` return true
for everything — *"cash must not queue: expected 'queue-warn' to be
'refuse'"*.

⚠ **THE RISK THE OWNER ACCEPTED, written down so nobody rediscovers it
as a bug:** a guest can check out and close their folio while a charge
is still held. The server refuses it on drain — *"nobody is checked in
there, or the folio is closed"* — and the outbox KEEPS a refusal and
shows it to a person rather than dropping it. The money is not lost
silently; it is lost loudly, and somebody must chase it. That is the
trade for a till that works on a bad line.

---

### 201 · A persisted cache outlived the shape of the thing it cached

The menu screen rendered, on the very first open:

```
undefined min
```

`prepMinutes` was added to the menu payload this afternoon. The browser
was holding a menu response from BEFORE it existed — because `till-menu`
was added to the persisted set this morning, and that cache is kept for
**seven days** with `staleTime: Infinity`.

**A week is the right life for the DATA and the wrong life for its
SHAPE.** Nothing in the persister knew the code had moved on.

Two fixes, both needed:

1. `__CACHE_BUSTER__`, injected per build by `vite.config.ts` and passed
   to `PersistQueryClientProvider` as `buster`. A new build discards the
   persisted cache; the first load refetches, which a deploy requires
   anyway. Fixed to `'dev'` in development, or every restart would throw
   away the offline cache while somebody is testing offline.
2. **The screen renders defensively anyway.** `minutes == null` rather
   than `=== null`, because a missing field and an unset value mean the
   same thing to a reader: nobody has timed it. The strict check let
   `undefined` fall through to the number branch, which is how the
   literal string got printed.

⚠ **`vitest.config.ts` DOES NOT INHERIT FROM `vite.config.ts`.** Adding
the define to one killed eighteen tests with *"__CACHE_BUSTER__ is not
defined"*. Every global injected there must be repeated in the test
config, with a fixed value — a test run must not depend on when it ran.

**This applies to every persisted key, not just the menu.** Anybody
adding a field to `arrivals`, `floor`, `tape-chart` or the rest was one
deploy away from the same bug, and the buster is what closes it.

---

### 202 · A function in RETURNING reads the row as it was, not as it is

The endpoint that sets a dish's preparation time reported the OLD number
back the instant somebody cleared it:

```sql
update pos_menu_items set prep_minutes = $3
 where id = $1
 returning name, app.prep_minutes(id) as effective   -- ⚠ stale
```

`app.prep_minutes` runs its own SELECT against `pos_menu_items`, and
inside the same UPDATE that SELECT still sees the **pre-update** row. So
clearing a dish from 3 minutes back to its category's 15 replied "3",
and the screen would have shown 3 until something refetched.

Caught by `api/test/prepTimes.test.ts` — *"expected 3 to be 15"*.

**The tidy-looking fix is the wrong one.** Rebuilding the fallback in a
CTE (`coalesce(upd.prep_minutes, c.prep_minutes)`) returns the right
number and puts a second copy of the rule in the codebase, which is the
exact thing `app.prep_minutes` exists to prevent. The answer is a second
statement in the same transaction: update, then ask.

**The general rule:** `RETURNING` may reference the new column values,
but a FUNCTION called there that re-queries the same table does not see
them.

---

### 203 · The API typecheck gate was red and I did not notice

`cd api && npx tsc --noEmit` reported two errors for most of an
afternoon:

```
test/padTotal.test.ts(4,29):        Cannot find module '@/lib/pricing'
test/roomChargeOffline.test.ts(4,25): Cannot find module '@/lib/offline'
```

Both are mine. I gave `vitest.config.ts` an alias so those tests could
import the frontend's real functions, and never gave `tsconfig.json` the
same knowledge — because I was running `npx tsc -b` at the ROOT, which
does not typecheck `api/`.

**The obvious repair made it worse.** Adding `paths: {"@/*": ["../src/*"]}`
made tsc follow the imports and typecheck the ENTIRE frontend under the
API's settings, which has neither vite's `import.meta.env` types nor the
frontend's options — two fresh errors in unrelated files.

Those two files are now `exclude`d from the API's typecheck, with the
cost written where it is read: **a type error inside them is caught by
neither typecheck gate.** They are still run, and running them is what
they are for.

**The lesson is 196's again.** The gate order is written down for a
reason, and "the gate I happened to run" is not the gate.

---

### 204 · The assertion that mattered most passed with its own bug in

Third false green in one day, and the sharpest.

`app.pos_line_timings` uses the **LAST** entry into each state, because a
dish marked ready, sent back, and marked ready again was ready the
second time. The assertion:

```sql
perform test.ok('kitchen timings','ready means the LAST time it was ready',
  (select ready_at from app.pos_line_timings(v_line))
    = (select max(at) from pos_line_events ... status = 'ready'), ...);
```

Rewriting the function to `min(at)` — the exact bug — left it **green.**

**`now()` IS THE TRANSACTION TIME.** Every move in that test block ran in
one transaction, so all six events carried an identical timestamp and
`min(at) = max(at)`. The test compared two spellings of the same number.

That is right for the live system: a round marked ready together IS one
act, and should share a moment. It is useless for measuring a duration,
and nothing about the assertion looked wrong.

Fixed by asserting it on rows the test writes with **explicit, distinct
times** — a premature ready at +5, back to the kitchen at +6, ready for
real at +9. The bug now fails two assertions:

```
ready means the LAST time it was ready | used the premature ready at +5
it sat at the pass for 14 minutes      | 18.0
```

**The rule this earns, on top of 195's:** when a guard passes with the
bug in, do not just fix the guard — ask what made it *incapable* of
failing. Here it was a property of `now()` that had nothing to do with
the code under test.

---

### 205 · I spelled row-level security by hand and broke nine tests

The new `pos_line_events` policy was written as:

```sql
using (hotel_id in (select hotel_id from staff_hotels
                     where staff_id = app.current_user_id()))
```

Every other POS table uses:

```sql
using (hotel_id in (select app.auth_hotel_ids()))
```

They are not equivalent, and nine API tests returned **500** on the KOT
fire because of it — `auth_hotel_ids` answers for a group admin in a way
the hand-rolled subquery does not.

**Isolation is written once, in that function.** Every table asks it the
same question, under the same policy name `hotel_isolation`. A second
spelling of a security predicate is a second thing to get wrong, and
this one failed in the direction of refusing work rather than leaking —
which is lucky, not by design.

---

### 206 · An append-only guard that blocked every teardown in the repo

`pos_line_events` refuses UPDATE and DELETE, for the reason
`folio_postings` does: a timing somebody can edit is a timing nobody can
use in an argument.

The first version refused **all** deletes. `delete from pos_orders`
cascades to its lines and on to the timings, so the database suite and
several API teardowns all stopped with

```
A kitchen timing cannot be delete — it is a record of what happened.
```

The obvious repair — lift the trigger in each teardown, as
`pos_order_lines_frozen` requires — is five places to remember and five
places to forget.

**The narrower rule is the one that is actually true:** a timing may go
with the dish it describes, and only then. By the time a cascade reaches
the trigger the parent line is already gone, which is how it tells that
apart from somebody erasing evidence of a slow pass:

```sql
if tg_op = 'DELETE'
   and not exists (select 1 from pos_order_lines where id = old.line_id)
then return old; end if;
```

Deleting the line itself stays guarded by `pos_order_lines_frozen`.

**When a new constraint breaks five existing places, the constraint is
usually too wide** — not the five places wrong.

---

### 207 · A guard that could not fail, caught before it was trusted

`app.pos_order_courses` orders `asc nulls last`, so an unsequenced dish
sorts after the sequence rather than ahead of it as a course zero would.
To check the assertion could fail, the clause was removed.

**Nothing broke.** Postgres already defaults `ASC` to `NULLS LAST`, so
the explicit clause changes nothing and the assertion could not tell the
two apart.

The clause stays — it states intent a reader cannot infer from the
query, and flipping this to `DESC` one day WOULD silently change it —
but it is now labelled as intent rather than mechanism.

**What the suite actually guards is the plausible wrong fix:**

```sql
order by coalesce(app.course_of(l.item_id), 0) asc   -- "tidy the null away"
```

That fires the drinks before the starters on every table, every service.
Two assertions catch it:

```
the starters come first, not the drink | null (the drink sorted first)
the unsequenced dish sorts last        | an unsequenced dish did not sort last
```

**This is the fourth "can this guard fail?" check today and the first
where the answer arrived BEFORE the guard was trusted** — 195, 204 and
the padTotal skip were all found after the fact. The improvement is not
that fewer weak guards were written; it is that the question got asked
while it was still cheap.

**And the general lesson:** when a mutation does not break a test, the
test may be fine and the MUTATION may be a no-op. Check which.

---

### 208 · `sort_order` and a course are two questions, and the menu proves it

The obvious way to sequence courses is to reuse the category's
`sort_order` — it is already there, and Starters really does sort before
Main course. Akkalkot's own menu is the counter-example:

```
0  Starters      1  Main course      2  Beverages      3  Desserts
```

**Beverages sits between the mains and the desserts.** That is a sensible
order to read a card in and a nonsensical order to cook in. A pass built
on `sort_order` would fire every drink after the mains and before the
puddings, on every table, forever.

`sort_order` answers *where does this print on the card*. `course`
answers *when does it reach the table*. Two questions, two columns — and
the second one is nullable, because a drink is not a course at all.

Worth remembering the shape rather than the instance: **a column that
happens to sort correctly today is not the same as a column that means
what you need.**

---

### 209 · A parameter property took the production API down

The deploy pulled cleanly, migrated, passed nginx — and then:

```
file:///opt/fidato/api/src/routes/till.ts:2751
class LineRefused extends Error {
  constructor(public readonly reason: string, public readonly at: number) {
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]
TypeScript parameter property is not supported in strip-only mode
```

systemd restart-looped. **The live API was down.**

The server runs `node --experimental-strip-types`, which ERASES types and
emits nothing. A parameter property needs an emitted `this.reason =
reason`, so it is the one piece of TypeScript that cannot survive there.
So can an `enum` and a `namespace`.

⚠ **EVERY LOCAL GATE PASSED, AND STRUCTURALLY HAD TO.** `tsc --noEmit`
accepts it — it is valid TypeScript. Vitest and tsx transpile properly
and accept it. **Nothing in this repository ran the API the way the
server runs it.** Three clean builds and 272 passing tests said nothing.

Ninth deploy-only fault of this shape: *the machine the code was written
on is not the machine it runs on.*

**Fixed** by writing the fields longhand, and by two gates:

```
npm run strip-check      api/scripts/strip-check.mjs — parses every file
                         with the loader's own transform
deploy/launch.sh         runs it BEFORE the restart, and refuses
```

The second matters more than the first. A laptop gate is one somebody
forgets; the deploy gate is on the one machine whose answer counts, and
it now stops *before* touching the running service rather than after.

---

### 210 · The gate for 209 passed the bug it was written for

First version of `strip-check` shelled out to:

```sh
node --experimental-strip-types --check <file>
```

That **passed the parameter property**. `--check` parses; it does not run
the type-stripping transform, which happens later in the ESM loader. The
gate proved nothing at all.

Caught by putting the bug back before trusting it — the fifth such check
today, and the second where the guard turned out to be incapable of
failing (see 204, 207).

The working version calls **`stripTypeScriptTypes` from `node:module`**,
which is the same function the loader calls at import time, so it fails
exactly where the server fails without executing anything.

**The rule, now earned three times in one day:** a new guard is not a
guard until the bug has been put back and watched to fail. `--check` and
"load this module" sound like the same question and are not.

---

### 211 · Every upgrade destroyed TLS, and the script then refused to restore it

`launch.sh` promises *"run it again any time to upgrade"*. Running it again
took the production API offline.

```sh
sed ... > /etc/nginx/conf.d/fidato.conf        # overwrites the whole file
...
elif [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot --nginx ...                          # only when the cert is ABSENT
```

**Certbot's 443 server block lives in the file the script overwrites.** So a
re-run erased TLS, and the condition then skipped certbot *precisely because
the certificate existed*. nginx came back listening on port 80 only.

Every step reported success. The service was active, the API was listening on
8787, the preflight ran. From outside:

```
curl: (7) Failed to connect to api.fidatohotels.com port 443
```

An https app calling an API that had silently stopped speaking https — and
nothing in several hundred lines of deploy output mentioned it.

⚠ **"Leaves the certificate alone" was TRUE and not enough.** The certificate
files were untouched. The configuration that uses them was destroyed. Those
are different objects and the README conflated them.

Fixed with a third branch: certificate present → `certbot install --cert-name
... --nginx`, which re-applies it to the rewritten config without contacting
Let's Encrypt, so it cannot fail on DNS or burn the rate limit.

**The shape to remember: a script that rewrites a config file owned jointly
with another tool must put that tool's contribution back.**

---

### 212 · The preflight ran as the one user that could never pass

```
✗ database reachable
    Peer authentication failed for user "fidato"
```

`ADMIN_DATABASE_URL` reaches Postgres over the unix socket, which is PEER
authenticated: the OS user must have the same name as the database role.
`launch.sh` runs under sudo, so the OS user is **root**, and root can never be
`fidato`.

Defect 192 named this exact mechanism and fixed the missing role. It did not
fix **who runs the check**, so the check has failed on every run since, and
reported a completely healthy box as `NOT READY TO SERVE`.

Proved by running it as the right user — 12 of 12 passed with nothing else
changed:

```
cd /opt/fidato/api && sudo -u fidato env HOME=/tmp npm run --silent preflight
```

`HOME` is needed because the account deliberately has no home directory.

**A check that cannot pass is worse than no check.** It trains whoever deploys
to read a red line and shrug, which is exactly the habit that makes the next
real failure invisible.

---

### 213 · I shipped the audit's own finding, in the audit's own hour

An hour after publishing an independent audit whose headline finding was
**"built, and unreachable"** — four capabilities with a database, an API
and no path a person could take — the same defect turned up in the
feature I had shipped that evening.

Migration 081 gave dishes and categories a `course`. The kitchen feed
read it. The by-table pass grouped by it, ordered by it, and sorted
unsequenced dishes last. **Nothing anywhere could set one.**

No endpoint. No seam function. No control. Every dish would have read
*"Any time"* forever unless somebody ran SQL — which is exactly what I
did to take the screenshot that "proved" the feature worked.

⚠ **THE BROWSER CHECK IS WHAT HID IT.** I set the courses with `update
pos_menu_categories set course = ...`, reloaded, saw them group
correctly, and called Stage C complete. The screenshot was true and the
feature was unusable. **Opening the screen is not enough if you reached
the state by a route the user does not have.**

Found by starting the local stack for an unrelated reason and noticing
`course` missing from the menu payload.

Fixed: two endpoints mirroring the preparation-time pair, two seam
functions, a `CourseControl` beside `PrepControl`, and a regression test
named for what it exists to catch — *"can actually be SET, which it
could not be for an hour"*.

**The rule this earns, and it is sharper than "open the screen":**
*set it up the way a user would, or the demonstration proves nothing.*
Six occurrences of this shape are now recorded — 81, the credit note,
approvals, attachments, `setOutletClosed`, and this one. It is the
defect this project produces when a feature is built from the database
upward and nobody walks back down.

---

### 214 · A switch that said "not built yet" about something that was built

Reported by the owner: *"the banquet thing is not working — when I try
to turn it on it's not working."* Correct, and the cause was one line:

```tsx
disabled={busy === module || module === "banquet"}
```

beside a note reading *"Not built yet. Off everywhere, and listed so it
is clear that the switch is missing rather than the hall."*

**Both were true when written.** Stage 14 then built banquet — three
screens, four tables, an API, and a board line reading *12 of 12, the
hall cannot be sold twice* — and **nobody came back for the switch.**
The copy and the code disagreed for eight days.

The API was fine the whole time. Tested directly:
`{"ok":true,"module":"banquet","enabled":true}`.

⚠ **A DISABLED CONTROL WITH STALE COPY IS WORSE THAN A MISSING ONE.**
A missing control makes somebody ask. This one answered the question,
wrongly, and the owner believed it for over a week.

**The guard is not "banquet works"**, which would rot the same way. It
is *every module the API accepts has a switch somebody can press* — add
a third module and the test fails until its switch is real.

⚠ **AND THE GUARD WAS VACUOUS AT FIRST.** `src/test/setup.ts` had no
`/modules` branch, `getModules` catches its own failure and returns
`{}`, so the screen rendered **zero switches** and "none is disabled"
was trivially true of none. Caught by asserting the COUNT before the
condition — the habit that came out of defects 195, 204, 207 and 210.
Proved by putting the original line back: two assertions fail.

---

### 215 · Adding a user shipped nowhere, and the fix nearly shipped a trap

`/admin/console` carries the only form that creates a person. It is
wrapped in `{IS_DEV && …}` and tree-shaken out of a real build, so **for
eight days a live deployment could not add a user at all.** Every tester
account needed SQL on the server. Found by the owner trying to set up a
beta.

The 31 August gate was right about its target — *"this screen
manufactures tenants"* — and too wide: creating a PERSON sat on the same
screen and went with it.

Fixed by moving the panels into `components/flows/StaffAdmin.tsx`, which
both screens import. Property creation stays on the console, because
that is the act the gate was protecting.

⚠ **AND THE FIX ALMOST SHIPPED A WORSE PROBLEM.** A row in `staff` is
not an account. Until a Firebase user exists and `firebase_uid` names
it, a correct password produces a correct token that resolves to nobody
— every screen renders empty with no error. Worse, the preflight refuses
on

```sql
select ... from staff where firebase_uid is null and is_active
```

so an owner adding three testers through the new screen and stopping
there would have **failed their next deploy**, with no connection in
anybody's mind between the two acts.

Caught by asking "what does the preflight think of what I just built"
before committing. The screen now says the remaining step twice: in the
toast, and as standing text under the button, because a toast is gone in
four seconds and this is exactly the step people miss.

**The shape: a screen that half-creates a thing is worse than no screen,
if the other half is invisible.**

---

### 216 · A screen that explained why it could not do the thing

`/admin/properties` carried a card headed **"Adding a property"** whose
text read:

> *The form that drives it belongs with the auth bridge, because
> creating a property is an act that has to be attributable to a
> person.*

The screen it referred to is `/admin/console` — `{IS_DEV && …}`, tree-shaken
out of a real build. So `deploy/README.md` step 8 told the owner to add
their six remaining properties through Admin → Properties, and Admin →
Properties offered **a paragraph explaining that the form was
somewhere else.**

Same root as 215 and found in the same sweep: the 31 August gate was
about the ACT, and it was applied to the SCREEN.

Fixed by moving `NewProperty` into
`components/flows/StaffAdmin.tsx` beside the person panels, and
rendering it. **The provisioning key stays**, and that is the whole
difference from the person form — verified by asking the server:

```
wrong key   403  "A provisioning key is required for this operation..."
no key      403  "...Creating a property manufactures a whole tenant —
                  rooms, an invoice series, a folio namespace — so a
                  signed-in session is not enough on its own."
```

Both refuse with a sentence somebody can act on, from the database,
regardless of what any screen shows. That is Rule 6 working, and it is
why shipping the form is safe.

**The shape worth remembering: prose describing a capability is not the
capability, and a screen that documents its own absence reads as an
answer.** Two of these were found in one day — this and the banquet
switch that said "not built yet" about something that was built.

---

### 217 · I audited `/admin/*` and concluded a capability was missing. It was on `/people`.

I reported to the owner that **nobody could add a user to the live
system**, called it a P0, and built a screen for it. All three were
wrong.

`src/pages/People.tsx` has done the whole job since **7 September** —
add somebody, give a property, revoke, deactivate — routed at
`/people`, in the sidebar under **People**, and badging **"Cannot sign
in"** on an account with no Firebase link, which is the very step I
thought I was contributing.

The route even carries the reason, written by whoever fixed it:

> *NOT development-gated. The endpoints behind it have existed since the
> admin work and were reachable only from a dev-only console, so the
> owner — the one person who actually has staff to add — could not reach
> them.*

**The problem I "found" had been found and fixed the day before.**

⚠ **HOW THE AUDIT MISSED IT.** I enumerated routes with
`grep 'path="/admin'`, counted the write actions on each, and concluded
admin was read-only. That was true of `/admin/*` and irrelevant: the
capability lives at a TOP-LEVEL route. **I searched by URL prefix and
reported a conclusion about capability.**

The correct question was the one I asked later and should have asked
first: *does `createStaff` have a caller anywhere in `src/`?* It had
two.

Step 2 is reverted. `/admin/users` is a list again, because two screens
doing one job is worse than one — and `/people` is the better of the
two.

**Step 3 stands**: `createProperty` genuinely had no caller outside the
dev console, checked the correct way this time.

**The rule: audit by capability, never by location.** A search shaped
like "what is under this prefix" answers a question about the prefix,
and I presented it as an answer about the system. This is the second
time in two days that a confident finding of mine was an artefact of
how I searched — 196 was the first.

---

### 218 · Housekeeping never refreshes itself — DEFERRED by the owner

Reported as *"the housekeeping thing in the backend is very slow"*, on
the **deployed** system.

**Measured locally and it is not a load problem.** A cold load of
`/h/:code/housekeeping` fires **five requests, no duplicates**, all
under 15ms:

```
housekeepers · housekeeping/assignments · rooms · stays · hotels
```

⚠ **What it has is NO REFRESH OF ANY KIND.**

```
refetchInterval   none
live channel      none
```

A housekeeper marks 204 clean on a stairwell landing and **the
supervisor's board does not change until somebody reloads the page.**
On a Mumbai connection that reads as "slow" because the screen is
telling you about a morning that has already moved on.

**THE TRANSPORT, for the record, because it was asked:**

```
everything          HTTP. fetch, through React Query. request/response.
one exception       SERVER-SENT EVENTS, and only for the restaurant.
                    api/src/routes/live.ts + a Postgres LISTEN/NOTIFY
                    trigger (075). fetch-based, NOT EventSource --
                    EventSource cannot send an auth header.
websockets          none, anywhere.
```

The live channel reaches exactly three screens — Floor, Kitchen, Till —
and invalidates four query keys. **Housekeeping is not on it**, and
neither is anything at the front desk.

**Deferred on 8 September at the owner's instruction**: recorded, not
fixed. The fix is small and known — extend the notify trigger to
housekeeping changes and add `useLiveOrders`-style invalidation to that
screen — but it was not the priority this session.

---

### 219 · Five copies of one label, and the fifth said "Walk-in" about Agoda

"What do we call where this booking came from" existed in **five
places**, and they had already drifted apart:

```
api/src/routes/billing.ts:131     coalesce(co.name, case r.source … initcap)
api/src/routes/reports.ts:72      the same, re-typed
api/src/routes/reports.ts:123     the same, re-typed again
api/src/routes/directory.ts:33    the same, as a SQL string constant
api/src/routes/stays.ts:29        ⚠ a TypeScript object, and WRONG
```

The four SQL copies fell back to `initcap(source)`. The fifth did this:

```ts
const SOURCE_LABEL: Record<string, string> = {
  walk_in: "Walk-in", direct: "Fidato Hotels",
  ota: "Agoda", corporate: "Fidato Hotels",
};
…
source: row.company_name ?? SOURCE_LABEL[row.source] ?? "Walk-in",
```

Two separate wrongs in four lines. **Every OTA booking read "Agoda"**
whichever OTA it was. And anything the map did not recognise read
**"Walk-in"** — while `groups.ts` writes the chosen source's NAME into
that column and sets no `company_id`, so a booking taken through the
booking screen for a travel agent appeared on the arrivals list as a
walk-in. A clerk looking at the morning's arrivals could not tell an
agent's booking from someone who walked in off the street.

**Nobody found it because nobody compared the five.** There is no way
to compare five copies except to go and read all five, and the reason
to go and read all five only appears after somebody has been misled.

The rule is now `app.booking_source_label(source_name, company_name,
legacy)` in migration 082, called by all five call sites. Its fallback
when nothing is known is **NULL**, not a guess — the screen shows a
dash. Proved by making the coalesce order wrong and watching exactly
one assertion fail.

**The shape, again:** a rule written in N places is wrong in one of
them, and nobody finds out which.

---

### 220 · A data-modifying CTE read back by its own statement — 202, twice, in one afternoon

`POST /booking-sources` answered **500 on every create**:

```sql
with made as (
  insert into booking_sources (name, kind, channel_code)
  values ($2,$3,$4) returning id
)
select bs.* from booking_sources bs join made on made.id = bs.id
```

The outer SELECT runs against the snapshot the statement started with,
so the row the CTE had just inserted **was not there**. `rows[0]` came
back `undefined`, `shape(undefined)` threw, and the route returned
"Something went wrong."

Then the same fault again in `PATCH`, wearing a different hat: the
UPDATE was in the CTE and the SELECT returned the row **as it was**, so
a rename replied with the old name.

This is defect 202 with a different mechanism — 202 was a FUNCTION in
`RETURNING` re-querying its own table. Same underlying rule:

⚠ **Anything that reads a table in the same statement that writes it
sees the table as it was.** The fix both times is two statements in one
transaction — write, then ask.

**What is worth noticing is that I wrote 202's fix this same week and
still wrote 220 twice.** Knowing the rule did not stop it; the tests
did. Both were caught by an endpoint test that asserted on the returned
body rather than on the status code.

---

### 221 · I ran `npx vitest run` in `api/` again

Defect 196 was published as a false finding because I ran `npx vitest
run` instead of `npm test`, which is wired to
`api/scripts/with-test-db.sh`. I did it again today, on the first run of
`api/test/bookingSources.test.ts`.

```
✗  npx vitest run test/bookingSources.test.ts   -> the DEV database
✓  npm test -- test/bookingSources.test.ts      -> a scratch database
```

The wrong command reported `relation "booking_source_rates" does not
exist` — because the dev database had not had migration 082 applied.
That failure was **luck**: the test file happened to touch a table that
did not exist yet. A test file that only touched existing tables would
have run happily against the dev database and written to it, which is
how 196 deleted the order-pad orders.

**The rule, written where I will read it:** in `api/`, the test command
is `npm test`. `npx vitest run` is never right, not even to run one
file — `npm test -- <path>` passes the path through.

---

### 222 · The approvals engine has never had a caller, and still does not

Asked to wire "approvals for discounts above a threshold", I went looking
for where a discount would raise one and found that **nothing anywhere
raises one at all**:

```
db/migrations/076_approvals.sql   approvals, approval_rules,
                                  app.request_approval(), app.decide_approval()
api/src/routes/approvals.ts       the queue, the decide endpoint, the rules
──────────────────────────────────────────────────────────────────────────
callers of app.request_approval   NONE, anywhere in api/src or db/migrations
screens showing the queue         NONE
allowed kinds                     purchase, cash_expense, stock_adjustment
                                  — `discount` was never one of them
```

`approvals.ts` opens with a comment saying it exists *because* the engine
would otherwise be unreachable — "a database function with no route is
the same fault one level down". The routes were added and the callers
never were, so the fault simply moved up a level: an endpoint nobody
calls instead of a function nobody calls.

The db suite proves `app.request_approval` **works**. It cannot prove
anybody can reach it, and that is the difference the reachability gate in
`repositories.test.ts` was built to catch. That gate covers the FRONTEND
seam only. **There is no equivalent gate for `app.*` SQL functions or for
API routes**, and this is what that gap costs.

⚠ **It is still unreachable after this session.** The owner replaced the
approval design with promotions (below), so nothing here was wired up. It
is recorded as unreachable rather than quietly counted as delivered — the
sixth instance of this project's signature defect, and the only one so
far that is an entire subsystem rather than one function.

---

### 223 · Two tests broke on a cap they were never about

Adding the 10% free-hand discount cap turned two green tests red:

```
takes the discount off the NET, so tax falls with it
posts the DISCOUNTED amount to the folio, not the full one
```

Both took **a flat ₹100 off** a demo bill, and neither was about the size
of the discount. They passed for a year because ₹100 happened to be under
10% of whatever the demo order came to, and they failed the moment that
stopped being true.

**A constant chosen against fixture data is a constant that expires.**
The fix is to derive it — `Math.floor(before.net * 0.09)` — so the test
says what it means: *some* discount, small enough to be allowed, because
this test is about tax following the discount and has no opinion about
how big it is.

Worth noting because the failure LOOKED like the new code was broken.
Two red tests naming tax and folios is a convincing accusation, and the
first instinct was to check the cap arithmetic rather than to read what
the tests were actually asserting.

---

### 224 · Four admin endpoints, written and tested, with no way in

Walking `api/src/routes/admin.ts` against `src/data/repositories/admin.ts`
on 9 September: **eleven endpoints, seven callers.**

```
PATCH  /admin/hotels/:code          a property's own details      no caller
POST   /admin/hotels/:code/:state   close it, or reopen it        no caller
PATCH  /admin/staff/:id             a person's name or phone      no caller
POST   /admin/staff/:id/reactivate  bring somebody back           no caller
```

The last one carries this comment in the route file:

> *"Deactivating existed; reactivating did not, so a person switched off
> by mistake needed somebody with database access to undo it."*

**And the fix was itself unreachable.** Somebody switched off by mistake
still needed a database session, for exactly as long as that endpoint sat
there with no caller — which was every day since it was written.

⚠ **The reachability gate could not have caught this.** It watches the
FRONTEND seam: it fails when a function in `src/data/repositories` has no
importer. These four had no function on the seam at all, so there was
nothing for it to find. **The moment I added the four seam functions the
gate went red immediately** — which is the gate working, and also the
measure of its limit: it catches an endpoint that has been half-wired,
not one that was never wired.

**What is missing is the same gate one layer down**: an API route with no
caller in the seam. Recorded as a gap, not built — the route table is not
a static list the way `export function` is, so it needs real work rather
than a regex.

---

### 225 · There were two Properties screens and the one in the menu could do less

```
/properties         in the navigation. Rich cards. Could do NOTHING.
/admin/properties   the create form, and a four-line list.
```

Two screens for one noun, and the one people actually clicked was the one
that could do least. Worse: `/properties` drew **six hardcoded dashed
cards** reading *"Property 2 — awaiting confirmation"*.

That was honest when nothing could create a property. Since the create
form landed in phase 1 it has been a screen telling you six properties
are pending while standing next to the button that would add them.
`listProperties()` is the truth; a constant six is a story about the
truth that stopped being updated.

One screen now, and `/admin/properties` renders it.

**And a trap avoided by asking one question before building.** `GET
/api/hotels` ends `where is_active`. A Close button on a screen fed by it
would remove the property from the list AND from any way of reopening
it — shipping the exact defect above, freshly made. Hence `GET
/admin/hotels`, which returns closed properties too, asserted in
`adminWrites.test.ts` by closing PUN and checking both lists.

---

### 226 · A line-range replacement ate three screens I never looked at

Rewriting `PropertiesPage`, I replaced everything from
`export function PropertiesPage() {` to `function Line(` — the next thing
I could see. **`NotificationsPage`, `RoomTypesPage` and `RatePlansPage`
lived in between**, and all three vanished.

`tsc` caught it in seconds:

```
src/App.tsx(39,46): Module '"@/pages/Directory"' has no exported member
                    'NotificationsPage'.
```

Restored from `git show HEAD:` in one step, so the cost was a minute.
Worth recording anyway, because the cost was low **by luck of the
typechecker**, not by anything I did. The same edit inside a file whose
middle was not exported and imported elsewhere would have deleted working
code silently.

**The rule:** an anchor for the END of a replacement has to be checked as
carefully as the start. "The next function I recognise" is not an anchor —
it is a guess about what is in between.

---

### 227 · Deleting a menu entry opened an admin route — the guard fails open

Found by auditing the navigation against itself: **two entries read
"Properties"** after the two screens were merged. I removed one. A test
went red:

```
administration routes > refuses /admin/properties to a front-desk clerk
```

`RequireAccess` asks the NAVIGATION whether a role may reach a path,
which is deliberate and right — a hidden menu entry and a refused page
cannot then disagree. Its own comment says so. But `mayReach` ends:

```ts
export function mayReach(role: Role, path: string): boolean {
  for (const section of SECTIONS) { … if (entry.to === path) return visible(role, entry); }
  return true;                       // ⚠ a path it does not know
}
```

**The authorisation for `/admin/properties` was living in a menu label.**
The entry carried `canSee: (role) => can(role, "create", "hotel")`, and
deleting it to fix a duplicate label handed the route to every signed-in
role while leaving it wrapped in something called `RequireAccess`.

Measured across the app: **7 routes wrapped in `RequireAccess`, 6 known
to the navigation, 1 not** — the one I had just made. No pre-existing
hole. But the design fails open, so the next one would be silent too.

Two things done:

- `/admin/properties` is now a **redirect** to `/properties`. One screen,
  one route, one menu entry, and no guard left to lose.
- A test in `App.test.tsx` asserts the property itself: **every
  `RequireAccess` path is one the navigation knows.** Proved by pointing
  a guard at `/admin/nowhere` and watching it fail.

`mayReach` still returns true for an unknown path. Changing it to fail
closed would break any route whose menu entry is conditional, and that is
a change to make deliberately rather than in the middle of an audit.
Recorded in `PENDING.md`.

---

### 228 · Two menu entries called "Booking sources", and I made the second

The sidebar carried:

```
Reservations   > Booking sources   -> /companies
Configuration  > Booking sources   -> /h/:code/booking-sources
```

The first was renamed from "Companies" for a good reason at the time — its
comment says *"somebody looking for their OTA performance read 'Companies'
and went past it"* — because **no screen answered that question**. Item D
built one on 8 September and I did not look at the menu I was adding to.

The rename's reasoning expired the moment the real screen existed, and two
identical labels meaning two different things is worse than the problem it
solved. `/companies` is now **"Companies and agents"**, which is what the
rows are and the same words the booking form's Business source field uses.

**Both collisions were invisible to every gate in the project.** The
reachability gate asks whether code can be reached, not whether a person
can tell two doors apart. Found by sorting the labels and looking for
duplicates — three lines of shell, and worth keeping as a habit.

---

### 229 · Adding somebody wrote a row and stopped. There was no password anywhere.

The owner found it the ordinary way: added a demo user, walked to the
sign-in page, and there was nothing to type.

```
POST /admin/staff   ->  insert into staff (email, full_name, is_group_admin)
                        …and nothing else.
```

No Firebase account. `staff.firebase_uid` stayed NULL. The person then
appeared on the People screen with a role and a property, and the dialog
that created them said, in its own description:

> *"They can sign in as soon as this is saved."*

Which was false, and is the sentence the owner walked into.

Filling the gap meant creating the account by hand in the Firebase
console and then running `npm run link-staff` in a terminal on the Oracle
box. That is not a workflow a hotel can run, and it is why the
`link-staff` script's own comment opens "this is the join nobody thinks
about until the first real sign-in fails".

**The credentials were never the problem.** The service account in
`api/.env` was already the right one for `poms-fad05` — same key id the
owner sent. `firebase-admin` was already a dependency. Everything needed
to create an account had been sitting in the process the whole time; no
code ever called it.

**The password is REQUIRED on create, and that is the fix rather than a
policy.** An optional one recreates the identical hole for whoever leaves
the box empty, and they find out standing at a terminal in front of a
guest.

⚠ **The account is created BEFORE the row, deliberately.** Firebase is
not in the transaction and nothing can roll it back, so the order is
chosen so the survivable failure is the one that happens:

```
account, then row   a failed insert leaves an account with no staff row.
                    It signs in, resolves to nobody, and the next attempt
                    at the same address ADOPTS it. The state heals.

row, then account   a failed account leaves exactly this defect, freshly
                    made: somebody on the People screen who cannot get in.
```

---

### 230 · `app.is_manager()` was sitting right there and is not the gate

Making a general manager able to roster their own staff, the obvious
predicate is the one that already exists:

```sql
create or replace function app.is_manager() ...
    and sh.role in ('owner','gm')          -- ⚠ no hotel_id. Anywhere.
```

It answers **"are you a manager anywhere"**. Used as the gate on "give
this person access to that hotel", the manager of Akkalkot would pass
while standing in Pune, and every manager in the group could roster staff
at every other manager's hotel.

`app.manages_hotel(uuid)` is the same query with one more line in it, and
that line is the entire feature.

**Three doors, each with a test that fails if it opens:**

```
a manager rostering at a hotel they do not run
a gm appointing an `owner` — which grants every action there, so they
  could appoint themselves one
a gm resetting a GROUP ADMINISTRATOR's password — which is how a
  property manager becomes an owner of seven hotels
```

The third is the one that matters and the easiest to miss, because it
does not look like a permission change at all. It is a password field.

⚠ **And the predicate was not the permission.** The functions were
written first and the API tests failed with

```
new row violates row-level security policy for table "staff_hotels"
```

`staff_hotels` has carried INSERT/UPDATE/DELETE policies of
`app.is_group_admin()` since migration 020, so the GM passed every check
the API made and was refused by the only authority that counts. **That
failure is the argument for the whole design**: the route's guard is the
sentence a person reads, the policy is the rule, and when they disagree
the policy wins and nothing is corrupted.

---

### 231 · A refusal returned as HTTP 200, in three routes

Found while chasing 230. `POST /admin/staff`, `POST /admin/hotels` and
the new property-detail route all ended:

```ts
return c.json(result);        // no status
```

so a refusal raised inside the session — "No property with code PUN",
"You may give: …" — went back as **200 OK** carrying `ok: false`.

Nobody noticed because the browser's `write()` helper reads `ok` from the
body and coped. Anything trusting the status code — a retry policy, a
log, an integration, a person reading a network tab — saw a success.
Every other route in the same file answers 409.

**Caught by a test that asserted `403` and got `200`**, not by reading.
The lesson is narrow and worth keeping: `c.json(result)` with no second
argument is a bug whenever `result` can be a refusal.

---

### 232 · I deleted three unrelated things with a range replacement. Again.

Defect 226 was a line-range replacement whose end anchor was "the next
function I recognise", and it ate three screens. **Six hours later I did
it again**, this time removing `staffPasswordLink` from
`src/data/repositories/admin.ts` by slicing from its doc comment to
`PropertyTeamMember` — which swallowed `grantAccess`, `revokeAccess`,
`deactivateStaff`, the `patch` helper, `AdminProperty` and
`listAdminProperties`.

`tsc` caught it in eight errors. The fix was `git checkout --`, re-apply,
and remove **the exact function text** with an assertion afterwards that
the neighbours survived:

```python
assert block in s, "the exact function"
s = s.replace(block, '', 1)
assert 'export function grantAccess' in s, "grantAccess survived"
```

**Knowing the rule did not stop it.** I had written 226 down that
morning. What stops it is asserting what must REMAIN, not just what
should go — the same shape as every other guard in this project: state
the property, not the procedure.

---

### 233 · The end-of-beta reset could not have run on the server

`deploy/README.md` documents ending a beta as:

```bash
cd api && npm run reset -- 5EL --yes
```

`reset-property.ts` resolved its connection as
`SUPER_DATABASE_URL ?? DATABASE_URL ?? <the DEV localhost default>`.

On the Oracle box **`SUPER_DATABASE_URL` is not set**. `DATABASE_URL` is
`pms_app` — the role every RLS policy is written against, which owns no
tables. So the documented command would have:

- printed **"0 bookings · 0 guests · 0 postings · 0 orders"** about a
  full hotel, because RLS hides what it cannot see, and
- then failed on `alter table … disable trigger` with a permission
  error, halfway in.

`launch.sh` writes **`ADMIN_DATABASE_URL`** into `api/.env` for exactly
this purpose, and **`preflight.ts` and `link-staff.ts` both already
prefer it** — each after being caught by the identical trap. The
preflight reported a healthy box as broken (defect 192); link-staff
printed an empty roster against six real people. This is the third
occurrence of one mistake in one codebase.

Both `reset-property.ts` and the new `retire-staff.ts` now read
`ADMIN_DATABASE_URL` first, and the reset **proves it can see before it
deletes** — connecting is not the same as being able to act.

---

### 234 · The gate for defect 209 never looked at `api/scripts/`

`strip-check` exists because a parameter property in `till.ts` took the
production API down. It scanned `src/` only.

Everything in `scripts/` runs under the **same loader**:

```
"reset":        node --experimental-strip-types scripts/reset-property.ts
"preflight":    node --experimental-strip-types scripts/preflight.ts
"retire-staff": node --experimental-strip-types scripts/retire-staff.ts
```

and two of those three are run against a **live database at the end of a
beta** — the moment a syntax error costs most.

Found by accident: a bad edit left `reset-property.ts` unparseable, the
script died with `ERR_INVALID_TYPESCRIPT_SYNTAX`, and `npm run strip-check`
printed **`✓ 34 files`** in the same minute.

⚠ **A gate that reports success about a directory it never opened is
worse than no gate — it is a reason not to look.** It scans both roots
now, 42 files, and was re-proved by putting a parameter property into a
script and watching it fail.

**The general shape, which is the fourth time this project has met it:**
a guard's SCOPE is as much a part of it as its logic, and nothing about
a passing guard tells you what it declined to examine.

---

### 235 · Reading the right variable, from a file nothing loaded

Defect 233 changed `reset-property.ts` to prefer `ADMIN_DATABASE_URL` —
the variable `deploy/launch.sh` writes into `api/.env`, and the one
`preflight.ts` and `link-staff.ts` already use.

**Nothing in that script loads `api/.env`.** `src/env.ts` is what calls
`process.loadEnvFile`, and `link-staff.ts` gets it by importing `env`.
`reset-property.ts` imports `pg` and `node:url` and nothing else — so
on the server `ADMIN_DATABASE_URL` is simply not in the environment,
the connection falls through to the **development localhost default**,
and it fails to reach a Postgres that does not exist on that box.

⚠ **Half a fix looks exactly like a whole one until somebody runs it.**
233 was found by reading and fixed by reading; this half was found only
by tracing what would actually happen on the box.

Both scripts now carry `import "../src/env.ts";` for its side effect,
with a comment saying so — an import with no named binding is the kind
of line somebody deletes as dead.

---

### 236 · The guard I wrote to prevent a bad connection refused the best one

The check added in 233 asked one question:

```sql
select count(*) from pg_tables
 where schemaname = 'public' and tableowner = current_user
```

True for the schema owner — `fidato` on the server, which is the case
it was written for. **False for a superuser.** In the development
database `postgres` owns nothing at all; `pms_migrate` owns all 66
tables. So the guard refused `postgres`, which can do absolutely
anything, while the whole point was to stop the *under*-privileged
`pms_app`.

It asks both now: `usesuper OR owns tables`.

**Found by running it, one minute after writing it.** The pattern is
worth naming because it is the third time this week: a guard written
against the ONE case in mind, which then has an opinion about cases it
never considered. The banquet guard was vacuous; the strip-check gate
scanned one directory of two; this one confused *authority* with
*ownership*. In each, the logic was right about the case it knew.

---

### 237 · `ADMIN_DATABASE_URL` is not the schema owner, and I assumed it was

Defect 233 said the reset should use `ADMIN_DATABASE_URL` "the schema
owner, over the unix socket". Run on the real box:

```
Connected as "fidato" — not a superuser, and owning no table here.
```

**`fidato` owns nothing.** On production:

```
pms_migrate   owns 63 tables
postgres      owns 3          (booking_sources, booking_source_rates,
                               pos_promotions — the 082/083 tables)
fidato        owns 0, not a superuser
```

`fidato` is the SERVICE account: it reads, which is all the preflight
and the API need. The reset has to disable append-only triggers, which
needs ownership or superuser, and `retire-staff` failed with **permission
denied for table staff_hotels** for the same reason.

**Both failed safely** — the guard caught one, a grant caught the other,
and the transaction never committed. Nothing was changed. But the
diagnosis in 233 was confidently wrong about which role does what, and
the comment I wrote asserting it is now in the file.

⚠ **And 082/083 left three tables owned by `postgres` when every other
table is owned by `pms_migrate`.** Harmless today because migrations run
as a superuser; a latent trap the day anything tries to `alter` them as
`pms_migrate`. Recorded in PENDING.md.

---

### 238 · The env fix made the script unrunnable by the only account that could run it

235 added `import "../src/env.ts"` for its `loadEnvFile` side effect.
Correct about the side effect and wrong about everything else:

- `api/.env` is **mode 600, owned by `fidato`**
- the script has to run as **`postgres`**, the only superuser
- `env.ts` **validates** and throws when `DATABASE_URL` is absent — which
  it is, because `postgres` cannot read the file

So the fix for "the variable is never loaded" produced a config error
about a variable nobody asked for, in the exact context the script is
meant to run in.

It loads `../.env` directly in a try/catch now and shrugs when it is
unreadable — the connection string comes from the command line then.
**Not a second copy of a rule**: `env.ts` decides what the SERVER
requires; a maintenance script run by hand as a different user has
different requirements.

**Three consecutive fixes to one line, each correct about the thing it
was looking at.** 233 fixed the variable name, 235 fixed the loading,
238 fixed who can load it. Each was verified by reading, and each was
wrong in a way only running it on the real box would show.

---

### 239 · The teardown deleted a parent before its child, and dev could not tell me

`reset-property.ts` opens with:

> *"Order is the whole of this. Children before parents, every time — a
> teardown is a migration run backwards and has the same rules."*

And its list had:

```
["pos_tickets",  "hotel_id = $1"],     ← the PARENT
["pos_orders",   "hotel_id = $1"],     ← the child; pos_orders.ticket_id
                                         references pos_tickets
```

Production, first run, a third of the way in:

```
reset failed: update or delete on table "pos_tickets" violates foreign
key constraint "pos_orders_ticket_id_fkey" on table "pos_orders"
```

⚠ **It survived every local run because the development database has no
tickets.** The delete matched zero rows, so the constraint was never
tested. A teardown is only exercised by data that exists — and the data
that exists locally is whatever the demo loader happens to make.

The transaction rolled back and nothing was lost, which is the one thing
that went right.

**The fix is not the swap.** A list of twenty table names cannot be
checked by reading it, and I read it twice. `api/test/resetOrder.test.ts`
now asks the DATABASE for its foreign-key graph and asserts the list
agrees with it — every table named exists, and no parent is deleted
before a child. Proved by putting the order back the way production
found it and watching it fail.

It asks the schema rather than carrying a map of it, because a
hard-coded "what references what" is a second schema to keep in step,
and the day a column is added it would still be checking last year's
shape — passing, and wrong.

**Fourth run at one procedure**: 233 the variable, 235 the loading, 238
who can load it, 239 the order. Every one found by running it on the
real box, none by reading.

---

### 240 · The API's certificate would have expired on 7 December, and nothing would have renewed it

Found while preparing n8n, not while looking for it:

```
certbot-renew.timer   Loaded: loaded; disabled; preset: disabled
                      Active: inactive (dead)
cron                  no certbot entry
api.fidatohotels.com  notAfter=Dec  7 03:45:33 2026 GMT
```

**Oracle Linux installs `certbot-renew.timer` disabled.** `launch.sh` issues
the certificate with `certbot --nginx`, and on re-runs re-applies it with
`certbot install` (the fix for defect 211) — and no branch ever enabled
renewal. A Let's Encrypt certificate lasts 90 days.

On 7 December every screen of the PMS would have stopped reaching the API,
with a browser certificate error that says nothing about a timer. The
preflight checks eleven things about the deployment and none of them is "will
this still work in three months".

**Issuing is half of TLS, and this project only ever did that half.** Defect
211 was about the certificate surviving a re-run. Nobody asked whether it
survived a season.

`launch.sh` now enables the timer after the TLS block, and `deploy/n8n.sh`
enables it before issuing its own. **The live box still has it disabled until
one of them runs** — recorded in the deploy steps given on 10 September.

---

### 241 · I nearly "fixed" line endings that were already correct

After committing `deploy/n8n.sh` I measured carriage returns in the committed
file with `git show HEAD:deploy/n8n.sh | grep -c $'\r'` and got **346**, and
614 for `launch.sh` — which would mean both scripts die on Linux with
`$'\r': command not found`. The previous commit read 595, even though
`launch.sh` had run cleanly on the server that same morning.

That contradiction was the tell. Measured properly:

```
git cat-file -p HEAD:deploy/n8n.sh    | tr -cd '\r' | wc -c    ->  0
git cat-file -p HEAD:deploy/launch.sh | tr -cd '\r' | wc -c    ->  0
on the server: tr -cd '\r' < /opt/fidato/deploy/launch.sh     ->  0
```

`.gitattributes` has `*.sh text eol=lf`, and it works. **`grep -c $'\r'` on
Git Bash for Windows counts every line**, not lines containing a carriage
return.

⚠ **The rule: when a measurement contradicts something already observed to
work, distrust the measurement first.** `launch.sh` running on Linux that
morning was stronger evidence than a count I had just produced. Use
`tr -cd '\r' | wc -c` — it counts characters, and it cannot be fooled by how
a tool on Windows chooses to read lines.

---

### 242 · "Required" went on one of the two doors a booking comes through

Phase 2 made the channel compulsory. `groups.ts` refuses a booking with no
`bookingSourceId` — *"Where did this booking come from?"* — and 082 wrote on
`reservations.booking_source_id`:

> *"Required on anything taken from today — enforced by the API"*

**The API has two statements that create a reservation**, and the rule went
into one:

```
api/src/routes/groups.ts      POST /:code/bookings    requires the channel
api/src/routes/operations.ts  POST /:code/walk-ins    source = 'walk_in',
                                                      booking_source_id never set
```

Found on production during the 14 September audit, 4 bookings since the reset:

```
FH-2609-5001 | walk_in | has channel: f | screen shows "Walk-in"
the other 3  | Walk-in | has channel: t | screen shows "Walk-in"
```

⚠ **Nothing looked wrong, and that is why it lasted.** `app.booking_source_label`
falls back to the legacy `source` column, so the stay list still reads
"Walk-in". Everything that counts BY CHANNEL — the Booking sources screen, the
commission stamped at booking — does not see that stay at all.

**The rule, again: "required on every X" starts with finding every statement
that makes an X** — `insert into reservations`, two hits — and the rule goes on
each, or into one place both pass through. 082 said the API enforced it
without saying where, and "the API" was two doors.

Status on 14 September: found and recorded, then **fixed the same day on the
owner's yes** — "yes fix the walk-in bug and the booking":

- `085_walk_in_channel.sql` — `app.walk_in_source()`, the ONE answer to "which
  row is the walk-in channel" (by kind, oldest active, NULL if none), and a
  re-runnable back-fill of every `source = 'walk_in'` stay with no channel.
  Commission left NULL: the rate on the day was never stamped, and today's
  would restate history.
- `operations.ts` stamps it, with this property's commission, and refuses —
  like the booking form — when no walk-in channel is switched on.
- `api/test/reservationInserts.test.ts` finds every `insert into reservations`
  under `api/src` and fails if one does not write `booking_source_id`. A third
  door fails there, not on production.

---

### 243 · A refusal written below an insert keeps the insert

`withSession` commits whatever its callback returns — **a refusal included**.
`{ ok: false, reason }` is an ordinary return value, not a throw, so nothing
rolls back.

The walk-in route refused an unpriced room *after* `insert into guests`:

```
insert into guests (full_name) ...          ← committed
select ... reference ...
if (offered === null) return refuse(...)    ← "refused", guest kept
```

And 015's `guests_no_delete` means that guest can never be removed. Every
walk-in refused for a missing rate left a permanent phantom guest.

Found while moving 242's channel check in beside it. Every refusal in that
route now sits above the first write, and a test sends a tariff that is not
a number and asserts no guest by that name exists afterwards.

⚠ **The rule: inside `withSession`, a refusal is a COMMIT.** Either every
refusal comes before the first write, or it throws. **Not yet audited in the
other routes** — this is one route, found by accident.

---

### 244 · The local database lived in `%TEMP%`, and Windows was deleting it

`db/tests/run.sh` failed on 14 September with `could not open file
"base/1/4171"`. Measured, not guessed:

```
Storage Sense           on; "delete temporary files my apps aren't using" on
template0  (base/4)     0 files
template1  (base/1)     partial — 4171 missing
postgres   (base/5)     44 files
five old scratch DBs    0 files each
global/2964             missing   (pg_db_role_setting — pg_dump dies on it)
pgsql/bin               7 programs left; pg_dumpall.exe, createdb.exe gone
share/postgres.bki      gone      (so initdb cannot run either)
fidato     (in use)     494 files, modified today — survived
```

Oldest-untouched first: the files nobody modifies went first, which is why
the database used every day was the last thing standing and nothing looked
wrong.

⚠ **Defect 119 was probably this, misdiagnosed.** It blamed a missing
`global/2964` — the same file — on a destructive measurement, and rebuilt the
cluster with `initdb`. The `data.corrupt.184129` folder beside it is likely a
third occurrence.

Every script's default `PGBIN` now points at `D:/fidato-pg/pgsql/bin`, and
START-HERE.md and PROGRESS.md say why. The old folder is left untouched.

**The rule: nothing that has to survive lives under `%TEMP%` — a Claude
scratchpad included.** Scratchpads are for scratch.

---

### 245 · n8n.sh: an upgrade that forgot the address, and a bad site left for nginx to find

Both found reading the script to add the owner's "screen locked, webhooks
open" mode on 14 September. Neither by running it — the domain path has still
never run on the box.

1. **The documented upgrade could not finish.** `sudo N8N_VERSION=...
   deploy/n8n.sh` carries no `ALLOW_FROM`, and the nginx step read the address
   from `ALLOW_FROM` every time — so an upgrade restarted n8n on the new
   version, then died asking for an address. The address is now saved in
   `/etc/n8n/allow-from`, and `allow` is the one mode that insists on a new one.
2. **A rejected site stayed in `conf.d`.** On `nginx -t` failure the script
   stopped without reloading, as intended, and left the bad file in place. The
   API certificate's renewal hook reloads nginx, so that reload would have
   failed next; a reboot would have brought nginx up with neither site. The
   API shares this nginx. The last good file now comes back.

The new site was proved on the box before it was committed: rendered from the
script's own lines, loaded into a throwaway nginx on loopback ports, and
probed — webhooks reach n8n, the screen and `/rest/` refuse with the "your
address changed" page, `/webhookX/` does not slip through, `lock` closes all
of it, `open` opens all of it. The live nginx was not touched.

---

### 246 · "Rack rate ₹0" for a room type nobody had priced

`stays.ts` built every stay with `rackTariff: Number(row.base_rate)`. 032 made
`base_rate` nullable — the system ships no price — and `Number(null)` is `0`,
so every stay panel and the check-in dialog printed **"Rack rate ₹0"** for an
unpriced room type. The standing rule, broken on the screen a clerk quotes
from: *an unpriced thing shows a dash, never a zero.*

The column's CHECK allows 0 as well, so once the API had flattened NULL into 0
the screen could not tell "free" from "not set". Fixed at the source:
`rackTariff: number | null` end to end, and a dash wherever it is shown.

Same shape as the walk-in's `Number(null)` in the nightly charge (the comment
in `operations.ts` about halving ADR) — **`Number()` on a nullable column is a
default price in disguise.** Grep for it before trusting a money field.

---

### 247 · Every departed guest's panel said "Tentative"

The tape chart's `barTone` returned `"tentative"` for a **checked-out** stay,
and the stay panel printed the tone's label. At a front desk "tentative" means
a booking nobody has confirmed — the opposite end of a stay. It had been like
that as long as the panel had read the bar's tone; found on 14 September only
because the rebuilt panel was opened on a departed group booking.

Renamed to `departed` in the type, so the code cannot say one thing while the
screen says another, and labelled "Checked out".

---

### 248 · The stay panel existed twice, and the drawer had no padding

The owner's screenshot of 14 September: *"looks terrible and is not very
readable."* Measured, not guessed — two causes:

1. **`DrawerContent`'s body had no padding at all.** The pill, every row and
   the Check in button sat flush against the left edge. The design-system
   demo drawer had the same fault; only notifications (rows edge to edge on
   purpose) was right. Padding is now the default, `padded={false}` the
   exception.
2. **Two panels.** `StayDetail` on the chart and `StaySummary` on the lists —
   the list's comment called it "the same panel the tape chart opens" while
   drawing a second one with fewer rows. Defect 143's shape, third time. Now
   `StayDrawer`, one component, rebuilt to the owner's reference layout:
   contact in the header, the act at the top, labels above values, what is
   owed pinned, the group's rooms in a column beside the booking.

The two App tests that guard this panel (the guest named once; the group pill
reaching "Group reservation list") were read BEFORE the redesign and shaped
it: the group list is inline and the pill scrolls to it, so the heading exists
once rather than twice.

---

### 249 · A fix made in one of ten places: departed group rooms read "Room —"

`stays.ts` has carried this comment for weeks:

> *"Filtering to released_at is null was wrong: a check-out releases the
> room, so 60 of the 83 stays came back with no room number at all"*

It was fixed THERE — prefer the held assignment, then the most recent — and
the rule was then retyped into six more queries. Three others kept the old
one, including `app.group_rooms()` (071). Measured on 14 September, the demo's
Pancham Hall function: three departed rooms, all `(none)`, while their own
references end in -302, -303, -305. The rebuilt stay panel put the group list
on screen, which is the only reason anybody saw it.

086 makes the rule `app.stay_room()` and moves the three wrong copies onto it:
the group list, the group's master bill lines, and the billing screen's
refunds-due list — a refund is owed to somebody who has LEFT, so that one
printed "—" for exactly the people it listed.

⚠ **Two questions look alike and are not.** "Which room was this stay in" is
display, and wants held-else-latest. "Who is in this room right now" —
check-out, room status, pre-arrival assignment — wants the held assignment
alone, and those three correctly keep `released_at is null`. Converting them
too would have been a second bug made in the name of consistency.

**The rule: when a fix lands in one query, grep for its siblings before
calling it fixed.** The comment in `stays.ts` described the bug perfectly and
nobody searched for the same `where` clause elsewhere — me included, twice.

---

### 250 · Any clerk could switch a hotel's modules on or off

`POST /:code/modules/:module` had no role check, and `hotel_modules`' policy
is hotel isolation — so any member of staff rostered at a property could
close its till, or open the banquet module. Found on 14 September adding
`reception_pos`, where it would have been worse: a receptionist could have
turned their own POS access back on and made the owner's new switch
decorative. Now `app.manages_hotel` (084) — the GM there or a group
administrator — and a refusal answers 403, not 200 (defect 231).

---

### 251 · A refused receptionist was told "There is no menu yet"

The till's reads (`getMenu`, `listOrders`, `getFloor`…) end in
`catch { return [] }`, so EVERY failure is an empty list — including the
server's 403 with a sentence in it. With the reception switch off, the till
opened and said the hotel had no menu. A wrong reason is worse than none;
Rule 6 is a blocked thing shown blocked, WITH WHY.

The POS-module switch had always had the same hole; nobody typed the URL.
`PosGate` now asks `GET /:code/till/access` — which answers only past both
gates — before any POS screen draws, and shows the server's sentence. Only an
explicit 403 shuts it: offline, the till's outbox still works as before.

⚠ **The deeper fault is still there**: those reads flatten errors into empty
data. The gate covers the refusal case; a 500 still reads as "empty".

---

### 252 · The menu's "Calendar" link opened Rooms

Reservations → All reservations → **Calendar** pointed at `/h/:code/stay` —
the Stay View, whose default became Rooms on 8 September. So the menu's
Calendar did not show a calendar, for six days, and the owner's request to
"make the calendar and room separate options" was partly a report of it.
Rooms and Calendar are two addresses now (`/stay`, `/calendar`), each in the
menu once.

---

### 253 · The Manager Report's period started on 1 August, whatever the month

`getManagerReport(hotelId, asOn, ptdFrom = "2026-08-01")` — a literal. Right on
every day of August 2026 and wrong on every other: the PTD column would have
run from 1 August for a September report. Now the first of the report's own
month, the window the API uses when none is sent. Found building the
Dashboard, which reads the same figures.

---

### 254 · My landing redirect lived in a ref I set while rendering

The first screen after sign-in (087) was decided in `RequireSession` with
`landed.current = true` inside render. React's development double render ran
it twice: the first pass returned `<Navigate>` and marked itself landed; the
second saw "landed" and returned the Dashboard — and React keeps the second.
Signing in as somebody set to start on Rooms opened the Dashboard, and every
typecheck and test passed. Found only by signing in as them.

**The rule: render decides, effects record.** A ref mutated in render is a
side effect, and development mode exists to expose exactly that.

---

### 255 · A commit message piped into `git commit -F -` from PowerShell 5.1

`git commit -F - @'…'@` in Windows PowerShell does not pipe the here-string
to stdin — it passes it as another argument, and git read the whole message
as a file path: `error: pathspec 'Staff-first, phase 1…' did not match`.
Nothing was committed and the files stayed staged, so it cost one retry, not
a wrong commit. `git commit -m @'…'@` works; so does writing the message to a
file in the scratchpad and `git commit -F <that file>`, which is what landed
2eff775.

---

### 256 · Every report printed one hotel's name, and the wrong person's

`ReportShell` defaulted `property` to the literal `"5 Elements By Fidato
Hotels"` and its footer printed the literal `"front desk"`. **No caller has
ever passed the property** — thirty report screens, all taking the default.
So a report for any second property would print 5 Elements' name over figures
that were not 5 Elements', above a stamp naming somebody who did not run it.

Both facts were already in the session: the property from the one in view,
the person from `scope.fullName`. `useDocumentIdentity()` reads them, and a
missing one prints a dash rather than a plausible wrong name.

**The rule: a document states facts, and a literal in the code is not one.**
The same two literals still sit in `FolioPanel.tsx` and `CheckInFlow.tsx`
(`const USER = "front desk"`) — named here, not yet fixed.

**And the hotel's name now comes from the database**, so it reads
"5 Elements Akkalkot" until the property is renamed on the Properties screen.
That is the point: one place holds it.

---

### 257 · The one action on the sign-in screen was a secondary button

`Button` defaults to `variant="secondary"` — white with a grey border — and
the sign-in form never asked for anything else. The single action on the one
screen every person in the group starts at was drawn as the quiet one, for as
long as the screen has existed. Nothing catches this: it typechecks, it
tests, and it looks deliberate until you see it beside a real primary.

**The rule: the primary action is declared, never inherited.**

---

### 258 · The Rooms screen named every room state twice — and my plan to fix it was wrong twice

The filter pills said Vacant / Occupied / Dirty / Blocked; the legend under
them said Free / In house / Needs cleaning / Out of service; housekeeping had
a third set (Vacant dirty / Occupied / Out of order). Found in the 15 September
critique.

The plan I published mapped **Vacant → Free** and **Reserved → Arriving**.
Both were wrong, and only reading the code that computes each number showed it:

- **Vacant counts `!occupied`** — free rooms, rooms still to clean, and rooms
  somebody is arriving into. A tile says Free only when none of that is true
  (`HouseFloor.stateOf`). "Free 10" above eight Free tiles would have been a
  new contradiction. It is **Empty** now: Empty = Free + Needs cleaning +
  Arriving, which adds up on screen.
- **Reserved is `state.reserved`** — a room held for a LATER booking. Not
  arriving. It keeps its name.

**The rule: rename a number by what it counts, never by what the word
sounds like.** Two words that sound alike on a screen are read as the same
thing, so they had better be the same thing — or visibly different ones.

The keys (`Vacant`, `Occupied`, …) stay; the Dashboard, the counts and the
tests read them. Only what a person reads changed, through `PILL_LABEL`.

---

### 259 · My new guard went red for a reason that had nothing to do with its rule

The dialog-confirm guard (`primaryAction.test.ts`) failed on its first run,
and "red" is exactly what a guard that has found offenders looks like. The
reason was `ENOENT … scandir 'D:\fidato pms\src\src'` — the root path was one
directory short. Read as a finding, it would have sent me hunting for
unmarked buttons that were not there, or worse, "fixing" whatever the next
glance suggested.

Once the path was right it DID find four real ones the survey regex had
missed, and a tighter label parser found two more. So the rule cuts both ways:

**Read why a test is red before you read what it says.** A failing guard
proves something only when its failure message is the rule's own message.

---

### 260 · The restaurant's own roles could not see the restaurant

`pos` (the waiter), `chef` and `kitchen_manager` hold no `payment` grant, and
every restaurant entry — Floor, Till, Terminal, Kitchen, Close restaurant day —
was gated on `payment`. So the menu of the three roles the restaurant exists
for listed none of it; they could reach it only by typing the address. The
server has always let them in (`till.ts` refuses only reception). The Kitchen
entry's own comment said it sat "behind the same permission as the till — the
people who cook and the people who ring up are the same restaurant". The people
who cook never had it.

Housekeeping had the same shape: Work orders sat "beside housekeeping, because
that is who finds most of it", gated on `room_config`, which housekeeping does
not hold.

Found by printing every role's menu (15 September), not by reading the matrix.
Fixed with `canSee`, on the owner's yes — no permission changed.

**The rule: a comment that says who a screen is for is a claim — test it
against that role's actual menu.**

---

### 261 · "Search or jump to…" opened nothing, from the first checkpoint on

The top-bar button set `commandOpen` and no component read it. A
`CommandPalette` was planned in CP0 ("⌘K is central") and never built; the
button kept its label and its ⌘K badge for three weeks. Harmless while the menu
listed everything — load-bearing the moment the owner made shorter menus
conditional on search. Built 15 September as "Find a screen" (screens only, and
labelled so).

**The rule: a control that sets state nobody reads is a dead control — grep for
the reader, not the setter.**

---

### 262 · I reported a development-build count as the live system

The critique said Reception is shown 48 entries "including the developers'
Design system page". Design system is `devOnly`: the LIVE build hides it. I
counted in `npm run dev`, where `IS_DEV` is true and developer entries show.
The live figure was 47. Corrected in the plan page, `HANDOVER.md` and here.

**The rule: say which build a number came from. A dev build shows what the live
one hides.**

---

### 263 · Any hotel manager could take over the owner's login — SECURITY, live 9–15 September

`POST /admin/staff` ("add somebody") checked two things — the caller manages
the hotel named, and the role is one they may give — then called
`ensureAccount(email, name, password)`. For an address Firebase already
knows, `ensureAccount` ADOPTS the account and SETS ITS PASSWORD
(`identity.ts:94`). Then it wrote the staff row.

So a general manager could "add" the owner: the owner's email, front desk at
their own hotel, a password of their choosing. Every check passed, Firebase
replaced the owner's password, and the database's refusal to touch a group
administrator's row came after — too late, because Firebase is not in the
transaction. The manager then signed in as a group administrator, with every
property. The same worked on any staff member at any other hotel.

`app.may_set_password` existed to refuse exactly this; its own comment says
"resetting a group administrator's password is how a property manager
becomes one". Only the password endpoint asked it. Two doors to one act, and
the guard on one.

Found by the security review of 15 September, from reading which calls touch
Firebase and in what order. Fixed in 088: `app.require_claimable_address`,
SECURITY DEFINER because under the caller's own row policies a manager
cannot even SEE the owner's row — a lookup there reads empty and waves the
takeover through. Asked before `ensureAccount`.

**The rules:** a side effect that cannot be rolled back goes after EVERY
check, never between them. And a guard belongs to the act, not the
endpoint — find every path that performs it.

---

### 264 · My proof run created two accounts on the LIVE sign-in service

To prove the takeover fix (263) I took it out and ran its tests, expecting
the request to die at Firebase "which this suite does not carry" — the test
file's own header says so. It does carry it. `api/.env` on this machine holds
the PRODUCTION Firebase admin key (poms-fad05), and `with-test-db.sh`
redirected the database but not that. So the unfixed code ran for real: it
CREATED `owner@fidato.in` and `pune@fidato.in` on the live service, display
name "Anybody", password `the-gm-chose-this` (15 Sep, 10:38 GMT).

Checked read-only afterwards: neither existed before, so nobody's password
changed; neither is linked to a staff row, so they reach nothing in the PMS;
they are the only test-looking accounts among the project's five. They are
still junk on a live service with a known password — removing them is the
owner's call.

Found only because the failure arrived LATER than predicted — the row-level
refusal instead of "no service account". A red test is evidence of exactly
what it says, and this one said "Firebase answered".

Fixed: the wrapper exports `FIREBASE_SERVICE_ACCOUNT=""` (an empty variable
survives `process.loadEnvFile`, which fills only unset ones), and
`guards.test.ts` fails if the suite ever carries a service account again.

**The rules:** a proof that disables a guard runs where the unguarded path
can do no harm — check what the environment can reach BEFORE pulling the
guard out. And a test comment that says "X is not exercised here" is a claim
to verify, not a fact to rely on.

---

### 265 · The desk still said "folio" in three places after step 1 — one of them untrue as well

Step 1 settled "Bill at the desk, Folio in Finance". Three desk sentences
survived it: the check-in dialog ("the reason is kept on the folio"), the Due
out description ("Check-out unlocks when the folio reaches zero") and its
banner ("Settle from the folio tab" — the tab is called Bill). The first was
also false: the ID-skip reason goes to the stay's NOTE (`operations.ts`,
"ID not captured — …"), not the bill. Found while adding the Form C
explanation to the same dialog in step 4. Step 1's sweep read menus,
headings and pills, not the sentences inside flows.

**The rule: a vocabulary sweep reads every sentence the role sees — dialogs
and banners, not only labels. And a sentence that says where something is
kept is a claim: trace it to the write.**

---

### 266 · The City ledger invented a contact person for every account — since 28 August

`/reports/city-ledger` returned ``contact: `Mr. ${account}` `` — "Mr. Agoda",
"Mr. Walk-in" — printed under Contact Person and written to the CSV. It came
with the statutory reports (57a59f7, 28 August), one line above a phone
field commented "Not held in this system. A dash, not a blank." Found reading
the same query for step 4's empty states. `companies` does hold
`contact_name` and `phone`: the report now shows those on a company's own
row and a dash everywhere else (in the demo data no account has one). The
demo snapshot carried seven; cleared.

**The rule: "never invent" covers words as well as numbers. A placeholder
that looks like data is data to whoever reads it.**

---

### 267 · Two files whose names differed only in case

`startHere.ts` (what the card says) beside `StartHere.tsx` (the card). On
Windows `import "./StartHere"` resolved to the `.ts` file: TS1261 and "no
exported member" in six pages. Renamed `startHereCards.ts`. Linux, where the
server builds, would have resolved it the other way.

**The rule: never two names in one folder that differ only in case.**

---

### 268 · My first placement of the card left the Rooms screen 41 pixels of rooms on a phone

I put Start here above both views of the Rooms screen, outside their scroll.
At 375×812 the controls take 376px and five jobs 665px: no rooms at all until
"Got it", and still 41px once capped at 45%. Found by measuring at phone size,
not by looking at the desktop, where it was fine. It now sits inside the
rooms' own scroll on the Rooms view (it scrolls away above them) and capped
above the calendar. The controls' 376px is its own problem, in PENDING.

**The rule: anything added above a full-height screen is measured at phone
size before it is called done.**

---

### 269 · Housekeeping had no loading, error or empty state

While the rooms loaded, a housekeeper saw a heading and "Online" and nothing
else — the same if the load failed, the same on a sheet with nothing on it.
Three situations, one blank board. Found by step 4's empty-state audit. Each
now says which it is; an empty sheet names whose, with "Show all rooms".

**The rule: every list has four states — loading, failed, empty, full. A
screen that draws only the last looks broken in the other three.**

---

### 270 · A deliberate break that did not bite

Proving "the general manager gets no card", my first break — hand the GM
reception's card — left the test green. The break missed: a second guard (no
landing screens listed for the GM) hid the card anyway. Removing both made
the test fail as it should.

**The rule: when a deliberate break leaves a test green, find out which is
wrong — the break or the test — before calling it either way.**

---

### 271 · Every deploy re-creates the placeholder administrator once it has been deleted

`008_seed.sql` seeds `REPLACE@fidato.in` as an active group administrator,
guarded by `on conflict (email) do nothing` — and every deploy replays every
migration from 001. On 9 September the row was DELETED (13:50 UTC, with the
other test rows). The 15 September deploy's replay found no such address and
inserted it again (13:08 UTC): an active group administrator nobody owns, which
preflight then failed on. My pre-deploy check counted two active staff; I did
not ask what the replay would insert.

Not an open door: sign-in resolves by Firebase uid only, and only a group
administrator can attach a sign-in to a group administrator's row (088 closed
the "add somebody" path as well). Deactivating is what sticks — the row
stays, so the seed's insert does nothing on every later deploy.

**The rules: where migrations replay, a seeded row cannot be deleted, only
switched off. And a pre-deploy check asks what the replay will INSERT, not
only what it will change.**

---

### 272 · The move silently narrowed a guard, and it kept passing

Rule 2b in `repositories.test.ts` — no exported data function without a
caller — defined "the seam" as `src/data/repositories` and counted a caller
only when its import path named that folder. The service-folder move put
most data files in `src/modules/<service>/data/` and pointed the screens at
each service's front door. The gate went on passing: it now scanned the
eleven core files and nothing else. Found only because one moved test file
tripped its OTHER half (a known-unused function "gained a caller"). Widened
to every data folder and to door imports; seen to fail with an unused
function planted in front desk's data.

**The rule: when files move, every guard that names a path is suspect. A
guard that passes after a move has proved nothing until it has failed once
on the new layout.**

---

### 273 · The agents' copies of the repo sat inside the repo

The Agent tool puts each agent's git worktree in `.claude/worktrees/` —
inside this folder. Three things saw them: vitest's default include (a run
here would have run six other copies' tests, server tests included, against
this copy's settings), git (six untracked directories, one `git add -A` from
being committed), and the Vite dev server here (it reloaded the page mid-check
as agents saved files). Caught by a check that returned nonsense headings,
before any test run was trusted. Fixed: vitest excludes `.claude/**`, git
ignores `.claude/worktrees/`. The dev server's reloads are harmless and left.

**The rule: before running agents in parallel, ask what each tool in this
copy will see of theirs.**

---

### 276 · MINE: a menu name too long for the sidebar

Building the Coming soon section (16 September) I named one page
"Contracts and allotments". Every gate passed; the sidebar, 248px wide,
showed it as "Contracts and allotm…". Found by opening the screen as a GM,
not by a test — the menu tests checked the names' case and uniqueness, never
their length. Renamed "Contracts" (menu and heading alike — a heading that
differs from its menu entry is its own recorded defect) before anything was
committed, and `navigation.test.ts` now refuses a label over 21 characters,
the longest that fits today. Proved by putting the long name back: the test
failed on it.

**The rule: a menu label is checked where it is shown. The screen, not the
source, says whether it fits.**

---

### 275 · MINE: a figure quoted off the wrong line of a file I only skimmed

Writing the integration plan (15 September) I grepped the CRS's
`scripts/hotels.reference.ts` for the Akkalkot entry, printed a dozen lines
around it, and read "commissionPercent: 10" as that hotel's figure. It was
the previous hotel's closing line; Akkalkot's is 15, two lines below the
window I printed — and the file's header, which I never read, says every
commission figure in it is simulated. The draft called it a real commission
leaked in a public repository. An audit agent read the whole file and caught
it before the plan reached the owner.

**The rule: a number quoted from a file is read with its whole record — the
lines that bound it, and the file's header — never from a grep window. If
the claim is "this is a real figure", find where the file says so.**

---

### 274 · MINE: I reported the web tests green while the run ended red

From the Start here commit (657d039, 15 September) every `npx vitest run`
exited with code 1: two of the tests I added open the housekeeping board in
the test browser, which has no IndexedDB, and the board's read of the
offline queue rejected with nobody catching it. Every test passed; vitest
printed "2 unhandled errors" and failed the run. I read the pass count, and
my move script grepped for failed tests, and neither ever looked at the exit
code — so about fifteen reports today said green on a red run. Found by the
test-splitting agent. Nothing reached production (no build or deploy runs
the tests), and the board works in a real browser.

Fixed where it belongs: the board now catches the failure and treats it as
"nothing held on this device", exactly as `OfflineBar` has since it met the
same fault; the offline bar is what tells the person. The move script
checks the exit code.

**The rule: a gate's answer is its exit code. Read it, every time — a
summary line is not the result.**

---

### Open · two "in house" numbers for the same moment

The property page (`getTodaySnapshot`) said **In house now 11, Vacant 9** while
the Dashboard and the Rooms screen (stay-view counts) said **10** and **7**,
same hotel, same minute, 14 September. Two definitions — stays against rooms,
sold tonight against occupied now — and neither labelled which. Not fixed in
Phase 1; recorded in PENDING.md. The rule it breaks is the oldest one here:
one definition, or two screens disagree and nobody can say which is right.
