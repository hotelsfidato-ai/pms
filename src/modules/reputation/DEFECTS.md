# Defects — reviews

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `REV-1`, `REV-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### REV-3 · A group booking is several departures, and each could be asked

**Found** 19 September 2026, writing the departures list. A party in three
rooms is three rows in `reservations`, so it is three rows on this screen, and
somebody could ask the same family for a review three times - once per room -
each going to whichever guest that room's booking names.

**What happens today:** every departed reservation is its own row and its own
button. Nothing groups them, and nothing stops the third ask.

**Why it is not fixed:** which of a group's rooms is "the guest to ask" is the
owner's answer, not mine, and there are at least three defensible ones - the
room that holds the group's lead guest, one ask per distinct phone number, or
one per `reservation_groups` row. Guessing would have been a decision taken
without approval, which is the rule this project breaks least often.

**For the owner, with a recommendation:** ask **once per group**, at the room
holding the party's lead guest, and show the other rooms as already asked.
A family asked three times reads as a machine, not a hotel.

---

## Fixed

### REV-1 · One broken guard would have read as a broken harness

**Found** 19 September 2026, and only by breaking a guard on purpose: the
database file's four "a bad link is refused" assertions each tried an insert
and expected it to raise. With the https constraint taken out to watch them
fail, the first insert SUCCEEDED and left a row behind - and the next attempt
hit `review_links_pkey`, which stopped the whole suite under ON_ERROR_STOP.
951 assertions never ran, and the output said `the suite did not finish`
rather than naming the guard that had gone.

This is MEMORY 289 exactly: *a failing check that leaves rows its own clean-up
cannot remove stops the suite.* The file was green before and after; nothing
but breaking it could have shown this.

**Fixed:** every refused insert in `db/tests/modules/reputation.sql` deletes
whatever it may have left, immediately after its assertion. Re-broken
afterwards: the four now fail by name, `reviews | 9 passed | 4 failed`, and
the other 938 assertions still run.

**The rule:** a test that proves a refusal must clean up as if the refusal had
not happened - because the day it matters is the day it did not.

### REV-2 · I asserted the shared door records a send it never attempted

**Found** 19 September 2026, by a red test. I wrote that asking a guest whose
booking carries no email address WOULD leave a row in `messages_sent`, on the
reasoning that the hotel meant to send it. It does not: `api/src/sending.ts`
looks for the address before it reaches the receiver and returns without
recording, the same way it returns without recording when nothing is
connected.

**The door is right and my test was wrong** - nothing that never left the
building is an attempt anybody made, and that rule belongs in the shared door
rather than being re-decided per service. **Fixed:** the test pins the real
behaviour, and says in place that the expectation was the other way round, so
the day it changes it changes on purpose.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
