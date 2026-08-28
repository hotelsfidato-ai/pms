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
