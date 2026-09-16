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
