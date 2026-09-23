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

Nothing open. CRM-2 and CRM-3 were fixed on 22 September (below).

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

### CRM-2 · Two people who share a phone stayed on the "possible same person" list for ever

**Found** — 21 September, building the list. A family that books on one
mobile, or a travel agent's number typed as the guest's, is two people who
share a phone. The list showed them until somebody joined them, and joining
them would be the wrong join the brief warns about. There was no "not the
same person" answer a manager could give that took a pair off the list.

**What was done** — 22 September, the owner's D22-8 ("both"). The owner, an
administrator or a GM (CRM-Q5) presses **Not the same person** on the pair.
Migration "not the same person" (written as 128): `guest_not_same` (who, when,
and an undo's who and when; one live answer per pair), written only by
`app.guest_not_same` and `app.guest_not_same_undo` (SECURITY DEFINER,
managers only), and `app.same_person_pairs` - same signature (MEMORY 317) -
leaves out every pair a live answer stands between. The answer follows each
record to the one that stands for it, so a record answered "not him" and later
joined into a third is not offered through the third. Undone from the list
under "Not the same person", as a join is. Proved in
`db/tests/modules/crm.sql` (the function refuses a clerk; the table cannot be
written but through it; the pair leaves, follows a join, comes back on undo),
`api/test/modules/guests/notSamePersonAndBookingSites.test.ts` and
`src/modules/crm/crm.test.tsx`.

**The rule** — an answer a manager can give must be one they can take back:
every answer on this list (join, not the same) is recorded and undoable.

### CRM-3 · A booking from a channel was never matched, and a blacklisted guest arriving through one was not flagged

**Found** — 21 September. The suggestion and the blacklist warning were shown
to a CLERK typing a phone or email (D21-20, D21-21). A booking the channel
manager turns into a real one has no clerk: it makes its own guest record,
and nobody was warned. It surfaced later on "Possible same person".

**What was done** — 22 September, the owner's D22-8: **a warning on Arrivals
and at check-in** when a booking-site guest matches a blacklisted guest.
`app.booking_site_blacklist(hotel, from, to)` (same migration) lists bookings
from a source of kind `ota` - the channel manager's door and a site's booking
typed in alike - arriving in the dates, whose guest's phone or email is a
blacklisted guest's by the desk's own rule (`app.guest_suggestions`: exact
key, never a name). INVOKER, so row security keeps it to the asker's hotel.
Route `GET /:code/guests/blacklist-warnings`; the guests service's
`BookingSiteBlacklist` component, placed by front desk on Arrivals (today, and
the next fourteen days) and at the top of the check-in dialog. A warning with
the reason, "not refused - you decide": nothing is joined (D21-2) and nothing
is refused (D21-21). "Never matched" stays as the owner chose: the site's
guest record is not joined to anybody; a manager meets it on the same-person
list.

**The rule** — a warning meant for "whoever takes this booking" must be shown
where somebody meets a booking that arrived with nobody there.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
