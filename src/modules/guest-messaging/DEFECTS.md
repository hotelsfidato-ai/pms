# Defects — guest messages

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `MSG-1`, `MSG-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 276 was the
next free one on 16 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Fixed

### MSG-1 · A guard beside a cast is not a guard: Postgres may run the cast first

**Found** 19 September, by this service's own test failing on a second run
after passing on the first.

`about_id` on `messages_sent` is **text and is not always a booking** - migration
117 joins it loosely on purpose, so a folio, an invoice and a purchase order all
land in the same column. The screen's lateral therefore guarded the cast:

```sql
where m.about_kind = 'reservation'
  and m.about_id ~ '^[0-9a-fA-F-]{36}$'
  and res.id = m.about_id::uuid
```

It passed. Then the row count changed and the same query answered **500**:
`invalid input syntax for type uuid: "PO/2026/00017"`. **Postgres does not
promise to evaluate a `where` in the order it is written**, and it had chosen to
try the cast first. The guard was decorative, and it would have been somebody
else's purchase order that took this screen down.

**The regex was the second half of the same fault.** `[0-9a-fA-F-]{36}` accepts
36 characters of hex and dashes in any arrangement:
`'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa-'` passes it and the cast still refuses it.

**What was done:** the cast moved inside a `case`, whose arms Postgres does only
evaluate when their condition holds, and the regex is the uuid's actual shape.
Two tests, one for each half; the second is deterministic where the first was
luck. Both seen to fail with the old query put back.

**The rule: a check written beside a cast in a `where` is not in front of it.
Put the cast inside a `case`, and test the shape that passes the check and
fails the cast - not only the shape that fails both.**

---

### MSG-2 · A message a person sent read as "The system" to anybody who could not see that person

**Found** 19 September, **by opening the screen as housekeeping** - not by a
test, and not on the screen I had been looking at.

The "Sent by" column showed the sender's name, or "The system" where it was
null, because migration 117 keeps `sent_by` null for the messages the system
sends by itself. But the name comes through `left join staff`, and **`staff` is
row-secured**: a reader who may not see a colleague gets null for a message that
colleague sent. So a bill the owner had sent by hand read, to housekeeping, as
nobody having sent it.

"Was it us, or was it automatic?" is the only question that column answers, and
it was answering it wrongly for everybody outside the sender's own peers.

**What was done:** the route also answers `by_a_person` - `m.sent_by is not
null`, off a column on `messages_sent` the reader can already see, so it widens
nothing. Three answers where there were two: the name, "A member of staff", or
"The system". Tests on both sides; the web one seen to fail with the old cell
put back, and the fix confirmed in a real browser as housekeeping.

**The rule: a null that came through a row-secured join means "you may not see
it", not "there is none". Do not print a fact about the world from the absence
of a row somebody else was allowed to read.**

---

## Open — not fixed

### MSG-3 · A booking with no number and no address leaves no trace

The sweep skips a booking that has neither a telephone number nor an email
address, and it is right to: `send()` refuses it one step later anyway, and
**nothing is recorded where nothing was attempted** (migration 117's own rule).
But the desk then has no way to see that this guest will never get a
confirmation - the screen simply has no row for them.

Not fixed on purpose: the answer is a list read from `reservations`, not an
invented row in `messages_sent`, and that is phase 2. The sweep counts them
(`nowhereToSend`) so the number is at least reachable.

### MSG-4 · The date is formatted twice in this repository

`asWritten` in `jobs.ts` turns `2026-09-21` into `21/09/2026` - the same rule as
`reportDate` in `api/src/modules/reports/document.ts`, which is not on that
service's front door. One line here was smaller than a request to widen a door
for a date. If a third caller appears, ask for the door instead of copying it
again.

---

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
