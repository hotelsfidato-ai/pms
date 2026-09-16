# Defects — inventory

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `INV-1`, `INV-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed


### INV-3 · Two responses turn an unpriced room into ₹0

**Found** — 16 September, the readiness audit, by reading.

`GET /:code/rates` (`rateGrid.ts:97`) and `GET /:code/room-types` (`roomTypesAndPlans.ts:66`) do `Number(null)` on a nullable `base_rate`, so a room nobody has priced reads as ₹0. A channel manager fed from either would push ₹0 to the booking sites.

**The fix, when it is done** — Let null through to the screen and print a dash — the fix root MEMORY 246 already made end to end for `rackTariff`. Two one-line changes.

**The rule** — `Number()` on a nullable column is a default price in disguise.

### INV-2 · Room types opens a screen headed "The house"

**Found** — 15 September, writing the brief; confirmed on screen 16 September.

The menu says "Room types"; the page says "The house".

**The fix, when it is done** — Make the heading the menu's words.

**The rule** — A screen's heading is the menu entry that opened it.

---

## Fixed — the solution is here; do not work it out again

### INV-1 · `GET /api/hotels/rate-plans` can never run

**Found** — 15 September by reading; **confirmed by running it** on 16 September — it answers 404 "No such property."

`GET /api/hotels/:code` is registered first and takes the word "rate-plans" for a property code. Harmless today: nothing calls it.

**Fixed** — 16 September: the route is gone from
`api/src/modules/inventory/roomTypesAndPlans.ts`, with the reason left in
its place. Removed rather than reordered — nothing called it, and moving a
route above another to make it reachable is a rule every later route has to
remember. The meal plans a screen needs already come with
`GET /:code/rate-plans` (`rates.ts`). 359 API tests and the strip-check (68
files) stayed green.

**The rule** — A route that a broader route shadows is not a route; it is a 404 with a comment.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **63** · The system shipped prices nobody at the hotel had chosen
- **64** · Rewriting a function from memory to remove one line from it
- **65** · The invented prices had a second home in the frontend
- **69** · A screen that looked deliberately empty and was simply broken
- **70** · Two different questions arriving at one path
- **81** · A feature that could never fire
- **96** · The fourth copy of a rule was the wrong one
- **97** · A test helper that quietly performed the wrong verb
- **107** · Picking a fixture by sort order instead of by what it needs
- **117** · Two migrations of mine were not re-runnable
- **246** · "Rack rate ₹0" for a room type nobody had priced

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
