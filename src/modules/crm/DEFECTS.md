# Defects — the central CRM

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `CRM-1`, `CRM-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### CRM-2 · Two people who share a phone stay on the "possible same person" list for ever

**Found** — 21 September, building the list. A family that books on one
mobile, or a travel agent's number typed as the guest's, is two people who
share a phone. The list shows them until somebody joins them, and joining
them would be the wrong join the brief warns about. There is no "not the same
person" answer a manager can give that takes a pair off the list.

**What was done** — nothing yet: whether to add one (a dismissal, recorded
and undoable like a join) changes what a manager sees, so it is the owner's
question. Recommendation: yes.

### CRM-3 · A booking from a channel is never matched, and a blacklisted guest arriving through one is not flagged

**Found** — 21 September. The suggestion and the blacklist warning are shown
to a CLERK typing a phone or email (D21-20, D21-21). A booking the channel
manager turns into a real one has no clerk: it makes its own guest record, as
before, and nobody is warned. It surfaces later on "Possible same person".

**What was done** — nothing: where a machine-made booking should warn (the
arrivals list? the booking's panel?) is the owner's question. Recommendation:
the same warning on the stay panel of any booking whose phone or email is a
blacklisted guest's.

---

## Fixed

### CRM-1 · An administrator could not blacklist a guest — the trigger refused them

**Found** — 21 September, reading 013 before writing the blacklist route.
D21-21 says the owner, an administrator or a GM may blacklist. 013's
`app.guard_blacklist` asks `app.is_manager()`, which answers for the owner
role, the GM and a group administrator - and not for the `admin` ROLE. So an
administrator pressing Blacklist would have been refused by the database with
"Only an owner or general manager may change a guest blacklist."

**What was done** — `app.is_crm_manager()` (migration "one guest, one
record") is `is_manager()` or the admin role, and the trigger asks it.
`is_manager` itself is untouched: booking sources' insert policy reads it.
Proved both ways in `db/tests/modules/crm.sql` ("an administrator may
blacklist", "a clerk cannot") and through the route
(`oneGuestOneRecord.test.ts`: the admin blacklists, the clerk and the hotel
manager are refused).

**The rule** — when the owner names who may do something, read the function
the database asks, not its name: `is_manager` sounded like the answer and was
one role short.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
