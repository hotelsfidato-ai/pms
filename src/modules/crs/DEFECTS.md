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
- Migration 160's check allows the fourth answer, dropped and added so a replay
  carries it.

The guard is `crsReader.test.ts`, "tells the CRS 'partly' once": one room confirmed
tells nothing; the second room cancelled tells "partly" once, across two runs.
`crsAnswerWorkflow.test.ts` covers the words. Neither is run yet: API tests wait for
the master's word.

**The rule:** an answer about several things waits until each of them has one, and a
mixed result is an answer of its own, not silence.

### CRS-2 · Switched on before there was an account to read as - GUARDED 5 October (D27-284)

**Found** 5 October, reading `setup.ts` while writing `deploy/crs-run-as.sql`. The card
lets the owner switch a hotel on before it has a `run_as`, and `connected_at` is stamped
at that moment. Nothing is read until `run_as` is set (`app.crs_due()`), so the desk
types those CRS bookings in by hand meanwhile, as the card itself tells them. Given an
account later, the reader starts from the OLD `connected_at` and books every one of
them a second time: they carry no CRS id, so neither guard sees the repeat.

**What was done:** the script refuses a hotel that is switched on with no `run_as`,
and says how: switch off on the card, run it, switch on. Switching on again stamps a
new `connected_at` (the card's own rule), so only bookings made from then are read.
The owner's steps (`deploy/README.md`, "Connect the CRS") follow that order. The guard
is `crsRunAs.test.ts`, "is not given an account while switched on".

**The rule:** a "from now on" stamp is taken when reading can actually start, not when
somebody first meant it to.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
