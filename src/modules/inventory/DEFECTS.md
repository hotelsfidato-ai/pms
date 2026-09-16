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

### INV-5 · A reception clerk can type a price on the Rate calendar

**Found** — 16 September, building the Pricing screen: its route guard let
reception through, because the guard asks the navigation and the navigation
asks the grant — and reception's grant is `rate: READ`.

The Pricing screen was closed with `RATE_SETTER_ROLES` (owner, admin, GM),
which is what this file has always said in words: the GM "approves overrides,
rate changes and purchases", a hotel manager "may not waive a charge or move a
rate". **The Rate calendar (`/h/:code/grids`) still has neither a route guard
nor a `canSee`, and it writes prices** — `PUT /:code/rate-grid` checks no role
either, only RLS. So a reception clerk who types the address can set a price
today.

**The fix, when it is done** — The same `canSee: setsRates` on the Rate
calendar's nav entry, a `RequireAccess` around its route, and a role check on
the write route. **Not done unasked**: it takes something away from a role
that has it today, which is the owner's decision, not mine.

**The rule** — A screen that WRITES may not be gated on a grant that only says
`view`. The navigation is the guard, so the grant and the screen's power have
to agree.


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

### INV-4 · The Pricing screen showed a rack rate as if it were the base

**Found** — 16 September, before it shipped: opening the new screen at 5
Elements, which has no rate rows. Every date read ₹4,099 under the words "the
base on each date", and the panel said "the base, one person, no meals —
₹4,099".

It was the room type's **rack rate**, which `app.price_for` falls back to and
which covers the people the type is sold for — two. Presented as a
one-person base it is a 100% error in the wrong direction, and it is the
figure everything else would then be built from.

**Fixed** — The screen treats only `source === "typed"` as the base. Anything
else is a dash, with a line naming the rack rate that still answers until a
base is set. The server was right all along; the screen was reading `price`
without reading `source`.

**The rule** — `price_for` answers a price AND where it came from. Reading the
number without the source is how a fallback becomes a fact.

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
