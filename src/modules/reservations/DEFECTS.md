# Defects — reservations

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `RES-1`, `RES-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Open — not fixed

### RES-2 · The booking reference is generated without a lock, in two copies

**Found** — 16 September, the readiness audit, by reading.

`groups.ts` and `front-desk/operations.ts` each compute `max(suffix)+1` from 5000 with no advisory lock, and stamp a hard-coded `FH-` prefix with the server's calendar date. `app.next_reference` (005) is advisory-locked and has no caller. Two bookings in the same second collide on `unique (hotel_id, reference)` and one becomes a 500.

**The fix, when it is done** — One generator, locked, prefix from `hotels.code`, called by both doors. `app.next_reference` already exists — give it the callers.

**The rule** — Two copies of a number generator are two chances to hand out the same number.

---

## Fixed

### RES-1 · A refused booking kept what it wrote before the refusal — FIXED 16 September

**Found** — 15 September, reading `POST /:code/bookings` against `withUser`; confirmed and widened by the readiness audit of 16 September (PMS-4). **Reproduced 16 September** by the tests below, against the unfixed route: every refusal was answered `409` and still left the guest; a refused channel left the guest (and, for several rooms, an empty group); an unpriced line, a room type not here and a party too large each left the guest **and the first line's two rooms confirmed with open folios**.

The route inserted the guest, then the group, and only then could refuse. `withSession` commits a refusal like any other return, so what was written stayed — and guests can never be deleted (015). The caller saw `ok:false` and retried, adding more each time.

**What was done** — branch `reservations/res-3-res-1`, the walk-in route's shape (root MEMORY 243), front desk's folder untouched. In `api/src/modules/reservations/groups.ts` the transaction now reads and checks everything first — the repeat (RES-3), the channel, then every line's room type, fit and price, collected into a plan — and only then writes the guest, the group, the rooms and their folios. A marked line, *"Nothing below this line refuses"*, sits between the two halves.

**Proved** — `api/test/modules/reservations/bookings.test.ts`, "RES-1 · a refused booking leaves nothing behind": each of the four refusals on a booking's SECOND line, counting guests, bookings, groups (by name too, so an empty one is found) and folios afterwards — all zero; and the same booking with the reason put right goes through whole. Four of the five failed against the unfixed route and pass now.

**The rule** — A refusal written below an insert keeps the insert. The transaction ends where the function returns, not where the reason is written. Check everything, then write — and put a line in the code where the checking stops.

### RES-3 · `POST /:code/bookings` had no idempotency — FIXED 16 September, migration 091

**Found** — 16 September, the readiness audit; 062's `idempotency-key` is honoured by work orders and banquet events only.

A timed-out request, retried by any machine caller, made a second guest, a second group, a second set of confirmed bookings and folios. A booking cannot be deleted, only voided with a reason (042). The channel manager (SU) is waiting on this.

**What was done** — branch `reservations/res-3-res-1`.
- The door takes `externalRef`, the SENDER'S own reference. Optional: the desk sends none and nothing changes for it. Present but not text, blank, or over 100 characters is refused before anything is written.
- **091** stamps every room of the request with `ota_reference` (005's dormant column), `ota_line` (its place in the request, 1 to n) and `ota_fingerprint` (a sha256 of what the sender said, after the route's defaults). `reservations_ota_line_idx` is unique on (hotel, booking source, reference, line), partial so the desk's NULLs never collide. A line number alone — without its reference, channel or fingerprint — is refused by a CHECK.
- **Why a line number:** `ota_reference` could not be unique by itself, because one request for a wedding makes nine rows carrying the same reference. Line 1 is what two racing copies collide on.
- **A repeat is asked about before any write** — and before the channel is checked, so a source switched off since the first request does not turn a retry into a refusal of a booking that exists. Same fingerprint: `200`, the first answer, marked `duplicate: true`. Different fingerprint: `409`, naming the references on file — a changed booking is not taken by this door (integration plan step 1.3; amendments stay at the desk, CRS-22).
- **Two copies at once** both pass that check; the second waits at the index and fails. The route catches ANY unique violation, looks again in a fresh transaction, and answers as the repeat if the earlier request is there — otherwise the error stands. Any unique violation, not only 091's index: two identical copies also compute the same booking reference (RES-2's unlocked generator), and that older index is reported first.

**Proved** — `api/test/modules/reservations/bookings.test.ts` (8 tests, counting rows in the database, not trusting the answer) and `db/tests/modules/reservations.sql` (14 assertions). Broken on purpose and seen to fail: rooms not stamped → 5 API tests red; the early check skipped → the switched-off test red; the race handling removed → the held-race test red with the loser's 500; the index made non-unique → 2 database assertions red.

**The rule** — A door a machine can knock on twice must answer the second knock with the first answer. And a key that one request writes several rows under needs a position, or it cannot be unique.

---

## Project-wide entries about this service

Their bodies are in the root `MEMORY.md`; where the entry ends in a rule,
it is quoted here so the lesson is visible without opening the file.

- **28** · A constraint the schema documents at length and does not have
- **81** · A feature that could never fire
- **106** · An empty list reduces to zero, and zero is a claim
- **118** · A route that could never run, under one that could
- **144** · A booking with nowhere to put money
- **159** · Links that had never opened anything
- **219** · Five copies of one label, and the fifth said "Walk-in" about Agoda
- **242** · "Required" went on one of the two doors a booking comes through — The rule, again: "required on every X" starts with finding every statement that makes an X
- **249** · A fix made in one of ten places: departed group rooms read "Room —" — The rule: when a fix lands in one query, grep for its siblings before calling it fixed.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
