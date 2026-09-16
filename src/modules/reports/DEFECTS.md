# Defects — reports

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `REP-1`, `REP-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### REP-1 · Monthly occupancy and Monthly statistics always show August 2026

**Found** — 15 September, writing the service's brief, by reading. The screens were not opened.

`pages/Statistics.tsx` asks for `getMonthlyStatistics(hotelId, "2026-08-01", "2026-08-31")` on both monthly pages and prints "August 2026"; Yearly statistics asks for 2026. They will still say August 2026 in March.

**The fix, when it is done** — Take the month and the year from the property's business date, and let the person change them — every other report already has a date range.

**The rule** — A date typed into a screen is a date that stops being true.

### REP-2 · The Manager report's year starts on 1 April 2026, typed in

**Found** — 15 September, writing the brief, by reading `manager.ts`.

The financial year's start is the literal 1 April 2026. Correct until 31 March 2027, wrong from April 2027 — quietly, in the report the owner reads most.

**The fix, when it is done** — Derive the year from the business date: April to March around it.

**The rule** — A literal date is a bomb with a date on it.

### REP-3 · All reports opens a screen headed "Reports"

**Found** — 15 September, writing the brief; confirmed on screen 16 September in the route audit.

The menu entry says "All reports"; the page says "Reports". Small, and it is the kind of thing that makes a person wonder whether they opened the right screen.

**The fix, when it is done** — Make the heading the menu's words.

**The rule** — A screen's heading is the menu entry that opened it, or somebody has to check.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **6** · Three defects the ledger hid until new screens read it — Rule: a fixture is only as honest as the screens that have read it. Expect each new screen to find something, and fix the seed rather than the screen.
- **40** · A boolean where a document should have been
- **43** · A revenue total that ignored every discount
- **44** · A GST register dated by the wall clock
- **135** · Four reports built, listed, and unreachable
- **147** · A date typed once, on the screen an owner opens first
- **169** · The dashboard said 5 arrivals due; the night audit said 2
- **219** · Five copies of one label, and the fifth said "Walk-in" about Agoda
- **253** · The Manager Report's period started on 1 August, whatever the month
- **256** · Every report printed one hotel's name, and the wrong person's — The rule: a document states facts, and a literal in the code is not one.
- **266** · The City ledger invented a contact person for every account — since 28 August — The rule: "never invent" covers words as well as numbers. A placeholder that looks like data is data to whoever reads it.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
