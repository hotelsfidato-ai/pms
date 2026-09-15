# Reservations — memory

This service's defects and lessons. A new defect found in this service is
numbered here with the prefix **RES-** — RES-1, RES-2, … — in the root
`MEMORY.md`'s shape: what happened, how it was found, whether it is fixed,
and the rule it teaches. A lesson that applies to the whole project still
goes in the root `MEMORY.md` with a plain number — 275 was the next free one
on 15 September; check the root file before taking one.

---

### RES-1 · A refused booking keeps what it wrote before the refusal

Found 15 September while writing this service's brief, by reading
`POST /:code/bookings` (then `api/src/routes/groups.ts`, now
`api/src/modules/reservations/groups.ts` — the move changed no endpoint's
code; checked again at `c804aa2`) against `withUser` (`api/src/db.ts`).
**Read in the code — not reproduced, not fixed.**

The route inserts the booking's guest — and, when there is more than one
room, its group — and only then can refuse: "That booking source is not on
the list any more.", "One of those room types is not here.", "N people will
not fit a …", "… has no price for …". A refusal is an ordinary return value,
and `withUser` commits whatever the callback returns; only a thrown error
rolls back. So a refused booking would leave its guest behind — a row
`015_edge_cases.sql` lets nobody delete — and, for several rooms, its group.
In a booking of several room types, the rooms already written for the earlier
lines (their reservations and folios) would stay booked when a later line is
refused, while the clerk reads a refusal.

How often the screen lets such a request through has not been checked — New
booking may stop some of these before they are sent. The server must not
rely on it.

This is defect 243's shape (the walk-in, fixed 14 September) in the other
door a booking comes through; PENDING § 2 says the other routes were never
checked.

**The fix, not made here:** every check — the source, each room type, each
party's size, each price — above the first insert, or a throw so the
transaction rolls back; and a test that sends a refused booking and counts
guests, groups and reservations before and after, seen to fail first. Ask
the owner before changing how bookings behave on the live system.

**The rule (243's, again): a refusal goes above the first write.**

---

## Before the move — entries in the root MEMORY.md

Read the bodies there. Number · title:

- 28 · A constraint the schema documents at length and does not have
- 81 · A feature that could never fire
- 106 · An empty list reduces to zero, and zero is a claim
- 118 · A route that could never run, under one that could
- 144 · A booking with nowhere to put money
- 159 · Links that had never opened anything
- 219 · Five copies of one label, and the fifth said "Walk-in" about Agoda
- 242 · "Required" went on one of the two doors a booking comes through
- 249 · A fix made in one of ten places: departed group rooms read "Room —"
