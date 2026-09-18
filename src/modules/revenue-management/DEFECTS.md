# Defects - revenue management

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `RM-1`, `RM-2`, ... A lesson that would bite another service too
goes in the root `MEMORY.md` with a plain number instead; check that file
before taking a number. Fixed entries stay here: they are the reason the fault
does not come back.

---

## Open - not fixed

### RM-1 · Pickup is not built, because no front door answers when a booking was made

**Found** 18 September, building the first version. The brief's first item is
pickup: for each coming night, the rooms sold now and how many of those were
sold in the last 1, 7 and 30 days. That needs `reservations.created_at` counted
over the same nights the reports service counts, and there is no way to reach
either: the reports service's API door exports `buildReport` and the report
types, not `dailyFigures` or its `NIGHTS` fragment, and the reservations
service's door has no listing with a creation date.
`src/test/boundaries.test.ts` refuses any other path, correctly.

**What was done:** nothing invented. The screen shows no pickup column at all
rather than one it cannot fill, and the ask is written up as R1 in `MODULE.md`.
The third part of pace, "where this month stood a week ago", is blocked by the
same thing and is absent for the same reason.

**The rule: a figure you cannot reach through a door is a request, not a
second query. The moment this service writes its own `stay_nights`, it starts
disagreeing with the Manager report about how many rooms are sold - which is
exactly the fault the brief names.**

### RM-2 · On today's data every date past next week reads "Soft" at 0%

**Found** 18 September, on the screen, signed in as the Revenue Manager at 5EL
(business date 27 August 2026). The soft list is correct and useless: the demo
has almost nothing booked past the first days of September, so fourteen
consecutive dates show 0.0% sold, 16 of 16 rooms left, Soft. A list where every
row says the same thing tells the reader nothing, and the sentence "consider a
lower rate" fourteen times is noise a person learns to scroll past.

**What was done:** nothing yet. It is not a bug in the arithmetic - the figures
are right, and they come from the reports service. It is the threshold question,
RM-Q3 in `MODULE.md`, and the answer is the owner's. What is likely wanted is
something like "soft **relative to** where that weekday usually stands at this
distance", which needs a year of bookings this system does not have yet - the
first thing the old Coming soon page said it needed.

**The rule: a screen is judged on real data before it is called finished. The
tests were green and the arithmetic was right and the screen still said nothing
worth reading.**

---

## Adding one

Newest last, in the shape above: **Found** (when, and how - reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service, put
the lesson in the root `MEMORY.md` and point at it from here.
