# Defects — banquet

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `BQ-1`, `BQ-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### BQ-1 · A restaurant bill cannot be charged to a banquet function

**Found** — 15 September, writing the brief, by reading.

Nothing in the till sets `pos_orders.event_id`, so food ordered for an event cannot land on the event's bill. `PROGRESS.md` says it can.

**The fix, when it is done** — Either the till learns to attach an order to an event (the column exists), or `PROGRESS.md` stops claiming it. Ask the owner which.

**The rule** — A document that claims a feature the code does not have is a defect in the document.

### BQ-2 · Diary opens a screen headed "Banquet"

**Found** — 15 September, writing the brief; confirmed on screen 16 September.

The menu says "Diary"; the page says "Banquet".

**The fix, when it is done** — Make the heading the menu's words.

**The rule** — A screen's heading is the menu entry that opened it.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **120** · A teardown that cleared the table instead of cleaning up after itself
- **121** · A shared action bar that could not wrap
- **214** · A switch that said "not built yet" about something that was built
- **250** · Any clerk could switch a hotel's modules on or off

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
