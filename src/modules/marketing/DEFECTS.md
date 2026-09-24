# Defects — marketing

**Read this before your first edit here.** Every defect found in this service:
what happened, how it was found, whether it is fixed, **what was done about
it**, and the rule it leaves behind. A solved problem stays solved only if the
solution is written where the next person will look.

**Numbering:** `MKT-1`, `MKT-2`, … A lesson that would bite another service
too goes in the root `MEMORY.md` with a plain number instead — 306 was the
next free one on 19 September 2026; check that file before taking a number. Fixed
entries stay here: they are the reason the fault does not come back.

---

## Fixed or answered

### MKT-1 · Nothing records a guest who has asked not to be written to, and the obvious column would not work

**Fixed 23 September 2026.** The owner answered on 21 September (D21-22):
recorded against the phone number or email itself, for the whole group. The
CRM chat built it - `offer_opt_outs` (migration 122), ticked on the booking
form and the walk-in, recorded or cleared on Guest 360 - and
`refusesOffers(noOffers, phone, email)` in `@/modules/guests`, which compares
a phone the way `app.phone_key` does. `mayBeWrittenTo` now refuses any guest
it names, and takes the No offers list as an argument, so no list can be
called without it. Every list goes through that one gate. Test: "No offers
(MKT-1, D21-22)" in `logic/lists.test.ts` - a guest on all three lists is on
none once their phone (typed another way) or their email (other capitals) is
on No offers; seen to fail with the check taken out (3 failed).

Still to come with the screen: the data call that reads the list
(`GET /api/hotels/:code/crm/no-offers`). It is not added now because a data
function with no caller fails `repositories.test.ts`, and nothing calls the
lists yet (MKT-4).

**Found** 19 September 2026, reading the schema before building the lists -
the brief tells this service to check, and to ask rather than invent.

Searched every migration: there is no opt-out, no consent, no do-not-contact
and no unsubscribe anywhere. `guests.is_blacklisted` exists but means a guest
refused a room, which is a different promise to a different person.

**The part that is not obvious.** The natural fix - a `may_be_written_to`
column on `guests` - does not do the job. `guests` carries **a row per
booking** (`004_guests.sql`; the header of
`api/src/modules/guests/directory.ts` says two visits by one person are two
rows until somebody merges them, and the merge rules are not decided). A flag
on one row leaves the same person's other rows writable, so somebody who asked
not to be written to is written to from their other visit. A guest is grouped
by **name** upstream, and a name is not a thing to hang a promise on either.

**What was done:** nothing invented. `logic/lists.ts` has one gate every list
goes through, `mayBeWrittenTo`, so the condition is added in one place when the
answer comes. Today it only asks whether there is an address to write to, which
is **not sufficient**, and nothing in this service is put behind a send. Put to
the master on 19 September with a recommendation (MODULE.md, request 1):
record the refusal against **the address**, not the person.

**The rule:** a promise made to a person cannot be stored on a row that is
one of several for that person. Before adding a flag to `guests`, ask which of
that guest's rows it is true of.

### MKT-2 · Birthdays this month cannot be built: this system has no date of birth

**Answered 22 September 2026 (D22-17): the birthdays list is dropped** - no
date of birth is kept. Nothing had been built for it; the mention in
`logic/lists.ts` and the line in `docs/briefs/marketing.md` now say it was
dropped.

**Found** 19 September 2026, the same reading. `docs/briefs/marketing.md` names
"birthdays this month" as the fourth list. **There is no date of birth on
`guests`, on `reservations`, or in any of the 119 migrations.**

It is also **not in D18-17**, the owner's own decision, which names three lists
- stayed twice, not returned in a year, came from which site - and not this
one. So the brief widened the ask past what was answered, and nothing the owner
asked for is missing.

**What was done:** the three lists of D18-17 are built and this one is not.
Recommended to the master (MODULE.md, request 4) that it be dropped rather than
left looking half-built: it needs a column, a place on a screen to enter it,
and a reason to hold a guest's date of birth at all, which are three decisions
for one list and none of them this service's.

**The rule:** where a brief and a decision disagree about scope, the decision
wins and the difference is reported - it is usually the brief that drifted.

### MKT-3 · This service has no menu section and no permission resource, so it can have no screen

**Answered 22 September 2026 (D22-17): marketing's lists are for the owner,
an administrator and the GM only.** Made 23 September: a `marketing` resource
in `api/src/permissions.ts` (view and export, for admin and GM; the owner holds
everything), labelled "Marketing". The Coming soon entry and its route now ask
that grant instead of `integration` plus `seesComingSoon` - the same three
people, now said in one place. Test: "who sees the lists (D22-17)" in
`logic/lists.test.ts`, every role; seen to fail with reception given a grant.
**No menu section was made**: there is still no lists screen to put in one
(MKT-4), so the entry stays in Coming soon.

**Found** 19 September 2026, before writing a screen. `SectionKey` in
`src/components/app/navigation.ts` does not include `"marketing"` and
`RESOURCES` in `src/lib/permissions.ts` does not either. Both are the master's
files. `SectionKey` is a typed union, so an entry naming a section that does
not exist does not compile - which is the check working, not a problem.

This is exactly where laundry and spa stopped on 18 September; the master made
both, and the run sheet records that stopping there was the agreement working.

**What was done:** stopped, and asked (MODULE.md, request 3). The Coming soon
entry is untouched and no screen was built. **Who may see a screen is the
owner's**, so the recommendation names a reading rather than making the grant.

## Open — not fixed

### MKT-4 · The guests door answers without a telephone number or an email, so its list cannot be written to

**Found** 19 September 2026. `/api/hotels/:code/guests` already computes this
service's whole input - stays, last stay, next stay, sources - but
`GuestRecord` carries no contact details, and
`api/src/modules/guests/index.ts` exports only `mounts`, so there is no
function to call either.

**What was done:** no query was written here. `logic/lists.ts` declares the
shape needed (`Addressable`) and the ask went to the master (MODULE.md,
request 2) in the shape `postCharge` (D18-7) and the reports door (R1) already
took: lift the route's body into a function, export it, have the route call it.

**The rule:** "what counts as a stay" has five copies' worth of scar tissue in
this repository already. A service that needs it asks for the door to be
widened; it does not write the sixth.

### MKT-5 · The Coming soon page still describes the service D18-17 replaced

**Found** 19 September 2026, reading `pages/Marketing.tsx` after the lists were
built. The page tells the owner, the admins and the general managers that
marketing is *"which campaign brought which guest, what it cost and what it
earned"*, and that before it can be built it **needs access to Meta Ads and
Google Ads**, the leads app connected, and booking figures confirmed by this
system.

**None of that is true any more.** D18-17 made the first version guest lists
that can be acted on, which needs none of those three. What it actually waits
on is MKT-1 to MKT-4. So a screen is telling the owner their own service is
blocked on things they have already decided around.

**What was done:** logged, and the copy was NOT rewritten. The page is due to
be replaced outright by the real screens the moment MKT-3 is answered
(`MODULE.md`, request 3), and new words for a page scheduled for deletion are
words written twice. **What a person reads is the owner's** in any case
(`HANDOVER.md` § 5), so the recommendation went to the master rather than
into the file: replace the page, do not re-word it. If MKT-3 is going to wait,
say so and the three `needs` lines are corrected on their own.

**Still so, 25 September**, and the reason has narrowed: MKT-1 to MKT-3 are
answered (MKT-3 on 22 September, D22-17 - owner, administrator and GM only),
and `pages/Marketing.tsx` still says campaigns, Meta Ads, Google Ads and the
leads app. What the real screen waits on now is MKT-4 alone - the guests door
answering with a phone and an email.

**The rule:** when a decision narrows a service, the Coming soon page is part
of what the decision changed. Check it in the same session, even if the answer
is to delete it rather than edit it.

---

## Adding one

Newest last, in the shape above: **Found** (when, and how — reading, a test, a
screen, production), what happens, **what was done** (or the fix when it is
done), and the rule. If it changes something a person sees, it also belongs in
`PENDING.md` until the owner has decided. If it would bite another service,
put the lesson in the root `MEMORY.md` and point at it from here.
