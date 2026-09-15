# Memory — banquet

What this service learned the hard way. Read it before your first edit here.

**New defects for this service are numbered with its prefix: BQ-1, BQ-2,
and so on**, each with what broke, how it was found, whether it is fixed, and
the rule it teaches (`HANDOVER.md` § 5: every mistake is recorded, numbered).
Newest at the bottom of the numbered list.

Project-wide lessons — anything that would bite another service too — stay in
the root `MEMORY.md` with plain numbers. When this file was written
(15 September 2026) the root file's numbers ran to 274. Check the root file
before taking one.

---

## Defects found since the move

### BQ-1 · The till cannot charge a function, though the progress file says it can

Found 15 September 2026 while writing this service's brief, by reading the
code. **Not fixed.** The screen was not opened.

`061_banquet_food.sql` added `pos_orders.event_id` so a restaurant bill could
reach a function's folio instead of a room — the meeting that orders tea in
the afternoon — and `app.banquet_event_total` adds every settled bill carrying
it into the function's total. That is the "From the till" line on a
function's page. `PROGRESS.md` (the banquet stage) says "`pos_orders.event_id`
lets the till charge a function directly".

**Nothing sets it.** No `event_id` appears in `api/src/routes/till.ts` or
anywhere in `src/modules/pos`, and the only file under `api/src` that names
`event_id` is `banquet.ts`, which never writes `pos_orders`. So no bill can be
charged to a function, and "From the till" can only read zero.

The change would be in the restaurant's till — a request to the `pos`
service, after the owner says whether it is wanted.

**Rule:** a column somebody sums is not a feature until something writes it.
Trace the act from the button to the write before calling it built — the
project's signature defect (root `MEMORY.md`, "Ten faults that repeat", 10).

### BQ-2 · The Diary is headed "Banquet"

Found 15 September 2026, reading the code. **Not fixed.**

The menu entry is "Diary" (`nav.ts`). `pages/Banquet.tsx` draws
`PageHeader title="Banquet"`, and `PageHeader` sets the browser tab from its
title — so the tab says "Banquet" too. `HANDOVER.md` § 6: the menu label, the
page heading and the browser tab say the same words. Which word stays is a
naming decision; the 15 September vocabulary pass was the owner's.

**Rule:** a new or renamed screen is checked against its menu entry — the
heading is the tab.

---

## Before the move — entries in the root MEMORY.md

- 120 · A teardown that cleared the table instead of cleaning up after itself
- 121 · A shared action bar that could not wrap
- 214 · A switch that said "not built yet" about something that was built
- 250 · Any clerk could switch a hotel's modules on or off
