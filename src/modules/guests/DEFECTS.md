# Defects — guests

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `GUE-1`, `GUE-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### GUE-1 · Companies and agents opens a screen headed "Booking sources"

**Found** — 15 September, writing the brief; confirmed on screen 16 September.

Worse than the other heading mismatches: "Booking sources" is also the name of a different, real screen, so the same words name two places.

**The fix, when it is done** — Make the heading the menu's words: "Companies and agents".

**The rule** — Two screens with one name is the fault the menu tests exist to catch.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **32** · Reading a migration instead of the database, twice more
- **40** · A boolean where a document should have been
- **41** · The demo loader leaked its guests, 249 of them
- **83** · A picker keyed by a slug, into a column expecting a uuid
- **135** · Four reports built, listed, and unreachable
- **219** · Five copies of one label, and the fifth said "Walk-in" about Agoda
- **220** · A data-modifying CTE read back by its own statement — 202, twice, in one afternoon
- **228** · Two menu entries called "Booking sources", and I made the second
- **242** · "Required" went on one of the two doors a booking comes through — The rule, again: "required on every X" starts with finding every statement that makes an X

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
