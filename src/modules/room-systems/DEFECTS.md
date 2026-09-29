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
