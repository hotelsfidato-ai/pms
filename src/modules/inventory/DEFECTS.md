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

### INV-2 · Room types opens a screen headed "The house"

**Found** — 15 September, writing the brief; confirmed on screen 16 September.

The menu says "Room types"; the page says "The house".

**The fix, when it is done** — Make the heading the menu's words.

**Changed 17 September, not yet proved** — the owner's D17-22 ("the heading is
the menu name"), commit `f7ae0f4`: Room types is headed "Room types" in all
three of its states (`pages/RoomSetup.tsx`). **Still open, 25 September:** no
test opens the screen and reads its heading, so "The house" could come back
with every gate green (`guests.test.tsx` holds its own four screens to their
menu entries; nothing does it here). **And a second screen was never in this
entry:** the Rate calendar (menu "Rate calendar") is still headed "Inventory
and rates" (`pages/Grids.tsx`) - `MODULE.md` named it on 15 September - and
`inventory.test.tsx` asserts that heading today.

**The rule** — A screen's heading is the menu entry that opened it.

---

## Fixed — the solution is here; do not work it out again

### INV-7 · Marking a default cancellation policy with a wrong id lost the default - FIXED 24 September

**Found** - by the route audit behind `api/test/roleGate.test.ts` (its probe of
this route was refused-only, because an allowed probe would write).

`PUT /:code/cancellation-policies/:id/default` cleared the hotel's default
first, then looked for the policy it was sent and refused - and inside
`withSession` a refusal is a commit (MEMORY 243). So a wrong or retired id left
the hotel with no default, and every new booking carried no terms.

**Fixed** - 24 September (the helper branch `stores/issue-outlet-rooms-persist`,
finished on `admin/finish-24sep`): the policy is looked for first, `for update`,
and a wrong id is refused before anything is cleared.

**Proved** - `api/test/modules/inventory/policyDefault.test.ts`: a wrong id
answers 409 "That policy is not here." and the default stays; with cp6's route
it fails ("expected [] to deeply equal [ Array(1) ]" - the default gone). The
role-gate probe now tries this route as every role, like the other price writes.

**The rule** - in a route whose refusal commits, ask before you change anything.

### INV-6 · A room is out of service in two records, and nothing keeps them in step — FIXED 17 September

**Found** — 16 September, asked by the owner to prove whether
`GET /:code/inventory` subtracts a room that is out of service "in every way a
room can be marked out of service", because the Rooms screen and the
notification bell disagreed about room 308. Proved by
`api/test/modules/inventory/outOfService.test.ts`.

The development database had 308 at `housekeeping_status = 'inspected'` with
one block, `out_of_service`, 14 August → open, covering the business date.

"Out of service" is written in two places:

```
room_blocks                dated, with a reason   read by the inventory (app.sellable_rooms),
                                                  every occupancy figure, the bell, the tape chart
rooms.housekeeping_status  the state NOW          read by the Rooms screen's "Out of service"
                                                  (front-desk stayview.ts), the property's room
                                                  count (GET /:code, core property.ts), the
                                                  admin list's "sellable" (adminLists.ts)
```

**What the inventory does — proved, and it answers the owner's question:**

```
a block through the Housekeeping board, each of its 5 reasons (NC included)   subtracted
a block's first and last day (inclusive), and not the days either side          subtracted
an open-ended block, a year on                                                  subtracted
the room retired (is_active false)                                              subtracted
the room's STATUS alone says out_of_service, no block                           NOT subtracted
the room's STATUS alone says out_of_order, no block                             NOT subtracted
308's shape: a block covering today, the status saying clean                    subtracted
```

So the inventory is consistent with the bell: its one definition is the block.
**The Rooms screen is the one reading the other record.**

**How 308 got there — reproduced through the API, not typed in:** the demo
gives 308 two blocks (1 Jan–7 Aug, 14 Aug → open). Releasing the PAST one
(`DELETE /:code/rooms/:number/block/:id`, housekeeping's `roomStatus.ts`) sets
the room `dirty` without asking whether another block still covers today; the
housekeeper can then clean it, and the Rooms screen draws it as sellable while
the bell and the inventory say it is out. Three more paths to the same
disagreement, found by reading the same file:
- a block that starts after the business date never sets the status when its
  day arrives (the status is set only at the moment of blocking);
- a dated block that ends leaves the status `out_of_service` for good;
- `out_of_order` as a status is not "Out of service" on the Rooms screen, and
  `GET /:code` counts only `out_of_service`.

**The fix, when it is done** — not in this service. The inventory already
reads the dated record, which is the only one that can answer "was it sellable
on the 10th". The drifting reads are housekeeping's (`roomStatus.ts` release),
front desk's (`stayview.ts`) and the core's (`property.ts`, `adminLists.ts`).
Which record is the definition is the owner's decision; recommended: the block,
with the Rooms screen reading `blocks` (already in the same response) rather
than `status`. If the owner decides a status with no block must count, the two
"NOT subtracted" cases in the test go red and say so.

**The rule** — One fact written in two places drifts on the first path that
updates only one of them. Before trusting a disagreement between two screens,
find which record each reads.

**Fixed by the master, 17 September (the owner's D17-11: the dated block).** The
Rooms screen (`front-desk/data/stayview.ts`), the property's sellable count (core
`routes/property.ts`) and the admin list (`admin/adminLists.ts`) now read the block
through the same rule as availability. Proved: `api/test/outOfServiceCounts.test.ts`
(a block with a clean status counts out; a status with no block does not) fails on
the old code. Seen locally: room 308, "inspected" with a block, counted in Rooms'
"Out of service 1"; the property says 17 rooms.

---

### INV-5 · A reception clerk could type a price on the Rate calendar

**Found** — 16 September, building the Pricing screen: its route guard let
reception through, because the guard asks the navigation and the navigation
asks the grant — and reception's grant is `rate: READ`. Pricing was closed
with `RATE_SETTER_ROLES`; the Rate calendar (`/h/:code/grids`) had neither a
route guard nor a `canSee`, and `PUT /:code/rate-grid` checked no role, only
RLS (which asks which hotel, not who).

**Fixed** — 16 September, on the owner's approval of the same day ("only
roles in RATE_SETTER_ROLES may set a price on the Rate calendar"):
- `nav.ts`: `canSee: setsRates` on the Rate calendar, so the menu, Find a
  screen and the route guard all ask the one list.
- `routes.tsx`: `RequireAccess` around `/h/:code/grids`.
- `api/src/modules/inventory/rateSetters.ts`: `setsRates(client, hotelId)` —
  a group administrator, or a `staff_hotels` role in the list AT THIS HOTEL.
  `PUT /:code/rate-grid` asks it before anything else and answers **403** with
  a sentence naming who can.
- The server's list is a COPY of `src/lib/permissions.ts`'s (the server does
  not import the website). `api/test/modules/inventory/rateSetters.test.ts`
  fails the moment they differ — so when the revenue manager joins
  `RATE_SETTER_ROLES`, `rateSetters.ts` has to follow in the same commit.

Proved: the API test sends a price as each of the twelve assignable roles —
three set it, nine get 403 and nothing is written — plus a GM of another
property who is reception here (403). With the check switched off, 10 of its
16 cases failed. `src/modules/inventory/inventory.test.tsx`: `mayReach` for
every role equals the list on both screens; a clerk typing the address gets
"not part of your role"; a GM gets the page. Removing the route guard failed
one; removing `canSee` failed two.

**What reception lost** — the whole screen, including its "rooms left" tab.
New booking still reads availability through the front door (`getInventory`).

**Still open, and not part of this approval** — the other price writes ask no
role either: `PUT /:code/pricing/basis|base|offset` (the Pricing screen is
closed; its API is not), `PUT /:code/room-types/:id/rate`,
`POST`/`DELETE /:code/rate-plans` (the Rate plans screen is still open to
`rate: READ`), and `POST /:code/restrictions`. Brought to the owner as one
question.

**The rule** — A screen that WRITES may not be gated on a grant that only says
`view`, and a guard on the screen is half a guard: the write refuses too.

### INV-3 · Two responses turned an unpriced room into ₹0

**Found** — 16 September, the readiness audit, by reading.

`GET /:code/rates` (`rateGrid.ts`) and `GET /:code/room-types`
(`roomTypesAndPlans.ts`) did `Number(null)` on a nullable `base_rate`, so a
room nobody has priced read as ₹0. A channel manager fed from either would push
₹0 to the booking sites.

**Fixed** — 16 September. Both let null through (`rackRate: number | null`),
and the screens print a dash: Rate performance's "rack —" and its tooltip, and
the routed-nowhere room-type list. A sale against an unpriced type is no longer
marked "below rack" either — there is no rack to be below. Swept the service
for siblings: every other `Number()` on a price here reads a NOT NULL column or
already checks for null.

Proved by `api/test/modules/inventory/unpriced.test.ts`: an unpriced type is
`null` on the row and on every date of `/rates` and on `/room-types`, and a
priced type keeps its figure. With the two server lines put back, both cases
failed with "expected +0 to be null".

**The rule** — `Number()` on a nullable column is a default price in disguise.

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
