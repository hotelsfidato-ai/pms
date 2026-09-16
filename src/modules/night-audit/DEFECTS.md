# Defects — the night audit

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `NA-1`, `NA-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### NA-1 · Two night-audit routes have no caller

**Found** — 15 September by the brief; confirmed 16 September by the route audit.

`GET /:code/night-audit/can-run` and `GET /:code/night-audit/runs` answer, and no screen asks. The screen shows blockers and the run; the history has no page.

**The fix, when it is done** — Either the Night audit screen gains the history (the data is there), or the routes go. The owner decides.

**The rule** — A route with no caller is either a missing screen or dead weight.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **19** · The wall clock standing in for the business date, on four write paths
- **26** · The date moved and the interface never found out
- **27** · Fixtures that test the audit, and the audit that ate the fixture
- **78** · I wrote a folio posting from memory, again
- **81** · A feature that could never fire
- **102** · A new column with a name the join already had
- **103** · The backfill only fixes rows that already exist
- **114** · The leak was load-bearing
- **169** · The dashboard said 5 arrivals due; the night audit said 2
- **171** · A moved guest was charged for the night TWICE
- **176** · Every no-show took a room out of sale, silently
- **177** · The fix moved the fault instead of removing it

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
