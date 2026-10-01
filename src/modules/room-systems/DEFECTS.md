# Defects — room-systems

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `RS-1`, `RS-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — check that file
for the next free one before taking a number. Fixed entries stay here: they are
the reason the fault does not come back.

---

## Open — not fixed

None.

---

## Fixed — the solution is here; do not work it out again

### RS-3 · A day use would have been refused "departure has passed" (2 October)

Found reading cp6's day use (D27-227) at the merge. A card stops at the
booking's departure date at the property's check-out time; a day use departs
the day it arrives, so at 5 Elements its cards would stop at 11:00 that day,
before most day guests arrive, and the refusal ("change its dates") is one a
day use cannot follow (D27-230). There is no day-use end time anywhere.
**Done:** a day use is refused in words ("not cut here yet ... cut them in
the lock system's own software"), read from `reservations.is_day_use`;
tested, and seen failing with the rule removed. Cutting cards for a day use
waits for the owner to name when a day use ends.

**The rule:** a validity built from a booking's dates is checked against
the kind of booking that has no night.

### RS-2 · A stay id that is not a uuid answered 500 (30 September, numbered for now)

Found opening the routes by hand on the copy's own server:
`GET /stays/not-a-uuid/keys` came back "Something went wrong" (500), the
database refusing the cast. **Fixed:** both key routes answer 404 "No such
stay." before any query; tested (`keys.test.ts`, RS-2). Front desk's
`GET /stays/:id/inclusions` does the same today; told to the master, not
changed (not this service's).

**The rule:** an id from the address is checked before it reaches a cast.

### RS-1 · A "draws nothing" test passed with the rule removed (30 September, numbered for now)

`keyCards.test.tsx`'s first test checked that the key-card panel draws
nothing where no lock is connected. It looked for the heading as soon as
the read had been SENT. The panel draws nothing while the answer is on its
way too, so the test passed with the rule deleted (`if (!k) return null`).
Found by breaking the rule before committing, as AGENTS.md asks.

**Fixed:** the test waits until the answer is in the query cache, then
looks. Seen failing with the rule removed, passing with it.

**The rule:** a test that something is NOT drawn must first wait for the
thing that would have drawn it; "absent" is also what loading looks like.
