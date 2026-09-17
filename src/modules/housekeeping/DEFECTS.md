# Defects — housekeeping

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `HK-1`, `HK-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### HK-1 · The board never refreshes itself

**Found** — 8 September, measured: five requests, no duplicates, all under 15 ms. It is not slow — it has no refresh at all. Defect 218; **deferred by the owner** ("leave this for now").

A housekeeper marks 204 clean on a landing and the supervisor's screen does not change until somebody reloads.

**The fix, when it is done** — Known and small: extend the Postgres `NOTIFY` trigger from 075 to housekeeping changes, and add `useLiveOrders`-style invalidation to the board. The live channel already reaches Floor, Kitchen and Till.

**The rule** — A screen two people share needs to say when it last knew.

---

## Fixed — the solution is here; do not work it out again

### HK-2 · The board's offline read failed the whole test run

**Found** — 15 September, by the agent splitting the tests — every `vitest run` had exited 1 since the Start here commit while the summary said all passed. Root MEMORY 274.

Two tests open the board in a browser with no IndexedDB; the board's read of the offline queue rejected with nobody catching it. Every test passed; vitest printed "2 unhandled errors" and failed the run.

**Fixed** — The board now catches the failure and treats it as "nothing held on this device", exactly as `OfflineBar` has since it met the same fault. Nothing reached production: no build or deploy runs the tests.

**The rule** — A gate's answer is its exit code. Read it, every time.

### HK-3 · A room already out of service offered "Take out of service"

**Found** — 16 September, reading the board for the critique's P3. The one button on an out-of-service room said "Take out of service" and opened what was out, with "Put back" on it.

**Fixed** — 17 September, on the owner's answer: the button says **Put back**. Pinned in `housekeeping.test.tsx`.

**The rule** — A button says what it does, not what the room once needed.

### HK-4 · Work orders turned every failure into "Nothing outstanding"

**Found** — 17 September, adding the Closed list: `listWorkOrders` ended in `catch { return { orders: [], closed: 0 } }`, so a server that did not answer read as a maintenance list with nothing on it. Root MEMORY 251's shape, in this service.

**Fixed** — the call throws; the page draws loading, failed (with a retry), empty and full. `housekeeping.test.tsx` "says the list did not load" — seen to fail with the old catch put back.

**The rule** — Every list has four states (MEMORY 269), and a data call that flattens a failure into data has deleted the second one.

### HK-5 · Closing a closed repair again overwrote who closed it

**Found** — 17 September, reading `PATCH /work-orders/:id` for D17-7: nothing refused a second close, so it set `closed_by`, `closed_at` and `resolution` again over the first.

**Fixed** — refused, "This repair is already closed.", before anything is written. API test: the first closer and their words stay.

**The rule** — A record of who did something is written once.

### HK-6 · Putting a room back would have failed the moment a repair linked its block

**Found** — 17 September, linking Report a repair's block to its work order. 058's `work_orders.block_id` references `room_blocks`, and Put back DELETES the block — but no code had ever set `block_id`, so the foreign key had never had anything to refuse.

**Prevented, before it shipped** — Put back clears the link, then deletes; and its "That block is not here." refusal moved above both writes. API test: link, put back, link gone.

**The rule** — A column nothing writes hides what its constraints will do. The day something starts writing it, read every statement that touches the row it points at.

### HK-7 · Work orders printed raw dates beside pages that print them properly

**Found** — 17 September, at 375px: "raised 2026-09-17" on Work orders; "17 Sep 2026" on the equipment page beside it.

**Fixed** — `dateShort` from `src/lib/format.ts`, on Work orders and the item's Repairs.

**The rule** — `format.ts`, never a date as the database spelled it (the brief's trap).

### HK-8 · A proof photo would have been saved "on this phone" without the photo — avoided

**Found** — 17 September, before writing the cost route. `src/lib/offline.ts` holds any write to a `/work-orders` address when the line is down, and `api()` keeps only a TEXT body when it holds one (and always sends `content-type: application/json`). A cost posted to `/work-orders/:id/costs` with no signal would have been held without its file, and refused on sync after the manager was told "saved".

**What was done** — the cost doors are `/repair-costs` (not on the list, so refused offline at once, in a sentence), and the upload uses its own `fetch` from the core's `apiBase` and `authHeaders`. Lesson proposed to the master for the root `MEMORY.md`.

**The rule** — Before giving an upload an address, ask what the offline rules do with that address — they decide by path, not by body.

### HK-9 · MINE: a link cleared before the refusal that should have stopped it

**Found** — 17 September, re-reading my own Put back change before running it: I put `update work_orders set block_id = null` above the "That block is not here." refusal. Inside `withSession` that refusal would have committed the update (root MEMORY 243) — a wrong room number in the address would have unlinked a real repair.

**Fixed** — the block is looked up and locked first; the refusal, then the two writes.

**The rule** — MEMORY 243 again, in my own hand: write the refusals, then the writes, and re-read the order before running it.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **9** · A transport swap that the screen did not use — Rule: swapping a module's transport is not finished until the SCREEN that uses it has been clicked. Trace from the button, not from the module.
- **49** · A connectivity flag that was a button, and a failure that vanished
- **77** · The API does not reload, and I read a stale endpoint as a bug
- **127** · A queue in useState is not a queue
- **163** · Only a check-out dirtied a room — The rule belongs where the fact is.
- **177** · The fix moved the fault instead of removing it
- **218** · Housekeeping never refreshes itself — DEFERRED by the owner
- **258** · The Rooms screen named every room state twice — and my plan to fix it was wrong twice — The rule: rename a number by what it counts, never by what the word sounds like.
- **260** · The restaurant's own roles could not see the restaurant — The rule: a comment that says who a screen is for is a claim — test it against that role's actual menu.
- **269** · Housekeeping had no loading, error or empty state — The rule: every list has four states — loading, failed, empty, full. A screen that draws only the last looks broken in the other three.
- **274** · MINE: I reported the web tests green while the run ended red — The rule: a gate's answer is its exit code. Read it, every time — a summary line is not the result.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
