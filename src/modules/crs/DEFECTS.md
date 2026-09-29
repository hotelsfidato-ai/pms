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

None.

## Fixed

### CRS-1 · A CRS booking answered only when all its rooms agree - FIXED 29 September (D27-174)

**Found** 29 September, reading `answersOwed` (reader.ts). A CRS booking of several
rooms becomes several reservations, and the register has one status per booking. So
the answer went only when every room was confirmed, or every room was cancelled or
voided. If the desk confirmed some rooms and cancelled others, nothing was ever
written.

**What was done:** the owner answered on 29 September (D27-174). Once EVERY room has
an answer and the answers differ, the register is told once, "Partly confirmed: N of
M rooms". The confirmed rooms' references go as the hotel's confirmation number.

- The answer is `partly`, with the room counts.
- The words live in the answer workflow's `STATUS`.
- Migration 163's check allows the fourth answer, dropped and added so a replay
  carries it.

The guard is `crsReader.test.ts`, "tells the CRS 'partly' once": one room confirmed
tells nothing; the second room cancelled tells "partly" once, across two runs.
`crsAnswerWorkflow.test.ts` covers the words. Neither is run yet: API tests wait for
the master's word.

**The rule:** an answer about several things waits until each of them has one, and a
mixed result is an answer of its own, not silence.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
