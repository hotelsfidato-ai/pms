# Defects — the accounting export

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `ACC-1`, `ACC-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Fixed

### ACC-10 · The file had no Restaurant column, though the server sends one — FIXED 24 September

**Found** — 23 September, copying the CSV's columns for the .xlsx (D22-37).
The server's day book has had `pos` and `posTax` since 19 September — what
the outlets sold in cash, by card or UPI, "its own column because an
accountant asking what the restaurant took should not have to subtract two
other figures". The screen's `DayBookRow` never took them, so neither the
screen nor the CSV (nor now the .xlsx, which copies the CSV) has that column:
the takings are inside Sales and GST, and in no column of their own.

**Not changed** — the .xlsx was to match the CSV. Adding the column to both
is a question for the owner (what the accountant's file shows), with the
recommendation: yes, "Restaurant" and "Restaurant tax" after "Extra tax".

**Fixed** — the owner's D24-24: "Restaurant" and "Restaurant tax" after
"Extra tax", in the CSV and the Excel file - one change, in the layout both
are written from (`api/src/modules/accounting/sheet.ts`). The screen's table,
which is the file drawn, has the two columns too. What they carry is what
the outlets took in cash, by card or UPI; a bill charged to a room stays in
Extra charges (ACC-11).

**Proved** — `accounting.test.tsx`, "gives the restaurant's takings their
own two columns, after Extra tax" (fails with them taken out of sheet.ts);
`dayBook.test.ts` reads the .xlsx back cell for cell with the new columns.

### ACC-11 · A restaurant bill charged to a room was counted twice — FIXED 24 September

**Found** — 24 September, reading the day book back while photographing the
Excel file (D22-37) on `fidato_s1`: 25 August's Alcohol read ₹1,500 where
₹1,000 of whisky had been sold (₹500 paid in cash at the restaurant, ₹500
charged to room 202). `dailyFigures` counts the room's posting in `extra`,
and `posSales` counted every settled order again as an outlet sale - the
room-charged one included - so Sales, and its GST (or VAT, for drinks), was
too high by every restaurant bill charged to a room, since 19 September. The
Manager report was right: it keeps the restaurant's room postings out of its
extra charges ("POS to PMS Posting").

**Fixed** — with the owner's yes: `posSales` (reports' `figures.ts`, read by
the day book and nothing else) leaves out a bill settled to a room. 25
August now reads Sales ₹18,754.90 (was ₹19,254.90), Alcohol ₹1,000, VAT
₹100.

**Proved** — `api/test/modules/accounting/dayBook.test.ts`, "counts a meal
charged to a room once": a meal rung at the till and settled to a real
room moves Sales by its net exactly once and the outlets' figure not at
all. With the predicate taken out it fails ("expected 3040 to be 2400").

**The rule** — two sources that each hold part of a sale must agree on who
holds the part they share.

### ACC-1 · Two menu entries on one order number, and the shared guard caught it

**Found** 19 September, by `src/components/app/navigation.test.ts` on the full
web run — not by reading. The new entry took `order: 80` in the **reports**
section, where "Yearly statistics" already sits on 80. The section's entries
are sorted by that number, so two on one number order themselves by whichever
service happens to be spread into `ENTRIES` first — a menu that changes
position when an unrelated service is added.

**What was done:** moved to `order: 140`, the foot of the section, and the
reason written beside it in `nav.ts`.

**The rule:** the orders are tens *across every service*, not within your own
file. Read the section's existing numbers before taking one — the same shape
of mistake as two lanes taking one migration number (root MEMORY 301).

### ACC-2 · The Closed column was only ever seen false, and a constant would have passed

**Found** 19 September, while breaking the guards on purpose. The demo
fixture has **no completed night audit in the month at all**, so every
assertion about the Closed / Not run column ran against `closed: false`.
Wiring the column to the constant `false` passed the whole file — the test
that was supposed to prove the column proved nothing about it.

**What was done:** `api/test/modules/accounting/dayBook.test.ts` now closes
one day, reads the day book, asserts `Closed`, and unclosed it again, then
**measures** that the row is gone and the day reads `Not run` once more. With
the column forced to `false`, that test fails and the older one still passes,
which is the point.

**The rule:** a two-state column whose fixture only ever holds one state is
not tested, however many assertions point at it. Make the other state, read
it, and put it back — and measure the putting back (root MEMORY 292).

### ACC-9 · MINE: I read a test ERRORING as a guard refusing, and reported a guard proved that was not

**⚠ THE LESSON IS EVERY CHAT'S. It belongs in the root `MEMORY.md`, which is
the master's to number.**

**Found** 19 September, by the **full** API suite — after I had already
written "the guard refused" into this service's `CHANGELOG.md`.

Proving the five server guards, I broke all five at once and read the result:
five tests failed, one per break, which I took as five guards refusing. Four
of them were. The fifth — ACC-2's "says Closed for a day the night audit HAS
run" — was **not failing because of my break at all.** It was failing because
the test's own `insert into night_audit_runs` violated
`nar_completed_needs_finish` (migration 014): a run marked `completed` must
carry a `completed_at`, because the audit has to insert `running`, post its
charges, and only then mark itself complete. My insert had no `completed_at`,
so the test errored **every** time — before the break, during it, and after.

**What gave it away, and what I should have read the first time:** the four
real refusals each printed `→ expected 200 to be 403`, `→ expected false to
be true` and so on. That one printed **no `expected` line at all** — it
printed an `error:`. I had the evidence on screen in the break run and read
past it, because the test name was in the failed list and the failed list was
the length I expected.

**What was done:** `completed_at` set in the insert, and the reason written
beside it. The test then passes intact (**15 passed**), and with
`closed: closed.has(date)` forced to `false` it fails with
`AssertionError: expected false to be true` — an assertion, which is what a
guard refusing looks like. `CHANGELOG.md` corrected: that guard was proved
**after** the full suite, not in the break run.

**The rule, and it is the one that matters:** **a red test is not a proved
guard — a red ASSERTION is.** When you break code to watch a guard refuse,
read the failure's *reason*, not the count of failures and not the test's
name. A test that throws before it reaches its assertion is red for every
input and proves nothing about any of them. And breaking several guards at
once makes exactly this mistake cheap: the one that was already broken hides
inside a failure count that looks right.

### ACC-8 · A table that can never be empty, and an empty state nobody could ever see

**Found** 19 September, re-reading my own screen while the API suite ran —
not by a test, which is the point: **every test passed with this in.**

The screen gave `DataTable` an `empty=` state reading "Nothing in this range".
`dailyFigures` builds its answer from `generate_series(from, to)` and **left
joins** the money onto it, so it returns **a row for every day of the range
whether or not anything happened**. `days` is therefore never empty for a
valid range, and that state could never render. Worse than dead code: a person
could export a month in which the hotel charged and received nothing, and be
told nothing at all — the table would show twenty-five ordinary-looking rows
of `₹0.00` and the button would hand them a file.

**What was done:** the unreachable state removed, and replaced with the
sentence that can actually happen — a line above the table when the range's
sales, tax and receipts are all nil, saying the file will have a row per day
and all of them nil. The rows stay: the days are real and so is the nil.
`accounting.test.tsx` holds the screen to saying it.

**The rule:** an empty state is a claim about when a list can be empty. Before
writing one, read the query that fills it — a `generate_series` left-joined to
its data never comes back empty, and "no rows" and "no money" are different
questions. A green suite says nothing about a branch no fixture can reach.

### ACC-6 · The export is the ledger's basis, and the Lodging tax report is not

**Found** 19 September, reading `builders/lodgingTax.ts` while choosing what
to build on. That report is made **from the invoices** — "a lodging tax return
is filed from the bills that were issued, not from the ledger's own totals" —
while this export is made from `dailyFigures`, which is the ledger. The two
are different bases on purpose and **will not tie out** for a month where a
stay is in house and unbilled.

**What was done:** asked the owner, with a recommendation, rather than
deciding it. **Their answer, 19 September: one line on the screen.** The day
book keeps the ledger basis - it is the right one for a day book, and D18-16
asked for sales, tax and receipts by day - and the screen now says, under the
table, that the Lodging tax report counts the bills that were issued instead,
so a stay still in house appears in one and not the other. `accounting.test.tsx`
holds the screen to saying it.

**Not done, and not asked for:** carrying the invoice basis as extra columns.
That would put two sales figures in one file, which is the exact thing this
service exists to prevent.

**The rule:** when two of this system's documents answer different questions
with the same-sounding words, the screen says which question it answered. The
person exporting should not learn it from their accountant.

---

## Open — not fixed

### ACC-3 · Food is not its own line; the extras are one number

**Found** 19 September, reading the brief against the reports door before
writing anything. The brief asks for "room revenue, food, and the extra
charges as separate lines, because that is how they already appear on the
Manager report". The door exports `dailyFigures`, whose `extra` is every
non-room, non-money posting added together. The split by kind is a query
**inside** `builders/manager.ts` and is not exported.

**What was done:** nothing here, deliberately. Widening another service's
files is not this lane's to do, and reading the figures back out of 31 built
Manager reports (one per day, each re-scanning from 1 April, matched by the
words they print) is slower and more fragile than asking. **The request is in
`MODULE.md` under Requests, to the master: `dailyExtras()` lifted into
`figures.ts`, as R1 was for revenue management.**

**The owner's answer, 19 September:** ship one "Extra charges" line now and
wire the split in when the door opens. The screen and the file both say
"Extra charges", so nothing claims to be a food figure that is not one.

**Narrower, 25 September, and still open.** Two things have their own columns
since: what the outlets took in cash, by card or UPI ("Restaurant" and
"Restaurant tax", ACC-10, D24-24) and alcohol with its VAT (D21-91). What is
still one number is everything else charged to a bill - food charged to a
room, laundry, the spa, late check-out (`extra` in `dayBook.ts`) - because
the reports door (`api/src/modules/reports/index.ts`) still does not export
the Manager report's split by kind.

### ACC-4 · The two Tally XML formats produce no file

**Found** 19 September, by asking rather than by a test. A Tally voucher names
the ledger it posts to, and `MODULE.md` has listed "the ledger names in your
books" as the owner's to give since 16 September. Inventing them would have
them *created* inside the hotel's Tally on import.

**What was done:** the owner's answer, 19 September — ship the day book CSV,
offer all three formats as D18-16 requires, and have the two XMLs say exactly
what they are waiting for, beside each one. `accounting.test.tsx` holds both
of them to saying it, and holds the Export button to refusing a format it
cannot write.

**Waiting on:** what the owner's Tally calls room rent, food, other services,
CGST, SGST and cash receipts - and, since D21-91, alcohol sales and VAT where a
property serves alcohol (the screen's sentence in `data/accounting.ts` asks
for both, 25 September).

### ACC-5 · Two small copies of shared code, because there is no door for them

**Found** 19 September, while writing them.

- `round2` — one line, copied from `api/src/modules/reports/document.ts`,
  which the reports door does not export. **Two definitions of how money
  rounds** is exactly the kind of thing this project hates.
- `roleAt` — the **third** copy of "what is this caller's role at this
  property" (`equipment/grants.ts` and `housekeeping/repairRoles.ts` hold the
  other two). A service may not import another's insides, so a copy was the
  only way to ask it from here.

**What was done:** both copied, both marked in the code with why, and both
raised in `MODULE.md` under Requests. Hoisting them is the master's — one line
in the reports door, and `api/src/auth.ts` for the role.

**Still both copies, 25 September:** `round2` at `dayBook.ts:35` (the reports
door exports `col`, `row` and `total` from `document.ts`, not `round2`),
`roleAt` at `routes.ts:40`. And the role question has more homes than the three named:
`api/src/roleGate.ts` (the core's, 22 September) and
`api/src/routes/approvals.ts` ask it inline too. None of them is exported for
a service to call.

### ACC-7 · `npm run lane` blames this chat for four other services, because nothing is pushed any more

**⚠ THIS IS EVERY LANE'S, NOT JUST THIS ONE. It belongs in the root
`MEMORY.md`, which is the master's to number.**

**Found** 19 September, running `npm run lane -- accounting` before
committing. It reported **"90 files changed · 38 files outside the accounting
lane"** and named laundry's, spa's, revenue management's and purchasing's
files as somebody else's work this chat had strayed into. This chat had
touched **thirteen paths**, all of them listed by `git status`.

**Why:** `scripts/lane.mjs` line 130 takes its baseline as

```js
const base = sh("git merge-base HEAD origin/cp6").trim()
          || sh("git merge-base HEAD cp6").trim();
```

`origin/cp6` first. **The owner stopped every push on 19 September**, so
`origin/cp6` is frozen at `079f074` while the local `cp6` has moved on to
`b13d841` — **13 commits of already-merged work that never left this
machine**. Every one of their files is inside `base..HEAD`, so every lane
from 19 September on is told it has strayed into four services it has never
opened.

**Why it matters, and it is not cosmetic:** the lane check's whole job is to
give a chat the honest sentence it owes the owner before committing. A report
of 38 strayed files that are not strayed is noise, and the next real stray
edit arrives inside that noise and is waved through — which is the fault the
check exists to prevent.

**What was done:** nothing here. `scripts/` is shared by every lane and one
chat quietly changing the tool that audits every chat is the wrong shape.
**Reported to the master with the one-line fix:** prefer the local `cp6`, or
fall back to it whenever `origin/cp6` is an ancestor of it —

```js
const local = sh("git merge-base HEAD cp6").trim();
const remote = sh("git merge-base HEAD origin/cp6").trim();
const base = local || remote;   // local first while nothing is pushed
```

**Until it is fixed,** read the lane output against `git status` and quote
that to the owner instead. This lane: **13 paths, 12 of them accounting's own,
and one the master's — `src/components/app/navigation.test.ts`, the `SOON`
line, edited by that file's own invitation.**

**The rule:** a tool whose baseline is a remote is only as true as the last
push, and there are no pushes now. When a standing rule changes, the tools
that assumed the old one go stale quietly — and a check nobody can read is a
check nobody runs.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
