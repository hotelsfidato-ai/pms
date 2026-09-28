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

### RES-6 · A group's lead can be a waiting room

`app.group_lead` (131) picks the room booked first that still stands, a
waiting one included, and the confirmation sweep asks only confirmed rooms;
a group whose first room waits while others are confirmed gets no voucher.
New booking makes every room of one booking waiting or none, and Confirm
confirms the whole group, so it cannot happen from the desk today.
**Noted, not fixed.**

---

## Fixed

### RES-9 · A confirmed booking could only be voided, and the guest page link always said "No link" - FIXED 28 September (QA BK-1, BK-2)

BK-1: StayActions offered Cancel only on a booking waiting for the hotel, so a
guest's cancellation and its fee had nowhere to go. Now `POST /stays/:id/cancel`
takes a confirmed one too - this room only, under its frozen terms (036/037),
the retention on its bill, waivable by owner/admin/GM. BK-2: the guest-link door
answers `{ status: 200, link }` with no `ok`; `send` read that as a refusal.
Every 2xx is the yes now. Tests: api cancelConfirmed.test.ts, web guestLink.test.ts.

### RES-10 · A booking could arrive in the past, from "ZZ", and its month was the clock's - FIXED 28 September (QA BK-3, BK-4, BK-12)

makeBooking refuses an arrival before app.business_date (below the repeat check,
so a channel's retry is still answered); nationality must be an ISO country
(validate.ts); migration 153 makes app.next_reference take the business month.
Tests: newBooking.test.ts, bookingReference.test.ts.

### RES-5 · A booking waiting for the hotel could not be cancelled until it was confirmed — FIXED 27 September

**Found** 27 September, opening a waiting booking's panel (Phase 1): "Void
this booking" was greyed ("Only a booking that has not arrived can be
voided") and nothing else took the booking off. **The owner (D27-64): cancel
it directly** - no charge (it was never confirmed), every waiting room of the
booking, a short reason kept. **Fixed:** `POST /:code/stays/:id/cancel`
(`desk.ts`, the gate's reservation-cancel grant), "Cancel this booking" in
place of Void on a waiting booking's panel (`CancelWaitingFlow`). The room is
free at once (044 counts no cancelled booking; 073 releases any room given).
Rule: a new state a booking can be in needs its way out, not only its way in.


### RES-7 · Mine: a repeated booking answered without the ids the first answer had — FIXED 27 September

**Found** by the full API suite (RES-3's own tests, `bookings.test.ts`): Phase 1
added each booking's `id` to the answer by zipping `reservationIds` in the
route, and a repeat has none, so the repeat was no longer the first answer.
**Fixed** at the source: `makeBooking` and `answerRepeat` both carry the id in
`bookings`. Rule: a field added to an answer is added on every path that
gives that answer.

### RES-8 · Mine: the discount CHECK let a promotion through with no percent — FIXED 27 September

**Found** by the new database check in `db/tests/modules/reservations.sql`
("a promotion with no percent is refused" — the statement succeeded).
`discount_percent > 0` on a NULL is unknown, and a CHECK that comes out
unknown passes. **Fixed** in 146: `discount_percent is not null` spelled out.
Rule: every branch of a CHECK that means "this must be present" says
`is not null`; a comparison alone lets NULL through. (For the root MEMORY.)

### RES-4 · The booking summary added each night's calendar price; the booking keeps the first night's — FIXED 27 September

**Found** reading `book.ts` for Phase 1: `makeBooking` stores the FIRST
night's `app.tariff_for` as `agreed_rate` and the night audit posts it every
night, while New booking's summary summed `getTariff`'s nights. On a stay
crossing a price change the screen and the bill disagreed. **The owner, 27
September: show what the bill will carry.** The line and the summary now use
the first night's price for every night and say so when the calendar differs
later. Rule: a figure on a booking screen is the one the posting will use.

### RES-2 · The booking reference is generated without a lock, in two copies — FIXED 16 September

**Found** — 16 September, the readiness audit, by reading.

`groups.ts` and `front-desk/operations.ts` each compute `max(suffix)+1` from 5000 with no advisory lock, and stamp a hard-coded `FH-` prefix with the server's calendar date. `app.next_reference` (005) is advisory-locked and has no caller. Two bookings in the same second collide on `unique (hotel_id, reference)` and one becomes a 500.

**The fix, when it is done** — One generator, locked, prefix from `hotels.code`, called by both doors. `app.next_reference` already exists — give it the callers.

**Where it stands, 16 September — half the doors.**
- **Part 1, the master:** migration **092** made `app.next_reference` the one generator, in the owner's format `FH-<hotel code>-<YYMM>-<number>` (the month on the hotel's own clock), under a per-hotel lock held to the end of the transaction, and fixed a third fault found on the way: `lpad(n, 4, '0')` CUTS a number past four digits. Old bookings keep their references.
- **Part 2, this door — done** (branch `reservations/res-2-reference`): `POST /:code/bookings` asks `select app.next_reference($1)` for every room, inside the same `withSession` transaction as the insert. Proved in `api/test/modules/reservations/bookings.test.ts`: every room's reference is `FH-5EL-<YYMM>-<n>` with consecutive numbers, and two different bookings held and released at the same moment both land with four different references.
- **Still open: the walk-in door**, `front-desk/operations.ts` — front desk switches it after its current job. Until then the walk-in's inline copy takes no lock, so a walk-in and a booking at the same moment can still build one reference (a 500, nothing kept).

**The rule** — Two copies of a number generator are two chances to hand out the same number.

**Closed, 16 September — the walk-in door, by the master.** `front-desk/operations.ts`
`POST /:code/walk-ins` now asks `select app.next_reference($1)` inside its
transaction, before the insert, like the booking door. The inline copy is gone.
Proved in `api/test/guards.test.ts` ("a walk-in records where it came from"):
the walk-in's reference matches `FH-5EL-<YYMM>-<number>`; run against the old
code it failed with `FH-2609-5031`. **No inline generator is left.**

---

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
