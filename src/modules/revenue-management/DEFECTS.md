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

### RM-3 · On this demo every pickup figure is a dash, and honestly so

**Found** 19 September, on the screen, signed in as the owner at 5EL, straight
after building pickup. Every one of New 1 day, New 7 days and New 30 days
shows a dash, and so does "A week ago".

It is not a fault in the counting. The demo loads its 86 bookings in one go -
`created_at` defaults to `now()`, so all 86 were recorded on 14 September -
while the property it loads them into is stopped at a business date of 27
August. A pickup window is counted back from the property's own day, so every
window here opens two and a half weeks BEFORE the first booking record exists.

**What was done:** the dash, and one sentence naming both dates. The
alternative was worse: with no check, `last1` equals `sold` on every night and
the screen says "every room on the books was booked today", which is true
under the definition and reads as news. `logic/pickup.ts` refuses a window
that opens before the property's booking records begin - the same shape as
D17-93, where available rooms start on the first trading day.

**It is right in production and only wrong-looking here.** A property whose
night audit runs has a business date within a day of the clock, and its
records start when it went live, so after thirty days of trading all three
windows count. Proved against the real database by hand, since the demo cannot
show it: with a business date of 20 September the one-day window counts 0 and
the seven-day window counts every room-night - the records begin on the 14th,
which is that window's first day exactly - and with 20 October all three count
0. What the demo cannot do is produce a booking made a week ago; that needs
`created_at` spread over the weeks before the business date, which is the
demo loader's, not this service's.

**The rule: a figure that cannot be told apart from another figure is not a
figure. Dash it and say why, in words, with both dates named - never a zero,
and never a number that reads like news.**

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

## Fixed

### RM-1 · Pickup is not built, because no front door answers when a booking was made

**Found** 18 September, building the first version. The brief's first item is
pickup: for each coming night, the rooms sold now and how many of those were
sold in the last 1, 7 and 30 days. That needs `reservations.created_at` counted
over the same nights the reports service counts, and there is no way to reach
either: the reports service's API door exports `buildReport` and the report
types, not `dailyFigures` or its `NIGHTS` fragment, and the reservations
service's door has no listing with a creation date.
`src/test/boundaries.test.ts` refuses any other path, correctly.

**What was done, 18 September:** nothing invented. The screen showed no pickup
column at all rather than one it could not fill, and the ask was written up as
R1 in `MODULE.md`. The third part of pace, "where this month stood a week
ago", was blocked by the same thing and absent for the same reason.

**FIXED 19 September.** R1 was answered on the 18th: the reports door now
exports `dailyFigures`, `sumDays`, `firstTradingDay`, `propertyFor`,
`propertyById`, `isoDateParam`, `heading` and the `NIGHTS` fragment.
`api/src/modules/revenue-management/pickup.ts` counts creation dates over
**that** fragment - imported, never copied - and takes `sold` straight from
`dailyFigures()` rather than counting it again, so the pickup figures are
subsets of a number this service did not derive. An API test holds the route
and the reports service's own `/statistics/daily` to the same `sold` night by
night, and was seen to go red the moment the route answered `paying` instead
of `sold`, naming 25 August, the fixture's one complimentary stay.

**The rule, and it held: a figure you cannot reach through a door is a
request, not a second query. The moment this service writes its own
`stay_nights`, it starts disagreeing with the Manager report about how many
rooms are sold - which is exactly the fault the brief names. Waiting a day for
the door cost nothing; a second query would have cost the month it took to
find the August disagreement.**

---

## Adding one

Newest last, in the shape above: **Found** (when, and how - reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service, put
the lesson in the root `MEMORY.md` and point at it from here.
