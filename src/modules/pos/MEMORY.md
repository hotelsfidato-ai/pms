# Memory — the restaurant (POS)

What this service learned the hard way. Read it before your first edit here.

**New defects for this service are numbered with its prefix: POS-1, POS-2,
and so on**, each with what broke, how it was found, whether it is fixed, and
the rule it teaches (`HANDOVER.md` § 5: every mistake is recorded, numbered).
Newest at the bottom of the numbered list.

Project-wide lessons — anything that would bite another service too — stay in
the root `MEMORY.md` with plain numbers. When this file was written
(15 September 2026) the root file's numbers ran to 274. Check the root file
before taking one.

---

## Defects found since the move

None yet.

---

## Before the move — entries in the root MEMORY.md

The restaurant's history lives in the root file. These are the entries about
this service; read them there.

- 21 · A grant list that read as a restriction
- 22 · A self-test that could not run, in a file lecturing about self-tests
- 23 · One room, two guests — and code that picked whichever came first
- 24 · A convenience UPDATE against an append-only ledger
- 25 · A cleanup that worked and a measurement that did not
- 54 · Test fixtures with a seat in the application
- 55 · One posting cannot carry two tax rates
- 56 · Fixing the trigger instead of the caller
- 57 · Rupees on a document somebody pays from
- 72 · I contaminated my own reproduction, then reported it as a defect
- 75 · A till that made six taps into six lines
- 76 · A till the kitchen never heard from
- 92 · The dev database was empty and I blamed the code
- 93 · The refusal did not agree with itself
- 112 · A test staff row that had been an employee for months
- 131 · A button is shrink-to-fit, and it took the card with it
- 132 · The window is not the thing the cards live in
- 133 · A screenshot is not a measurement
- 144 · A booking with nowhere to put money
- 154 · The template imported its own instructions
- 171 · A moved guest was charged for the night TWICE
- 172 · The fix broke a departure, and the suite caught it
- 173 · The assertion that reproduced the bug it was checking for
- 181 · The kitchen's live channel — and where it would have gone wrong
- 194 · The till cost three round trips per dish
- 195 · A guard that skipped itself, and passed with the bug in
- 199 · The guard the owner asked for was already in the database
- 200 · A settle is four different acts at one address
- 201 · A persisted cache outlived the shape of the thing it cached
- 202 · A function in RETURNING reads the row as it was, not as it is
- 203 · The API typecheck gate was red and I did not notice
- 204 · The assertion that mattered most passed with its own bug in
- 205 · I spelled row-level security by hand and broke nine tests
- 206 · An append-only guard that blocked every teardown in the repo
- 207 · A guard that could not fail, caught before it was trusted
- 208 · `sort_order` and a course are two questions, and the menu proves it
- 209 · A parameter property took the production API down
- 213 · I shipped the audit's own finding, in the audit's own hour
- 223 · Two tests broke on a cap they were never about
- 250 · Any clerk could switch a hotel's modules on or off
- 251 · A refused receptionist was told "There is no menu yet"
- 260 · The restaurant's own roles could not see the restaurant

A defect found in this service while writing its brief is recorded in the
banquet service's `MEMORY.md` as BQ-1: nothing in the till sets
`pos_orders.event_id`, so a bill cannot be charged to a function.
