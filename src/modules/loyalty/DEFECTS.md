# Defects — loyalty

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `LOY-1`, `LOY-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

None. (`MODULE.md`, Left open, lists what is not built yet, which is not a
defect.)

---

## Fixed

### LOY-1 · A stay with no booking source earned only on its extras

**Found** 30 September, by `db/tests/modules/loyalty.sql` on its first run,
before any merge: a direct stay with 6,000 of room and 1,000 of food earned
50 points, not 350. The earning left out an OTA's or an agent's room with
`not (category = 'room' and source_kind in ('ota', 'travel_agent'))`; a
booking with no source has `source_kind` NULL, so for a room line that is
`not (true and null)`, which is NULL, and every room line of the stay
dropped out.

**Done:** `coalesce(source_kind in (...), false)` in `app.loyalty_earn`; the
same check now passes (21 of 21).

**The rule:** in SQL, a filter written `not (... in (...))` over a column
that can be NULL drops the row. Coalesce the IN, or test `is distinct from`.

---

### LOY-2 · A booking site's booking was read as direct when only the old text named it

**Found** 30 September, on the Loyalty screen against fidato_s42: Ganesh
Patil's stay read "Booked via go-MMT", yet the screen offered Use points.
759 of the 778 bookings there have no `booking_source_id`; where they came
from is only in the free text `reservations.source` ("Agoda", "go-MMT",
"Booking.com", or the bare word "ota"). Loyalty asked `booking_sources.kind`
alone, so almost every booking site's stay would have taken points off its
room (against L14) and earned on its room (against L10).

**Done:** `app.loyalty_not_direct(reservation)` - the channel's kind, then a
channel matched by the old text's name, then the old text itself - used by
the earning, the redemption and the screen; one database check for it
(22 of 22).

**The rule:** a booking's origin is `booking_source_id` OR the older
`reservations.source`, as the Manager report reads it
(`r.source = 'walk_in' or bs.kind = 'walk_in'`). Asking the new column alone
misses the history.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
