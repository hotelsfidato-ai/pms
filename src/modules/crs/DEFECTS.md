# Defects — the Fidato CRS

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `CRS-1`, `CRS-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### CRS-1 · A CRS booking answered only when all its rooms agree

**Found** 29 September, reading `answersOwed` (reader.ts). A CRS booking of several
rooms becomes several reservations, and the register has one status per booking. So
the answer goes only when every room is confirmed, or every room is cancelled or
voided.

If the desk confirms some rooms and cancels others, nothing is ever written, and the
CRS bookings screen shows no answer for it.

**The fix waiting:** the owner's word on what the register should say for a partly
confirmed booking.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
